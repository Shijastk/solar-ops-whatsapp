import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOpsSession,
  getOpsSessionExpiresAt,
  isSameOriginRequest,
  isValidOpsAccessKey,
  verifyOpsSession,
} from "../lib/ops-auth";

const originalValues = {
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  META_APP_SECRET: process.env.META_APP_SECRET,
  OPS_ACCESS_KEY: process.env.OPS_ACCESS_KEY,
};

beforeEach(() => {
  process.env.WHATSAPP_VERIFY_TOKEN = "webhook-verify-key";
  process.env.META_APP_SECRET = "meta-app-secret";
  delete process.env.OPS_ACCESS_KEY;
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalValues)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("ops authentication", () => {
  it("falls back to the existing webhook verify token when no dedicated key exists", () => {
    expect(isValidOpsAccessKey("webhook-verify-key")).toBe(true);
    expect(isValidOpsAccessKey("wrong-key")).toBe(false);
  });

  it("prefers a dedicated operations access key when configured", () => {
    process.env.OPS_ACCESS_KEY = "dedicated-dashboard-key";

    expect(isValidOpsAccessKey("dedicated-dashboard-key")).toBe(true);
    expect(isValidOpsAccessKey("webhook-verify-key")).toBe(false);
  });

  it("accepts a valid signed session before expiry", () => {
    const now = 1_800_000_000_000;
    const session = createOpsSession(now, 60_000);

    expect(verifyOpsSession(session, now + 30_000)).toBe(true);
  });

  it("returns expiry only for a currently valid signed session", () => {
    const now = 1_800_000_000_000;
    const session = createOpsSession(now, 60_000);

    expect(getOpsSessionExpiresAt(session, now + 30_000)).toBe(now + 60_000);
    expect(getOpsSessionExpiresAt(session, now + 60_001)).toBeNull();
  });

  it("rejects expired and tampered sessions", () => {
    const now = 1_800_000_000_000;
    const session = createOpsSession(now, 60_000);

    expect(verifyOpsSession(session, now + 60_001)).toBe(false);
    expect(
      verifyOpsSession(`${session.slice(0, -1)}0`, now + 30_000),
    ).toBe(false);
  });

  it("accepts same-origin POST context from Origin or Referer", () => {
    expect(
      isSameOriginRequest(
        new Request("https://ops.example.test/api/ops/logout", {
          headers: { origin: "https://ops.example.test" },
        }),
      ),
    ).toBe(true);

    expect(
      isSameOriginRequest(
        new Request("https://ops.example.test/api/ops/logout", {
          headers: { referer: "https://ops.example.test/ops" },
        }),
      ),
    ).toBe(true);
  });

  it("rejects cross-origin and missing-origin POST context", () => {
    expect(
      isSameOriginRequest(
        new Request("https://ops.example.test/api/ops/logout", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(false);

    expect(
      isSameOriginRequest(
        new Request("https://ops.example.test/api/ops/logout"),
      ),
    ).toBe(false);
  });
});
