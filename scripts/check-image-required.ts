import { appendFileSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { checkImageRequired } from "../src/lib/check-image-required";
import {
  getAllQuestions,
  hasBeenImageChecked,
  hasEmptyImagePath,
  markQuestionImageCheckDone,
  updateQuestionImagePath,
  type Question,
} from "../src/lib/questions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const progressPath = join(__dirname, "..", "image-required-progress.jsonl");

interface ProgressEntry {
  questionId: string;
  image_required: boolean;
  confidence: number;
  reason: string;
  checked_at: string;
  applied?: boolean;
}

function parseArgs(argv: string[]) {
  const options: {
    dryRun: boolean;
    applyOnly: boolean;
    limit?: number;
    offset: number;
    subject?: string;
    grade?: number;
    model?: string;
    baseUrl?: string;
  } = {
    dryRun: false,
    applyOnly: false,
    offset: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--apply") {
      options.applyOnly = true;
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

    if (arg === "--model") {
      options.model = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--base-url") {
      options.baseUrl = argv[i + 1];
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
  console.log(`Check whether Firestore questions without images require one to be answerable.

Usage:
  npm run check:image-required [-- --dry-run] [--limit 10] [--offset 0] [--subject "Geography P1"] [--grade 1]
  npm run check:image-required -- --apply

Options:
  --dry-run           List questions that would be checked without calling Ollama
  --apply             Apply unapplied image_required results from image-required-progress.jsonl to Firestore
  --limit <number>    Process only this many matching questions
  --offset <number>   Skip this many matching questions before processing
  --subject <name>    Only process questions for this subject (matches the "name" field)
  --grade <number>    Only process questions for this grade (1 = Grade 12)
  --model <name>      Ollama model to use (default: llama3.1)
  --base-url <url>    Ollama API base URL (default: http://localhost:11434)
  --help, -h          Show this help message

Notes:
  - Reads from the Firestore "questions" collection.
  - Only questions with an empty image_path and no image_check are checked.
  - Questions already checked (image_check=done or image_path=image_required) are skipped.
  - Progress is appended to image-required-progress.jsonl after each check.
  - image_required results set image_path=image_required; others set image_check=done.
`);
}

function loadProgress(): Map<string, ProgressEntry> {
  const progress = new Map<string, ProgressEntry>();
  if (!existsSync(progressPath)) {
    return progress;
  }

  const lines = readFileSync(progressPath, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    const entry = JSON.parse(line) as ProgressEntry;
    const key = entry.questionId ?? (entry as { index?: number }).index?.toString();
    if (!key) continue;
    progress.set(key, {
      ...entry,
      questionId: entry.questionId ?? key,
    });
  }

  return progress;
}

function appendProgress(entry: ProgressEntry) {
  appendFileSync(progressPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function summarizeQuestion(question: Question): string {
  const text = (question.question ?? "").replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function filterQuestions(questions: Question[], options: ReturnType<typeof parseArgs>) {
  return questions
    .filter((question) => hasEmptyImagePath(question.image_path))
    .filter((question) => !hasBeenImageChecked(question))
    .filter((question) => {
      if (options.subject && question.name !== options.subject) return false;
      if (options.grade != null && question.grade !== options.grade) return false;
      return true;
    })
    .sort(
      (a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "") ||
        (a.grade ?? 0) - (b.grade ?? 0) ||
        a.id.localeCompare(b.id),
    );
}

async function applyProgress(questions: Question[]) {
  const progress = loadProgress();
  const questionsById = new Map(questions.map((question) => [question.id, question]));

  if (progress.size === 0) {
    console.log("No progress entries found. Nothing to apply.");
    return;
  }

  let applied = 0;
  let skipped = 0;

  for (const entry of progress.values()) {
    if (entry.applied) continue;

    const question = questionsById.get(entry.questionId);
    if (!question) {
      skipped += 1;
      continue;
    }
    if (hasBeenImageChecked(question)) {
      skipped += 1;
      continue;
    }

    if (entry.image_required) {
      if (!hasEmptyImagePath(question.image_path)) {
        skipped += 1;
        continue;
      }
      await updateQuestionImagePath(entry.questionId, "image_required");
      applied += 1;
      console.log(`Applied image_required to ${entry.questionId}.`);
      continue;
    }

    await markQuestionImageCheckDone(entry.questionId);
    applied += 1;
    console.log(`Applied image_check=done to ${entry.questionId}.`);
  }

  console.log(`Done. ${applied} applied, ${skipped} skipped.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const questions = await getAllQuestions();
  console.log(`Loaded ${questions.length} question(s) from Firestore.`);

  if (options.applyOnly) {
    await applyProgress(questions);
    return;
  }

  const progress = loadProgress();
  const candidates = filterQuestions(questions, options)
    .filter((question) => !progress.has(question.id))
    .slice(options.offset, options.limit == null ? undefined : options.offset + options.limit);

  console.log(`Found ${candidates.length} question(s) with empty image_path to check.`);

  if (candidates.length === 0) {
    return;
  }

  if (options.dryRun) {
    for (const question of candidates) {
      const subject = question.name ?? "Unknown subject";
      const topic = question.topic ?? "Unknown topic";
      console.log(`- [${question.id}] ${subject} / ${topic}: ${summarizeQuestion(question)}`);
    }
    console.log("\nDry run complete. No questions were checked.");
    return;
  }

  let checked = 0;
  let markedRequired = 0;
  let markedDone = 0;
  let failed = 0;

  for (const question of candidates) {
    checked += 1;
    const progressLabel = `[${checked}/${candidates.length}]`;
    const label = `${question.name ?? "Unknown subject"}: ${summarizeQuestion(question)}`;

    console.log(`${progressLabel} Checking ${question.id} ${label}...`);

    try {
      const result = await checkImageRequired(
        {
          subject: question.name ?? "",
          topic: question.topic ?? "",
          context: question.context ?? "",
          question: question.question ?? "",
          options: question.options,
          answer: question.answer ?? "",
        },
        {
          model: options.model,
          baseUrl: options.baseUrl,
        },
      );

      let applied = false;
      if (result.image_required) {
        await updateQuestionImagePath(question.id, "image_required");
        markedRequired += 1;
        applied = true;
        console.log(
          `${progressLabel} image_required=true (${result.confidence}) - ${result.reason}`,
        );
      } else {
        await markQuestionImageCheckDone(question.id);
        markedDone += 1;
        applied = true;
        console.log(
          `${progressLabel} image_required=false, image_check=done (${result.confidence}) - ${result.reason}`,
        );
      }

      appendProgress({
        questionId: question.id,
        image_required: result.image_required,
        confidence: result.confidence,
        reason: result.reason,
        checked_at: new Date().toISOString(),
        applied,
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`${progressLabel} Failed: ${message}`);
    }
  }

  console.log(
    `\nDone. ${checked} checked, ${markedRequired} marked image_required, ${markedDone} marked image_check=done, ${failed} failed.`,
  );
  console.log(`Progress saved to ${progressPath}.`);
}

main().catch((error) => {
  console.error(
    "Failed to check image requirements:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
