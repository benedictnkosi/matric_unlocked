import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, writeBatch } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const questionsPath = join(__dirname, "..", "questions-with-topics.json");
const BATCH_SIZE = 400;

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function parseOptions(options) {
  if (typeof options !== "string") return options;

  try {
    return JSON.parse(options);
  } catch {
    return options;
  }
}

function toDocId(index) {
  return `q-${String(index + 1).padStart(6, "0")}`;
}

function normalizeQuestion(question, index) {
  const grade = question.grade ?? question.subject_grade;
  const name = question.name ?? question.subject_name ?? "";

  if (grade == null) {
    throw new Error(`Question at index ${index} is missing grade/subject_grade.`);
  }

  return {
    context: question.context ?? "",
    question: question.question ?? "",
    options: parseOptions(question.options),
    answer: question.answer ?? "",
    image_path: question.image_path ?? "",
    term: question.term ?? null,
    name,
    grade,
    topic: question.topic ?? "",
    subTopic: question.subTopic ?? question.sub_topic ?? "",
    aiExplanation: question.ai_explanation ?? question.aiExplanation ?? "",
    year: question.year ?? null,
  };
}

async function seedQuestions() {
  const questions = JSON.parse(readFileSync(questionsPath, "utf8"));

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  let seeded = 0;

  for (let start = 0; start < questions.length; start += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = questions.slice(start, start + BATCH_SIZE);

    for (let i = 0; i < chunk.length; i++) {
      const index = start + i;
      batch.set(doc(db, "questions", toDocId(index)), normalizeQuestion(chunk[i], index));
    }

    await batch.commit();
    seeded += chunk.length;
    console.log(`Committed ${seeded}/${questions.length} questions...`);
  }

  console.log(`Seeded ${questions.length} questions into Firestore.`);
}

seedQuestions().catch((error) => {
  console.error("Failed to seed questions:", error.message);
  process.exit(1);
});
