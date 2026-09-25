import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "../app/api/mobile/v1/session/route";

const original = {
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  META_APP_SECRET: process.env.META_APP_SECRET,
  OPS_ACCESS_KEY: process.env.OPS_ACCESS_KEY,
};

beforeEach(() => {
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-key";
  process.env.META_APP_SECRET = "mobile-secret";
  process.env.OPS_ACCESS_KEY = "ops-login-key";
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("mobile session route", () => {
  it("returns a signed short-lived session for the valid access key", async () => {
    const response = await POST(
      new Request("https://ops.example.test/api/mobile/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessKey: "ops-login-key" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(typeof body.token).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
  });

  it("does not issue a session for an invalid key", async () => {
    const response = await POST(
      new Request("https://ops.example.test/api/mobile/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessKey: "wrong-key" }),
      }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Invalid access key" });
  });
});
