import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  buildMarkdownReport,
  buildMinimalPdf,
  buildWebhookPayload,
  normalizeDigits,
  redactText,
  sha256Hex,
  signWebhookBody,
} from "./helpers.mjs";

const REQUIRED_ENV = [
  "WHATSAPP_ACCESS_TOKEN",
  "META_APP_SECRET",
  "WHATSAPP_PHONE_NUMBER_ID",
  "INTEGRATION_ALLOWED_SENDER",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
];

const startedAt = new Date().toISOString();
const runId = randomUUID();
const graphApiVersion = process.env.META_GRAPH_API_VERSION || "v26.0";
const baseUrl = new URL(
  process.env.INTEGRATION_BASE_URL || "https://solar-ops-whatsapp.vercel.app",
);
const reportDir = process.env.INTEGRATION_REPORT_DIR || "artifacts/integration";
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || "whatsapp-media";
const cleanupEnabled = process.env.INTEGRATION_CLEANUP !== "false";

const secretValues = REQUIRED_ENV.map((key) => process.env[key]).filter(Boolean);
const report = {
  ok: false,
  startedAt,
  finishedAt: null,
  graphApiVersion,
  targetOrigin: baseUrl.origin,
  checks: [],
  cleanup: [],
};

const createdMessageIds = new Set();
const createdStoragePaths = new Set();
const createdMetaMediaIds = new Set();
let supabase;

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return redactText(message, secretValues).slice(0, 1200);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.ok =
    report.checks.every((check) => check.status === "pass") &&
    report.cleanup.every((item) => item.status !== "fail");
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    `${reportDir}/report.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    `${reportDir}/report.md`,
    `${buildMarkdownReport(report)}\n`,
    "utf8",
  );
}

async function check(name, operation) {
  const started = Date.now();
  try {
    const details = await operation();
    report.checks.push({
      name,
      status: "pass",
      durationMs: Date.now() - started,
      details: redactText(details ?? "ok", secretValues),
    });
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    const details = safeError(error);
    report.checks.push({
      name,
      status: "fail",
      durationMs: Date.now() - started,
      details,
    });
    console.error(`FAIL ${name}: ${details}`);
    return false;
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Expected JSON response but received HTTP ${response.status}`,
    );
  }
}

async function postSignedWebhook(payload) {
  const rawBody = JSON.stringify(payload);
  const response = await fetch(new URL("/api/whatsapp", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signWebhookBody(
        rawBody,
        process.env.META_APP_SECRET,
      ),
    },
    body: rawBody,
    redirect: "error",
  });
  return { response, body: await readJsonResponse(response) };
}

async function queryMessage(messageId) {
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select(
      "whatsapp_message_id,phone_number_id,sender_phone,message_type,text_body,original_filename,mime_type,media_size_bytes,storage_path,processing_status,error_message",
    )
    .eq("whatsapp_message_id", messageId)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase row lookup failed: ${error.message}`);
  }

  return data;
}

async function countMessage(messageId) {
  const { count, error } = await supabase
    .from("whatsapp_messages")
    .select("whatsapp_message_id", { count: "exact", head: true })
    .eq("whatsapp_message_id", messageId);

  if (error) {
    throw new Error(`Supabase row count failed: ${error.message}`);
  }

  return count ?? 0;
}

function makeExpectedStoragePath(
  senderPhone,
  messageId,
  timestampSeconds,
  filename,
) {
  const date = new Date(Number(timestampSeconds) * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const hashedMessageId = sha256Hex(messageId).slice(0, 24);
  return [
    normalizeDigits(senderPhone),
    String(year),
    month,
    hashedMessageId,
    filename,
  ].join("/");
}

async function uploadMetaMedia(bytes) {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    "solar-ops-integration.pdf",
  );

  const response = await fetch(
    `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(
      process.env.WHATSAPP_PHONE_NUMBER_ID,
    )}/media`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      },
      body: form,
    },
  );

  const body = await readJsonResponse(response);
  if (!response.ok || typeof body.id !== "string" || !body.id) {
    throw new Error(`Meta media upload failed with HTTP ${response.status}`);
  }

  return body.id;
}

async function retrieveMetaMedia(mediaId) {
  const url = new URL(
    `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(
      mediaId,
    )}`,
  );
  url.searchParams.set(
    "phone_number_id",
    process.env.WHATSAPP_PHONE_NUMBER_ID,
  );

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    },
  });
  const body = await readJsonResponse(response);

  if (!response.ok || typeof body.url !== "string" || !body.url) {
    throw new Error(
      `Meta media metadata lookup failed with HTTP ${response.status}`,
    );
  }

  return body;
}

async function downloadMetaMedia(mediaUrl) {
  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Meta media download failed with HTTP ${response.status}`,
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

async function cleanup() {
  if (!cleanupEnabled || !supabase) {
    return;
  }

  if (createdStoragePaths.size > 0) {
    try {
      const { error } = await supabase.storage
        .from(storageBucket)
        .remove([...createdStoragePaths]);

      if (error) {
        throw error;
      }

      report.cleanup.push({
        name: "Supabase Storage fixtures",
        status: "pass",
      });
    } catch (error) {
      report.cleanup.push({
        name: "Supabase Storage fixtures",
        status: "fail",
        details: safeError(error),
      });
    }
  }

  if (createdMessageIds.size > 0) {
    try {
      const { error } = await supabase
        .from("whatsapp_messages")
        .delete()
        .in("whatsapp_message_id", [...createdMessageIds]);

      if (error) {
        throw error;
      }

      report.cleanup.push({
        name: "Supabase database fixtures",
        status: "pass",
      });
    } catch (error) {
      report.cleanup.push({
        name: "Supabase database fixtures",
        status: "fail",
        details: safeError(error),
      });
    }
  }

  for (const mediaId of createdMetaMediaIds) {
    try {
      const url = new URL(
        `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(
          mediaId,
        )}`,
      );
      url.searchParams.set(
        "phone_number_id",
        process.env.WHATSAPP_PHONE_NUMBER_ID,
      );

      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Meta media cleanup failed with HTTP ${response.status}`,
        );
      }

      report.cleanup.push({
        name: "Meta media fixture",
        status: "pass",
      });
    } catch (error) {
      report.cleanup.push({
        name: "Meta media fixture",
        status: "fail",
        details: safeError(error),
      });
    }
  }
}

async function main() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    report.checks.push({
      name: "preflight.environment",
      status: "fail",
      durationMs: 0,
      details: `Missing required variable names: ${missing.join(", ")}`,
    });
    return;
  }

  const allowedSender = normalizeDigits(
    process.env.INTEGRATION_ALLOWED_SENDER,
  );
  assert(
    allowedSender.length >= 8,
    "INTEGRATION_ALLOWED_SENDER is not a plausible phone identifier",
  );

  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  const secureRuntimeOk = await check(
    "health.secure-runtime",
    async () => {
      const response = await fetch(new URL("/api/health", baseUrl), {
        headers: { "cache-control": "no-cache" },
        redirect: "error",
      });
      const body = await readJsonResponse(response);

      assert(
        response.status === 200,
        `Health returned HTTP ${response.status}`,
      );
      assert(body.configured === true, "Runtime is not fully configured");
      assert(
        body.configuration?.validation?.webhook === true,
        "Webhook environment validation is not healthy",
      );
      assert(
        body.configuration?.validation?.ingestion === true,
        "Ingestion environment validation is not healthy",
      );
      assert(
        body.configuration?.presence?.WHATSAPP_PHONE_NUMBER_ID === true,
        "Destination Phone Number ID restriction is not configured",
      );
      assert(
        body.configuration?.presence?.ALLOWED_WHATSAPP_SENDERS === true,
        "Sender allowlist is not configured",
      );

      return "runtime configured; both security filters present";
    },
  );

  if (!secureRuntimeOk) {
    return;
  }

  const invalidSignatureOk = await check(
    "webhook.invalid-signature",
    async () => {
      const response = await fetch(new URL("/api/whatsapp", baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
        },
        body: JSON.stringify({
          object: "whatsapp_business_account",
          entry: [],
        }),
        redirect: "error",
      });

      assert(
        response.status === 401,
        `Expected HTTP 401, received ${response.status}`,
      );
      return "invalid HMAC rejected";
    },
  );

  if (!invalidSignatureOk) {
    return;
  }

  const signedEmptyOk = await check(
    "webhook.signed-empty-event",
    async () => {
      const { response, body } = await postSignedWebhook({
        object: "whatsapp_business_account",
        entry: [],
      });

      assert(
        response.status === 200,
        `Expected HTTP 200, received ${response.status}`,
      );
      assert(body.processed === 0, "Expected zero processed messages");
      return "valid signed empty event accepted without writes";
    },
  );

  if (!signedEmptyOk) {
    return;
  }

  const senderAllowlistOk = await check(
    "security.sender-allowlist",
    async () => {
      const messageId = `integration.disallowed.${runId}`;
      createdMessageIds.add(messageId);

      const payload = buildWebhookPayload({
        messageId,
        senderPhone: "999999999999999",
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        timestampSeconds: Math.floor(Date.now() / 1000),
        type: "text",
        textBody: "integration negative sender test",
      });

      const { response, body } = await postSignedWebhook(payload);
      assert(
        response.status === 200,
        `Expected HTTP 200, received ${response.status}`,
      );
      assert(
        body.results?.[0]?.result === "ignored",
        "Disallowed sender was not ignored",
      );
      assert(
        (await countMessage(messageId)) === 0,
        "Disallowed sender created a database row",
      );

      createdMessageIds.delete(messageId);
      return "disallowed sender ignored and not persisted";
    },
  );

  if (!senderAllowlistOk) {
    return;
  }

  const phoneNumberRestrictionOk = await check(
    "security.phone-number-id",
    async () => {
      const messageId = `integration.wrong-phone.${runId}`;
      createdMessageIds.add(messageId);

      const payload = buildWebhookPayload({
        messageId,
        senderPhone: allowedSender,
        phoneNumberId:
          `${process.env.WHATSAPP_PHONE_NUMBER_ID}-integration-wrong`,
        timestampSeconds: Math.floor(Date.now() / 1000),
        type: "text",
        textBody: "integration negative destination test",
      });

      const { response, body } = await postSignedWebhook(payload);
      assert(
        response.status === 200,
        `Expected HTTP 200, received ${response.status}`,
      );
      assert(
        body.results?.[0]?.result === "ignored",
        "Wrong destination Phone Number ID was not ignored",
      );
      assert(
        (await countMessage(messageId)) === 0,
        "Wrong destination Phone Number ID created a database row",
      );

      createdMessageIds.delete(messageId);
      return "wrong destination Phone Number ID ignored and not persisted";
    },
  );

  if (!phoneNumberRestrictionOk) {
    return;
  }

  const textMessageId = `integration.text.${runId}`;
  createdMessageIds.add(textMessageId);

  const textPayload = buildWebhookPayload({
    messageId: textMessageId,
    senderPhone: allowedSender,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    timestampSeconds: Math.floor(Date.now() / 1000),
    type: "text",
    textBody: "Solar Ops credentialed integration text",
  });

  await check("text.webhook-to-database", async () => {
    const { response, body } = await postSignedWebhook(textPayload);

    assert(
      response.status === 200,
      `Expected HTTP 200, received ${response.status}`,
    );
    assert(
      body.results?.[0]?.result === "stored",
      "Text message was not stored",
    );

    const row = await queryMessage(textMessageId);
    assert(row, "Text row was not found in Supabase");
    assert(row.message_type === "text", "Stored row type is not text");
    assert(
      row.processing_status === "stored",
      "Text row status is not stored",
    );
    assert(
      row.text_body === "Solar Ops credentialed integration text",
      "Text body did not round-trip",
    );
    assert(
      row.sender_phone === allowedSender,
      "Stored sender does not match integration sender",
    );
    assert(
      row.phone_number_id === process.env.WHATSAPP_PHONE_NUMBER_ID,
      "Stored destination does not match configured Phone Number ID",
    );

    return "signed text reached Vercel and Supabase";
  });

  await check("text.idempotent-replay", async () => {
    const { response, body } = await postSignedWebhook(textPayload);

    assert(
      response.status === 200,
      `Expected HTTP 200, received ${response.status}`,
    );
    assert(
      body.results?.[0]?.result === "stored",
      "Replay was not handled as stored",
    );
    assert(
      (await countMessage(textMessageId)) === 1,
      "Replay created duplicate database rows",
    );

    return "replay kept exactly one row";
  });

  await check("storage.private-bucket", async () => {
    const { data, error } = await supabase.storage.getBucket(storageBucket);

    if (error) {
      throw new Error(
        `Supabase bucket lookup failed: ${error.message}`,
      );
    }

    assert(data?.public === false, "Storage bucket is not private");
    return "configured Storage bucket is private";
  });

  const pdfBytes = buildMinimalPdf(`Solar Ops integration ${runId}`);
  const expectedPdfHash = sha256Hex(pdfBytes);
  let mediaId;

  await check("meta.media-upload", async () => {
    mediaId = await uploadMetaMedia(pdfBytes);
    createdMetaMediaIds.add(mediaId);
    return `synthetic PDF uploaded (${pdfBytes.length} bytes)`;
  });

  let mediaMetadata;

  if (mediaId) {
    await check("meta.media-metadata", async () => {
      mediaMetadata = await retrieveMetaMedia(mediaId);

      assert(
        mediaMetadata.mime_type === "application/pdf",
        "Meta media MIME type is not application/pdf",
      );
      assert(
        Number(mediaMetadata.file_size) === pdfBytes.length,
        "Meta media size does not match uploaded fixture",
      );

      return "media URL metadata retrieved with Phone Number ID binding";
    });
  }

  if (mediaMetadata?.url) {
    await check("meta.media-download", async () => {
      const downloaded = await downloadMetaMedia(mediaMetadata.url);

      assert(
        sha256Hex(downloaded) === expectedPdfHash,
        "Direct Meta media download hash mismatch",
      );

      return "Meta media bytes round-trip hash verified";
    });
  }

  if (mediaId) {
    const documentMessageId = `integration.document.${runId}`;
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const filename = "solar-ops-integration.pdf";
    const expectedStoragePath = makeExpectedStoragePath(
      allowedSender,
      documentMessageId,
      timestampSeconds,
      filename,
    );

    createdMessageIds.add(documentMessageId);
    createdStoragePaths.add(expectedStoragePath);

    const documentPayload = buildWebhookPayload({
      messageId: documentMessageId,
      senderPhone: allowedSender,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      timestampSeconds,
      type: "document",
      media: {
        id: mediaId,
        filename,
        mime_type: "application/pdf",
        sha256: expectedPdfHash,
      },
    });

    await check(
      "document.webhook-to-private-storage",
      async () => {
        const { response, body } =
          await postSignedWebhook(documentPayload);

        assert(
          response.status === 200,
          `Expected HTTP 200, received ${response.status}`,
        );
        assert(
          body.results?.[0]?.result === "stored",
          "Document webhook was not stored",
        );

        const row = await queryMessage(documentMessageId);
        assert(row, "Document row was not found in Supabase");
        assert(
          row.message_type === "document",
          "Stored row type is not document",
        );
        assert(
          row.processing_status === "stored",
          "Document row status is not stored",
        );
        assert(
          row.storage_path === expectedStoragePath,
          "Document storage path is unexpected",
        );
        assert(
          row.original_filename === filename,
          "Original document filename was not retained",
        );
        assert(
          row.mime_type === "application/pdf",
          "Stored document MIME type is not application/pdf",
        );
        assert(
          Number(row.media_size_bytes) === pdfBytes.length,
          "Stored document size is unexpected",
        );

        return "document downloaded by webhook and persisted to private Storage";
      },
    );

    await check("document.storage-byte-integrity", async () => {
      const { data, error } = await supabase.storage
        .from(storageBucket)
        .download(expectedStoragePath);

      if (error) {
        throw new Error(
          `Supabase Storage download failed: ${error.message}`,
        );
      }

      const storedBytes = Buffer.from(await data.arrayBuffer());
      assert(
        sha256Hex(storedBytes) === expectedPdfHash,
        "Supabase Storage file hash mismatch",
      );

      return "stored PDF bytes match the uploaded Meta fixture";
    });
  }
}

try {
  await main();
} catch (error) {
  report.checks.push({
    name: "integration.unhandled",
    status: "fail",
    durationMs: 0,
    details: safeError(error),
  });
  console.error(`FAIL integration.unhandled: ${safeError(error)}`);
} finally {
  await cleanup();
  await writeReport();
}

if (!report.ok) {
  process.exitCode = 1;
}
