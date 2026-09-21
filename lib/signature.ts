import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const provided = signatureHeader.slice("sha256=".length);
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(provided, "utf8"),
    Buffer.from(expected, "utf8"),
  );
}
