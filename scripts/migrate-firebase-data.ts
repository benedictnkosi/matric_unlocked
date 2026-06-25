import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp as initializeClientApp, type FirebaseApp } from "firebase/app";
import {
  collection,
  documentId,
  getDocs,
  getFirestore as getClientFirestore,
  limit,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type Firestore as ClientFirestore,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import {
  getBytes,
  getMetadata,
  getStorage as getClientStorage,
  listAll,
  ref,
  type FirebaseStorage as ClientStorage,
} from "firebase/storage";
import { cert, initializeApp as initializeAdminApp, type App as AdminApp } from "firebase-admin/app";
import {
  FieldPath,
  getFirestore as getAdminFirestore,
  type Firestore as AdminFirestore,
} from "firebase-admin/firestore";
import { getStorage as getAdminStorage } from "firebase-admin/storage";

const COLLECTIONS = ["subjects", "questions", "topics", "past_papers"] as const;
const STORAGE_PREFIXES = ["question-images", "past-papers"] as const;
const READ_BATCH_SIZE = 500;
const WRITE_BATCH_SIZE = 400;

type CollectionName = (typeof COLLECTIONS)[number];

interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

interface MigrationDocument {
  id: string;
  data: DocumentData;
}

interface MigrateOptions {
  dryRun: boolean;
  confirm: boolean;
  skipFirestore: boolean;
  skipStorage: boolean;
  questionImagesOnly: boolean;
  collections: CollectionName[];
  storagePrefixes: string[];
}

interface MigrationClients {
  sourceConfig: FirebaseEnvConfig;
  targetConfig: FirebaseEnvConfig;
  readDocuments: (collectionName: CollectionName) => AsyncGenerator<MigrationDocument[]>;
  writeDocuments: (
    collectionName: CollectionName,
    docs: MigrationDocument[],
    sourceBucket: string,
    dryRun: boolean,
  ) => Promise<number>;
  listStoragePrefix: (prefix: string) => Promise<string[]>;
  copyStorageFile: (storagePath: string, dryRun: boolean) => Promise<void>;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function loadSourceConfig(): FirebaseEnvConfig {
  return {
    apiKey: requireEnv("NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: requireEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
    projectId: requireEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    storageBucket: requireEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: requireEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
    appId: requireEnv("NEXT_PUBLIC_FIREBASE_APP_ID"),
  };
}

function loadTargetConfig(): FirebaseEnvConfig {
  return {
    apiKey: requireEnv("TARGET_FIREBASE_API_KEY"),
    authDomain: requireEnv("TARGET_FIREBASE_AUTH_DOMAIN"),
    projectId: requireEnv("TARGET_FIREBASE_PROJECT_ID"),
    storageBucket: requireEnv("TARGET_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: requireEnv("TARGET_FIREBASE_MESSAGING_SENDER_ID"),
    appId: requireEnv("TARGET_FIREBASE_APP_ID"),
  };
}

function loadServiceAccount(path: string) {
  const absolutePath = resolve(path);
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

function isQuestionImagePath(path: string): boolean {
  return path.startsWith("question-images/") || /^past-papers\/q-/.test(path);
}

function parseArgs(argv: string[]): MigrateOptions {
  const options: MigrateOptions = {
    dryRun: false,
    confirm: false,
    skipFirestore: false,
    skipStorage: false,
    questionImagesOnly: false,
    collections: [...COLLECTIONS],
    storagePrefixes: [...STORAGE_PREFIXES],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--confirm") {
      options.confirm = true;
      continue;
    }

    if (arg === "--skip-firestore") {
      options.skipFirestore = true;
      continue;
    }

    if (arg === "--skip-storage") {
      options.skipStorage = true;
      continue;
    }

    if (arg === "--question-images-only") {
      options.questionImagesOnly = true;
      options.skipFirestore = true;
      options.storagePrefixes = ["question-images"];
      continue;
    }

    if (arg === "--collections") {
      const raw = argv[i + 1];
      if (!raw) {
        throw new Error("--collections requires a comma-separated list.");
      }

      const names = raw.split(",").map((name) => name.trim()) as CollectionName[];
      for (const name of names) {
        if (!COLLECTIONS.includes(name)) {
          throw new Error(`Unknown collection: ${name}. Valid: ${COLLECTIONS.join(", ")}`);
        }
      }

      options.collections = names;
      i += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Migrate Firestore data and Storage files from the source project to the target project.

Source project env vars (from .env.local):
  NEXT_PUBLIC_FIREBASE_*

Target project env vars (from .env.target.local):
  TARGET_FIREBASE_*
  TARGET_FIREBASE_SERVICE_ACCOUNT=./matric-unlocked-firebase-adminsdk-fbsvc-17c7bd1818.json

Optional source service account (recommended for Storage):
  SOURCE_FIREBASE_SERVICE_ACCOUNT=./secrets/invoice-for-consultants-service-account.json

Usage:
  npm run migrate:firebase -- --dry-run
  npm run migrate:firebase -- --confirm
  npm run migrate:firebase -- --confirm --skip-storage
  npm run migrate:firebase -- --confirm --question-images-only
  npm run migrate:firebase -- --confirm --collections subjects,topics

Options:
  --dry-run                Count documents and storage files without writing
  --confirm                Required to perform the migration
  --skip-firestore         Only migrate Storage files
  --skip-storage           Only migrate Firestore documents
  --question-images-only   Migrate question image files only (skips Firestore and past-paper PDFs)
  --collections <list>     Comma-separated list (${COLLECTIONS.join(", ")})
  --help, -h               Show this help message

Setup:
  1. Firebase Console -> Project Settings -> Service accounts -> Generate new private key
  2. Save the JSON key as ./matric-unlocked-firebase-adminsdk-fbsvc-17c7bd1818.json in the project root
  3. Set TARGET_FIREBASE_SERVICE_ACCOUNT in .env.target.local
  4. Re-run with --confirm

Notes:
  - Writes require a target service account (client SDK cannot bypass Firestore rules)
  - Topic images in public/topic-images/ are local files and are not migrated
`);
}

function extractStoragePath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/o\/(.+)$/);
    if (!match?.[1]) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function rewriteStorageUrls(data: DocumentData, sourceBucket: string): DocumentData {
  const next = { ...data };

  if (typeof next.image_path === "string") {
    const path = extractStoragePath(next.image_path);
    if (path) {
      next.image_path = path;
    } else if (next.image_path.includes(sourceBucket)) {
      next.image_path = "";
    }
  }

  if (typeof next.pdfPath === "string") {
    const path = extractStoragePath(next.pdfPath);
    if (path) next.pdfPath = path;
  }

  if (Array.isArray(next.images)) {
    next.images = next.images.map((image) => {
      if (!image || typeof image !== "object") return image;
      const record = { ...(image as Record<string, unknown>) };
      if (typeof record.path === "string") {
        const path = extractStoragePath(record.path);
        if (path) record.path = path;
      }
      return record;
    });
  }

  return next;
}

async function* paginateClientCollection(
  db: ClientFirestore,
  collectionName: CollectionName,
): AsyncGenerator<MigrationDocument[]> {
  let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

  while (true) {
    const pageQuery: Query<DocumentData> = lastDoc
      ? query(
          collection(db, collectionName),
          orderBy(documentId()),
          startAfter(lastDoc),
          limit(READ_BATCH_SIZE),
        )
      : query(collection(db, collectionName), orderBy(documentId()), limit(READ_BATCH_SIZE));

    const snapshot = await getDocs(pageQuery);
    if (snapshot.empty) break;

    yield snapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      data: docSnapshot.data(),
    }));

    lastDoc = snapshot.docs[snapshot.docs.length - 1] ?? null;
    if (snapshot.docs.length < READ_BATCH_SIZE) break;
  }
}

async function* paginateAdminCollection(
  db: AdminFirestore,
  collectionName: CollectionName,
): AsyncGenerator<MigrationDocument[]> {
  let lastId: string | null = null;

  while (true) {
    let pageQuery = db
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(READ_BATCH_SIZE);

    if (lastId) {
      pageQuery = pageQuery.startAfter(lastId);
    }

    const snapshot = await pageQuery.get();
    if (snapshot.empty) break;

    yield snapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      data: docSnapshot.data(),
    }));

    lastId = snapshot.docs[snapshot.docs.length - 1]?.id ?? null;
    if (snapshot.docs.length < READ_BATCH_SIZE) break;
  }
}

async function writeAdminDocumentChunk(
  destDb: AdminFirestore,
  collectionName: CollectionName,
  docs: MigrationDocument[],
  sourceBucket: string,
  dryRun: boolean,
): Promise<number> {
  if (dryRun) return docs.length;

  const batch = destDb.batch();

  for (const snapshot of docs) {
    const data = rewriteStorageUrls(snapshot.data, sourceBucket);
    batch.set(destDb.collection(collectionName).doc(snapshot.id), data);
  }

  await batch.commit();
  return docs.length;
}

async function listClientStoragePaths(storage: ClientStorage, prefix: string): Promise<string[]> {
  const paths: string[] = [];

  async function walk(prefixRef: ReturnType<typeof ref>): Promise<void> {
    const result = await listAll(prefixRef);
    for (const item of result.items) {
      paths.push(item.fullPath);
    }
    for (const nestedPrefix of result.prefixes) {
      await walk(nestedPrefix);
    }
  }

  try {
    await walk(ref(storage, prefix));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`  Could not list ${prefix}/: ${message}`);
  }

  return paths;
}

async function listAdminStoragePaths(
  adminApp: AdminApp,
  bucketName: string,
  prefix: string,
): Promise<string[]> {
  const bucket = getAdminStorage(adminApp).bucket(bucketName);
  const [files] = await bucket.getFiles({ prefix: `${prefix}/` });
  return files.map((file) => file.name);
}

function initMigrationClients(options: MigrateOptions): MigrationClients {
  const sourceConfig = loadSourceConfig();
  const targetConfig = loadTargetConfig();

  if (sourceConfig.projectId === targetConfig.projectId) {
    throw new Error(
      `Source and target project IDs are the same (${sourceConfig.projectId}). Aborting.`,
    );
  }

  const sourceServiceAccountPath = optionalEnv("SOURCE_FIREBASE_SERVICE_ACCOUNT");
  const targetServiceAccountPath = optionalEnv("TARGET_FIREBASE_SERVICE_ACCOUNT");

  if (
    !options.dryRun &&
    ((!options.skipFirestore && !targetServiceAccountPath) ||
      (!options.skipStorage && !targetServiceAccountPath))
  ) {
    throw new Error(
      "TARGET_FIREBASE_SERVICE_ACCOUNT is required for writes.\n" +
        "Download a service account key from Firebase Console -> Project Settings -> Service accounts,\n" +
        "save it as ./matric-unlocked-firebase-adminsdk-fbsvc-17c7bd1818.json, and set TARGET_FIREBASE_SERVICE_ACCOUNT in .env.target.local.",
    );
  }

  let sourceClientApp: FirebaseApp | undefined;
  let sourceClientDb: ClientFirestore | undefined;
  let sourceClientStorage: ClientStorage | undefined;

  let sourceAdminApp: AdminApp | undefined;
  let sourceAdminDb: AdminFirestore | undefined;

  if (sourceServiceAccountPath) {
    sourceAdminApp = initializeAdminApp(
      {
        credential: cert(loadServiceAccount(sourceServiceAccountPath)),
        projectId: sourceConfig.projectId,
        storageBucket: sourceConfig.storageBucket,
      },
      "source-admin",
    );
    sourceAdminDb = getAdminFirestore(sourceAdminApp);
  } else {
    sourceClientApp = initializeClientApp(
      {
        apiKey: sourceConfig.apiKey,
        authDomain: sourceConfig.authDomain,
        projectId: sourceConfig.projectId,
        storageBucket: sourceConfig.storageBucket,
        messagingSenderId: sourceConfig.messagingSenderId,
        appId: sourceConfig.appId,
      },
      "source-client",
    );
    sourceClientDb = getClientFirestore(sourceClientApp);
    sourceClientStorage = getClientStorage(sourceClientApp);
  }

  let targetAdminApp: AdminApp | undefined;
  let targetAdminDb: AdminFirestore | undefined;

  if (targetServiceAccountPath) {
    targetAdminApp = initializeAdminApp(
      {
        credential: cert(loadServiceAccount(targetServiceAccountPath)),
        projectId: targetConfig.projectId,
        storageBucket: targetConfig.storageBucket,
      },
      "target-admin",
    );
    targetAdminDb = getAdminFirestore(targetAdminApp);
  }

  async function* readDocuments(collectionName: CollectionName): AsyncGenerator<MigrationDocument[]> {
    if (sourceAdminDb) {
      yield* paginateAdminCollection(sourceAdminDb, collectionName);
      return;
    }

    if (!sourceClientDb) {
      throw new Error("No source Firestore client configured.");
    }

    yield* paginateClientCollection(sourceClientDb, collectionName);
  }

  async function writeDocuments(
    collectionName: CollectionName,
    docs: MigrationDocument[],
    sourceBucket: string,
    dryRun: boolean,
  ): Promise<number> {
    if (dryRun || docs.length === 0) {
      return docs.length;
    }

    if (!targetAdminDb) {
      throw new Error(
        "TARGET_FIREBASE_SERVICE_ACCOUNT is required for Firestore writes. See --help for setup.",
      );
    }

    return writeAdminDocumentChunk(targetAdminDb, collectionName, docs, sourceBucket, dryRun);
  }

  async function listStoragePrefix(prefix: string): Promise<string[]> {
    if (sourceAdminApp) {
      try {
        return await listAdminStoragePaths(sourceAdminApp, sourceConfig.storageBucket, prefix);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`  Could not list ${prefix}/: ${message}`);
        return [];
      }
    }

    if (!sourceClientStorage) {
      return [];
    }

    return listClientStoragePaths(sourceClientStorage, prefix);
  }

  async function copyStorageFile(storagePath: string, dryRun: boolean): Promise<void> {
    if (dryRun) return;

    if (!targetAdminApp) {
      throw new Error(
        "TARGET_FIREBASE_SERVICE_ACCOUNT is required for Storage writes. See --help for setup.",
      );
    }

    if (sourceAdminApp) {
      const sourceBucket = getAdminStorage(sourceAdminApp).bucket(sourceConfig.storageBucket);
      const targetBucket = getAdminStorage(targetAdminApp).bucket(targetConfig.storageBucket);
      const sourceFile = sourceBucket.file(storagePath);
      const [exists] = await sourceFile.exists();
      if (!exists) {
        throw new Error("Source file not found");
      }

      const [metadata] = await sourceFile.getMetadata();
      await sourceFile.copy(targetBucket.file(storagePath));

      if (metadata.contentType || metadata.metadata) {
        await targetBucket.file(storagePath).setMetadata({
          contentType: metadata.contentType,
          metadata: metadata.metadata,
        });
      }

      return;
    }

    if (!sourceClientStorage) {
      throw new Error("No source Storage client configured.");
    }

    const sourceRef = ref(sourceClientStorage, storagePath);
    const [bytes, metadata] = await Promise.all([getBytes(sourceRef), getMetadata(sourceRef)]);
    const targetBucket = getAdminStorage(targetAdminApp).bucket(targetConfig.storageBucket);
    await targetBucket.file(storagePath).save(Buffer.from(bytes), {
      contentType: metadata.contentType,
      metadata: metadata.customMetadata,
    });
  }

  return {
    sourceConfig,
    targetConfig,
    readDocuments,
    writeDocuments,
    listStoragePrefix,
    copyStorageFile,
  };
}

async function migrateCollection(
  clients: MigrationClients,
  collectionName: CollectionName,
  dryRun: boolean,
): Promise<number> {
  let copied = 0;
  let pending: MigrationDocument[] = [];

  for await (const page of clients.readDocuments(collectionName)) {
    pending.push(...page);

    while (pending.length >= WRITE_BATCH_SIZE) {
      const chunk = pending.splice(0, WRITE_BATCH_SIZE);
      copied += await clients.writeDocuments(
        collectionName,
        chunk,
        clients.sourceConfig.storageBucket,
        dryRun,
      );
      console.log(`  ${collectionName}: ${copied} documents processed...`);
    }
  }

  if (pending.length > 0) {
    copied += await clients.writeDocuments(
      collectionName,
      pending,
      clients.sourceConfig.storageBucket,
      dryRun,
    );
  }

  return copied;
}

async function collectReferencedStoragePaths(
  clients: MigrationClients,
  questionImagesOnly: boolean,
): Promise<Set<string>> {
  const paths = new Set<string>();

  for await (const page of clients.readDocuments("questions")) {
    for (const snapshot of page) {
      const imagePath = snapshot.data.image_path;
      if (typeof imagePath !== "string") continue;

      const path = extractStoragePath(imagePath);
      if (!path?.includes("/")) continue;
      if (questionImagesOnly && !isQuestionImagePath(path)) continue;
      paths.add(path);
    }
  }

  if (questionImagesOnly) {
    return paths;
  }

  for await (const page of clients.readDocuments("past_papers")) {
    for (const snapshot of page) {
      const data = snapshot.data;
      if (typeof data.pdfPath === "string") {
        const path = extractStoragePath(data.pdfPath);
        if (path) paths.add(path);
      }

      if (Array.isArray(data.images)) {
        for (const image of data.images) {
          if (image && typeof image === "object" && typeof image.path === "string") {
            const path = extractStoragePath(image.path);
            if (path) paths.add(path);
          }
        }
      }
    }
  }

  return paths;
}

async function migrateStorage(
  clients: MigrationClients,
  storagePrefixes: string[],
  questionImagesOnly: boolean,
  dryRun: boolean,
): Promise<number> {
  const discovered = new Set<string>();

  for (const prefix of storagePrefixes) {
    const listed = await clients.listStoragePrefix(prefix);
    for (const path of listed) discovered.add(path);
    console.log(`  Found ${listed.length} files under ${prefix}/`);
  }

  const referenced = await collectReferencedStoragePaths(clients, questionImagesOnly);
  for (const path of referenced) discovered.add(path);

  const paths = [...discovered].sort();
  let copied = 0;

  for (const storagePath of paths) {
    try {
      await clients.copyStorageFile(storagePath, dryRun);
      copied += 1;
      if (copied % 25 === 0 || copied === paths.length) {
        console.log(`  storage: ${copied}/${paths.length} files processed...`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  Skipped ${storagePath}: ${message}`);
    }
  }

  return copied;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.dryRun && !options.confirm) {
    throw new Error("Pass --confirm to migrate, or --dry-run to preview.");
  }

  const clients = initMigrationClients(options);

  console.log(`Source project: ${clients.sourceConfig.projectId}`);
  console.log(`Target project: ${clients.targetConfig.projectId}`);
  console.log(options.dryRun ? "Mode: dry run" : "Mode: migrate");

  if (!options.skipFirestore) {
    console.log("\nFirestore:");
    for (const collectionName of options.collections) {
      const count = await migrateCollection(clients, collectionName, options.dryRun);
      const verb = options.dryRun ? "would copy" : "copied";
      console.log(`  ${collectionName}: ${verb} ${count} documents`);
    }
  }

  if (!options.skipStorage) {
    console.log("\nStorage:");
    if (options.questionImagesOnly) {
      console.log("  Scope: question images only");
    }
    const count = await migrateStorage(
      clients,
      options.storagePrefixes,
      options.questionImagesOnly,
      options.dryRun,
    );
    const verb = options.dryRun ? "would copy" : "copied";
    console.log(`  ${verb} ${count} files`);

    if (count === 0) {
      console.log(
        "\nNo storage files were found. Add SOURCE_FIREBASE_SERVICE_ACCOUNT for full bucket listing, or use gsutil:",
      );
      console.log(
        `  gsutil -m cp -r gs://${clients.sourceConfig.storageBucket}/question-images gs://${clients.targetConfig.storageBucket}/`,
      );
      console.log(
        `  gsutil -m cp -r gs://${clients.sourceConfig.storageBucket}/past-papers gs://${clients.targetConfig.storageBucket}/`,
      );
    }
  }

  if (options.dryRun) {
    console.log("\nDry run complete. Re-run with --confirm to apply.");
  } else {
    console.log("\nMigration complete.");
    console.log(
      `Update .env.local to point at ${clients.targetConfig.projectId}, then deploy Firestore/Storage rules.`,
    );
  }
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
