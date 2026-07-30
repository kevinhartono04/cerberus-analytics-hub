import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  cronFilters: vi.fn(),
  evaluationKey: vi.fn(),
  reconcile: vi.fn(),
  undelivered: vi.fn(),
  deliver: vi.fn(),
  buildSql: vi.fn(),
  listJobs: vi.fn(),
  saveJobs: vi.fn(),
  submit: vi.fn(),
  getQuery: vi.fn(),
}));

vi.mock("@/lib/gameplay-alerts", () => ({
  getGameplayAlertSettings: mocks.getSettings,
  gameplayAlertCronFilters: mocks.cronFilters,
  gameplayAlertEvaluationKey: mocks.evaluationKey,
  reconcileGameplayAlertsFromQuery: mocks.reconcile,
  undeliveredGameplayAlertTransitions: mocks.undelivered,
  deliverGameplayAlertTransitions: mocks.deliver,
  buildLevelFailRateSql: mocks.buildSql,
}));
vi.mock("@/lib/db", () => ({ listGameplayAlertQueryJobs: mocks.listJobs, saveGameplayAlertQueryJobRecords: mocks.saveJobs }));
vi.mock("@/lib/count-api", () => ({ submitCountSql: mocks.submit, getCountQuery: mocks.getQuery }));

import { GET } from "@/app/api/cron/gameplay-alerts/route";

const filters = { appName: "stacksmash", platform: "android", appVersion: "0.2.0", startDate: "2026-07-22", endDate: "2026-07-28" };

describe("gameplay alert cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    mocks.getSettings.mockReset().mockResolvedValue({});
    mocks.cronFilters.mockReset().mockReturnValue([filters]);
    mocks.evaluationKey.mockReset().mockReturnValue("stacksmash:android:0.2.0:2026-07-22:2026-07-28");
    mocks.buildSql.mockReset().mockReturnValue("select 1");
    mocks.listJobs.mockReset().mockResolvedValue([]);
    mocks.saveJobs.mockReset().mockResolvedValue(undefined);
    mocks.submit.mockReset().mockResolvedValue({ query: { job_key: "count-job", status: "running" } });
    mocks.getQuery.mockReset();
    mocks.reconcile.mockReset().mockResolvedValue({ transitions: [] });
    mocks.undelivered.mockReset().mockResolvedValue([]);
    mocks.deliver.mockReset().mockResolvedValue({ delivered: 0, skipped: 0, configured: true });
  });

  it("submits an asynchronous Count job without waiting for completion", async () => {
    const response = await GET(new Request("https://example.com/api/cron/gameplay-alerts", { headers: { authorization: "Bearer test-secret" } }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ targetCount: 1, submittedCount: 1, completedCount: 0, runningCount: 1, failures: [] });
    expect(mocks.getQuery).not.toHaveBeenCalled();
    expect(mocks.saveJobs).toHaveBeenCalledWith([expect.objectContaining({ jobKey: "count-job", status: "running" })]);
  });

  it("polls a saved job and reconciles it only after Count completes", async () => {
    mocks.listJobs.mockResolvedValue([{ evaluationKey: "stacksmash:android:0.2.0:2026-07-22:2026-07-28", jobKey: "count-job", filters: JSON.stringify(filters), status: "running", submittedAt: "2026-07-29T00:00:00.000Z" }]);
    mocks.getQuery.mockResolvedValue({ query: { job_key: "count-job", status: "completed", result_preview: "", result_metadata: {} } });

    const response = await GET(new Request("https://example.com/api/cron/gameplay-alerts", { headers: { authorization: "Bearer test-secret" } }));

    expect(await response.json()).toMatchObject({ targetCount: 1, submittedCount: 0, completedCount: 1, runningCount: 0, failures: [] });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.reconcile).toHaveBeenCalledWith(filters, expect.objectContaining({ job_key: "count-job", status: "completed" }));
    expect(mocks.saveJobs).toHaveBeenCalledWith([expect.objectContaining({ jobKey: "count-job", status: "completed" })]);
  });
});
