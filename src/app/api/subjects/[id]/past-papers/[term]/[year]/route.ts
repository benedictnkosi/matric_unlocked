import { NextResponse } from "next/server";
import {
  buildPastPaperId,
  getPastPaperByKey,
  getPastPaperPdfUrl,
  mapPastPaperImages,
  savePastPaperFailure,
  savePastPaperProcessing,
  savePastPaperUpload,
  uploadPastPaperPdf,
} from "@/lib/past-papers";
import { getSubjectById, getSubjectLabel } from "@/lib/subjects";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; term: string; year: string }>;
}

const MAX_PDF_BYTES = 50 * 1024 * 1024;

function parsePaperParams(termParam: string, yearParam: string) {
  const term = Number(termParam);
  const year = Number(yearParam);

  if (!Number.isFinite(term) || !Number.isFinite(year)) {
    return null;
  }

  return { term, year };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id, term: termParam, year: yearParam } = await context.params;
    const parsed = parsePaperParams(termParam, yearParam);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid term or year." }, { status: 400 });
    }

    const subject = await getSubjectById(id);
    if (!subject) {
      return NextResponse.json({ error: "Subject not found." }, { status: 404 });
    }

    const pastPaper = await getPastPaperByKey(id, parsed.term, parsed.year);
    if (!pastPaper) {
      return NextResponse.json({ pastPaper: null });
    }

    return NextResponse.json({
      pastPaper: {
        ...pastPaper,
        pdfUrl: getPastPaperPdfUrl(pastPaper.pdfPath),
        images: mapPastPaperImages(pastPaper.images),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load past paper.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id, term: termParam, year: yearParam } = await context.params;
  const parsed = parsePaperParams(termParam, yearParam);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid term or year." }, { status: 400 });
  }

  const subject = await getSubjectById(id);
  if (!subject?.grade) {
    return NextResponse.json({ error: "Subject not found." }, { status: 404 });
  }

  const paperId = buildPastPaperId(id, parsed.term, parsed.year);
  const subjectName = getSubjectLabel(subject);

  try {
    const formData = await request.formData();
    const file = formData.get("pdf");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A PDF file is required." }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
    }

    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "PDF must be 50 MB or smaller." }, { status: 400 });
    }

    await savePastPaperProcessing({
      id: paperId,
      subjectId: id,
      subjectName,
      grade: subject.grade,
      term: parsed.term,
      year: parsed.year,
      ocrStatus: "processing",
    });

    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    const pdfPath = await uploadPastPaperPdf(paperId, pdfBuffer);

    await savePastPaperUpload(paperId, {
      pdfPath,
      subjectId: id,
      subjectName,
      grade: subject.grade,
      term: parsed.term,
      year: parsed.year,
    });

    return NextResponse.json({
      success: true,
      pastPaper: {
        id: paperId,
        pdfPath,
        pdfUrl: getPastPaperPdfUrl(pdfPath),
        images: mapPastPaperImages((await getPastPaperByKey(id, parsed.term, parsed.year))?.images),
        ocrStatus: "done",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload past paper PDF.";

    await savePastPaperFailure(paperId, message, {
      id: paperId,
      subjectId: id,
      subjectName,
      grade: subject.grade,
      term: parsed.term,
      year: parsed.year,
    }).catch(() => undefined);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
