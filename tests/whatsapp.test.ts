import { describe, expect, it } from "vitest";
import {
  extractWhatsAppMessages,
  extractWhatsAppStatuses,
} from "../lib/whatsapp";

const sender = "919999999999";

function makePayload(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-test",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15551234567",
                phone_number_id: "phone-number-test",
              },
              contacts: [
                {
                  profile: {
                    name: "Test Operator",
                  },
                  wa_id: sender,
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

describe("extractWhatsAppMessages", () => {
  it("normalizes an inbound text message", () => {
    const result = extractWhatsAppMessages(
      makePayload({
        from: sender,
        id: "wamid.text-1",
        timestamp: "1789966746",
        type: "text",
        text: {
          body: "Hello",
        },
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      wabaId: "waba-test",
      phoneNumberId: "phone-number-test",
      displayPhoneNumber: "15551234567",
      senderPhone: sender,
      senderName: "Test Operator",
      messageId: "wamid.text-1",
      type: "text",
      textBody: "Hello",
    });
    expect(result[0].timestamp).toBeInstanceOf(Date);
  });

  it("normalizes an inbound document message", () => {
    const result = extractWhatsAppMessages(
      makePayload({
        from: sender,
        id: "wamid.document-1",
        timestamp: "1789966841",
        type: "document",
        document: {
          id: "media-123",
          filename: "invoice.pdf",
          mime_type: "application/pdf",
          sha256: "test-sha256",
        },
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      senderPhone: sender,
      messageId: "wamid.document-1",
      type: "document",
      media: {
        id: "media-123",
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sha256: "test-sha256",
      },
    });
  });

  it("ignores webhook changes that are not message events", () => {
    const result = extractWhatsAppMessages({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-test",
          changes: [
            {
              field: "message_template_status_update",
              value: {},
            },
          ],
        },
      ],
    });

    expect(result).toEqual([]);
  });

  it("ignores structurally invalid webhook payloads", () => {
    expect(extractWhatsAppMessages({ object: "other" })).toEqual([]);
    expect(extractWhatsAppMessages(null)).toEqual([]);
  });

  it("skips messages with a non-numeric timestamp", () => {
    const result = extractWhatsAppMessages(
      makePayload({
        from: sender,
        id: "wamid.invalid-time",
        timestamp: "not-a-number",
        type: "text",
        text: {
          body: "Hello",
        },
      }),
    );

    expect(result).toEqual([]);
  });
});


describe("extractWhatsAppStatuses", () => {
  it("normalizes outbound message status callbacks", () => {
    const result = extractWhatsAppStatuses({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-test",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                statuses: [
                  {
                    id: "wamid.out-1",
                    status: "delivered",
                    timestamp: "1789967000",
                    recipient_id: sender,
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      messageId: "wamid.out-1",
      status: "delivered",
      recipientId: sender,
    });
    expect(result[0].timestamp).toBeInstanceOf(Date);
  });

  it("keeps safe failure diagnostics without requiring optional fields", () => {
    const result = extractWhatsAppStatuses({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                statuses: [
                  {
                    id: "wamid.failed-1",
                    status: "failed",
                    timestamp: "1789967001",
                    errors: [{ code: 131000, title: "Test failure" }],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result[0]).toMatchObject({
      status: "failed",
      errorCode: 131000,
      errorTitle: "Test failure",
    });
  });
});
