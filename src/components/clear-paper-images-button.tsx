"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ClearPaperImagesButtonProps {
  subjectId: string;
  term: number;
  year: number;
  questionsWithImagesCount: number;
}

export function ClearPaperImagesButton({
  subjectId,
  term,
  year,
  questionsWithImagesCount,
}: ClearPaperImagesButtonProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleClearImages() {
    const confirmed = window.confirm(
      `Remove image_path from all ${questionsWithImagesCount} question${questionsWithImagesCount === 1 ? "" : "s"} with an image on this paper?`,
    );

    if (!confirmed) return;

    setIsRunning(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        `/api/subjects/${subjectId}/past-papers/${term}/${year}/clear-question-images`,
        { method: "POST" },
      );

      const data = (await response.json()) as {
        error?: string;
        clearedCount?: number;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to remove question images.");
      }

      const clearedCount = data.clearedCount ?? 0;
      setSuccess(
        clearedCount === 0
          ? "No questions had an image to remove."
          : `Removed images from ${clearedCount} question${clearedCount === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove question images.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Clear question images</h2>
          <p className="mt-1 text-sm text-slate-600">
            Remove image_path from every question on this paper. Uploaded files in Firebase
            Storage are not deleted.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
          {questionsWithImagesCount} with image
        </span>
      </div>

      <button
        type="button"
        onClick={() => void handleClearImages()}
        disabled={isRunning || questionsWithImagesCount === 0}
        className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRunning ? "Removing images..." : "Remove images from all questions"}
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
