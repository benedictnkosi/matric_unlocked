import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  extractTopicsFromQuestions,
  prepareQuestionsForPrompt,
  type GeneratedTopic,
} from "./openai";
import {
  getQuestionsForSubjectAndGrade,
  getQuestionsTaggedWithTopic,
  getTopTopicsByQuestionCount,
  serializeQuestionsForAnalysis,
} from "./questions";
import { getSubjectById, getSubjectLabel } from "./subjects";
import { deleteTopicsForSubject, saveGeneratedTopics } from "./topics";

export interface GenerateTopicsResult {
  questionCount: number;
  topicCount: number;
  jsonFilePath: string;
  source: "question-topics" | "ai";
}

const MIN_TAGGED_TOPICS = 5;
const TOP_TOPICS_LIMIT = 10;

export async function generateTopicsForSubject(
  subjectId: string,
): Promise<GenerateTopicsResult> {
  const subject = await getSubjectById(subjectId);
  if (!subject) {
    throw new Error("Subject not found.");
  }

  if (subject.grade == null) {
    throw new Error("Subject is missing a grade.");
  }

  const subjectName = getSubjectLabel(subject);
  const questions = await getQuestionsForSubjectAndGrade(subjectName, subject.grade);

  if (questions.length === 0) {
    throw new Error(`No questions found for ${subjectName} (Grade ${subject.grade}).`);
  }

  const outputDir = join(tmpdir(), "generated-questions");
  await mkdir(outputDir, { recursive: true });

  const safeSubjectSlug = subjectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const jsonFilePath = join(
    outputDir,
    `${safeSubjectSlug}-grade-${subject.grade}.json`,
  );

  const payload = {
    subject: subjectName,
    grade: subject.grade,
    questionCount: questions.length,
    questions: serializeQuestionsForAnalysis(questions),
  };

  await writeFile(jsonFilePath, JSON.stringify(payload, null, 2), "utf8");

  const topTopics = getTopTopicsByQuestionCount(questions, TOP_TOPICS_LIMIT);

  let generatedTopics: Array<GeneratedTopic & { questionCount?: number }>;
  let source: GenerateTopicsResult["source"];

  if (topTopics.length >= MIN_TAGGED_TOPICS) {
    generatedTopics = topTopics.map((topic) => ({
      name: topic.name,
      description: "",
      questionCount: topic.questionCount,
    }));
    source = "question-topics";
  } else {
    const aiTopics = await extractTopicsFromQuestions(
      subjectName,
      `Grade ${subject.grade}`,
      prepareQuestionsForPrompt(payload.questions),
    );
    generatedTopics = aiTopics.map((topic) => ({
      ...topic,
      questionCount: getQuestionsTaggedWithTopic(questions, topic.name).length,
    }));
    source = "ai";
  }

  await deleteTopicsForSubject(subjectName, subject.grade);
  await saveGeneratedTopics({
    subject: subjectName,
    grade: subject.grade,
    topics: generatedTopics,
  });

  return {
    questionCount: questions.length,
    topicCount: generatedTopics.length,
    jsonFilePath,
    source,
  };
}
