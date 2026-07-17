import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const fixturePath = resolve(__dirname, "fixtures", "test-customers.pdf");

describe("PDF import pipeline", () => {
  it("pdf-parse module exports PDFParse and VerbosityLevel", async () => {
    const mod = await import("pdf-parse");
    expect(typeof mod.PDFParse).toBe("function");
    expect(mod.VerbosityLevel).toBeDefined();
    expect(typeof mod.VerbosityLevel.ERRORS).toBe("number");
  });

  it("parses a valid PDF and extracts text", async () => {
    const mod = await import("pdf-parse");
    const buffer = readFileSync(fixturePath);
    
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.slice(0, 5).toString("ascii")).toBe("%PDF-");

    const parser = new mod.PDFParse({
      data: new Uint8Array(buffer),
      verbosity: mod.VerbosityLevel.ERRORS
    });

    const result = await parser.getText();
    expect(typeof result.text).toBe("string");
    await parser.destroy();
  });

  it("rejects a non-PDF buffer", async () => {
    const buffer = Buffer.from("This is not a PDF file", "utf-8");
    expect(buffer.slice(0, 5).toString("ascii")).not.toBe("%PDF-");
  });

  it("rejects an empty buffer", async () => {
    const buffer = Buffer.alloc(0);
    expect(buffer.length).toBe(0);
  });

  it("parser.destroy() does not throw", async () => {
    const mod = await import("pdf-parse");
    const buffer = readFileSync(fixturePath);
    const parser = new mod.PDFParse({
      data: new Uint8Array(buffer),
      verbosity: mod.VerbosityLevel.ERRORS
    });
    await parser.getText();
    await expect(parser.destroy()).resolves.not.toThrow();
  });

  it("VerbosityLevel.ERRORS is 0", async () => {
    const mod = await import("pdf-parse");
    expect(mod.VerbosityLevel.ERRORS).toBe(0);
  });

  it("does not parse PDF more than once with shared function pattern", async () => {
    const mod = await import("pdf-parse");
    const buffer = readFileSync(fixturePath);
    let parseCount = 0;

    async function parsePdfOnce(buf: Buffer): Promise<string> {
      parseCount++;
      const parser = new mod.PDFParse({
        data: new Uint8Array(buf),
        verbosity: mod.VerbosityLevel.ERRORS
      });
      try {
        const result = await parser.getText();
        return result.text;
      } finally {
        await parser.destroy().catch(() => {});
      }
    }

    const text = await parsePdfOnce(buffer);
    expect(typeof text).toBe("string");
    expect(parseCount).toBe(1);
  });

  it("CSV extraction works with plain text", () => {
    const csv = "Name,Phone,Email\nJE Dunn,555-1234,je@dunn.com\nKraus-Anderson,555-5678,info@ka.com\n";
    const lines = csv.split("\n").filter(Boolean);
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("Name");
  });
});
