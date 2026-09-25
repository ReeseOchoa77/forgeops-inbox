/**
 * Canonical preview capability for stored files.
 * Inline rendering is limited to browser-safe PDF and raster images.
 * HTML, SVG, and mismatched MIME/extension pairs fail closed to download.
 */

export type PreviewKind = "image" | "pdf";
export type ContentDisposition = "inline" | "attachment";

const IMAGE_EXTENSIONS: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

const MIME_TO_EXTENSIONS: Record<string, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/jpg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "application/x-pdf": ["pdf"],
};

/** MIME values that mean "type unknown" rather than a conflicting type. */
const IMPERFECT_MIME = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-download",
]);

const UNSAFE_EXTENSIONS = new Set([
  "html",
  "htm",
  "xhtml",
  "svg",
  "svgz",
  "js",
  "mjs",
  "xml",
]);

function fileExtension(filename: string | null | undefined): string {
  const base = (filename ?? "").split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

function normalizedMime(contentType: string | null | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function isUnsafeMime(mime: string): boolean {
  return (
    mime === "text/html" ||
    mime === "application/xhtml+xml" ||
    mime === "image/svg+xml" ||
    mime.startsWith("image/svg") ||
    mime === "text/javascript" ||
    mime === "application/javascript" ||
    mime === "text/xml" ||
    mime === "application/xml"
  );
}

export function previewKind(input: {
  filename?: string | null;
  contentType?: string | null;
}): PreviewKind | null {
  const mime = normalizedMime(input.contentType);
  const ext = fileExtension(input.filename);
  if (UNSAFE_EXTENSIONS.has(ext) || isUnsafeMime(mime)) return null;

  const mimeExts = MIME_TO_EXTENSIONS[mime];
  if (mimeExts) {
    if (ext && !mimeExts.includes(ext)) return null;
    return mime === "application/pdf" || mime === "application/x-pdf" ? "pdf" : "image";
  }

  if (!IMPERFECT_MIME.has(mime)) return null;
  if (ext === "pdf") return "pdf";
  if (ext in IMAGE_EXTENSIONS) return "image";
  return null;
}

export function canPreviewFile(input: {
  filename?: string | null;
  contentType?: string | null;
}): boolean {
  return previewKind(input) !== null;
}

/** Content-Type to send when inline-rendering. Null when the file must not be inlined. */
export function previewContentType(input: {
  filename?: string | null;
  contentType?: string | null;
}): string | null {
  const kind = previewKind(input);
  if (!kind) return null;
  if (kind === "pdf") return "application/pdf";
  const mime = normalizedMime(input.contentType);
  if (mime === "image/jpg") return "image/jpeg";
  if (mime.startsWith("image/") && MIME_TO_EXTENSIONS[mime]) return mime;
  const ext = fileExtension(input.filename);
  return IMAGE_EXTENSIONS[ext] ?? null;
}

/**
 * Inline only when the file is a supported preview type.
 * Anything else, including a requested inline flag, stays an attachment download.
 */
export function resolveContentDelivery(input: {
  filename: string;
  mimeType: string;
  inlineRequested: boolean;
}): { disposition: ContentDisposition; contentType: string } {
  if (!input.inlineRequested) {
    return { disposition: "attachment", contentType: input.mimeType };
  }
  const contentType = previewContentType({
    filename: input.filename,
    contentType: input.mimeType,
  });
  if (!contentType) {
    return { disposition: "attachment", contentType: input.mimeType };
  }
  return { disposition: "inline", contentType };
}

export function contentDispositionHeader(
  disposition: ContentDisposition,
  filename: string,
): string {
  return `${disposition}; filename="${encodeURIComponent(filename)}"`;
}

export const PREVIEW_NOT_STORED_MESSAGE =
  "Preview unavailable — attachment has not been downloaded to ForgeOps yet.";
