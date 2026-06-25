const OPENAI_API_BASE = "https://api.openai.com/v1";

export interface AssignQuestionNumberInput {
  subject: string;
  year: number;
  term: number;
  openAiFileId: string;
  context: string;
  question: string;
  options: unknown;
}

export interface AssignQuestionNumberResult {
  question_number: string;
  confidence: number;
  reason: string;
}

function getOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  return apiKey;
}

function formatOpenAiError(operation: string, status: number, errorBody: string): string {
  try {
    const parsed = JSON.parse(errorBody) as {
      error?: { message?: string };
    };
    const message = parsed.error?.message;

    if (message) {
      return `OpenAI ${operation} failed (${status}): ${message}`;
    }
  } catch {
    // Fall through to the raw error body.
  }

  return `OpenAI ${operation} failed (${status}): ${errorBody}`;
}

function normalizeOptions(options: unknown): string[] {
  if (options == null) return [];

  if (typeof options === "string") {
    try {
      const parsed = JSON.parse(options) as unknown;
      return normalizeOptions(parsed);
    } catch {
      return options.trim() ? [options] : [];
    }
  }

  if (Array.isArray(options)) {
    return options.map((option) => String(option));
  }

  if (typeof options === "object") {
    return Object.values(options as Record<string, unknown>).map((option) => String(option));
  }

  return [String(options)];
}

function buildPrompt(input: AssignQuestionNumberInput): string {
  const questionData = {
    subject: input.subject,
    year: input.year,
    term: input.term,
    context: input.context,
    question: input.question,
    options: normalizeOptions(input.options),
  };

  return `You are reviewing a South African matric past exam paper PDF attached to this message.
Identify the official exam question number for the question below.
Use the numbering exactly as it appears on the paper, such as "1", "1.1", "2.3", "3.2.1", or "QUESTION 4".
If the paper uses section labels, include them when they are part of the question label.

Question to match:
${JSON.stringify(questionData, null, 2)}

Return valid JSON in this exact shape:
{
  "question_number": "1.2",
  "confidence": 1.0,
  "reason": "..."
}`;
}

function parseAssignQuestionNumberResult(raw: string): AssignQuestionNumberResult {
  const parsed = JSON.parse(raw) as Partial<AssignQuestionNumberResult & { question_number?: unknown }>;

  const questionNumber =
    typeof parsed.question_number === "string"
      ? parsed.question_number.trim()
      : parsed.question_number != null
        ? String(parsed.question_number).trim()
        : "";

  if (!questionNumber) {
    throw new Error("OpenAI response missing question_number.");
  }

  return {
    question_number: questionNumber,
    confidence:
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? parsed.confidence
        : 0,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

async function callOpenAiJsonWithPdf(
  openAiFileId: string,
  prompt: string,
  options?: { model?: string },
): Promise<string> {
  const apiKey = getOpenAiApiKey();
  const model = options?.model ?? process.env.OPENAI_MODEL ?? "gpt-4o";

  const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              file: {
                file_id: openAiFileId,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(formatOpenAiError("chat completion", response.status, errorBody));
  }

  const data = (await response.json()) as {
    choices: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error("OpenAI returned an empty response.");
  }

  return content;
}

export async function assignQuestionNumber(
  input: AssignQuestionNumberInput,
  options?: { model?: string },
): Promise<AssignQuestionNumberResult> {
  try {
    const raw = await callOpenAiJsonWithPdf(input.openAiFileId, buildPrompt(input), options);
    return parseAssignQuestionNumberResult(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`Failed to assign question number: ${message}`);
  }
}
