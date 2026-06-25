import {
  buildPastPaperImageDataUrl,
  downloadPastPaperImage,
  getPastPaperImageUrl,
  hasPastPaperImages,
  requirePastPaperPdf,
  requireValidOpenAiPastPaperFile,
  type PastPaper,
} from "@/lib/past-papers";
import {
  assignImageToQuestions,
  findQuestionsForQuestionNumbers,
} from "@/lib/assign-image-to-questions";
import {
  getQuestionsForPaper,
  hasUsableQuestionImage,
  updateQuestionImagePath,
  type Question,
} from "@/lib/questions";
import { getSubjectById, getSubjectLabel } from "@/lib/subjects";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; term: string; year: string }>;
}

type ProgressEvent =
  | {
      type: "start";
      total: number;
      toProcess: number;
      skipped: number;
    }
  | {
      type: "progress";
      current: number;
      total: number;
      imagePath: string;
      status: "processing" | "done" | "skipped" | "error";
      questionNumbers?: string[];
      matchedCount?: number;
      message?: string;
    }
  | {
      type: "complete";
      imagesProcessed: number;
      questionsUpdated: number;
      questionsSkipped: number;
      skipped: number;
      failed: number;
      errors?: Array<{ imagePath: string; message: string }>;
    }
  | {
      type: "error";
      message: string;
    };

function parsePaperParams(termParam: string, yearParam: string) {
  const term = Number(termParam);
  const year = Number(yearParam);

  if (!Number.isFinite(term) || !Number.isFinite(year)) {
    return null;
  }

  return { term, year };
}

function encodeEvent(event: ProgressEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function getKnownQuestionNumbers(questions: Question[]): string[] {
  return [
    ...new Set(
      questions
        .map((question) => question.questionNumber?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function validatePastPaperAssets(
  subjectId: string,
  term: number,
  year: number,
): Promise<PastPaper> {
  const pastPaper = await requirePastPaperPdf(subjectId, term, year);

  if (!hasPastPaperImages(pastPaper)) {
    throw new Error("Past paper images are required. Upload images first.");
  }

  return pastPaper;
}

export async function POST(request: Request, context: RouteContext) {
  const { id, term: termParam, year: yearParam } = await context.params;
  const parsed = parsePaperParams(termParam, yearParam);

  if (!parsed) {
    return new Response(JSON.stringify({ error: "Invalid term or year." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let force = false;
  try {
    const body = (await request.json()) as { force?: unknown };
    force = body.force === true;
  } catch {
    force = false;
  }

  let subject: NonNullable<Awaited<ReturnType<typeof getSubjectById>>>;
  let openAiPdfFileId: string;
  try {
    const loadedSubject = await getSubjectById(id);
    if (!loadedSubject?.grade) {
      return new Response(JSON.stringify({ error: "Subject not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    subject = loadedSubject;
    const pastPaper = await validatePastPaperAssets(id, parsed.term, parsed.year);
    openAiPdfFileId = await requireValidOpenAiPastPaperFile(pastPaper);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Past paper PDF and images are required.";

    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        controller.enqueue(encodeEvent(event));
      };

      try {
        const subjectName = getSubjectLabel(subject);
        const questions = await getQuestionsForPaper(
          subjectName,
          subject.grade!,
          parsed.term,
          parsed.year,
        );
        const pastPaper = await validatePastPaperAssets(id, parsed.term, parsed.year);
        const knownQuestionNumbers = getKnownQuestionNumbers(questions);
        const images = pastPaper.images ?? [];
        const toProcess = images;

        send({
          type: "start",
          total: images.length,
          toProcess: toProcess.length,
          skipped: 0,
        });

        if (toProcess.length === 0) {
          send({
            type: "complete",
            imagesProcessed: 0,
            questionsUpdated: 0,
            questionsSkipped: 0,
            skipped: 0,
            failed: 0,
          });
          controller.close();
          return;
        }

        if (knownQuestionNumbers.length === 0) {
          send({
            type: "error",
            message: "Assign question numbers before assigning images.",
          });
          controller.close();
          return;
        }

        let imagesProcessed = 0;
        let questionsUpdated = 0;
        let questionsSkipped = 0;
        let failed = 0;
        const errors: Array<{ imagePath: string; message: string }> = [];

        for (let index = 0; index < toProcess.length; index += 1) {
          const image = toProcess[index];
          const imageUrl = getPastPaperImageUrl(image.path);

          if (!imageUrl) {
            failed += 1;
            const message = "Could not resolve image URL.";
            errors.push({ imagePath: image.path, message });
            send({
              type: "progress",
              current: index + 1,
              total: toProcess.length,
              imagePath: image.path,
              status: "error",
              message,
            });
            continue;
          }

          send({
            type: "progress",
            current: index + 1,
            total: toProcess.length,
            imagePath: image.path,
            status: "processing",
          });

          try {
            const imageBuffer = await downloadPastPaperImage(image.path);
            const imageDataUrl = buildPastPaperImageDataUrl(imageBuffer, image.path);
            const result = await assignImageToQuestions({
              subject: subjectName,
              year: parsed.year,
              term: parsed.term,
              openAiPdfFileId,
              imageDataUrl,
              knownQuestionNumbers,
            });

            const matchedQuestions = findQuestionsForQuestionNumbers(
              questions,
              result.question_numbers,
            );
            const toUpdate = matchedQuestions.filter(
              (question) => force || !hasUsableQuestionImage(question.image_path),
            );
            questionsSkipped += matchedQuestions.length - toUpdate.length;

            for (const question of toUpdate) {
              await updateQuestionImagePath(question.id, imageUrl);
              questionsUpdated += 1;
            }

            imagesProcessed += 1;

            send({
              type: "progress",
              current: index + 1,
              total: toProcess.length,
              imagePath: image.path,
              status: "done",
              questionNumbers: result.question_numbers,
              matchedCount: matchedQuestions.length,
              message:
                matchedQuestions.length === 0
                  ? "No matching question numbers in database."
                  : toUpdate.length === 0
                    ? `Matched ${matchedQuestions.length} question${matchedQuestions.length === 1 ? "" : "s"} but all already have an image. Enable overwrite to replace.`
                    : undefined,
            });
          } catch (error) {
            failed += 1;
            const message =
              error instanceof Error ? error.message : "Failed to assign image to questions.";
            errors.push({ imagePath: image.path, message });

            send({
              type: "progress",
              current: index + 1,
              total: toProcess.length,
              imagePath: image.path,
              status: "error",
              message,
            });
          }
        }

        send({
          type: "complete",
          imagesProcessed,
          questionsUpdated,
          questionsSkipped,
          skipped: 0,
          failed,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to assign images to questions.";

        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
