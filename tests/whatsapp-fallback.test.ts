import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fixedOperationalFallback,
  fixedUniversalFallback,
  generateUniversalWhatsAppReply,
} from "../lib/whatsapp-fallback";

const originals = {
  enabled: process.env.DOCUMENT_AUTOMATION_ENABLED,
  key: process.env.GROQ_API_KEY,
  model: process.env.GROQ_MODEL,
  timeout: process.env.GROQ_TIMEOUT_MS,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();

  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  restore("DOCUMENT_AUTOMATION_ENABLED", originals.enabled);
  restore("GROQ_API_KEY", originals.key);
  restore("GROQ_MODEL", originals.model);
  restore("GROQ_TIMEOUT_MS", originals.timeout);
});

describe("universal WhatsApp fallback", () => {
  it("has deterministic fallbacks even when AI is unavailable", () => {
    expect(fixedUniversalFallback("thanks")).toContain("Trip");
    expect(fixedUniversalFallback("some random message")).toContain("Message");
    expect(fixedOperationalFallback()).toContain("latest trip");
  });

  it("generates a bounded conversational reply with the configured Groq model", async () => {
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    process.env.GROQ_API_KEY = "groq-test-secret";
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    process.env.GROQ_TIMEOUT_MS = "7000";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reply: "അതെ, Solar Ops ready ആണ്.",
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateUniversalWhatsAppReply("ഇത് എങ്ങനെ ഉപയോഗിക്കാം?"),
    ).resolves.toBe("അതെ, Solar Ops ready ആണ്.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.reasoning_effort).toBe("low");
    expect(body.max_completion_tokens).toBe(220);
  });
});
