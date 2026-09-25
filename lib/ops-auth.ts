import { createHmac, timingSafeEqual } from "node:crypto";
import { getWebhookEnv } from "@/lib/env";

export const OPS_SESSION_COOKIE = "solar_ops_session";
const SESSION_VERSION = "v1";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getOpsAccessKey(): string {
  const dedicated = process.env.OPS_ACCESS_KEY?.trim();
  if (dedicated) {
    return dedicated;
  }

  return getWebhookEnv().WHATSAPP_VERIFY_TOKEN;
}

function signSessionPayload(payload: string): string {
  return createHmac("sha256", getWebhookEnv().META_APP_SECRET)
    .update(payload, "utf8")
    .digest("hex");
}

export function isValidOpsAccessKey(value: string): boolean {
  return safeEqual(value, getOpsAccessKey());
}

export function createOpsSession(
  now = Date.now(),
  durationMs = SESSION_DURATION_MS,
): string {
  const expiresAt = now + durationMs;
  const payload = `${SESSION_VERSION}.${expiresAt}`;
  const signature = signSessionPayload(payload);

  return `${payload}.${signature}`;
}

export function verifyOpsSession(
  session: string | undefined,
  now = Date.now(),
): boolean {
  if (!session) {
    return false;
  }

  const [version, expiresAtRaw, signature, ...extra] = session.split(".");
  if (
    extra.length > 0 ||
    version !== SESSION_VERSION ||
    !expiresAtRaw ||
    !signature
  ) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    return false;
  }

  const payload = `${version}.${expiresAtRaw}`;
  const expectedSignature = signSessionPayload(payload);

  return safeEqual(signature, expectedSignature);
}

export function getOpsSessionExpiresAt(
  session: string | undefined,
  now = Date.now(),
): number | null {
  if (!verifyOpsSession(session, now) || !session) {
    return null;
  }

  const expiresAt = Number(session.split(".")[1]);
  return Number.isSafeInteger(expiresAt) ? expiresAt : null;
}

export function opsSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  };
}

export function isSameOriginRequest(request: Request): boolean {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");

  if (origin) {
    return origin === expectedOrigin;
  }

  const referer = request.headers.get("referer");
  if (!referer) {
    return false;
  }

  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}
