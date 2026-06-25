import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { getBytes, ref, uploadBytes, deleteObject } from "firebase/storage";
import { db, storage } from "./firebase";
import { getFirebaseStoragePublicUrl } from "./firebase-storage-url";
import { uploadImageToOpenAi, uploadPdfToOpenAi, validateOpenAiPdfFile } from "./openai-files";

export const PAST_PAPER_PDF_REUPLOAD_MESSAGE =
  "Past paper PDF is no longer valid. Re-upload the PDF before assigning images.";

export type PastPaperUploadStatus = "none" | "processing" | "done" | "failed";

export interface PastPaperImage {
  path: string;
  uploadedAt: string;
  originalName?: string;
  openaiFileId?: string;
}

export interface PastPaper {
  id: string;
  subjectId: string;
  subjectName: string;
  grade: number;
  term: number;
  year: number;
  pdfPath?: string;
  images?: PastPaperImage[];
  openaiFileId?: string;
  /** Legacy field kept for existing documents. */
  ocrTextPath?: string;
  ocrStatus: PastPaperUploadStatus;
  ocrError?: string;
  pageCount?: number;
  pdfUploadedAt?: string;
  ocrUpdatedAt?: string;
}

export function buildPastPaperId(subjectId: string, term: number, year: number): string {
  return `${subjectId}-${year}-t${term}`;
}

export function buildPastPaperPdfPath(paperId: string): string {
  return `past-papers/${paperId}/original.pdf`;
}

export function buildPastPaperImagePath(paperId: string, fileName: string): string {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return `past-papers/${paperId}/${Date.now()}-${sanitized}`;
}

export function getPastPaperImageUrl(imagePath: string | undefined): string | null {
  if (!imagePath?.trim()) return null;
  return getFirebaseStoragePublicUrl(imagePath.trim());
}

export function mapPastPaperImages(images: PastPaperImage[] | undefined) {
  return (images ?? []).map((image) => ({
    ...image,
    url: getPastPaperImageUrl(image.path),
  }));
}

export function getPastPaperPdfUrl(pdfPath: string | undefined): string | null {
  if (!pdfPath?.trim()) return null;
  return getFirebaseStoragePublicUrl(pdfPath.trim());
}

export function hasPastPaperPdf(pastPaper: PastPaper | null | undefined): boolean {
  return Boolean(pastPaper?.pdfPath?.trim() && pastPaper.ocrStatus === "done");
}

export async function getPastPaperByKey(
  subjectId: string,
  term: number,
  year: number,
): Promise<PastPaper | null> {
  const id = buildPastPaperId(subjectId, term, year);
  const snapshot = await getDoc(doc(db, "past_papers", id));
  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<PastPaper, "id">),
  };
}

export async function getPastPapersForSubject(subjectId: string): Promise<PastPaper[]> {
  const snapshot = await getDocs(
    query(collection(db, "past_papers"), where("subjectId", "==", subjectId)),
  );

  return snapshot.docs
    .map((paperDoc) => ({
      id: paperDoc.id,
      ...(paperDoc.data() as Omit<PastPaper, "id">),
    }))
    .sort((a, b) => b.year - a.year || a.term - b.term);
}

export async function savePastPaperProcessing(
  paper: Omit<PastPaper, "pdfPath" | "openaiFileId" | "pageCount" | "pdfUploadedAt" | "ocrUpdatedAt">,
): Promise<void> {
  await setDoc(
    doc(db, "past_papers", paper.id),
    {
      ...paper,
      ocrStatus: "processing",
      ocrError: "",
      ocrUpdatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export async function savePastPaperUpload(
  paperId: string,
  data: {
    pdfPath: string;
    subjectId: string;
    subjectName: string;
    grade: number;
    term: number;
    year: number;
  },
): Promise<void> {
  const now = new Date().toISOString();

  await setDoc(
    doc(db, "past_papers", paperId),
    {
      id: paperId,
      subjectId: data.subjectId,
      subjectName: data.subjectName,
      grade: data.grade,
      term: data.term,
      year: data.year,
      pdfPath: data.pdfPath,
      openaiFileId: "",
      ocrTextPath: "",
      ocrStatus: "done",
      ocrError: "",
      pdfUploadedAt: now,
      ocrUpdatedAt: now,
    },
    { merge: true },
  );
}

export async function savePastPaperOpenAiFileId(
  paperId: string,
  openaiFileId: string,
): Promise<void> {
  await setDoc(
    doc(db, "past_papers", paperId),
    {
      openaiFileId,
      ocrUpdatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export async function savePastPaperFailure(
  paperId: string,
  errorMessage: string,
  partial?: Partial<PastPaper>,
): Promise<void> {
  await setDoc(
    doc(db, "past_papers", paperId),
    {
      ...partial,
      ocrStatus: "failed",
      ocrError: errorMessage,
      ocrUpdatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export async function ensurePastPaperRecord(
  paperId: string,
  data: {
    subjectId: string;
    subjectName: string;
    grade: number;
    term: number;
    year: number;
  },
): Promise<PastPaper> {
  const existing = await getPastPaperByKey(data.subjectId, data.term, data.year);
  if (existing) return existing;

  const record: PastPaper = {
    id: paperId,
    subjectId: data.subjectId,
    subjectName: data.subjectName,
    grade: data.grade,
    term: data.term,
    year: data.year,
    images: [],
    ocrStatus: "none",
  };

  await setDoc(doc(db, "past_papers", paperId), record, { merge: true });
  return record;
}

export async function appendPastPaperImages(
  paperId: string,
  newImages: PastPaperImage[],
): Promise<PastPaperImage[]> {
  const snapshot = await getDoc(doc(db, "past_papers", paperId));
  const existing = snapshot.exists()
    ? ((snapshot.data() as PastPaper).images ?? [])
    : [];
  const images = [...existing, ...newImages];

  await setDoc(
    doc(db, "past_papers", paperId),
    {
      images,
      ocrUpdatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return images;
}

export async function deletePastPaperImagesFromStorage(images: PastPaperImage[]): Promise<number> {
  let deleted = 0;

  for (const image of images) {
    const path = image.path?.trim();
    if (!path) continue;

    try {
      await deleteObject(ref(storage, path));
      deleted += 1;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : "";

      if (code === "storage/object-not-found") {
        deleted += 1;
        continue;
      }

      throw error;
    }
  }

  return deleted;
}

export async function deleteAllPastPaperImages(
  subjectId: string,
  term: number,
  year: number,
): Promise<{ deletedCount: number; pastPaper: PastPaper | null }> {
  const pastPaper = await getPastPaperByKey(subjectId, term, year);
  const images = pastPaper?.images ?? [];

  if (images.length === 0) {
    return { deletedCount: 0, pastPaper };
  }

  const paperId = buildPastPaperId(subjectId, term, year);
  await deletePastPaperImagesFromStorage(images);

  await setDoc(
    doc(db, "past_papers", paperId),
    {
      images: [],
      ocrUpdatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return {
    deletedCount: images.length,
    pastPaper: await getPastPaperByKey(subjectId, term, year),
  };
}

export async function uploadPastPaperImage(
  paperId: string,
  fileBuffer: Buffer,
  contentType: string,
  originalName: string,
): Promise<string> {
  const storagePath = buildPastPaperImagePath(paperId, originalName);
  await uploadBytes(ref(storage, storagePath), new Uint8Array(fileBuffer), {
    contentType,
    customMetadata: { paperId, originalName },
  });
  return storagePath;
}

export async function uploadPastPaperPdf(paperId: string, pdfBuffer: Buffer): Promise<string> {
  const pdfPath = buildPastPaperPdfPath(paperId);
  await uploadBytes(ref(storage, pdfPath), new Uint8Array(pdfBuffer), {
    contentType: "application/pdf",
    customMetadata: { paperId },
  });
  return pdfPath;
}

export async function downloadPastPaperImage(imagePath: string): Promise<Buffer> {
  const bytes = await getBytes(ref(storage, imagePath));
  return Buffer.from(bytes);
}

function guessImageContentType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export function buildPastPaperImageDataUrl(imageBuffer: Buffer, imagePath: string): string {
  const contentType = guessImageContentType(imagePath);
  return `data:${contentType};base64,${imageBuffer.toString("base64")}`;
}

export async function savePastPaperImageOpenAiFileId(
  paperId: string,
  imagePath: string,
  openaiFileId: string,
): Promise<void> {
  const snapshot = await getDoc(doc(db, "past_papers", paperId));
  if (!snapshot.exists()) return;

  const pastPaper = snapshot.data() as PastPaper;
  const images = (pastPaper.images ?? []).map((image) =>
    image.path === imagePath ? { ...image, openaiFileId } : image,
  );

  await setDoc(
    doc(db, "past_papers", paperId),
    {
      images,
      ocrUpdatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export async function ensureOpenAiPastPaperImageFile(
  pastPaper: PastPaper,
  image: PastPaperImage,
): Promise<string> {
  if (image.openaiFileId?.trim()) {
    return image.openaiFileId.trim();
  }

  const imageBuffer = await downloadPastPaperImage(image.path);
  const fileName = image.originalName?.trim() || image.path.split("/").pop() || "paper-image.png";
  const openaiFileId = await uploadImageToOpenAi(
    imageBuffer,
    fileName,
    guessImageContentType(image.path),
  );

  await savePastPaperImageOpenAiFileId(pastPaper.id, image.path, openaiFileId);
  return openaiFileId;
}

export function hasPastPaperImages(pastPaper: PastPaper | null | undefined): boolean {
  return Boolean(pastPaper?.images?.length);
}

export async function downloadPastPaperPdf(pdfPath: string): Promise<Buffer> {
  const bytes = await getBytes(ref(storage, pdfPath));
  return Buffer.from(bytes);
}

function isValidPdfBuffer(pdfBuffer: Buffer): boolean {
  return pdfBuffer.length >= 4 && pdfBuffer.subarray(0, 4).toString("ascii") === "%PDF";
}

export async function clearPastPaperOpenAiFileId(paperId: string): Promise<void> {
  await setDoc(
    doc(db, "past_papers", paperId),
    {
      openaiFileId: "",
      ocrUpdatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

async function uploadPastPaperPdfToOpenAi(pastPaper: PastPaper, pdfBuffer: Buffer): Promise<string> {
  const openaiFileId = await uploadPdfToOpenAi(pdfBuffer, `${pastPaper.id}.pdf`);
  await savePastPaperOpenAiFileId(pastPaper.id, openaiFileId);
  return openaiFileId;
}

export async function ensureOpenAiPastPaperFile(pastPaper: PastPaper): Promise<string> {
  if (!pastPaper.pdfPath?.trim()) {
    throw new Error("Past paper PDF is required.");
  }

  if (pastPaper.openaiFileId?.trim()) {
    return pastPaper.openaiFileId.trim();
  }

  const pdfBuffer = await downloadPastPaperPdf(pastPaper.pdfPath);
  return uploadPastPaperPdfToOpenAi(pastPaper, pdfBuffer);
}

export async function requireValidOpenAiPastPaperFile(pastPaper: PastPaper): Promise<string> {
  if (!pastPaper.pdfPath?.trim()) {
    throw new Error("Past paper PDF is required. Upload the PDF before assigning images.");
  }

  const pdfBuffer = await downloadPastPaperPdf(pastPaper.pdfPath);
  if (!isValidPdfBuffer(pdfBuffer)) {
    await clearPastPaperOpenAiFileId(pastPaper.id);
    throw new Error(PAST_PAPER_PDF_REUPLOAD_MESSAGE);
  }

  const cachedFileId = pastPaper.openaiFileId?.trim();
  if (cachedFileId) {
    try {
      await validateOpenAiPdfFile(cachedFileId);
      return cachedFileId;
    } catch {
      await clearPastPaperOpenAiFileId(pastPaper.id);
    }
  }

  try {
    const openaiFileId = await uploadPastPaperPdfToOpenAi(pastPaper, pdfBuffer);
    await validateOpenAiPdfFile(openaiFileId);
    return openaiFileId;
  } catch {
    await clearPastPaperOpenAiFileId(pastPaper.id);
    throw new Error(PAST_PAPER_PDF_REUPLOAD_MESSAGE);
  }
}

export async function requirePastPaperPdf(
  subjectId: string,
  term: number,
  year: number,
): Promise<PastPaper> {
  const pastPaper = await getPastPaperByKey(subjectId, term, year);

  if (!hasPastPaperPdf(pastPaper)) {
    throw new Error("Past paper PDF is required. Upload the PDF first.");
  }

  return pastPaper!;
}
