"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface VideoScriptButtonProps {
  topicId: string;
  topicName: string;
  initialScript?: string;
}

export function VideoScriptButton({
  topicId,
  topicName,
  initialScript,
}: VideoScriptButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [script, setScript] = useState(initialScript ?? "");
  const [questionCount, setQuestionCount] = useState<number | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopyScript() {
    try {
      await navigator.clipboard.writeText(script);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 2000);
    } catch {
      setCopyStatus("error");
      window.setTimeout(() => setCopyStatus("idle"), 2000);
    }
  }

  async function handleGenerate() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/topics/${topicId}/video-script`, {
        method: "POST",
      });

      const data = (await response.json()) as {
        error?: string;
        script?: string;
        questionCount?: number;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to generate video script.");
      }

      setScript(data.script ?? "");
      setQuestionCount(data.questionCount ?? null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate video script.");
    } finally {
      setIsLoading(false);
      setIsConfirmOpen(false);
    }
  }

  function handleGenerateClick() {
    if (script.trim()) {
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
        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {isLoading ? "Creating script..." : script ? "Regenerate script" : "Create explainer script"}
      </button>
      {script ? (
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="ml-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Read more
        </button>
      ) : null}

      {questionCount != null ? (
        <p className="mt-2 text-xs text-slate-500">
          Based on {questionCount} matched question{questionCount === 1 ? "" : "s"}.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {script ? (
        <p className="mt-2 text-xs text-slate-500">
          Script ready. Click Read more to view the full script.
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-500">
          Generates an exam-focused script for {topicName}.
        </p>
      )}

      {isConfirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setIsConfirmOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-900">Replace existing script?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This topic already has an explainer script for {topicName}. Generating again will
              replace it with a new one.
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
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isLoading ? "Creating script..." : "Replace script"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Explainer video script
                </p>
                <h4 className="mt-1 text-lg font-semibold text-slate-900">{topicName}</h4>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyScript()}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  {copyStatus === "copied"
                    ? "Copied!"
                    : copyStatus === "error"
                      ? "Copy failed"
                      : "Copy script"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">{script}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
