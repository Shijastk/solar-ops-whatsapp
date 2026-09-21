import { describe, expect, it } from "vitest";
import {
  buildMarkdownReport,
  buildMinimalPdf,
  buildWebhookPayload,
  describeGraphApiError,
  normalizeDigits,
  redactText,
  sha256Hex,
  signWebhookBody,
} from "../scripts/integration/helpers.mjs";

describe("credentialed integration helpers", () => {
  it("builds signed text and document webhook fixtures", () => {
    const text = buildWebhookPayload({
      messageId: "integration.text.test",
      senderPhone: "919999999999",
      phoneNumberId: "phone-test",
      timestampSeconds: 1789974000,
      type: "text",
      textBody: "hello",
    });
    expect(text.entry[0].changes[0].value.messages[0]).toMatchObject({
      from: "919999999999",
      id: "integration.text.test",
      type: "text",
      text: { body: "hello" },
    });

    const document = buildWebhookPayload({
      messageId: "integration.document.test",
      senderPhone: "919999999999",
      phoneNumberId: "phone-test",
      timestampSeconds: 1789974000,
      type: "document",
      media: {
        id: "media-test",
        filename: "fixture.pdf",
        mime_type: "application/pdf",
      },
    });
    expect(document.entry[0].changes[0].value.messages[0].document).toEqual({
      id: "media-test",
      filename: "fixture.pdf",
      mime_type: "application/pdf",
    });
  });

  it("creates a deterministic HMAC signature and normalizes phone digits", () => {
    expect(signWebhookBody("{}", "secret")).toBe(
      "sha256=77325902caca812dc259733aacd046b73817372c777b8d95b402647474516e13",
    );
    expect(normalizeDigits("+91 (99999) 99999")).toBe("919999999999");
  });

  it("creates a minimal PDF whose hash is stable", () => {
    const first = buildMinimalPdf("fixture");
    const second = buildMinimalPdf("fixture");
    expect(first.subarray(0, 8).toString("utf8")).toBe("%PDF-1.4");
    expect(first.toString("utf8")).toContain("%%EOF");
    expect(sha256Hex(first)).toBe(sha256Hex(second));
  });

  it("redacts configured secrets, bearer values, and long numeric identifiers", () => {
    const redacted = redactText(
      "token=super-secret Authorization: Bearer abc.def.ghi sender=919999999999",
      ["super-secret"],
    );
    expect(redacted).not.toContain("super-secret");
    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).not.toContain("919999999999");
    expect(redacted).toContain("[redacted-secret]");
    expect(redacted).toContain("[redacted-identifier]");
  });

  it("renders safe Meta Graph error details without leaking identifiers or secrets", () => {
    const details = describeGraphApiError(
      {
        error: {
          message:
            "Unsupported post request for object 123456789012345 using token super-secret",
          type: "GraphMethodException",
          code: 100,
          error_subcode: 33,
        },
      },
      400,
      ["super-secret"],
    );

    expect(details).toContain("HTTP 400");
    expect(details).toContain("type=GraphMethodException");
    expect(details).toContain("code=100");
    expect(details).toContain("subcode=33");
    expect(details).not.toContain("123456789012345");
    expect(details).not.toContain("super-secret");
    expect(details).toContain("[redacted-identifier]");
    expect(details).toContain("[redacted-secret]");
  });

  it("renders a report without adding payload or credential sections", () => {
    const markdown = buildMarkdownReport({
      ok: true,
      startedAt: "2026-09-21T00:00:00.000Z",
      finishedAt: "2026-09-21T00:00:01.000Z",
      graphApiVersion: "v26.0",
      targetOrigin: "https://example.test",
      checks: [
        {
          name: "health.secure-runtime",
          status: "pass",
          durationMs: 5,
          details: "runtime configured",
        },
      ],
      cleanup: [],
    });
    expect(markdown).toContain("Overall: **PASS**");
    expect(markdown).toContain("health.secure-runtime");
    expect(markdown).toContain("intentionally excludes access tokens");
  });
});
