import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/tech-launch/game-monitoring/route";
import { POST as STATUS_POST } from "@/app/api/tech-launch/game-monitoring/status/route";

const mocks = vi.hoisted(() => ({ requireCurrentAppUser: vi.fn(), assertCanUseTechLaunch: vi.fn(), startGameMonitoring: vi.fn(), getGameMonitoringStatus: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCurrentAppUser: mocks.requireCurrentAppUser, assertCanUseTechLaunch: mocks.assertCanUseTechLaunch, jsonError: (error: unknown) => error instanceof Response ? error : Response.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 }) }));
vi.mock("@/lib/game-monitoring", () => ({ gameMonitoringRequestSchema: { parse: (value: unknown) => value }, gameMonitoringStatusRequestSchema: { parse: (value: unknown) => value }, startGameMonitoring: mocks.startGameMonitoring, getGameMonitoringStatus: mocks.getGameMonitoringStatus }));

const filters = { appName: "wordblast", platforms: ["android"], appVersions: [], startDate: "2026-07-01", endDate: "2026-07-07" };
function request(body: unknown) { return new Request("http://localhost/api/tech-launch/game-monitoring", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

describe("Game Monitoring API", () => {
  beforeEach(() => {
    mocks.requireCurrentAppUser.mockReset().mockResolvedValue({ id: "viewer", role: "viewer" });
    mocks.assertCanUseTechLaunch.mockReset().mockResolvedValue(undefined);
    mocks.startGameMonitoring.mockReset().mockResolvedValue({ status: "running", filters, metadata: { jobKey: "monitoring-job", submittedAt: "2026-07-07T00:00:00.000Z" }, pollAfterMs: 1500 });
    mocks.getGameMonitoringStatus.mockReset().mockResolvedValue({ status: "completed", filters, points: [], summary: {}, metadata: { executedAt: "2026-07-07T00:00:00.000Z" } });
  });

  it("authorizes the selected app before starting a monitoring query", async () => {
    const response = await POST(request(filters));
    expect(response.status).toBe(200);
    expect(mocks.assertCanUseTechLaunch).toHaveBeenCalledWith(expect.anything(), "wordblast");
    expect(mocks.startGameMonitoring).toHaveBeenCalledWith(filters);
  });

  it("authorizes monitoring status polling", async () => {
    const response = await STATUS_POST(request({ jobKey: "monitoring-job", filters }));
    expect(response.status).toBe(200);
    expect(mocks.getGameMonitoringStatus).toHaveBeenCalledWith({ jobKey: "monitoring-job", filters });
  });
});
