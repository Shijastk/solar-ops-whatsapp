import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareDocumentVerification,
  extractDocumentWithGroq,
  type VerificationCandidate,
} from "../lib/document-verifier";

const candidate: VerificationCandidate = {
  documentType: "Delivery Note",
  supplierName: "SUN GRID SOLUTIONS LIMITED",
  documentNumber: "SG000123",
  ewayBillNumber: "531999351397",
  vehicleNumber: "KL11AA1234",
  totalAmount: 176026.86,
  items: [
    {
      description: "Solar 560 Wp Topcon Panel",
      quantity: 6,
      unit: "NOS",
    },
    {
      description: "3 KW Inverter",
      quantity: 1,
      unit: "NOS",
    },
  ],
};

const extraction = {
  document_type: "delivery note",
  supplier_name: "Sun Grid Solutions Limited",
  document_number: "SG-000123",
  eway_bill_number: "531999351397",
  vehicle_number: "KL 11 AA 1234",
  total_amount: 176026.86,
  items: [
    {
      description: "Solar 560-Wp Topcon Panel",
      quantity: 6,
      unit: "nos",
    },
    {
      description: "3 KW Inverter",
      quantity: 1,
      unit: "NOS",
    },
  ],
};

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

describe("compareDocumentVerification", () => {
  it("accepts only an independent extraction that matches the parser", () => {
    expect(compareDocumentVerification(candidate, extraction)).toMatchObject({
      verified: true,
      mismatches: [],
    });
  });

  it("fails closed when quantity or item count changes", () => {
    const changedQuantity = {
      ...extraction,
      items: [
        { ...extraction.items[0], quantity: 60 },
        extraction.items[1],
      ],
    };

    expect(
      compareDocumentVerification(candidate, changedQuantity),
    ).toMatchObject({
      verified: false,
      mismatches: ["items"],
    });

    expect(
      compareDocumentVerification(candidate, {
        ...extraction,
        items: [extraction.items[0]],
      }),
    ).toMatchObject({
      verified: false,
      mismatches: ["items"],
    });
  });

  it("fails closed when a critical document field differs", () => {
    const result = compareDocumentVerification(candidate, {
      ...extraction,
      vehicle_number: "KL11ZZ9999",
    });

    expect(result.verified).toBe(false);
    expect(result.mismatches).toContain("vehicle_number");
  });
});

describe("extractDocumentWithGroq", () => {
  it("requests strict JSON schema output without leaking the API key into the body", async () => {
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    process.env.GROQ_API_KEY = "groq-test-secret";
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    process.env.GROQ_TIMEOUT_MS = "5000";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(extraction),
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
      extractDocumentWithGroq("DELIVERY NOTE\nSolar 560 Wp Topcon Panel"),
    ).resolves.toEqual(extraction);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer groq-test-secret");

    const body = JSON.parse(init.body);
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        strict: true,
      },
    });
    expect(body.stream).toBe(false);
    expect(JSON.stringify(body)).not.toContain("groq-test-secret");
  });

  it("fails closed when the provider rejects verification", async () => {
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    process.env.GROQ_API_KEY = "groq-test-secret";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })),
    );

    await expect(
      extractDocumentWithGroq("DELIVERY NOTE\nSolar Panel"),
    ).rejects.toThrow("HTTP 429");
  });
});
