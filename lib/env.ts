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

const automationEnvSchema = z.object({
  DOCUMENT_AUTOMATION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  GROQ_API_KEY: nonEmpty.optional(),
  GROQ_MODEL: nonEmpty.default("openai/gpt-oss-20b"),
  GROQ_TIMEOUT_MS: z.coerce.number().int().min(1000).max(10000).default(7000),
});

const voiceTranscriptionEnvSchema = z.object({
  AZURE_SPEECH_KEY: nonEmpty.optional(),
  AZURE_SPEECH_REGION: z.string().trim().min(1).default("centralindia"),
  AZURE_SPEECH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(10000).default(6000),
});

export function getWebhookEnv() {
  return webhookEnvSchema.parse(process.env);
}

export function getIngestionEnv() {
  const parsed = ingestionEnvSchema.parse(process.env);
  const allowedSenders = new Set(
    (parsed.ALLOWED_WHATSAPP_SENDERS ?? "")
      .split(",")
      .map((value) => value.replace(/\\D/g, ""))
      .filter(Boolean),
  );

  return {
    ...parsed,
    allowedSenders,
  };
}

export function getDocumentAutomationEnv() {
  const parsed = automationEnvSchema.parse(process.env);

  if (parsed.DOCUMENT_AUTOMATION_ENABLED && !parsed.GROQ_API_KEY) {
    throw new Error(
      "GROQ_API_KEY is required when DOCUMENT_AUTOMATION_ENABLED=true",
    );
  }

  return {
    enabled: parsed.DOCUMENT_AUTOMATION_ENABLED,
    apiKey: parsed.GROQ_API_KEY ?? null,
    model: parsed.GROQ_MODEL,
    timeoutMs: parsed.GROQ_TIMEOUT_MS,
  };
}

export function getVoiceTranscriptionEnv() {
  const parsed = voiceTranscriptionEnvSchema.parse(process.env);
  return {
    apiKey: parsed.AZURE_SPEECH_KEY ?? null,
    region: parsed.AZURE_SPEECH_REGION,
    timeoutMs: parsed.AZURE_SPEECH_TIMEOUT_MS,
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
    "DOCUMENT_AUTOMATION_ENABLED",
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "GROQ_TIMEOUT_MS",
    "AZURE_SPEECH_KEY",
    "AZURE_SPEECH_REGION",
    "AZURE_SPEECH_TIMEOUT_MS",
  ] as const;

  const presence = Object.fromEntries(
    presenceKeys.map((key) => [key, Boolean(process.env[key]?.trim())]),
  );

  const webhookValidation = webhookEnvSchema.safeParse(process.env);
  const ingestionValidation = ingestionEnvSchema.safeParse(process.env);
  const automationValidation = automationEnvSchema.safeParse(process.env);
  const voiceTranscriptionValidation = voiceTranscriptionEnvSchema.safeParse(process.env);

  const automationInvalidFields = automationValidation.success
    ? automationValidation.data.DOCUMENT_AUTOMATION_ENABLED &&
      !automationValidation.data.GROQ_API_KEY
      ? ["GROQ_API_KEY"]
      : []
    : invalidFieldNames(automationValidation.error);

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
      automation: {
        enabled:
          automationValidation.success &&
          automationValidation.data.DOCUMENT_AUTOMATION_ENABLED,
        ready:
          automationValidation.success &&
          (!automationValidation.data.DOCUMENT_AUTOMATION_ENABLED ||
            Boolean(automationValidation.data.GROQ_API_KEY)),
        invalidFields: automationInvalidFields,
      },
      voiceTranscription: {
        ready:
          voiceTranscriptionValidation.success &&
          Boolean(voiceTranscriptionValidation.data.AZURE_SPEECH_KEY),
        invalidFields: voiceTranscriptionValidation.success
          ? []
          : invalidFieldNames(voiceTranscriptionValidation.error),
      },
      invalidFields: Array.from(new Set(invalidFields)).sort(),
    },
  };
}
