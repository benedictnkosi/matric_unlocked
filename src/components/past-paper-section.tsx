"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface PastPaperImageData {
  path: string;
  uploadedAt: string;
  originalName?: string;
  url?: string | null;
}

interface PastPaperData {
  id: string;
  pdfPath?: string;
  pdfUrl?: string | null;
  images?: PastPaperImageData[];
  ocrStatus: "none" | "processing" | "done" | "failed";
  ocrError?: string;
  pdfUploadedAt?: string;
}

interface PastPaperSectionProps {
  subjectId: string;
  term: number;
  year: number;
  questionCount: number;
}

export function PastPaperSection({
  subjectId,
  term,
  year,
  questionCount,
}: PastPaperSectionProps) {
  const router = useRouter();
  const [pastPaper, setPastPaper] = useState<PastPaperData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [isDeletingImages, setIsDeletingImages] = useState(false);
  const [imageUploadProgress, setImageUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPastPaper() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/subjects/${subjectId}/past-papers/${term}/${year}`,
      );
      const data = (await response.json()) as {
        error?: string;
        pastPaper?: PastPaperData | null;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load past paper.");
      }

      setPastPaper(data.pastPaper ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load past paper.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadPastPaper();
  }, [subjectId, term, year]);

  async function handlePdfUpload(file: File) {
    setIsUploadingPdf(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("pdf", file);

      const response = await fetch(
        `/api/subjects/${subjectId}/past-papers/${term}/${year}`,
        {
          method: "POST",
          body: formData,
        },
      );

      const data = (await response.json()) as {
        error?: string;
        pastPaper?: PastPaperData;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to upload past paper.");
      }

      setPastPaper(data.pastPaper ?? null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload past paper.");
      await loadPastPaper();
    } finally {
      setIsUploadingPdf(false);
    }
  }

  async function handleImagesUpload(files: FileList | File[]) {
    const imageFiles = [...files];
    if (imageFiles.length === 0) return;

    setIsUploadingImages(true);
    setError(null);
    setImageUploadProgress(`Uploading ${imageFiles.length} image${imageFiles.length === 1 ? "" : "s"}...`);

    try {
      const formData = new FormData();
      for (const file of imageFiles) {
        formData.append("images", file);
      }

      const response = await fetch(
        `/api/subjects/${subjectId}/past-papers/${term}/${year}/images`,
        {
          method: "POST",
          body: formData,
        },
      );

      const data = (await response.json()) as {
        error?: string;
        pastPaper?: PastPaperData;
        uploadedCount?: number;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to upload images.");
      }

      setPastPaper(data.pastPaper ?? null);
      setImageUploadProgress(
        `Uploaded ${data.uploadedCount ?? imageFiles.length} image${(data.uploadedCount ?? imageFiles.length) === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload images.");
      await loadPastPaper();
    } finally {
      setIsUploadingImages(false);
    }
  }

  async function handleDeleteAllImages() {
    if (images.length === 0) return;

    const confirmed = window.confirm(
      `Delete all ${images.length} uploaded paper image${images.length === 1 ? "" : "s"} from Firebase Storage? This cannot be undone.`,
    );

    if (!confirmed) return;

    setIsDeletingImages(true);
    setError(null);
    setImageUploadProgress(null);

    try {
      const response = await fetch(
        `/api/subjects/${subjectId}/past-papers/${term}/${year}/images`,
        { method: "DELETE" },
      );

      const data = (await response.json()) as {
        error?: string;
        deletedCount?: number;
        pastPaper?: PastPaperData | null;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to delete paper images.");
      }

      setPastPaper(data.pastPaper ?? null);
      setImageUploadProgress(
        `Deleted ${data.deletedCount ?? 0} paper image${(data.deletedCount ?? 0) === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete paper images.");
      await loadPastPaper();
    } finally {
      setIsDeletingImages(false);
    }
  }

  const images = pastPaper?.images ?? [];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Past paper</h2>
          <p className="mt-1 text-sm text-slate-600">
            Upload the PDF and any page images for this question paper.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            {questionCount} question{questionCount === 1 ? "" : "s"}
          </span>
          {pastPaper?.ocrStatus === "done" ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              PDF uploaded
            </span>
          ) : pastPaper?.ocrStatus === "processing" || isUploadingPdf ? (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              Uploading PDF
            </span>
          ) : pastPaper?.ocrStatus === "failed" ? (
            <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
              PDF failed
            </span>
          ) : null}
          {images.length > 0 ? (
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
              {images.length} image{images.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500">Loading past paper...</p>
      ) : (
        <>
          {pastPaper?.pdfUrl ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <a
                href={pastPaper.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-indigo-600 hover:text-indigo-700"
              >
                View PDF
              </a>
            </div>
          ) : null}

          {pastPaper?.ocrError ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {pastPaper.ocrError}
            </p>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
                {pastPaper?.pdfPath ? "Replace PDF" : "Upload PDF"}
                <input
                  type="file"
                  accept="application/pdf"
                  disabled={isUploadingPdf}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handlePdfUpload(file);
                    event.currentTarget.value = "";
                  }}
                  className="block w-full text-sm font-normal text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-700 disabled:opacity-60"
                />
              </label>
              <p className="mt-2 text-xs text-slate-500">PDF up to 50 MB.</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
                Upload images
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  disabled={isUploadingImages}
                  onChange={(event) => {
                    const selected = event.target.files;
                    if (selected && selected.length > 0) {
                      void handleImagesUpload(selected);
                    }
                    event.currentTarget.value = "";
                  }}
                  className="block w-full text-sm font-normal text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-700 disabled:opacity-60"
                />
              </label>
              <p className="mt-2 text-xs text-slate-500">
                Select multiple images at once. PNG, JPEG, WebP, or GIF up to 10 MB each.
              </p>
              {isUploadingImages ? (
                <p className="mt-3 text-sm text-slate-600">{imageUploadProgress}</p>
              ) : imageUploadProgress ? (
                <p className="mt-3 text-sm text-emerald-700">{imageUploadProgress}</p>
              ) : null}
            </div>
          </div>

          {images.length > 0 ? (
            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">Paper images</h3>
                <button
                  type="button"
                  onClick={() => void handleDeleteAllImages()}
                  disabled={isDeletingImages || isUploadingImages}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDeletingImages ? "Deleting..." : "Delete all paper images"}
                </button>
              </div>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {images.map((image) => (
                  <li
                    key={image.path}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                  >
                    {image.url ? (
                      <Image
                        src={image.url}
                        alt={image.originalName ?? "Past paper image"}
                        width={640}
                        height={480}
                        className="h-48 w-full object-contain bg-white"
                        unoptimized
                      />
                    ) : null}
                    <div className="border-t border-slate-200 px-3 py-2">
                      <p className="truncate text-xs font-medium text-slate-700">
                        {image.originalName ?? image.path.split("/").pop()}
                      </p>
                      {image.url ? (
                        <a
                          href={image.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          Open full size
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
