export type ExamPeriod = "june-exams" | "final-exams";

export interface Topic {
  id: string;
  subject?: string;
  grade?: number;
  exam?: ExamPeriod | string;
  name?: string;
  title?: string;
  description?: string;
  parentTopicId?: string;
  videoScript?: string;
  videoScriptUpdatedAt?: string;
  posted?: boolean;
  postedUrl?: string;
  postedUpdatedAt?: string;
  order?: number;
  questionCount?: number;
  imagePath?: string;
  imagePathUpdatedAt?: string;
}

export const EXAM_ORDER: ExamPeriod[] = ["june-exams", "final-exams"];

const EXAM_LABELS: Record<ExamPeriod, string> = {
  "june-exams": "June Exams",
  "final-exams": "Final Exams",
};

export function getExamLabel(exam: string): string {
  if (exam in EXAM_LABELS) return EXAM_LABELS[exam as ExamPeriod];
  if (exam === "other") return "Topics";
  return exam;
}

export function getTopicLabel(topic: Topic): string {
  if (typeof topic.name === "string" && topic.name.trim()) return topic.name;
  if (typeof topic.title === "string" && topic.title.trim()) return topic.title;
  return topic.id;
}

export function groupTopicsByExam(topics: Topic[]) {
  const parentTopics = getParentTopics(topics);
  const groups = new Map<string, Topic[]>();

  for (const topic of parentTopics) {
    const exam = topic.exam ?? "other";
    const list = groups.get(exam) ?? [];
    list.push(topic);
    groups.set(exam, list);
  }

  const orderedExams = [
    ...EXAM_ORDER.filter((exam) => groups.has(exam)),
    ...[...groups.keys()].filter((exam) => !EXAM_ORDER.includes(exam as ExamPeriod)).sort(),
  ];

  return orderedExams.map((exam) => ({
    exam,
    label: getExamLabel(exam),
    topics: (groups.get(exam) ?? []).sort(
      (a, b) =>
        (b.questionCount ?? 0) - (a.questionCount ?? 0) ||
        getTopicLabel(a).localeCompare(getTopicLabel(b)),
    ),
  }));
}

export function groupSubTopicsByParent(topics: Topic[]): Map<string, Topic[]> {
  const map = new Map<string, Topic[]>();

  for (const topic of topics) {
    if (!topic.parentTopicId) continue;
    const list = map.get(topic.parentTopicId) ?? [];
    list.push(topic);
    map.set(topic.parentTopicId, list);
  }

  for (const [parentId, subTopics] of map) {
    map.set(
      parentId,
      subTopics.sort(
        (a, b) =>
          (a.order ?? 0) - (b.order ?? 0) ||
          getTopicLabel(a).localeCompare(getTopicLabel(b)),
      ),
    );
  }

  return map;
}

export function getParentTopics(topics: Topic[]): Topic[] {
  return topics.filter((topic) => !topic.parentTopicId);
}

export function getParentTopicsWithoutSubTopics(topics: Topic[]): Topic[] {
  const parentIdsWithSubTopics = new Set(
    topics
      .filter((topic) => topic.parentTopicId)
      .map((topic) => topic.parentTopicId as string),
  );

  return getParentTopics(topics).filter((topic) => !parentIdsWithSubTopics.has(topic.id));
}

export function getTopicsForVideoScriptGeneration(topics: Topic[]): Topic[] {
  const parentIdsWithSubTopics = new Set(groupSubTopicsByParent(topics).keys());

  return topics.filter((topic) => {
    if (topic.parentTopicId) return true;
    return !parentIdsWithSubTopics.has(topic.id);
  });
}

export interface GradeTopicCounts {
  topicCount: number;
  subTopicCount: number;
}

export function countTopicsByGrade(
  topics: Topic[],
  subjectNamesByGrade: Map<number, Set<string>>,
): Map<number, GradeTopicCounts> {
  const counts = new Map<number, GradeTopicCounts>();

  for (const topic of topics) {
    if (topic.grade == null || !topic.subject) continue;

    const allowedNames = subjectNamesByGrade.get(topic.grade);
    if (!allowedNames?.has(topic.subject)) continue;

    const entry = counts.get(topic.grade) ?? { topicCount: 0, subTopicCount: 0 };

    if (topic.parentTopicId) {
      entry.subTopicCount += 1;
    } else {
      entry.topicCount += 1;
    }

    counts.set(topic.grade, entry);
  }

  return counts;
}

export function getSubjectTopicCountKey(grade: number, subjectName: string): string {
  return `${grade}:${subjectName}`;
}

export function countTopicsBySubject(topics: Topic[]): Map<string, GradeTopicCounts> {
  const counts = new Map<string, GradeTopicCounts>();

  for (const topic of topics) {
    if (topic.grade == null || !topic.subject) continue;

    const key = getSubjectTopicCountKey(topic.grade, topic.subject);
    const entry = counts.get(key) ?? { topicCount: 0, subTopicCount: 0 };

    if (topic.parentTopicId) {
      entry.subTopicCount += 1;
    } else {
      entry.topicCount += 1;
    }

    counts.set(key, entry);
  }

  return counts;
}
