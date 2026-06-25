import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { cert, initializeApp, type App } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getTopicImageFilename } from "../src/lib/generate-topic-image";
import { getTopicLabel, type Topic } from "../src/lib/topics";
import { matchesSubjectFilter } from "../src/lib/subjects";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultInputDir = join(__dirname, "..", "public", "topic-images");
const STORAGE_PREFIX = "topic-images";
const READ_BATCH_SIZE = 500;

interface MigrateOptions {
  dryRun: boolean;
  confirm: boolean;
  force: boolean;
  skipStorage: boolean;
  skipFirestore: boolean;
  inputDir: string;
  limit?: number;
  offset: number;
  subject?: string;
  grade?: number;
}

interface TopicImageJob {
  topicId: string;
  filename: string;
  storagePath: string;
  localPath: string;
  topic?: Topic;
  uploadNeeded: boolean;
  firestoreUpdateNeeded: boolean;
}

interface FirebaseTargetConfig {
  projectId: string;
  storageBucket: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadTargetConfig(): FirebaseTargetConfig {
  return {
    projectId: requireEnv("TARGET_FIREBASE_PROJECT_ID"),
    storageBucket: requireEnv("TARGET_FIREBASE_STORAGE_BUCKET"),
  };
}

function loadServiceAccount(path: string) {
  const absolutePath = resolve(path);
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

function parseArgs(argv: string[]): MigrateOptions {
  const options: MigrateOptions = {
    dryRun: false,
    confirm: false,
    force: false,
    skipStorage: false,
    skipFirestore: false,
    inputDir: process.env.TOPIC_IMAGES_DIR ?? defaultInputDir,
    offset: 0,
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

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--skip-storage") {
      options.skipStorage = true;
      continue;
    }

    if (arg === "--skip-firestore") {
      options.skipFirestore = true;
      continue;
    }

    if (arg === "--input-dir") {
      options.inputDir = argv[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--limit") {
      const limit = Number.parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`Invalid limit: ${argv[i + 1] ?? ""}`);
      }
      options.limit = limit;
      i += 1;
      continue;
    }

    if (arg === "--offset") {
      const offset = Number.parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isInteger(offset) || offset < 0) {
        throw new Error(`Invalid offset: ${argv[i + 1] ?? ""}`);
      }
      options.offset = offset;
      i += 1;
      continue;
    }

    if (arg === "--subject") {
      options.subject = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--grade") {
      const grade = Number.parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isInteger(grade)) {
        throw new Error(`Invalid grade: ${argv[i + 1] ?? ""}`);
      }
      options.grade = grade;
      i += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (!arg.startsWith("-") && !options.subject) {
      options.subject = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Upload local topic card images to Firebase Storage on the matric-unlocked project.

Target project env vars (from .env.target.local):
  TARGET_FIREBASE_PROJECT_ID
  TARGET_FIREBASE_STORAGE_BUCKET
  TARGET_FIREBASE_SERVICE_ACCOUNT

Usage:
  npm run migrate:topic-images -- --dry-run
  npm run migrate:topic-images -- --confirm
  npm run migrate:topic-images -- --confirm --subject "Life Sciences P1"
  npm run migrate:topic-images -- --confirm --limit 10

Options:
  --dry-run           List files that would be uploaded without writing
  --confirm           Required to perform the migration
  --force             Re-upload files and overwrite Firestore imagePath values
  --skip-storage      Only update Firestore imagePath fields
  --skip-firestore    Only upload files to Storage
  --input-dir <path>  Local image directory (default: public/topic-images)
  --limit <number>    Process only this many images
  --offset <number>   Skip this many images before processing
  --subject <name>    Only migrate images for topics in this subject
  --grade <number>    Only migrate images for topics in this grade
  --help, -h          Show this help message

Notes:
  - Local files must be named {topicId}.jpg
  - Files are uploaded to topic-images/{topicId}.jpg in Storage
  - topics/{topicId}.imagePath is set to the Storage path
  - Skips upload when the Storage file already exists (use --force to overwrite)
`);
}

function listLocalTopicImages(inputDir: string): string[] {
  if (!existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }

  return readdirSync(inputDir)
    .filter((name) => name.endsWith(".jpg") || name.endsWith(".jpeg"))
    .sort();
}

function toStoragePath(filename: string): string {
  return `${STORAGE_PREFIX}/${filename}`;
}

async function loadTopics(app: App): Promise<Map<string, Topic>> {
  const db = getFirestore(app);
  const topics = new Map<string, Topic>();
  let lastId: string | null = null;

  while (true) {
    let pageQuery = db.collection("topics").orderBy(FieldPath.documentId()).limit(READ_BATCH_SIZE);

    if (lastId) {
      pageQuery = pageQuery.startAfter(lastId);
    }

    const snapshot = await pageQuery.get();
    if (snapshot.empty) break;

    for (const docSnapshot of snapshot.docs) {
      topics.set(docSnapshot.id, {
        id: docSnapshot.id,
        ...(docSnapshot.data() as Omit<Topic, "id">),
      });
    }

    lastId = snapshot.docs[snapshot.docs.length - 1]?.id ?? null;
    if (snapshot.docs.length < READ_BATCH_SIZE) break;
  }

  return topics;
}

function topicMatchesFilters(topic: Topic | undefined, options: MigrateOptions): boolean {
  if (options.subject || options.grade != null) {
    if (!topic) return false;
  }

  if (!topic) {
    return true;
  }

  if (topic.parentTopicId) {
    return false;
  }

  if (options.grade != null && topic.grade !== options.grade) {
    return false;
  }

  if (options.subject && !matchesSubjectFilter(topic.subject ?? "", options.subject)) {
    return false;
  }

  return true;
}

async function buildJobs(
  app: App,
  options: MigrateOptions,
): Promise<{ jobs: TopicImageJob[]; warnings: string[] }> {
  const filenames = listLocalTopicImages(options.inputDir);
  const topics = await loadTopics(app);
  const bucket = getStorage(app).bucket();
  const warnings: string[] = [];
  const jobs: TopicImageJob[] = [];

  for (const filename of filenames) {
    const topicId = filename.replace(/\.jpe?g$/i, "");
    const expectedFilename = getTopicImageFilename(topicId);

    if (filename !== expectedFilename) {
      warnings.push(`Skipping ${filename}: expected filename ${expectedFilename}`);
      continue;
    }

    const topic = topics.get(topicId);
    if (!topicMatchesFilters(topic, options)) {
      continue;
    }

    if (topic == null) {
      warnings.push(`No Firestore topic found for ${filename}`);
    }

    const storagePath = toStoragePath(filename);
    const localPath = join(options.inputDir, filename);
    const currentImagePath = topic?.imagePath?.trim() ?? "";

    let uploadNeeded = !options.skipStorage;
    if (uploadNeeded && !options.force) {
      const [exists] = await bucket.file(storagePath).exists();
      uploadNeeded = !exists;
    }

    const firestoreUpdateNeeded =
      !options.skipFirestore && (options.force || currentImagePath !== storagePath);

    if (!uploadNeeded && !firestoreUpdateNeeded) {
      continue;
    }

    jobs.push({
      topicId,
      filename,
      storagePath,
      localPath,
      topic,
      uploadNeeded,
      firestoreUpdateNeeded,
    });
  }

  const sliced = jobs.slice(
    options.offset,
    options.limit == null ? undefined : options.offset + options.limit,
  );

  return { jobs: sliced, warnings };
}

async function uploadTopicImage(app: App, job: TopicImageJob): Promise<void> {
  const bucket = getStorage(app).bucket();
  const bytes = readFileSync(job.localPath);

  await bucket.file(job.storagePath).save(bytes, {
    contentType: "image/jpeg",
    metadata: {
      cacheControl: "public, max-age=31536000",
    },
  });
}

async function updateTopicImagePaths(app: App, jobs: TopicImageJob[]): Promise<number> {
  const db = getFirestore(app);
  let updated = 0;

  for (let start = 0; start < jobs.length; start += 500) {
    const batch = db.batch();
    const chunk = jobs.slice(start, start + 500);

    for (const job of chunk) {
      if (!job.firestoreUpdateNeeded) continue;
      batch.update(db.collection("topics").doc(job.topicId), {
        imagePath: job.storagePath,
        imagePathUpdatedAt: new Date().toISOString(),
      });
      updated += 1;
    }

    await batch.commit();
  }

  return updated;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetConfig = loadTargetConfig();
  const serviceAccountPath = requireEnv("TARGET_FIREBASE_SERVICE_ACCOUNT");

  if (!options.dryRun && !options.confirm) {
    throw new Error("Pass --confirm to perform the migration, or use --dry-run to preview.");
  }

  const app = initializeApp(
    {
      credential: cert(loadServiceAccount(serviceAccountPath)),
      projectId: targetConfig.projectId,
      storageBucket: targetConfig.storageBucket,
    },
    "migrate-topic-images",
  );

  console.log(`Target project: ${targetConfig.projectId}`);
  console.log(`Storage bucket: ${targetConfig.storageBucket}`);
  console.log(`Input directory: ${options.inputDir}`);

  const { jobs, warnings } = await buildJobs(app, options);

  for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
  }

  const uploadCount = jobs.filter((job) => job.uploadNeeded).length;
  const firestoreCount = jobs.filter((job) => job.firestoreUpdateNeeded).length;

  console.log(
    `Found ${jobs.length} image(s) to process (${uploadCount} upload(s), ${firestoreCount} Firestore update(s)).`,
  );

  if (jobs.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  for (const job of jobs) {
    const actions = [
      job.uploadNeeded ? "upload" : null,
      job.firestoreUpdateNeeded ? "update Firestore" : null,
    ]
      .filter(Boolean)
      .join(", ");

    const label = job.topic ? getTopicLabel(job.topic) : job.topicId;
    console.log(`- [${actions}] ${job.storagePath} (${label})`);
  }

  if (options.dryRun) {
    console.log("\nDry run complete. No files were uploaded.");
    return;
  }

  let uploaded = 0;
  let firestoreUpdated = 0;
  let failed = 0;

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]!;
    const progressLabel = `[${index + 1}/${jobs.length}]`;

    try {
      if (job.uploadNeeded) {
        console.log(`${progressLabel} Uploading ${job.storagePath}...`);
        await uploadTopicImage(app, job);
        uploaded += 1;
      }

      if (job.firestoreUpdateNeeded) {
        await updateTopicImagePaths(app, [job]);
        firestoreUpdated += 1;
        console.log(`${progressLabel} Updated topics/${job.topicId}.imagePath`);
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${progressLabel} Failed for ${job.topicId}: ${message}`);
    }
  }

  console.log(`\nDone. ${uploaded} uploaded, ${firestoreUpdated} Firestore update(s), ${failed} failed.`);
}

main().catch((error) => {
  console.error(
    "Failed to migrate topic images:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
