import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

/**
 * Generate a draft response in the user's original language.
 * Uses the detected language code to instruct Claude to respond in that language.
 */
export async function generateDraftResponse(
  ticketContent: string,
  languageCode: string
): Promise<string> {
  const langInstruction =
    languageCode === "en"
      ? "Write the response in English."
      : `Write the response in the same language as the user's message (language code: ${languageCode}).`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a helpful support agent for Studyflash, an ed-tech app. Draft a professional, empathetic response to this customer ticket.

Guidelines:
- Be concise and helpful
- For refund requests: acknowledge, explain process, set expectations
- For bug reports: apologize, ask for details if needed, suggest troubleshooting
- For product questions: answer clearly, link to help if relevant
- Never promise things outside policy (e.g. guaranteed refunds)
- Sign off professionally (e.g. "Best regards, Studyflash Support")

${langInstruction}

Customer message:
${ticketContent}`,
      },
    ],
  });

  const text = response.content[0];
  if (text.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }
  return text.text.trim();
}
