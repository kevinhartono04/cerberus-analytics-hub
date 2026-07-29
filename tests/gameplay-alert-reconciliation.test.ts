import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  listStates: vi.fn(),
  saveStates: vi.fn(),
  saveRun: vi.fn(),
  runCountSql: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getGameplayAlertSettingsRecord: mocks.getSettings,
  listGameplayAlertStates: mocks.listStates,
  saveGameplayAlertSettingsRecord: vi.fn(),
  saveGameplayAlertStateRecords: mocks.saveStates,
  saveGameplayAlertEvaluationRun: mocks.saveRun,
  markGameplayAlertSlackDelivered: vi.fn(),
}));

vi.mock("@/lib/count-api", () => ({ runCountSql: mocks.runCountSql }));

import { reconcileGameplayAlerts } from "@/lib/gameplay-alerts";

const filters = { appName: "wordblast", platform: "android", appVersion: "1.0.0", startDate: "2026-07-01", endDate: "2026-07-07" };

function preview(layoutBankId: string, failRate: number, layoutUpdatePending = false, layoutHash = "", pendingLayoutHash = "") {
  return [
    "level,layout_bank_id,layout_hash,difficulty_tier,used_difficulty_fallback,reached_players,failed_players,fail_rate,layout_share,layout_coverage,layout_age_hours,layout_is_stable,layout_update_pending,pending_layout_bank_id,pending_layout_hash,pending_layout_share,pending_layout_recent_players,pending_layout_age_hours,previous_layout_bank_id,previous_layout_hash,previous_layout_difficulty_tier,previous_layout_reached_players,previous_layout_failed_players,previous_layout_fail_rate",
    `10,${layoutBankId},${layoutHash},normal,false,100,${Math.round(failRate * 100)},${failRate},0.9,1,48,true,${layoutUpdatePending},bank-new,${pendingLayoutHash},0.08,8,6,bank-a,hash-a,normal,100,80,0.8`,
  ].join("\n");
}

function openState(layoutBankId: string, layoutHash?: string) {
  return {
    alertKey: `wordblast:android:1.0.0:10:${layoutBankId}:normal`, appName: "wordblast", platform: "android", appVersion: "1.0.0",
    level: 10, layoutBankId, ...(layoutHash ? { layoutHash } : {}), difficultyTier: "normal" as const, status: "open" as const, firstSeenAt: "2026-07-01T00:00:00.000Z", lastSeenAt: "2026-07-01T00:00:00.000Z",
    lastFailRate: 0.8, lastReachedPlayers: 100, threshold: 0.5, slackOpenDeliveredAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("layout-bank gameplay alert reconciliation", () => {
  beforeEach(() => {
    mocks.getSettings.mockReset().mockResolvedValue(null);
    mocks.listStates.mockReset().mockResolvedValue([openState("bank-a")]);
    mocks.saveStates.mockReset().mockResolvedValue(undefined);
    mocks.saveRun.mockReset().mockResolvedValue(undefined);
    mocks.runCountSql.mockReset().mockResolvedValue({ query: { status: "completed", result_metadata: {}, result_preview: preview("bank-b", 0.2) } });
  });

  it("supersedes an open alert when a stable new layout bank takes over and performs acceptably", async () => {
    const result = await reconcileGameplayAlerts(filters);

    expect(result.transitions).toEqual([]);
    expect(mocks.saveStates).toHaveBeenCalledWith([expect.objectContaining({ status: "superseded", layoutBankId: "bank-a", supersededAt: expect.any(String) })]);
  });

  it("opens a distinct alert only when the new stable layout bank still breaches", async () => {
    mocks.runCountSql.mockResolvedValueOnce({ query: { status: "completed", result_metadata: {}, result_preview: preview("bank-b", 0.8) } });

    const result = await reconcileGameplayAlerts(filters);

    expect(result.transitions).toEqual([expect.objectContaining({ type: "opened", state: expect.objectContaining({ layoutBankId: "bank-b" }) })]);
    expect(mocks.saveStates).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ status: "superseded", layoutBankId: "bank-a" }),
      expect.objectContaining({ status: "open", layoutBankId: "bank-b" }),
    ]));
  });

  it("keeps an open alert when the layout bank changes but the level hash is unchanged", async () => {
    mocks.listStates.mockResolvedValue([openState("bank-a", "hash-stable")]);
    mocks.runCountSql.mockResolvedValueOnce({ query: { status: "completed", result_metadata: {}, result_preview: preview("bank-b", 0.8, false, "hash-stable") } });

    const result = await reconcileGameplayAlerts(filters);

    expect(result.response.points[0].layoutHash).toBe("hash-stable");
    expect(result.transitions).toEqual([]);
    expect(mocks.saveStates).toHaveBeenCalledWith([expect.objectContaining({ status: "open", layoutBankId: "bank-b", layoutHash: "hash-stable" })]);
  });

  it("keeps an existing alert quiet while a new layout bank is still warming up", async () => {
    mocks.runCountSql.mockResolvedValueOnce({ query: { status: "completed", result_metadata: {}, result_preview: preview("bank-a", 0.8, true) } });

    const result = await reconcileGameplayAlerts(filters);

    expect(result.transitions).toEqual([]);
    expect(result.response.points[0]).toMatchObject({
      layoutUpdatePending: true,
      previousBankAssessment: { layoutBankId: "bank-a", difficultyTier: "normal", failRate: 0.8, reachedPlayers: 100, threshold: 0.5 },
      previousAlert: { layoutBankId: "bank-a", failRate: 0.8, reachedPlayers: 100, threshold: 0.5 },
    });
    expect(mocks.saveStates).toHaveBeenCalledWith([expect.objectContaining({ status: "open", layoutBankId: "bank-a", lastSeenAt: expect.any(String) })]);
  });
});
