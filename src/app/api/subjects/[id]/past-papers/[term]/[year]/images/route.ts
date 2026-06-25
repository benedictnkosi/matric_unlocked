import { NextResponse } from "next/server";
import {
  appendPastPaperImages,
  buildPastPaperId,
  deleteAllPastPaperImages,
  ensurePastPaperRecord,
  getPastPaperByKey,
  getPastPaperPdfUrl,
  mapPastPaperImages,
  uploadPastPaperImage,
} from "@/lib/past-papers";
import { getSubjectById, getSubjectLabel } from "@/lib/subjects";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; term: string; year: string }>;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES_PER_UPLOAD = 30;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function parsePaperParams(termParam: string, yearParam: string) {
  const term = Number(termParam);
  const year = Number(yearParam);

  if (!Number.isFinite(term) || !Number.isFinite(year)) {
    return null;
  }

  return { term, year };
}

function getExtension(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && ["png", "jpg", "jpeg", "webp", "gif"].includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }

  switch (file.type) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return `"${file.name}" is not a supported image type.`;
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return `"${file.name}" exceeds 10 MB.`;
  }

  return null;
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
    const files = formData
      .getAll("images")
      .filter((entry): entry is File => entry instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "At least one image is required." }, { status: 400 });
    }

    if (files.length > MAX_IMAGES_PER_UPLOAD) {
      return NextResponse.json(
        { error: `You can upload up to ${MAX_IMAGES_PER_UPLOAD} images at once.` },
        { status: 400 },
      );
    }

    for (const file of files) {
      const validationError = validateImageFile(file);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
    }

    await ensurePastPaperRecord(paperId, {
      subjectId: id,
      subjectName,
      grade: subject.grade,
      term: parsed.term,
      year: parsed.year,
    });

    const uploadedAt = new Date().toISOString();
    const uploadedImages = [];

    for (const [index, file] of files.entries()) {
      const extension = getExtension(file);
      const originalName = file.name.trim() || `image-${index + 1}.${extension}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const path = await uploadPastPaperImage(paperId, buffer, file.type, originalName);

      uploadedImages.push({
        path,
        uploadedAt,
        originalName,
      });
    }

    const images = await appendPastPaperImages(paperId, uploadedImages);
    const pastPaper = await getPastPaperByKey(id, parsed.term, parsed.year);

    return NextResponse.json({
      success: true,
      uploadedCount: uploadedImages.length,
      pastPaper: pastPaper
        ? {
            ...pastPaper,
            images: mapPastPaperImages(images),
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload past paper images.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id, term: termParam, year: yearParam } = await context.params;
  const parsed = parsePaperParams(termParam, yearParam);

  if (!parsed) {
    return NextResponse.json({ error: "Invalid term or year." }, { status: 400 });
  }

  const subject = await getSubjectById(id);
  if (!subject?.grade) {
    return NextResponse.json({ error: "Subject not found." }, { status: 404 });
  }

  try {
    const { deletedCount, pastPaper } = await deleteAllPastPaperImages(
      id,
      parsed.term,
      parsed.year,
    );

    return NextResponse.json({
      success: true,
      deletedCount,
      pastPaper: pastPaper
        ? {
            ...pastPaper,
            pdfUrl: getPastPaperPdfUrl(pastPaper.pdfPath),
            images: mapPastPaperImages(pastPaper.images),
          }
        : null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete past paper images.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
