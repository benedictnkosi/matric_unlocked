"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface GenerateSubTopicsButtonProps {
  topicId: string;
  topicName: string;
  existingSubTopicCount: number;
}

export function GenerateSubTopicsButton({
  topicId,
  topicName,
  existingSubTopicCount,
}: GenerateSubTopicsButtonProps) {
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
      const response = await fetch(`/api/topics/${topicId}/sub-topics`, {
        method: "POST",
      });

      const data = (await response.json()) as {
        error?: string;
        subTopicCount?: number;
        questionCount?: number;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to generate sub-topics.");
      }

      setSuccess(
        `Created ${data.subTopicCount ?? 0} sub-topics from ${data.questionCount ?? 0} matched questions.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate sub-topics.");
    } finally {
      setIsLoading(false);
      setIsConfirmOpen(false);
    }
  }

  function handleGenerateClick() {
    if (existingSubTopicCount > 0) {
      setIsConfirmOpen(true);
      return;
    }

    void handleGenerate();
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <button
        type="button"
        onClick={handleGenerateClick}
        disabled={isLoading}
        className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading
          ? "Generating..."
          : existingSubTopicCount > 0
            ? `Regenerate sub-topics (${existingSubTopicCount})`
            : "Create sub-topics"}
      </button>

      <p className="mt-2 text-xs text-slate-500">
        AI will decide how many sub-topics are needed to split {topicName} into
        video-sized chunks.
      </p>

      {success ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {isConfirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setIsConfirmOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-900">Replace existing sub-topics?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This topic already has {existingSubTopicCount} sub-topic
              {existingSubTopicCount === 1 ? "" : "s"}. Generating again will delete them and let
              AI decide a new set of sub-topics for {topicName}.
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
                {isLoading ? "Generating..." : "Replace sub-topics"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
