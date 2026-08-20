import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentAppUser: vi.fn(), assertCanUseTechLaunch: vi.fn(), canManageUsers: vi.fn(), techLaunchAppsForUser: vi.fn(),
  start: vi.fn(), status: vi.fn(), listConfigurations: vi.fn(), updateConfiguration: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireCurrentAppUser: mocks.requireCurrentAppUser,
  assertCanUseTechLaunch: mocks.assertCanUseTechLaunch,
  canManageUsers: mocks.canManageUsers,
  techLaunchAppsForUser: mocks.techLaunchAppsForUser,
  jsonError: (error: unknown) => error instanceof Response ? error : Response.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 }),
}));
vi.mock("@/lib/incent-config-validator", () => ({
  incentConfigValidatorRequestSchema: { parse: (value: unknown) => value },
  incentConfigValidatorStatusRequestSchema: { parse: (value: unknown) => value },
  startIncentConfigValidator: mocks.start,
  getIncentConfigValidatorStatus: mocks.status,
  listIncentConfigValidatorConfigurations: mocks.listConfigurations,
  updateIncentConfigValidatorConfiguration: mocks.updateConfiguration,
}));

import { POST } from "@/app/api/tech-launch/incent-config-validator/route";
import { POST as STATUS_POST } from "@/app/api/tech-launch/incent-config-validator/status/route";
import { GET as SETTINGS_GET, PATCH as SETTINGS_PATCH } from "@/app/api/tech-launch/incent-config-settings/route";

const filters = { appName: "stacksmash", startDate: "2026-08-10", endDate: "2026-08-19" };
const user = { id: "admin", role: "admin" };
function post(url: string, body: unknown) { return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

describe("Incent Config Validator API", () => {
  beforeEach(() => {
    mocks.requireCurrentAppUser.mockReset().mockResolvedValue(user);
    mocks.assertCanUseTechLaunch.mockReset().mockResolvedValue(undefined);
    mocks.canManageUsers.mockReset().mockReturnValue(true);
    mocks.techLaunchAppsForUser.mockReset().mockResolvedValue(["stacksmash"]);
    mocks.start.mockReset().mockResolvedValue({ status: "running", filters, metadata: { jobKey: "job", submittedAt: "2026-08-19T00:00:00Z" }, pollAfterMs: 1500 });
    mocks.status.mockReset().mockResolvedValue({ status: "completed", filters, checks: {}, densityPoints: [] });
    mocks.listConfigurations.mockReset().mockResolvedValue([{ appName: "stacksmash", mediaSources: ["freecash_int"], updatedAt: "", updatedBy: "system" }, { appName: "wordblast", mediaSources: ["other_int"], updatedAt: "", updatedBy: "system" }]);
    mocks.updateConfiguration.mockReset().mockResolvedValue({ appName: "stacksmash", mediaSources: ["freecash_int"], updatedAt: "", updatedBy: "admin" });
  });

  it("authorizes the selected app before starting and polling a validator query", async () => {
    expect((await POST(post("http://localhost/api/tech-launch/incent-config-validator", filters))).status).toBe(200);
    expect(mocks.assertCanUseTechLaunch).toHaveBeenCalledWith(user, "stacksmash");
    expect(mocks.start).toHaveBeenCalledWith(filters);
    expect((await STATUS_POST(post("http://localhost/api/tech-launch/incent-config-validator/status", { jobKey: "job", filters }))).status).toBe(200);
    expect(mocks.status).toHaveBeenCalledWith({ jobKey: "job", filters });
  });

  it("only returns configurations the requester can use", async () => {
    const response = await SETTINGS_GET(new Request("http://localhost/api/tech-launch/incent-config-settings"));
    expect(await response.json()).toEqual({ configurations: [expect.objectContaining({ appName: "stacksmash" })] });
  });

  it("rejects source configuration changes from non-admins", async () => {
    mocks.canManageUsers.mockReturnValue(false);
    const response = await SETTINGS_PATCH(new Request("http://localhost/api/tech-launch/incent-config-settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ appName: "stacksmash", mediaSources: ["freecash_int"] }) }));
    expect(response.status).toBe(403);
    expect(mocks.updateConfiguration).not.toHaveBeenCalled();
  });
});
