"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface QuestionReadyToggleProps {
  questionId: string;
  initialReady?: boolean;
}

export function QuestionReadyToggle({
  questionId,
  initialReady = false,
}: QuestionReadyToggleProps) {
  const router = useRouter();
  const [ready, setReady] = useState(initialReady);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReady(initialReady);
  }, [initialReady, questionId]);

  async function handleMarkNotReady() {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/questions/${encodeURIComponent(questionId)}/ready`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ready: false }),
      });

      const data = (await response.json()) as { error?: string; ready?: boolean };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update ready status.");
      }

      setReady(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update ready status.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!ready) {
    return <p className="text-sm text-slate-500">Not ready</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          Ready
        </span>
        <button
          type="button"
          onClick={() => void handleMarkNotReady()}
          disabled={isSaving}
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Mark as not ready"}
        </button>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
