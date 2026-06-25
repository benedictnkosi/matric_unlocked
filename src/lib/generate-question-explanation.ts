import { generateQuestionExplanation } from "./openai";
import { getQuestionById, saveQuestionAiExplanation } from "./questions";

export interface GenerateQuestionExplanationResult {
  questionId: string;
  explanation: string;
}

export async function generateQuestionExplanationForQuestion(
  questionId: string,
): Promise<GenerateQuestionExplanationResult> {
  const question = await getQuestionById(questionId);
  if (!question) {
    throw new Error("Question not found.");
  }

  if (!question.question?.trim()) {
    throw new Error("Question text is missing.");
  }

  if (!question.answer?.trim()) {
    throw new Error("Question answer is missing.");
  }

  const explanation = await generateQuestionExplanation({
    subject: question.name ?? "",
    context: question.context ?? "",
    question: question.question,
    options: question.options,
    answer: question.answer,
    topic: question.topic,
  });

  await saveQuestionAiExplanation(questionId, explanation);

  return {
    questionId,
    explanation,
  };
}
