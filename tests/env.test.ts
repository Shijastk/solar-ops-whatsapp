import { afterEach, describe, expect, it } from "vitest";
import {
  getDocumentAutomationEnv,
  getHealthConfiguration,
  getIngestionEnv,
} from "../lib/env";

const keys = [
  "WHATSAPP_VERIFY_TOKEN",
  "META_APP_SECRET",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "META_GRAPH_API_VERSION",
  "ALLOWED_WHATSAPP_SENDERS",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "MAX_MEDIA_BYTES",
  "DOCUMENT_AUTOMATION_ENABLED",
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "GROQ_TIMEOUT_MS",
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

function setValidEnvironment() {
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-token";
  process.env.META_APP_SECRET = "test-app-secret";
  process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
  process.env.META_GRAPH_API_VERSION = "v26.0";
  process.env.ALLOWED_WHATSAPP_SENDERS = "919999999999";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.SUPABASE_STORAGE_BUCKET = "whatsapp-media";
  process.env.MAX_MEDIA_BYTES = "15728640";
  process.env.DOCUMENT_AUTOMATION_ENABLED = "false";
}

describe("getIngestionEnv", () => {
  it("defaults the Meta Graph API version to v26.0", () => {
    setValidEnvironment();
    delete process.env.META_GRAPH_API_VERSION;

    const env = getIngestionEnv();

    expect(env.META_GRAPH_API_VERSION).toBe("v26.0");
  });

  it("normalizes the optional sender allowlist to digits only", () => {
    setValidEnvironment();
    process.env.ALLOWED_WHATSAPP_SENDERS =
      "+91 99999 99999, +1 (555) 123-4567";

    const env = getIngestionEnv();

    expect(env.allowedSenders).toEqual(
      new Set(["919999999999", "15551234567"]),
    );
  });
});

describe("getHealthConfiguration", () => {
  it("reports full runtime configuration as valid without exposing values", () => {
    setValidEnvironment();

    const result = getHealthConfiguration();

    expect(result.validation).toEqual({
      webhook: true,
      ingestion: true,
      automation: {
        enabled: false,
        ready: true,
        invalidFields: [],
      },
      invalidFields: [],
    });
    expect(result.presence.SUPABASE_SECRET_KEY).toBe(true);
    expect(JSON.stringify(result)).not.toContain("test-secret");
    expect(JSON.stringify(result)).not.toContain("test-token");
  });

  it("reports invalid field names without exposing invalid values", () => {
    setValidEnvironment();
    process.env.SUPABASE_URL = "not-a-url";
    process.env.MAX_MEDIA_BYTES = "not-a-number";

    const result = getHealthConfiguration();

    expect(result.validation.webhook).toBe(true);
    expect(result.validation.ingestion).toBe(false);
    expect(result.validation.invalidFields).toEqual([
      "MAX_MEDIA_BYTES",
      "SUPABASE_URL",
    ]);
    expect(JSON.stringify(result)).not.toContain("not-a-url");
    expect(JSON.stringify(result)).not.toContain("not-a-number");
  });
});


describe("getDocumentAutomationEnv", () => {
  it("is disabled by default and does not require a Groq key", () => {
    setValidEnvironment();
    delete process.env.DOCUMENT_AUTOMATION_ENABLED;
    delete process.env.GROQ_API_KEY;

    expect(getDocumentAutomationEnv()).toMatchObject({
      enabled: false,
      apiKey: null,
      model: "openai/gpt-oss-20b",
      timeoutMs: 7000,
    });
  });

  it("fails closed when automation is enabled without a Groq key", () => {
    setValidEnvironment();
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    delete process.env.GROQ_API_KEY;

    expect(() => getDocumentAutomationEnv()).toThrow("GROQ_API_KEY");
    const health = getHealthConfiguration();
    expect(health.validation.automation).toEqual({
      enabled: true,
      ready: false,
      invalidFields: ["GROQ_API_KEY"],
    });
  });

  it("accepts an explicitly configured Groq verifier", () => {
    setValidEnvironment();
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    process.env.GROQ_API_KEY = "groq-test-key";
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    process.env.GROQ_TIMEOUT_MS = "6000";

    expect(getDocumentAutomationEnv()).toMatchObject({
      enabled: true,
      apiKey: "groq-test-key",
      model: "openai/gpt-oss-20b",
      timeoutMs: 6000,
    });
  });
});
