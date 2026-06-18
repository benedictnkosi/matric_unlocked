import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import type { ExamPeriod } from "./topics";

export interface Question {
  id: string;
  context?: string;
  question?: string;
  options?: unknown;
  answer?: string;
  image_path?: string;
  term?: number;
  name?: string;
  grade?: number;
  topic?: string;
}

export interface TopicQuestionCount {
  name: string;
  questionCount: number;
}

const JUNE_TERMS = [1, 2];
const FINAL_TERMS = [3, 4];

const NON_TOPIC_VALUE = "no match ai";

function normalizeTopic(topic: string | undefined): string | null {
  const trimmed = topic?.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === NON_TOPIC_VALUE) return null;
  return trimmed;
}

export function getTermsForExam(exam: ExamPeriod): number[] {
  return exam === "june-exams" ? JUNE_TERMS : FINAL_TERMS;
}

export async function getQuestionsForSubjectAndExam(
  subjectName: string,
  grade: number,
  exam: ExamPeriod,
): Promise<Question[]> {
  const terms = getTermsForExam(exam);
  const snapshot = await getDocs(
    query(
      collection(db, "questions"),
      where("name", "==", subjectName),
      where("grade", "==", grade),
      where("term", "in", terms),
    ),
  );

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Question, "id">),
  }));
}

export function getTopTopicsByQuestionCount(
  questions: Question[],
  limit = 10,
): TopicQuestionCount[] {
  const counts = new Map<string, { name: string; questionCount: number }>();

  for (const question of questions) {
    const topic = normalizeTopic(question.topic);
    if (!topic) continue;

    const key = topic.toLowerCase();
    const existing = counts.get(key);
    if (existing) {
      existing.questionCount += 1;
    } else {
      counts.set(key, { name: topic, questionCount: 1 });
    }
  }

  return [...counts.values()]
    .sort(
      (a, b) =>
        b.questionCount - a.questionCount || a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

export function getQuestionsTaggedWithTopic(
  questions: Question[],
  topicName: string,
): Question[] {
  const normalized = normalizeTopic(topicName);
  if (!normalized) return [];

  const target = normalized.toLowerCase();
  return questions.filter(
    (question) => normalizeTopic(question.topic)?.toLowerCase() === target,
  );
}

export function serializeQuestionsForAnalysis(questions: Question[]) {
  return questions.map((q) => ({
    context: q.context ?? "",
    question: q.question ?? "",
    options: q.options ?? null,
    answer: q.answer ?? "",
    term: q.term,
  }));
}
