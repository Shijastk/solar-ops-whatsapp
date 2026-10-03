import { z } from "zod";
import { getDocumentAutomationEnv } from "@/lib/env";

const MAX_QUERY_CHARS = 500;
const MAX_PROVIDER_ERROR_CHARS = 240;

const supportedIntentSchema = z.enum([
  "today_bill_count",
  "pending_bill_count",
  "latest_bill",
  "stock_balance",
  "today_trip_summary",
  "latest_trip",
  "ops_period_summary",
  "unsupported",
]);

const periodSchema = z
  .enum([
    "this_week",
    "this_month",
    "this_year",
    "last_week",
    "last_month",
    "last_year",
  ])
  .nullable();

const classificationSchema = z.object({
  intent: supportedIntentSchema,
  product_query: z.string().nullable(),
  period: periodSchema,
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

const strictResponseSchema = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "today_bill_count",
        "pending_bill_count",
        "latest_bill",
        "stock_balance",
        "today_trip_summary",
        "latest_trip",
        "ops_period_summary",
        "unsupported",
      ],
    },
    product_query: {
      type: ["string", "null"],
    },
    period: {
      type: ["string", "null"],
      enum: [
        "this_week",
        "this_month",
        "this_year",
        "last_week",
        "last_month",
        "last_year",
        null
      ],
    },
  },
  required: ["intent", "product_query", "period"],
  additionalProperties: false,
} as const;

const DOMAIN_HINTS = [
  "bill",
  "invoice",
  "stock",
  "inventory",
  "product",
  "panel",
  "inverter",
  "topcon",
  "dcr",
  "non dcr",
  "wp",
  "ബിൽ",
  "ബില്ല്",
  "സ്റ്റോക്ക്",
  "ഇൻവെന്ററി",
  "പാനൽ",
  "ഇൻവെർട്ടർ",
  "സാധനം",
  "trip",
  "trips",
  "route",
  "driver",
  "ട്രിപ്പ്",
  "ട്രിപ്പുകൾ",
  "റൂട്ട്",
  "ഡ്രൈവർ",
];

export type AiOperationalQueryClassification = z.infer<
  typeof classificationSchema
>;

function normalizeQueryText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeOperationalQuery(text: string): boolean {
  const normalized = normalizeQueryText(text);
  if (!normalized) return false;
  return DOMAIN_HINTS.some((hint) => normalized.includes(hint));
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
      // Fall back to bounded provider text.
    }

    return sanitizeProviderErrorText(body);
  } catch {
    return null;
  }
}

export async function classifyOperationalQueryWithGroq(
  text: string,
): Promise<AiOperationalQueryClassification | null> {
  if (!looksLikeOperationalQuery(text)) return null;

  const env = getDocumentAutomationEnv();
  if (!env.enabled || !env.apiKey) return null;

  const boundedText = text.normalize("NFKC").trim().slice(0, MAX_QUERY_CHARS);
  if (!boundedText) return null;

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
              "Classify a Solar Ops operator question. Do not answer the question and do not invent business facts. Supported intents only: today_bill_count = asks how many PDF bills were received today; pending_bill_count = asks how many bills need review/are pending; latest_bill = asks for the most recently received bill; stock_balance = asks the current stock quantity for one named product; today_trip_summary = asks which trips were completed today; latest_trip = asks for the latest completed trip; ops_period_summary = asks for an operational summary for this week/month/year or last week/month/year. For stock_balance, copy only the product phrase from the user into product_query; use null when not named. For ops_period_summary set period to one of this_week, this_month, this_year, last_week, last_month, last_year. For every other intent set period to null. For every other request including arbitrary SQL-like questions, edits, commands, greetings, explanations, or ambiguous meaning, return unsupported. Understand Malayalam, Manglish and English.",
          },
          {
            role: "user",
            content: boundedText,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "solar_ops_query_intent",
            strict: true,
            schema: strictResponseSchema,
          },
        },
        reasoning_effort: "low",
        include_reasoning: false,
        max_completion_tokens: 120,
        stream: false,
      }),
      signal: AbortSignal.timeout(Math.min(env.timeoutMs, 4000)),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const detail = await readGroqErrorDetail(response);
    throw new Error(
      "Groq query classification failed with HTTP " +
        response.status +
        (detail ? ": " + detail : ""),
    );
  }

  const parsedResponse = groqResponseSchema.safeParse(await response.json());
  if (!parsedResponse.success) {
    throw new Error("Groq query classification response shape was invalid");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(parsedResponse.data.choices[0].message.content);
  } catch {
    throw new Error("Groq query classification response was not valid JSON");
  }

  const parsed = classificationSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Groq query classification output failed local validation");
  }

  const productQuery = parsed.data.product_query?.trim() || null;
  return {
    intent: parsed.data.intent,
    product_query: productQuery,
    period: parsed.data.period,
  };
}
