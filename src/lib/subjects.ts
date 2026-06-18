import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "./firebase";

export interface Subject {
  id: string;
  grade?: number;
  name?: string;
  title?: string;
  description?: string;
}

const GRADE_LABELS: Record<number, string> = {
  1: "Grade 12",
  2: "Grade 11",
  3: "Grade 10",
};

export const GRADE_ORDER = [1, 2, 3] as const;

export function getGradeLabel(grade: number): string {
  return GRADE_LABELS[grade] ?? `Grade ${grade}`;
}

export function groupSubjectsByGrade(subjects: Subject[]) {
  const groups = new Map<number, Subject[]>();

  for (const subject of subjects) {
    const grade = subject.grade ?? 0;
    const list = groups.get(grade) ?? [];
    list.push(subject);
    groups.set(grade, list);
  }

  const orderedGrades = [
    ...GRADE_ORDER.filter((grade) => groups.has(grade)),
    ...[...groups.keys()].filter((grade) => !GRADE_ORDER.includes(grade as 1 | 2 | 3)).sort(),
  ];

  return orderedGrades.map((grade) => ({
    grade,
    label: getGradeLabel(grade),
    subjects: (groups.get(grade) ?? []).sort((a, b) =>
      getSubjectLabel(a).localeCompare(getSubjectLabel(b)),
    ),
  }));
}

export function getSubjectLabel(subject: Subject): string {
  if (typeof subject.name === "string" && subject.name.trim()) return subject.name;
  if (typeof subject.title === "string" && subject.title.trim()) return subject.title;
  return subject.id;
}

export async function getSubjects(): Promise<Subject[]> {
  const snapshot = await getDocs(collection(db, "subjects"));

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Subject, "id">),
  }));
}

export async function getSubjectById(id: string): Promise<Subject | null> {
  const snapshot = await getDoc(doc(db, "subjects", id));
  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<Subject, "id">),
  };
}
