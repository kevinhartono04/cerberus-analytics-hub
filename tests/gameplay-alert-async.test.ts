import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  listStates: vi.fn(),
  submit: vi.fn(),
  getQuery: vi.fn(),
  run: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getGameplayAlertSettingsRecord: mocks.getSettings,
  listGameplayAlertStates: mocks.listStates,
  saveGameplayAlertSettingsRecord: vi.fn(),
  saveGameplayAlertStateRecords: vi.fn(),
  saveGameplayAlertEvaluationRun: vi.fn(),
  markGameplayAlertSlackDelivered: vi.fn(),
}));

vi.mock("@/lib/count-api", () => ({
  submitCountSql: mocks.submit,
  getCountQuery: mocks.getQuery,
  runCountSql: mocks.run,
}));

import { getLevelFailRateStatus, startLevelFailRate } from "@/lib/gameplay-alerts";

const filters = { appName: "stacksmash", platforms: ["android"] as const, appVersions: ["0.2.0"], startDate: "2026-07-22", endDate: "2026-07-28" };
const preview = [
  "level,layout_bank_id,difficulty_tier,used_difficulty_fallback,reached_players,failed_players,fail_rate,layout_share,layout_coverage,layout_age_hours,layout_is_stable",
  "10,bank-a,normal,false,100,60,0.6,1,1,48,true",
].join("\n");

describe("asynchronous level funnel Count polling", () => {
  beforeEach(() => {
    mocks.getSettings.mockReset().mockResolvedValue(null);
    mocks.listStates.mockReset().mockResolvedValue([]);
    mocks.submit.mockReset().mockResolvedValue({ ok: true, query: { job_key: "level-job", status: "running" } });
    mocks.getQuery.mockReset();
    mocks.run.mockReset();
  });

  it("returns quickly after submission and completes through the status endpoint", async () => {
    const started = await startLevelFailRate({ ...filters, forceRefresh: true });

    expect(started).toMatchObject({ status: "running", metadata: { jobKey: "level-job" }, pollAfterMs: 1500 });
    expect(mocks.submit).toHaveBeenCalledWith(expect.any(String), { cacheStrategy: "force" });
    expect(mocks.getQuery).not.toHaveBeenCalled();

    mocks.getQuery.mockResolvedValueOnce({ ok: true, query: { job_key: "level-job", status: "completed", result_preview: preview, result_metadata: { duration: 62_000 } } });
    const completed = await getLevelFailRateStatus({ jobKey: "level-job", filters });

    expect(completed).toMatchObject({ status: "completed", summary: { breachCount: 1 }, metadata: { durationMs: 62_000 } });
    expect(mocks.getQuery).toHaveBeenCalledWith("level-job", 1000);
  });

  it("uses Count's force strategy only for Refresh", async () => {
    await startLevelFailRate(filters);
    expect(mocks.submit).toHaveBeenLastCalledWith(expect.any(String), { cacheStrategy: "default" });

    await startLevelFailRate({ ...filters, forceRefresh: true });
    expect(mocks.submit).toHaveBeenLastCalledWith(expect.any(String), { cacheStrategy: "force" });
  });
});
