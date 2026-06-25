import {
  ensureOpenAiPastPaperFile,
  requirePastPaperPdf,
} from "@/lib/past-papers";
import { assignQuestionNumber } from "@/lib/assign-question-number";
import {
  getQuestionsForPaper,
  updateQuestionNumber,
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
      questionId: string;
      status: "processing" | "done" | "skipped" | "error";
      questionNumber?: string;
      message?: string;
    }
  | {
      type: "complete";
      assigned: number;
      skipped: number;
      failed: number;
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

function hasQuestionNumber(question: Question): boolean {
  return Boolean(question.questionNumber?.trim());
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
  try {
    const loadedSubject = await getSubjectById(id);
    if (!loadedSubject?.grade) {
      return new Response(JSON.stringify({ error: "Subject not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    subject = loadedSubject;
    await requirePastPaperPdf(id, parsed.term, parsed.year);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Past paper PDF is required.";

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

        const pastPaper = await requirePastPaperPdf(id, parsed.term, parsed.year);
        const openAiFileId = await ensureOpenAiPastPaperFile(pastPaper);

        const toProcess = questions.filter((question) => force || !hasQuestionNumber(question));
        const skippedInitial = questions.length - toProcess.length;

        send({
          type: "start",
          total: questions.length,
          toProcess: toProcess.length,
          skipped: skippedInitial,
        });

        if (toProcess.length === 0) {
          send({
            type: "complete",
            assigned: 0,
            skipped: skippedInitial,
            failed: 0,
          });
          controller.close();
          return;
        }

        let assigned = 0;
        let failed = 0;

        for (let index = 0; index < toProcess.length; index += 1) {
          const question = toProcess[index];

          send({
            type: "progress",
            current: index + 1,
            total: toProcess.length,
            questionId: question.id,
            status: "processing",
          });

          try {
            const result = await assignQuestionNumber({
              subject: subjectName,
              year: parsed.year,
              term: parsed.term,
              openAiFileId,
              context: question.context ?? "",
              question: question.question ?? "",
              options: question.options,
            });

            await updateQuestionNumber(question.id, result.question_number);
            assigned += 1;

            send({
              type: "progress",
              current: index + 1,
              total: toProcess.length,
              questionId: question.id,
              status: "done",
              questionNumber: result.question_number,
            });
          } catch (error) {
            failed += 1;
            const message =
              error instanceof Error ? error.message : "Failed to assign question number.";

            send({
              type: "progress",
              current: index + 1,
              total: toProcess.length,
              questionId: question.id,
              status: "error",
              message,
            });
          }
        }

        send({
          type: "complete",
          assigned,
          skipped: skippedInitial,
          failed,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to assign question numbers.";

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
