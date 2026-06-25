"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface MarkPaperReadyButtonProps {
  subjectId: string;
  term: number;
  year: number;
  questionCount: number;
  readyCount: number;
}

export function MarkPaperReadyButton({
  subjectId,
  term,
  year,
  questionCount,
  readyCount,
}: MarkPaperReadyButtonProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleMarkAllReady() {
    setIsRunning(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        `/api/subjects/${subjectId}/past-papers/${term}/${year}/mark-ready`,
        { method: "POST" },
      );

      const data = (await response.json()) as {
        error?: string;
        updatedCount?: number;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to mark questions as ready.");
      }

      setSuccess(
        `Marked ${data.updatedCount ?? questionCount} question${(data.updatedCount ?? questionCount) === 1 ? "" : "s"} as ready.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark questions as ready.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Ready status</h2>
          <p className="mt-1 text-sm text-slate-600">
            Mark every question in this paper as ready for review or publishing.
          </p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          {readyCount}/{questionCount} ready
        </span>
      </div>

      <button
        type="button"
        onClick={() => void handleMarkAllReady()}
        disabled={isRunning || questionCount === 0}
        className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRunning ? "Marking as ready..." : "Mark all questions as ready"}
      </button>

      {success ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
