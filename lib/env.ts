import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

const webhookEnvSchema = z.object({
  WHATSAPP_VERIFY_TOKEN: nonEmpty,
  META_APP_SECRET: nonEmpty,
});

const ingestionEnvSchema = z.object({
  WHATSAPP_ACCESS_TOKEN: nonEmpty,
  WHATSAPP_PHONE_NUMBER_ID: nonEmpty.optional(),
  META_GRAPH_API_VERSION: z.string().trim().regex(/^v\d+\.\d+$/).default("v26.0"),
  ALLOWED_WHATSAPP_SENDERS: z.string().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: nonEmpty,
  SUPABASE_STORAGE_BUCKET: nonEmpty.default("whatsapp-media"),
  MAX_MEDIA_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),
});

export function getWebhookEnv() {
  return webhookEnvSchema.parse(process.env);
}

export function getIngestionEnv() {
  const parsed = ingestionEnvSchema.parse(process.env);
  const allowedSenders = new Set(
    (parsed.ALLOWED_WHATSAPP_SENDERS ?? "")
      .split(",")
      .map((value) => value.replace(/\D/g, ""))
      .filter(Boolean),
  );

  return {
    ...parsed,
    allowedSenders,
  };
}

function invalidFieldNames(error: z.ZodError): string[] {
  return Array.from(
    new Set(
      error.issues
        .map((issue) => issue.path[0])
        .filter((field): field is string => typeof field === "string"),
    ),
  ).sort();
}

export function getHealthConfiguration() {
  const presenceKeys = [
    "WHATSAPP_VERIFY_TOKEN",
    "META_APP_SECRET",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "META_GRAPH_API_VERSION",
    "ALLOWED_WHATSAPP_SENDERS",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_STORAGE_BUCKET",
    "MAX_MEDIA_BYTES",
  ] as const;

  const presence = Object.fromEntries(
    presenceKeys.map((key) => [key, Boolean(process.env[key]?.trim())]),
  );

  const webhookValidation = webhookEnvSchema.safeParse(process.env);
  const ingestionValidation = ingestionEnvSchema.safeParse(process.env);

  const invalidFields = [
    ...(webhookValidation.success
      ? []
      : invalidFieldNames(webhookValidation.error)),
    ...(ingestionValidation.success
      ? []
      : invalidFieldNames(ingestionValidation.error)),
  ];

  return {
    presence,
    validation: {
      webhook: webhookValidation.success,
      ingestion: ingestionValidation.success,
      invalidFields: Array.from(new Set(invalidFields)).sort(),
    },
  };
}
