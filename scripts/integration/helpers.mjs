import { createHash, createHmac } from "node:crypto";

export function signWebhookBody(rawBody, appSecret) {
  return `sha256=${createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex")}`;
}

export function normalizeDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function buildWebhookPayload({
  messageId,
  senderPhone,
  phoneNumberId,
  timestampSeconds,
  type,
  textBody,
  media,
}) {
  const message = {
    from: senderPhone,
    id: messageId,
    timestamp: String(timestampSeconds),
    type,
  };

  if (type === "text") {
    message.text = { body: textBody ?? "Solar Ops integration test" };
  }

  if (media) {
    message[type] = media;
  }

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "integration-test-waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "integration-test",
                phone_number_id: phoneNumberId,
              },
              contacts: [
                {
                  profile: { name: "Solar Ops Integration Test" },
                  wa_id: senderPhone,
                },
              ],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

function escapePdfText(value) {
  return String(value).replace(/([\\()])/g, "\\$1");
}

export function buildMinimalPdf(label = "Solar Ops integration test") {
  const stream = `BT /F1 14 Tf 72 720 Td (${escapePdfText(label)}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let pdf = "%PDF-1.4\n%SolarOps\n";
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function redactText(value, secretValues = []) {
  let output = String(value ?? "");

  for (const secret of secretValues) {
    if (secret) {
      output = output.split(secret).join("[redacted-secret]");
    }
  }

  output = output.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted-token]");
  output = output.replace(/\b\d{10,18}\b/g, "[redacted-identifier]");

  return output;
}

export function describeGraphApiError(body, status, secretValues = []) {
  const error =
    body && typeof body === "object" && body.error && typeof body.error === "object"
      ? body.error
      : null;

  const parts = [`HTTP ${status}`];

  if (error) {
    if (typeof error.type === "string" && error.type) {
      parts.push(`type=${error.type}`);
    }

    if (Number.isInteger(error.code)) {
      parts.push(`code=${error.code}`);
    }

    if (Number.isInteger(error.error_subcode)) {
      parts.push(`subcode=${error.error_subcode}`);
    }

    if (typeof error.message === "string" && error.message) {
      parts.push(`message=${error.message}`);
    }
  }

  return redactText(parts.join("; "), secretValues).slice(0, 900);
}

export function buildMarkdownReport(report) {
  const lines = [
    "# Solar Ops Credentialed Integration Report",
    "",
    `- Overall: **${report.ok ? "PASS" : "FAIL"}**`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt ?? "incomplete"}`,
    `- Graph API: ${report.graphApiVersion}`,
    `- Target: ${report.targetOrigin}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Duration | Details |",
    "| --- | --- | ---: | --- |",
  ];

  for (const check of report.checks) {
    const details = String(check.details ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ");
    lines.push(
      `| ${check.name} | ${check.status.toUpperCase()} | ${check.durationMs} ms | ${details} |`,
    );
  }

  if (report.cleanup?.length) {
    lines.push("", "## Cleanup", "");
    for (const item of report.cleanup) {
      lines.push(
        `- ${item.status.toUpperCase()}: ${item.name}${item.details ? ` — ${item.details}` : ""}`,
      );
    }
  }

  lines.push(
    "",
    "## Safety",
    "",
    "This report intentionally excludes access tokens, app secrets, phone numbers, message payloads, media IDs, customer documents, and Supabase credentials.",
    "",
  );

  return lines.join("\n");
}
