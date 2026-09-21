import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

const webhookEnvSchema = z.object({
  WHATSAPP_VERIFY_TOKEN: nonEmpty,
  META_APP_SECRET: nonEmpty,
});

const ingestionEnvSchema = z.object({
  WHATSAPP_ACCESS_TOKEN: nonEmpty,
  WHATSAPP_PHONE_NUMBER_ID: nonEmpty.optional(),
  META_GRAPH_API_VERSION: z.string().trim().regex(/^v\d+\.\d+$/).default("v23.0"),
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

export function getHealthConfiguration() {
  const required = [
    "WHATSAPP_VERIFY_TOKEN",
    "META_APP_SECRET",
    "WHATSAPP_ACCESS_TOKEN",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_STORAGE_BUCKET",
  ] as const;

  return Object.fromEntries(
    required.map((key) => [key, Boolean(process.env[key]?.trim())]),
  );
}
