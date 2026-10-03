import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyOperationalQueryWithGroq,
  looksLikeOperationalQuery,
} from "../lib/whatsapp-query-intent";

const originalEnv = {
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

  restore("DOCUMENT_AUTOMATION_ENABLED", originalEnv.enabled);
  restore("GROQ_API_KEY", originalEnv.key);
  restore("GROQ_MODEL", originalEnv.model);
  restore("GROQ_TIMEOUT_MS", originalEnv.timeout);
});

describe("WhatsApp AI intent fallback", () => {
  it("does not spend AI calls on ordinary chat without an operations hint", async () => {
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    process.env.GROQ_API_KEY = "groq-test-secret";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(looksLikeOperationalQuery("Hello, എങ്ങനെയുണ്ട്?")).toBe(false);
    expect(looksLikeOperationalQuery("ഇന്നത്തെ trip details എന്താണ്?")).toBe(true);
    await expect(
      classifyOperationalQueryWithGroq("Hello, എങ്ങനെയുണ്ട്?"),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends only bounded user text for unresolved operational intent classification", async () => {
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
                  intent: "stock_balance",
                  product_query: "Emmvee 560 Wp Topcon Dcr Panel",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await classifyOperationalQueryWithGroq(
      "Emmvee 560 Wp Topcon Dcr Panel ഇപ്പോൾ എത്ര ബാക്കി?",
    );

    expect(result).toEqual({
      intent: "stock_balance",
      product_query: "Emmvee 560 Wp Topcon Dcr Panel",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(init.headers).toMatchObject({
      Authorization: "Bearer groq-test-secret",
      "Content-Type": "application/json",
    });
    expect(JSON.stringify(body)).not.toContain("groq-test-secret");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].content).toBe(
      "Emmvee 560 Wp Topcon Dcr Panel ഇപ്പോൾ എത്ര ബാക്കി?",
    );
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.max_completion_tokens).toBe(120);
    expect(body.reasoning_effort).toBe("low");
  });

  it("bounds the text sent to Groq instead of forwarding unbounded chat history", async () => {
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    process.env.GROQ_API_KEY = "groq-test-secret";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: "unsupported",
                  product_query: null,
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const longText = "stock " + "x".repeat(2000);
    await classifyOperationalQueryWithGroq(longText);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.messages[1].content.length).toBe(500);
  });

  it("returns null when Groq-backed automation is disabled", async () => {
    process.env.DOCUMENT_AUTOMATION_ENABLED = "false";
    delete process.env.GROQ_API_KEY;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      classifyOperationalQueryWithGroq("latest bill details"),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
