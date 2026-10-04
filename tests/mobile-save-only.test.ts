import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({
  existing: null as null | Record<string, unknown>,
  upload: vi.fn(async () => ({ error: null })),
  insert: vi.fn(async () => ({ error: null })),
  process: vi.fn(async () => ({ draftId: "draft", duplicate: false })),
  automate: vi.fn(async () => undefined),
  attach: vi.fn(async () => undefined),
}));
vi.mock("../lib/mobile-api", () => ({ verifyMobileRequest: () => true }));
vi.mock("../lib/env", () => ({
  getIngestionEnv: () => ({ SUPABASE_STORAGE_BUCKET: "private-test" }),
}));
vi.mock("../lib/document-processing", () => ({
  processPdfBytesForMessage: mocks.process,
}));
vi.mock("../lib/document-automation", () => ({
  runDocumentAutomationForDraft: mocks.automate,
}));
vi.mock("../lib/mobile-trips", () => ({ attachMobileBill: mocks.attach }));
vi.mock("../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    storage: { from: () => ({ upload: mocks.upload, remove: vi.fn() }) },
    from: () => ({
      insert: mocks.insert,
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: mocks.existing, error: null }),
          single: async () => ({
            data: { stock_status: "applied" },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
import { POST } from "../app/api/mobile/v1/upload/route";
const id = "11111111-1111-4111-8111-111111111111";
const bytes = "%PDF-synthetic";
function request(requestId = id) {
  const body = new FormData();
  body.set(
    "file",
    new File([bytes], "synthetic.pdf", { type: "application/pdf" }),
  );
  body.set("requestId", requestId);
  return new Request("https://ops.example.test/api/mobile/v1/upload", {
    method: "POST",
    body,
  });
}
describe("mobile PDF retry identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existing = null;
  });
  it("stores a first upload with the client UUID and never creates a trip", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, duplicate: false });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id, whatsapp_message_id: "mobile:" + id }),
    );
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.attach).not.toHaveBeenCalled();
    expect(mocks.automate).toHaveBeenCalledWith("draft", {
      suppressReply: true,
    });
  });
  it("reuses the stored message and does not upload or insert twice", async () => {
    mocks.existing = {
      id,
      whatsapp_message_id: "mobile:" + id,
      media_sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("rejects mismatched bytes or invalid UUID before processing", async () => {
    mocks.existing = {
      id,
      whatsapp_message_id: "mobile:" + id,
      media_sha256: "different",
    };
    expect((await POST(request())).status).toBe(409);
    expect(mocks.process).not.toHaveBeenCalled();
    expect((await POST(request("invalid"))).status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
