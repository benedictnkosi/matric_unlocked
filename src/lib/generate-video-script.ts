import {
  getQuestionsForSubjectAndExam,
  getQuestionsForSubjectAndGrade,
  getQuestionsTaggedWithTopic,
  serializeQuestionsForAnalysis,
} from "./questions";
import {
  generateExplainerVideoScript,
  identifyQuestionsForTopic,
  prepareQuestionsJsonForTopicMatching,
  type IdentifiedQuestion,
} from "./openai";
import { getExamLabel, getTopicById, getTopicLabel, saveTopicVideoScript } from "./topics";

export interface GenerateVideoScriptResult {
  topicId: string;
  questionCount: number;
  script: string;
}

export async function generateVideoScriptForTopic(
  topicId: string,
): Promise<GenerateVideoScriptResult> {
  const topic = await getTopicById(topicId);
  if (!topic) {
    throw new Error("Topic not found.");
  }

  if (!topic.subject || topic.grade == null) {
    throw new Error("Topic is missing subject or grade.");
  }

  const topicName = getTopicLabel(topic);
  const topicDescription =
    topic.description?.trim() || `Key exam concepts for ${topicName}.`;

  const exam =
    topic.exam === "june-exams" || topic.exam === "final-exams" ? topic.exam : null;

  const questions = exam
    ? await getQuestionsForSubjectAndExam(topic.subject, topic.grade, exam)
    : await getQuestionsForSubjectAndGrade(topic.subject, topic.grade);

  const examLabel = exam ? getExamLabel(exam) : `Grade ${topic.grade}`;

  if (questions.length === 0) {
    throw new Error(`No questions found for ${topic.subject} (${examLabel}).`);
  }

  const taggedQuestions = getQuestionsTaggedWithTopic(questions, topicName);

  let identifiedQuestions: IdentifiedQuestion[];

  if (taggedQuestions.length > 0) {
    identifiedQuestions = taggedQuestions.map((question) => ({
      question: question.question ?? "",
      context: question.context ?? "",
      options: question.options ?? null,
      answer: question.answer ?? "",
    }));
  } else {
    const questionsJson = prepareQuestionsJsonForTopicMatching(
      serializeQuestionsForAnalysis(questions),
    );

    identifiedQuestions = await identifyQuestionsForTopic(
      questionsJson,
      topicName,
      topicDescription,
    );
  }

  if (identifiedQuestions.length === 0) {
    throw new Error("No matching questions were identified for this topic.");
  }

  const script = await generateExplainerVideoScript(
    topicName,
    topic.subject,
    topicDescription,
    examLabel,
    identifiedQuestions,
  );

  await saveTopicVideoScript(topicId, script);

  return {
    topicId,
    questionCount: identifiedQuestions.length,
    script,
  };
}
