import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookies: vi.fn(),
  sameOrigin: vi.fn(),
  verifySession: vi.fn(),
  setAgentEnabled: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: state.cookies }));
vi.mock("@/lib/ops-auth", () => ({
  OPS_SESSION_COOKIE: "solar_ops_session",
  isSameOriginRequest: state.sameOrigin,
  verifyOpsSession: state.verifySession,
}));
vi.mock("@/lib/agent-settings", () => ({
  setAgentEnabled: state.setAgentEnabled,
}));

import { POST } from "@/app/api/ops/settings/agent/route";

function makeRequest(enabled: string, origin = "https://ops.example.test") {
  return new Request("https://ops.example.test/api/ops/settings/agent", {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ enabled }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.cookies.mockResolvedValue({
    get: (name: string) =>
      name === "solar_ops_session" ? { value: "valid-session" } : undefined,
  });
  state.sameOrigin.mockReturnValue(true);
  state.verifySession.mockReturnValue(true);
  state.setAgentEnabled.mockResolvedValue(undefined);
});

describe("central agent settings POST authorization and persistence", () => {
  it("rejects cross-origin requests before reading the session or writing", async () => {
    state.sameOrigin.mockReturnValue(false);

    const response = await POST(makeRequest("true", "https://evil.example"));

    expect(response.status).toBe(403);
    expect(state.cookies).not.toHaveBeenCalled();
    expect(state.setAgentEnabled).not.toHaveBeenCalled();
  });

  it("rejects requests without a valid operations session before writing", async () => {
    state.verifySession.mockReturnValue(false);

    const response = await POST(makeRequest("true"));

    expect(response.status).toBe(401);
    expect(state.setAgentEnabled).not.toHaveBeenCalled();
  });

  it("rejects malformed values without changing the persisted setting", async () => {
    const response = await POST(makeRequest("yes"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://ops.example.test/ops/settings?result=invalid",
    );
    expect(state.setAgentEnabled).not.toHaveBeenCalled();
  });

  it.each([
    ["true", true, "enabled"],
    ["false", false, "disabled"],
  ])("persists the explicit %s state and redirects with a matching result", async (formValue, expected, result) => {
    const response = await POST(makeRequest(formValue));

    expect(state.setAgentEnabled).toHaveBeenCalledWith(expected);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://ops.example.test/ops/settings?result=${result}`,
    );
  });

  it("does not report a successful change when persistence fails", async () => {
    state.setAgentEnabled.mockRejectedValue(new Error("database unavailable"));

    const response = await POST(makeRequest("true"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://ops.example.test/ops/settings?result=failed",
    );
  });
});
