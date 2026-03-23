import express from "express";
import { detectLanguage, translateToEnglish } from "./translate";
import { categorize } from "./categorize";
import { generateDraftResponse } from "./draft";
import {
  getConversation,
  addLabels,
  addMessage,
  assignConversation,
  getAgents,
} from "./chatwoot";

const app = express();
const PORT = process.env.PORT || 3100;
const ENRICHMENT_URL = process.env.ENRICHMENT_SERVICE_URL || "http://enrichment-service:3200";

app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

const PROCESSED_LABEL = "ai-processed";

interface WebhookPayload {
  event: string;
  // conversation_created: conversation data is at the top level
  id?: number;
  messages?: Array<{ content: string; message_type: number }>;
  labels?: string[];
  // message_created: message data is at the top level, conversation is nested
  content?: string;
  message_type?: string | number;
  conversation?: {
    id: number;
    display_id?: number;
    labels?: string[];
    messages?: Array<{ content: string; message_type: number }>;
  };
  account?: { id: number };
}

function extractContent(payload: WebhookPayload): { content: string; conversationId: number } | null {
  if (payload.event === "message_created" && payload.content) {
    const convId = payload.conversation?.id;
    // Chatwoot: 0 = incoming (from contact), 1 = outgoing (from agent)
    const isIncoming = payload.message_type === "incoming" || payload.message_type === 0;
    if (convId && isIncoming) {
      return { content: payload.content, conversationId: convId };
    }
  }

  if (payload.event === "conversation_created") {
    // Chatwoot sends conversation data at the top level for this event
    const convId = payload.id || payload.conversation?.id;
    const messages = payload.messages || payload.conversation?.messages || [];
    const content = messages.find((m) => m.content)?.content;
    if (content && convId) {
      return { content, conversationId: convId };
    }
  }

  return null;
}

async function fetchEnrichmentNote(email: string): Promise<string | null> {
  try {
    const res = await fetch(`${ENRICHMENT_URL}/enrich?email=${encodeURIComponent(email)}`);
    if (!res.ok) return null;
    const data = await res.json() as any;

    const lines: string[] = ["**[User Enrichment]**"];

    if (data.user) {
      lines.push(`**Account:** ${data.user.plan || "unknown plan"} · Signed up ${data.user.signupDate || "unknown"}`);
    } else {
      lines.push("**Account:** Not found in internal DB");
    }

    if (data.sentry?.errors?.length) {
      lines.push(`\n**Sentry (${data.sentry.errors.length} recent error${data.sentry.errors.length > 1 ? "s" : ""}):**`);
      for (const e of data.sentry.errors) {
        lines.push(`- [${e.shortId}](${e.permalink || "#"}): ${e.title} _(${e.level}, ${e.lastSeen})_`);
      }
    } else {
      lines.push("\n**Sentry:** No recent errors");
    }

    if (data.posthog?.recordingsLink) {
      lines.push(`\n**PostHog:** [View session recordings](${data.posthog.recordingsLink})`);
      if (data.posthog.recordings?.length) {
        for (const r of data.posthog.recordings) {
          lines.push(`- Recording \`${r.id}\` · ${Math.round(r.duration)}s`);
        }
      }
    }

    return lines.join("\n");
  } catch {
    return null;
  }
}

async function processTicket(content: string, conversationId: number): Promise<void> {
  const conv = await getConversation(conversationId);
  const labels = conv.labels || [];
  const isFirstMessage = !labels.includes(PROCESSED_LABEL);

  console.log(`Processing conversation ${conversationId} (${isFirstMessage ? "first message" : "follow-up"})...`);

  if (isFirstMessage) {
    // --- First message: full pipeline (enrichment, categorization, labeling) ---
    if (conv.contactEmail) {
      const enrichmentNote = await fetchEnrichmentNote(conv.contactEmail);
      if (enrichmentNote) {
        await addMessage(conversationId, enrichmentNote, true);
      }
    }

    const [languageCode, translated] = await Promise.all([
      detectLanguage(content),
      translateToEnglish(content),
    ]);
    const categorization = await categorize(content, translated);

    const categoryLabels: string[] = [categorization.category];
    if (categorization.confidence === "low") {
      categoryLabels.push("needs-triage");
    } else {
      categoryLabels.push("high-confidence");
    }
    categoryLabels.push(PROCESSED_LABEL);
    await addLabels(conversationId, categoryLabels);

    const draft = await generateDraftResponse(content, languageCode);
    await addMessage(conversationId, `**[AI Draft - respond in user's language]**\n\n${draft}`, true);

    if (categorization.suggestedAssignee) {
      await addMessage(conversationId, `**[Suggested assignee]** ${categorization.suggestedAssignee} (${categorization.confidence} confidence)`, true);
      if (categorization.confidence === "high") {
        const agents = await getAgents();
        const match = agents.find((a) =>
          a.name.toLowerCase().includes(categorization.suggestedAssignee!.toLowerCase())
        );
        if (match) {
          try {
            await assignConversation(conversationId, match.id);
            console.log(`Auto-assigned to ${match.name}`);
          } catch (e) {
            console.warn("Auto-assign failed:", e);
          }
        }
      }
    }

    console.log(`Processed ${conversationId}: ${categorization.category} (${categorization.confidence})`);
  } else {
    // --- Follow-up message: just generate a new draft with conversation context ---
    const languageCode = await detectLanguage(content);
    const draft = await generateDraftResponse(content, languageCode, conv.messages);
    await addMessage(conversationId, `**[AI Draft - respond in user's language]**\n\n${draft}`, true);
    console.log(`Draft generated for follow-up on conversation ${conversationId}`);
  }
}

app.post("/webhook", async (req, res) => {
  res.status(200).send("OK");

  const payload = req.body as WebhookPayload;
  const event = payload?.event;

  if (event !== "conversation_created" && event !== "message_created") {
    return;
  }

  const extracted = extractContent(payload);
  if (!extracted) {
    if (event === "conversation_created") {
      const convId = payload.id || payload.conversation?.id;
      if (convId) {
        const conv = await getConversation(convId).catch(() => null);
        if (conv?.messages?.length) {
          const firstMsg = conv.messages.find((m) => m.content)?.content;
          if (firstMsg) {
            processTicket(firstMsg, convId).catch((e) =>
              console.error("Process error:", e)
            );
          }
        }
      }
    }
    return;
  }

  processTicket(extracted.content, extracted.conversationId).catch((e) =>
    console.error("Process error:", e)
  );
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ai-pipeline" });
});

app.listen(PORT, () => {
  console.log(`AI Pipeline listening on port ${PORT}`);
});
