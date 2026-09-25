import { z } from "zod";
import { normalizeProductDescription } from "@/lib/document-parser";
import { getDocumentAutomationEnv } from "@/lib/env";

const MAX_GROQ_SOURCE_CHARS = 24_000;
const MONEY_TOLERANCE = 0.05;
const QUANTITY_TOLERANCE = 0.001;
const MAX_PROVIDER_ERROR_CHARS = 320;

const nullableString = z.string().nullable();
const nullableNumber = z.number().finite().nullable();

const groqItemSchema = z.object({
  description: z.string(),
  hsn_sac: nullableString,
  quantity: nullableNumber,
  unit: nullableString,
  rate: nullableNumber,
  amount: nullableNumber,
});

export const groqDocumentExtractionSchema = z.object({
  document_type: nullableString,
  supplier_name: nullableString,
  supplier_gstin: nullableString,
  supplier_address: nullableString,
  document_number: nullableString,
  document_date: nullableString,
  eway_bill_number: nullableString,
  consignee_name: nullableString,
  consignee_address: nullableString,
  consignee_gstin: nullableString,
  consignee_pincode: nullableString,
  consignee_phone: nullableString,
  buyer_name: nullableString,
  buyer_address: nullableString,
  buyer_gstin: nullableString,
  buyer_pincode: nullableString,
  buyer_phone: nullableString,
  destination: nullableString,
  dispatch_from_address: nullableString,
  vehicle_number: nullableString,
  approximate_distance_km: nullableNumber,
  eway_generated_at_text: nullableString,
  eway_valid_until_text: nullableString,
  supply_type: nullableString,
  transaction_type: nullableString,
  taxable_amount: nullableNumber,
  cgst_amount: nullableNumber,
  sgst_amount: nullableNumber,
  total_amount: nullableNumber,
  items: z.array(groqItemSchema),
});

const groqResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
});

export type GroqDocumentExtraction = z.infer<
  typeof groqDocumentExtractionSchema
>;

export type VerificationCandidateItem = {
  description: string;
  hsnSac: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  amount: number | null;
};

export type VerificationCandidate = {
  documentType: string | null;
  supplierName: string | null;
  supplierGstin: string | null;
  supplierAddress: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  ewayBillNumber: string | null;
  consigneeName: string | null;
  consigneeAddress: string | null;
  consigneeGstin: string | null;
  consigneePincode: string | null;
  consigneePhone: string | null;
  buyerName: string | null;
  buyerAddress: string | null;
  buyerGstin: string | null;
  buyerPincode: string | null;
  buyerPhone: string | null;
  destination: string | null;
  dispatchFromAddress: string | null;
  vehicleNumber: string | null;
  approximateDistanceKm: number | null;
  ewayGeneratedAtText: string | null;
  ewayValidUntilText: string | null;
  supplyType: string | null;
  transactionType: string | null;
  taxableAmount: number | null;
  cgstAmount: number | null;
  sgstAmount: number | null;
  totalAmount: number | null;
  items: VerificationCandidateItem[];
};

export type DocumentVerificationDecision = {
  verified: boolean;
  mismatches: string[];
  extraction: GroqDocumentExtraction;
};

const nullableStringJson = { type: ["string", "null"] } as const;
const nullableNumberJson = { type: ["number", "null"] } as const;

const strictResponseSchema = {
  type: "object",
  properties: {
    document_type: nullableStringJson,
    supplier_name: nullableStringJson,
    supplier_gstin: nullableStringJson,
    supplier_address: nullableStringJson,
    document_number: nullableStringJson,
    document_date: nullableStringJson,
    eway_bill_number: nullableStringJson,
    consignee_name: nullableStringJson,
    consignee_address: nullableStringJson,
    consignee_gstin: nullableStringJson,
    consignee_pincode: nullableStringJson,
    consignee_phone: nullableStringJson,
    buyer_name: nullableStringJson,
    buyer_address: nullableStringJson,
    buyer_gstin: nullableStringJson,
    buyer_pincode: nullableStringJson,
    buyer_phone: nullableStringJson,
    destination: nullableStringJson,
    dispatch_from_address: nullableStringJson,
    vehicle_number: nullableStringJson,
    approximate_distance_km: nullableNumberJson,
    eway_generated_at_text: nullableStringJson,
    eway_valid_until_text: nullableStringJson,
    supply_type: nullableStringJson,
    transaction_type: nullableStringJson,
    taxable_amount: nullableNumberJson,
    cgst_amount: nullableNumberJson,
    sgst_amount: nullableNumberJson,
    total_amount: nullableNumberJson,
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          hsn_sac: nullableStringJson,
          quantity: nullableNumberJson,
          unit: nullableStringJson,
          rate: nullableNumberJson,
          amount: nullableNumberJson,
        },
        required: [
          "description",
          "hsn_sac",
          "quantity",
          "unit",
          "rate",
          "amount",
        ],
        additionalProperties: false,
      },
    },
  },
  required: [
    "document_type",
    "supplier_name",
    "supplier_gstin",
    "supplier_address",
    "document_number",
    "document_date",
    "eway_bill_number",
    "consignee_name",
    "consignee_address",
    "consignee_gstin",
    "consignee_pincode",
    "consignee_phone",
    "buyer_name",
    "buyer_address",
    "buyer_gstin",
    "buyer_pincode",
    "buyer_phone",
    "destination",
    "dispatch_from_address",
    "vehicle_number",
    "approximate_distance_km",
    "eway_generated_at_text",
    "eway_valid_until_text",
    "supply_type",
    "transaction_type",
    "taxable_amount",
    "cgst_amount",
    "sgst_amount",
    "total_amount",
    "items",
  ],
  additionalProperties: false,
} as const;

function normalizeLooseText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIdentifier(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeUnit(value: string): string {
  return normalizeIdentifier(value);
}

function numbersEqual(
  left: number | null,
  right: number | null,
  tolerance: number,
): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= tolerance;
}

function compareNullableString(
  left: string | null,
  right: string | null,
  normalize: (value: string) => string,
): boolean {
  if (left === null || right === null) return left === right;
  return normalize(left) === normalize(right);
}

function compareTextField(
  mismatches: string[],
  name: string,
  left: string | null,
  right: string | null,
  normalize: (value: string) => string = normalizeLooseText,
) {
  if (!compareNullableString(left, right, normalize)) {
    mismatches.push(name);
  }
}

function compareNumberField(
  mismatches: string[],
  name: string,
  left: number | null,
  right: number | null,
  tolerance = MONEY_TOLERANCE,
) {
  if (!numbersEqual(left, right, tolerance)) {
    mismatches.push(name);
  }
}

function candidateItemMatches(
  candidate: VerificationCandidateItem,
  extracted: GroqDocumentExtraction["items"][number],
): boolean {
  return (
    normalizeProductDescription(candidate.description) ===
      normalizeProductDescription(extracted.description) &&
    compareNullableString(candidate.hsnSac, extracted.hsn_sac, normalizeIdentifier) &&
    numbersEqual(candidate.quantity, extracted.quantity, QUANTITY_TOLERANCE) &&
    compareNullableString(candidate.unit, extracted.unit, normalizeUnit) &&
    numbersEqual(candidate.rate, extracted.rate, MONEY_TOLERANCE) &&
    numbersEqual(candidate.amount, extracted.amount, MONEY_TOLERANCE)
  );
}

function itemsMatch(
  candidate: VerificationCandidate["items"],
  extracted: GroqDocumentExtraction["items"],
): boolean {
  if (candidate.length === 0 || candidate.length !== extracted.length) {
    return false;
  }

  const remaining = [...extracted];

  for (const item of candidate) {
    const matchIndex = remaining.findIndex((other) =>
      candidateItemMatches(item, other),
    );

    if (matchIndex < 0) return false;
    remaining.splice(matchIndex, 1);
  }

  return remaining.length === 0;
}

function arithmeticMismatches(candidate: VerificationCandidate): string[] {
  const mismatches: string[] = [];

  candidate.items.forEach((item, index) => {
    if (
      item.quantity !== null &&
      item.rate !== null &&
      item.amount !== null &&
      Math.abs(item.quantity * item.rate - item.amount) > MONEY_TOLERANCE
    ) {
      mismatches.push("item_arithmetic_" + String(index + 1));
    }
  });

  const amounts = candidate.items.map((item) => item.amount);
  if (
    candidate.taxableAmount !== null &&
    amounts.length > 0 &&
    amounts.every((amount): amount is number => amount !== null)
  ) {
    const lineTotal = amounts.reduce((sum, amount) => sum + amount, 0);
    if (Math.abs(lineTotal - candidate.taxableAmount) > MONEY_TOLERANCE) {
      mismatches.push("taxable_amount_arithmetic");
    }
  }

  return mismatches;
}

export function compareDocumentVerification(
  candidate: VerificationCandidate,
  extraction: GroqDocumentExtraction,
): DocumentVerificationDecision {
  const mismatches: string[] = [];

  compareTextField(
    mismatches,
    "document_type",
    candidate.documentType,
    extraction.document_type,
  );
  compareTextField(
    mismatches,
    "supplier_name",
    candidate.supplierName,
    extraction.supplier_name,
  );
  compareTextField(
    mismatches,
    "supplier_gstin",
    candidate.supplierGstin,
    extraction.supplier_gstin,
    normalizeIdentifier,
  );
  compareTextField(
    mismatches,
    "supplier_address",
    candidate.supplierAddress,
    extraction.supplier_address,
  );
  compareTextField(
    mismatches,
    "document_number",
    candidate.documentNumber,
    extraction.document_number,
    normalizeIdentifier,
  );
  compareTextField(
    mismatches,
    "document_date",
    candidate.documentDate,
    extraction.document_date,
    normalizeIdentifier,
  );
  compareTextField(
    mismatches,
    "eway_bill_number",
    candidate.ewayBillNumber,
    extraction.eway_bill_number,
    normalizeIdentifier,
  );
  compareTextField(
    mismatches,
    "consignee_name",
    candidate.consigneeName,
    extraction.consignee_name,
  );
  compareTextField(
    mismatches,
    "consignee_address",
    candidate.consigneeAddress,
    extraction.consignee_address,
  );
  compareTextField(
    mismatches,
    "consignee_gstin",
    candidate.consigneeGstin,
    extraction.consignee_gstin,
    normalizeIdentifier,
  );
  compareTextField(
    mismatches,
    "consignee_pincode",
    candidate.consigneePincode,
    extraction.consignee_pincode,
    normalizeIdentifier,
  );
  compareTextField(
    mismatches,
    "consignee_phone",
    candidate.consigneePhone,
    extraction.consignee_phone,
    normalizeIdentifier,
  );
  compareTextField(
    mismatches,
    "buyer_name",
    candidate.buyerName,
    extraction.buyer_name,
  );
  compareTextField(
    mismatches,
    "buyer_address",
    candidate.buyerAddress,
    extraction.buyer_address,
  );
  compareTextField(
    mismatches,
    "buyer_gstin",
    candidate.buyerGstin,
    extraction.buyer_gstin,
    normalizeIdentifier,
  );
  compareTextField(
    mismatches,
    "buyer_pincode",
    candidate.buyerPincode,
    extraction.buyer_pincode,
    normalizeIdentifier,
  );
  compareTextField(
    mismatches,
    "buyer_phone",
    candidate.buyerPhone,
    extraction.buyer_phone,
    normalizeIdentifier,
  );
  compareTextField(
    mismatches,
    "destination",
    candidate.destination,
    extraction.destination,
  );
  compareTextField(
    mismatches,
    "dispatch_from_address",
    candidate.dispatchFromAddress,
    extraction.dispatch_from_address,
  );
  compareTextField(
    mismatches,
    "vehicle_number",
    candidate.vehicleNumber,
    extraction.vehicle_number,
    normalizeIdentifier,
  );
  compareNumberField(
    mismatches,
    "approximate_distance_km",
    candidate.approximateDistanceKm,
    extraction.approximate_distance_km,
    0.001,
  );
  compareTextField(
    mismatches,
    "eway_generated_at_text",
    candidate.ewayGeneratedAtText,
    extraction.eway_generated_at_text,
  );
  compareTextField(
    mismatches,
    "eway_valid_until_text",
    candidate.ewayValidUntilText,
    extraction.eway_valid_until_text,
  );
  compareTextField(
    mismatches,
    "supply_type",
    candidate.supplyType,
    extraction.supply_type,
  );
  compareTextField(
    mismatches,
    "transaction_type",
    candidate.transactionType,
    extraction.transaction_type,
  );
  compareNumberField(
    mismatches,
    "taxable_amount",
    candidate.taxableAmount,
    extraction.taxable_amount,
  );
  compareNumberField(
    mismatches,
    "cgst_amount",
    candidate.cgstAmount,
    extraction.cgst_amount,
  );
  compareNumberField(
    mismatches,
    "sgst_amount",
    candidate.sgstAmount,
    extraction.sgst_amount,
  );
  compareNumberField(
    mismatches,
    "total_amount",
    candidate.totalAmount,
    extraction.total_amount,
  );

  if (!itemsMatch(candidate.items, extraction.items)) {
    mismatches.push("items");
  }

  mismatches.push(...arithmeticMismatches(candidate));

  return {
    verified: mismatches.length === 0,
    mismatches: Array.from(new Set(mismatches)),
    extraction,
  };
}

function sanitizeProviderErrorText(value: string): string | null {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
    .slice(0, MAX_PROVIDER_ERROR_CHARS);
}

async function readGroqErrorDetail(response: Response): Promise<string | null> {
  try {
    const body = await response.text();
    if (!body) return null;

    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: unknown; type?: unknown; code?: unknown };
      };
      const parts = [
        typeof parsed.error?.type === "string" ? parsed.error.type : null,
        typeof parsed.error?.code === "string" ||
        typeof parsed.error?.code === "number"
          ? String(parsed.error.code)
          : null,
        typeof parsed.error?.message === "string"
          ? parsed.error.message
          : null,
      ].filter((part): part is string => Boolean(part));

      if (parts.length > 0) {
        return sanitizeProviderErrorText(parts.join(": "));
      }
    } catch {
      // Fall back to a bounded plain-text provider error.
    }

    return sanitizeProviderErrorText(body);
  } catch {
    return null;
  }
}

export async function extractDocumentWithGroq(
  extractedText: string,
): Promise<GroqDocumentExtraction> {
  const env = getDocumentAutomationEnv();

  if (!env.enabled || !env.apiKey) {
    throw new Error("Document automation is not enabled");
  }

  if (!extractedText.trim()) {
    throw new Error("Document text is empty");
  }

  if (extractedText.length > MAX_GROQ_SOURCE_CHARS) {
    throw new Error("Document text exceeds safe Groq verification limit");
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.model,
        messages: [
          {
            role: "system",
            content:
              "You are a verification extractor for operational solar-distribution documents. Extract every requested field only when it is explicitly supported by the supplied document text. Never infer, calculate, repair, or guess business data. Use null when absent or when PDF text extraction has interleaved multiple columns so a field boundary cannot be determined safely. In particular, if Dispatch From and Ship To are flattened into the same lines, return null for dispatch_from_address rather than reconstructing it. Return document_date as YYYY-MM-DD when the source date is unambiguous. Keep e-way generated/valid text faithful to the source. Include every product line exactly once with description, HSN/SAC, quantity, unit, rate and amount.",
          },
          {
            role: "user",
            content: extractedText,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "solar_ops_document_verification",
            strict: true,
            schema: strictResponseSchema,
          },
        },
        reasoning_effort: "low",
        include_reasoning: false,
        stream: false,
      }),
      signal: AbortSignal.timeout(env.timeoutMs),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const detail = await readGroqErrorDetail(response);
    throw new Error(
      "Groq verification request failed with HTTP " +
        response.status +
        (detail ? ": " + detail : ""),
    );
  }

  const parsedResponse = groqResponseSchema.safeParse(await response.json());
  if (!parsedResponse.success) {
    throw new Error("Groq verification response shape was invalid");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(parsedResponse.data.choices[0].message.content);
  } catch {
    throw new Error("Groq verification response was not valid JSON");
  }

  const parsedExtraction = groqDocumentExtractionSchema.safeParse(payload);
  if (!parsedExtraction.success) {
    throw new Error("Groq verification output failed local validation");
  }

  return parsedExtraction.data;
}
