import {
  getQuestionsForSubjectAndExam,
  getQuestionsForSubjectAndGrade,
  getQuestionsTaggedWithTopic,
  serializeQuestionsForAnalysis,
} from "./questions";
import {
  extractSubTopicsFromQuestions,
  identifyQuestionsForTopic,
  prepareQuestionsJsonForTopicMatching,
  type IdentifiedQuestion,
} from "./openai";
import {
  deleteSubTopicsForParent,
  getAllTopics,
  getExamLabel,
  getTopicById,
  getTopicLabel,
  getParentTopicsWithoutSubTopics,
  saveGeneratedSubTopics,
} from "./topics";

export interface GenerateSubTopicsResult {
  topicId: string;
  subTopicCount: number;
  questionCount: number;
  subTopics: Array<{ id: string; name: string; description: string; questionCount?: number }>;
}

async function getMatchedQuestionsForTopic(
  topicId: string,
): Promise<{
  topic: NonNullable<Awaited<ReturnType<typeof getTopicById>>>;
  topicName: string;
  topicDescription: string;
  examLabel: string;
  identifiedQuestions: IdentifiedQuestion[];
}> {
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

  return {
    topic,
    topicName,
    topicDescription,
    examLabel,
    identifiedQuestions,
  };
}

export async function generateSubTopicsForTopic(
  topicId: string,
): Promise<GenerateSubTopicsResult> {
  const { topic, topicName, topicDescription, identifiedQuestions } =
    await getMatchedQuestionsForTopic(topicId);

  if (topic.parentTopicId) {
    throw new Error("Sub-topics can only be created for parent topics.");
  }

  const questionsJson = prepareQuestionsJsonForTopicMatching(identifiedQuestions);

  const generatedSubTopics = await extractSubTopicsFromQuestions(
    topicName,
    topicDescription,
    questionsJson,
  );

  if (generatedSubTopics.length === 0) {
    throw new Error("No sub-topics were generated.");
  }

  await deleteSubTopicsForParent(topicId);
  const subTopicIds = await saveGeneratedSubTopics({
    parentTopic: topic,
    subTopics: generatedSubTopics,
  });

  return {
    topicId,
    subTopicCount: generatedSubTopics.length,
    questionCount: identifiedQuestions.length,
    subTopics: generatedSubTopics.map((subTopic, index) => ({
      id: subTopicIds[index],
      name: subTopic.name,
      description: subTopic.description,
      questionCount: subTopic.questionCount,
    })),
  };
}

export interface GenerateSubTopicsBatchResult {
  topicId: string;
  topicName: string;
  success: boolean;
  result?: GenerateSubTopicsResult;
  error?: string;
}

export interface GenerateSubTopicsBatchOptions {
  subject?: string;
  grade?: number;
  dryRun?: boolean;
}

export async function generateSubTopicsForTopicsWithoutSubTopics(
  options: GenerateSubTopicsBatchOptions = {},
): Promise<GenerateSubTopicsBatchResult[]> {
  const allTopics = await getAllTopics();
  let candidates = getParentTopicsWithoutSubTopics(allTopics);

  if (options.subject) {
    candidates = candidates.filter((topic) => topic.subject === options.subject);
  }

  if (options.grade != null) {
    candidates = candidates.filter((topic) => topic.grade === options.grade);
  }

  candidates.sort(
    (a, b) =>
      (a.subject ?? "").localeCompare(b.subject ?? "") ||
      (a.grade ?? 0) - (b.grade ?? 0) ||
      getTopicLabel(a).localeCompare(getTopicLabel(b)),
  );

  if (options.dryRun) {
    return candidates.map((topic) => ({
      topicId: topic.id,
      topicName: getTopicLabel(topic),
      success: true,
    }));
  }

  const results: GenerateSubTopicsBatchResult[] = [];

  for (const topic of candidates) {
    const topicName = getTopicLabel(topic);

    try {
      const result = await generateSubTopicsForTopic(topic.id);
      results.push({
        topicId: topic.id,
        topicName,
        success: true,
        result,
      });
    } catch (error) {
      results.push({
        topicId: topic.id,
        topicName,
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate sub-topics.",
      });
    }
  }

  return results;
}
