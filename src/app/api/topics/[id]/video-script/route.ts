import { NextResponse } from "next/server";
import { generateVideoScriptForTopic } from "@/lib/generate-video-script";

export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await generateVideoScriptForTopic(id);

    return NextResponse.json({
      success: true,
      questionCount: result.questionCount,
      script: result.script,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate video script.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
