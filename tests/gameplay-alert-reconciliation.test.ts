import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), listStates: vi.fn(), saveStates: vi.fn(), saveRun: vi.fn(), runCountSql: vi.fn() }));

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

function preview(status: "alert" | "warming_up", layoutHash: string, failRate = 0.8, users = 125) {
  return [
    "level,level_id,layout_bank_id,layout_hash,contributing_app_versions,users,fails,fail_rate,layout_first_seen_at,layout_last_seen_at,unhashed_outcome_events,hash_coverage,status",
    `10,level-10,bank-b,${layoutHash},1.0.0,${users},${Math.round(failRate * users)},${failRate},2026-07-06 00:00:00,2026-07-07 00:00:00,0,1,${status}`,
  ].join("\n");
}

function openState(layoutHash = "hash-a") {
  return {
    alertKey: `daily:wordblast:android:1.0.0:10:${layoutHash}:normal`, alertKind: "daily" as const, appName: "wordblast", platform: "android", appVersion: "1.0.0",
    level: 10, layoutBankId: "bank-a", layoutHash, difficultyTier: "normal" as const, status: "open" as const,
    firstSeenAt: "2026-07-01T00:00:00.000Z", lastSeenAt: "2026-07-01T00:00:00.000Z", lastFailRate: 0.8, lastReachedPlayers: 100, threshold: 0.4, slackOpenDeliveredAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("current-layout gameplay alert reconciliation", () => {
  beforeEach(() => {
    mocks.getSettings.mockReset().mockResolvedValue(null);
    mocks.listStates.mockReset().mockResolvedValue([openState()]);
    mocks.saveStates.mockReset().mockResolvedValue(undefined);
    mocks.saveRun.mockReset().mockResolvedValue(undefined);
    mocks.runCountSql.mockReset();
  });

  it("moves an older open alert to pending while the newest qualifying hash warms up", async () => {
    mocks.runCountSql.mockResolvedValue({ query: { status: "completed", result_metadata: {}, result_preview: preview("warming_up", "hash-b", 0.8, 25) } });
    const result = await reconcileGameplayAlerts(filters);

    expect(result.transitions).toEqual([expect.objectContaining({ type: "pending", state: expect.objectContaining({ status: "pending", layoutHash: "hash-a" }) })]);
  });

  it("opens the new hash and resolves the prior hash when the new current layout breaches", async () => {
    mocks.runCountSql.mockResolvedValue({ query: { status: "completed", result_metadata: {}, result_preview: preview("alert", "hash-b") } });
    const result = await reconcileGameplayAlerts(filters);

    expect(result.transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "opened", state: expect.objectContaining({ layoutHash: "hash-b", status: "open" }) }),
      expect.objectContaining({ type: "resolved", state: expect.objectContaining({ layoutHash: "hash-a", status: "resolved" }) }),
    ]));
  });

  it("keeps an already-open hash quiet when the bank metadata changes", async () => {
    mocks.listStates.mockResolvedValue([openState("hash-stable")]);
    mocks.runCountSql.mockResolvedValue({ query: { status: "completed", result_metadata: {}, result_preview: preview("alert", "hash-stable") } });
    const result = await reconcileGameplayAlerts(filters);

    expect(result.transitions).toEqual([]);
    expect(mocks.saveStates).toHaveBeenCalledWith([expect.objectContaining({ status: "open", layoutHash: "hash-stable", layoutBankId: "bank-b" })]);
  });

  it("resolves an old alert when the current layout is no longer returned as alert or warming", async () => {
    mocks.runCountSql.mockResolvedValue({ query: { status: "completed", result_metadata: {}, result_preview: "level,level_id,layout_bank_id,layout_hash,contributing_app_versions,users,fails,fail_rate,layout_first_seen_at,layout_last_seen_at,unhashed_outcome_events,hash_coverage,status" } });
    const result = await reconcileGameplayAlerts(filters);

    expect(result.transitions).toEqual([expect.objectContaining({ type: "resolved", state: expect.objectContaining({ status: "resolved" }) })]);
  });
});
