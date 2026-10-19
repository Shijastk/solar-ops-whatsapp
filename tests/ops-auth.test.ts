import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getWebhookEnv } from "../lib/env";
import {
  createOpsSession,
  getOpsSessionExpiresAt,
  isSameOriginRequest,
  isValidOpsAccessKey,
  opsSessionCookieOptions,
  verifyOpsSession,
} from "../lib/ops-auth";

const originalValues = {
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  META_APP_SECRET: process.env.META_APP_SECRET,
  OPS_ACCESS_KEY: process.env.OPS_ACCESS_KEY,
  NODE_ENV: process.env.NODE_ENV,
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
  it("fails closed when the dedicated key is missing or blank", () => {
    expect(isValidOpsAccessKey("webhook-verify-key")).toBe(false);
    expect(isValidOpsAccessKey("")).toBe(false);
    expect(verifyOpsSession("v1.1800000000000.invalid")).toBe(false);
    expect(() => createOpsSession()).toThrow("Operations access key is not configured");

    process.env.OPS_ACCESS_KEY = "   ";
    expect(isValidOpsAccessKey("webhook-verify-key")).toBe(false);
  });

  it("accepts only the dedicated operations key, never the webhook token", () => {
    process.env.OPS_ACCESS_KEY = "dedicated-dashboard-key";

    expect(isValidOpsAccessKey("dedicated-dashboard-key")).toBe(true);
    expect(isValidOpsAccessKey("wrong-key")).toBe(false);
    expect(isValidOpsAccessKey("webhook-verify-key")).toBe(false);
  });

  it("keeps webhook verification configuration independent of the dashboard key", () => {
    expect(getWebhookEnv().WHATSAPP_VERIFY_TOKEN).toBe("webhook-verify-key");
    expect(isValidOpsAccessKey("webhook-verify-key")).toBe(false);

    process.env.OPS_ACCESS_KEY = "dedicated-dashboard-key";
    expect(getWebhookEnv().WHATSAPP_VERIFY_TOKEN).toBe("webhook-verify-key");
  });

  it("creates and accepts a signed session only when the dedicated key is configured", () => {
    process.env.OPS_ACCESS_KEY = "dedicated-dashboard-key";
    const now = 1_800_000_000_000;
    const session = createOpsSession(now, 60_000);

    expect(verifyOpsSession(session, now + 30_000)).toBe(true);
    expect(getOpsSessionExpiresAt(session, now + 30_000)).toBe(now + 60_000);

    delete process.env.OPS_ACCESS_KEY;
    expect(verifyOpsSession(session, now + 30_000)).toBe(false);
    expect(getOpsSessionExpiresAt(session, now + 30_000)).toBeNull();
  });

  it("rejects expired and tampered sessions", () => {
    process.env.OPS_ACCESS_KEY = "dedicated-dashboard-key";
    const now = 1_800_000_000_000;
    const session = createOpsSession(now, 60_000);

    expect(verifyOpsSession(session, now + 60_001)).toBe(false);
    expect(getOpsSessionExpiresAt(session, now + 60_001)).toBeNull();
    expect(verifyOpsSession(`${session.slice(0, -1)}0`, now + 30_000)).toBe(false);
  });

  it("sets secure, HttpOnly, same-site session cookie attributes", () => {
    process.env.NODE_ENV = "production";
    expect(opsSessionCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    delete process.env.NODE_ENV;
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
      isSameOriginRequest(new Request("https://ops.example.test/api/ops/logout")),
    ).toBe(false);
  });
});
