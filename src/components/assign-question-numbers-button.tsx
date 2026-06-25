"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

interface AssignQuestionNumbersButtonProps {
  subjectId: string;
  term: number;
  year: number;
  questionCount: number;
  numberedCount: number;
}

type StreamEvent =
  | {
      type: "start";
      total: number;
      toProcess: number;
      skipped: number;
    }
  | {
      type: "progress";
      current: number;
      total: number;
      questionId: string;
      status: "processing" | "done" | "skipped" | "error";
      questionNumber?: string;
      message?: string;
    }
  | {
      type: "complete";
      assigned: number;
      skipped: number;
      failed: number;
    }
  | {
      type: "error";
      message: string;
    };

function parseSseChunk(chunk: string): StreamEvent[] {
  return chunk
    .split("\n\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const payload = part.startsWith("data: ") ? part.slice(6) : part;
      return JSON.parse(payload) as StreamEvent;
    });
}

export function AssignQuestionNumbersButton({
  subjectId,
  term,
  year,
  questionCount,
  numberedCount,
}: AssignQuestionNumbersButtonProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [latestQuestionId, setLatestQuestionId] = useState<string | null>(null);
  const [latestQuestionNumber, setLatestQuestionNumber] = useState<string | null>(null);

  const progressPercent = useMemo(() => {
    if (progressTotal <= 0) return 0;
    return Math.round((progressCurrent / progressTotal) * 100);
  }, [progressCurrent, progressTotal]);

  async function handleAssign() {
    setIsRunning(true);
    setError(null);
    setSuccess(null);
    setProgressCurrent(0);
    setProgressTotal(0);
    setLatestQuestionId(null);
    setLatestQuestionNumber(null);

    try {
      const response = await fetch(
        `/api/subjects/${subjectId}/past-papers/${term}/${year}/assign-question-numbers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to assign question numbers.");
      }

      if (!response.body) {
        throw new Error("No response stream returned.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.trim()) continue;

          for (const event of parseSseChunk(part)) {
            if (event.type === "start") {
              setProgressTotal(event.toProcess);
              setProgressCurrent(0);
            }

            if (event.type === "progress") {
              setProgressCurrent(event.current);
              setProgressTotal(event.total);
              setLatestQuestionId(event.questionId);

              if (event.status === "done" && event.questionNumber) {
                setLatestQuestionNumber(event.questionNumber);
              }

              if (event.status === "error") {
                setLatestQuestionNumber(null);
              }
            }

            if (event.type === "complete") {
              setSuccess(
                `Assigned ${event.assigned} question number${event.assigned === 1 ? "" : "s"}` +
                  (event.skipped > 0 ? `, skipped ${event.skipped} already numbered` : "") +
                  (event.failed > 0 ? `, ${event.failed} failed` : "") +
                  ".",
              );
              router.refresh();
            }

            if (event.type === "error") {
              throw new Error(event.message);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign question numbers.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Question numbers</h2>
          <p className="mt-1 text-sm text-slate-600">
            Use OpenAI with the uploaded past paper PDF to match each question to its official
            exam number.
          </p>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          {numberedCount}/{questionCount} numbered
        </span>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={force}
          onChange={(event) => setForce(event.target.checked)}
          disabled={isRunning}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        Re-number questions that already have a number
      </label>

      <button
        type="button"
        onClick={() => void handleAssign()}
        disabled={isRunning || questionCount === 0}
        className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRunning ? "Assigning question numbers..." : "Assign question numbers"}
      </button>

      {isRunning || progressTotal > 0 ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-700">
              {isRunning ? "Processing with OpenAI..." : "Finished"}
            </span>
            <span className="text-slate-500">
              {progressCurrent}/{progressTotal || "—"}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {latestQuestionId ? (
            <p className="mt-3 text-xs text-slate-500">
              Latest: {latestQuestionId}
              {latestQuestionNumber ? ` → ${latestQuestionNumber}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

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
