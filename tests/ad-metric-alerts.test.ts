import { describe, expect, it } from "vitest";

import { adMetricEvaluationHour, buildAdMetricAlertSql, evaluateAdMetricAnomalies, isAdMetricAlertCronWindow, parseHourlyAdMetricRows } from "@/lib/ad-metric-alerts";

const filters = {
  appName: "wordblast" as const,
  platform: "android",
  platforms: ["android"] as Array<"android">,
  appVersion: "1.0.0",
  appVersions: ["1.0.0"],
  startDate: "2026-07-23",
  endDate: "2026-07-29",
};

describe("ad engagement anomaly alerts", () => {
  it("uses the last completed hour and an immediately preceding twelve-hour FIPG/RIPG baseline", () => {
    const now = new Date("2026-07-30T01:15:00Z");
    expect(adMetricEvaluationHour(now)).toBe("2026-07-30T00:00:00Z");
    expect(isAdMetricAlertCronWindow(new Date("2026-07-30T01:00:00Z"))).toBe(true);
    expect(isAdMetricAlertCronWindow(now)).toBe(false);
    const sql = buildAdMetricAlertSql(filters, now);
    expect(sql).toContain("ep.app_id = 122 -- modifiable parameter");
    expect(sql).toContain("ep.platform in ('android') -- modifiable parameter");
    expect(sql).toContain("ep.app_version in ('1.0.0') -- modifiable parameter");
    expect(sql).toContain("ep.created_at >= TO_TIMESTAMP_NTZ('2026-07-29 12:00:00') -- modifiable parameter");
    expect(sql).toContain("ep.created_at < TO_TIMESTAMP_NTZ('2026-07-30 01:00:00') -- modifiable parameter");
    expect(sql).toContain("ad_impression_interstitial");
    expect(sql).toContain("ad_impression_rewarded");
    expect(sql).toContain("game_end");
  });

  it("opens only for a materially negative z-score and ignores a zero-variance baseline", () => {
    const points = parseHourlyAdMetricRows([
      "event_hour,completed_games,fipg,ripg",
      "2026-07-29T12:00:00Z,100,1.00,0.50",
      "2026-07-29T13:00:00Z,100,1.02,0.51",
      "2026-07-29T14:00:00Z,100,0.98,0.49",
      "2026-07-29T15:00:00Z,100,1.01,0.50",
      "2026-07-29T16:00:00Z,100,0.99,0.51",
      "2026-07-29T17:00:00Z,100,1.00,0.50",
      "2026-07-29T18:00:00Z,100,1.02,0.49",
      "2026-07-29T19:00:00Z,100,1.01,0.50",
      "2026-07-29T20:00:00Z,100,0.99,0.51",
      "2026-07-29T21:00:00Z,100,1.00,0.50",
      "2026-07-29T22:00:00Z,100,1.01,0.49",
      "2026-07-29T23:00:00Z,100,0.98,0.50",
      "2026-07-30T00:00:00Z,100,0.60,0.50",
    ].join("\n"));

    expect(evaluateAdMetricAnomalies(points, "2026-07-30T00:00:00Z", 2)).toMatchObject([{ metric: "fipg", currentValue: 0.6 }]);
    expect(evaluateAdMetricAnomalies(points, "2026-07-30T00:00:00Z", 2)).not.toEqual(expect.arrayContaining([expect.objectContaining({ metric: "ripg" })]));
  });
});
