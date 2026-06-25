"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

interface AssignQuestionImagesButtonProps {
  subjectId: string;
  term: number;
  year: number;
  hasPdf: boolean;
  imageCount: number;
  numberedCount: number;
  questionsWithImagesCount: number;
}

interface ImageFailure {
  imagePath: string;
  message: string;
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
      imagePath: string;
      status: "processing" | "done" | "skipped" | "error";
      questionNumbers?: string[];
      matchedCount?: number;
      message?: string;
    }
  | {
      type: "complete";
      imagesProcessed: number;
      questionsUpdated: number;
      questionsSkipped: number;
      skipped: number;
      failed: number;
      errors?: ImageFailure[];
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

function imageLabel(imagePath: string): string {
  return imagePath.split("/").pop() ?? imagePath;
}

export function AssignQuestionImagesButton({
  subjectId,
  term,
  year,
  hasPdf,
  imageCount,
  numberedCount,
  questionsWithImagesCount,
}: AssignQuestionImagesButtonProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [latestImagePath, setLatestImagePath] = useState<string | null>(null);
  const [latestQuestionNumbers, setLatestQuestionNumbers] = useState<string[]>([]);
  const [latestStatusMessage, setLatestStatusMessage] = useState<string | null>(null);
  const [failures, setFailures] = useState<ImageFailure[]>([]);

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
    setLatestImagePath(null);
    setLatestQuestionNumbers([]);
    setLatestStatusMessage(null);
    setFailures([]);

    try {
      const response = await fetch(
        `/api/subjects/${subjectId}/past-papers/${term}/${year}/assign-question-images`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to assign images to questions.");
      }

      if (!response.body) {
        throw new Error("No response stream returned.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const collectedFailures: ImageFailure[] = [];

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
              setLatestImagePath(event.imagePath);

              if (event.status === "done") {
                setLatestQuestionNumbers(event.questionNumbers ?? []);
                setLatestStatusMessage(event.message ?? null);
              }

              if (event.status === "error" && event.message) {
                setLatestQuestionNumbers([]);
                setLatestStatusMessage(event.message);
                const failure = { imagePath: event.imagePath, message: event.message };
                collectedFailures.push(failure);
                setFailures([...collectedFailures]);
              }
            }

            if (event.type === "complete") {
              const completeFailures = event.errors ?? collectedFailures;
              setFailures(completeFailures);

              setSuccess(
                `Processed ${event.imagesProcessed} image${event.imagesProcessed === 1 ? "" : "s"} and updated ${event.questionsUpdated} question${event.questionsUpdated === 1 ? "" : "s"}` +
                  (event.questionsSkipped > 0
                    ? `, skipped ${event.questionsSkipped} that already had an image`
                    : "") +
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
      setError(err instanceof Error ? err.message : "Failed to assign images to questions.");
    } finally {
      setIsRunning(false);
    }
  }

  const allFailed = failures.length > 0 && progressTotal > 0 && failures.length === progressTotal;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Question images</h2>
          <p className="mt-1 text-sm text-slate-600">
            Use OpenAI with the past paper PDF and each uploaded image to find which question
            numbers need that image.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
            {imageCount} image{imageCount === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            {questionsWithImagesCount} with image
          </span>
        </div>
      </div>

      {!hasPdf ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Upload the past paper PDF before assigning images. If image mapping fails, re-upload the
          PDF and try again.
        </p>
      ) : null}

      {numberedCount === 0 ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Assign question numbers before assigning images.
        </p>
      ) : null}

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={force}
          onChange={(event) => setForce(event.target.checked)}
          disabled={isRunning}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        Overwrite image_path on questions that already have a Firebase or HTTPS image
      </label>

      <button
        type="button"
        onClick={() => void handleAssign()}
        disabled={isRunning || !hasPdf || imageCount === 0 || numberedCount === 0}
        className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRunning ? "Assigning images..." : "Assign images to questions"}
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
          {latestImagePath ? (
            <p className="mt-3 text-xs text-slate-500">
              Latest image: {imageLabel(latestImagePath)}
              {latestQuestionNumbers.length > 0
                ? ` → ${latestQuestionNumbers.join(", ")}`
                : ""}
              {latestStatusMessage ? (
                <span className="mt-1 block text-amber-700">{latestStatusMessage}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {success ? (
        <p
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            allFailed
              ? "border-red-200 bg-red-50 text-red-700"
              : failures.length > 0
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {success}
        </p>
      ) : null}

      {failures.length > 0 ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-3">
          <p className="text-sm font-medium text-red-800">
            {failures.length} image{failures.length === 1 ? "" : "s"} failed
          </p>
          <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {failures.map((failure) => (
              <li
                key={failure.imagePath}
                className="rounded-md border border-red-100 bg-white px-3 py-2 text-sm"
              >
                <p className="font-medium text-slate-900">{imageLabel(failure.imagePath)}</p>
                <p className="mt-1 whitespace-pre-wrap text-red-700">{failure.message}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
