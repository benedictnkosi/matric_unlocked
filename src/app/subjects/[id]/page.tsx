import Link from "next/link";
import { notFound } from "next/navigation";
import { GenerateSubTopicsButton } from "@/components/generate-sub-topics-button";
import { GenerateTopicsForm } from "@/components/generate-topics-form";
import { TopicPostedForm } from "@/components/topic-posted-form";
import { VideoScriptButton } from "@/components/video-script-button";
import {
  getGradeLabel,
  getSubjectById,
  getSubjectLabel,
} from "@/lib/subjects";
import {
  attachQuestionCountsToTopics,
  getQuestionsForSubjectAndGrade,
} from "@/lib/questions";
import {
  getTopicsForSubject,
  getTopicLabel,
  groupSubTopicsByParent,
  groupTopicsByExam,
  getParentTopics,
} from "@/lib/topics";

export const dynamic = "force-dynamic";

interface SubjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function SubjectPage({ params }: SubjectPageProps) {
  const { id } = await params;
  let subject = null;
  let topics: Awaited<ReturnType<typeof getTopicsForSubject>> = [];
  let error: string | null = null;

  try {
    subject = await getSubjectById(id);
    if (subject?.grade != null) {
      topics = await getTopicsForSubject(getSubjectLabel(subject), subject.grade);
    }
  } catch (err) {
    error =
      err instanceof Error
        ? err.message
        : "Unable to load topics. Check your Firebase configuration.";
  }

  if (!error && !subject) notFound();

  const examGroups = groupTopicsByExam(topics);
  const subTopicsByParent = groupSubTopicsByParent(topics);
  const parentTopicCount = getParentTopics(topics).length;
  const allQuestions =
    subject?.grade != null
      ? await getQuestionsForSubjectAndGrade(getSubjectLabel(subject), subject.grade)
      : [];
  const enrichedExamGroups = examGroups.map((group) => ({
    ...group,
    topics: attachQuestionCountsToTopics(group.topics, allQuestions),
  }));

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-50 to-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-6 py-5">
          <Link
            href="/"
            className="text-sm font-medium text-indigo-600 transition hover:text-indigo-700"
          >
            ← All subjects
          </Link>
          <div className="mt-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-indigo-600">
                {subject?.grade != null ? getGradeLabel(subject.grade) : "Subject"}
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-900">
                {subject ? getSubjectLabel(subject) : "Subject"}
              </h1>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Link
                href={`/subjects/${id}/questions`}
                className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-sm font-medium text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50"
              >
                Manage questions
              </Link>
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700">
                {parentTopicCount} topic{parentTopicCount === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        {subject ? (
          <GenerateTopicsForm subjectId={subject.id} existingTopicCount={parentTopicCount} />
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-5 text-red-800">
            <p className="font-medium">Failed to load topics</p>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
        ) : topics.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="text-lg font-medium text-slate-900">No topics yet</p>
            <p className="mt-2 text-sm text-slate-600">
              Click Generate topics above, or add documents to the{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5">topics</code> collection
              manually.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {enrichedExamGroups.map((group) => (
              <section key={group.exam}>
                <div className="mb-4 flex items-baseline justify-between gap-4">
                  <h2 className="text-xl font-semibold text-slate-900">{group.label}</h2>
                  <span className="text-sm text-slate-500">
                    {group.topics.length} topic{group.topics.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.topics.map((topic) => {
                    const subTopics = subTopicsByParent.get(topic.id) ?? [];

                    return (
                      <li
                        key={topic.id}
                        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-lg font-semibold text-slate-900">
                            {getTopicLabel(topic)}
                          </h3>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                              {topic.questionCount ?? 0} question
                              {(topic.questionCount ?? 0) === 1 ? "" : "s"}
                            </span>
                            {subTopics.length > 0 ? (
                              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                                {subTopics.length} sub-topic{subTopics.length === 1 ? "" : "s"}
                              </span>
                            ) : null}
                            {topic.posted ? (
                              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                Posted
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {topic.description ? (
                          <p className="mt-2 text-sm leading-6 text-slate-600">
                            {topic.description}
                          </p>
                        ) : null}
                        <GenerateSubTopicsButton
                          topicId={topic.id}
                          topicName={getTopicLabel(topic)}
                          existingSubTopicCount={subTopics.length}
                        />
                        {subTopics.length > 0 ? (
                          <ul className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                            {subTopics.map((subTopic) => (
                              <li
                                key={subTopic.id}
                                className="rounded-xl border border-slate-100 bg-slate-50 p-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <h4 className="text-sm font-semibold text-slate-900">
                                    {getTopicLabel(subTopic)}
                                  </h4>
                                  {subTopic.questionCount != null ? (
                                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
                                      ~{subTopic.questionCount} question
                                      {subTopic.questionCount === 1 ? "" : "s"}
                                    </span>
                                  ) : null}
                                </div>
                                {subTopic.description ? (
                                  <p className="mt-1.5 text-xs leading-5 text-slate-600">
                                    {subTopic.description}
                                  </p>
                                ) : null}
                                <VideoScriptButton
                                  topicId={subTopic.id}
                                  topicName={getTopicLabel(subTopic)}
                                  initialScript={subTopic.videoScript}
                                />
                                <TopicPostedForm
                                  topicId={subTopic.id}
                                  initialPosted={subTopic.posted}
                                  initialPostedUrl={subTopic.postedUrl}
                                />
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <>
                            <VideoScriptButton
                              topicId={topic.id}
                              topicName={getTopicLabel(topic)}
                              initialScript={topic.videoScript}
                            />
                            <TopicPostedForm
                              topicId={topic.id}
                              initialPosted={topic.posted}
                              initialPostedUrl={topic.postedUrl}
                            />
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
