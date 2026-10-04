import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleFastWhatsAppQuery } from "../lib/whatsapp-queries";
import { voiceQueryClarification, generateUniversalWhatsAppReply } from "../lib/whatsapp-fallback";
import { sendOpsReply } from "../lib/replies";

vi.mock("../lib/replies", () => ({ sendOpsReply: vi.fn() }));
vi.mock("../lib/whatsapp-fallback", async (original) => ({
  ...await original<typeof import("../lib/whatsapp-fallback")>(),
  generateUniversalWhatsAppReply: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());

describe("unresolved operational voice", () => {
  it("shows what was heard without generating an English live-data disclaimer", async () => {
    const transcript = "UNRECOGNIZED PRODUCT ETHRA STOKE?";
    await handleFastWhatsAppQuery({
      type: "text", textBody: transcript, senderPhone: "synthetic",
      messageId: "synthetic-voice", timestamp: new Date(),
    }, "synthetic-stored-message", { fromVoice: true });
    expect(generateUniversalWhatsAppReply).not.toHaveBeenCalled();
    expect(sendOpsReply).toHaveBeenCalledWith(expect.objectContaining({
      body: voiceQueryClarification(transcript),
    }));
    expect(voiceQueryClarification(transcript)).not.toContain("560");
  });
  it("bounds the echoed transcript", () => {
    expect(voiceQueryClarification("x".repeat(2000))).not.toContain("x".repeat(221));
  });
});
