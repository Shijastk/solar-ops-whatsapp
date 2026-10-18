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
  it("uses AI to interpret unmatched chat even without operations keywords", async () => {
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
                  driver_name: null,
                  yesterday: false,
                  period: null,
                  reply: "ഹായ്! എന്താണ് അറിയേണ്ടത്?",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(looksLikeOperationalQuery("Hello, എങ്ങനെയുണ്ട്?")).toBe(false);
    expect(looksLikeOperationalQuery("ഇന്നത്തെ trip details എന്താണ്?")).toBe(true);
    expect(looksLikeOperationalQuery("ഈ മാസം summary")).toBe(true);
    expect(looksLikeOperationalQuery("Innu poya products eethellam aanu")).toBe(true);
    await expect(
      classifyOperationalQueryWithGroq("Hello, എങ്ങനെയുണ്ട്?"),
    ).resolves.toEqual({
      intent: "unsupported",
      product_query: null,
      driver_name: null,
      yesterday: false,
      period: null,
      reply: "ഹായ്! എന്താണ് അറിയേണ്ടത്?",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
                  intent: "today_products_summary",
                  product_query: null,
                  driver_name: null,
                  yesterday: false,
                  period: null,
                  reply: null,
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
      "Innu poya products eethellam aanu",
    );

    expect(result).toEqual({
      intent: "today_products_summary",
      product_query: null,
      driver_name: null,
      yesterday: false,
      period: null,
      reply: null,
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
    expect(body.messages[1].content).toBe("Innu poya products eethellam aanu");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.max_completion_tokens).toBe(200);
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
                  driver_name: null,
                  yesterday: false,
                  period: null,
                  reply: "അത് ഇപ്പോൾ സ്ഥിരീകരിക്കാൻ കഴിയില്ല.",
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

  it("extracts a clearly named driver and yesterday intent", async () => {
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    process.env.GROQ_API_KEY = "groq-test-secret";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: "driver_trip_summary",
                  product_query: null,
                  driver_name: "  Rasheed  ",
                  yesterday: true,
                  period: null,
                  reply: null,
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      classifyOperationalQueryWithGroq("Rasheed innale ethra trip poyi?"),
    ).resolves.toEqual({
      intent: "driver_trip_summary",
      product_query: null,
      driver_name: "Rasheed",
      yesterday: true,
      period: null,
      reply: null,
    });
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
