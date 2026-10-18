import { describe, expect, it } from "vitest";
import { validateHealthResponse } from "../scripts/quality/production-health-smoke.mjs";

const healthyResponse = () => ({
  ok: true,
  service: "solar-ops-whatsapp",
  configured: true,
  configuration: {
    presence: {
      WHATSAPP_ACCESS_TOKEN: true,
      SUPABASE_SECRET_KEY: true,
      ALLOWED_WHATSAPP_SENDERS: true,
    },
    validation: {
      webhook: true,
      ingestion: true,
      automation: { enabled: false, ready: true, invalidFields: [] },
    },
  },
  timestamp: "2026-10-18T12:00:00.000Z",
});

const safeHeaders = new Headers({ "cache-control": "no-store" });

describe("production health response quality gate", () => {
  it("accepts healthy configuration diagnostics without exposing secret values", () => {
    expect(validateHealthResponse(healthyResponse(), safeHeaders)).toEqual([]);
  });

  it("fails closed when required runtime configuration is unhealthy", () => {
    const body = healthyResponse();
    body.configured = false;
    body.configuration.validation.webhook = false;

    expect(validateHealthResponse(body, safeHeaders)).toEqual([
      "required webhook/ingestion configuration is not valid",
      "webhook or ingestion validation is not healthy",
    ]);
  });

  it("rejects non-boolean environment presence diagnostics", () => {
    const body = healthyResponse();
    Reflect.set(body.configuration.presence, "WHATSAPP_ACCESS_TOKEN", "actual-token-value");

    expect(validateHealthResponse(body, safeHeaders)).toContain(
      "configuration presence values must be booleans",
    );
  });

  it("rejects secret-bearing diagnostic field names", () => {
    const body = healthyResponse();
    Reflect.set(body.configuration, "apiKey", "must-never-be-returned");

    expect(validateHealthResponse(body, safeHeaders)).toContain(
      "health diagnostics appear to expose a secret-bearing field",
    );
  });

  it("requires no-store caching for operational diagnostics", () => {
    expect(validateHealthResponse(healthyResponse(), new Headers())).toContain(
      "health response is missing Cache-Control: no-store",
    );
  });

  it("rejects malformed response payloads", () => {
    expect(validateHealthResponse(null, safeHeaders)).toEqual([
      "health response is not a JSON object",
    ]);
  });
});
