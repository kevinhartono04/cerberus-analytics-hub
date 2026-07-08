import { describe, expect, it } from "vitest";

import {
  buildTechLaunchAppVersionsSql,
  buildTechLaunchSql,
  parseTechLaunchAppVersions,
  parseTechLaunchRows,
  summarizeTechLaunchRows,
  techLaunchCacheKey,
} from "@/lib/tech-launch";

const filters = {
  appName: "wordblast",
  platform: "android",
  appVersion: "1.0.0",
  startDate: "2026-06-25",
  endDate: "2026-07-02",
} as const;

describe("Tech Launch readiness helpers", () => {
  it("substitutes SQL filters with escaped literals", () => {
    const sql = buildTechLaunchSql({ ...filters, appVersion: "1.0.0-canary" });

    expect(sql).toContain("app_name = 'wordblast' -- modifiable parameter");
    expect(sql).toContain("ep.platform = 'android' -- modifiable parameter");
    expect(sql).toContain("ep.created_at::date between TO_DATE('2026-06-25') and TO_DATE('2026-07-02') -- modifiable parameter");
    expect(sql).toContain("app_version = '1.0.0-canary' -- modifiable parameter");
  });

  it("keeps cache keys stable for equivalent normalized filters", () => {
    expect(techLaunchCacheKey(filters)).toBe(techLaunchCacheKey({ ...filters, appVersion: " 1.0.0 " }));
  });

  it("builds app version lookup SQL from app, platform, and date filters", () => {
    const sql = buildTechLaunchAppVersionsSql(filters);

    expect(sql).toContain("ep.platform = 'android'");
    expect(sql).toContain("ep.created_at::date between TO_DATE('2026-06-25') and TO_DATE('2026-07-02')");
    expect(sql).toContain("app_name = 'wordblast'");
    expect(sql).toContain("order by last_seen desc, sample_count desc, app_version desc");
  });

  it("parses app version Count CSV previews", () => {
    const versions = parseTechLaunchAppVersions(
      [
        "app_version,sample_count,first_seen,last_seen",
        "1.2.0,1200,2026-06-25,2026-07-02",
        "1.1.0,400,2026-06-25,2026-06-29",
      ].join("\n"),
    );

    expect(versions).toEqual([
      { appVersion: "1.2.0", sampleCount: 1200, firstSeen: "2026-06-25", lastSeen: "2026-07-02" },
      { appVersion: "1.1.0", sampleCount: 400, firstSeen: "2026-06-25", lastSeen: "2026-06-29" },
    ]);
  });

  it("parses Count CSV previews into metric rows", () => {
    const rows = parseTechLaunchRows(
      [
        "name,metric_title,pct_of_sample,pct_of_sample_w_tolerance,p50_value,p80_value,benchmark,num_sample,verdict",
        "Telemetry_FPS_Average,FPS Average,0.83,0.91,54,48,50,120,green",
        "Telemetry_First_Load_Time,First Load Time,0.42,0.61,9900,14200,12000,34,insufficient data",
      ].join("\n"),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      metricTitle: "FPS Average",
      pctOfSampleWithTolerance: 0.91,
      verdict: "green",
      higherIsBetter: true,
    });
    expect(rows[1]).toMatchObject({
      metricTitle: "First Load Time",
      numSample: 34,
      verdict: "insufficient data",
      higherIsBetter: false,
    });
  });

  it("summarizes overall verdict from the worst scored metric", () => {
    const summary = summarizeTechLaunchRows(
      parseTechLaunchRows(
        [
          "name,metric_title,pct_of_sample,pct_of_sample_w_tolerance,p50_value,p80_value,benchmark,num_sample,verdict",
          "Telemetry_FPS_Average,FPS Average,0.83,0.91,54,48,50,120,green",
          "Telemetry_Runtime_Memory_Use,Runtime Memory,0.2,0.45,700,1100,800,100,red",
          "Telemetry_First_Load_Time,First Load Time,0.42,0.61,9900,14200,12000,34,insufficient data",
        ].join("\n"),
      ),
    );

    expect(summary).toMatchObject({
      overallVerdict: "red",
      metricCount: 3,
      greenCount: 1,
      redCount: 1,
      insufficientCount: 1,
      weakestMetric: "Runtime Memory",
    });
  });

  it("picks the weakest metric by lowest within-benchmark score inside the worst verdict", () => {
    const summary = summarizeTechLaunchRows(
      parseTechLaunchRows(
        [
          "name,metric_title,pct_of_sample,pct_of_sample_w_tolerance,p50_value,p80_value,benchmark,num_sample,verdict",
          "Telemetry_First_Load_Time,First Load Time,0.6,0.7,8635,24700,12000,896,yellow",
          "Telemetry_Runtime_Memory_Use,Runtime Memory,0.7,0.75,607,855,800,828,yellow",
          "Telemetry_Subsequent_Load_Time,Subsequent Load Time,0.55,0.67,6820,10660,8000,823,yellow",
        ].join("\n"),
      ),
    );

    expect(summary.weakestMetric).toBe("Subsequent Load Time");
  });
});
