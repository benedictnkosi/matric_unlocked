import {
  deleteQuestionsAndTopicsBySubjectName,
  formatDeleteSubjectDataSummary,
} from "../src/lib/delete-subject-data";

function parseArgs(argv: string[]) {
  const options: {
    dryRun: boolean;
    confirm: boolean;
    subject?: string;
    grade?: number;
  } = {
    dryRun: false,
    confirm: false,
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

  if (!options.subject?.trim()) {
    throw new Error("Subject name is required. Use --subject \"Mathematics P1\".");
  }

  return options;
}

function printHelp() {
  console.log(`Delete all questions and topics for a subject by name.

Usage:
  npm run delete:subject -- --subject "Mathematics P1" [--grade 1] [--dry-run] [--confirm]

Arguments:
  <subject name>      Subject name (alternative to --subject)

Options:
  --subject <name>    Subject name, e.g. "Mathematics P1"
  --grade <number>    Optional grade id (1 = Grade 12, 2 = Grade 11, 3 = Grade 10)
  --dry-run           Show what would be deleted without deleting anything
  --confirm           Required to perform the deletion
  --help, -h          Show this help message

Examples:
  npm run delete:subject -- --subject "Mathematics P1" --grade 1 --dry-run
  npm run delete:subject -- "Mathematics P1" --grade 1 --confirm
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.dryRun && !options.confirm) {
    throw new Error("Pass --confirm to delete data, or --dry-run to preview only.");
  }

  const results = await deleteQuestionsAndTopicsBySubjectName({
    subjectName: options.subject!.trim(),
    grade: options.grade,
    dryRun: options.dryRun,
  });

  console.log(formatDeleteSubjectDataSummary(results));

  if (options.dryRun) {
    console.log("\nDry run complete. No data was deleted.");
    return;
  }

  console.log("\nDeletion complete.");
}

main().catch((error) => {
  console.error("Failed to delete subject data:", error instanceof Error ? error.message : error);
  process.exit(1);
});
