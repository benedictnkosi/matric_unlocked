import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, writeBatch } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvPath = join(__dirname, "..", "subjects.csv");

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function parseSubjectsCsv(content) {
  const lines = content.trim().split("\n").slice(1);

  return lines.map((line, index) => {
    const quoted = line.match(/^(\d+),"(.+)"$/);
    if (quoted) {
      return { grade: Number(quoted[1]), name: quoted[2] };
    }

    const [grade, ...nameParts] = line.split(",");
    if (!grade || nameParts.length === 0) {
      throw new Error(`Invalid CSV row ${index + 2}: ${line}`);
    }

    return { grade: Number(grade), name: nameParts.join(",").replace(/^"|"$/g, "") };
  });
}

function toDocId(grade, name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `grade-${grade}-${slug}`;
}

async function seedSubjects() {
  const csv = readFileSync(csvPath, "utf8");
  const subjects = parseSubjectsCsv(csv);

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const batch = writeBatch(db);

  for (const subject of subjects) {
    const id = toDocId(subject.grade, subject.name);
    batch.set(doc(db, "subjects", id), {
      grade: subject.grade,
      name: subject.name,
    });
  }

  await batch.commit();
  console.log(`Seeded ${subjects.length} subjects into Firestore.`);
}

seedSubjects().catch((error) => {
  console.error("Failed to seed subjects:", error.message);
  process.exit(1);
});
