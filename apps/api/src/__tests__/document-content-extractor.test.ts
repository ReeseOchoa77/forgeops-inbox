import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  buildAiAnalysisPayload,
  extractDocumentContent,
  validateDocumentUpload,
} from "../application/services/document-content-extractor.js";

describe("validateDocumentUpload", () => {
  it("accepts common office types", () => {
    for (const filename of [
      "a.pdf",
      "a.docx",
      "a.xlsx",
      "a.xls",
      "a.csv",
      "a.txt",
      "a.json",
      "a.png",
    ]) {
      expect(
        validateDocumentUpload({
          filename,
          mimeType: "application/octet-stream",
          sizeBytes: 100,
        }).ok
      ).toBe(true);
    }
  });

  it("rejects unsupported / executable types", () => {
    expect(
      validateDocumentUpload({
        filename: "malware.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 10,
      }).ok
    ).toBe(false);
    expect(
      validateDocumentUpload({
        filename: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 10,
      }).ok
    ).toBe(false);
  });
});

describe("extractDocumentContent", () => {
  it("extracts CSV as structured spreadsheet", async () => {
    const csv = "Name,Email\nAcme,a@x.com\nBeta,b@x.com\n";
    const result = await extractDocumentContent({
      filename: "contacts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });
    expect(result.kind).toBe("spreadsheet");
    expect(result.structured?.sheets?.[0]?.headers).toEqual(["Name", "Email"]);
    expect(result.structured?.sheets?.[0]?.rows[0]).toMatchObject({
      Name: "Acme",
      Email: "a@x.com",
    });
    const ai = buildAiAnalysisPayload(result);
    expect(ai).toContain("spreadsheet");
    expect(ai).toContain("Acme");
  });

  it("extracts XLSX with sheet names and headers", async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Item", "Qty"],
      ["Widget", 2],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const result = await extractDocumentContent({
      filename: "inv.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });
    expect(result.kind).toBe("spreadsheet");
    expect(result.structured?.sheets?.[0]?.name).toBe("Inventory");
    expect(result.structured?.sheets?.[0]?.headers).toEqual(["Item", "Qty"]);
  });

  it("extracts TXT", async () => {
    const result = await extractDocumentContent({
      filename: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello world", "utf8"),
    });
    expect(result.kind).toBe("text");
    expect(result.text).toContain("hello world");
  });

  it("marks ZIP as archive container only", async () => {
    const result = await extractDocumentContent({
      filename: "bundle.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("PK\u0003\u0004fake", "binary"),
    });
    expect(result.kind).toBe("archive");
    expect(result.text).toBeNull();
  });

  it("rejects unsupported binaries", async () => {
    const result = await extractDocumentContent({
      filename: "x.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([0, 1, 2, 3]),
    });
    expect(result.kind).toBe("rejected");
  });
});
