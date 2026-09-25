import { describe, expect, it } from "vitest";
import { replyRedirectState } from "../app/api/ops/messages/[id]/reply/route";

describe("ops reply redirect state", () => {
  it("does not report a duplicate failed reply as sent", () => {
    expect(replyRedirectState("failed")).toBe("failed");
  });

  it("reports queued replies as pending", () => {
    expect(replyRedirectState("queued")).toBe("pending");
  });

  it("reports accepted delivery states as sent", () => {
    expect(replyRedirectState("sent")).toBe("sent");
    expect(replyRedirectState("delivered")).toBe("sent");
    expect(replyRedirectState("read")).toBe("sent");
  });
});
