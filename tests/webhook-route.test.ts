import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "../app/api/whatsapp/route";

const originalVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
const originalAppSecret = process.env.META_APP_SECRET;

function sign(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("/api/whatsapp", () => {
  beforeEach(() => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token";
    process.env.META_APP_SECRET = "test-app-secret";
  });

  afterEach(() => {
    if (originalVerifyToken === undefined) {
      delete process.env.WHATSAPP_VERIFY_TOKEN;
    } else {
      process.env.WHATSAPP_VERIFY_TOKEN = originalVerifyToken;
    }

    if (originalAppSecret === undefined) {
      delete process.env.META_APP_SECRET;
    } else {
      process.env.META_APP_SECRET = originalAppSecret;
    }
  });

  it("returns Meta's challenge when webhook verification is valid", async () => {
    const request = new Request(
      "https://example.test/api/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-123",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-123");
  });

  it("rejects webhook verification with the wrong token", async () => {
    const request = new Request(
      "https://example.test/api/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123",
    );

    const response = await GET(request);

    expect(response.status).toBe(403);
  });

  it("rejects POST requests without a valid Meta signature", async () => {
    const request = new Request("https://example.test/api/whatsapp", {
      method: "POST",
      body: JSON.stringify({
        object: "whatsapp_business_account",
        entry: [],
      }),
      headers: {
        "content-type": "application/json",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it("rejects invalid JSON after signature verification", async () => {
    const body = "not-json";
    const request = new Request("https://example.test/api/whatsapp", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(body, "test-app-secret"),
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("accepts a valid signed webhook that contains no messages", async () => {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [],
    });

    const request = new Request("https://example.test/api/whatsapp", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(body, "test-app-secret"),
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      processed: 0,
      statusUpdates: 0,
    });
  });
});
