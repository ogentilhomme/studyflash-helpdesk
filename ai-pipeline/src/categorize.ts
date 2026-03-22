import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export type Category =
  | "bug-report"
  | "refund-request"
  | "product-question"
  | "other";

export interface CategorizationResult {
  category: Category;
  confidence: "high" | "low";
  suggestedAssignee?: string;
}

/**
 * Maps sample ticket tags to our four main categories:
 * - bug-report: technical-errors, flashcard-issues, quiz-issues, podcast-issues,
 *   mindmap-issues, summary-issues, content-upload, data-loss, mock-exam-issues
 * - refund-request: refund-request
 * - product-question: subscription-info, subscription-cancellation, billing-invoice,
 *   account-issues, general-how-to
 * - other: garbage, misunderstanding, language-issues, or ambiguous
 */
export async function categorize(
  content: string,
  translatedContent?: string
): Promise<CategorizationResult> {
  const textToAnalyze = translatedContent || content;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `You are categorizing customer support tickets for Studyflash, an ed-tech app with flashcards, quizzes, podcasts, and AI features.

Categories:
1. bug-report: Technical errors, app crashes, broken features (flashcards, quizzes, podcasts, mindmaps, content upload, data loss, etc.)
2. refund-request: User wants money back, cancellation refund, billing dispute
3. product-question: Subscription info, cancellation process, account issues, how-to questions, pricing/billing questions
4. other: Unclear, spam, garbage, or doesn't fit above

Also assess confidence: "high" if clearly one category, "low" if ambiguous or could fit multiple.

For high-confidence bug-report, suggest assignee: "engineering"
For high-confidence refund-request, suggest assignee: "billing"
For high-confidence product-question, suggest assignee: "support"
For low confidence, do NOT suggest assignee.

Reply in JSON only, no markdown:
{"category":"bug-report|refund-request|product-question|other","confidence":"high|low","suggestedAssignee":"engineering|billing|support" or omit if low}

Ticket content:
${textToAnalyze.slice(0, 2000)}`,
      },
    ],
  });

  const text = response.content[0];
  if (text.type !== "text") {
    return { category: "other", confidence: "low" };
  }

  try {
    const parsed = JSON.parse(
      text.text.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim()
    );
    return {
      category: parsed.category || "other",
      confidence: parsed.confidence || "low",
      suggestedAssignee: parsed.suggestedAssignee,
    };
  } catch {
    return { category: "other", confidence: "low" };
  }
}
