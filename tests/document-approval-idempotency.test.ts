import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  reads: [] as Array<{
    id: string;
    parse_status: string;
    workflow_status: string;
  } | null>,
  updateResult: {
    data: { id: string } | null;
    error: { message: string } | null;
  },
  from: vi.fn(),
  updateFilters: [] as Array<Array<[string, unknown]>>,
  updatePayload: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: state.from }),
}));

import { approveDocumentDraft } from "../lib/document-processing";

function draft(parse_status: string, workflow_status: string) {
  return { id: "draft-1", parse_status, workflow_status };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.reads = [];
  state.updateResult = { data: { id: "draft-1" }, error: null };
  state.updateFilters = [];
  state.updatePayload = null;
  state.from.mockImplementation(() => {
    let mode: "read" | "update" = "read";
    const filters: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    };
    builder.update = (payload: Record<string, unknown>) => {
      mode = "update";
      state.updatePayload = payload;
      return builder;
    };
    builder.maybeSingle = async () => {
      if (mode === "update") {
        state.updateFilters.push([...filters]);
        return state.updateResult;
      }
      return { data: state.reads.shift() ?? null, error: null };
    };
    return builder;
  });
});

describe("document approval idempotency and race safety", () => {
  it("returns the approved draft on a duplicate approval without a second update", async () => {
    state.reads = [draft("approved", "recorded")];

    await expect(approveDocumentDraft("message-1")).resolves.toBe("draft-1");

    expect(state.updatePayload).toBeNull();
  });

  it("uses a workflow-status compare-and-swap and accepts a concurrent approval winner", async () => {
    state.reads = [
      draft("ready_for_review", "review_required"),
      draft("approved", "recorded"),
    ];
    state.updateResult = { data: null, error: null };

    await expect(approveDocumentDraft("message-1")).resolves.toBe("draft-1");

    expect(state.updateFilters[0]).toContainEqual([
      "workflow_status",
      "review_required",
    ]);
    expect(state.updatePayload).toMatchObject({
      parse_status: "approved",
      workflow_status: "recorded",
    });
  });

  it("does not overwrite cancellation when approval loses the race", async () => {
    state.reads = [
      draft("ready_for_review", "review_required"),
      draft("ready_for_review", "cancelled"),
    ];
    state.updateResult = { data: null, error: null };

    await expect(approveDocumentDraft("message-1")).rejects.toThrow(
      "Cancelled document drafts cannot be approved",
    );
  });

  it("fails closed when the draft changed to another state during approval", async () => {
    state.reads = [
      draft("ready_for_review", "review_required"),
      draft("needs_review", "review_required"),
    ];
    state.updateResult = { data: null, error: null };

    await expect(approveDocumentDraft("message-1")).rejects.toThrow(
      "Document changed while approval was in progress",
    );
  });
});
