import { describe, expect, it } from "vitest";
import {
  canPreviewFile,
  contentDispositionHeader,
  previewContentType,
  previewKind,
  resolveContentDelivery,
} from "../file-preview.js";

describe("canPreviewFile", () => {
  it("previews pdf and common raster images", () => {
    expect(canPreviewFile({ filename: "drawing-set.pdf", contentType: "application/pdf" })).toBe(true);
    expect(canPreviewFile({ filename: "site.jpg", contentType: "image/jpeg" })).toBe(true);
    expect(canPreviewFile({ filename: "site.jpeg", contentType: "image/jpeg" })).toBe(true);
    expect(canPreviewFile({ filename: "photo.png", contentType: "image/png" })).toBe(true);
    expect(canPreviewFile({ filename: "anim.gif", contentType: "image/gif" })).toBe(true);
    expect(canPreviewFile({ filename: "shot.webp", contentType: "image/webp" })).toBe(true);
    expect(previewKind({ filename: "drawing-set.pdf", contentType: "application/pdf" })).toBe("pdf");
    expect(previewKind({ filename: "photo.png", contentType: "image/png" })).toBe("image");
  });

  it("accepts imperfect MIME when the extension is a supported preview type", () => {
    expect(previewKind({ filename: "drawing-set.pdf", contentType: "application/octet-stream" })).toBe("pdf");
    expect(previewKind({ filename: "photo.png", contentType: "" })).toBe("image");
    expect(previewContentType({ filename: "drawing-set.pdf", contentType: "application/octet-stream" })).toBe(
      "application/pdf",
    );
    expect(previewContentType({ filename: "photo.jpg", contentType: "application/octet-stream" })).toBe("image/jpeg");
  });

  it("does not preview unsupported construction files", () => {
    for (const filename of ["plan.dwg", "plan.dxf", "pack.zip", "sheet.xlsx", "spec.docx", "part.step"]) {
      expect(canPreviewFile({ filename, contentType: "application/octet-stream" })).toBe(false);
    }
  });

  it("fails closed when MIME and extension disagree or the type can execute", () => {
    expect(canPreviewFile({ filename: "page.html", contentType: "image/png" })).toBe(false);
    expect(canPreviewFile({ filename: "photo.png", contentType: "text/html" })).toBe(false);
    expect(canPreviewFile({ filename: "drawing.pdf", contentType: "image/png" })).toBe(false);
    expect(canPreviewFile({ filename: "photo.jpg", contentType: "image/png" })).toBe(false);
    expect(canPreviewFile({ filename: "icon.svg", contentType: "image/svg+xml" })).toBe(false);
    expect(canPreviewFile({ filename: "icon.svg", contentType: "image/svg+xml" })).toBe(false);
    expect(canPreviewFile({ filename: "app.js", contentType: "application/javascript" })).toBe(false);
    expect(previewContentType({ filename: "icon.svg", contentType: "image/svg+xml" })).toBeNull();
  });
});

describe("resolveContentDelivery", () => {
  it("inlines only supported preview types", () => {
    expect(
      resolveContentDelivery({
        filename: "drawing-set.pdf",
        mimeType: "application/octet-stream",
        inlineRequested: true,
      }),
    ).toEqual({ disposition: "inline", contentType: "application/pdf" });
    expect(
      resolveContentDelivery({
        filename: "pack.zip",
        mimeType: "application/zip",
        inlineRequested: true,
      }),
    ).toEqual({ disposition: "attachment", contentType: "application/zip" });
  });

  it("keeps download disposition when inline is not requested", () => {
    expect(
      resolveContentDelivery({
        filename: "drawing-set.pdf",
        mimeType: "application/pdf",
        inlineRequested: false,
      }),
    ).toEqual({ disposition: "attachment", contentType: "application/pdf" });
    expect(contentDispositionHeader("attachment", "drawing set.pdf")).toBe(
      'attachment; filename="drawing%20set.pdf"',
    );
    expect(contentDispositionHeader("inline", "drawing set.pdf")).toBe(
      'inline; filename="drawing%20set.pdf"',
    );
  });
});
