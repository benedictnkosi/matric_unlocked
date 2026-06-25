import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  generateTopicImage,
  getTopicImageFilename,
  TOPIC_IMAGE_HEIGHT,
  TOPIC_IMAGE_WIDTH,
} from "../src/lib/generate-topic-image";
import { isAllowedSubject, matchesSubjectFilter } from "../src/lib/subjects";
import {
  getAllTopics,
  getTopicLabel,
  saveTopicImagePath,
  type Topic,
} from "../src/lib/topics";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(__dirname, "..", "public", "topic-images");
const defaultGrade = 1;

interface TopicImageJob {
  topic: Topic;
  filename: string;
  action: "generate" | "sync";
}

function isAllowedTopic(topic: Topic): boolean {
  return isAllowedSubject({
    id: topic.id,
    grade: topic.grade,
    name: topic.subject,
  });
}

function parseArgs(argv: string[]) {
  const options: {
    dryRun: boolean;
    force: boolean;
    limit?: number;
    offset: number;
    subject?: string;
    grade: number;
    outputDir: string;
    model?: string;
    quality?: string;
  } = {
    dryRun: false,
    force: false,
    offset: 0,
    grade: defaultGrade,
    outputDir: process.env.TOPIC_IMAGES_DIR ?? defaultOutputDir,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
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

    if (arg === "--output-dir") {
      options.outputDir = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--model") {
      options.model = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--quality") {
      options.quality = argv[i + 1];
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
  console.log(`Generate vertical topic card images for parent topics in Firestore.

Usage:
  npm run generate:topic-images [-- --dry-run] [--limit 10] [--subject "Mathematics P1"] [--grade 1]
  npm run generate:topic-images -- "Business Studies P1"

Arguments:
  <subject name>      Subject name (alternative to --subject)

Options:
  --dry-run           List topics that would be processed without calling OpenAI
  --force             Regenerate even when the JPEG file already exists
  --limit <number>    Process only this many topics
  --offset <number>   Skip this many topics before processing
  --subject <name>    Only process topics for this subject, e.g. "Mathematics P1"
                      Base names also work, e.g. "Mathematics" matches P1 and P2
  --grade <number>    Only process topics for this grade (default: 1 = Grade 12)
  --output-dir <path> Directory to save JPEG files (default: public/topic-images)
  --model <name>      Image model to use (default: gpt-image-1, falls back if unavailable)
  --quality <level>   OpenAI image quality (default: low)
  --help, -h          Show this help message

Output:
  - Portrait card images at ${TOPIC_IMAGE_WIDTH} x ${TOPIC_IMAGE_HEIGHT} pixels
  - Saved as JPEG for smaller file sizes
  - One image per parent topic document id (sub-topics are skipped)
  - Skips OpenAI when the JPEG already exists on disk
  - Writes imagePath on each topic document in Firestore
`);
}

function hasTopicImageFile(outputDir: string, filename: string): boolean {
  return existsSync(join(outputDir, filename));
}

function topicNeedsImagePathSync(topic: Topic, filename: string): boolean {
  return topic.imagePath?.trim() !== filename;
}

function buildTopicImageJobs(
  topics: Topic[],
  options: ReturnType<typeof parseArgs>,
): TopicImageJob[] {
  const jobs: TopicImageJob[] = [];

  for (const topic of topics) {
    if (topic.parentTopicId) continue;
    if (!isAllowedTopic(topic)) continue;
    if (topic.grade !== options.grade) continue;
    if (options.subject && !matchesSubjectFilter(topic.subject ?? "", options.subject)) continue;

    const filename = getTopicImageFilename(topic.id);
    const fileExists = hasTopicImageFile(options.outputDir, filename);
    const needsSync = topicNeedsImagePathSync(topic, filename);

    if (fileExists && !options.force) {
      if (needsSync) {
        jobs.push({
          topic,
          filename,
          action: "sync",
        });
      }
      continue;
    }

    jobs.push({
      topic,
      filename,
      action: "generate",
    });
  }

  return jobs
    .sort(
      (a, b) =>
        Number(a.action === "sync") - Number(b.action === "sync") ||
        (a.topic.subject ?? "").localeCompare(b.topic.subject ?? "") ||
        getTopicLabel(a.topic).localeCompare(getTopicLabel(b.topic)),
    )
    .slice(options.offset, options.limit == null ? undefined : options.offset + options.limit);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const allTopics = await getAllTopics();

  mkdirSync(options.outputDir, { recursive: true });

  console.log(`Loaded ${allTopics.length} topic(s) from Firestore.`);
  if (options.subject) {
    console.log(`Filtering by subject: ${options.subject}`);
  }

  const jobs = buildTopicImageJobs(allTopics, options);
  const generateCount = jobs.filter((job) => job.action === "generate").length;
  const syncCount = jobs.filter((job) => job.action === "sync").length;

  console.log(
    `Found ${generateCount} topic image(s) to generate and ${syncCount} to sync for grade ${options.grade}.`,
  );

  if (jobs.length === 0) {
    return;
  }

  if (options.dryRun) {
    for (const job of jobs) {
      console.log(
        `- [${job.action}] ${job.filename} ${job.topic.subject ?? "Unknown subject"} / ${getTopicLabel(job.topic)}`,
      );
    }
    console.log("\nDry run complete. No images were generated.");
    return;
  }

  let processed = 0;
  let generated = 0;
  let synced = 0;
  let failed = 0;

  for (const job of jobs) {
    processed += 1;
    const progressLabel = `[${processed}/${jobs.length}]`;
    const outputPath = join(options.outputDir, job.filename);

    if (job.action === "sync") {
      console.log(
        `${progressLabel} Syncing imagePath for ${job.topic.id} (${getTopicLabel(job.topic)})...`,
      );

      try {
        await saveTopicImagePath(job.topic.id, job.filename);
        synced += 1;
        console.log(`${progressLabel} Updated topics/${job.topic.id}.imagePath = ${job.filename}`);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`${progressLabel} Failed to sync ${job.topic.id}: ${message}`);
      }
      continue;
    }

    console.log(
      `${progressLabel} Generating ${job.filename} for ${job.topic.id} (${getTopicLabel(job.topic)})...`,
    );

    try {
      if (job.topic.subject == null || job.topic.grade == null) {
        throw new Error("Topic is missing subject or grade.");
      }

      const imageBuffer = await generateTopicImage(
        {
          subject: job.topic.subject,
          grade: job.topic.grade,
          topic: job.topic,
        },
        {
          model: options.model,
          quality: options.quality,
        },
      );

      writeFileSync(outputPath, imageBuffer);
      await saveTopicImagePath(job.topic.id, job.filename);
      generated += 1;

      console.log(`${progressLabel} Saved ${outputPath} and updated topics/${job.topic.id}.imagePath`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`${progressLabel} Failed for ${job.topic.id}: ${message}`);
    }
  }

  console.log(`\nDone. ${generated} generated, ${synced} synced, ${failed} failed.`);
  console.log(`Images saved to ${options.outputDir}.`);
}

main().catch((error) => {
  console.error(
    "Failed to generate topic images:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
