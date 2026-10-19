import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedWhatsAppMessage } from "../lib/whatsapp";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
  transcribe: vi.fn(),
  download: vi.fn(),
  route: vi.fn(),
  agentEnabled: vi.fn(),
  sendOpsReply: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
  transcriptError: null as { message: string } | null,
  allowedSenders: new Set<string>(["919999999999"]),
}));

vi.mock("@/lib/agent-settings", () => ({ getAgentEnabled: state.agentEnabled }));

vi.mock("@/lib/env", () => ({
  getIngestionEnv: () => ({
    allowedSenders: state.allowedSenders,
    WHATSAPP_PHONE_NUMBER_ID: null,
    SUPABASE_STORAGE_BUCKET: "test-bucket",
  }),
}));
vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: state.from,
    storage: { from: state.storageFrom },
  }),
}));
vi.mock("@/lib/meta", () => ({
  downloadWhatsAppMedia: state.download,
}));
vi.mock("@/lib/voice-transcription", () => ({
  transcribeOperationalVoice: state.transcribe,
}));
vi.mock("@/lib/operational-message-routing", () => ({
  routeOperationalTextMessage: state.route,
}));
vi.mock("@/lib/replies", () => ({
  sendOpsReply: state.sendOpsReply,
}));
vi.mock("@/lib/document-processing", () => ({
  processPdfBytesForMessage: vi.fn(),
}));
vi.mock("@/lib/document-automation", () => ({
  runDocumentAutomationForDraft: vi.fn(),
}));
vi.mock("@/lib/trips", () => ({
  reserveTripDocument: vi.fn(),
  finishTripAfterDuplicate: vi.fn(),
  markTripDocumentProcessed: vi.fn(),
}));

import { ingestWhatsAppMessage } from "../lib/ingest";

const voiceMessage = {
  type: "audio",
  messageId: "wamid.voice-1",
  senderPhone: "919999999999",
  timestamp: new Date("2026-10-19T06:00:00.000Z"),
  media: {
    id: "media-1",
    filename: "voice.ogg",
    mimeType: "audio/ogg",
  },
} as unknown as NormalizedWhatsAppMessage;

beforeEach(() => {
  vi.clearAllMocks();
  state.agentEnabled.mockResolvedValue(true);
  state.updates = [];
  state.transcriptError = null;
  state.allowedSenders = new Set(["919999999999"]);
  state.download.mockResolvedValue({
    bytes: Buffer.from("synthetic voice bytes"),
    mimeType: "audio/ogg",
    sha256: "synthetic-hash",
    fileSize: 21,
  });
  state.transcribe.mockResolvedValue("Rasheed innale ethra trip poyi?");
  state.route.mockResolvedValue("handled");
  state.sendOpsReply.mockResolvedValue(undefined);
  state.upload.mockResolvedValue({ error: null });
  state.storageFrom.mockReturnValue({ upload: state.upload });
  state.from.mockImplementation(() => {
    let updateValues: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {};
    builder.upsert = () => builder;
    builder.select = () => builder;
    builder.single = async () => ({
      data: { id: "stored-message-1" },
      error: null,
    });
    builder.update = (values: Record<string, unknown>) => {
      updateValues = values;
      state.updates.push(values);
      return builder;
    };
    builder.eq = async () => ({
      error: updateValues?.text_body && state.transcriptError
        ? state.transcriptError
        : null,
    });
    return builder;
  });
});

describe("WhatsApp voice workflow integration", () => {
  it("fails closed when the sender allowlist is empty", async () => {
    state.allowedSenders = new Set();

    await expect(ingestWhatsAppMessage(voiceMessage)).resolves.toBe("ignored");

    expect(state.from).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    expect(state.transcribe).not.toHaveBeenCalled();
    expect(state.route).not.toHaveBeenCalled();
  });

  it("ignores senders not present in the allowlist before database access", async () => {
    const unauthorized = {
      ...voiceMessage,
      senderPhone: "918888888888",
    } as NormalizedWhatsAppMessage;

    await expect(ingestWhatsAppMessage(unauthorized)).resolves.toBe("ignored");

    expect(state.from).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    expect(state.transcribe).not.toHaveBeenCalled();
    expect(state.route).not.toHaveBeenCalled();
  });

  it("persists the transcript and routes it through the shared operational pipeline", async () => {
    await expect(ingestWhatsAppMessage(voiceMessage)).resolves.toBe("stored");

    expect(state.transcribe).toHaveBeenCalledTimes(1);
    expect(state.updates).toContainEqual({
      text_body: "Rasheed innale ethra trip poyi?",
    });
    expect(state.route).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "text",
        textBody: "Rasheed innale ethra trip poyi?",
        media: undefined,
      }),
      "stored-message-1",
      { fromVoice: true, agentEnabled: true },
    );
    expect(state.sendOpsReply).not.toHaveBeenCalled();
  });

  it("stores voice media but skips transcription and routing while the agent is disabled", async () => {
    state.agentEnabled.mockResolvedValue(false);

    await expect(ingestWhatsAppMessage(voiceMessage)).resolves.toBe("stored");

    expect(state.download).toHaveBeenCalledTimes(1);
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(state.transcribe).not.toHaveBeenCalled();
    expect(state.route).not.toHaveBeenCalled();
    expect(state.sendOpsReply).not.toHaveBeenCalled();
  });

  it("does not report a transcription failure when downstream routing fails", async () => {
    state.route.mockRejectedValue(new Error("synthetic database failure"));

    await expect(ingestWhatsAppMessage(voiceMessage)).resolves.toBe("stored");

    expect(state.sendOpsReply).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Voice മനസ്സിലായി"),
      }),
    );
    expect(state.sendOpsReply).not.toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("transcribe ചെയ്യാൻ കഴിഞ്ഞില്ല"),
      }),
    );
  });
});
