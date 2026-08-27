import * as XLSX from "xlsx";

export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

/** Extensions accepted for library upload / analysis pipeline. */
export const DOCUMENT_ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".xlsx",
  ".xls",
  ".csv",
  ".txt",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pptx",
  ".rtf",
  ".xml",
  ".zip",
]);

const EXECUTABLE_BLOCKLIST = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".scr",
  ".js",
  ".mjs",
  ".cjs",
  ".vbs",
  ".ps1",
  ".sh",
  ".bash",
  ".dll",
  ".so",
]);

export type SpreadsheetSheet = {
  name: string;
  headers: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  rowCount: number;
};

export type DocumentExtractResult = {
  kind:
    | "text"
    | "spreadsheet"
    | "image"
    | "archive"
    | "unsupported_extract"
    | "rejected";
  text: string | null;
  structured: {
    sheets?: SpreadsheetSheet[];
    format?: string;
    note?: string;
  } | null;
  error?: string;
};

export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx < 0) return "";
  return filename.slice(idx).toLowerCase();
}

export function validateDocumentUpload(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): { ok: true } | { ok: false; message: string } {
  if (input.sizeBytes <= 0) {
    return { ok: false, message: "Empty file" };
  }
  if (input.sizeBytes > DOCUMENT_MAX_BYTES) {
    return {
      ok: false,
      message: `File exceeds maximum size of ${DOCUMENT_MAX_BYTES} bytes`,
    };
  }
  const ext = getExtension(input.filename);
  if (!ext) {
    return { ok: false, message: "File must have an extension" };
  }
  if (EXECUTABLE_BLOCKLIST.has(ext)) {
    return { ok: false, message: `File type ${ext} is not allowed` };
  }
  if (!DOCUMENT_ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, message: `Unsupported file type ${ext}` };
  }
  return { ok: true };
}

function sheetToStructured(sheet: XLSX.WorkSheet, name: string): SpreadsheetSheet {
  const rowsAoA = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(
    sheet,
    { header: 1, defval: null, raw: false }
  ) as Array<Array<string | number | boolean | null>>;
  const headerRow = (rowsAoA[0] ?? []).map((c, i) => {
    const v = c == null || c === "" ? `Column ${i + 1}` : String(c);
    return v;
  });
  const rows: SpreadsheetSheet["rows"] = [];
  for (const row of rowsAoA.slice(1)) {
    if (!row || row.every((c) => c == null || c === "")) continue;
    const obj: Record<string, string | number | boolean | null> = {};
    headerRow.forEach((h, i) => {
      obj[h] = row[i] ?? null;
    });
    rows.push(obj);
  }
  return {
    name,
    headers: headerRow,
    rows: rows.slice(0, 5000),
    rowCount: rows.length,
  };
}

function spreadsheetToText(sheets: SpreadsheetSheet[]): string {
  const parts: string[] = [];
  for (const sheet of sheets) {
    parts.push(`# Sheet: ${sheet.name}`);
    if (sheet.headers.length) {
      parts.push(sheet.headers.join(" | "));
    }
    for (const row of sheet.rows.slice(0, 200)) {
      parts.push(sheet.headers.map((h) => String(row[h] ?? "")).join(" | "));
    }
    if (sheet.rowCount > 200) {
      parts.push(`… ${sheet.rowCount - 200} more rows`);
    }
  }
  return parts.join("\n").slice(0, 400_000);
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const mod = await import("pdf-parse");
  const PDFParse = mod.PDFParse;
  const verbosity = mod.VerbosityLevel?.ERRORS ?? 0;
  if (!PDFParse || typeof PDFParse !== "function") {
    throw new Error("pdf-parse module did not export PDFParse class");
  }
  if (buffer.length < 5 || buffer.slice(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("File does not appear to be a valid PDF");
  }
  const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity });
  try {
    const result = await parser.getText();
    return (result.text ?? "").slice(0, 500_000);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return (result.value ?? "").slice(0, 500_000);
}

function extractSpreadsheet(buffer: Buffer): DocumentExtractResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheets = workbook.SheetNames.map((name) =>
    sheetToStructured(workbook.Sheets[name]!, name)
  );
  return {
    kind: "spreadsheet",
    text: spreadsheetToText(sheets),
    structured: { sheets, format: "spreadsheet" },
  };
}

/**
 * Parse uploaded business files into text + optional structured intermediate.
 * Does not execute macros/scripts. ZIP is accepted as a container only (no deep AI).
 */
export async function extractDocumentContent(input: {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<DocumentExtractResult> {
  const validation = validateDocumentUpload({
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
  });
  if (!validation.ok) {
    return {
      kind: "rejected",
      text: null,
      structured: null,
      error: validation.message,
    };
  }

  const ext = getExtension(input.filename);
  const mime = (input.mimeType || "").toLowerCase();

  try {
    if (ext === ".zip" || mime === "application/zip" || mime === "application/x-zip-compressed") {
      return {
        kind: "archive",
        text: null,
        structured: {
          format: "zip",
          note: "ZIP stored as container only; contents are not auto-analyzed.",
        },
      };
    }

    if (
      ext === ".png" ||
      ext === ".jpg" ||
      ext === ".jpeg" ||
      ext === ".gif" ||
      ext === ".webp" ||
      mime.startsWith("image/")
    ) {
      return {
        kind: "image",
        text: null,
        structured: {
          format: "image",
          note: "Image stored; OCR/vision analysis not enabled in this pipeline.",
        },
      };
    }

    if (ext === ".pdf" || mime === "application/pdf") {
      const text = await extractPdf(input.buffer);
      return { kind: "text", text, structured: { format: "pdf" } };
    }

    if (
      ext === ".docx" ||
      mime ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const text = await extractDocx(input.buffer);
      return { kind: "text", text, structured: { format: "docx" } };
    }

    if (
      ext === ".xlsx" ||
      ext === ".xls" ||
      ext === ".csv" ||
      mime.includes("spreadsheet") ||
      mime === "text/csv" ||
      mime === "application/vnd.ms-excel"
    ) {
      return extractSpreadsheet(input.buffer);
    }

    if (ext === ".json" || mime === "application/json") {
      const raw = input.buffer.toString("utf8");
      JSON.parse(raw); // validate
      return {
        kind: "text",
        text: raw.slice(0, 500_000),
        structured: { format: "json" },
      };
    }

    if (ext === ".txt" || ext === ".rtf" || ext === ".xml" || mime.startsWith("text/")) {
      const text = input.buffer.toString("utf8").slice(0, 500_000);
      return {
        kind: "text",
        text,
        structured: { format: ext.replace(".", "") || "text" },
      };
    }

    if (ext === ".pptx") {
      return {
        kind: "unsupported_extract",
        text: null,
        structured: {
          format: "pptx",
          note: "PPTX stored; text extraction not implemented yet.",
        },
      };
    }

    return {
      kind: "unsupported_extract",
      text: null,
      structured: { format: ext.replace(".", ""), note: "No extractor for this type." },
    };
  } catch (e) {
    return {
      kind: "rejected",
      text: null,
      structured: null,
      error: e instanceof Error ? e.message : "Extraction failed",
    };
  }
}

/** Prefer structured spreadsheet JSON for AI when available. */
export function buildAiAnalysisPayload(extract: DocumentExtractResult): string {
  if (extract.kind === "spreadsheet" && extract.structured?.sheets) {
    return JSON.stringify(
      {
        type: "spreadsheet",
        sheets: extract.structured.sheets.map((s) => ({
          name: s.name,
          headers: s.headers,
          rowCount: s.rowCount,
          sampleRows: s.rows.slice(0, 100),
        })),
      },
      null,
      2
    ).slice(0, 60_000);
  }
  return (extract.text ?? "").slice(0, 60_000);
}
