/**
 * File-type buckets for Job Documents library filters.
 * Maps MIME types / extensions into coarse UI groups.
 */

export const JOB_FILE_TYPE_FILTERS = [
  "ALL",
  "IMAGES",
  "PDF",
  "SPREADSHEETS",
  "DOCUMENTS",
  "OTHER",
] as const;

export type JobFileTypeFilter = (typeof JOB_FILE_TYPE_FILTERS)[number];

export type JobFileTypeBucket = Exclude<JobFileTypeFilter, "ALL">;

function extensionOf(filename: string): string {
  const base = filename.trim().split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function classifyJobFileType(
  mimeType: string | null | undefined,
  filename: string
): JobFileTypeBucket {
  const mime = (mimeType ?? "").toLowerCase().trim();
  const ext = extensionOf(filename);

  if (
    mime.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "tif", "tiff"].includes(ext)
  ) {
    return "IMAGES";
  }
  if (mime === "application/pdf" || ext === "pdf") {
    return "PDF";
  }
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv" ||
    ["xls", "xlsx", "csv", "xlsm", "ods"].includes(ext)
  ) {
    return "SPREADSHEETS";
  }
  if (
    mime.includes("word") ||
    mime.includes("msword") ||
    mime.includes("document") ||
    mime === "text/plain" ||
    mime === "text/rtf" ||
    mime === "application/rtf" ||
    ["doc", "docx", "txt", "rtf", "odt", "pages"].includes(ext)
  ) {
    return "DOCUMENTS";
  }
  return "OTHER";
}

export function fileExtension(filename: string): string {
  const ext = extensionOf(filename);
  return ext ? `.${ext}` : "";
}

export function isPreviewableImage(
  mimeType: string | null | undefined,
  filename: string
): boolean {
  if (classifyJobFileType(mimeType, filename) !== "IMAGES") return false;
  const mime = (mimeType ?? "").toLowerCase();
  const ext = extensionOf(filename);
  return (
    ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"].includes(mime) ||
    ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)
  );
}
