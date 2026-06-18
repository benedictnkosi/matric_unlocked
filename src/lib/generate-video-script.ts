import {
  getQuestionsForSubjectAndExam,
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

  if (!topic.subject || topic.grade == null || !topic.exam) {
    throw new Error("Topic is missing subject, grade, or exam period.");
  }

  const topicName = getTopicLabel(topic);
  const topicDescription =
    topic.description?.trim() || `Key exam concepts for ${topicName}.`;

  const exam = topic.exam === "june-exams" || topic.exam === "final-exams"
    ? topic.exam
    : null;
  if (!exam) {
    throw new Error("Topic has an invalid exam period.");
  }

  const questions = await getQuestionsForSubjectAndExam(
    topic.subject,
    topic.grade,
    exam,
  );

  if (questions.length === 0) {
    throw new Error(`No questions found for ${topic.subject} (${getExamLabel(exam)}).`);
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
    getExamLabel(exam),
    identifiedQuestions,
  );

  await saveTopicVideoScript(topicId, script);

  return {
    topicId,
    questionCount: identifiedQuestions.length,
    script,
  };
}
