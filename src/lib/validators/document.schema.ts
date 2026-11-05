import { z } from "zod";

export const uploadDocumentMetaSchema = z.object({
  employeeId: z.string().min(1),
  title: z.string().min(1).max(200),
});
export type UploadDocumentMetaInput = z.infer<typeof uploadDocumentMetaSchema>;

export const deleteDocumentSchema = z.object({
  documentId: z.string().min(1),
});
export type DeleteDocumentInput = z.infer<typeof deleteDocumentSchema>;

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/**
 * 4 MB. The live site runs on Vercel, which refuses any request over 4.5 MB
 * before CloudTime sees it, so the 10 MB this used to allow failed on the
 * live site for anything over 4.5 MB.
 */
export const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;

const MIME_TO_EXT: Record<AllowedMimeType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

const MIME_TO_LABEL: Record<AllowedMimeType, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
};

export function mimeToExt(mime: string): string {
  return MIME_TO_EXT[mime as AllowedMimeType] ?? "bin";
}

export function mimeToLabel(mime: string): string {
  return MIME_TO_LABEL[mime as AllowedMimeType] ?? mime;
}

export function isAllowedMime(mime: string): mime is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}
