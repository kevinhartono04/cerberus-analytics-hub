import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCache: vi.fn(),
  saveCache: vi.fn(),
  getCountQuery: vi.fn(),
  getGooglePlayVitals: vi.fn(),
  submitCountSql: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getTechLaunchReadinessCache: mocks.getCache, saveTechLaunchReadinessCache: mocks.saveCache }));
vi.mock("@/lib/count-api", () => ({ getCountQuery: mocks.getCountQuery, submitCountSql: mocks.submitCountSql }));
vi.mock("@/lib/google-play-reporting", () => ({
  getGooglePlayVitals: mocks.getGooglePlayVitals,
}));

const request = { appName: "hexago", platform: "android", appVersion: "1.0.0", startDate: "2026-06-25", endDate: "2026-07-02" };

describe("Google Play Tech Launch rows", () => {
  beforeEach(() => {
    mocks.getCache.mockReset().mockResolvedValue(null);
    mocks.saveCache.mockReset().mockResolvedValue(undefined);
    mocks.submitCountSql.mockReset().mockResolvedValue({ ok: true, query: { job_key: "count-job", status: "completed" } });
    mocks.getCountQuery.mockReset().mockResolvedValue({
      ok: true,
      query: {
        job_key: "count-job",
        status: "completed",
        result_preview: "name,metric_title,pct_of_sample,pct_of_sample_w_tolerance,p50_value,p80_value,benchmark,num_sample,verdict\nTelemetry_FPS_Average,FPS Average,0.9,0.9,60,55,50,100,green",
      },
    });
    mocks.getGooglePlayVitals.mockReset().mockResolvedValue({
      packageName: "com.tripledot.hexago",
      versionCodes: ["100"],
      crash: { value: 0.009, distinctUsers: 1000, latestDate: "2026-07-01" },
      anr: { value: 0.0055, distinctUsers: 1000, latestDate: "2026-07-01" },
      lmk: { value: 0.011, distinctUsers: 1000, latestDate: "2026-07-01" },
    });
  });

  it("adds user-perceived Vitals with direct thresholds", async () => {
    const { getTechLaunchReadiness } = await import("@/lib/tech-launch");
    const result = await getTechLaunchReadiness({ ...request, forceRefresh: true });
    if (result.status !== "completed") throw new Error("Expected completed response");

    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "GooglePlay_UserPerceivedCrashRate7d", verdict: "green", benchmark: 0.01, source: "google-play" }),
        expect.objectContaining({ name: "GooglePlay_UserPerceivedAnrRate7d", verdict: "yellow", benchmark: 0.005, source: "google-play" }),
        expect.objectContaining({ name: "GooglePlay_UserPerceivedLmkRate7d", verdict: "yellow", benchmark: 0.01, source: "google-play" }),
      ]),
    );
    expect(result.summary.totalSamples).toBe(100);
    expect(result.rows.some((row) => row.name === "GooglePlay_DownloadSize")).toBe(false);
  });

  it("skips Google Play for an iOS readiness request", async () => {
    const { getTechLaunchReadiness } = await import("@/lib/tech-launch");
    const result = await getTechLaunchReadiness({ ...request, platform: "ios", forceRefresh: true });
    if (result.status !== "completed") throw new Error("Expected completed response");

    expect(result.rows.some((row) => row.source === "google-play")).toBe(false);
    expect(mocks.getGooglePlayVitals).not.toHaveBeenCalled();
  });
});
