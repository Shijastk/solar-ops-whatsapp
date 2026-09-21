import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadWhatsAppMedia } from "../lib/meta.ts";

const keys = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "META_GRAPH_API_VERSION",
  "ALLOWED_WHATSAPP_SENDERS",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "MAX_MEDIA_BYTES",
];

const originals = Object.fromEntries(
  keys.map((key) => [key, process.env[key]]),
);

function setValidEnvironment() {
  process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-test";
  process.env.META_GRAPH_API_VERSION = "v26.0";
  process.env.ALLOWED_WHATSAPP_SENDERS = "919999999999";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.SUPABASE_STORAGE_BUCKET = "whatsapp-media";
  process.env.MAX_MEDIA_BYTES = "10";
}

beforeEach(() => {
  setValidEnvironment();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of keys) {
    const original = originals[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe("downloadWhatsAppMedia", () => {
  it("rejects metadata that already exceeds the configured limit", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "media-1",
          url: "https://media.example/file",
          mime_type: "application/pdf",
          file_size: 11,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadWhatsAppMedia("media-1")).rejects.toThrow(
      "Inbound media is too large",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("downloads media and reports the returned metadata", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "media-2",
            url: "https://media.example/file",
            mime_type: "application/pdf",
            sha256: "sha-from-meta",
            file_size: bytes.byteLength,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadWhatsAppMedia("media-2", "text/plain");

    expect(result.bytes).toEqual(Buffer.from(bytes));
    expect(result.mimeType).toBe("application/pdf");
    expect(result.sha256).toBe("sha-from-meta");
    expect(result.fileSize).toBe(bytes.byteLength);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a download that exceeds the limit when metadata omits file size", async () => {
    const bytes = new Uint8Array(11);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "media-3",
            url: "https://media.example/file",
            mime_type: "application/pdf",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadWhatsAppMedia("media-3")).rejects.toThrow(
      "exceeded the configured limit after download",
    );
  });

  it("surfaces Meta metadata request failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response("provider-error", { status: 500 }),
      ),
    );

    await expect(downloadWhatsAppMedia("media-4")).rejects.toThrow(
      "Meta media metadata request failed (500)",
    );
  });
});
