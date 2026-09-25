import { z } from "zod";
import { normalizeProductDescription } from "@/lib/document-parser";
import { getDocumentAutomationEnv } from "@/lib/env";

const MAX_GROQ_SOURCE_CHARS = 24_000;

const nullableString = z.string().nullable();
const nullableNumber = z.number().finite().nullable();

export const groqDocumentExtractionSchema = z.object({
  document_type: nullableString,
  supplier_name: nullableString,
  document_number: nullableString,
  eway_bill_number: nullableString,
  vehicle_number: nullableString,
  total_amount: nullableNumber,
  items: z.array(
    z.object({
      description: z.string(),
      quantity: nullableNumber,
      unit: nullableString,
    }),
  ),
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

export type VerificationCandidate = {
  documentType: string | null;
  supplierName: string | null;
  documentNumber: string | null;
  ewayBillNumber: string | null;
  vehicleNumber: string | null;
  totalAmount: number | null;
  items: Array<{
    description: string;
    quantity: number | null;
    unit: string | null;
  }>;
};

export type DocumentVerificationDecision = {
  verified: boolean;
  mismatches: string[];
  extraction: GroqDocumentExtraction;
};

const strictResponseSchema = {
  type: "object",
  properties: {
    document_type: { type: ["string", "null"] },
    supplier_name: { type: ["string", "null"] },
    document_number: { type: ["string", "null"] },
    eway_bill_number: { type: ["string", "null"] },
    vehicle_number: { type: ["string", "null"] },
    total_amount: { type: ["number", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
        },
        required: ["description", "quantity", "unit"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "document_type",
    "supplier_name",
    "document_number",
    "eway_bill_number",
    "vehicle_number",
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
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
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

function itemsMatch(
  candidate: VerificationCandidate["items"],
  extracted: GroqDocumentExtraction["items"],
): boolean {
  if (candidate.length === 0 || candidate.length !== extracted.length) {
    return false;
  }

  if (candidate.some((item) => item.quantity === null || item.unit === null)) {
    return false;
  }

  if (extracted.some((item) => item.quantity === null || item.unit === null)) {
    return false;
  }

  const remaining = [...extracted];

  for (const item of candidate) {
    const description = normalizeProductDescription(item.description);
    const matchIndex = remaining.findIndex(
      (other) =>
        normalizeProductDescription(other.description) === description &&
        numbersEqual(item.quantity, other.quantity, 0.001) &&
        normalizeUnit(item.unit ?? "") === normalizeUnit(other.unit ?? ""),
    );

    if (matchIndex < 0) return false;
    remaining.splice(matchIndex, 1);
  }

  return remaining.length === 0;
}

export function compareDocumentVerification(
  candidate: VerificationCandidate,
  extraction: GroqDocumentExtraction,
): DocumentVerificationDecision {
  const mismatches: string[] = [];

  if (
    !compareNullableString(
      candidate.documentType,
      extraction.document_type,
      normalizeLooseText,
    )
  ) {
    mismatches.push("document_type");
  }

  if (
    !compareNullableString(
      candidate.supplierName,
      extraction.supplier_name,
      normalizeLooseText,
    )
  ) {
    mismatches.push("supplier_name");
  }

  if (
    !compareNullableString(
      candidate.documentNumber,
      extraction.document_number,
      normalizeIdentifier,
    )
  ) {
    mismatches.push("document_number");
  }

  if (
    !compareNullableString(
      candidate.ewayBillNumber,
      extraction.eway_bill_number,
      normalizeIdentifier,
    )
  ) {
    mismatches.push("eway_bill_number");
  }

  if (
    !compareNullableString(
      candidate.vehicleNumber,
      extraction.vehicle_number,
      normalizeIdentifier,
    )
  ) {
    mismatches.push("vehicle_number");
  }

  if (!numbersEqual(candidate.totalAmount, extraction.total_amount, 0.01)) {
    mismatches.push("total_amount");
  }

  if (!itemsMatch(candidate.items, extraction.items)) {
    mismatches.push("items");
  }

  return {
    verified: mismatches.length === 0,
    mismatches,
    extraction,
  };
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
              "You verify operational solar-distribution documents. Extract only values explicitly present in the supplied text. Never infer, calculate, repair, or guess missing business data. Preserve product descriptions closely enough to identify the source line. Use null when a field is absent. Include every product line exactly once.",
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
    throw new Error(
      "Groq verification request failed with HTTP " + response.status,
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
