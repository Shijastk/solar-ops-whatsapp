import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaSignature } from "../lib/signature";

function makeSignature(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("verifyMetaSignature", () => {
  const secret = "test-app-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account" });

  it("accepts a valid Meta HMAC signature", () => {
    expect(verifyMetaSignature(body, makeSignature(body, secret), secret)).toBe(true);
  });

  it("rejects a missing signature", () => {
    expect(verifyMetaSignature(body, null, secret)).toBe(false);
  });

  it("rejects a signature with the wrong prefix", () => {
    expect(verifyMetaSignature(body, "sha1=abc123", secret)).toBe(false);
  });

  it("rejects a signature generated with a different secret", () => {
    expect(
      verifyMetaSignature(body, makeSignature(body, "different-secret"), secret),
    ).toBe(false);
  });

  it("rejects a malformed signature length without throwing", () => {
    expect(verifyMetaSignature(body, "sha256=abc", secret)).toBe(false);
  });
});
