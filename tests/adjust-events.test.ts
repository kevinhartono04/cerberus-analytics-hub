import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdjustEventsConfigurationError, AdjustEventsProviderError, getAdjustEventsCheck } from "@/lib/adjust-events";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("Adjust Events Check", () => {
  beforeEach(() => {
    vi.stubEnv("ADJUST_API_TOKEN", "adjust-api-secret");
    vi.stubEnv("ADJUST_APP_TOKENS_JSON", JSON.stringify({ stacksmash: { android: "adjust-app-token", ios: "adjust-ios-token" } }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses a server-side app token and reports exact events plus discovered milestones", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      { id: "client_ad_revenue", name: "client_ad_revenue", app_token: ["adjust-app-token"] },
      { id: "iap_purchase", name: "iap_purchase", app_token: ["adjust-app-token"] },
      { id: "Session_Start", name: "Session_Start", app_token_x_event_tokens_mapping: { "adjust-app-token": ["event-token"] } },
      { id: "journey_level_won10", name: "Journey_Level_Won10", app_token: ["adjust-app-token"] },
      { id: "level-2", name: "Journey_Level_Won2", app_token: ["adjust-app-token"] },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAdjustEventsCheck({ appName: "stacksmash", platform: "android" });

    expect(result.overallStatus).toBe("pass");
    expect(result.checks.map((check) => check.status)).toEqual(["detected", "detected", "detected"]);
    expect(result.checks.map((check) => check.matches)).toEqual([
      [expect.objectContaining({ matchedValue: "client_ad_revenue" })],
      [expect.objectContaining({ matchedValue: "iap_purchase" })],
      [expect.objectContaining({ matchedValue: "Session_Start" })],
    ]);
    expect(result.journeyMilestones.nearMatches).toEqual([]);
    expect(result.journeyMilestones.milestones.map((milestone) => milestone.level)).toEqual([2, 10]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: expect.stringContaining("app_token__in=adjust-app-token") }),
      expect.objectContaining({ headers: { Authorization: "Bearer adjust-api-secret" }, cache: "no-store" }),
    );
    expect(JSON.stringify(result)).not.toContain("adjust-app-token");
    expect(JSON.stringify(result)).not.toContain("adjust-api-secret");
  });

  it("selects the configured token for the requested platform", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAdjustEventsCheck({ appName: "stacksmash", platform: "ios" });

    expect(result.platform).toBe("ios");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: expect.stringContaining("app_token__in=adjust-ios-token") }),
      expect.anything(),
    );
  });

  it("keeps case and separator variants as non-passing near matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([
      { name: "Client_Ad_Revenue", app_token: ["adjust-app-token"] },
      { name: "iap-purchase", app_token: ["adjust-app-token"] },
      { name: "session_start", app_token: ["adjust-app-token"] },
      { name: "journey-level-won10", app_token: ["adjust-app-token"] },
    ])));

    const result = await getAdjustEventsCheck({ appName: "stacksmash", platform: "android" });

    expect(result.overallStatus).toBe("fail");
    expect(result.checks[0]).toMatchObject({ status: "missing", nearMatches: [{ matchedValue: "Client_Ad_Revenue" }] });
    expect(result.checks[1]).toMatchObject({ status: "missing", nearMatches: [{ matchedValue: "iap-purchase" }] });
    expect(result.checks[2].status).toBe("detected");
    expect(result.journeyMilestones).toMatchObject({ status: "missing", nearMatches: [{ matchedValue: "journey-level-won10" }] });
  });

  it("does not count events explicitly associated with another Adjust app", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([
      { name: "client_ad_revenue", app_token: ["another-app"] },
      { name: "iap_purchase", app_token: ["another-app"] },
      { name: "session_start", app_token: ["another-app"] },
      { name: "Journey_Level_Won1", app_token: ["another-app"] },
    ])));

    const result = await getAdjustEventsCheck({ appName: "stacksmash", platform: "android" });

    expect(result.overallStatus).toBe("fail");
    expect(result.checks.every((check) => check.status === "missing")).toBe(true);
    expect(result.journeyMilestones.status).toBe("missing");
  });

  it("treats Adjust's empty 204 response as a completed missing-events check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    const result = await getAdjustEventsCheck({ appName: "stacksmash", platform: "android" });

    expect(result.overallStatus).toBe("fail");
    expect(result.checks.every((check) => check.status === "missing")).toBe(true);
    expect(result.journeyMilestones.status).toBe("missing");
  });

  it("retries a transient Adjust failure once", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Busy" }, 503))
      .mockResolvedValueOnce(jsonResponse([
        { name: "client_ad_revenue", app_token: ["adjust-app-token"] },
        { name: "iap_purchase", app_token: ["adjust-app-token"] },
        { name: "session_start", app_token: ["adjust-app-token"] },
        { name: "Journey_Level_Won1", app_token: ["adjust-app-token"] },
      ]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAdjustEventsCheck({ appName: "stacksmash", platform: "android" })).resolves.toMatchObject({ overallStatus: "pass" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when configuration is incomplete or the provider response is invalid", async () => {
    vi.stubEnv("ADJUST_APP_TOKENS_JSON", "not-json");
    await expect(getAdjustEventsCheck({ appName: "stacksmash", platform: "android" })).rejects.toBeInstanceOf(AdjustEventsConfigurationError);

    vi.stubEnv("ADJUST_APP_TOKENS_JSON", JSON.stringify({ stacksmash: { android: "adjust-app-token" } }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ events: [] })));
    await expect(getAdjustEventsCheck({ appName: "stacksmash", platform: "android" })).rejects.toBeInstanceOf(AdjustEventsProviderError);
  });
});
