import { describe, expect, it } from "vitest";
import { deterministicUuid } from "../lib/idempotency";

describe("deterministicUuid", () => {
  it("returns a stable RFC-compatible UUID for the same workflow key", () => {
    const first = deterministicUuid("document-summary:draft-1");
    const second = deterministicUuid("document-summary:draft-1");

    expect(first).toBe(second);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("changes when the workflow key changes", () => {
    expect(deterministicUuid("a")).not.toBe(deterministicUuid("b"));
  });
});
