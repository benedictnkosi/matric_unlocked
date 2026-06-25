import Link from "next/link";
import { notFound } from "next/navigation";
import { AssignQuestionImagesButton } from "@/components/assign-question-images-button";
import { AssignQuestionNumbersButton } from "@/components/assign-question-numbers-button";
import { BulkQuestionImageAssign } from "@/components/bulk-question-image-assign";
import { ClearPaperImagesButton } from "@/components/clear-paper-images-button";
import { DeleteQuestionButton } from "@/components/delete-question-button";
import { MarkPaperReadyButton } from "@/components/mark-paper-ready-button";
import { PastPaperSection } from "@/components/past-paper-section";
import { QuestionImageUpload } from "@/components/question-image-upload";
import { QuestionReadyToggle } from "@/components/question-ready-toggle";
import {
  getGradeLabel,
  getSubjectById,
  getSubjectLabel,
} from "@/lib/subjects";
import {
  formatQuestionOptions,
  getQuestionPaperLabel,
  getQuestionsForPaper,
  getTermLabel,
  hasAssignedQuestionImage,
  isQuestionReady,
} from "@/lib/questions";
import { getPastPaperByKey, hasPastPaperPdf } from "@/lib/past-papers";

export const dynamic = "force-dynamic";

interface QuestionPaperPageProps {
  params: Promise<{ id: string; term: string; year: string }>;
}

export default async function QuestionPaperPage({ params }: QuestionPaperPageProps) {
  const { id, term: termParam, year: yearParam } = await params;
  const term = Number(termParam);
  const year = Number(yearParam);

  if (!Number.isFinite(term) || !Number.isFinite(year)) notFound();

  let subject = null;
  let questions: Awaited<ReturnType<typeof getQuestionsForPaper>> = [];
  let pastPaper: Awaited<ReturnType<typeof getPastPaperByKey>> = null;
  let error: string | null = null;

  try {
    subject = await getSubjectById(id);
    if (subject?.grade != null) {
      [questions, pastPaper] = await Promise.all([
        getQuestionsForPaper(getSubjectLabel(subject), subject.grade, term, year),
        getPastPaperByKey(id, term, year),
      ]);
    }
  } catch (err) {
    error =
      err instanceof Error
        ? err.message
        : "Unable to load questions. Check your Firebase configuration.";
  }

  if (!error && !subject) notFound();

  const paperLabel = getQuestionPaperLabel({ term, year });
  const numberedCount = questions.filter((question) => question.questionNumber?.trim()).length;
  const hasPdf = hasPastPaperPdf(pastPaper);
  const imageCount = pastPaper?.images?.length ?? 0;
  const questionsWithImagesCount = questions.filter((question) =>
    hasAssignedQuestionImage(question.image_path),
  ).length;
  const readyCount = questions.filter((question) => isQuestionReady(question)).length;

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-50 to-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-6 py-5">
          <Link
            href={`/subjects/${id}/questions`}
            className="text-sm font-medium text-indigo-600 transition hover:text-indigo-700"
          >
            ← All papers
          </Link>
          <div className="mt-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-indigo-600">
                {subject ? getSubjectLabel(subject) : "Subject"}
                {subject?.grade != null ? ` · ${getGradeLabel(subject.grade)}` : ""}
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-900">{paperLabel}</h1>
              <p className="mt-1 text-sm text-slate-500">{getTermLabel(term)}</p>
            </div>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700">
              {readyCount}/{questions.length} ready
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <PastPaperSection subjectId={id} term={term} year={year} questionCount={questions.length} />

        <AssignQuestionNumbersButton
          subjectId={id}
          term={term}
          year={year}
          questionCount={questions.length}
          numberedCount={numberedCount}
        />

        <AssignQuestionImagesButton
          subjectId={id}
          term={term}
          year={year}
          hasPdf={hasPdf}
          imageCount={imageCount}
          numberedCount={numberedCount}
          questionsWithImagesCount={questionsWithImagesCount}
        />

        <ClearPaperImagesButton
          subjectId={id}
          term={term}
          year={year}
          questionsWithImagesCount={questionsWithImagesCount}
        />

        {!error && questions.length > 0 ? (
          <BulkQuestionImageAssign
            subjectId={id}
            term={term}
            year={year}
            questions={questions.map((question) => ({
              id: question.id,
              questionNumber: question.questionNumber,
              hasImage: hasAssignedQuestionImage(question.image_path),
            }))}
          />
        ) : null}

        <MarkPaperReadyButton
          subjectId={id}
          term={term}
          year={year}
          questionCount={questions.length}
          readyCount={readyCount}
        />

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-5 text-red-800">
            <p className="font-medium">Failed to load questions</p>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
        ) : questions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="text-lg font-medium text-slate-900">No questions in this paper</p>
            <p className="mt-2 text-sm text-slate-600">
              No questions were found for {paperLabel}.
            </p>
          </div>
        ) : (
          questions.map((question, index) => {
            const options = formatQuestionOptions(question.options);
            const questionLabel = `Question ${index + 1} image`;
            const displayLabel = question.questionNumber?.trim()
              ? `Question ${question.questionNumber}`
              : `Unnumbered question ${index + 1}`;

            return (
              <article
                key={question.id}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-indigo-600">{displayLabel}</p>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-400">{question.id}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <DeleteQuestionButton questionId={question.id} questionLabel={displayLabel} />
                    {question.topic ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {question.topic}
                      </span>
                    ) : null}
                  </div>
                </div>

                <dl className="mt-5 space-y-5">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Ready status
                    </dt>
                    <dd className="mt-2">
                      <QuestionReadyToggle
                        key={`${question.id}-${String(question.ready)}`}
                        questionId={question.id}
                        initialReady={isQuestionReady(question)}
                      />
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Context
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                      {question.context?.trim() ? question.context : "—"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Image path
                    </dt>
                    <QuestionImageUpload
                      questionId={question.id}
                      initialImagePath={question.image_path ?? ""}
                      questionLabel={questionLabel}
                    />
                  </div>

                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Question
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-900">
                      {question.question?.trim() ? question.question : "—"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Options
                    </dt>
                    <dd className="mt-2">
                      {options.length > 0 ? (
                        <ol className="space-y-2">
                          {options.map((option, optionIndex) => (
                            <li
                              key={`${question.id}-option-${optionIndex}`}
                              className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                            >
                              <span className="mr-2 font-medium text-slate-500">
                                {String.fromCharCode(65 + optionIndex)}.
                              </span>
                              {option}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-sm text-slate-500">—</p>
                      )}
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })
        )}
      </main>
    </div>
  );
}
