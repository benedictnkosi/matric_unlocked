const OLLAMA_API_BASE = process.env.OLLAMA_API_BASE ?? "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1";

export interface ImageRequiredCheckInput {
  subject: string;
  topic: string;
  context: string;
  question: string;
  options: unknown;
  answer: string;
}

export interface ImageRequiredCheckResult {
  image_required: boolean;
  question_complete_without_image: boolean;
  confidence: number;
  reason: string;
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

function buildPrompt(input: ImageRequiredCheckInput): string {
  const questionData = {
    subject: input.subject,
    topic: input.topic,
    context: input.context,
    question: input.question,
    options: normalizeOptions(input.options),
    answer: input.answer,
    image_path: "",
  };

  return `You are an educational content reviewer. Determine whether a question requires an image to be understandable and answerable.

Question Data:
${JSON.stringify(questionData, null, 2)}

Return ONLY valid JSON:
{
  "image_required": true,
  "question_complete_without_image": false,
  "confidence": 1.0,
  "reason": "..."
}`;
}

function parseCheckResult(raw: string): ImageRequiredCheckResult {
  const parsed = JSON.parse(raw) as Partial<ImageRequiredCheckResult>;

  if (typeof parsed.image_required !== "boolean") {
    throw new Error("Ollama response missing boolean image_required.");
  }

  return {
    image_required: parsed.image_required,
    question_complete_without_image: parsed.question_complete_without_image ?? !parsed.image_required,
    confidence:
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? parsed.confidence
        : 0,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

export async function checkImageRequired(
  input: ImageRequiredCheckInput,
  options?: { model?: string; baseUrl?: string },
): Promise<ImageRequiredCheckResult> {
  const model = options?.model ?? DEFAULT_MODEL;
  const baseUrl = options?.baseUrl ?? OLLAMA_API_BASE;

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      prompt: buildPrompt(input),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Ollama generate failed (${response.status}): ${errorBody}`);
  }

  const payload = (await response.json()) as { response?: string };
  if (!payload.response?.trim()) {
    throw new Error("Ollama returned an empty response.");
  }

  try {
    return parseCheckResult(payload.response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`Failed to parse Ollama response: ${message}`);
  }
}
