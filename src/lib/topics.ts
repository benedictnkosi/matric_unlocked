export * from "./topic-utils";

import { adminDb } from "./firebase-admin";
import type { GeneratedTopic } from "./openai";
import type { ExamPeriod, Topic } from "./topic-utils";

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toTopicDocId(grade: number, subject: string, name: string): string {
  return `grade-${grade}-${toSlug(subject)}-${toSlug(name)}`;
}

function toSubTopicDocId(parentTopicId: string, name: string): string {
  return `${parentTopicId}--${toSlug(name)}`;
}

export async function getTopicsForSubject(
  subject: string,
  grade: number,
): Promise<Topic[]> {
  const snapshot = await adminDb
    .collection("topics")
    .where("subject", "==", subject)
    .where("grade", "==", grade)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Topic, "id">),
  }));
}

export async function getAllTopics(): Promise<Topic[]> {
  const snapshot = await adminDb.collection("topics").get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<Topic, "id">),
  }));
}

export async function getTopicById(id: string): Promise<Topic | null> {
  const snapshot = await adminDb.collection("topics").doc(id).get();
  if (!snapshot.exists) return null;

  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<Topic, "id">),
  };
}

export async function saveTopicVideoScript(topicId: string, script: string): Promise<void> {
  await adminDb.collection("topics").doc(topicId).update({
    videoScript: script,
    videoScriptUpdatedAt: new Date().toISOString(),
  });
}

export async function saveTopicImagePath(topicId: string, imagePath: string): Promise<void> {
  await adminDb.collection("topics").doc(topicId).update({
    imagePath: imagePath.trim(),
    imagePathUpdatedAt: new Date().toISOString(),
  });
}

export async function saveTopicPostedStatus(
  topicId: string,
  posted: boolean,
  postedUrl?: string,
): Promise<void> {
  await adminDb.collection("topics").doc(topicId).update({
    posted,
    postedUrl: posted ? postedUrl?.trim() || "" : "",
    postedUpdatedAt: new Date().toISOString(),
  });
}

export async function deleteTopicsForSubject(
  subject: string,
  grade: number,
): Promise<number> {
  const snapshot = await adminDb
    .collection("topics")
    .where("subject", "==", subject)
    .where("grade", "==", grade)
    .get();

  if (snapshot.empty) return 0;

  const docs = snapshot.docs;
  const batchSize = 500;

  for (let start = 0; start < docs.length; start += batchSize) {
    const batch = adminDb.batch();
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
  const snapshot = await adminDb
    .collection("topics")
    .where("subject", "==", subject)
    .where("grade", "==", grade)
    .where("exam", "==", exam)
    .get();

  if (snapshot.empty) return 0;

  const docs = snapshot.docs;
  const batchSize = 500;

  for (let start = 0; start < docs.length; start += batchSize) {
    const batch = adminDb.batch();
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
  const batch = adminDb.batch();

  topics.forEach((topic, index) => {
    const id = toTopicDocId(grade, subject, topic.name);
    batch.set(adminDb.collection("topics").doc(id), {
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

export async function deleteSubTopicsForParent(parentTopicId: string): Promise<number> {
  const snapshot = await adminDb
    .collection("topics")
    .where("parentTopicId", "==", parentTopicId)
    .get();

  if (snapshot.empty) return 0;

  const batch = adminDb.batch();
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

  const batch = adminDb.batch();
  const ids: string[] = [];

  subTopics.forEach((subTopic, index) => {
    const id = toSubTopicDocId(parentTopic.id, subTopic.name);
    ids.push(id);
    batch.set(adminDb.collection("topics").doc(id), {
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
