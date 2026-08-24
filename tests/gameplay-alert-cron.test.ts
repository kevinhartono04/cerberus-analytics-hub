import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  cronFilters: vi.fn(),
  evaluationKey: vi.fn(),
  criticalEvaluationKey: vi.fn(),
  reconcile: vi.fn(),
  reconcileCritical: vi.fn(),
  openStates: vi.fn(),
  undelivered: vi.fn(),
  deliver: vi.fn(),
  buildSql: vi.fn(),
  buildDailySql: vi.fn(),
  dailyTransitions: vi.fn(),
  buildCriticalSql: vi.fn(),
  listJobs: vi.fn(),
  saveJobs: vi.fn(),
  markStatusDelivered: vi.fn(),
  submit: vi.fn(),
  getQuery: vi.fn(),
  adMetricKey: vi.fn(),
  buildAdMetricSql: vi.fn(),
  reconcileAdMetrics: vi.fn(),
  undeliveredAdMetrics: vi.fn(),
  deliverAdMetrics: vi.fn(),
  adMetricCronWindow: vi.fn(),
}));

vi.mock("@/lib/gameplay-alerts", () => ({
  gameplayAlertTimeZone: "Australia/Melbourne",
  getGameplayAlertSettings: mocks.getSettings,
  gameplayAlertCronFilters: mocks.cronFilters,
  gameplayAlertEvaluationKey: mocks.evaluationKey,
  criticalGameplayAlertEvaluationKey: mocks.criticalEvaluationKey,
  reconcileGameplayAlertsFromQuery: mocks.reconcile,
  reconcileCriticalGameplayAlertsFromQuery: mocks.reconcileCritical,
  openGameplayAlertStates: mocks.openStates,
  undeliveredGameplayAlertTransitions: mocks.undelivered,
  deliverGameplayAlertTransitions: mocks.deliver,
  buildLevelFailRateSql: mocks.buildSql,
  buildDailyLevelFailRateSql: mocks.buildDailySql,
  dailyFlaggedGameplayAlertTransitionsFromQuery: mocks.dailyTransitions,
  buildCriticalLevelFailRateSql: mocks.buildCriticalSql,
}));
vi.mock("@/lib/db", () => ({ listGameplayAlertQueryJobs: mocks.listJobs, saveGameplayAlertQueryJobRecords: mocks.saveJobs, markGameplayAlertQueryJobsSlackStatusDelivered: mocks.markStatusDelivered }));
vi.mock("@/lib/count-api", () => ({ submitCountSql: mocks.submit, getCountQuery: mocks.getQuery }));
vi.mock("@/lib/ad-metric-alerts", () => ({
  adMetricAlertEvaluationKey: mocks.adMetricKey,
  buildAdMetricAlertSql: mocks.buildAdMetricSql,
  reconcileAdMetricAlertsFromQuery: mocks.reconcileAdMetrics,
  undeliveredAdMetricAlertTransitions: mocks.undeliveredAdMetrics,
  deliverAdMetricAlertTransitions: mocks.deliverAdMetrics,
  isAdMetricAlertCronWindow: mocks.adMetricCronWindow,
}));

import { GET } from "@/app/api/cron/gameplay-alerts/route";
import { isGameplayAlertCronWindow } from "@/lib/gameplay-alert-cron-window";

const filters = { appName: "stacksmash", platform: "android", platforms: ["android"], appVersion: "0.2.0", appVersions: ["0.2.0"], startDate: "2026-07-22", endDate: "2026-07-28" };

describe("gameplay alert cron", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    mocks.getSettings.mockReset().mockResolvedValue({});
    mocks.cronFilters.mockReset().mockReturnValue([filters]);
    mocks.evaluationKey.mockReset().mockReturnValue("stacksmash:android:0.2.0:2026-07-22:2026-07-28");
    mocks.criticalEvaluationKey.mockReset().mockReturnValue("critical:stacksmash:android:0.2.0");
    mocks.buildSql.mockReset().mockReturnValue("select 1");
    mocks.buildDailySql.mockReset().mockReturnValue("select daily");
    mocks.dailyTransitions.mockReset().mockResolvedValue({ transitions: [] });
    mocks.buildCriticalSql.mockReset().mockReturnValue("select critical");
    mocks.adMetricKey.mockReset().mockReturnValue("ad-metrics:stacksmash:android:0.2.0:2026-07-28");
    mocks.buildAdMetricSql.mockReset().mockReturnValue("select ad metrics");
    mocks.reconcileAdMetrics.mockReset().mockResolvedValue({ transitions: [] });
    mocks.undeliveredAdMetrics.mockReset().mockResolvedValue([]);
    mocks.deliverAdMetrics.mockReset().mockResolvedValue({ delivered: 0, skipped: 0, configured: true });
    mocks.adMetricCronWindow.mockReset().mockReturnValue(true);
    mocks.listJobs.mockReset().mockResolvedValue([]);
    mocks.saveJobs.mockReset().mockResolvedValue(undefined);
    mocks.markStatusDelivered.mockReset().mockResolvedValue(undefined);
    mocks.submit.mockReset().mockResolvedValue({ query: { job_key: "count-job", status: "running" } });
    mocks.getQuery.mockReset();
    mocks.reconcile.mockReset().mockResolvedValue({ transitions: [] });
    mocks.reconcileCritical.mockReset().mockResolvedValue({ transitions: [] });
    mocks.openStates.mockReset().mockResolvedValue([]);
    mocks.undelivered.mockReset().mockResolvedValue([]);
    mocks.deliver.mockReset().mockResolvedValue({ delivered: 0, skipped: 0, configured: true });
  });

  it("submits an asynchronous Count job without waiting for completion", async () => {
    const response = await GET(new Request("https://example.com/api/cron/gameplay-alerts?force=1", { headers: { authorization: "Bearer test-secret" } }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ targetCount: 1, submittedCount: 1, completedCount: 0, runningCount: 1, criticalSubmittedCount: 1, criticalRunningCount: 1, failures: [] });
    expect(mocks.getQuery).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledWith("select daily", { cacheStrategy: "force" });
    expect(mocks.saveJobs).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ jobKey: "count-job", status: "running" })]));
  });

  it("polls a saved job and reports only its flagged rows after Count completes", async () => {
    mocks.listJobs.mockResolvedValue([{ evaluationKey: "stacksmash:android:0.2.0:2026-07-22:2026-07-28", jobKey: "count-job", filters: JSON.stringify(filters), status: "running", submittedAt: "2026-07-29T00:00:00.000Z" }]);
    mocks.getQuery.mockResolvedValue({ query: { job_key: "count-job", status: "completed", result_preview: "", result_metadata: {} } });

    const response = await GET(new Request("https://example.com/api/cron/gameplay-alerts?force=1", { headers: { authorization: "Bearer test-secret" } }));

    expect(await response.json()).toMatchObject({ targetCount: 1, submittedCount: 0, completedCount: 1, runningCount: 0, failures: [] });
    expect(mocks.submit).toHaveBeenCalledWith("select critical", { cacheStrategy: "force" });
    expect(mocks.dailyTransitions).toHaveBeenCalledWith(filters, expect.objectContaining({ job_key: "count-job", status: "completed" }), { appName: "stacksmash", platforms: ["android"], appVersions: ["0.2.0"], startDate: "2026-07-22", endDate: "2026-07-28" });
    expect(mocks.saveJobs).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ jobKey: "count-job", status: "completed" })]));
    expect(mocks.markStatusDelivered).toHaveBeenCalledWith(["stacksmash:android:0.2.0:2026-07-22:2026-07-28"], expect.any(String));
  });

  it("polls the current daily job after the morning submission window has closed", async () => {
    // 10:00 AEST: no new daily query may be started, but a 09:00 query must
    // still be collected and delivered once Count has completed it.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T00:00:00.000Z"));
    mocks.listJobs.mockResolvedValue([{ evaluationKey: "stacksmash:android:0.2.0:2026-07-22:2026-07-28", jobKey: "count-job", filters: JSON.stringify(filters), status: "running", submittedAt: "2026-08-03T23:00:00.000Z" }]);
    mocks.getQuery.mockResolvedValue({ query: { job_key: "count-job", status: "completed", result_preview: "", result_metadata: {} } });

    const response = await GET(new Request("https://example.com/api/cron/gameplay-alerts", { headers: { authorization: "Bearer test-secret" } }));

    expect(await response.json()).toMatchObject({ dailySkipped: true, submittedCount: 0, completedCount: 1, runningCount: 0, failures: [] });
    expect(mocks.dailyTransitions).toHaveBeenCalledWith(filters, expect.objectContaining({ job_key: "count-job", status: "completed" }), expect.any(Object));
    expect(mocks.markStatusDelivered).toHaveBeenCalledWith(["stacksmash:android:0.2.0:2026-07-22:2026-07-28"], expect.any(String));
  });

  it("posts only the flagged rows from the completed daily evaluation", async () => {
    mocks.listJobs.mockResolvedValue([{ evaluationKey: "stacksmash:android:0.2.0:2026-07-22:2026-07-28", jobKey: "count-job", filters: JSON.stringify(filters), status: "completed", submittedAt: "2026-07-29T00:00:00.000Z" }]);
    mocks.getQuery.mockResolvedValue({ query: { job_key: "count-job", status: "completed", result_preview: "", result_metadata: {} } });
    mocks.dailyTransitions.mockResolvedValue({ transitions: [{ type: "daily-open", state: { alertKey: "open-240", status: "open", appName: "stacksmash", platform: "android", appVersion: "0.2.0", level: 240, difficultyTier: "normal", firstSeenAt: "2026-07-22T00:00:00.000Z", lastSeenAt: "2026-07-28T00:00:00.000Z", lastFailRate: 0.404, lastReachedPlayers: 23_400, threshold: 0.4 } }] });

    const response = await GET(new Request("https://example.com/api/cron/gameplay-alerts?force=1", { headers: { authorization: "Bearer test-secret" } }));

    expect(await response.json()).toMatchObject({ runningCount: 0, dailyOpenDeliveryCount: 1, failures: [], evaluations: [expect.objectContaining({ reusedCompletedJob: true, report: "flagged_levels_only" })] });
    expect(mocks.deliver).toHaveBeenCalledWith([expect.objectContaining({ type: "daily-open", state: expect.objectContaining({ alertKey: "open-240", level: 240 }), queryTrace: { jobKey: "count-job", sql: "select daily" } })]);
    expect(mocks.markStatusDelivered).toHaveBeenCalledWith(["stacksmash:android:0.2.0:2026-07-22:2026-07-28"], expect.any(String));
  });

  it("leaves the daily status eligible for retry when Slack is not configured", async () => {
    mocks.listJobs.mockResolvedValue([{ evaluationKey: "stacksmash:android:0.2.0:2026-07-22:2026-07-28", jobKey: "count-job", filters: JSON.stringify(filters), status: "completed", submittedAt: "2026-07-29T00:00:00.000Z" }]);
    mocks.getQuery.mockResolvedValue({ query: { job_key: "count-job", status: "completed", result_preview: "", result_metadata: {} } });
    mocks.dailyTransitions.mockResolvedValue({ transitions: [{ type: "daily-open", state: { alertKey: "open-240", status: "open", appName: "stacksmash", platform: "android", appVersion: "0.2.0", level: 240, difficultyTier: "normal", firstSeenAt: "2026-07-22T00:00:00.000Z", lastSeenAt: "2026-07-28T00:00:00.000Z", lastFailRate: 0.404, lastReachedPlayers: 23_400, threshold: 0.4 } }] });
    mocks.deliver.mockResolvedValue({ delivered: 0, skipped: 1, configured: false });
    mocks.deliverAdMetrics.mockResolvedValue({ delivered: 0, skipped: 0, configured: false });

    const response = await GET(new Request("https://example.com/api/cron/gameplay-alerts?force=1", { headers: { authorization: "Bearer test-secret" } }));

    expect(await response.json()).toMatchObject({ dailyOpenDeliveryCount: 1, delivery: { configured: false }, failures: [] });
    expect(mocks.markStatusDelivered).not.toHaveBeenCalled();
  });

  it("runs only during the intended Melbourne morning window", () => {
    // 08:30 AEST and 08:30 AEDT respectively.
    expect(isGameplayAlertCronWindow(new Date("2026-08-04T22:30:00.000Z"))).toBe(true);
    expect(isGameplayAlertCronWindow(new Date("2026-12-01T21:30:00.000Z"))).toBe(true);
    expect(isGameplayAlertCronWindow(new Date("2026-08-04T21:30:00.000Z"))).toBe(false);
    expect(isGameplayAlertCronWindow(new Date("2026-08-04T23:59:00.000Z"))).toBe(true);
  });
});
