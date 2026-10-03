import { describe, expect, it } from "vitest";
import {
  buildInboundStoragePath,
  cleanInboundFilename,
  extensionForInboundMime,
  isPdfInboundMedia,
} from "../lib/media-processing";

describe("stored WhatsApp media worker helpers", () => {
  it("keeps storage paths deterministic across retries", () => {
    const input = {
      senderPhone: "919999999999",
      receivedAt: new Date("2026-10-03T10:00:00.000Z"),
      whatsappMessageId: "wamid.retry-safe-123",
      filename: "Bill SSSL 001.pdf",
    };

    const first = buildInboundStoragePath(input);
    const second = buildInboundStoragePath(input);

    expect(first).toBe(second);
    expect(first).toMatch(
      /^919999999999\/2026\/10\/[a-f0-9]{24}\/Bill-SSSL-001\.pdf$/,
    );
    expect(first).not.toContain("wamid.retry-safe-123");
  });

  it("sanitizes inbound filenames without removing the useful extension", () => {
    expect(cleanInboundFilename("../../Bill 01.pdf")).toBe("Bill-01.pdf");
    expect(cleanInboundFilename(" panel / invoice .pdf ")).toBe(
      "panel-_-invoice-.pdf",
    );
  });

  it("uses known extensions only and leaves unknown MIME types extensionless", () => {
    expect(extensionForInboundMime("application/pdf")).toBe(".pdf");
    expect(extensionForInboundMime("image/jpeg")).toBe(".jpg");
    expect(extensionForInboundMime("application/octet-stream")).toBe("");
  });

  it("recognizes a PDF from the resolved MIME type or filename fallback", () => {
    expect(
      isPdfInboundMedia({
        mimeType: "application/pdf",
        originalFilename: "bill.bin",
      }),
    ).toBe(true);

    expect(
      isPdfInboundMedia({
        mimeType: "application/octet-stream",
        originalFilename: "bill.PDF",
      }),
    ).toBe(true);

    expect(
      isPdfInboundMedia({
        mimeType: "image/jpeg",
        originalFilename: "photo.jpg",
      }),
    ).toBe(false);
  });
});
