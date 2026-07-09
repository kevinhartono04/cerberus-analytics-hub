import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeSpec } from "./helpers/spec-check-fixtures";

const mocks = vi.hoisted(() => ({
  cacheRecords: new Map<string, { cacheKey: string; payload: string; createdAt: string; expiresAt: string }>(),
  getCache: vi.fn(),
  saveCache: vi.fn(),
  getSavedSpec: vi.fn(),
  getSavedSpecSummary: vi.fn(),
  submitCountSql: vi.fn(),
  getCountQuery: vi.fn(),
  runCountSql: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getTechLaunchReadinessCache: mocks.getCache,
  saveTechLaunchReadinessCache: mocks.saveCache,
  getSavedSpec: mocks.getSavedSpec,
  getSavedSpecSummary: mocks.getSavedSpecSummary,
}));

vi.mock("@/lib/count-api", () => ({
  submitCountSql: mocks.submitCountSql,
  getCountQuery: mocks.getCountQuery,
  runCountSql: mocks.runCountSql,
}));

const request = {
  specId: "spec-1",
  appName: "bloomsort",
  platform: "all",
  appVersion: "0.04.13",
  startDate: "2026-07-01",
  endDate: "2026-07-07",
} as const;

const auditCsv = [
  "row_type,event_name,event_name_norm,payload_name,payload_name_norm,observed_type,event_count,payload_count,distinct_value_count,first_seen,last_seen,max_length,example_values,enum_value_counts,enum_value_rank_count",
  "event,level_start,levelstart,,,,120,,,2026-07-01,2026-07-07,,,,",
  "payload,level_start,levelstart,level,level,integer,118,118,42,2026-07-01,2026-07-07,3,1 | 2 | 3,,",
].join("\n");

function summaryFor(updatedAt: string) {
  return {
    id: "spec-1",
    gameTitle: "Fixture Game",
    genre: "Puzzle",
    status: "Draft",
    eventCount: 1,
    payloadCount: 1,
    generatedAt: "2026-07-01T00:00:00.000Z",
    savedAt: "2026-07-01T00:00:00.000Z",
    updatedAt,
  };
}

describe("Spec Check flow and cache", () => {
  beforeEach(() => {
    mocks.cacheRecords.clear();
    mocks.getCache.mockReset().mockImplementation(async (key: string) => mocks.cacheRecords.get(key) ?? null);
    mocks.saveCache.mockReset().mockImplementation(async (record: { cacheKey: string; payload: string; createdAt: string; expiresAt: string }) => {
      mocks.cacheRecords.set(record.cacheKey, record);
    });
    mocks.getSavedSpec.mockReset().mockResolvedValue(makeSpec());
    mocks.getSavedSpecSummary.mockReset().mockResolvedValue(summaryFor("2026-07-02T00:00:00.000Z"));
    mocks.submitCountSql.mockReset().mockResolvedValue({
      ok: true,
      query: { job_key: "job_123", status: "completed" },
    });
    mocks.getCountQuery.mockReset().mockResolvedValue({
      ok: true,
      query: {
        job_key: "job_123",
        status: "completed",
        result_preview: auditCsv,
        result_metadata: { duration: 900, num_rows: 2 },
      },
    });
    mocks.runCountSql.mockReset();
  });

  it("runs the check, caches under a spec-check key, and serves the cache on re-run", async () => {
    const { getSpecCheck } = await import("@/lib/spec-check");
    const fresh = await getSpecCheck(request);

    expect(fresh.status).toBe("completed");
    expect(fresh.cache.hit).toBe(false);
    expect(fresh.cache.key.startsWith("spec-check:")).toBe(true);
    if (fresh.status === "completed") {
      expect(fresh.report.summary.verdict).toBe("pass");
      expect(fresh.spec).toMatchObject({ id: "spec-1", gameTitle: "Fixture Game" });
    }
    expect(mocks.submitCountSql).toHaveBeenCalledTimes(1);
    expect(mocks.saveCache).toHaveBeenCalledTimes(1);

    const cached = await getSpecCheck(request);
    expect(cached.status).toBe("completed");
    expect(cached.cache.hit).toBe(true);
    expect(mocks.submitCountSql).toHaveBeenCalledTimes(1);
  });

  it("misses the cache when the spec has been updated", async () => {
    const { getSpecCheck } = await import("@/lib/spec-check");
    await getSpecCheck(request);
    expect(mocks.submitCountSql).toHaveBeenCalledTimes(1);

    mocks.getSavedSpecSummary.mockResolvedValue(summaryFor("2026-07-05T12:00:00.000Z"));
    const rerun = await getSpecCheck(request);
    expect(rerun.cache.hit).toBe(false);
    expect(mocks.submitCountSql).toHaveBeenCalledTimes(2);
  });

  it("bypasses the cache with forceRefresh and uses the force cache strategy", async () => {
    const { getSpecCheck } = await import("@/lib/spec-check");
    await getSpecCheck(request);
    await getSpecCheck({ ...request, forceRefresh: true });

    expect(mocks.submitCountSql).toHaveBeenCalledTimes(2);
    expect(mocks.submitCountSql).toHaveBeenLastCalledWith(expect.any(String), { cacheStrategy: "force" });
  });

  it("returns pending while Count runs, then completes via the status flow", async () => {
    const { getSpecCheck, getSpecCheckStatus } = await import("@/lib/spec-check");
    mocks.submitCountSql.mockResolvedValueOnce({
      ok: true,
      query: { job_key: "job_running", status: "running" },
    });

    const pending = await getSpecCheck(request);
    expect(pending).toMatchObject({
      status: "running",
      metadata: { jobKey: "job_running" },
      pollAfterMs: 1500,
    });
    expect(mocks.getCountQuery).not.toHaveBeenCalled();

    const completed = await getSpecCheckStatus({ jobKey: "job_running", filters: request });
    expect(completed.status).toBe("completed");
    expect(mocks.getCountQuery).toHaveBeenCalledTimes(1);
    expect(mocks.saveCache).toHaveBeenCalledTimes(1);
  });

  it("bypasses stale cache during force-refresh status polling", async () => {
    const { getSpecCheck, getSpecCheckStatus } = await import("@/lib/spec-check");
    await getSpecCheck(request);
    expect(mocks.submitCountSql).toHaveBeenCalledTimes(1);

    mocks.submitCountSql.mockResolvedValueOnce({
      ok: true,
      query: { job_key: "job_force_running", status: "running" },
    });
    const pending = await getSpecCheck({ ...request, forceRefresh: true });
    expect(pending).toMatchObject({
      status: "running",
      metadata: { jobKey: "job_force_running" },
    });

    const completed = await getSpecCheckStatus({ jobKey: "job_force_running", filters: request, forceRefresh: true });
    expect(completed.status).toBe("completed");
    expect(completed.cache.hit).toBe(false);
    expect(mocks.getCountQuery).toHaveBeenCalledWith("job_force_running", 1000);
    expect(mocks.submitCountSql).toHaveBeenCalledTimes(2);
  });

  it("builds the audit SQL with the spec's enum field extensions", async () => {
    const { getSpecCheck } = await import("@/lib/spec-check");
    mocks.getSavedSpec.mockResolvedValue(
      makeSpec({
        generatedEvents: [
          {
            ...makeSpec().generatedEvents[0],
            payloadFields: [
              {
                fieldName: "type",
                canonicalFieldName: "source",
                type: "String",
                requiredness: "Required",
                description: "",
                example: '"game_end"',
                notes: "",
              },
            ],
          },
        ],
      }),
    );
    await getSpecCheck(request);
    const sql = mocks.submitCountSql.mock.calls[0][0] as string;
    expect(sql).toContain("'type'");
    expect(sql).toContain("3003 as app_id");
  });

  it("throws a 404 response for an unknown spec", async () => {
    const { getSpecCheck } = await import("@/lib/spec-check");
    mocks.getSavedSpec.mockResolvedValue(null);
    mocks.getSavedSpecSummary.mockResolvedValue(null);

    await expect(getSpecCheck(request)).rejects.toSatisfy((thrown: unknown) => {
      return thrown instanceof Response && thrown.status === 404;
    });
    expect(mocks.submitCountSql).not.toHaveBeenCalled();
  });

  it("caches app versions under a prefixed key", async () => {
    const { getSpecCheckAppVersions } = await import("@/lib/spec-check");
    mocks.runCountSql.mockResolvedValue({
      ok: true,
      query: {
        job_key: "job_versions",
        status: "completed",
        result_preview: ["app_version,sample_count,first_seen,last_seen", "0.04.13,1200,2026-07-01,2026-07-07"].join("\n"),
        result_metadata: { duration: 300, num_rows: 1 },
      },
    });

    const filters = { appName: "bloomsort", platform: "all", startDate: "2026-07-01", endDate: "2026-07-07" } as const;
    const fresh = await getSpecCheckAppVersions(filters);
    expect(fresh.cache.hit).toBe(false);
    expect(fresh.cache.key.startsWith("spec-check:app-versions:")).toBe(true);
    expect(fresh.versions[0]).toMatchObject({ appVersion: "0.04.13", sampleCount: 1200 });

    const cached = await getSpecCheckAppVersions(filters);
    expect(cached.cache.hit).toBe(true);
    expect(mocks.runCountSql).toHaveBeenCalledTimes(1);
  });
});
