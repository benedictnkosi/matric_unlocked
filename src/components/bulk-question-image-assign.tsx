"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { getFirebaseStoragePublicUrl } from "@/lib/firebase-storage-url";
import {
  getImageFileFromClipboard,
  uploadQuestionImageToStorage,
  validateQuestionImageFile,
} from "@/lib/upload-question-image";

interface BulkQuestionSummary {
  id: string;
  questionNumber?: string;
  hasImage: boolean;
}

interface BulkQuestionImageAssignProps {
  subjectId: string;
  term: number;
  year: number;
  questions: BulkQuestionSummary[];
}

function questionLabel(question: BulkQuestionSummary, index: number): string {
  const number = question.questionNumber?.trim();
  return number ? `Question ${number}` : `Unnumbered question ${index + 1}`;
}

export function BulkQuestionImageAssign({
  subjectId,
  term,
  year,
  questions,
}: BulkQuestionImageAssignProps) {
  const router = useRouter();
  const pasteZoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [force, setForce] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedCount = selectedIds.size;
  const allSelected = questions.length > 0 && selectedCount === questions.length;

  const selectedQuestions = useMemo(
    () => questions.filter((question) => selectedIds.has(question.id)),
    [questions, selectedIds],
  );

  function toggleQuestion(questionId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((current) => {
      if (current.size === questions.length) {
        return new Set();
      }
      return new Set(questions.map((question) => question.id));
    });
  }

  async function assignImageToSelected(file: File) {
    const validationError = validateQuestionImageFile(file);
    if (validationError) {
      setError(validationError);
      setSuccess(null);
      return;
    }

    if (selectedCount === 0) {
      setError("Select at least one question first.");
      setSuccess(null);
      return;
    }

    setIsAssigning(true);
    setError(null);
    setSuccess(null);

    try {
      const uploadQuestionId = selectedQuestions[0]?.id ?? [...selectedIds][0];
      const storagePath = await uploadQuestionImageToStorage(uploadQuestionId, file);
      const imagePath = getFirebaseStoragePublicUrl(storagePath) ?? storagePath;

      const response = await fetch(
        `/api/subjects/${subjectId}/past-papers/${term}/${year}/bulk-question-image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionIds: [...selectedIds],
            imagePath,
            force,
          }),
        },
      );

      const data = (await response.json()) as {
        error?: string;
        updatedCount?: number;
        skippedCount?: number;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to assign image to questions.");
      }

      const updatedCount = data.updatedCount ?? 0;
      const skippedCount = data.skippedCount ?? 0;

      if (updatedCount === 0) {
        setSuccess(
          skippedCount > 0
            ? `No questions updated. ${skippedCount} selected question${skippedCount === 1 ? "" : "s"} already ha${skippedCount === 1 ? "s" : "ve"} an image. Enable overwrite to replace.`
            : "No questions were updated.",
        );
      } else {
        setSuccess(
          `Assigned image to ${updatedCount} question${updatedCount === 1 ? "" : "s"}` +
            (skippedCount > 0 ? ` (${skippedCount} skipped)` : "") +
            ".",
        );
      }

      setSelectedIds(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign image to questions.");
    } finally {
      setIsAssigning(false);
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();

    const file = getImageFileFromClipboard(event.clipboardData);
    if (!file) {
      setError("No image found on the clipboard. Copy an image first, then paste here.");
      setSuccess(null);
      return;
    }

    void assignImageToSelected(file);
  }

  if (questions.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Assign image to multiple questions</h2>
          <p className="mt-1 text-sm text-slate-600">
            Select questions below, then paste or upload one image to assign it to all of them.
          </p>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          {selectedCount} selected
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggleSelectAll}
          disabled={isAssigning}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {allSelected ? "Clear selection" : "Select all"}
        </button>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={force}
            onChange={(event) => setForce(event.target.checked)}
            disabled={isAssigning}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Overwrite questions that already have an image
        </label>
      </div>

      <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
        {questions.map((question, index) => {
          const label = questionLabel(question, index);
          const isSelected = selectedIds.has(question.id);

          return (
            <li key={question.id}>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-white">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleQuestion(question.id)}
                  disabled={isAssigning}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{label}</span>
                  <span className="block truncate font-mono text-xs text-slate-400">{question.id}</span>
                </span>
                {question.hasImage ? (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    Has image
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-medium text-slate-700">Paste or upload image</p>
        <div
          ref={pasteZoneRef}
          tabIndex={0}
          role="textbox"
          aria-label="Paste image for selected questions"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPaste={handlePaste}
          onClick={() => pasteZoneRef.current?.focus()}
          className={`mt-2 flex min-h-28 cursor-text flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition outline-none ${
            isFocused
              ? "border-indigo-400 bg-indigo-50/60 ring-2 ring-indigo-100"
              : "border-slate-300 bg-white hover:border-slate-400"
          } ${isAssigning ? "pointer-events-none opacity-60" : ""}`}
        >
          <p className="text-sm font-medium text-slate-700">
            {isAssigning
              ? "Assigning..."
              : selectedCount === 0
                ? "Select questions above, then paste an image here"
                : "Click here, then paste an image"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Use Ctrl+V or ⌘+V after copying a screenshot or image
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={isAssigning}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void assignImageToSelected(file);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isAssigning || selectedCount === 0}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAssigning ? "Assigning..." : "Choose image file"}
          </button>
          <p className="text-xs text-slate-500">PNG, JPEG, WebP, or GIF up to 10 MB.</p>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}
    </section>
  );
}
