import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getGradeLabel,
  getSubjectById,
  getSubjectLabel,
} from "@/lib/subjects";
import {
  countReadyQuestionsByPaper,
  getQuestionPaperCountKey,
  getQuestionPaperLabel,
  getQuestionPapersForSubject,
  getQuestionsForSubjectAndGrade,
} from "@/lib/questions";
import { getPastPapersForSubject } from "@/lib/past-papers";

export const dynamic = "force-dynamic";

interface SubjectQuestionsPageProps {
  params: Promise<{ id: string }>;
}

export default async function SubjectQuestionsPage({ params }: SubjectQuestionsPageProps) {
  const { id } = await params;
  let subject = null;
  let papers: Awaited<ReturnType<typeof getQuestionPapersForSubject>> = [];
  let readyCountsByPaper = new Map<string, number>();
  let pastPapers: Awaited<ReturnType<typeof getPastPapersForSubject>> = [];
  let error: string | null = null;

  try {
    subject = await getSubjectById(id);
    if (subject?.grade != null) {
      const subjectName = getSubjectLabel(subject);
      const [loadedPapers, loadedPastPapers, questions] = await Promise.all([
        getQuestionPapersForSubject(subjectName, subject.grade),
        getPastPapersForSubject(id),
        getQuestionsForSubjectAndGrade(subjectName, subject.grade),
      ]);
      papers = loadedPapers;
      pastPapers = loadedPastPapers;
      readyCountsByPaper = countReadyQuestionsByPaper(questions);
    }
  } catch (err) {
    error =
      err instanceof Error
        ? err.message
        : "Unable to load question papers. Check your Firebase configuration.";
  }

  if (!error && !subject) notFound();

  const totalQuestions = papers.reduce((sum, paper) => sum + paper.questionCount, 0);
  const totalReady = papers.reduce((sum, paper) => {
    if (subject?.grade == null) return sum;
    const key = getQuestionPaperCountKey(
      subject.grade,
      getSubjectLabel(subject),
      paper.year,
      paper.term,
    );
    return sum + (readyCountsByPaper.get(key) ?? 0);
  }, 0);
  const pastPaperByKey = new Map(
    pastPapers.map((paper) => [`${paper.year}-${paper.term}`, paper]),
  );

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-50 to-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-6 py-5">
          <Link
            href={`/subjects/${id}`}
            className="text-sm font-medium text-indigo-600 transition hover:text-indigo-700"
          >
            ← Back to subject
          </Link>
          <div className="mt-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-indigo-600">
                Question management
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-900">
                {subject ? getSubjectLabel(subject) : "Subject"}
              </h1>
              {subject?.grade != null ? (
                <p className="mt-1 text-sm text-slate-500">{getGradeLabel(subject.grade)}</p>
              ) : null}
            </div>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700">
              {papers.length} paper{papers.length === 1 ? "" : "s"} · {totalReady}/{totalQuestions}{" "}
              ready
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-5 text-red-800">
            <p className="font-medium">Failed to load question papers</p>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
        ) : papers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="text-lg font-medium text-slate-900">No question papers yet</p>
            <p className="mt-2 text-sm text-slate-600">
              Seed questions for this subject to see papers grouped by year and term.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {papers.map((paper) => {
              const pastPaper = pastPaperByKey.get(`${paper.year}-${paper.term}`);
              const readyCount =
                subject?.grade != null
                  ? (readyCountsByPaper.get(
                      getQuestionPaperCountKey(
                        subject.grade,
                        getSubjectLabel(subject),
                        paper.year,
                        paper.term,
                      ),
                    ) ?? 0)
                  : 0;

              return (
              <li key={`${paper.year}-${paper.term}`}>
                <Link
                  href={`/subjects/${id}/questions/${paper.term}/${paper.year}`}
                  className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200 hover:shadow-md"
                >
                  <h2 className="text-lg font-semibold text-slate-900">
                    {getQuestionPaperLabel(paper)}
                  </h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                      {paper.questionCount} question{paper.questionCount === 1 ? "" : "s"}
                    </span>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      {readyCount}/{paper.questionCount} ready
                    </span>
                  {(pastPaper?.pdfPath && pastPaper.ocrStatus === "done") ||
                  (pastPaper?.images?.length ?? 0) > 0 ? (
                    <>
                      {pastPaper?.pdfPath && pastPaper.ocrStatus === "done" ? (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                          PDF
                        </span>
                      ) : null}
                      {(pastPaper?.images?.length ?? 0) > 0 ? (
                        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                          {pastPaper?.images?.length} image
                          {pastPaper?.images?.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </>
                  ) : pastPaper?.ocrStatus === "processing" ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                      Uploading
                    </span>
                  ) : pastPaper?.ocrStatus === "failed" ? (
                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                      Upload failed
                    </span>
                  ) : null}
                  </div>
                </Link>
              </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
