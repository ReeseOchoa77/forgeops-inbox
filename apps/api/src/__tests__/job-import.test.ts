import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  enrichJobImportRows,
  jobNumberKey,
  matchCustomerForImport,
  normalizeJobNumber,
  parseJobImportDate,
  parseJobImportWorkbook,
  summarizeJobImport,
} from "../application/services/job-import.js";

function buildXlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Jobs");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("normalizeJobNumber", () => {
  it("keeps alphanumeric job numbers as strings", () => {
    expect(normalizeJobNumber("2164B")).toBe("2164B");
    expect(normalizeJobNumber("2166D")).toBe("2166D");
    expect(jobNumberKey("2164b")).toBe("2164B");
  });

  it("does not turn numbers into scientific notation", () => {
    expect(normalizeJobNumber(2172)).toBe("2172");
  });
});

describe("parseJobImportDate", () => {
  it("parses ISO and US dates", () => {
    expect(parseJobImportDate("2024-03-15")).toBe("2024-03-15");
    expect(parseJobImportDate("3/15/2024")).toBe("2024-03-15");
  });
});

describe("parseJobImportWorkbook", () => {
  it("parses XLSX with header aliases", () => {
    const buf = buildXlsx([
      ["Date", "Job Number", "Job Name", "Customer"],
      ["1/10/2024", "2164B", "Office Reno", "JE Dunn"],
      ["2/1/2024", "2166D", "Hospital Wing", "Turner"],
    ]);
    const parsed = parseJobImportWorkbook(buf, "jobs.xlsx");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]!.jobNumber).toBe("2164B");
    expect(parsed.rows[0]!.name).toBe("Office Reno");
    expect(parsed.rows[0]!.rawCustomerName).toBe("JE Dunn");
    expect(parsed.rows[0]!.date).toBe("2024-01-10");
  });

  it("parses CSV", () => {
    const csv = "Job #,Project,Client\n2172D,School Addition,ABC Builders\n";
    const buf = Buffer.from(csv, "utf8");
    const parsed = parseJobImportWorkbook(buf, "jobs.csv");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.jobNumber).toBe("2172D");
    expect(parsed.rows[0]!.name).toBe("School Addition");
  });
});

describe("matchCustomerForImport", () => {
  const customers = [
    { id: "c1", name: "JE Dunn", normalizedName: "je dunn" },
    { id: "c2", name: "Turner Construction", normalizedName: "turner" },
  ];
  const aliases = [
    { customerId: "c1", normalizedAlias: "jedunn", alias: "JeDunn" },
  ];

  it("matches exact normalized name", () => {
    const m = matchCustomerForImport({
      rawCustomerName: "JE Dunn",
      customers,
      aliases,
    });
    expect(m.status).toBe("MATCHED");
    expect(m.customerId).toBe("c1");
  });

  it("matches approved alias", () => {
    const m = matchCustomerForImport({
      rawCustomerName: "JeDunn",
      customers,
      aliases,
    });
    expect(m.status).toBe("MATCHED");
    expect(m.customerId).toBe("c1");
  });

  it("returns NOT_FOUND for unknown", () => {
    const m = matchCustomerForImport({
      rawCustomerName: "Totally Unknown Co",
      customers,
      aliases,
    });
    expect(m.status).toBe("NOT_FOUND");
  });

  it("returns AMBIGUOUS for multiple alias hits", () => {
    const m2 = matchCustomerForImport({
      rawCustomerName: "Acme",
      customers: [
        { id: "a1", name: "Acme One", normalizedName: "acme one" },
        { id: "a2", name: "Acme Two", normalizedName: "acme two" },
      ],
      aliases: [
        { customerId: "a1", normalizedAlias: "acme", alias: "Acme" },
        { customerId: "a2", normalizedAlias: "acme", alias: "Acme" },
      ],
    });
    expect(m2.status).toBe("AMBIGUOUS");
    expect(m2.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("returns EMPTY when missing", () => {
    expect(
      matchCustomerForImport({
        rawCustomerName: null,
        customers,
        aliases,
      }).status
    ).toBe("EMPTY");
  });
});

describe("enrichJobImportRows", () => {
  const customers = [
    { id: "c1", name: "JE Dunn", normalizedName: "je dunn" },
  ];

  it("marks existing job by number", () => {
    const rows = enrichJobImportRows({
      rows: [
        {
          rowIndex: 0,
          date: "2024-01-01",
          jobNumber: "2164B",
          name: "Office Reno",
          rawCustomerName: "JE Dunn",
        },
      ],
      existingJobs: [
        { id: "j1", jobNumber: "2164B", name: "Office Reno", customerId: "c1" },
      ],
      customers,
      aliases: [],
    });
    expect(rows[0]!.status).toBe("EXISTING");
    expect(rows[0]!.selected).toBe(false);
  });

  it("marks conflict when name differs", () => {
    const rows = enrichJobImportRows({
      rows: [
        {
          rowIndex: 0,
          date: null,
          jobNumber: "2164B",
          name: "Different Name",
          rawCustomerName: null,
        },
      ],
      existingJobs: [
        { id: "j1", jobNumber: "2164B", name: "Office Reno", customerId: null },
      ],
      customers,
      aliases: [],
    });
    expect(rows[0]!.status).toBe("CONFLICT");
  });

  it("detects duplicates within file", () => {
    const rows = enrichJobImportRows({
      rows: [
        {
          rowIndex: 0,
          date: null,
          jobNumber: "2168P",
          name: "A",
          rawCustomerName: null,
        },
        {
          rowIndex: 1,
          date: null,
          jobNumber: "2168P",
          name: "B",
          rawCustomerName: null,
        },
      ],
      existingJobs: [],
      customers,
      aliases: [],
    });
    expect(rows[1]!.status).toBe("INVALID");
    expect(rows[1]!.errors[0]).toMatch(/Duplicate/);
  });

  it("ready when matched customer", () => {
    const rows = enrichJobImportRows({
      rows: [
        {
          rowIndex: 0,
          date: "2024-05-01",
          jobNumber: "2211",
          name: "New Build",
          rawCustomerName: "JE Dunn",
        },
      ],
      existingJobs: [],
      customers,
      aliases: [],
    });
    expect(rows[0]!.status).toBe("READY");
    expect(rows[0]!.selected).toBe(true);
    const summary = summarizeJobImport(rows);
    expect(summary.ready).toBe(1);
  });

  it("flags missing customer for review", () => {
    const rows = enrichJobImportRows({
      rows: [
        {
          rowIndex: 0,
          date: null,
          jobNumber: "2200A",
          name: "Warehouse",
          rawCustomerName: "Unknown GC LLC",
        },
      ],
      existingJobs: [],
      customers,
      aliases: [],
    });
    expect(rows[0]!.status).toBe("CUSTOMER_NOT_FOUND");
    expect(rows[0]!.selected).toBe(false);
  });
});

describe("malformed spreadsheet", () => {
  it("throws when headers cannot be detected", () => {
    const buf = buildXlsx([
      ["Foo", "Bar", "Baz"],
      ["1", "2", "3"],
    ]);
    expect(() => parseJobImportWorkbook(buf, "bad.xlsx")).toThrow(/Could not detect/);
  });
});
