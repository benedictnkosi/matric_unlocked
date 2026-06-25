import { appendFileSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  classifyQuestionSubTopic,
  resolveSubTopicChoice,
  type SubTopicOption,
} from "../src/lib/classify-question-sub-topic";
import { getAllQuestions, updateQuestionSubTopic, type Question } from "../src/lib/questions";
import { getAllTopics, getTopicLabel, type Topic } from "../src/lib/topics";

const __dirname = dirname(fileURLToPath(import.meta.url));
const progressPath = join(__dirname, "..", "sub-topic-classification-progress.jsonl");

interface ProgressEntry {
  questionId: string;
  sub_topic_id: string;
  sub_topic_name: string;
  confidence: number;
  reason: string;
  checked_at: string;
}

interface SubTopicLookup {
  parentTopicsByKey: Map<string, Topic>;
  subTopicsByParentId: Map<string, Topic[]>;
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
    baseUrl?: string;
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
  console.log(`Classify Firestore questions into sub-topics using Ollama.

Usage:
  npm run classify:sub-topics [-- --dry-run] [--limit 10] [--offset 0] [--subject "Mathematics P1"] [--grade 1]

Options:
  --dry-run           List questions that would be classified without calling Ollama
  --force             Reclassify questions that already have a subTopic value
  --limit <number>    Process only this many matching questions
  --offset <number>   Skip this many matching questions before processing
  --subject <name>    Only process questions for this subject (matches the "name" field)
  --grade <number>    Only process questions for this grade (1 = Grade 12)
  --model <name>      Ollama model to use (default: llama3.1)
  --base-url <url>    Ollama API base URL (default: http://localhost:11434)
  --help, -h          Show this help message

Notes:
  - Reads questions from Firestore and sub-topics from the topics collection.
  - Matches parent topics by question.topic, subject, and grade.
  - Writes the chosen sub-topic name to question.subTopic in Firestore.
  - Progress is appended to sub-topic-classification-progress.jsonl after each classification.
`);
}

function normalizeTopicName(topic: string | undefined): string | null {
  const trimmed = topic?.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "no match ai") return null;
  return trimmed;
}

function topicLookupKey(grade: number, subject: string, topicName: string): string {
  return `${grade}:${subject}:${topicName.toLowerCase()}`;
}

function buildSubTopicLookup(topics: Topic[]): SubTopicLookup {
  const parentTopicsByKey = new Map<string, Topic>();
  const subTopicsByParentId = new Map<string, Topic[]>();

  for (const topic of topics) {
    if (topic.grade == null || !topic.subject) continue;

    if (!topic.parentTopicId) {
      const key = topicLookupKey(topic.grade, topic.subject, getTopicLabel(topic));
      parentTopicsByKey.set(key, topic);
      continue;
    }

    const list = subTopicsByParentId.get(topic.parentTopicId) ?? [];
    list.push(topic);
    subTopicsByParentId.set(topic.parentTopicId, list);
  }

  for (const [parentId, subTopics] of subTopicsByParentId) {
    subTopicsByParentId.set(
      parentId,
      subTopics.sort(
        (a, b) =>
          (a.order ?? 0) - (b.order ?? 0) ||
          getTopicLabel(a).localeCompare(getTopicLabel(b)),
      ),
    );
  }

  return { parentTopicsByKey, subTopicsByParentId };
}

function getSubTopicOptions(
  lookup: SubTopicLookup,
  question: Question,
): { parentTopic: Topic; subTopics: SubTopicOption[] } | null {
  const topicName = normalizeTopicName(question.topic);
  if (!topicName || !question.name || question.grade == null) {
    return null;
  }

  const parentTopic = lookup.parentTopicsByKey.get(
    topicLookupKey(question.grade, question.name, topicName),
  );
  if (!parentTopic) {
    return null;
  }

  const candidates = (lookup.subTopicsByParentId.get(parentTopic.id) ?? []).filter(
    (subTopic) =>
      subTopic.subject === question.name &&
      subTopic.grade === question.grade &&
      subTopic.parentTopicId === parentTopic.id,
  );

  if (candidates.length === 0) {
    return null;
  }

  return {
    parentTopic,
    subTopics: candidates.map((subTopic) => ({
      id: subTopic.id,
      name: getTopicLabel(subTopic),
      description: subTopic.description?.trim() || `Sub-topic for ${getTopicLabel(parentTopic)}.`,
    })),
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

function hasSubTopic(subTopic: string | undefined): boolean {
  return Boolean(subTopic?.trim());
}

function filterCandidates(
  questions: Question[],
  lookup: SubTopicLookup,
  progress: Map<string, ProgressEntry>,
  options: ReturnType<typeof parseArgs>,
) {
  return questions
    .filter((question) => normalizeTopicName(question.topic))
    .filter((question) => options.force || !hasSubTopic(question.subTopic))
    .filter((question) => !progress.has(question.id))
    .filter((question) => {
      if (options.subject && question.name !== options.subject) return false;
      if (options.grade != null && question.grade !== options.grade) return false;
      return getSubTopicOptions(lookup, question) != null;
    })
    .sort(
      (a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "") ||
        (a.grade ?? 0) - (b.grade ?? 0) ||
        (normalizeTopicName(a.topic) ?? "").localeCompare(normalizeTopicName(b.topic) ?? "") ||
        a.id.localeCompare(b.id),
    )
    .slice(options.offset, options.limit == null ? undefined : options.offset + options.limit);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [questions, topics] = await Promise.all([getAllQuestions(), getAllTopics()]);
  const lookup = buildSubTopicLookup(topics);
  const progress = loadProgress();

  console.log(`Loaded ${questions.length} question(s) and ${topics.length} topic(s) from Firestore.`);

  const candidates = filterCandidates(questions, lookup, progress, options);
  console.log(`Found ${candidates.length} question(s) ready for sub-topic classification.`);

  if (candidates.length === 0) {
    return;
  }

  if (options.dryRun) {
    for (const question of candidates) {
      const match = getSubTopicOptions(lookup, question);
      const subject = question.name ?? "Unknown subject";
      const topic = question.topic ?? "Unknown topic";
      const subTopicCount = match?.subTopics.length ?? 0;
      console.log(
        `- [${question.id}] ${subject} / ${topic} (${subTopicCount} sub-topics): ${summarizeQuestion(question)}`,
      );
    }
    console.log("\nDry run complete. No questions were classified.");
    return;
  }

  let classified = 0;
  let failed = 0;

  for (const question of candidates) {
    classified += 1;
    const progressLabel = `[${classified}/${candidates.length}]`;
    const match = getSubTopicOptions(lookup, question);
    if (!match) {
      failed += 1;
      console.error(`${progressLabel} Skipped ${question.id}: no matching sub-topics.`);
      continue;
    }

    const label = `${question.name ?? "Unknown subject"} / ${question.topic}: ${summarizeQuestion(question)}`;
    console.log(`${progressLabel} Classifying ${question.id} ${label}...`);

    try {
      const result = await classifyQuestionSubTopic(
        {
          subject: question.name ?? "",
          grade: question.grade ?? 0,
          parentTopic: getTopicLabel(match.parentTopic),
          context: question.context ?? "",
          question: question.question ?? "",
          options: question.options,
          answer: question.answer ?? "",
          subTopics: match.subTopics,
        },
        {
          model: options.model,
          baseUrl: options.baseUrl,
        },
      );

      const chosen = resolveSubTopicChoice(result, match.subTopics);
      await updateQuestionSubTopic(question.id, chosen.name);

      appendProgress({
        questionId: question.id,
        sub_topic_id: chosen.id,
        sub_topic_name: chosen.name,
        confidence: result.confidence,
        reason: result.reason,
        checked_at: new Date().toISOString(),
      });

      console.log(
        `${progressLabel} subTopic="${chosen.name}" (${result.confidence}) - ${result.reason}`,
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`${progressLabel} Failed: ${message}`);
    }
  }

  console.log(`\nDone. ${classified} processed, ${failed} failed.`);
  console.log(`Progress saved to ${progressPath}.`);
}

main().catch((error) => {
  console.error(
    "Failed to classify question sub-topics:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
