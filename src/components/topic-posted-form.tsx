"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface TopicPostedFormProps {
  topicId: string;
  initialPosted?: boolean;
  initialPostedUrl?: string;
}

export function TopicPostedForm({
  topicId,
  initialPosted = false,
  initialPostedUrl = "",
}: TopicPostedFormProps) {
  const router = useRouter();
  const [posted, setPosted] = useState(initialPosted);
  const [postedUrl, setPostedUrl] = useState(initialPostedUrl);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/topics/${topicId}/posted`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posted, postedUrl }),
      });

      const data = (await response.json()) as {
        error?: string;
        posted?: boolean;
        postedUrl?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save posted status.");
      }

      setPosted(Boolean(data.posted));
      setPostedUrl(data.postedUrl ?? "");
      setSuccess(data.posted ? "Marked as posted." : "Marked as not posted.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save posted status.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={posted}
            onChange={(event) => setPosted(event.target.checked)}
            disabled={isSaving}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Mark as posted
        </label>
        {posted && postedUrl ? (
          <a
            href={postedUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            View post
          </a>
        ) : null}
      </div>

      {posted ? (
        <label className="mt-3 flex flex-col gap-2 text-sm font-medium text-slate-700">
          Post URL
          <input
            type="url"
            value={postedUrl}
            onChange={(event) => setPostedUrl(event.target.value)}
            disabled={isSaving}
            placeholder="https://youtube.com/watch?v=..."
            className="rounded-lg border border-slate-300 px-3 py-2 text-base font-normal text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
          />
        </label>
      ) : null}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={isSaving}
        className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSaving ? "Saving..." : "Save posted status"}
      </button>

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}
    </div>
  );
}
