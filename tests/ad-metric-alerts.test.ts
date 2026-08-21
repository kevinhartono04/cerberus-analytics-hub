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
  it("uses the last completed hour and an immediately preceding 24-hour FIPG/RIPG baseline", () => {
    const now = new Date("2026-07-30T01:15:00Z");
    expect(adMetricEvaluationHour(now)).toBe("2026-07-30T00:00:00Z");
    expect(isAdMetricAlertCronWindow(new Date("2026-07-30T01:00:00Z"))).toBe(true);
    expect(isAdMetricAlertCronWindow(now)).toBe(false);
    const sql = buildAdMetricAlertSql(filters, now);
    expect(sql).toContain("ep.app_id = 122 -- modifiable parameter");
    expect(sql).toContain("ep.platform in ('android') -- modifiable parameter");
    expect(sql).toContain("ep.app_version in ('1.0.0') -- modifiable parameter");
    expect(sql).toContain("ep.created_at >= TO_TIMESTAMP_NTZ('2026-07-29 00:00:00') -- modifiable parameter");
    expect(sql).toContain("ep.created_at < TO_TIMESTAMP_NTZ('2026-07-30 01:00:00') -- modifiable parameter");
    expect(sql).toContain("try_to_number(ep.cohort_day) >= 0");
    expect(sql).toContain("when try_to_number(ep.cohort_day) between 8 and 29 then 'D8-D29'");
    expect(sql).toContain("cross join cohort_groups");
    expect(sql).toContain("ad_impression_interstitial");
    expect(sql).toContain("ad_impression_rewarded");
    expect(sql).toContain("game_end");
  });

  it("opens only for a materially negative z-score and ignores a zero-variance baseline", () => {
    const baseline = Array.from({ length: 24 }, (_, index) => {
      const hour = new Date("2026-07-29T00:00:00Z");
      hour.setUTCHours(hour.getUTCHours() + index);
      return `${hour.toISOString().replace(/\.\d{3}Z$/, "Z")},D0,100,${(1 + ((index % 5) - 2) * 0.01).toFixed(2)},${(0.5 + ((index % 3) - 1) * 0.01).toFixed(2)}`;
    });
    const points = parseHourlyAdMetricRows([
      "event_hour,cohort_group,completed_games,fipg,ripg",
      ...baseline,
      "2026-07-30T00:00:00Z,D0,100,0.60,0.50",
      // A D1-D7 observation must not be used in the D0 baseline.
      "2026-07-30T00:00:00Z,D1-D7,100,0.10,0.10",
    ].join("\n"));

    expect(evaluateAdMetricAnomalies(points, "2026-07-30T00:00:00Z", 2)).toMatchObject([{ metric: "fipg", cohortGroup: "D0", currentValue: 0.6 }]);
    expect(evaluateAdMetricAnomalies(points, "2026-07-30T00:00:00Z", 2)).not.toEqual(expect.arrayContaining([expect.objectContaining({ metric: "ripg" })]));
  });
});
