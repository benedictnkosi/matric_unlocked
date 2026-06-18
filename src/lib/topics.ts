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
  videoScript?: string;
  videoScriptUpdatedAt?: string;
  posted?: boolean;
  postedUrl?: string;
  postedUpdatedAt?: string;
  order?: number;
}

export const EXAM_ORDER: ExamPeriod[] = ["june-exams", "final-exams"];

const EXAM_LABELS: Record<ExamPeriod, string> = {
  "june-exams": "June Exams",
  "final-exams": "Final Exams",
};

export function getExamLabel(exam: string): string {
  if (exam in EXAM_LABELS) return EXAM_LABELS[exam as ExamPeriod];
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
  const groups = new Map<string, Topic[]>();

  for (const topic of topics) {
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
    topics: (groups.get(exam) ?? []).sort((a, b) =>
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

function toTopicDocId(
  grade: number,
  subject: string,
  exam: ExamPeriod,
  name: string,
): string {
  return `${exam}-grade-${grade}-${toSlug(subject)}-${toSlug(name)}`;
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
  exam,
  topics,
}: {
  subject: string;
  grade: number;
  exam: ExamPeriod;
  topics: GeneratedTopic[];
}): Promise<void> {
  const batch = writeBatch(db);

  topics.forEach((topic, index) => {
    const id = toTopicDocId(grade, subject, exam, topic.name);
    batch.set(doc(db, "topics", id), {
      subject,
      grade,
      exam,
      name: topic.name,
      description: topic.description,
      order: index + 1,
    });
  });

  await batch.commit();
}
