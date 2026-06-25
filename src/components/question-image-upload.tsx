"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { getQuestionImageUrl, hasAssignedQuestionImage } from "@/lib/questions";
import {
  getImageFileFromClipboard,
  uploadQuestionImageToStorage,
} from "@/lib/upload-question-image";

interface QuestionImageUploadProps {
  questionId: string;
  initialImagePath?: string;
  questionLabel: string;
}

export function QuestionImageUpload({
  questionId,
  initialImagePath = "",
  questionLabel,
}: QuestionImageUploadProps) {
  const router = useRouter();
  const pasteZoneRef = useRef<HTMLDivElement>(null);
  const [imagePath, setImagePath] = useState(initialImagePath);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const imageUrl = getQuestionImageUrl(imagePath);

  async function handleUpload(file: File) {
    setIsUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const storagePath = await uploadQuestionImageToStorage(questionId, file);

      const response = await fetch(`/api/questions/${questionId}/image`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePath: storagePath }),
      });

      const data = (await response.json()) as {
        error?: string;
        imagePath?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save image path.");
      }

      setImagePath(data.imagePath ?? storagePath);
      setSuccess("Image saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save image.");
    } finally {
      setIsUploading(false);
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

    void handleUpload(file);
  }

  async function handleRemove() {
    const confirmed = window.confirm(
      "Remove the image from this question? The file in Firebase Storage will not be deleted.",
    );

    if (!confirmed) return;

    setIsRemoving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/questions/${questionId}/image`, {
        method: "DELETE",
      });

      const data = (await response.json()) as {
        error?: string;
        imagePath?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to remove image.");
      }

      setImagePath("");
      setSuccess("Image removed.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove image.");
    } finally {
      setIsRemoving(false);
    }
  }

  const hasImage = hasAssignedQuestionImage(imagePath);
  const isBusy = isUploading || isRemoving;

  return (
    <div className="mt-1">
      <p className="font-mono text-sm text-slate-700">
        {imagePath.trim() ? imagePath : "—"}
      </p>

      {imageUrl ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          <Image
            src={imageUrl}
            alt={questionLabel}
            width={960}
            height={540}
            className="h-auto w-full object-contain"
            unoptimized
          />
        </div>
      ) : null}

      {hasImage ? (
        <button
          type="button"
          onClick={() => void handleRemove()}
          disabled={isBusy}
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRemoving ? "Removing..." : "Remove image"}
        </button>
      ) : null}

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-medium text-slate-700">Paste image</p>
        <div
          ref={pasteZoneRef}
          tabIndex={0}
          role="textbox"
          aria-label="Paste question image"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPaste={handlePaste}
          onClick={() => pasteZoneRef.current?.focus()}
          className={`mt-2 flex min-h-28 cursor-text flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition outline-none ${
            isFocused
              ? "border-indigo-400 bg-indigo-50/60 ring-2 ring-indigo-100"
              : "border-slate-300 bg-white hover:border-slate-400"
          } ${isBusy ? "pointer-events-none opacity-60" : ""}`}
        >
          <p className="text-sm font-medium text-slate-700">
            {isUploading ? "Saving..." : isRemoving ? "Removing..." : "Click here, then paste an image"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Use Ctrl+V or ⌘+V after copying a screenshot or image
          </p>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          PNG, JPEG, WebP, or GIF up to 10 MB. Saved to Firebase Storage.
        </p>
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
    </div>
  );
}
