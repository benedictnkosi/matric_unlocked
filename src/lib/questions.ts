import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { getFirebaseStoragePublicUrl } from "./firebase-storage-url";
import type { ExamPeriod, Topic } from "./topics";
import { getTopicLabel } from "./topics";

export interface Question {
  id: string;
  context?: string;
  question?: string;
  options?: unknown;
  answer?: string;
  image_path?: string;
  image_check?: string;
  term?: number;
  name?: string;
  grade?: number;
  topic?: string;
  subTopic?: string;
  year?: number;
  questionNumber?: string;
  questionNumberUpdatedAt?: string;
  ready?: boolean;
  readyUpdatedAt?: string;
  aiExplanation?: string;
  aiExplanationUpdatedAt?: string;
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

export async function getQuestionsForSubjectAndGrade(
  subjectName: string,
  grade: number,
): Promise<Question[]> {
  const snapshot = await getDocs(
    query(
      collection(db, "questions"),
      where("name", "==", subjectName),
      where("grade", "==", grade),
    ),
  );

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Question, "id">),
  }));
}

export async function deleteQuestionsForSubject(
  subjectName: string,
  grade: number,
): Promise<number> {
  const snapshot = await getDocs(
    query(
      collection(db, "questions"),
      where("name", "==", subjectName),
      where("grade", "==", grade),
    ),
  );

  if (snapshot.empty) return 0;

  const docs = snapshot.docs;
  const batchSize = 500;

  for (let start = 0; start < docs.length; start += batchSize) {
    const batch = writeBatch(db);
    const chunk = docs.slice(start, start + batchSize);
    for (const questionDoc of chunk) {
      batch.delete(questionDoc.ref);
    }
    await batch.commit();
  }

  return docs.length;
}

export function hasEmptyImagePath(imagePath: string | null | undefined): boolean {
  return imagePath == null || imagePath.trim() === "";
}

export function hasBeenImageChecked(question: Question): boolean {
  return (
    question.image_check === "done" ||
    question.image_path === "image_required"
  );
}

export async function getQuestionById(questionId: string): Promise<Question | null> {
  const snapshot = await getDoc(doc(db, "questions", questionId));
  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<Question, "id">),
  };
}

export async function deleteQuestionById(questionId: string): Promise<void> {
  await deleteDoc(doc(db, "questions", questionId));
}

export async function getAllQuestions(): Promise<Question[]> {
  const snapshot = await getDocs(collection(db, "questions"));
  return snapshot.docs
    .map((questionDoc) => ({
      id: questionDoc.id,
      ...(questionDoc.data() as Omit<Question, "id">),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getSubjectQuestionCountKey(grade: number, subjectName: string): string {
  return `${grade}:${subjectName}`;
}

export function isMissingQuestionImagePath(imagePath: string | null | undefined): boolean {
  return !imagePath?.trim();
}

export function countQuestionsMissingImagePathBySubject(
  questions: Question[],
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const question of questions) {
    if (question.grade == null || !question.name?.trim()) continue;
    if (!isMissingQuestionImagePath(question.image_path)) continue;

    const key = getSubjectQuestionCountKey(question.grade, question.name.trim());
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

export function hasAssignedQuestionImage(imagePath: string | null | undefined): boolean {
  const trimmed = imagePath?.trim();
  return Boolean(trimmed && trimmed !== "image_required");
}

export function hasUsableQuestionImage(imagePath: string | null | undefined): boolean {
  const trimmed = imagePath?.trim();
  if (!trimmed || trimmed === "image_required") return false;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return true;
  }

  if (trimmed.startsWith("past-papers/") || isFirebaseStorageImagePath(trimmed)) {
    return true;
  }

  return false;
}

export function isAssignableQuestionImagePath(imagePath: string): boolean {
  const trimmed = imagePath.trim();
  if (!trimmed || trimmed === "image_required") return false;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return true;
  }

  return isFirebaseStorageImagePath(trimmed);
}

export async function bulkAssignQuestionImagePath(
  subjectName: string,
  grade: number,
  term: number,
  year: number,
  questionIds: string[],
  imagePath: string,
  options?: { force?: boolean },
): Promise<{ updatedCount: number; skippedCount: number }> {
  const trimmedPath = imagePath.trim();
  if (!isAssignableQuestionImagePath(trimmedPath)) {
    throw new Error("imagePath must be a Firebase Storage path or HTTPS URL.");
  }

  const uniqueIds = [...new Set(questionIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    throw new Error("Select at least one question.");
  }

  const paperQuestions = await getQuestionsForPaper(subjectName, grade, term, year);
  const paperQuestionIds = new Set(paperQuestions.map((question) => question.id));

  for (const questionId of uniqueIds) {
    if (!paperQuestionIds.has(questionId)) {
      throw new Error(`Question ${questionId} is not on this paper.`);
    }
  }

  const force = options?.force === true;
  const selectedIds = new Set(uniqueIds);
  const toUpdate = paperQuestions.filter((question) => {
    if (!selectedIds.has(question.id)) return false;
    return force || !hasUsableQuestionImage(question.image_path);
  });

  const skippedCount = uniqueIds.length - toUpdate.length;
  if (toUpdate.length === 0) {
    return { updatedCount: 0, skippedCount };
  }

  const batchSize = 500;

  for (let start = 0; start < toUpdate.length; start += batchSize) {
    const batch = writeBatch(db);
    const chunk = toUpdate.slice(start, start + batchSize);

    for (const question of chunk) {
      batch.update(doc(db, "questions", question.id), {
        image_path: trimmedPath,
        image_check: "done",
      });
    }

    await batch.commit();
  }

  return { updatedCount: toUpdate.length, skippedCount };
}

export async function updateQuestionImagePath(
  questionId: string,
  imagePath: string,
): Promise<void> {
  await updateDoc(doc(db, "questions", questionId), {
    image_path: imagePath,
    image_check: "done",
  });
}

export async function clearQuestionImagePath(questionId: string): Promise<void> {
  await updateDoc(doc(db, "questions", questionId), {
    image_path: "",
  });
}

export async function clearQuestionImagesForPaper(
  subjectName: string,
  grade: number,
  term: number,
  year: number,
): Promise<number> {
  const questions = await getQuestionsForPaper(subjectName, grade, term, year);
  const toClear = questions.filter((question) => hasAssignedQuestionImage(question.image_path));

  if (toClear.length === 0) return 0;

  const batchSize = 500;

  for (let start = 0; start < toClear.length; start += batchSize) {
    const batch = writeBatch(db);
    const chunk = toClear.slice(start, start + batchSize);

    for (const question of chunk) {
      batch.update(doc(db, "questions", question.id), {
        image_path: "",
      });
    }

    await batch.commit();
  }

  return toClear.length;
}

export async function markQuestionImageCheckDone(questionId: string): Promise<void> {
  await updateDoc(doc(db, "questions", questionId), {
    image_check: "done",
  });
}

export async function updateQuestionSubTopic(
  questionId: string,
  subTopic: string,
): Promise<void> {
  await updateDoc(doc(db, "questions", questionId), {
    subTopic,
  });
}

export async function updateQuestionNumber(
  questionId: string,
  questionNumber: string,
): Promise<void> {
  await updateDoc(doc(db, "questions", questionId), {
    questionNumber,
    questionNumberUpdatedAt: new Date().toISOString(),
  });
}

export function isQuestionReady(question: Pick<Question, "ready">): boolean {
  return question.ready === true;
}

export async function updateQuestionReadyStatus(
  questionId: string,
  ready: boolean,
): Promise<void> {
  await updateDoc(doc(db, "questions", questionId), {
    ready,
    readyUpdatedAt: new Date().toISOString(),
  });
}

export function getQuestionPaperCountKey(
  grade: number,
  subjectName: string,
  year: number,
  term: number,
): string {
  return `${grade}:${subjectName}:${year}:${term}`;
}

export function countReadyQuestionsBySubject(questions: Question[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const question of questions) {
    if (question.grade == null || !question.name?.trim()) continue;
    if (!isQuestionReady(question)) continue;

    const key = getSubjectQuestionCountKey(question.grade, question.name.trim());
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

export function countReadyQuestionsByPaper(questions: Question[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const question of questions) {
    if (
      question.grade == null ||
      !question.name?.trim() ||
      question.term == null ||
      question.year == null
    ) {
      continue;
    }

    if (!isQuestionReady(question)) continue;

    const key = getQuestionPaperCountKey(
      question.grade,
      question.name.trim(),
      question.year,
      question.term,
    );
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

export async function markQuestionsReadyForPaper(
  subjectName: string,
  grade: number,
  term: number,
  year: number,
): Promise<number> {
  const questions = await getQuestionsForPaper(subjectName, grade, term, year);
  if (questions.length === 0) return 0;

  const now = new Date().toISOString();
  const batchSize = 500;

  for (let start = 0; start < questions.length; start += batchSize) {
    const batch = writeBatch(db);
    const chunk = questions.slice(start, start + batchSize);

    for (const question of chunk) {
      batch.update(doc(db, "questions", question.id), {
        ready: true,
        readyUpdatedAt: now,
      });
    }

    await batch.commit();
  }

  return questions.length;
}

export async function saveQuestionAiExplanation(
  questionId: string,
  explanation: string,
): Promise<void> {
  await updateDoc(doc(db, "questions", questionId), {
    aiExplanation: explanation,
    aiExplanationUpdatedAt: new Date().toISOString(),
  });
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

export function attachQuestionCountsToTopics(
  topics: Topic[],
  questions: Question[],
): Array<Topic & { questionCount: number }> {
  return topics
    .map((topic) => ({
      ...topic,
      questionCount: getQuestionsTaggedWithTopic(questions, getTopicLabel(topic)).length,
    }))
    .sort(
      (a, b) =>
        b.questionCount - a.questionCount ||
        getTopicLabel(a).localeCompare(getTopicLabel(b)),
    );
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

export interface QuestionPaper {
  term: number;
  year: number;
  questionCount: number;
}

const TERM_LABELS: Record<number, string> = {
  1: "June exams",
  2: "June exams",
  3: "Final exams",
  4: "Final exams",
};

export function getTermLabel(term: number): string {
  const period = TERM_LABELS[term];
  if (period) return `Term ${term} (${period})`;
  return `Term ${term}`;
}

export function getQuestionPaperLabel(paper: Pick<QuestionPaper, "term" | "year">): string {
  return `${paper.year} · ${getTermLabel(paper.term)}`;
}

export function getQuestionPapers(questions: Question[]): QuestionPaper[] {
  const counts = new Map<string, QuestionPaper>();

  for (const question of questions) {
    if (question.term == null || question.year == null) continue;

    const key = `${question.year}-${question.term}`;
    const existing = counts.get(key);
    if (existing) {
      existing.questionCount += 1;
    } else {
      counts.set(key, {
        term: question.term,
        year: question.year,
        questionCount: 1,
      });
    }
  }

  return [...counts.values()].sort(
    (a, b) => b.year - a.year || a.term - b.term,
  );
}

export async function getQuestionPapersForSubject(
  subjectName: string,
  grade: number,
): Promise<QuestionPaper[]> {
  const questions = await getQuestionsForSubjectAndGrade(subjectName, grade);
  return getQuestionPapers(questions);
}

function normalizeQuestionNumberForSort(value: string): string {
  return value.trim().replace(/^question\s*/i, "");
}

function parseQuestionNumberPart(part: string): number | string {
  const trimmed = part.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed.toLowerCase();
}

function compareQuestionNumberStrings(left: string, right: string): number {
  const leftParts = normalizeQuestionNumberForSort(left)
    .split(".")
    .map(parseQuestionNumberPart);
  const rightParts = normalizeQuestionNumberForSort(right)
    .split(".")
    .map(parseQuestionNumberPart);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    if (typeof leftPart === "number" && typeof rightPart === "number") {
      if (leftPart !== rightPart) return leftPart - rightPart;
      continue;
    }

    const comparison = String(leftPart).localeCompare(String(rightPart), undefined, {
      numeric: true,
    });
    if (comparison !== 0) return comparison;
  }

  return 0;
}

export function compareQuestionsByNumber(
  left: Pick<Question, "id" | "questionNumber">,
  right: Pick<Question, "id" | "questionNumber">,
): number {
  const leftNumber = left.questionNumber?.trim();
  const rightNumber = right.questionNumber?.trim();
  const leftHasNumber = Boolean(leftNumber);
  const rightHasNumber = Boolean(rightNumber);

  if (leftHasNumber && rightHasNumber) {
    const numberComparison = compareQuestionNumberStrings(leftNumber!, rightNumber!);
    if (numberComparison !== 0) return numberComparison;
    return left.id.localeCompare(right.id);
  }

  if (leftHasNumber) return -1;
  if (rightHasNumber) return 1;
  return left.id.localeCompare(right.id);
}

export function sortQuestionsByNumber<T extends Pick<Question, "id" | "questionNumber">>(
  questions: T[],
): T[] {
  const hasNumberedQuestions = questions.some((question) => question.questionNumber?.trim());
  if (!hasNumberedQuestions) {
    return [...questions].sort((left, right) => left.id.localeCompare(right.id));
  }

  return [...questions].sort(compareQuestionsByNumber);
}

export async function getQuestionsForPaper(
  subjectName: string,
  grade: number,
  term: number,
  year: number,
): Promise<Question[]> {
  const snapshot = await getDocs(
    query(
      collection(db, "questions"),
      where("name", "==", subjectName),
      where("grade", "==", grade),
      where("term", "==", term),
      where("year", "==", year),
    ),
  );

  return sortQuestionsByNumber(
    snapshot.docs.map((questionDoc) => ({
      id: questionDoc.id,
      ...(questionDoc.data() as Omit<Question, "id">),
    })),
  );
}

export function formatQuestionOptions(options: unknown): string[] {
  if (options == null) return [];

  let value = options;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      return [trimmed];
    }
  }

  if (Array.isArray(value)) {
    return value.map((option) => String(option));
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
      .map(([, option]) => String(option));
  }

  return [String(value)];
}

export function isFirebaseStorageImagePath(imagePath: string): boolean {
  return (
    imagePath.startsWith("question-images/") ||
    /^past-papers\/q-[^/]+\//.test(imagePath)
  );
}

export function getQuestionImageUrl(imagePath: string | null | undefined): string | null {
  const trimmed = imagePath?.trim();
  if (!trimmed || trimmed === "image_required") return null;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  if (isFirebaseStorageImagePath(trimmed)) {
    return getFirebaseStoragePublicUrl(trimmed);
  }

  return `/question-images/${trimmed}`;
}

export function buildQuestionImageStoragePath(questionId: string, fileName: string): string {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return `past-papers/${questionId}/${sanitized}`;
}

export function isValidQuestionImageStoragePath(
  imagePath: string,
  questionId: string,
): boolean {
  const trimmed = imagePath.trim();
  return (
    trimmed.startsWith(`past-papers/${questionId}/`) ||
    trimmed.startsWith(`question-images/${questionId}/`)
  );
}
