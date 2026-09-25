import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareDocumentVerification,
  extractDocumentWithGroq,
  type GroqDocumentExtraction,
  type VerificationCandidate,
} from "../lib/document-verifier";

const candidate: VerificationCandidate = {
  documentType: "Delivery Note",
  supplierName: "SUN GRID SOLUTIONS LIMITED",
  supplierGstin: "32ABCDE1234F1Z5",
  supplierAddress: null,
  documentNumber: "SG000123",
  documentDate: "2026-05-05",
  ewayBillNumber: "531999351397",
  consigneeName: "CUSTOMER ONE",
  consigneeAddress: null,
  consigneeGstin: null,
  consigneePincode: "673600",
  consigneePhone: null,
  buyerName: "CUSTOMER ONE",
  buyerAddress: null,
  buyerGstin: null,
  buyerPincode: "673600",
  buyerPhone: null,
  destination: null,
  dispatchFromAddress: null,
  vehicleNumber: "KL11AA1234",
  approximateDistanceKm: 45,
  ewayGeneratedAtText: null,
  ewayValidUntilText: null,
  supplyType: "Outward-Job Work",
  transactionType: "Bill From - Dispatch From",
  taxableAmount: 138000,
  cgstAmount: null,
  sgstAmount: null,
  totalAmount: 138000,
  items: [
    {
      description: "Solar 560 Wp Topcon Panel",
      hsnSac: "8541",
      quantity: 6,
      unit: "NOS",
      rate: 20000,
      amount: 120000,
    },
    {
      description: "3 KW Inverter",
      hsnSac: "8541",
      quantity: 1,
      unit: "NOS",
      rate: 18000,
      amount: 18000,
    },
  ],
};

const extraction: GroqDocumentExtraction = {
  document_type: "delivery note",
  supplier_name: "Sun Grid Solutions Limited",
  supplier_gstin: "32ABCDE1234F1Z5",
  supplier_address: null,
  document_number: "SG-000123",
  document_date: "2026-05-05",
  eway_bill_number: "531999351397",
  consignee_name: "Customer One",
  consignee_address: null,
  consignee_gstin: null,
  consignee_pincode: "673600",
  consignee_phone: null,
  buyer_name: "Customer One",
  buyer_address: null,
  buyer_gstin: null,
  buyer_pincode: "673600",
  buyer_phone: null,
  destination: null,
  dispatch_from_address: null,
  vehicle_number: "KL 11 AA 1234",
  approximate_distance_km: 45,
  eway_generated_at_text: null,
  eway_valid_until_text: null,
  supply_type: "Outward Job Work",
  transaction_type: "Bill From Dispatch From",
  taxable_amount: 138000,
  cgst_amount: null,
  sgst_amount: null,
  total_amount: 138000,
  items: [
    {
      description: "Solar 560-Wp Topcon Panel",
      hsn_sac: "8541",
      quantity: 6,
      unit: "nos",
      rate: 20000,
      amount: 120000,
    },
    {
      description: "3 KW Inverter",
      hsn_sac: "8541",
      quantity: 1,
      unit: "NOS",
      rate: 18000,
      amount: 18000,
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
  it("accepts only an independent extraction that matches every persisted field", () => {
    expect(compareDocumentVerification(candidate, extraction)).toMatchObject({
      verified: true,
      mismatches: [],
    });
  });

  it("fails closed when quantity or item count changes", () => {
    const changedQuantity: GroqDocumentExtraction = {
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

  it("fails closed when parser arithmetic is internally inconsistent", () => {
    const result = compareDocumentVerification(
      {
        ...candidate,
        items: [
          {
            ...candidate.items[0],
            amount: 119999,
          },
          candidate.items[1],
        ],
        taxableAmount: 137999,
        totalAmount: 137999,
      },
      {
        ...extraction,
        taxable_amount: 137999,
        total_amount: 137999,
        items: [
          {
            ...extraction.items[0],
            amount: 119999,
          },
          extraction.items[1],
        ],
      },
    );

    expect(result.verified).toBe(false);
    expect(result.mismatches).toContain("item_arithmetic_1");
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
    expect(body.include_reasoning).toBe(false);
    expect(body.stream).toBe(false);
    expect(JSON.stringify(body)).not.toContain("groq-test-secret");
  });

  it("captures bounded provider diagnostics when verification is rejected", async () => {
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    process.env.GROQ_API_KEY = "groq-test-secret";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              code: "bad_request",
              message: "Unsupported request option",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(
      extractDocumentWithGroq("DELIVERY NOTE\nSolar Panel"),
    ).rejects.toThrow(
      "HTTP 400: invalid_request_error: bad_request: Unsupported request option",
    );
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
