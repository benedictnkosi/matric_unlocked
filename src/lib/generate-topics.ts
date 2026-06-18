import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import {
  extractTopicsFromQuestions,
  prepareQuestionsForPrompt,
  type GeneratedTopic,
} from "./openai";
import {
  getQuestionsForSubjectAndExam,
  getTopTopicsByQuestionCount,
  serializeQuestionsForAnalysis,
} from "./questions";
import { getSubjectById, getSubjectLabel } from "./subjects";
import {
  deleteTopicsForExam,
  getExamLabel,
  saveGeneratedTopics,
  type ExamPeriod,
} from "./topics";

export interface GenerateTopicsResult {
  questionCount: number;
  topicCount: number;
  jsonFilePath: string;
  exam: ExamPeriod;
  source: "question-topics" | "ai";
}

const MIN_TAGGED_TOPICS = 5;
const TOP_TOPICS_LIMIT = 10;

export async function generateTopicsForSubject(
  subjectId: string,
  exam: ExamPeriod,
): Promise<GenerateTopicsResult> {
  const subject = await getSubjectById(subjectId);
  if (!subject) {
    throw new Error("Subject not found.");
  }

  if (subject.grade == null) {
    throw new Error("Subject is missing a grade.");
  }

  const subjectName = getSubjectLabel(subject);
  const questions = await getQuestionsForSubjectAndExam(subjectName, subject.grade, exam);

  if (questions.length === 0) {
    throw new Error(
      `No questions found for ${subjectName} (${getExamLabel(exam)}).`,
    );
  }

  const outputDir = join(process.cwd(), "tmp", "generated-questions");
  await mkdir(outputDir, { recursive: true });

  const safeSubjectSlug = subjectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const jsonFilePath = join(
    outputDir,
    `${safeSubjectSlug}-grade-${subject.grade}-${exam}.json`,
  );

  const payload = {
    subject: subjectName,
    grade: subject.grade,
    exam,
    questionCount: questions.length,
    questions: serializeQuestionsForAnalysis(questions),
  };

  await writeFile(jsonFilePath, JSON.stringify(payload, null, 2), "utf8");

  const topTopics = getTopTopicsByQuestionCount(questions, TOP_TOPICS_LIMIT);

  let generatedTopics: GeneratedTopic[];
  let source: GenerateTopicsResult["source"];

  if (topTopics.length >= MIN_TAGGED_TOPICS) {
    generatedTopics = topTopics.map((topic) => ({
      name: topic.name,
      description: "",
    }));
    source = "question-topics";
  } else {
    generatedTopics = await extractTopicsFromQuestions(
      subjectName,
      getExamLabel(exam),
      prepareQuestionsForPrompt(payload.questions),
    );
    source = "ai";
  }

  await deleteTopicsForExam(subjectName, subject.grade, exam);
  await saveGeneratedTopics({
    subject: subjectName,
    grade: subject.grade,
    exam,
    topics: generatedTopics,
  });

  return {
    questionCount: questions.length,
    topicCount: generatedTopics.length,
    jsonFilePath,
    exam,
    source,
  };
}
