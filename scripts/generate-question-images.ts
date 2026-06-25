import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { generateQuestionImage } from "../src/lib/generate-question-image";
import { getAllQuestions, type Question } from "../src/lib/questions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = join(__dirname, "..", "public", "question-images");
const progressPath = join(__dirname, "..", "question-image-generation-progress.jsonl");

interface ProgressEntry {
  imagePath: string;
  questionId: string;
  generated_at: string;
}

interface ImageJob {
  imagePath: string;
  question: Question;
  relatedQuestionIds: string[];
}

function parseArgs(argv: string[]) {
  const options: {
    dryRun: boolean;
    force: boolean;
    limit?: number;
    offset: number;
    subject?: string;
    grade?: number;
    outputDir: string;
    model?: string;
    size?: string;
    quality?: string;
  } = {
    dryRun: false,
    force: false,
    offset: 0,
    outputDir: process.env.QUESTION_IMAGES_DIR ?? defaultOutputDir,
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

    if (arg === "--size") {
      options.size = argv[i + 1];
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Generate PNG images for Firestore questions that reference an image file.

Usage:
  npm run generate:question-images [-- --dry-run] [--limit 10] [--subject "Geography P1"] [--grade 1]

Options:
  --dry-run           List images that would be generated without calling OpenAI
  --force             Regenerate even when the PNG file already exists
  --limit <number>    Process only this many unique image files
  --offset <number>   Skip this many unique image files before processing
  --subject <name>    Only process questions for this subject
  --grade <number>    Only process questions for this grade (1 = Grade 12)
  --output-dir <path> Directory to save PNG files (default: public/question-images)
  --model <name>      Image model to use (default: gpt-image-1, falls back if unavailable)
  --size <size>       Image size (default: 1024x1024)
  --quality <level>   Image quality (default: low)
  --help, -h          Show this help message

Notes:
  - Only questions with image_path containing ".png" are processed.
  - Questions with image_path=image_required are skipped.
  - Question details are sent to the API without aiExplanation.
  - Multiple questions sharing the same image_path generate one PNG.
`);
}

export function hasPngImagePath(imagePath: string | null | undefined): boolean {
  const value = imagePath?.trim();
  if (!value || value === "image_required") return false;
  return value.toLowerCase().includes(".png");
}

function loadProgress(): Set<string> {
  const completed = new Set<string>();
  if (!existsSync(progressPath)) {
    return completed;
  }

  const lines = readFileSync(progressPath, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    const entry = JSON.parse(line) as ProgressEntry;
    completed.add(entry.imagePath);
  }

  return completed;
}

function appendProgress(entry: ProgressEntry) {
  appendFileSync(progressPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function summarizeQuestion(question: Question): string {
  const text = (question.question ?? "").replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function buildImageJobs(
  questions: Question[],
  options: ReturnType<typeof parseArgs>,
  progress: Set<string>,
): ImageJob[] {
  const jobsByImagePath = new Map<string, ImageJob>();

  for (const question of questions) {
    if (!hasPngImagePath(question.image_path)) continue;
    if (options.subject && question.name !== options.subject) continue;
    if (options.grade != null && question.grade !== options.grade) continue;

    const imagePath = question.image_path!.trim();
    const existing = jobsByImagePath.get(imagePath);

    if (existing) {
      existing.relatedQuestionIds.push(question.id);
      continue;
    }

    jobsByImagePath.set(imagePath, {
      imagePath,
      question,
      relatedQuestionIds: [question.id],
    });
  }

  return [...jobsByImagePath.values()]
    .filter((job) => options.force || !progress.has(job.imagePath))
    .filter((job) => options.force || !existsSync(join(options.outputDir, job.imagePath)))
    .sort(
      (a, b) =>
        (a.question.name ?? "").localeCompare(b.question.name ?? "") ||
        (a.question.grade ?? 0) - (b.question.grade ?? 0) ||
        a.imagePath.localeCompare(b.imagePath),
    )
    .slice(options.offset, options.limit == null ? undefined : options.offset + options.limit);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const questions = await getAllQuestions();
  const progress = loadProgress();

  mkdirSync(options.outputDir, { recursive: true });

  console.log(`Loaded ${questions.length} question(s) from Firestore.`);

  const jobs = buildImageJobs(questions, options, progress);
  console.log(`Found ${jobs.length} unique PNG image(s) to generate.`);

  if (jobs.length === 0) {
    return;
  }

  if (options.dryRun) {
    for (const job of jobs) {
      const subject = job.question.name ?? "Unknown subject";
      const topic = job.question.topic ?? "Unknown topic";
      console.log(
        `- ${job.imagePath} [${job.relatedQuestionIds.length} question(s)] ${subject} / ${topic}: ${summarizeQuestion(job.question)}`,
      );
    }
    console.log("\nDry run complete. No images were generated.");
    return;
  }

  let generated = 0;
  let failed = 0;

  for (const job of jobs) {
    generated += 1;
    const progressLabel = `[${generated}/${jobs.length}]`;
    const outputPath = join(options.outputDir, job.imagePath);

    console.log(
      `${progressLabel} Generating ${job.imagePath} from ${job.question.id} (${job.relatedQuestionIds.length} linked question(s))...`,
    );

    try {
      const imageBuffer = await generateQuestionImage(
        {
          subject: job.question.name ?? "",
          grade: job.question.grade,
          topic: job.question.topic,
          subTopic: job.question.subTopic,
          context: job.question.context,
          question: job.question.question ?? "",
          options: job.question.options,
          answer: job.question.answer,
          term: job.question.term,
          year: job.question.year,
        },
        {
          model: options.model,
          size: options.size,
          quality: options.quality,
        },
      );

      writeFileSync(outputPath, imageBuffer);
      appendProgress({
        imagePath: job.imagePath,
        questionId: job.question.id,
        generated_at: new Date().toISOString(),
      });

      console.log(`${progressLabel} Saved ${outputPath}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`${progressLabel} Failed for ${job.imagePath}: ${message}`);
    }
  }

  console.log(`\nDone. ${generated} processed, ${failed} failed.`);
  console.log(`Images saved to ${options.outputDir}.`);
  console.log(`Progress saved to ${progressPath}.`);
}

main().catch((error) => {
  console.error(
    "Failed to generate question images:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
