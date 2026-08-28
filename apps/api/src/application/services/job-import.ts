import * as XLSX from "xlsx";
import { normalizeName, computeSimilarity } from "@forgeops/shared";

export type JobImportCustomerStatus =
  | "MATCHED"
  | "AMBIGUOUS"
  | "NOT_FOUND"
  | "EMPTY";

export type JobImportRowStatus =
  | "READY"
  | "EXISTING"
  | "CONFLICT"
  | "CUSTOMER_NOT_FOUND"
  | "CUSTOMER_AMBIGUOUS"
  | "INVALID";

export type NormalizedJobImportRow = {
  rowIndex: number;
  date: string | null; // ISO date (YYYY-MM-DD) or null
  jobNumber: string;
  name: string;
  rawCustomerName: string | null;
};

export type CustomerMatchResult = {
  status: JobImportCustomerStatus;
  customerId: string | null;
  customerName: string | null;
  candidates: Array<{ id: string; name: string; score: number }>;
};

export type EnrichedJobImportRow = NormalizedJobImportRow & {
  status: JobImportRowStatus;
  selected: boolean;
  customerMatch: CustomerMatchResult;
  existingJobId: string | null;
  existingJobName: string | null;
  existingJobNumber: string | null;
  errors: string[];
  warnings: string[];
  /** PDF / weak extraction flag */
  lowConfidence: boolean;
};

const JOB_NUMBER_HEADERS = [
  "job number",
  "job #",
  "job#",
  "number",
  "job no",
  "job no.",
  "jobno",
  "job_number",
  "jobnumber",
];

const JOB_NAME_HEADERS = [
  "job name",
  "job",
  "project",
  "project name",
  "name",
  "job / project",
];

const CUSTOMER_HEADERS = [
  "customer",
  "client",
  "customer name",
  "client name",
  "owner",
];

const DATE_HEADERS = [
  "date",
  "job date",
  "start date",
  "start",
  "award date",
];

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[_-]+/g, " ")
    .trim();
}

function pickColumn(
  headers: string[],
  aliases: string[]
): number {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias);
    if (idx >= 0) return idx;
  }
  // partial contains
  for (let i = 0; i < normalized.length; i++) {
    for (const alias of aliases) {
      if (normalized[i]!.includes(alias) || alias.includes(normalized[i]!)) {
        return i;
      }
    }
  }
  return -1;
}

/** Keep alphanumeric job numbers as strings (e.g. 2164B). Never coerce to int. */
export function normalizeJobNumber(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Spreadsheet may have stored a numeric-looking id; keep as integer string without scientific notation
    return String(Math.trunc(raw)).trim();
  }
  return String(raw).trim();
}

export function jobNumberKey(jobNumber: string): string {
  return jobNumber.trim().toUpperCase();
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date heuristic
    if (value > 20000 && value < 80000) {
      const utc = Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000;
      const d = new Date(utc);
      if (!Number.isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    }
    return String(value);
  }
  return String(value).trim();
}

export function parseJobImportDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = cellToString(raw);
  if (!s) return null;

  // Already ISO-like
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // M/D/YYYY or MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    let year = Number(mdy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

function sheetToHeaderRows(sheet: XLSX.WorkSheet): {
  headers: string[];
  rows: unknown[][];
} {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];

  // Find header row: first non-empty row containing a job-number-like header
  let headerIdx = 0;
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const row = (aoa[i] ?? []).map((c) => normalizeHeader(cellToString(c)));
    if (
      pickColumn(row, JOB_NUMBER_HEADERS) >= 0 &&
      pickColumn(row, JOB_NAME_HEADERS) >= 0
    ) {
      headerIdx = i;
      break;
    }
  }

  const headerCells = (aoa[headerIdx] ?? []).map((c) => cellToString(c));
  const headers = headerCells.map((h, i) => h || `Column ${i + 1}`);
  const rows = aoa.slice(headerIdx + 1).filter((r) =>
    (r ?? []).some((c) => c != null && String(c).trim() !== "")
  );
  return { headers, rows };
}

export function parseJobImportWorkbook(
  buffer: Buffer,
  filename: string
): { sheetName: string; rows: NormalizedJobImportRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const ext = filename.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: true,
  });

  if (!workbook.SheetNames.length) {
    throw Object.assign(new Error("Spreadsheet has no sheets"), {
      statusCode: 400,
    });
  }

  // Prefer first sheet with detectable headers
  let chosenName = workbook.SheetNames[0]!;
  let parsed = sheetToHeaderRows(workbook.Sheets[chosenName]!);
  for (const name of workbook.SheetNames) {
    const candidate = sheetToHeaderRows(workbook.Sheets[name]!);
    const hn = candidate.headers.map(normalizeHeader);
    if (
      pickColumn(hn, JOB_NUMBER_HEADERS) >= 0 &&
      pickColumn(hn, JOB_NAME_HEADERS) >= 0
    ) {
      chosenName = name;
      parsed = candidate;
      break;
    }
  }

  const headerNorm = parsed.headers.map(normalizeHeader);
  const jobNumberIdx = pickColumn(headerNorm, JOB_NUMBER_HEADERS);
  const nameIdx = pickColumn(headerNorm, JOB_NAME_HEADERS);
  const customerIdx = pickColumn(headerNorm, CUSTOMER_HEADERS);
  const dateIdx = pickColumn(headerNorm, DATE_HEADERS);

  if (jobNumberIdx < 0 || nameIdx < 0) {
    throw Object.assign(
      new Error(
        "Could not detect Job Number and Job Name columns. Ensure the sheet has clear headers."
      ),
      { statusCode: 400 }
    );
  }

  if (ext === "csv" && workbook.SheetNames.length > 1) {
    warnings.push("CSV loaded as a single sheet");
  }

  const rows: NormalizedJobImportRow[] = [];
  parsed.rows.forEach((row, i) => {
    const jobNumber = normalizeJobNumber(row[jobNumberIdx]);
    const name = cellToString(row[nameIdx]);
    const rawCustomerName =
      customerIdx >= 0 ? cellToString(row[customerIdx]) || null : null;
    const date =
      dateIdx >= 0 ? parseJobImportDate(row[dateIdx]) : null;

    if (!jobNumber && !name) return;
    rows.push({
      rowIndex: i,
      date,
      jobNumber,
      name,
      rawCustomerName,
    });
  });

  return { sheetName: chosenName, rows, warnings };
}

/**
 * Best-effort PDF/text table parse — marks lowConfidence on all rows.
 * Prefer XLSX/CSV for production imports.
 */
export function parseJobImportFromPlainText(
  text: string
): { rows: NormalizedJobImportRow[]; warnings: string[] } {
  const warnings = [
    "PDF/text extraction is best-effort; review every row before import.",
  ];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows: NormalizedJobImportRow[] = [];
  // Pattern: jobNumber (digits+letter) ... name ... customer
  const jobNumRe = /\b(\d{3,5}[A-Za-z]?)\b/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(jobNumRe);
    if (!m) continue;
    const jobNumber = m[1]!;
    const rest = line.replace(m[0], " ").replace(/\s+/g, " ").trim();
    if (rest.length < 2) continue;
    // Split remaining on 2+ spaces or tabs if present
    const parts = rest.split(/\s{2,}|\t+/).map((p) => p.trim()).filter(Boolean);
    const name = parts[0] ?? rest;
    const rawCustomerName = parts[1] ?? null;
    rows.push({
      rowIndex: i,
      date: null,
      jobNumber,
      name,
      rawCustomerName,
    });
  }

  return { rows, warnings };
}

export function matchCustomerForImport(input: {
  rawCustomerName: string | null;
  customers: Array<{ id: string; name: string; normalizedName: string }>;
  aliases: Array<{
    customerId: string | null;
    normalizedAlias: string;
    alias: string;
  }>;
}): CustomerMatchResult {
  const raw = input.rawCustomerName?.trim() ?? "";
  if (!raw) {
    return {
      status: "EMPTY",
      customerId: null,
      customerName: null,
      candidates: [],
    };
  }

  const normalized = normalizeName(raw);
  if (!normalized) {
    return {
      status: "EMPTY",
      customerId: null,
      customerName: null,
      candidates: [],
    };
  }

  // 1. Exact normalized customer name
  const exact = input.customers.find((c) => c.normalizedName === normalized);
  if (exact) {
    return {
      status: "MATCHED",
      customerId: exact.id,
      customerName: exact.name,
      candidates: [{ id: exact.id, name: exact.name, score: 1 }],
    };
  }

  // 2. Approved customer aliases
  const aliasHits = input.aliases.filter(
    (a) => a.normalizedAlias === normalized && a.customerId
  );
  if (aliasHits.length === 1) {
    const customer = input.customers.find((c) => c.id === aliasHits[0]!.customerId);
    if (customer) {
      return {
        status: "MATCHED",
        customerId: customer.id,
        customerName: customer.name,
        candidates: [{ id: customer.id, name: customer.name, score: 1 }],
      };
    }
  }
  if (aliasHits.length > 1) {
    const candidates = aliasHits
      .map((a) => {
        const c = input.customers.find((x) => x.id === a.customerId);
        return c
          ? { id: c.id, name: c.name, score: 1 }
          : null;
      })
      .filter(Boolean) as Array<{ id: string; name: string; score: number }>;
    const unique = [...new Map(candidates.map((c) => [c.id, c])).values()];
    if (unique.length === 1) {
      return {
        status: "MATCHED",
        customerId: unique[0]!.id,
        customerName: unique[0]!.name,
        candidates: unique,
      };
    }
    if (unique.length > 1) {
      return {
        status: "AMBIGUOUS",
        customerId: null,
        customerName: null,
        candidates: unique,
      };
    }
  }

  // 3. Strong fuzzy only (>= 0.85). Multiple → AMBIGUOUS. Single weak → NOT_FOUND.
  const scored = input.customers
    .map((c) => ({
      id: c.id,
      name: c.name,
      score: computeSimilarity(normalized, c.normalizedName),
    }))
    .filter((c) => c.score >= 0.85)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 1 && scored[0]!.score >= 0.92) {
    return {
      status: "MATCHED",
      customerId: scored[0]!.id,
      customerName: scored[0]!.name,
      candidates: scored.slice(0, 5),
    };
  }
  if (scored.length > 1) {
    return {
      status: "AMBIGUOUS",
      customerId: null,
      customerName: null,
      candidates: scored.slice(0, 5),
    };
  }

  return {
    status: "NOT_FOUND",
    customerId: null,
    customerName: null,
    candidates: scored.slice(0, 5),
  };
}

export function enrichJobImportRows(input: {
  rows: NormalizedJobImportRow[];
  existingJobs: Array<{
    id: string;
    jobNumber: string | null;
    name: string;
    customerId: string | null;
  }>;
  customers: Array<{ id: string; name: string; normalizedName: string }>;
  aliases: Array<{
    customerId: string | null;
    normalizedAlias: string;
    alias: string;
  }>;
  lowConfidence?: boolean;
}): EnrichedJobImportRow[] {
  const byNumber = new Map<string, { id: string; name: string; jobNumber: string | null; customerId: string | null }>();
  for (const job of input.existingJobs) {
    if (!job.jobNumber) continue;
    byNumber.set(jobNumberKey(job.jobNumber), job);
  }

  const seenInFile = new Map<string, number>();
  const lowConfidence = input.lowConfidence ?? false;

  return input.rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const jn = normalizeJobNumber(row.jobNumber);
    const name = row.name.trim();

    if (!jn) errors.push("Missing job number");
    if (!name) errors.push("Missing job name");

    const customerMatch = matchCustomerForImport({
      rawCustomerName: row.rawCustomerName,
      customers: input.customers,
      aliases: input.aliases,
    });

    let status: JobImportRowStatus = "READY";
    let existingJobId: string | null = null;
    let existingJobName: string | null = null;
    let existingJobNumber: string | null = null;

    const key = jn ? jobNumberKey(jn) : "";
    if (key) {
      const priorIdx = seenInFile.get(key);
      if (priorIdx != null) {
        status = "INVALID";
        errors.push(`Duplicate job number in file (also row ${priorIdx + 1})`);
      } else {
        seenInFile.set(key, row.rowIndex);
      }

      const existing = byNumber.get(key);
      if (existing && status !== "INVALID") {
        existingJobId = existing.id;
        existingJobName = existing.name;
        existingJobNumber = existing.jobNumber;
        const nameDiff =
          normalizeName(existing.name) !== normalizeName(name);
        const customerDiff =
          Boolean(row.rawCustomerName) &&
          existing.customerId &&
          customerMatch.customerId &&
          existing.customerId !== customerMatch.customerId;
        if (nameDiff || customerDiff) {
          status = "CONFLICT";
          warnings.push(
            "Existing job with same number has different name and/or customer"
          );
        } else {
          status = "EXISTING";
        }
      }
    }

    if (errors.length > 0 && status === "READY") status = "INVALID";

    if (status === "READY") {
      if (customerMatch.status === "AMBIGUOUS") status = "CUSTOMER_AMBIGUOUS";
      else if (customerMatch.status === "NOT_FOUND") status = "CUSTOMER_NOT_FOUND";
    }

    if (lowConfidence) {
      warnings.push("Low extraction confidence — review carefully");
    }

    const selected =
      status === "READY" ||
      status === "CUSTOMER_NOT_FOUND" ||
      status === "CUSTOMER_AMBIGUOUS"
        ? status === "READY"
        : false;

    return {
      ...row,
      jobNumber: jn,
      name,
      status,
      selected: selected && status === "READY",
      customerMatch,
      existingJobId,
      existingJobName,
      existingJobNumber,
      errors,
      warnings,
      lowConfidence,
    };
  });
}

export function summarizeJobImport(rows: EnrichedJobImportRow[]) {
  const summary = {
    total: rows.length,
    ready: 0,
    existing: 0,
    conflict: 0,
    customerReview: 0,
    invalid: 0,
  };
  for (const row of rows) {
    switch (row.status) {
      case "READY":
        summary.ready++;
        break;
      case "EXISTING":
        summary.existing++;
        break;
      case "CONFLICT":
        summary.conflict++;
        break;
      case "CUSTOMER_NOT_FOUND":
      case "CUSTOMER_AMBIGUOUS":
        summary.customerReview++;
        break;
      default:
        summary.invalid++;
    }
  }
  return summary;
}
