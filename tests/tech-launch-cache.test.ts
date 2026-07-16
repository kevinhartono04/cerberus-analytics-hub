import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheRecord: null as null | { cacheKey: string; payload: string; createdAt: string; expiresAt: string },
  getCache: vi.fn(),
  saveCache: vi.fn(),
  submitCountSql: vi.fn(),
  getCountQuery: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getTechLaunchReadinessCache: mocks.getCache,
  saveTechLaunchReadinessCache: mocks.saveCache,
}));

vi.mock("@/lib/count-api", () => ({
  submitCountSql: mocks.submitCountSql,
  getCountQuery: mocks.getCountQuery,
}));

const request = {
  appName: "wordblast",
  platform: "android",
  appVersion: "1.0.0",
  startDate: "2026-06-25",
  endDate: "2026-07-02",
} as const;

describe("Tech Launch readiness cache", () => {
  beforeEach(() => {
    mocks.cacheRecord = null;
    mocks.getCache.mockReset().mockImplementation(async () => mocks.cacheRecord);
    mocks.saveCache.mockReset().mockImplementation(async (record) => {
      mocks.cacheRecord = record;
    });
    mocks.submitCountSql.mockReset().mockResolvedValue({
      ok: true,
      query: {
        job_key: "job_123",
        status: "completed",
      },
    });
    mocks.getCountQuery.mockReset().mockResolvedValue({
      ok: true,
      query: {
        job_key: "job_123",
        status: "completed",
        result_preview: [
          "name,metric_title,pct_of_sample,pct_of_sample_w_tolerance,p50_value,p80_value,benchmark,num_sample,verdict",
          "Telemetry_FPS_Average,FPS Average,0.83,0.91,54,48,50,120,green",
        ].join("\n"),
        result_metadata: { duration: 1200, num_rows: 1 },
      },
    });
  });

  it("serves a warm unexpired cache entry without rerunning Count", async () => {
    const { getTechLaunchReadiness } = await import("@/lib/tech-launch");
    const fresh = await getTechLaunchReadiness(request);

    expect(fresh.status).toBe("completed");
    expect(fresh.cache.hit).toBe(false);
    expect(mocks.submitCountSql).toHaveBeenCalledTimes(1);
    expect(mocks.getCountQuery).toHaveBeenCalledTimes(1);

    const cached = await getTechLaunchReadiness(request);

    expect(cached.status).toBe("completed");
    expect(cached.cache.hit).toBe(true);
    expect(cached.status === "completed" ? cached.rows[0]?.metricTitle : "").toBe("FPS Average");
    expect(mocks.submitCountSql).toHaveBeenCalledTimes(1);
    expect(mocks.getCountQuery).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache when forceRefresh is true", async () => {
    const { getTechLaunchReadiness } = await import("@/lib/tech-launch");
    await getTechLaunchReadiness(request);
    await getTechLaunchReadiness({ ...request, forceRefresh: true });

    expect(mocks.submitCountSql).toHaveBeenCalledTimes(2);
    expect(mocks.submitCountSql).toHaveBeenLastCalledWith(expect.any(String), {
      cacheStrategy: "force",
    });
  });

  it("ignores expired cache entries", async () => {
    const { getTechLaunchReadiness, techLaunchCacheKey } = await import("@/lib/tech-launch");
    mocks.cacheRecord = {
      cacheKey: techLaunchCacheKey(request),
      payload: JSON.stringify({
        filters: request,
        rows: [],
        summary: {
          overallVerdict: "insufficient data",
          metricCount: 0,
          greenCount: 0,
          yellowCount: 0,
          redCount: 0,
          insufficientCount: 0,
          totalSamples: 0,
        },
        metadata: { executedAt: "2026-06-25T00:00:00.000Z" },
        cache: {
          hit: false,
          key: techLaunchCacheKey(request),
          expiresAt: "2026-06-25T00:00:00.000Z",
        },
      }),
      createdAt: "2026-06-25T00:00:00.000Z",
      expiresAt: "2026-06-25T00:00:00.000Z",
    };

    const response = await getTechLaunchReadiness(request);

    expect(response.cache.hit).toBe(false);
    expect(mocks.submitCountSql).toHaveBeenCalledTimes(1);
  });

  it("returns a pending response while Count is still running", async () => {
    const { getTechLaunchReadiness } = await import("@/lib/tech-launch");
    mocks.submitCountSql.mockResolvedValueOnce({
      ok: true,
      query: {
        job_key: "job_running",
        status: "running",
      },
    });

    const response = await getTechLaunchReadiness({ ...request, forceRefresh: true });

    expect(response).toMatchObject({
      status: "running",
      metadata: { jobKey: "job_running" },
      pollAfterMs: 1500,
    });
    expect(mocks.getCountQuery).not.toHaveBeenCalled();
  });

  it("bypasses the stale cache while a forced refresh is polling", async () => {
    const { getTechLaunchReadiness, getTechLaunchReadinessStatus } = await import("@/lib/tech-launch");
    await getTechLaunchReadiness(request);

    mocks.submitCountSql.mockResolvedValueOnce({
      ok: true,
      query: { job_key: "job_force_running", status: "running" },
    });
    const pending = await getTechLaunchReadiness({ ...request, forceRefresh: true });
    expect(pending).toMatchObject({ status: "running", metadata: { jobKey: "job_force_running" } });

    const completed = await getTechLaunchReadinessStatus({
      jobKey: "job_force_running",
      filters: request,
      forceRefresh: true,
    });
    expect(completed.status).toBe("completed");
    expect(completed.cache.hit).toBe(false);
    expect(mocks.getCountQuery).toHaveBeenCalledWith("job_force_running", 1000);
  });
});
