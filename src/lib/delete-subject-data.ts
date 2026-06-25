import { deleteQuestionsForSubject, getQuestionsForSubjectAndGrade } from "./questions";
import { getGradeLabel, getSubjectLabel, getSubjectsByName } from "./subjects";
import { deleteTopicsForSubject, getTopicsForSubject } from "./topics";

export interface DeleteSubjectDataResult {
  subjectName: string;
  grade: number;
  deletedQuestions: number;
  deletedTopics: number;
}

export interface DeleteSubjectDataOptions {
  subjectName: string;
  grade?: number;
  dryRun?: boolean;
}

export async function deleteQuestionsAndTopicsForSubject(
  subjectName: string,
  grade: number,
  dryRun = false,
): Promise<DeleteSubjectDataResult> {
  if (dryRun) {
    const [questions, topics] = await Promise.all([
      getQuestionsForSubjectAndGrade(subjectName, grade),
      getTopicsForSubject(subjectName, grade),
    ]);

    return {
      subjectName,
      grade,
      deletedQuestions: questions.length,
      deletedTopics: topics.length,
    };
  }

  const deletedQuestions = await deleteQuestionsForSubject(subjectName, grade);
  const deletedTopics = await deleteTopicsForSubject(subjectName, grade);

  return {
    subjectName,
    grade,
    deletedQuestions,
    deletedTopics,
  };
}

export async function deleteQuestionsAndTopicsBySubjectName(
  options: DeleteSubjectDataOptions,
): Promise<DeleteSubjectDataResult[]> {
  const subjects = await getSubjectsByName(options.subjectName, options.grade);

  if (subjects.length === 0) {
    throw new Error(
      options.grade != null
        ? `No subject found with name "${options.subjectName}" and grade ${options.grade}.`
        : `No subject found with name "${options.subjectName}".`,
    );
  }

  const results: DeleteSubjectDataResult[] = [];

  for (const subject of subjects) {
    const subjectName = getSubjectLabel(subject);
    if (subject.grade == null) {
      throw new Error(`Subject "${subjectName}" (${subject.id}) is missing a grade.`);
    }

    results.push(
      await deleteQuestionsAndTopicsForSubject(
        subjectName,
        subject.grade,
        options.dryRun,
      ),
    );
  }

  return results;
}

export function formatDeleteSubjectDataSummary(results: DeleteSubjectDataResult[]): string {
  const totalQuestions = results.reduce((sum, result) => sum + result.deletedQuestions, 0);
  const totalTopics = results.reduce((sum, result) => sum + result.deletedTopics, 0);

  const lines = results.map(
    (result) =>
      `- [${getGradeLabel(result.grade)}] ${result.subjectName}: ${result.deletedQuestions} question(s), ${result.deletedTopics} topic(s)`,
  );

  return `${lines.join("\n")}\n\nTotal: ${totalQuestions} question(s), ${totalTopics} topic(s).`;
}
