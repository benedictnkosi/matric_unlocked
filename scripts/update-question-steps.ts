import { appendFileSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { doc, getDoc, writeBatch } from "firebase/firestore";
import { db } from "../src/lib/firebase";

const __dirname = dirname(fileURLToPath(import.meta.url));
const stepsPath = join(__dirname, "..", "maths-steps.json");
const questionsPath = join(__dirname, "..", "questions-with-topics.json");
const progressPath = join(__dirname, "..", "question-steps-progress.jsonl");
const BATCH_SIZE = 400;

interface StepsEntry {
  context?: string;
  question?: string;
  answer?: string;
  steps?: string;
}

interface QuestionSourceEntry {
  context?: string | null;
  question?: string;
  answer?: string;
}

interface MatchResult {
  index: number;
  questionId: string;
}

interface ProgressEntry {
  questionId: string;
  sourceIndex: number;
  stepsId?: string;
  applied: boolean;
  applied_at?: string;
  error?: string;
}

function parseArgs(argv: string[]) {
  const options: {
    dryRun: boolean;
    force: boolean;
    limit?: number;
    offset: number;
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

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Update Firestore questions with steps from maths-steps.json.

Usage:
  npm run update:question-steps [-- --dry-run] [--limit 10] [--offset 0] [--force]

Options:
  --dry-run           Match and verify questions without writing to Firestore
  --force             Overwrite an existing steps field
  --limit <number>    Process only this many entries from maths-steps.json
  --offset <number>   Skip this many entries before processing
  --help, -h          Show this help message

Matching:
  - Each maths-steps.json entry is matched to questions-with-topics.json by
    normalized context + question + answer.
  - The Firestore document id is derived from the matched index (q-000001, ...).
  - Before updating, the script verifies the Firestore document fields match.
  - Ambiguous matches (same key in multiple questions) are skipped with an error.
`);
}

function normalizeField(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function matchKey(entry: {
  context?: string | null;
  question?: string | null;
  answer?: string | null;
}): string {
  return [
    normalizeField(entry.context),
    normalizeField(entry.question),
    normalizeField(entry.answer),
  ].join("\0");
}

function toDocId(index: number): string {
  return `q-${String(index + 1).padStart(6, "0")}`;
}

function parseStepsField(steps: string, sourceIndex: number): Record<string, unknown> {
  try {
    const parsed = JSON.parse(steps) as Record<string, unknown>;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("steps must be a JSON object");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid steps JSON at maths-steps.json index ${sourceIndex}: ${message}`);
  }
}

function buildQuestionLookup(questions: QuestionSourceEntry[]): Map<string, number[]> {
  const lookup = new Map<string, number[]>();

  for (let index = 0; index < questions.length; index += 1) {
    const key = matchKey(questions[index] ?? {});
    const existing = lookup.get(key);
    if (existing) {
      existing.push(index);
    } else {
      lookup.set(key, [index]);
    }
  }

  return lookup;
}

function resolveMatch(
  entry: StepsEntry,
  sourceIndex: number,
  lookup: Map<string, number[]>,
): MatchResult {
  const key = matchKey(entry);
  const indices = lookup.get(key);

  if (!indices || indices.length === 0) {
    throw new Error(
      `No match in questions-with-topics.json for maths-steps.json index ${sourceIndex}`,
    );
  }

  if (indices.length > 1) {
    throw new Error(
      `Ambiguous match for maths-steps.json index ${sourceIndex}: ` +
        `${indices.length} questions share the same context/question/answer ` +
        `(indices ${indices.map((index) => index + 1).join(", ")}).`,
    );
  }

  const index = indices[0]!;
  return {
    index,
    questionId: toDocId(index),
  };
}

function loadProgress(): Map<string, ProgressEntry> {
  const progress = new Map<string, ProgressEntry>();
  if (!existsSync(progressPath)) {
    return progress;
  }

  const lines = readFileSync(progressPath, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    const entry = JSON.parse(line) as ProgressEntry;
    progress.set(String(entry.sourceIndex), entry);
  }

  return progress;
}

function appendProgress(entry: ProgressEntry) {
  appendFileSync(progressPath, `${JSON.stringify(entry)}\n`, "utf8");
}

async function verifyFirestoreQuestion(
  questionId: string,
  entry: StepsEntry,
  sourceIndex: number,
): Promise<void> {
  const snapshot = await getDoc(doc(db, "questions", questionId));
  if (!snapshot.exists()) {
    throw new Error(
      `Firestore document ${questionId} not found for maths-steps.json index ${sourceIndex}`,
    );
  }

  const data = snapshot.data() as QuestionSourceEntry;
  if (matchKey(data) !== matchKey(entry)) {
    throw new Error(
      `Firestore document ${questionId} does not match maths-steps.json index ${sourceIndex}. ` +
        `Expected question="${normalizeField(entry.question)}" but found ` +
        `"${normalizeField(data.question)}".`,
    );
  }
}

function summarizeEntry(entry: StepsEntry): string {
  const text = normalizeField(entry.question);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stepsEntries = JSON.parse(readFileSync(stepsPath, "utf8")) as StepsEntry[];
  const sourceQuestions = JSON.parse(
    readFileSync(questionsPath, "utf8"),
  ) as QuestionSourceEntry[];
  const lookup = buildQuestionLookup(sourceQuestions);
  const progress = loadProgress();

  const sliceStart = options.offset;
  const sliceEnd =
    options.limit == null ? stepsEntries.length : sliceStart + options.limit;
  const entries = stepsEntries.slice(sliceStart, sliceEnd);

  console.log(
    `Processing ${entries.length} of ${stepsEntries.length} steps entries ` +
      `(offset ${options.offset}${options.limit != null ? `, limit ${options.limit}` : ""}).`,
  );

  const plannedUpdates: Array<{
    sourceIndex: number;
    questionId: string;
    steps: Record<string, unknown>;
    stepsId?: string;
  }> = [];

  let skippedApplied = 0;
  let skippedExisting = 0;
  let failed = 0;

  for (let offset = 0; offset < entries.length; offset += 1) {
    const sourceIndex = sliceStart + offset;
    const entry = entries[offset]!;

    if (!entry.steps?.trim()) {
      failed += 1;
      console.error(`[${sourceIndex}] Missing steps field for "${summarizeEntry(entry)}"`);
      continue;
    }

    const existingProgress = progress.get(String(sourceIndex));
    if (existingProgress?.applied) {
      skippedApplied += 1;
      continue;
    }

    try {
      const match = resolveMatch(entry, sourceIndex, lookup);
      const steps = parseStepsField(entry.steps, sourceIndex);
      const stepsId = typeof steps.id === "string" ? steps.id : undefined;

      await verifyFirestoreQuestion(match.questionId, entry, sourceIndex);

      if (!options.force) {
        const snapshot = await getDoc(doc(db, "questions", match.questionId));
        const existingSteps = snapshot.data()?.steps;
        if (existingSteps != null) {
          skippedExisting += 1;
          console.log(
            `[${sourceIndex}] Skipping ${match.questionId} (steps already set; use --force to overwrite).`,
          );
          continue;
        }
      }

      plannedUpdates.push({
        sourceIndex,
        questionId: match.questionId,
        steps,
        stepsId,
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${sourceIndex}] ${message}`);
      appendProgress({
        questionId: "",
        sourceIndex,
        applied: false,
        error: message,
      });
    }
  }

  if (options.dryRun) {
    console.log(`Dry run complete. ${plannedUpdates.length} question(s) would be updated.`);
    for (const update of plannedUpdates.slice(0, 10)) {
      console.log(
        `  [${update.sourceIndex}] ${update.questionId}` +
          (update.stepsId ? ` (${update.stepsId})` : ""),
      );
    }
    if (plannedUpdates.length > 10) {
      console.log(`  ... and ${plannedUpdates.length - 10} more`);
    }
    console.log(
      `Skipped: ${skippedApplied} already applied, ${skippedExisting} already have steps, ${failed} failed.`,
    );
    return;
  }

  let updated = 0;

  for (let start = 0; start < plannedUpdates.length; start += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = plannedUpdates.slice(start, start + BATCH_SIZE);
    const now = new Date().toISOString();

    for (const update of chunk) {
      batch.update(doc(db, "questions", update.questionId), {
        steps: update.steps,
        stepsUpdatedAt: now,
      });
    }

    await batch.commit();
    updated += chunk.length;

    for (const update of chunk) {
      appendProgress({
        questionId: update.questionId,
        sourceIndex: update.sourceIndex,
        stepsId: update.stepsId,
        applied: true,
        applied_at: now,
      });
      console.log(
        `[${update.sourceIndex}] Updated ${update.questionId}` +
          (update.stepsId ? ` (${update.stepsId})` : ""),
      );
    }

    console.log(`Committed ${updated}/${plannedUpdates.length} updates...`);
  }

  console.log(
    `Done. Updated ${updated}, skipped ${skippedApplied} already applied, ` +
      `skipped ${skippedExisting} with existing steps, ${failed} failed.`,
  );
}

main().catch((error) => {
  console.error("Failed to update question steps:", error);
  process.exit(1);
});
