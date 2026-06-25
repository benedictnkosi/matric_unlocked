import { appendFileSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { generateQuestionExplanation } from "../src/lib/openai";
import {
  getAllQuestions,
  saveQuestionAiExplanation,
  type Question,
} from "../src/lib/questions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const progressPath = join(__dirname, "..", "question-explanation-progress.jsonl");

interface ProgressEntry {
  questionId: string;
  subject: string;
  checked_at: string;
}

function parseArgs(argv: string[]) {
  const options: {
    dryRun: boolean;
    force: boolean;
    limit?: number;
    offset: number;
    subject?: string;
    grade?: number;
    model?: string;
  } = {
    dryRun: false,
    force: false,
    offset: 0,
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

    if (arg === "--model") {
      options.model = argv[i + 1];
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

  if (!options.subject?.trim()) {
    throw new Error('Subject name is required. Use --subject "Business Studies P1".');
  }

  return options;
}

function printHelp() {
  console.log(`Generate AI explanations for Firestore questions using OpenAI.

Usage:
  npm run generate:question-explanations -- --subject "Business Studies P1" [--grade 1] [--dry-run] [--force]

Arguments:
  <subject name>      Subject name (alternative to --subject)

Options:
  --subject <name>    Subject name, e.g. "Business Studies P1" (required)
  --grade <number>    Only process questions for this grade (1 = Grade 12)
  --dry-run           List questions that would be processed without calling OpenAI
  --force             Regenerate explanations even when one already exists
  --limit <number>    Process only this many matching questions
  --offset <number>   Skip this many matching questions before processing
  --model <name>      OpenAI model to use (default: OPENAI_MODEL or gpt-4o)
  --help, -h          Show this help message

Notes:
  - Reads questions from Firestore and sends context, question, and answer to OpenAI.
  - Saves the explanation to question.aiExplanation in Firestore.
  - Progress is appended to question-explanation-progress.jsonl after each question.
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
    progress.set(entry.questionId, entry);
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

function hasExplanation(explanation: string | undefined): boolean {
  return Boolean(explanation?.trim());
}

function filterCandidates(
  questions: Question[],
  progress: Map<string, ProgressEntry>,
  options: ReturnType<typeof parseArgs>,
) {
  return questions
    .filter((question) => Boolean(question.question?.trim() && question.answer?.trim()))
    .filter((question) => options.force || !hasExplanation(question.aiExplanation))
    .filter((question) => !progress.has(question.id))
    .filter((question) => {
      if (question.name !== options.subject) return false;
      if (options.grade != null && question.grade !== options.grade) return false;
      return true;
    })
    .sort(
      (a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "") ||
        (a.grade ?? 0) - (b.grade ?? 0) ||
        (a.year ?? 0) - (b.year ?? 0) ||
        (a.term ?? 0) - (b.term ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .slice(options.offset, options.limit == null ? undefined : options.offset + options.limit);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const questions = await getAllQuestions();
  const progress = loadProgress();

  console.log(`Loaded ${questions.length} question(s) from Firestore.`);

  const candidates = filterCandidates(questions, progress, options);
  console.log(
    `Found ${candidates.length} question(s) to generate explanations for (${options.subject}).`,
  );

  if (candidates.length === 0) {
    return;
  }

  if (options.dryRun) {
    for (const question of candidates) {
      const existing = hasExplanation(question.aiExplanation) ? " (has explanation)" : "";
      console.log(
        `- [${question.id}] ${question.name ?? "Unknown subject"} / term ${question.term ?? "?"} / ${question.year ?? "?"}${existing}: ${summarizeQuestion(question)}`,
      );
    }
    console.log("\nDry run complete. No explanations were generated.");
    return;
  }

  if (options.model) {
    process.env.OPENAI_MODEL = options.model;
  }

  let succeeded = 0;
  let failed = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const question = candidates[index];
    const progressLabel = `[${index + 1}/${candidates.length}]`;
    const label = `${question.name ?? "Unknown subject"}: ${summarizeQuestion(question)}`;

    console.log(`${progressLabel} Generating explanation for ${question.id} ${label}...`);

    try {
      const explanation = await generateQuestionExplanation({
        subject: question.name ?? options.subject ?? "",
        context: question.context ?? "",
        question: question.question ?? "",
        options: question.options,
        answer: question.answer ?? "",
        topic: question.topic,
      });

      await saveQuestionAiExplanation(question.id, explanation);

      appendProgress({
        questionId: question.id,
        subject: question.name ?? options.subject ?? "",
        checked_at: new Date().toISOString(),
      });

      succeeded += 1;
      console.log(`${progressLabel} Saved explanation for ${question.id}.`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`${progressLabel} Failed for ${question.id}: ${message}`);
    }
  }

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
}

main().catch((error) => {
  console.error(
    "Failed to generate question explanations:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
