import { describe, expect, it } from "vitest";

import { alertsFromIncentConfigQuery, buildIncentConfigAlertSql, incentConfigAlertEvaluationHour, incentConfigAlertPreviousEvaluationHour, shouldSubmitIncentConfigAlert } from "@/lib/incent-config-alerts";
import type { CountQuery } from "@/lib/count-api";
import type { IncentConfigValidatorSettings } from "@/lib/incent-config-validator";

const configuration: IncentConfigValidatorSettings = { appName: "stacksmash", mediaSources: ["freecash_int"], updatedAt: "2026-08-20T00:00:00.000Z", updatedBy: "test" };
const evaluationNow = new Date("2026-08-20T01:15:00Z");
const evaluationHour = "2026-08-20T00:00:00Z";

function hourBefore(value: string, hours: number) { const date = new Date(value); date.setUTCHours(date.getUTCHours() - hours); return date.toISOString().replace(/\.\d{3}Z$/, "Z"); }
function preview({ firstUsers = 101, firstMedian = 7, eligibleUsers = 100, noAds = 11 }: { firstUsers?: number; firstMedian?: number; eligibleUsers?: number; noAds?: number } = {}) {
  const lines = ["row_type,row_key,event_hour,metric_value,event_count,user_count", `first_interstitial,median_level,${evaluationHour},${firstMedian},${firstUsers},${firstUsers}`];
  for (let index = 0; index <= 48; index += 1) {
    const hour = hourBefore(evaluationHour, 48 - index);
    const value = index === 48 ? 0.5 : 1 + (index % 2) * 0.1;
    lines.push(`density,fipg,${hour},${value},150,${eligibleUsers}`, `density,ripg,${hour},${value},150,${eligibleUsers}`);
  }
  lines.push(`no_ads,purchase_events,${evaluationHour},${noAds},${noAds},${eligibleUsers}`);
  return lines.join("\n");
}

describe("Incent Config hourly alerts", () => {
  it("uses the buffered completed UTC hour, submits hourly at :15, and retains the prior hour for async completion", () => {
    expect(incentConfigAlertEvaluationHour(evaluationNow)).toBe(evaluationHour);
    expect(shouldSubmitIncentConfigAlert(evaluationNow)).toBe(true);
    expect(shouldSubmitIncentConfigAlert(new Date("2026-08-20T01:30:00Z"))).toBe(false);
    expect(incentConfigAlertPreviousEvaluationHour(new Date("2026-08-20T02:15:00Z"))).toBe(evaluationHour);
  });

  it("builds a query with the configured source and exact 48-hour baseline", () => {
    const sql = buildIncentConfigAlertSql(configuration, evaluationNow);
    expect(sql).toContain("lower(media_source::varchar) in ('freecash_int') -- media sources parameter");
    expect(sql).toContain("2026-08-18 00:00:00");
    expect(sql).toContain("2026-08-20 01:00:00");
    expect(sql).not.toContain("2026-08-21 00:00:00");
  });

  it("alerts on all four breaches and skips low-volume latest-hour data", () => {
    const result = alertsFromIncentConfigQuery(configuration, { status: "completed", result_preview: preview() } as CountQuery, evaluationNow);
    expect(result.alerts.map((alert) => alert.kind).sort()).toEqual(["fipg", "first_interstitial", "no_ads", "ripg"]);
    const lowVolume = alertsFromIncentConfigQuery(configuration, { status: "completed", result_preview: preview({ firstUsers: 100, eligibleUsers: 99 }) } as CountQuery, evaluationNow);
    expect(lowVolume.alerts).toEqual([]);
  });
});
