import { afterEach, describe, expect, it } from "vitest";
import { getIngestionEnv } from "../lib/env";

const keys = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "META_GRAPH_API_VERSION",
  "ALLOWED_WHATSAPP_SENDERS",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "MAX_MEDIA_BYTES",
] as const;

const originalValues = Object.fromEntries(
  keys.map((key) => [key, process.env[key]]),
) as Record<(typeof keys)[number], string | undefined>;

afterEach(() => {
  for (const key of keys) {
    const original = originalValues[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe("getIngestionEnv", () => {
  it("defaults the Meta Graph API version to v26.0", () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-secret";
    process.env.SUPABASE_STORAGE_BUCKET = "whatsapp-media";
    delete process.env.META_GRAPH_API_VERSION;

    const env = getIngestionEnv();

    expect(env.META_GRAPH_API_VERSION).toBe("v26.0");
  });

  it("normalizes the optional sender allowlist to digits only", () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-secret";
    process.env.SUPABASE_STORAGE_BUCKET = "whatsapp-media";
    process.env.ALLOWED_WHATSAPP_SENDERS = "+91 99999 99999, +1 (555) 123-4567";

    const env = getIngestionEnv();

    expect(env.allowedSenders).toEqual(
      new Set(["919999999999", "15551234567"]),
    );
  });
});
