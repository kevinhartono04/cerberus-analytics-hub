import { describe, expect, it } from "vitest";

import { buildLevelFailRateSql, dailyGameplayAlertFilters, gameplayAlertSettingsInputSchema, parseLevelFailRateRows } from "@/lib/gameplay-alerts";

const filters = {
  appName: "wordblast",
  platform: "android",
  appVersion: "1.0.0",
  startDate: "2026-07-01",
  endDate: "2026-07-07",
};

const settings = { normalThreshold: 0.5, hardThreshold: 0.7, minPlayers: 50, alertTargets: [] };

describe("gameplay difficulty alerts", () => {
  it("supports explicit, version-pinned Slack targets and defaults the daily evaluator to Stacksmash 0.2.0 on both platforms", () => {
    expect(gameplayAlertSettingsInputSchema.parse({
      normalThreshold: 0.5,
      hardThreshold: 0.7,
      minPlayers: 50,
      alertTargets: [{ appName: "stacksmash", platforms: ["ios", "android", "android"], appVersion: "0.2.0" }],
    }).alertTargets).toEqual([{ appName: "stacksmash", platforms: ["android", "ios"], appVersion: "0.2.0" }]);

    expect(dailyGameplayAlertFilters(new Date("2026-07-29T12:00:00.000Z"))).toEqual([
      { appName: "stacksmash", platform: "android", appVersion: "0.2.0", startDate: "2026-07-22", endDate: "2026-07-28" },
      { appName: "stacksmash", platform: "ios", appVersion: "0.2.0", startDate: "2026-07-22", endDate: "2026-07-28" },
    ]);
  });

  it("builds a query with the selected release filters and unique player contract", () => {
    const sql = buildLevelFailRateSql(filters);
    expect(sql).toContain("user_id::string as user_id");
    expect(sql).toContain("payload:level_id::string");
    expect(sql).toContain("coalesce(payload:layout_bank_id::string, payload:level_bank_id::string, '')");
    expect(sql).toContain("payload:layout_hash::string");
    expect(sql).toContain("coalesce(s.layout_hash, r.layout_hash, b.layout_hash, concat('__bank_fallback__:', s.layout_bank_id)) as revision_key");
    expect(sql).toContain("end_round_hashes as");
    expect(sql).toContain("coalesce(s.layout_hash, r.layout_hash, b.layout_hash) as layout_hash");
    expect(sql).toContain("lower(trim(coalesce(argument_value::string");
    expect(sql).toContain("regexp_replace(lower(coalesce(max_by(s.raw_difficulty, s.created_at), '')), '[[:space:]_-]', '')");
    expect(sql).toContain("in ('hard', 'superhard', 'veryhard') then 'hard'");
    expect(sql).toContain("in ('normal', 'hard', 'superhard', 'veryhard') as used_difficulty_fallback");
    expect(sql).toContain("a.layout_share >= 0.7");
    expect(sql).toContain("a.layout_coverage >= 0.95");
    expect(sql).toContain("pending_revision_candidates as");
    expect(sql).toContain("prior_layouts as");
    expect(sql).toContain("previous_layout_fail_rate");
    expect(sql).toContain("previous_layout_hash");
    expect(sql).toContain("and r.recent_players >= 5");
    expect(sql).toContain("and r.recent_players / nullif(t.total_recent_players, 0)::float >= 0.01");
    expect(sql).toContain("app_name = 'wordblast' -- modifiable parameter");
    expect(sql).toContain("ep.platform in ('android') -- modifiable parameter");
    expect(sql).toContain("ep.app_version in ('1.0.0') -- modifiable parameter");
    expect(sql).toContain("ep.created_at::date between TO_DATE('2026-07-01') and TO_DATE('2026-07-07') -- modifiable parameter");
    expect(sql).toContain("count(distinct s.user_id) as reached_players");

    const allVersionSql = buildLevelFailRateSql({ ...filters, platforms: ["android", "ios"], appVersions: [], platform: undefined, appVersion: undefined });
    expect(allVersionSql).toContain("ep.platform in ('android', 'ios') -- modifiable parameter");
    expect(allVersionSql).toContain("1 = 1 -- modifiable parameter");
  });

  it("applies tier thresholds, fallback classification, and the minimum-player rule", () => {
    const points = parseLevelFailRateRows([
      "level,layout_bank_id,difficulty_tier,used_difficulty_fallback,reached_players,failed_players,fail_rate,layout_share,layout_coverage,layout_age_hours,layout_is_stable",
      "10,layout-a,normal,true,49,30,0.6122,1,1,48,true",
      "11,layout-b,hard,false,50,35,0.7,0.8,1,48,true",
      "12,layout-c,normal,false,100,49,0.49,0.6,1,48,false",
    ].join("\n"), settings);

    expect(points[0]).toMatchObject({ level: 10, layoutBankId: "layout-a", eligible: false, breached: false, usedDifficultyFallback: true, threshold: 0.5 });
    expect(points[1]).toMatchObject({ level: 11, layoutBankId: "layout-b", difficultyTier: "hard", eligible: true, breached: true, threshold: 0.7 });
    expect(points[2]).toMatchObject({ level: 12, layoutBankId: "layout-c", layoutStable: false, eligible: false, breached: false, threshold: 0.5 });
  });

  it("does not let malformed values create invalid alert points", () => {
    const points = parseLevelFailRateRows([
      "level,layout_bank_id,difficulty_tier,used_difficulty_fallback,reached_players,failed_players,fail_rate,layout_share,layout_coverage,layout_age_hours,layout_is_stable",
      "-1,layout-a,normal,false,100,200,2,1,1,48,true",
      "15,layout-b,unknown,,0,0,,1,1,48,true",
    ].join("\n"), settings);

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ level: 15, difficultyTier: "normal", reachedPlayers: 0, failedPlayers: 0, failRate: 0, eligible: false });
  });

  it("pauses alert eligibility only while a newly observed level revision warms up", () => {
    const points = parseLevelFailRateRows([
      "level,level_id,layout_bank_id,layout_hash,difficulty_tier,used_difficulty_fallback,reached_players,failed_players,fail_rate,layout_share,layout_coverage,layout_age_hours,layout_is_stable,layout_update_pending,pending_layout_bank_id,pending_layout_hash,pending_layout_share,pending_layout_recent_players,pending_layout_age_hours,previous_layout_bank_id,previous_layout_hash,previous_layout_difficulty_tier,previous_layout_reached_players,previous_layout_failed_players,previous_layout_fail_rate",
      "20,level-detail-20,layout-a,hash-current,normal,false,100,80,0.8,0.9,1,48,true,true,layout-b,hash-new,0.08,8,6,layout-old,hash-old,normal,80,48,0.6",
    ].join("\n"), settings);

    expect(points[0]).toMatchObject({
      level: 20, levelId: "level-detail-20", layoutHash: "hash-current", layoutUpdatePending: true, pendingLayoutBankId: "layout-b", pendingLayoutHash: "hash-new", pendingLayoutShare: 0.08,
      pendingLayoutRecentPlayers: 8, pendingLayoutAgeHours: 6, eligible: false, breached: false,
      previousBankAssessment: { layoutBankId: "layout-old", layoutHash: "hash-old", difficultyTier: "normal", failRate: 0.6, reachedPlayers: 80, threshold: 0.5 },
    });
  });
});
