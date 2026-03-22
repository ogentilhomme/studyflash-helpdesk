import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function translateToEnglish(
  content: string,
  detectedLanguage?: string
): Promise<string> {
  if (!content || content.trim().length === 0) {
    return content;
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Translate the following customer support ticket to English. Preserve the original meaning, tone, and structure. If it's already in English, return it unchanged with minimal edits.

${content}`,
      },
    ],
  });

  const text = response.content[0];
  if (text.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }
  return text.text.trim();
}

export async function detectLanguage(content: string): Promise<string> {
  if (!content || content.trim().length === 0) {
    return "en";
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 64,
    messages: [
      {
        role: "user",
        content: `Identify the language of this text. Reply with ONLY the ISO 639-1 language code (e.g. en, de, fr, es, nl, it). If unclear, reply "en".

Text:
${content.slice(0, 500)}`,
      },
    ],
  });

  const text = response.content[0];
  if (text.type !== "text") {
    return "en";
  }
  return text.text.trim().toLowerCase().replace(/[^a-z]/g, "") || "en";
}
