"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ExamPeriod } from "@/lib/topics";

const EXAM_LABELS: Record<ExamPeriod, string> = {
  "june-exams": "June exams",
  "final-exams": "Final exams",
};

const EXAM_PERIOD_STORAGE_KEY = "matric-unlocked:generate-topics-exam-period";

function isExamPeriod(value: string): value is ExamPeriod {
  return value === "june-exams" || value === "final-exams";
}

function readStoredExamPeriod(): ExamPeriod {
  if (typeof window === "undefined") {
    return "june-exams";
  }

  const stored = window.localStorage.getItem(EXAM_PERIOD_STORAGE_KEY);
  return stored && isExamPeriod(stored) ? stored : "june-exams";
}

function storeExamPeriod(exam: ExamPeriod) {
  window.localStorage.setItem(EXAM_PERIOD_STORAGE_KEY, exam);
}

interface GenerateTopicsFormProps {
  subjectId: string;
  existingTopicsByExam: Record<ExamPeriod, number>;
}

export function GenerateTopicsForm({
  subjectId,
  existingTopicsByExam,
}: GenerateTopicsFormProps) {
  const router = useRouter();
  const [exam, setExam] = useState<ExamPeriod>("june-exams");
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setExam(readStoredExamPeriod());
  }, []);

  function handleExamChange(nextExam: ExamPeriod) {
    setExam(nextExam);
    storeExamPeriod(nextExam);
  }

  const existingCount = existingTopicsByExam[exam];

  async function handleGenerate() {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/subjects/${subjectId}/generate-topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exam }),
      });

      const data = (await response.json()) as {
        error?: string;
        questionCount?: number;
        topicCount?: number;
        source?: "question-topics" | "ai";
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to generate topics.");
      }

      const sourceLabel =
        data.source === "ai"
          ? "using AI analysis"
          : "from the most-asked tagged topics";

      setSuccess(
        `Generated ${data.topicCount ?? 0} topics from ${data.questionCount ?? 0} questions ${sourceLabel}.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate topics.");
    } finally {
      setIsLoading(false);
      setIsConfirmOpen(false);
    }
  }

  function handleGenerateClick() {
    if (existingCount > 0) {
      setIsConfirmOpen(true);
      return;
    }

    void handleGenerate();
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Generate topics</h2>
      <p className="mt-1 text-sm text-slate-600">
        Use AI to analyse past exam questions and create the top 10 topics for this subject.
      </p>

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-2 text-sm font-medium text-slate-700">
          Exam period
          <select
            value={exam}
            onChange={(event) => handleExamChange(event.target.value as ExamPeriod)}
            disabled={isLoading}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-base font-normal text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50"
          >
            <option value="june-exams">June exams (terms 1 & 2)</option>
            <option value="final-exams">Final exams (terms 3 & 4)</option>
          </select>
        </label>

        <button
          type="button"
          onClick={handleGenerateClick}
          disabled={isLoading}
          className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
        >
          {isLoading ? "Generating..." : "Generate topics"}
        </button>
      </div>

      {isConfirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setIsConfirmOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-900">Replace existing topics?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This subject already has {existingCount} topic{existingCount === 1 ? "" : "s"} for{" "}
              {EXAM_LABELS[exam]}. Generating again will delete them and create new topics.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                disabled={isLoading}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={isLoading}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                {isLoading ? "Generating..." : "Replace topics"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}
    </div>
  );
}
