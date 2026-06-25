import { NextResponse } from "next/server";
import { generateTopicsForSubject } from "@/lib/generate-topics";

export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await generateTopicsForSubject(id);

    return NextResponse.json({
      success: true,
      questionCount: result.questionCount,
      topicCount: result.topicCount,
      jsonFilePath: result.jsonFilePath,
      source: result.source,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate topics.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
