import { NextResponse } from "next/server";
import { generateTopicsForSubject } from "@/lib/generate-topics";
import type { ExamPeriod } from "@/lib/topics";

export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isExamPeriod(value: unknown): value is ExamPeriod {
  return value === "june-exams" || value === "final-exams";
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { exam?: unknown };

    if (!isExamPeriod(body.exam)) {
      return NextResponse.json(
        { error: 'Invalid exam period. Use "june-exams" or "final-exams".' },
        { status: 400 },
      );
    }

    const result = await generateTopicsForSubject(id, body.exam);

    return NextResponse.json({
      success: true,
      questionCount: result.questionCount,
      topicCount: result.topicCount,
      exam: result.exam,
      jsonFilePath: result.jsonFilePath,
      source: result.source,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate topics.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
