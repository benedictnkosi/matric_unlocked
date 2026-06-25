import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import type { GeneratedTopic } from "./openai";

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

export async function getTopicsForSubject(
  subject: string,
  grade: number,
): Promise<Topic[]> {
  const snapshot = await getDocs(
    query(
      collection(db, "topics"),
      where("subject", "==", subject),
      where("grade", "==", grade),
    ),
  );

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Topic, "id">),
  }));
}

export async function getAllTopics(): Promise<Topic[]> {
  const snapshot = await getDocs(collection(db, "topics"));

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Topic, "id">),
  }));
}

export async function getTopicById(id: string): Promise<Topic | null> {
  const snapshot = await getDoc(doc(db, "topics", id));
  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<Topic, "id">),
  };
}

export async function saveTopicVideoScript(topicId: string, script: string): Promise<void> {
  await updateDoc(doc(db, "topics", topicId), {
    videoScript: script,
    videoScriptUpdatedAt: new Date().toISOString(),
  });
}

export async function saveTopicImagePath(topicId: string, imagePath: string): Promise<void> {
  await updateDoc(doc(db, "topics", topicId), {
    imagePath: imagePath.trim(),
    imagePathUpdatedAt: new Date().toISOString(),
  });
}

export async function saveTopicPostedStatus(
  topicId: string,
  posted: boolean,
  postedUrl?: string,
): Promise<void> {
  await updateDoc(doc(db, "topics", topicId), {
    posted,
    postedUrl: posted ? postedUrl?.trim() || "" : "",
    postedUpdatedAt: new Date().toISOString(),
  });
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

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toTopicDocId(grade: number, subject: string, name: string): string {
  return `grade-${grade}-${toSlug(subject)}-${toSlug(name)}`;
}

export async function deleteTopicsForSubject(
  subject: string,
  grade: number,
): Promise<number> {
  const snapshot = await getDocs(
    query(
      collection(db, "topics"),
      where("subject", "==", subject),
      where("grade", "==", grade),
    ),
  );

  if (snapshot.empty) return 0;

  const docs = snapshot.docs;
  const batchSize = 500;

  for (let start = 0; start < docs.length; start += batchSize) {
    const batch = writeBatch(db);
    const chunk = docs.slice(start, start + batchSize);
    for (const topicDoc of chunk) {
      batch.delete(topicDoc.ref);
    }
    await batch.commit();
  }

  return docs.length;
}

export async function deleteTopicsForExam(
  subject: string,
  grade: number,
  exam: ExamPeriod,
): Promise<number> {
  const snapshot = await getDocs(
    query(
      collection(db, "topics"),
      where("subject", "==", subject),
      where("grade", "==", grade),
      where("exam", "==", exam),
    ),
  );

  if (snapshot.empty) return 0;

  const docs = snapshot.docs;
  const batchSize = 500;

  for (let start = 0; start < docs.length; start += batchSize) {
    const batch = writeBatch(db);
    const chunk = docs.slice(start, start + batchSize);
    for (const topicDoc of chunk) {
      batch.delete(topicDoc.ref);
    }
    await batch.commit();
  }

  return docs.length;
}

export async function saveGeneratedTopics({
  subject,
  grade,
  topics,
}: {
  subject: string;
  grade: number;
  topics: Array<GeneratedTopic & { questionCount?: number }>;
}): Promise<void> {
  const batch = writeBatch(db);

  topics.forEach((topic, index) => {
    const id = toTopicDocId(grade, subject, topic.name);
    batch.set(doc(db, "topics", id), {
      subject,
      grade,
      name: topic.name,
      description: topic.description,
      order: index + 1,
      ...(topic.questionCount != null ? { questionCount: topic.questionCount } : {}),
    });
  });

  await batch.commit();
}

function toSubTopicDocId(parentTopicId: string, name: string): string {
  return `${parentTopicId}--${toSlug(name)}`;
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

export async function deleteSubTopicsForParent(parentTopicId: string): Promise<number> {
  const snapshot = await getDocs(
    query(collection(db, "topics"), where("parentTopicId", "==", parentTopicId)),
  );

  if (snapshot.empty) return 0;

  const batch = writeBatch(db);
  for (const topicDoc of snapshot.docs) {
    batch.delete(topicDoc.ref);
  }
  await batch.commit();

  return snapshot.docs.length;
}

export async function saveGeneratedSubTopics({
  parentTopic,
  subTopics,
}: {
  parentTopic: Topic;
  subTopics: Array<GeneratedTopic & { questionCount?: number }>;
}): Promise<string[]> {
  if (!parentTopic.subject || parentTopic.grade == null) {
    throw new Error("Parent topic is missing subject or grade.");
  }

  const batch = writeBatch(db);
  const ids: string[] = [];

  subTopics.forEach((subTopic, index) => {
    const id = toSubTopicDocId(parentTopic.id, subTopic.name);
    ids.push(id);
    batch.set(doc(db, "topics", id), {
      subject: parentTopic.subject,
      grade: parentTopic.grade,
      ...(parentTopic.exam ? { exam: parentTopic.exam } : {}),
      parentTopicId: parentTopic.id,
      name: subTopic.name,
      description: subTopic.description,
      order: index + 1,
      ...(subTopic.questionCount != null ? { questionCount: subTopic.questionCount } : {}),
    });
  });

  await batch.commit();
  return ids;
}
