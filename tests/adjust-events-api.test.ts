import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentAppUser: vi.fn(),
  assertCanUseTechLaunch: vi.fn(),
  check: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireCurrentAppUser: mocks.requireCurrentAppUser,
  assertCanUseTechLaunch: mocks.assertCanUseTechLaunch,
  jsonError: (error: unknown) => error instanceof Response ? error : Response.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 }),
}));

vi.mock("@/lib/adjust-events", async () => {
  const actual = await vi.importActual<typeof import("@/lib/adjust-events")>("@/lib/adjust-events");
  return { ...actual, getAdjustEventsCheck: mocks.check };
});

import { POST } from "@/app/api/tech-launch/adjust-events-check/route";

const user = { id: "viewer", email: "viewer@tripledotstudios.com", role: "viewer" };
const body = { appName: "stacksmash", platform: "android" };
function request(payload: unknown = body) {
  return new Request("http://localhost/api/tech-launch/adjust-events-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
}

describe("Adjust Events Check API", () => {
  beforeEach(() => {
    mocks.requireCurrentAppUser.mockReset().mockResolvedValue(user);
    mocks.assertCanUseTechLaunch.mockReset().mockResolvedValue(undefined);
    mocks.check.mockReset().mockResolvedValue({ status: "completed", appName: "stacksmash", platform: "android", checkedAt: "2026-09-08T00:00:00.000Z", overallStatus: "pass", checks: [], journeyMilestones: { status: "detected", milestones: [], nearMatches: [] } });
  });

  it("authorizes the selected app before checking Adjust", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.assertCanUseTechLaunch).toHaveBeenCalledWith(user, "stacksmash");
    expect(mocks.check).toHaveBeenCalledWith(body);
  });

  it("does not call Adjust when the selected app is unauthorized", async () => {
    mocks.assertCanUseTechLaunch.mockRejectedValueOnce(new Response(JSON.stringify({ error: "App access denied" }), { status: 403 }));

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("validates the app name", async () => {
    const response = await POST(request({ appName: "not-a-launch-app", platform: "android" }));

    expect(response.status).toBe(400);
    expect(mocks.check).not.toHaveBeenCalled();
  });
});
