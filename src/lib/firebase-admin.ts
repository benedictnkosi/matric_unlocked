import "server-only";

import { readFileSync } from "fs";
import { resolve } from "path";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const ADMIN_APP_NAME = "matric-unlocked-admin";

function loadServiceAccount(): Record<string, unknown> {
  const configuredPath =
    process.env.FIREBASE_SERVICE_ACCOUNT?.trim() ||
    "./matric-unlocked-firebase-adminsdk-fbsvc-17c7bd1818.json";
  const absolutePath = resolve(process.cwd(), configuredPath);

  return JSON.parse(readFileSync(absolutePath, "utf8")) as Record<string, unknown>;
}

function getAdminApp(): App {
  const existing = getApps().find((app) => app.name === ADMIN_APP_NAME);
  if (existing) return existing;

  return initializeApp(
    {
      credential: cert(loadServiceAccount()),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    },
    ADMIN_APP_NAME,
  );
}

export const adminDb: Firestore = getFirestore(getAdminApp());
