const OLLAMA_API_BASE = process.env.OLLAMA_API_BASE ?? "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1";

export interface SubTopicOption {
  id: string;
  name: string;
  description: string;
}

export interface ClassifyQuestionSubTopicInput {
  subject: string;
  grade: number;
  parentTopic: string;
  context: string;
  question: string;
  options: unknown;
  answer: string;
  subTopics: SubTopicOption[];
}

export interface ClassifyQuestionSubTopicResult {
  sub_topic_id: string;
  sub_topic_name: string;
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

function buildPrompt(input: ClassifyQuestionSubTopicInput): string {
  const questionData = {
    subject: input.subject,
    grade: input.grade,
    parent_topic: input.parentTopic,
    context: input.context,
    question: input.question,
    options: normalizeOptions(input.options),
    answer: input.answer,
  };

  return `You are an educational content classifier for South African matric exam questions.
Choose the single best-fitting sub-topic for the question below.

Question Data:
${JSON.stringify(questionData, null, 2)}

Available sub-topics:
${JSON.stringify(input.subTopics, null, 2)}

Return ONLY valid JSON:
{
  "sub_topic_id": "exact id from the list",
  "sub_topic_name": "exact name from the list",
  "confidence": 1.0,
  "reason": "..."
}

You MUST choose exactly one sub-topic from the available list. Use the exact id and name from that sub-topic.`;
}

async function callOllamaJson(
  prompt: string,
  options?: { model?: string; baseUrl?: string },
): Promise<string> {
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
      prompt,
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

  return payload.response;
}

function parseClassificationResult(raw: string): ClassifyQuestionSubTopicResult {
  const parsed = JSON.parse(raw) as Partial<ClassifyQuestionSubTopicResult>;

  if (!parsed.sub_topic_id?.trim() || !parsed.sub_topic_name?.trim()) {
    throw new Error("Ollama response missing sub_topic_id or sub_topic_name.");
  }

  return {
    sub_topic_id: parsed.sub_topic_id.trim(),
    sub_topic_name: parsed.sub_topic_name.trim(),
    confidence:
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? parsed.confidence
        : 0,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

export function resolveSubTopicChoice(
  result: ClassifyQuestionSubTopicResult,
  subTopics: SubTopicOption[],
): SubTopicOption {
  const byId = subTopics.find((subTopic) => subTopic.id === result.sub_topic_id);
  if (byId) return byId;

  const targetName = result.sub_topic_name.toLowerCase();
  const byName = subTopics.find((subTopic) => subTopic.name.toLowerCase() === targetName);
  if (byName) return byName;

  throw new Error(
    `Ollama chose "${result.sub_topic_name}" (${result.sub_topic_id}), which is not in the available sub-topics.`,
  );
}

export async function classifyQuestionSubTopic(
  input: ClassifyQuestionSubTopicInput,
  options?: { model?: string; baseUrl?: string },
): Promise<ClassifyQuestionSubTopicResult> {
  if (input.subTopics.length === 0) {
    throw new Error("No sub-topics were provided for classification.");
  }

  try {
    const raw = await callOllamaJson(buildPrompt(input), options);
    const parsed = parseClassificationResult(raw);
    resolveSubTopicChoice(parsed, input.subTopics);
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`Failed to classify question sub-topic: ${message}`);
  }
}
