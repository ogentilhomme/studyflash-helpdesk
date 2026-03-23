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

async function processTicket(content: string, conversationId: number): Promise<void> {
  const conv = await getConversation(conversationId);
  const labels = conv.labels || [];

  if (labels.includes(PROCESSED_LABEL)) {
    console.log(`Conversation ${conversationId} already processed, skipping`);
    return;
  }

  console.log(`Processing conversation ${conversationId}...`);

  const [languageCode, translated] = await Promise.all([
    detectLanguage(content),
    translateToEnglish(content),
  ]);
  const categorization = await categorize(content, translated);

  const draft = await generateDraftResponse(content, languageCode);

  const categoryLabels: string[] = [categorization.category];
  if (categorization.confidence === "low") {
    categoryLabels.push("needs-triage");
  } else {
    categoryLabels.push("high-confidence");
  }
  categoryLabels.push(PROCESSED_LABEL);

  await addLabels(conversationId, categoryLabels);

  const draftNote = `**[AI Draft - respond in user's language]**\n\n${draft}`;
  await addMessage(conversationId, draftNote, true);

  if (categorization.suggestedAssignee) {
    const assigneeNote = `**[Suggested assignee]** ${categorization.suggestedAssignee} (${categorization.confidence} confidence)`;
    await addMessage(conversationId, assigneeNote, true);

    if (categorization.confidence === "high") {
      const agents = await getAgents();
      const match = agents.find(
        (a) =>
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

  console.log(
    `Processed ${conversationId}: ${categorization.category} (${categorization.confidence})`
  );
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
