import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "../app/api/ops/session/route";
import { OPS_SESSION_COOKIE, verifyOpsSession } from "../lib/ops-auth";

const original = {
  OPS_ACCESS_KEY: process.env.OPS_ACCESS_KEY,
  META_APP_SECRET: process.env.META_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  NODE_ENV: process.env.NODE_ENV,
};

beforeEach(() => {
  delete process.env.OPS_ACCESS_KEY;
  process.env.META_APP_SECRET = "test-meta-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-webhook-token";
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function loginRequest(accessKey: string, origin = "https://ops.example.test") {
  return new Request("https://ops.example.test/api/ops/session", {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ accessKey }),
  });
}

describe("operations dashboard login route", () => {
  it("fails closed when the dedicated credential is missing, without setting a session", async () => {
    const response = await POST(loginRequest("test-webhook-token"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/ops/login?error=1");
    expect(response.headers.get("set-cookie") ?? "").not.toContain(OPS_SESSION_COOKIE);
    expect(response.headers.get("cache-control")).not.toBe("public");
  });

  it("rejects an invalid key without issuing a session", async () => {
    process.env.OPS_ACCESS_KEY = "dedicated-ops-test-key";

    const response = await POST(loginRequest("wrong-key"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/ops/login?error=1");
    expect(response.headers.get("set-cookie") ?? "").not.toContain(OPS_SESSION_COOKIE);
  });

  it("issues an HttpOnly session only for the dedicated key", async () => {
    process.env.OPS_ACCESS_KEY = "dedicated-ops-test-key";

    const response = await POST(loginRequest("dedicated-ops-test-key"));
    const cookie = response.headers.get("set-cookie") ?? "";
    const match = cookie.match(new RegExp(`${OPS_SESSION_COOKIE}=([^;]+)`));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://ops.example.test/ops");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=strict");
    expect(match).not.toBeNull();
    expect(verifyOpsSession(match?.[1])).toBe(true);
  });

  it("rejects cross-origin login attempts", async () => {
    process.env.OPS_ACCESS_KEY = "dedicated-ops-test-key";

    const response = await POST(
      loginRequest("dedicated-ops-test-key", "https://evil.example"),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie") ?? "").not.toContain(OPS_SESSION_COOKIE);
  });
});
