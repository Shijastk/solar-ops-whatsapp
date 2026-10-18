import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_HEALTH_URL = "https://solar-ops-whatsapp.vercel.app/api/health";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

export function validateHealthResponse(body, headers) {
  const errors = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ["health response is not a JSON object"];
  }

  if (body.ok !== true) errors.push("health response did not report ok=true");
  if (body.service !== "solar-ops-whatsapp") errors.push("unexpected service identifier");
  if (body.configured !== true) errors.push("required webhook/ingestion configuration is not valid");

  const configuration = body.configuration;
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
    errors.push("configuration diagnostics are missing");
  } else {
    const presence = configuration.presence;
    if (!presence || typeof presence !== "object" || Array.isArray(presence)) {
      errors.push("configuration presence diagnostics are missing");
    } else if (Object.values(presence).some((value) => typeof value !== "boolean")) {
      errors.push("configuration presence values must be booleans");
    }

    const validation = configuration.validation;
    if (!validation || validation.webhook !== true || validation.ingestion !== true) {
      errors.push("webhook or ingestion validation is not healthy");
    }

    if (/(apiKey|accessToken|secretKey|verifyToken|password)"\s*:/i.test(JSON.stringify(configuration))) {
      errors.push("health diagnostics appear to expose a secret-bearing field");
    }
  }

  const cacheControl = headers?.get?.("cache-control") ?? headers?.["cache-control"] ?? "";
  if (!String(cacheControl).toLowerCase().includes("no-store")) {
    errors.push("health response is missing Cache-Control: no-store");
  }

  return errors;
}

async function runSmokeCheck() {
  const url = process.env.HEALTH_URL || DEFAULT_HEALTH_URL;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`health endpoint returned HTTP ${response.status}`);
      }

      const body = await response.json();
      const errors = validateHealthResponse(body, response.headers);
      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }

      console.log("PASS: production health, configuration validation, and response-safety checks");
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("unknown health-check failure");
      if (attempt < MAX_ATTEMPTS) await delay(2_000);
    }
  }

  console.error(`FAIL: production health smoke check failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message ?? "unknown error"}`);
  process.exitCode = 1;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  await runSmokeCheck();
}
