const OPENAI_API_BASE = "https://api.openai.com/v1";

export interface AssignImageToQuestionsInput {
  subject: string;
  year: number;
  term: number;
  openAiPdfFileId: string;
  imageDataUrl: string;
  knownQuestionNumbers: string[];
}

export interface AssignImageToQuestionsResult {
  question_numbers: string[];
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
    // Fall through.
  }

  return `OpenAI ${operation} failed (${status}): ${errorBody}`;
}

function buildPrompt(input: AssignImageToQuestionsInput): string {
  return `You are reviewing a South African matric past exam paper PDF and one image extracted from that paper.
The image may be a diagram, graph, table, map, figure, or other visual needed to answer one or more questions.

Identify ALL official exam question numbers that rely on this image to be answerable.
If the same image supports a parent question and its sub-questions, include every number.
For example, if the image applies to 4.1 and also to sub-questions 4.1.1 and 4.1.2, return all three.

Use numbering exactly as it appears on the paper.
Known question numbers for this paper:
${JSON.stringify(input.knownQuestionNumbers, null, 2)}

Return valid JSON in this exact shape:
{
  "question_numbers": ["4.1", "4.1.1", "4.1.2"],
  "confidence": 1.0,
  "reason": "..."
}

If the image does not belong to any exam question, return an empty question_numbers array.`;
}

function parseAssignImageToQuestionsResult(raw: string): AssignImageToQuestionsResult {
  const parsed = JSON.parse(raw) as Partial<AssignImageToQuestionsResult & {
    question_numbers?: unknown;
  }>;

  const questionNumbers = Array.isArray(parsed.question_numbers)
    ? parsed.question_numbers.map((value) => String(value).trim()).filter(Boolean)
    : [];

  return {
    question_numbers: questionNumbers,
    confidence:
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? parsed.confidence
        : 0,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

async function callOpenAiJsonWithPdfAndImage(
  openAiPdfFileId: string,
  imageDataUrl: string,
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
                file_id: openAiPdfFileId,
              },
            },
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl,
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

export async function assignImageToQuestions(
  input: AssignImageToQuestionsInput,
  options?: { model?: string },
): Promise<AssignImageToQuestionsResult> {
  if (!input.openAiPdfFileId.trim()) {
    throw new Error("Past paper PDF is required. Upload the PDF before assigning images.");
  }

  try {
    const raw = await callOpenAiJsonWithPdfAndImage(
      input.openAiPdfFileId,
      input.imageDataUrl,
      buildPrompt(input),
      options,
    );
    return parseAssignImageToQuestionsResult(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`Failed to assign image to questions: ${message}`);
  }
}

export function normalizeQuestionNumber(value: string): string {
  return value.trim().replace(/^question\s*/i, "").toLowerCase();
}

export function findQuestionsForQuestionNumbers<
  T extends { id: string; questionNumber?: string },
>(questions: T[], questionNumbers: string[]): T[] {
  const targets = new Set(
    questionNumbers.map(normalizeQuestionNumber).filter(Boolean),
  );

  return questions.filter((question) => {
    const number = question.questionNumber?.trim();
    if (!number) return false;
    return targets.has(normalizeQuestionNumber(number));
  });
}
