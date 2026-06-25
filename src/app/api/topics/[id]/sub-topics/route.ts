import { NextResponse } from "next/server";
import { generateSubTopicsForTopic } from "@/lib/generate-sub-topics";

export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await generateSubTopicsForTopic(id);

    return NextResponse.json({
      success: true,
      subTopicCount: result.subTopicCount,
      questionCount: result.questionCount,
      subTopics: result.subTopics,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate sub-topics.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
