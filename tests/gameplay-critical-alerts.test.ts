import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listStates: vi.fn(),
  saveStates: vi.fn(),
  saveRun: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getGameplayAlertSettingsRecord: vi.fn(),
  listGameplayAlertStates: mocks.listStates,
  saveGameplayAlertSettingsRecord: vi.fn(),
  saveGameplayAlertStateRecords: mocks.saveStates,
  saveGameplayAlertEvaluationRun: mocks.saveRun,
  markGameplayAlertSlackDelivered: vi.fn(),
}));

vi.mock("@/lib/count-api", () => ({ runCountSql: vi.fn(), submitCountSql: vi.fn(), getCountQuery: vi.fn() }));

import {
  buildCriticalLevelFailRateSql,
  criticalGameplayAlertMinPlayers,
  criticalGameplayAlertThreshold,
  formatGameplayAlertSlackMessage,
  reconcileCriticalGameplayAlertsFromQuery,
} from "@/lib/gameplay-alerts";

const filters = { appName: "stacksmash", platform: "android", appVersion: "0.2.0" };

function completedPreview(failRate: number, reachedPlayers = 50, layoutHash = "hash-a", difficultyTier = "normal") {
  return {
    job_key: "critical-job",
    status: "completed" as const,
    result_metadata: {},
    result_preview: [
      "level,level_id,layout_bank_id,layout_hash,difficulty_tier,reached_players,failed_players,fail_rate",
      `10,level-10,bank-a,${layoutHash},${difficultyTier},${reachedPlayers},${Math.round(failRate * reachedPlayers)},${failRate}`,
    ].join("\n"),
  };
}

describe("critical gameplay alerts", () => {
  beforeEach(() => {
    mocks.listStates.mockReset().mockResolvedValue([]);
    mocks.saveStates.mockReset().mockResolvedValue(undefined);
    mocks.saveRun.mockReset().mockResolvedValue(undefined);
  });

  it("uses an exact rolling 48-hour current-layout hash query", () => {
    const sql = buildCriticalLevelFailRateSql({ ...filters, platforms: ["android"], appVersions: ["0.2.0"], startDate: "2026-08-01", endDate: "2026-08-07" });

    expect(sql).toContain("ep.created_at >= dateadd(hour, -48, current_timestamp()) -- modifiable parameter");
    expect(sql).toContain("ep.created_at < current_timestamp() -- modifiable parameter");
    expect(sql).toContain("ep.app_id = 3011 -- modifiable parameter");
    expect(sql).toContain("ep.platform in ('android') -- modifiable parameter");
    expect(sql).toContain("ep.app_version in ('0.2.0') -- modifiable parameter");
    expect(sql).toContain("layout_rollups as");
    expect(sql).toContain("ep.payload:difficulty::varchar");
    expect(sql).toContain("as difficulty_tier");
    expect(sql).toContain("having users >= 10");
    expect(sql).toContain("partition by level_id");
    expect(sql).toContain("when l.users <= 100 then 'warming_up'");
    expect(sql).not.toContain("Game_Start");
  });

  it("opens only for every-tier breaches strictly above 70% with at least 50 players", async () => {
    const result = await reconcileCriticalGameplayAlertsFromQuery(filters, completedPreview(0.71, 50, "hash-a", "hard"));

    expect(criticalGameplayAlertThreshold).toBe(0.7);
    expect(criticalGameplayAlertMinPlayers).toBe(50);
    expect(mocks.listStates).toHaveBeenCalledWith({ ...filters, alertKind: "critical" });
    expect(result.transitions).toEqual([expect.objectContaining({
      type: "opened",
      state: expect.objectContaining({ alertKind: "critical", levelId: "level-10", difficultyTier: "hard", status: "open", threshold: 0.7, lastReachedPlayers: 50 }),
    })]);
  });

  it("does not open at exactly 70% or below the fixed player floor", async () => {
    await reconcileCriticalGameplayAlertsFromQuery(filters, completedPreview(0.7));
    await reconcileCriticalGameplayAlertsFromQuery(filters, completedPreview(0.9, 49));

    expect(mocks.saveStates).toHaveBeenNthCalledWith(1, []);
    expect(mocks.saveStates).toHaveBeenNthCalledWith(2, []);
  });

  it("resolves quietly and can alert again after a recovery", async () => {
    const openState = {
      alertKey: "critical:stacksmash:android:0.2.0:10:hash-a", alertKind: "critical" as const,
      appName: "stacksmash", platform: "android", appVersion: "0.2.0", level: 10, layoutBankId: "bank-a", layoutHash: "hash-a",
      difficultyTier: "normal" as const, status: "open" as const, firstSeenAt: "2026-08-01T00:00:00.000Z", lastSeenAt: "2026-08-01T00:00:00.000Z",
      lastFailRate: 0.8, lastReachedPlayers: 60, threshold: 0.7, slackOpenDeliveredAt: "2026-08-01T00:00:00.000Z",
    };
    mocks.listStates.mockResolvedValueOnce([openState]).mockResolvedValueOnce([{ ...openState, status: "resolved" as const }]);

    const recovered = await reconcileCriticalGameplayAlertsFromQuery(filters, completedPreview(0.7));
    const rebred = await reconcileCriticalGameplayAlertsFromQuery(filters, completedPreview(0.71));

    expect(recovered.transitions).toEqual([]);
    expect(mocks.saveStates).toHaveBeenNthCalledWith(1, [expect.objectContaining({ alertKind: "critical", status: "resolved" })]);
    expect(rebred.transitions).toEqual([expect.objectContaining({ type: "opened" })]);
  });

  it("labels immediate Slack deliveries as critical", async () => {
    const result = await reconcileCriticalGameplayAlertsFromQuery(filters, completedPreview(0.71, 50, "hash-a", "hard"));

    const message = formatGameplayAlertSlackMessage(result.transitions, new Date("2026-08-13T04:00:00.000Z"));
    expect(message).toContain("*Critical Gameplay Alert*");
    expect(message).toContain("Level 10 (ID level-10) · hard");
  });
});
