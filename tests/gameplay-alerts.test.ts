import { describe, expect, it } from "vitest";

import { allAppVersionsAlertScope, allPlatformsAlertScope, buildDailyLevelFailRateSql, buildLevelFailRateSql, dailyGameplayAlertFilters, formatGameplayAlertSlackMessage, gameplayAlertCronFilters, gameplayAlertSettingsInputSchema, gameplayAlertTimeZone, gameplayAlertWebhookUrls, parseLevelFailRateRows } from "@/lib/gameplay-alerts";

const filters = { appName: "wordblast", platform: "android", appVersion: "1.0.0", startDate: "2026-07-01", endDate: "2026-07-07" };
const settings = { normalThreshold: 0.5, hardThreshold: 0.7, minPlayers: 50, alertTargets: [] };

describe("layout-hash gameplay alerts", () => {
  it("keeps the all-version scheduled scope", () => {
    expect(gameplayAlertSettingsInputSchema.parse({ normalThreshold: 0.5, hardThreshold: 0.7, minPlayers: 50, alertTargets: [{ appName: "stacksmash", platforms: ["ios", "android", "android"], appVersion: "0.2.0" }] }).alertTargets).toEqual([{ appName: "stacksmash", platforms: ["android", "ios"], appVersion: "0.2.0" }]);
    expect(dailyGameplayAlertFilters(new Date("2026-07-29T12:00:00.000Z"))).toEqual([{ appName: "stacksmash", platform: allPlatformsAlertScope, platforms: ["android", "ios"], appVersion: allAppVersionsAlertScope, appVersions: [], startDate: "2026-07-28", endDate: "2026-07-29" }]);
    expect(gameplayAlertTimeZone).toBe("Australia/Melbourne");
  });

  it("builds the Game_End-only hash query with dynamic release filters", () => {
    const sql = buildLevelFailRateSql(filters);
    expect(sql).toContain("ep.user_id::varchar as user_id");
    expect(sql).toContain("ep.name = 'Game_End'");
    expect(sql).toContain("and ep.argument_value in ('win', 'lose')");
    expect(sql).toContain("layout_rollups as");
    expect(sql).toContain("listagg(distinct app_version, ', ')");
    expect(sql).toContain("having users >= 10");
    expect(sql).toContain("partition by level_id");
    expect(sql).toContain("order by layout_first_seen_at desc");
    expect(sql).toContain("order by\n  level asc,\n  level_id asc,\n  layout_hash asc;");
    expect(sql).not.toContain("case status when 'alert' then 1");
    expect(sql).toContain("when l.users <= 100 then 'warming_up'");
    expect(sql).toContain("and l.fails / nullif(l.users, 0)::float > 0.4 then 'alert'");
    expect(sql).toContain("not in ('hard', 'superhard', 'veryhard')");
    const configuredSql = buildLevelFailRateSql(filters, { normalThreshold: 0.55, hardThreshold: 0.8, minPlayers: 250 });
    expect(configuredSql).toContain("when l.users <= 250 then 'warming_up'");
    expect(configuredSql).toContain("and l.fails / nullif(l.users, 0)::float > 0.55 then 'alert'");
    expect(configuredSql).toContain("and l.fails / nullif(l.users, 0)::float > 0.8 then 'alert'");
    expect(sql).toContain("ep.app_id = 122 -- modifiable parameter");
    expect(sql).toContain("ep.platform in ('android') -- modifiable parameter");
    expect(sql).toContain("ep.app_version in ('1.0.0') -- modifiable parameter");
    expect(sql).toContain("ep.created_at >= TO_DATE('2026-07-01') -- modifiable parameter");
    expect(sql).toContain("ep.created_at < DATEADD(day, 1, TO_DATE('2026-07-07')) -- modifiable parameter");

    const allVersionSql = buildLevelFailRateSql({ ...filters, platforms: ["android", "ios"], appVersions: [], platform: undefined, appVersion: undefined });
    expect(allVersionSql).toContain("ep.platform in ('android', 'ios') -- modifiable parameter");
    expect(allVersionSql).toContain("1 = 1 -- modifiable parameter");

    const dailySql = buildDailyLevelFailRateSql(filters, settings);
    expect(dailySql).toContain("ep.created_at >= dateadd(hour, -48, current_timestamp()) -- rolling daily alert window");
    expect(dailySql).toContain("where status = 'alert'");
    expect(dailySql).not.toContain("TO_DATE('2026-07-01')");
  });

  it("maps query statuses to the fixed current-layout alert policy", () => {
    const points = parseLevelFailRateRows([
      "level,level_id,level_bank_id,layout_hash,difficulty_tier,contributing_app_versions,users,fails,fail_rate,alert_threshold,layout_first_seen_at,layout_last_seen_at,unhashed_outcome_events,hash_coverage,status",
      "10,lvl-10,4789,hash-alert,normal,0.4.0,125,60,0.48,0.4,2026-08-17 10:00:00,2026-08-18 10:00:00,4,0.98,alert",
      "11,lvl-11,4790,hash-warming,hard,0.4.0,25,20,0.8,0.7,2026-08-18 08:00:00,2026-08-18 10:00:00,0,1,warming_up",
    ].join("\n"), settings);

    expect(points[0]).toMatchObject({ level: 10, levelId: "lvl-10", layoutBankId: "4789", layoutHash: "hash-alert", reachedPlayers: 125, failedPlayers: 60, threshold: 0.4, breached: true, status: "alert", contributingAppVersions: "0.4.0", hashCoverage: 0.98 });
    expect(points[1]).toMatchObject({ level: 11, layoutHash: "hash-warming", difficultyTier: "hard", threshold: 0.7, reachedPlayers: 25, layoutUpdatePending: true, eligible: false, breached: false, status: "warming_up" });
  });

  it("keeps Slack delivery compact", () => {
    const message = formatGameplayAlertSlackMessage([{ type: "daily-open", state: { alertKey: "level-556", alertKind: "daily", appName: "stacksmash", platform: allPlatformsAlertScope, appVersion: allAppVersionsAlertScope, level: 556, levelId: "ns-044", layoutBankId: "4860", layoutHash: "hash", difficultyTier: "normal", status: "open", firstSeenAt: "2026-08-01T00:00:00.000Z", lastSeenAt: "2026-08-04T04:30:00.000Z", lastFailRate: 0.507, lastReachedPlayers: 11_999, threshold: 0.4 } }], new Date("2026-08-04T04:30:00.000Z"));
    expect(message).toContain("*Game:* stacksmash");
    expect(message).toContain("• Level 556 (ID ns-044) · normal · 50.7% · 12K players");
    expect(message).not.toContain("layout-hash");
  });

  it("uses configured gameplay webhooks without exposing them", () => {
    expect(gameplayAlertWebhookUrls({ SLACK_GAMEPLAY_ALERT_WEBHOOK_URL: " https://hooks.slack.com/services/primary ", SLACK_GAMEPLAY_ALERT_ADDITIONAL_WEBHOOK_URL: "https://hooks.slack.com/services/additional" })).toEqual(["https://hooks.slack.com/services/primary", "https://hooks.slack.com/services/additional"]);
    expect(gameplayAlertCronFilters({ normalThreshold: 0.5, hardThreshold: 0.7, minPlayers: 50, alertTargets: [{ appName: "stacksmash", platforms: ["android"], appVersion: "" }] }, new Date("2026-07-29T12:00:00.000Z"))).toEqual([expect.objectContaining({ appVersion: allAppVersionsAlertScope })]);
  });
});
