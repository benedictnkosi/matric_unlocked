import { generateSubTopicsForTopic } from "../src/lib/generate-sub-topics";
import { getAllTopics, getParentTopicsWithoutSubTopics, getTopicLabel } from "../src/lib/topics";

function parseArgs(argv: string[]) {
  const options: {
    dryRun: boolean;
    subject?: string;
    grade?: number;
  } = {
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dry-run") {
      options.dryRun = true;
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
  console.log(`Generate sub-topics for all parent topics that do not have any yet.

Usage:
  npm run generate:sub-topics [-- --dry-run] [--subject "Subject name"] [--grade 12]

Options:
  --dry-run           List topics that would be processed without calling AI
  --subject <name>    Only process topics for this subject
  --grade <number>    Only process topics for this grade
  --help, -h          Show this help message
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const allTopics = await getAllTopics();
  const candidates = getParentTopicsWithoutSubTopics(allTopics).filter((topic) => {
    if (options.subject && topic.subject !== options.subject) return false;
    if (options.grade != null && topic.grade !== options.grade) return false;
    return true;
  });

  candidates.sort(
    (a, b) =>
      (a.subject ?? "").localeCompare(b.subject ?? "") ||
      (a.grade ?? 0) - (b.grade ?? 0) ||
      getTopicLabel(a).localeCompare(getTopicLabel(b)),
  );

  console.log(`Found ${candidates.length} parent topic(s) without sub-topics.`);

  if (candidates.length === 0) {
    return;
  }

  if (options.dryRun) {
    for (const topic of candidates) {
      const subject = topic.subject ?? "Unknown subject";
      const grade = topic.grade ?? "?";
      console.log(`- [Grade ${grade}] ${subject}: ${getTopicLabel(topic)} (${topic.id})`);
    }
    console.log("\nDry run complete. No sub-topics were generated.");
    return;
  }

  let succeeded = 0;
  let failed = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const topic = candidates[index];
    const label = getTopicLabel(topic);
    const progress = `[${index + 1}/${candidates.length}]`;

    console.log(`${progress} Generating sub-topics for ${label}...`);

    try {
      const result = await generateSubTopicsForTopic(topic.id);
      succeeded += 1;
      console.log(
        `${progress} Created ${result.subTopicCount} sub-topic(s) from ${result.questionCount} question(s).`,
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
  console.error("Failed to generate sub-topics:", error instanceof Error ? error.message : error);
  process.exit(1);
});
