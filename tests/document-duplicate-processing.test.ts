import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  existing: null as {
    id: string;
    parse_status: string;
    workflow_status: string;
  } | null,
  from: vi.fn(),
  extract: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: state.from }),
}));
vi.mock("@/lib/pdf-extract", () => ({ extractPdfText: state.extract }));
import { processPdfBytesForMessage } from "../lib/document-processing";
beforeEach(() => {
  vi.clearAllMocks();
  state.existing = null;
  state.extract.mockResolvedValue({
    text: "Previously verified PDF text",
    pageCount: 1,
  });
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    order: vi.fn(),
    limit: vi
      .fn()
      .mockResolvedValue({ data: [{ id: "canonical-draft" }], error: null }),
    maybeSingle: vi
      .fn()
      .mockImplementation(async () => ({ data: state.existing, error: null })),
    upsert: state.upsert,
  };
  for (const name of ["select", "eq", "neq", "order"] as const)
    chain[name].mockReturnValue(chain);
  state.from.mockReturnValue(chain);
});
describe("duplicate PDF processing", () => {
  it("reuses an approved active bill for identical extracted text without inserting drafts or items", async () => {
    const result = await processPdfBytesForMessage(
      "new-message",
      Buffer.from("%PDF-test"),
    );
    expect(result).toEqual({
      draftId: "canonical-draft",
      status: "already_uploaded",
      itemCount: 0,
      skippedApproved: true,
      duplicate: true,
    });
    expect(state.upsert).not.toHaveBeenCalled();
    expect(
      state.from.mock.calls.every(([table]) => table === "document_drafts"),
    ).toBe(true);
  });
  it("a same-message approved retry skips extraction and remains the original bill", async () => {
    state.existing = {
      id: "original",
      parse_status: "approved",
      workflow_status: "recorded",
    };
    const result = await processPdfBytesForMessage(
      "same-message",
      Buffer.from("%PDF-test"),
    );
    expect(result.draftId).toBe("original");
    expect(result.duplicate).not.toBe(true);
    expect(state.extract).not.toHaveBeenCalled();
  });
});
