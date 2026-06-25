import { NextResponse } from "next/server";
import { clearQuestionImagesForPaper } from "@/lib/questions";
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

export async function POST(_request: Request, context: RouteContext) {
  const { id, term: termParam, year: yearParam } = await context.params;
  const parsed = parsePaperParams(termParam, yearParam);

  if (!parsed) {
    return NextResponse.json({ error: "Invalid term or year." }, { status: 400 });
  }

  try {
    const subject = await getSubjectById(id);
    if (!subject?.grade) {
      return NextResponse.json({ error: "Subject not found." }, { status: 404 });
    }

    const clearedCount = await clearQuestionImagesForPaper(
      getSubjectLabel(subject),
      subject.grade,
      parsed.term,
      parsed.year,
    );

    return NextResponse.json({
      success: true,
      clearedCount,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to remove question images.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
