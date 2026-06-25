import sharp from "sharp";
import { generateImageFromPrompt } from "./generate-question-image";
import { getTopicLabel, type Topic } from "./topics";

export const TOPIC_IMAGE_WIDTH = 560;
export const TOPIC_IMAGE_HEIGHT = 792;
export const TOPIC_IMAGE_API_SIZE = "1024x1536";
export const TOPIC_IMAGE_QUALITY = "low";
export const TOPIC_IMAGE_JPEG_QUALITY = 60;

export interface TopicImageInput {
  subject: string;
  grade: number;
  topic: Topic;
  parentTopicName?: string;
}

export function getTopicImageFilename(topicId: string): string {
  return `${topicId}.jpg`;
}

export function getTopicImagePublicPath(topicId: string): string {
  return `/topic-images/${getTopicImageFilename(topicId)}`;
}

export function buildTopicImagePrompt(input: TopicImageInput): string {
  const topicName = getTopicLabel(input.topic);
  const topicDetails = {
    subject: input.subject,
    grade: input.grade,
    topic: topicName,
    parentTopic: input.parentTopicName ?? "",
    description: input.topic.description ?? "",
    exam: input.topic.exam ?? "",
  };

  return `Create a vertical educational topic card illustration for a South African matric ${input.subject} study app.

The image is a portrait card cover (560 x 792 pixels) for this exam topic. It should visually represent the topic at a glance for Grade 12 learners preparing for their final exams.

Style:
- Clean, modern, educational illustration
- Bold visual metaphor or scene related to the topic
- Soft gradient or subtle background
- Purely visual — do not include any text, words, letters, numbers, labels, captions, titles, or typography of any kind
- No question text, no worked solutions, no exam answers
- Keep the composition vertical with clear focal subject matter

Topic details:
${JSON.stringify(topicDetails, null, 2)}`;
}

export async function resizeTopicImage(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize(TOPIC_IMAGE_WIDTH, TOPIC_IMAGE_HEIGHT, {
      fit: "cover",
      position: "centre",
    })
    .jpeg({
      quality: TOPIC_IMAGE_JPEG_QUALITY,
      mozjpeg: true,
    })
    .toBuffer();
}

export async function generateTopicImage(
  input: TopicImageInput,
  options?: {
    model?: string;
    quality?: string;
  },
): Promise<Buffer> {
  const prompt = buildTopicImagePrompt(input);
  const generated = await generateImageFromPrompt(prompt, {
    model: options?.model,
    size: TOPIC_IMAGE_API_SIZE,
    quality: options?.quality ?? TOPIC_IMAGE_QUALITY,
  });

  return resizeTopicImage(generated);
}
