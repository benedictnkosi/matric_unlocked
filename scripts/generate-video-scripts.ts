import { generateVideoScriptForTopic } from "../src/lib/generate-video-script";
import { isAllowedSubject } from "../src/lib/subjects";
import {
  getAllTopics,
  getTopicLabel,
  getTopicsForVideoScriptGeneration,
  type Topic,
} from "../src/lib/topics";

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
    subject?: string;
    grade?: number;
  } = {
    dryRun: false,
    force: false,
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Generate explainer video scripts for all topics and sub-topics.

Usage:
  npm run generate:video-scripts [-- --dry-run] [--force] [--subject "Mathematics P1"] [--grade 1]

Options:
  --dry-run           List topics that would be processed without calling AI
  --force             Regenerate scripts even when one already exists
  --subject <name>    Only process topics for this subject
  --grade <number>    Only process topics for this grade (1 = Grade 12)
  --help, -h          Show this help message

Notes:
  - Sub-topics always get scripts.
  - Parent topics only get scripts when they have no sub-topics.
  - By default, topics that already have a script are skipped.
`);
}

function formatTopicType(topic: Topic): string {
  return topic.parentTopicId ? "sub-topic" : "topic";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const allTopics = await getAllTopics();

  let candidates = getTopicsForVideoScriptGeneration(allTopics)
    .filter(isAllowedTopic)
    .filter((topic) => {
      if (options.subject && topic.subject !== options.subject) return false;
      if (options.grade != null && topic.grade !== options.grade) return false;
      return true;
    });

  if (!options.force) {
    candidates = candidates.filter((topic) => !topic.videoScript?.trim());
  }

  candidates.sort(
    (a, b) =>
      (a.subject ?? "").localeCompare(b.subject ?? "") ||
      (a.grade ?? 0) - (b.grade ?? 0) ||
      Number(Boolean(a.parentTopicId)) - Number(Boolean(b.parentTopicId)) ||
      getTopicLabel(a).localeCompare(getTopicLabel(b)),
  );

  console.log(`Found ${candidates.length} topic(s)/sub-topic(s) to process.`);

  if (candidates.length === 0) {
    return;
  }

  if (options.dryRun) {
    for (const topic of candidates) {
      const subject = topic.subject ?? "Unknown subject";
      const grade = topic.grade ?? "?";
      const existing = topic.videoScript?.trim() ? " (has script)" : "";
      console.log(
        `- [Grade ${grade}] ${subject}: ${getTopicLabel(topic)} [${formatTopicType(topic)}]${existing} (${topic.id})`,
      );
    }
    console.log("\nDry run complete. No scripts were generated.");
    return;
  }

  let succeeded = 0;
  let failed = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const topic = candidates[index];
    const label = getTopicLabel(topic);
    const progress = `[${index + 1}/${candidates.length}]`;

    console.log(
      `${progress} Generating script for ${label} [${formatTopicType(topic)}]...`,
    );

    try {
      const result = await generateVideoScriptForTopic(topic.id);
      succeeded += 1;
      console.log(
        `${progress} Saved script from ${result.questionCount} matched question(s).`,
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`${progress} Failed for ${label}: ${message}`);
    }
  }

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
}

main().catch((error) => {
  console.error(
    "Failed to generate video scripts:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
