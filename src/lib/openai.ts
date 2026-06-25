const OPENAI_API_BASE = "https://api.openai.com/v1";

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
      error?: { message?: string; code?: string };
    };
    const message = parsed.error?.message;
    const code = parsed.error?.code;

    if (status === 401 && code === "missing_scope") {
      return (
        "Your OpenAI API key is missing required permissions. " +
        "Use a standard API key, or edit your restricted key at " +
        "https://platform.openai.com/api-keys and enable the " +
        "\"Model capabilities\" / model.request scope."
      );
    }

    if (message) {
      return `OpenAI ${operation} failed (${status}): ${message}`;
    }
  } catch {
    // Fall through to the raw error body.
  }

  return `OpenAI ${operation} failed (${status}): ${errorBody}`;
}

export interface GeneratedTopic {
  name: string;
  description: string;
}

function buildTopicExtractionPrompt(
  subjectName: string,
  examLabel: string,
  questionsText: string,
): string {
  return `Analyse the exam questions below for ${subjectName} (${examLabel}).

Identify the top 10 topics covered by these questions.

For each topic provide:
- name: A concise topic title
- description: What the student must know and be able to do for the exam on this topic

Return valid JSON in this exact shape:
{
  "topics": [
    { "name": "Topic name", "description": "What students must know..." }
  ]
}

Return exactly 10 topics, ordered from most to least important.

${questionsText}`;
}

export async function extractTopicsFromQuestions(
  subjectName: string,
  examLabel: string,
  questionsText: string,
): Promise<GeneratedTopic[]> {
  const apiKey = getOpenAiApiKey();

  const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an expert South African matric curriculum analyst. Analyze exam questions and identify the most important topics students must master for their exams.",
        },
        {
          role: "user",
          content: buildTopicExtractionPrompt(subjectName, examLabel, questionsText),
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
  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  const parsed = JSON.parse(content) as { topics?: GeneratedTopic[] };
  if (!Array.isArray(parsed.topics) || parsed.topics.length === 0) {
    throw new Error("OpenAI response did not include any topics.");
  }

  return parsed.topics
    .filter((topic) => topic.name?.trim() && topic.description?.trim())
    .slice(0, 10)
    .map((topic) => ({
      name: topic.name.trim(),
      description: topic.description.trim(),
    }));
}

function buildSubTopicExtractionPrompt(
  parentTopicName: string,
  parentTopicDescription: string,
  questionsJson: string,
): string {
  return `A broad exam topic is too large for a single 400-word video script and needs to be split into smaller sub-topics.

Parent topic: ${parentTopicName}

Parent topic description:
${parentTopicDescription}

Below is JSON containing exam questions that belong to this parent topic. Analyse them and decide how many sub-topics are needed to cover as many of these questions as possible.

Each sub-topic must:
- Be focused enough for a single ~400-word explainer video
- Have a clear, concise name
- Include a description of what the student must know and be able to do
- Cover a distinct slice of the parent topic

Decide the number of sub-topics based on the breadth and depth of the questions. Use as many sub-topics as needed to cover the material well, but no more than necessary. Prefer fewer, well-scoped sub-topics over many overlapping ones.

Return valid JSON in this exact shape:
{
  "subTopics": [
    {
      "name": "Sub-topic name",
      "description": "What students must know...",
      "questionCount": 12
    }
  ]
}

Order sub-topics from most to least important.
For questionCount, estimate how many questions from the JSON each sub-topic covers.

Questions JSON:
${questionsJson}`;
}

export async function extractSubTopicsFromQuestions(
  parentTopicName: string,
  parentTopicDescription: string,
  questionsJson: string,
): Promise<Array<GeneratedTopic & { questionCount?: number }>> {
  const content = await callOpenAiChat(
    [
      {
        role: "system",
        content:
          "You are an expert South African matric curriculum analyst. Split broad exam topics into focused sub-topics suitable for short explainer videos.",
      },
      {
        role: "user",
        content: buildSubTopicExtractionPrompt(
          parentTopicName,
          parentTopicDescription,
          questionsJson,
        ),
      },
    ],
    { json: true },
  );

  const parsed = JSON.parse(content) as {
    subTopics?: Array<GeneratedTopic & { questionCount?: number }>;
  };

  if (!Array.isArray(parsed.subTopics) || parsed.subTopics.length === 0) {
    throw new Error("OpenAI response did not include any sub-topics.");
  }

  return parsed.subTopics
    .filter((topic) => topic.name?.trim() && topic.description?.trim())
    .map((topic) => ({
      name: topic.name.trim(),
      description: topic.description.trim(),
      ...(typeof topic.questionCount === "number" && topic.questionCount > 0
        ? { questionCount: topic.questionCount }
        : {}),
    }));
}

const MAX_PROMPT_CHARS = 350_000;

interface PromptQuestion {
  context?: string;
  question?: string;
  options?: unknown;
  answer?: string;
  term?: number;
}

function formatQuestionBlock(question: PromptQuestion, index: number): string {
  const lines = [
    `Question ${index + 1} (term ${question.term ?? "unknown"}):`,
    question.context ? `Context: ${question.context}` : null,
    question.question,
    question.options != null ? `Options: ${JSON.stringify(question.options)}` : null,
    question.answer ? `Answer: ${question.answer}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

export function prepareQuestionsForPrompt(questions: PromptQuestion[]): string {
  let selected = questions;
  let text = selected.map(formatQuestionBlock).join("\n\n---\n\n");

  while (selected.length > 20 && text.length > MAX_PROMPT_CHARS) {
    selected = selected.slice(0, Math.floor(selected.length * 0.85));
    text = selected.map(formatQuestionBlock).join("\n\n---\n\n");
  }

  if (selected.length < questions.length) {
    text =
      `Analysing ${selected.length} of ${questions.length} questions due to size limits.\n\n` +
      text;
  }

  return text;
}

export interface IdentifiedQuestion {
  question: string;
  context: string;
  options: unknown;
  answer: string;
}

async function callOpenAiChat(
  messages: Array<{ role: "system" | "user"; content: string }>,
  options?: { json?: boolean },
): Promise<string> {
  const apiKey = getOpenAiApiKey();

  const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      ...(options?.json ? { response_format: { type: "json_object" } } : {}),
      messages,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(formatOpenAiError("chat completion", response.status, errorBody));
  }

  const data = (await response.json()) as {
    choices: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  return content;
}

export function prepareQuestionsJsonForTopicMatching(questions: PromptQuestion[]): string {
  let selected = questions;
  let json = JSON.stringify({ questions: selected });

  while (selected.length > 20 && json.length > MAX_PROMPT_CHARS) {
    selected = selected.slice(0, Math.floor(selected.length * 0.85));
    json = JSON.stringify({
      questions: selected,
      sampled: true,
      originalQuestionCount: questions.length,
      analyzedQuestionCount: selected.length,
    });
  }

  return json;
}

export async function identifyQuestionsForTopic(
  questionsJson: string,
  topicName: string,
  topicDescription: string,
): Promise<IdentifiedQuestion[]> {
  const content = await callOpenAiChat(
    [
      {
        role: "system",
        content:
          "You are an expert South African matric examiner. Match exam questions to syllabus topics accurately.",
      },
      {
        role: "user",
        content: `Topic: ${topicName}

Topic description:
${topicDescription}

Below is JSON containing exam questions. Identify the questions that directly test this topic.

Return valid JSON in this exact shape:
{
  "questions": [
    {
      "question": "...",
      "context": "...",
      "options": ...,
      "answer": "..."
    }
  ]
}

For each matched question, return the exact question, context, options, and answer from the source JSON.
Only include clear matches. If none match, return { "questions": [] }.

Questions JSON:
${questionsJson}`,
      },
    ],
    { json: true },
  );

  const parsed = JSON.parse(content) as { questions?: IdentifiedQuestion[] };
  if (!Array.isArray(parsed.questions)) {
    throw new Error("OpenAI response did not include matched questions.");
  }

  return parsed.questions
    .filter(
      (item) =>
        item.question?.trim() &&
        item.context != null &&
        item.options != null &&
        item.answer?.trim(),
    )
    .map((item) => ({
      question: item.question.trim(),
      context: String(item.context),
      options: item.options,
      answer: item.answer.trim(),
    }));
}

function formatIdentifiedQuestionsForPrompt(questions: IdentifiedQuestion[]): string {
  return questions
    .map((item, index) => {
      const lines = [
        `Question ${index + 1}:`,
        item.context ? `Context: ${item.context}` : null,
        item.question,
        `Options: ${JSON.stringify(item.options)}`,
        `Answer: ${item.answer}`,
      ].filter((line): line is string => Boolean(line));

      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

function buildScriptOptimizationPrompt(
  topicName: string,
  subjectName: string,
  topicDescription: string,
  examLabel: string,
  rawScript: string,
): string {
  return `Act as an expert educational video scriptwriter. Your goal is to optimize the provided study script for a high-energy, engaging, and concise video.

You must strictly follow these formatting and content rules:

1. RULE 1: THE OPENING. Choose an opening that fits the topic and content. Avoid generic introductions like "Hey guys, welcome back to my channel" or "Today we are looking at..." unless they genuinely work for the script.

2. RULE 2: LENGTH & PACING. Choose a script length that fits the topic — as long as needed to cover the exam content well, and as short as possible without leaving out important material. Do not pad to hit a target word count, and do not cut essential explanations just to stay brief.

3. RULE 3: SPEAKING FLOW. Write numbers, percentages, and formulas out clearly so they are natural to read aloud (e.g., use "79 minus 7" or "a ratio of 1 to 10" instead of just raw symbols).

4. RULE 4: GENERAL CONTEXT. Keep the language universally understood. Avoid hyper-local slang, specific region-locked cultural references, or niche TV shows unless explicitly asked. Use globally recognized analogies if explaining a concept.

5. RULE 5: MID-VIDEO MICRO-CTA. Don't wait until the end to ask for engagement. At roughly the halfway point of the script, insert a quick micro-call-to-action that the whiteboard animation can sketch on screen: "Does this make sense so far? Like and share this video to help other students!" Keep it brief and natural so it doesn't break the flow, then immediately continue with the content.

6. STRUCTURE:
- An opening that fits the topic.
- Punchy breakdown of the core exam concepts using bullet points/numbered lists for flow.
- A clear step-by-step example if there is a calculation.
- A mid-video micro-CTA at roughly the halfway point: "Does this make sense so far? Like and share this video to help other students!"
- A rapid-fire recap at the end to lock in the information.
- Do not end with a subscribe/like call-to-action. End on the recap or a final exam-focused takeaway.

Topic: ${topicName}
Subject/Paper: ${subjectName}
Exam period: ${examLabel}
Topic focus: ${topicDescription}

Here is the raw script to fix:

${rawScript}`;
}

const SCRIPT_CTA_ENDING =
  "Subscribe and like this video now to help us create more videos for you";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureScriptEnding(script: string): string {
  let trimmed = script.trim();

  // Strip any trailing subscribe/like CTA the model may still add
  // (case-insensitive, ignoring surrounding markdown/punctuation).
  const trailingCtaPattern = new RegExp(
    `[\\s*_>#-]*${escapeRegExp(SCRIPT_CTA_ENDING)}[\\s!.*_]*$`,
    "i",
  );

  while (trailingCtaPattern.test(trimmed)) {
    trimmed = trimmed.replace(trailingCtaPattern, "").trim();
  }

  return trimmed;
}

async function generateRawExplainerVideoScript(
  topicName: string,
  topicDescription: string,
  examLabel: string,
  questions: IdentifiedQuestion[],
): Promise<string> {
  return callOpenAiChat([
    {
      role: "system",
      content:
        "You write sharp, exam-focused South African matric study video scripts. Be direct, factual, and efficient.",
    },
    {
      role: "user",
      content: `Topic: ${topicName}

Topic description:
${topicDescription}

Exam period: ${examLabel}

Using the matched exam questions below as evidence of what gets tested, write a draft explainer video script to help a matric student pass this topic in the upcoming exam.

Requirements:
- Include as many exam-useful facts, definitions, methods, steps, and common pitfalls as possible
- Be direct and exam-focused. Cut fluff, filler, and motivational padding
- Do not be overly friendly or nice
- Write as a spoken video script the student can follow while studying
- Cover all key concepts from the matched questions
- Choose a length that fits the material — long enough to teach it properly, without unnecessary padding
- Open the script in whatever way best suits the topic and matched questions

Matched exam questions:
${formatIdentifiedQuestionsForPrompt(questions)}

Return only the draft script text.`,
    },
  ]);
}

async function optimizeExplainerVideoScript(
  topicName: string,
  subjectName: string,
  topicDescription: string,
  examLabel: string,
  rawScript: string,
): Promise<string> {
  return callOpenAiChat([
    {
      role: "system",
      content:
        "You are an expert educational video scriptwriter who produces high-energy, exam-focused study scripts.",
    },
    {
      role: "user",
      content: buildScriptOptimizationPrompt(
        topicName,
        subjectName,
        topicDescription,
        examLabel,
        rawScript,
      ),
    },
  ]);
}

export async function generateExplainerVideoScript(
  topicName: string,
  subjectName: string,
  topicDescription: string,
  examLabel: string,
  questions: IdentifiedQuestion[],
): Promise<string> {
  const rawScript = await generateRawExplainerVideoScript(
    topicName,
    topicDescription,
    examLabel,
    questions,
  );

  return ensureScriptEnding(
    await optimizeExplainerVideoScript(
      topicName,
      subjectName,
      topicDescription,
      examLabel,
      rawScript,
    ),
  );
}

export interface GenerateQuestionExplanationInput {
  subject: string;
  context: string;
  question: string;
  options?: unknown;
  answer: string;
  topic?: string;
}

function normalizeOptionsForExplanation(options: unknown): string[] {
  if (options == null) return [];

  if (typeof options === "string") {
    try {
      const parsed = JSON.parse(options) as unknown;
      return normalizeOptionsForExplanation(parsed);
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

function buildQuestionExplanationPrompt(input: GenerateQuestionExplanationInput): string {
  const options = normalizeOptionsForExplanation(input.options);
  const lines = [
    `Subject: ${input.subject}`,
    input.topic?.trim() ? `Topic: ${input.topic.trim()}` : null,
    input.context.trim() ? `Context: ${input.context.trim()}` : null,
    `Question: ${input.question.trim()}`,
    options.length > 0 ? `Options: ${options.join(" | ")}` : null,
    `Correct answer: ${input.answer.trim()}`,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

export async function generateQuestionExplanation(
  input: GenerateQuestionExplanationInput,
): Promise<string> {
  if (!input.question.trim()) {
    throw new Error("Question text is required.");
  }
  if (!input.answer.trim()) {
    throw new Error("Answer is required.");
  }

  return callOpenAiChat([
    {
      role: "system",
      content:
        "You are an expert South African matric tutor. Write clear, exam-focused explanations that help students understand why the correct answer is right and how to approach similar questions. Always follow the exact markdown format specified in the user message.",
    },
    {
      role: "user",
      content: `Write a study explanation for the exam question below.

You MUST follow this exact markdown format and use these special characters:

# Understanding [Concept Name]

## [First sub-section heading]
- **Definition:** ...
- **Purpose:** ...

## [Second sub-section heading — e.g. why the answer is correct, key points, or advantages]
1. **Point heading:**
   - Supporting detail.
   - Another supporting detail.
   - Example: ...

2. **Point heading:**
   - Supporting detail.
   - Another supporting detail.

(Add more numbered points as needed for the question.)

## Conclusion
- Summarise the key takeaway and why the correct answer is right.

***Key Lesson:*** One memorable takeaway sentence! 📈✨

Length:
- Aim for 250–400 words in total — thorough enough to teach the concept, but concise enough to read in under 2 minutes
- Use 2–3 ## sections (including Conclusion)
- Include 3–5 numbered points in the main body section for most questions; use fewer (2–3) for simple recall questions and more (up to 6) only when the concept genuinely needs it
- Write 2–3 supporting bullets under each numbered point; add an Example bullet where it helps
- Keep the Conclusion to 1–2 bullets
- Keep ***Key Lesson:*** to a single short sentence
- Do not pad with filler, repetition, or extra sections just to hit a word count

Formatting rules:
- Use # for the main title (one only), ## for section headings
- Use - for bullet points and 1. 2. 3. for numbered lists
- Use **bold** for labels like **Definition:**, **Purpose:**, and numbered point headings
- Indent nested bullets with three spaces under numbered items
- End with exactly one ***Key Lesson:*** line (three asterisks on each side) followed by a relevant emoji
- Teach the underlying concept, not just restate the answer
- Explain why the correct answer is correct
- Briefly note why other options are wrong when options are provided
- Keep the tone direct, helpful, and exam-focused
- Do not mention that you are an AI

Example structure (adapt headings and content to the question):

# Understanding Diversification Strategies

## What is Diversification?
- **Definition:** Diversification is a business strategy that involves expanding into new markets or products to reduce risk and increase sales.
- **Purpose:** Companies often use this strategy to spread out their investments and resources, preventing reliance on a single product or market.

## Advantages of Diversification Strategies
1. **Increases Sales:**
   - By entering new markets or offering new products, companies can attract different customer segments.
   - More products mean more opportunities to sell, which directly boosts sales revenue.
   - Example: A clothing brand that starts selling accessories or shoes can cater to more customers.

2. **Reduces Risk:**
   - Diversification helps mitigate risks. If one sector of the market experiences a downturn, other sectors can still provide revenue.
   - Rather than facing a total loss, companies can balance their income streams from various products or markets.

## Conclusion
- The primary advantage of diversification strategies is the significant increase in sales potential.

***Key Lesson:*** Diversification can boost sales significantly by reaching new customers! 📈✨

Question to explain:

${buildQuestionExplanationPrompt(input)}

Return only the explanation markdown.`,
    },
  ]);
}
