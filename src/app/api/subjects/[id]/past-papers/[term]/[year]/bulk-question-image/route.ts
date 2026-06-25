import { NextResponse } from "next/server";
import {
  bulkAssignQuestionImagePath,
  isAssignableQuestionImagePath,
} from "@/lib/questions";
import { getSubjectById, getSubjectLabel } from "@/lib/subjects";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; term: string; year: string }>;
}

function parsePaperParams(termParam: string, yearParam: string) {
  const term = Number(termParam);
  const year = Number(yearParam);

  if (!Number.isFinite(term) || !Number.isFinite(year)) {
    return null;
  }

  return { term, year };
}

export async function POST(request: Request, context: RouteContext) {
  const { id, term: termParam, year: yearParam } = await context.params;
  const parsed = parsePaperParams(termParam, yearParam);

  if (!parsed) {
    return NextResponse.json({ error: "Invalid term or year." }, { status: 400 });
  }

  let body: { questionIds?: unknown; imagePath?: unknown; force?: unknown };
  try {
    body = (await request.json()) as {
      questionIds?: unknown;
      imagePath?: unknown;
      force?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!Array.isArray(body.questionIds) || body.questionIds.length === 0) {
    return NextResponse.json(
      { error: "questionIds must be a non-empty array." },
      { status: 400 },
    );
  }

  if (typeof body.imagePath !== "string" || !body.imagePath.trim()) {
    return NextResponse.json({ error: "imagePath must be a non-empty string." }, { status: 400 });
  }

  const imagePath = body.imagePath.trim();
  if (!isAssignableQuestionImagePath(imagePath)) {
    return NextResponse.json(
      { error: "imagePath must be a Firebase Storage path or HTTPS URL." },
      { status: 400 },
    );
  }

  const questionIds = body.questionIds
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  if (questionIds.length === 0) {
    return NextResponse.json(
      { error: "questionIds must contain at least one valid question id." },
      { status: 400 },
    );
  }

  try {
    const subject = await getSubjectById(id);
    if (!subject?.grade) {
      return NextResponse.json({ error: "Subject not found." }, { status: 404 });
    }

    const { updatedCount, skippedCount } = await bulkAssignQuestionImagePath(
      getSubjectLabel(subject),
      subject.grade,
      parsed.term,
      parsed.year,
      questionIds,
      imagePath,
      { force: body.force === true },
    );

    return NextResponse.json({
      success: true,
      updatedCount,
      skippedCount,
      imagePath,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to assign image to questions.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
