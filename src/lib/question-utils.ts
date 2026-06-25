import { getFirebaseStoragePublicUrl } from "./firebase-storage-url";

export function hasAssignedQuestionImage(imagePath: string | null | undefined): boolean {
  const trimmed = imagePath?.trim();
  return Boolean(trimmed && trimmed !== "image_required");
}

export function isFirebaseStorageImagePath(imagePath: string): boolean {
  return (
    imagePath.startsWith("question-images/") ||
    /^past-papers\/q-[^/]+\//.test(imagePath)
  );
}

export function getQuestionImageUrl(imagePath: string | null | undefined): string | null {
  const trimmed = imagePath?.trim();
  if (!trimmed || trimmed === "image_required") return null;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  if (isFirebaseStorageImagePath(trimmed)) {
    return getFirebaseStoragePublicUrl(trimmed);
  }

  return `/question-images/${trimmed}`;
}

export function buildQuestionImageStoragePath(questionId: string, fileName: string): string {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return `past-papers/${questionId}/${sanitized}`;
}

export function isValidQuestionImageStoragePath(
  imagePath: string,
  questionId: string,
): boolean {
  const trimmed = imagePath.trim();
  return (
    trimmed.startsWith(`past-papers/${questionId}/`) ||
    trimmed.startsWith(`question-images/${questionId}/`)
  );
}
