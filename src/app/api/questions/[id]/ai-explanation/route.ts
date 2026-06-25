import { NextResponse } from "next/server";
import { generateQuestionExplanationForQuestion } from "@/lib/generate-question-explanation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await generateQuestionExplanationForQuestion(id);

    return NextResponse.json({
      success: true,
      questionId: result.questionId,
      explanation: result.explanation,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate AI explanation.";

    const status = message === "Question not found." ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
