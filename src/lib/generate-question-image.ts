const OPENAI_API_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-1";
const FALLBACK_MODELS = ["gpt-image-1", "gpt-image-1-mini"] as const;
const DEFAULT_SIZE = "1024x1024";
const DEFAULT_QUALITY = "low";

export interface QuestionImageInput {
  subject: string;
  grade?: number;
  topic?: string;
  subTopic?: string;
  context?: string;
  question: string;
  options?: unknown;
  answer?: string;
  term?: number;
  year?: number;
}

function getOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  return apiKey;
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

export function buildQuestionImagePrompt(input: QuestionImageInput): string {
  const questionDetails = {
    subject: input.subject,
    grade: input.grade,
    topic: input.topic ?? "",
    subTopic: input.subTopic ?? "",
    context: input.context ?? "",
    question: input.question,
    options: normalizeOptions(input.options),
    answer: input.answer ?? "",
    term: input.term,
    year: input.year,
  };

  return `Create a clear educational exam-style image for a South African matric ${input.subject} question.

This image is part of the question context. Without it, the question is incomplete and cannot be answered by the learner. Generate the visual information the question assumes is present — such as diagrams, tables, maps, charts, figures, graphs, or labeled illustrations referenced in the context or question text.

The image must provide everything a learner needs from the missing visual so they can understand and answer the question on their own. Keep any text large and readable. Do not show the correct answer or a worked solution.

Question details:
${JSON.stringify(questionDetails, null, 2)}`;
}

function formatOpenAiError(operation: string, status: number, errorBody: string): string {
  try {
    const parsed = JSON.parse(errorBody) as {
      error?: { message?: string; code?: string };
    };
    const message = parsed.error?.message;
    if (message) {
      if (status === 403 && message.includes("does not have access to model")) {
        return (
          `OpenAI ${operation} failed (${status}): ${message}. ` +
          "Your API project may need organization verification for that model, or you can set " +
          "OPENAI_IMAGE_MODEL=gpt-image-1 in .env.local (or pass --model gpt-image-1)."
        );
      }
      return `OpenAI ${operation} failed (${status}): ${message}`;
    }
  } catch {
    // Fall through to the raw error body.
  }

  return `OpenAI ${operation} failed (${status}): ${errorBody}`;
}

function getModelCandidates(requestedModel?: string): string[] {
  const preferred = requestedModel ?? process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_MODEL;
  const candidates = [preferred, ...FALLBACK_MODELS];
  return [...new Set(candidates)];
}

function isModelAccessError(status: number, errorBody: string): boolean {
  return status === 403 && errorBody.includes("does not have access to model");
}

async function requestGeneratedImage(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${OPENAI_API_BASE}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function generateImageFromPrompt(
  prompt: string,
  options?: {
    model?: string;
    size?: string;
    quality?: string;
  },
): Promise<Buffer> {
  const apiKey = getOpenAiApiKey();
  const size = options?.size ?? process.env.OPENAI_IMAGE_SIZE ?? DEFAULT_SIZE;
  const quality = options?.quality ?? process.env.OPENAI_IMAGE_QUALITY ?? DEFAULT_QUALITY;
  const models = getModelCandidates(options?.model);

  let lastErrorBody = "";
  let lastStatus = 500;
  const inaccessibleModels: string[] = [];

  for (const model of models) {
    const response = await requestGeneratedImage(apiKey, {
      model,
      prompt,
      size,
      quality,
      n: 1,
    });

    if (response.ok) {
      if (model !== models[0]) {
        console.warn(`Image model "${models[0]}" unavailable; used "${model}" instead.`);
      }

      const payload = (await response.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };

      const imageData = payload.data?.[0];
      if (!imageData) {
        throw new Error("OpenAI image generation returned no image data.");
      }

      if (imageData.b64_json) {
        return Buffer.from(imageData.b64_json, "base64");
      }

      if (imageData.url) {
        const imageResponse = await fetch(imageData.url);
        if (!imageResponse.ok) {
          throw new Error(`Failed to download generated image (${imageResponse.status}).`);
        }
        const arrayBuffer = await imageResponse.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }

      throw new Error("OpenAI image generation returned no b64_json or url.");
    }

    lastStatus = response.status;
    lastErrorBody = await response.text();

    if (isModelAccessError(lastStatus, lastErrorBody)) {
      inaccessibleModels.push(model);
      continue;
    }

    throw new Error(formatOpenAiError("image generation", lastStatus, lastErrorBody));
  }

  if (inaccessibleModels.length > 0) {
    throw new Error(
      `OpenAI image generation failed (${lastStatus}): no access to ` +
        `${inaccessibleModels.join(", ")}. Your API project may need organization verification ` +
        "for image models. Check https://platform.openai.com/settings/organization/general " +
        "or use an API key from a project with gpt-image-1 enabled.",
    );
  }

  throw new Error(formatOpenAiError("image generation", lastStatus, lastErrorBody));
}

export async function generateQuestionImage(
  input: QuestionImageInput,
  options?: {
    model?: string;
    size?: string;
    quality?: string;
  },
): Promise<Buffer> {
  return generateImageFromPrompt(buildQuestionImagePrompt(input), options);
}
