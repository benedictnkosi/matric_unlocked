"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface GenerateTopicsFormProps {
  subjectId: string;
  existingTopicCount: number;
}

export function GenerateTopicsForm({
  subjectId,
  existingTopicCount,
}: GenerateTopicsFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleGenerate() {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/subjects/${subjectId}/generate-topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    if (existingTopicCount > 0) {
      setIsConfirmOpen(true);
      return;
    }

    void handleGenerate();
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Generate topics</h2>
      <p className="mt-1 text-sm text-slate-600">
        Analyse all past exam questions for this subject and create the top 10 topics.
      </p>

      <div className="mt-5">
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
              This subject already has {existingTopicCount} topic
              {existingTopicCount === 1 ? "" : "s"}. Generating again will delete them and create
              new topics.
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
