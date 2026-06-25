"use client";

import { ref, uploadBytes } from "firebase/storage";
import { buildQuestionImageStoragePath } from "./question-utils";
import { storage } from "./firebase";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function getExtension(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && ["png", "jpg", "jpeg", "webp", "gif"].includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }

  switch (file.type) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

export function validateQuestionImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return "Please upload a PNG, JPEG, WebP, or GIF image.";
  }

  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) {
    return "Image must be 10 MB or smaller.";
  }

  return null;
}

export function getImageFileFromClipboard(
  clipboardData: DataTransfer | null,
): File | null {
  if (!clipboardData) return null;

  for (const item of clipboardData.items) {
    if (!item.type.startsWith("image/")) continue;

    const file = item.getAsFile();
    if (!file) continue;

    if (file.type && ALLOWED_IMAGE_TYPES.has(file.type)) {
      return file;
    }

    const extension = item.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    return new File([file], `pasted-image.${extension}`, { type: item.type });
  }

  return null;
}

export async function uploadQuestionImageToStorage(
  questionId: string,
  file: File,
): Promise<string> {
  const validationError = validateQuestionImageFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const fileName = `${Date.now()}.${getExtension(file)}`;
  const storagePath = buildQuestionImageStoragePath(questionId, fileName);
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file, {
    contentType: file.type,
    customMetadata: {
      questionId,
    },
  });

  return storagePath;
}
