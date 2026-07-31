import { describe, expect, it } from "vitest";

import { buildGameMonitoringSql, parseGameMonitoringRows } from "@/lib/game-monitoring";

const filters = { appName: "wordblast", platforms: ["android"] as const, appVersions: ["1.0.0"], startDate: "2026-07-01", endDate: "2026-07-07" };

describe("Game Monitoring helpers", () => {
  it("builds a date-and-cohort query with release filters and user-based rates", () => {
    const sql = buildGameMonitoringSql(filters);
    expect(sql).toContain("with recursive calendar");
    expect(sql).toContain("ep.app_id = 122 -- modifiable parameter");
    expect(sql).toContain("select column1::string as platform from values ('android') -- modifiable parameter");
    expect(sql).toContain("ep.app_version in ('1.0.0') -- modifiable parameter");
    expect(sql).toContain("ep.created_at >= TO_DATE('2026-07-01') -- modifiable parameter");
    expect(sql).toContain("ep.created_at < DATEADD(day, 1, TO_DATE('2026-07-07')) -- modifiable parameter");
    expect(sql).toContain("and ep.created_at <= current_timestamp()");
    expect(sql).toContain("g.event_hour <= date_part(hour, current_timestamp())");
    expect(sql).toContain("try_to_number(ep.cohort_day) >= 0");
    expect(sql).toContain("sum(install_users) over (partition by event_date, platform order by event_hour");
    expect(sql).toContain("purchasers / nullif(hourly_active_users, 0)::float as payer_rate");
    expect(sql).toContain("game_start_users / nullif(hourly_active_users, 0)::float as game_start_active_rate");
    expect(sql).toContain("interstitial_impressions / nullif(hourly_active_users, 0)::float as fipu");
  });

  it("supports multi-platform, all-version monitoring", () => {
    const sql = buildGameMonitoringSql({ ...filters, platforms: ["ios", "android"], appVersions: [] });
    expect(sql).toContain("select column1::string as platform from values ('android'), ('ios') -- modifiable parameter");
    expect(sql).toContain("1 = 1 -- modifiable parameter");
  });

  it("limits the hourly grid to ten days so Count previews remain complete", () => {
    expect(() => buildGameMonitoringSql({ ...filters, endDate: "2026-07-11" })).toThrow(/maximum ten-day/i);
  });

  it("parses D0 and D1+ points and preserves unavailable rates", () => {
    const parsed = parseGameMonitoringRows([
      "event_date,platform,event_hour,cohort_segment,hourly_active_users,install_users,cumulative_installs,purchase_success_events,purchasers,payer_rate,session_start_events,game_start_events,session_start_users,game_start_users,game_start_rate,game_start_active_rate,interstitial_impressions,rewarded_impressions,banner_impressions,fipu,ripu,bipu,last_event_at",
      "2026-07-01,android,3,d0,100,10,40,5,4,0.04,90,80,70,60,0.8571,0.6,40,20,10,0.4,0.2,0.1,2026-07-01 23:59:00",
      "2026-07-01,ios,3,d1_plus,0,0,0,0,0,,0,0,0,0,,,0,0,0,,,,2026-07-01 23:59:00",
      "not-a-date,android,3,d0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,",
    ].join("\n"));
    expect(parsed.lastEventAt).toBe("2026-07-01 23:59:00");
    expect(parsed.points).toHaveLength(2);
    expect(parsed.points[0]).toMatchObject({ cohortSegment: "d0", platform: "android", eventHour: 3, hourlyActiveUsers: 100, cumulativeInstalls: 40, purchasers: 4, payerRate: 0.04, gameStartActiveRate: 0.6, fipu: 0.4 });
    expect(parsed.points[1]).toMatchObject({ cohortSegment: "d1_plus", platform: "ios", hourlyActiveUsers: 0, payerRate: null, gameStartRate: null, gameStartActiveRate: null, bipu: null });
  });
});
