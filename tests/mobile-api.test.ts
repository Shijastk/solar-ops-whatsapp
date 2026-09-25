import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOpsSession } from "../lib/ops-auth";
import {
  isPdfOpsMessage,
  maskMobilePhone,
  readMobileBearerToken,
  verifyMobileRequest,
} from "../lib/mobile-api";

const original = {
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  META_APP_SECRET: process.env.META_APP_SECRET,
};

beforeEach(() => {
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-key";
  process.env.META_APP_SECRET = "mobile-secret";
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("mobile API authentication helpers", () => {
  it("reads and verifies a Bearer ops session", () => {
    const now = 1_800_000_000_000;
    const token = createOpsSession(now, 60_000);
    const request = new Request("https://ops.example.test/api/mobile/v1/bootstrap", {
      headers: { authorization: "Bearer " + token },
    });

    expect(readMobileBearerToken(request)).toBe(token);
    expect(verifyMobileRequest(request, now + 30_000)).toBe(true);
    expect(verifyMobileRequest(request, now + 60_001)).toBe(false);
  });

  it("rejects missing or malformed authorization", () => {
    expect(
      verifyMobileRequest(
        new Request("https://ops.example.test/api/mobile/v1/bootstrap"),
      ),
    ).toBe(false);

    expect(
      readMobileBearerToken(
        new Request("https://ops.example.test/api/mobile/v1/bootstrap", {
          headers: { authorization: "Basic abc" },
        }),
      ),
    ).toBeNull();
  });

  it("masks phone numbers and identifies PDF messages", () => {
    expect(maskMobilePhone("+91 98765 43210")).toBe("•••• 3210");
    expect(
      isPdfOpsMessage({
        id: "11111111-1111-4111-8111-111111111111",
        whatsapp_message_id: "wamid.test",
        sender_phone: "919876543210",
        sender_name: null,
        message_type: "document",
        text_body: null,
        original_filename: "bill.PDF",
        mime_type: "application/octet-stream",
        media_size_bytes: 100,
        storage_path: null,
        processing_status: "stored",
        received_at: "2026-09-25T00:00:00.000Z",
        processed_at: null,
      }),
    ).toBe(true);
  });
});
