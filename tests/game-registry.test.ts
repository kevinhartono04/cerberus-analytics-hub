import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/games/route";
import { POST as grantPartner, DELETE as revokePartner } from "@/app/api/partner-access-domains/route";
import { registeredGames, gameAppId } from "@/lib/game-registry";
import { getAdjustEventsCheck } from "@/lib/adjust-events";
import { buildTechLaunchSql, buildTechLaunchAppVersionsSql } from "@/lib/tech-launch";
import { buildSpecCheckSql, buildSpecCheckAppVersionsSql } from "@/lib/spec-check";
import { buildLevelFailRateSql, buildDailyLevelFailRateSql, buildCriticalLevelFailRateSql } from "@/lib/gameplay-alerts";
import { buildGameMonitoringSql } from "@/lib/game-monitoring";
import { buildIncentConfigValidatorSql } from "@/lib/incent-config-validator";

const name = "registrytestgame";
const input = { name, appId: 990001, bundleId: "com.registrytest.game", adjustAndroid: "androidtesttoken", adjustIos: "iostesttoken" };
function request(method: string, role = "editor", body?: unknown, email = `${role}-registrytest@tripledotstudios.com`) {
  return new Request("http://localhost/api/games", { method, headers: { "Content-Type": "application/json", "x-test-user-id": `registrytest-${email}-${role}`, "x-test-user-email": email, "x-test-user-role": role }, body: body === undefined ? undefined : JSON.stringify(body) });
}
beforeAll(async () => {
  await registeredGames();
  execFileSync("sqlite3", ["-cmd", ".timeout 5000", path.join(process.cwd(), "data/analytics.sqlite"), "DELETE FROM game_registry WHERE name = 'registrytestgame'; DELETE FROM app_users WHERE id LIKE 'registrytest-%';"]);
});
afterAll(() => {
  execFileSync("sqlite3", ["-cmd", ".timeout 5000", path.join(process.cwd(), "data/analytics.sqlite"), "DELETE FROM game_registry WHERE name = 'registrytestgame'; DELETE FROM app_users WHERE id LIKE 'registrytest-%';"]);
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
describe("game registration", () => {
  it("denies viewers and external editors before changing configuration", async () => {
    expect((await POST(request("POST", "viewer", input))).status).toBe(403);
    expect((await POST(request("POST", "editor", input, "someone@partner.test"))).status).toBe(403);
    expect((await registeredGames()).some(game => game.name === name)).toBe(false);
  });
  it("validates IDs and bundle names, and rejects existing game IDs", async () => {
    expect((await POST(request("POST", "editor", { ...input, appId: 1.5 }))).status).toBe(400);
    expect((await POST(request("POST", "editor", { ...input, bundleId: "not-a-bundle" }))).status).toBe(400);
    expect((await POST(request("POST", "editor", { ...input, appId: 3015 }))).status).toBe(409);
  });
  it("lets an editor persist a game and exposes it without exposing app tokens", async () => {
    const response = await POST(request("POST", "editor", input));
    expect(response.status).toBe(201);
    expect(await gameAppId(name)).toBe(input.appId);
    const list = await GET(request("GET"));
    const body = await list.json();
    expect(body.games).toContainEqual(expect.objectContaining({ name, appId: input.appId, bundleId: input.bundleId, adjustAndroidConfigured: true, adjustIosConfigured: true }));
    expect(JSON.stringify(body)).not.toContain(input.adjustAndroid);
    expect(JSON.stringify(body)).not.toContain(input.adjustIos);
    expect((await POST(request("POST", "editor", input))).status).toBe(409);
  });
  it("builds every dashboard query using the newly persisted ID", async () => {
    const id = await gameAppId(name);
    const filters = { appName: name, platform: "android", platforms: ["android"], appVersion: "1.0.0", appVersions: ["1.0.0"], startDate: "2026-10-01", endDate: "2026-10-05", minLevel: 1, maxLevel: 100, specId: "test-spec" };
    const queries = [
      buildTechLaunchSql(filters, id), buildTechLaunchAppVersionsSql(filters, id),
      buildSpecCheckSql(filters, undefined, undefined, id), buildSpecCheckAppVersionsSql(filters, id),
      buildLevelFailRateSql(filters, undefined, id), buildDailyLevelFailRateSql(filters, undefined, id), buildCriticalLevelFailRateSql(filters, undefined, id),
      buildGameMonitoringSql(filters, id), buildIncentConfigValidatorSql(filters, { appName: name, mediaSources: ["testsource"], updatedAt: "", updatedBy: "test-editor" }, new Date("2026-10-05T12:00:00Z"), id),
    ];
    for (const sql of queries) { expect(sql).toMatch(/app_id\s*=\s*990001|990001 as app_id/); expect(sql).not.toContain("undefined"); }
    expect(queries[0]).toMatch(/app_id in \([^)]*990001\)/);
    expect(queries[1]).toMatch(/app_id in \([^)]*990001\)/);
  });
  it("grants a new game explicitly to a partner and can revoke the domain without an app list", async () => {
    const domain = "registrytestpartner.test";
    expect((await grantPartner(request("POST", "admin", { domain, expiresOn: "2099-01-01", allowedApps: [name] }))).status).toBe(200);
    const response = await GET(request("GET", "viewer", undefined, `person@${domain}`));
    const body = await response.json();
    expect(body.games.map((game: { name: string }) => game.name)).toEqual([name]);
    expect(body.canManage).toBe(false);
    expect(JSON.stringify(body)).not.toContain(input.adjustAndroid);
    expect((await revokePartner(request("DELETE", "admin", { domain }))).status).toBe(200);
  });
  it("uses persisted platform tokens without needing a new environment mapping", async () => {
    vi.stubEnv("ADJUST_API_TOKEN", "test-api-token"); vi.stubEnv("ADJUST_APP_TOKENS_JSON", "");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetchMock);
    await getAdjustEventsCheck({ appName: name, platform: "android" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("app_token__in=androidtesttoken");
  });
  it("rejects unknown games rather than generating undefined SQL", async () => {
    await expect(gameAppId("registryunknown")).rejects.toHaveProperty("status", 400);
    expect(() => buildTechLaunchSql({ appName: "registryunknown", platform: "android", appVersion: "1", startDate: "2026-10-01", endDate: "2026-10-05" })).toThrow("Unknown game");
  });
});
