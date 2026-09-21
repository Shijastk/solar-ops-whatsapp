import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWhatsAppTextReply } from "../lib/meta-messages.ts";

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

beforeEach(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-test";
  process.env.META_GRAPH_API_VERSION = "v26.0";
  process.env.ALLOWED_WHATSAPP_SENDERS = "919999999999";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.SUPABASE_STORAGE_BUCKET = "whatsapp-media";
  process.env.MAX_MEDIA_BYTES = "15728640";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of keys) {
    const original = originals[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("sendWhatsAppTextReply", () => {
  it("sends a text reply with Meta reply context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [{ id: "wamid.outbound-1" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppTextReply({
      recipientPhone: "919999999999",
      replyToMessageId: "wamid.inbound-1",
      body: "Received",
    });

    expect(result).toBe("wamid.outbound-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919999999999",
      context: { message_id: "wamid.inbound-1" },
      type: "text",
      text: { preview_url: false, body: "Received" },
    });
  });

  it("fails closed when Meta rejects the send request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("provider error", { status: 400 })),
    );

    await expect(
      sendWhatsAppTextReply({
        recipientPhone: "919999999999",
        replyToMessageId: "wamid.inbound-1",
        body: "Received",
      }),
    ).rejects.toThrow("HTTP 400");
  });
});
