import { describe, expect, it } from "vitest";

import {
  buildIncentConfigValidatorSql,
  evaluateIncentDensityMetric,
  evaluateIncentFirstAd,
  evaluateNoAdsPurchases,
  incentConfigPolicy,
  latestIncentEvaluationHour,
  type DensityPoint,
  type IncentConfigValidatorSettings,
} from "@/lib/incent-config-validator";

const configuration: IncentConfigValidatorSettings = {
  appName: "stacksmash",
  mediaSources: ["freecash_int", "adjoe_int"],
  updatedAt: "2026-08-19T00:00:00.000Z",
  updatedBy: "test",
};

function hourBefore(value: string, hours: number) {
  const date = new Date(value); date.setUTCHours(date.getUTCHours() - hours);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function pointsFor(evaluationHour: string, current = 1): DensityPoint[] {
  return Array.from({ length: incentConfigPolicy.densityBaselineHours + 1 }, (_, index) => {
    const eventHour = hourBefore(evaluationHour, incentConfigPolicy.densityBaselineHours - index);
    const baseline = index === incentConfigPolicy.densityBaselineHours ? current : 1 + ((index % 2) * 0.1);
    return { eventHour, fipg: baseline, ripg: baseline, completedGames: 150, eligibleUsers: 100 };
  });
}

describe("Incent Config Validator", () => {
  it("uses D0 only for first-ad checks while density and purchases include every cohort day", () => {
    const sql = buildIncentConfigValidatorSql({ appName: "stacksmash", startDate: "2026-08-10", endDate: "2026-08-19" }, configuration, new Date("2026-08-19T01:16:00Z"));
    expect(sql).toContain("ep.app_id = 3011 -- app id parameter");
    expect(sql).toContain("lower(media_source::varchar) in ('freecash_int', 'adjoe_int') -- media sources parameter");
    expect(sql).toContain("d0_date_range_events as (");
    expect(sql).toContain("where cohort_day = 0");
    expect(sql).not.toContain("and try_to_number(ep.cohort_day::varchar)::int = 0");
    expect(sql).toContain("try_to_number(ep.payload:\"level\"::varchar)::int as level");
    expect(sql).toContain("row_number() over (partition by user_id order by created_at) = 1");
    expect(sql).toContain("'first_ad_hourly' as row_type");
    expect(sql).toContain("having count(distinct user_id) > 100 -- hourly first-ad sample floor");
    expect(sql).toContain("'no_ads_hourly' as row_type");
    expect(sql).toContain("report_hours(event_hour) as (");
    expect(sql).toContain("2026-08-10 00:00:00")
    expect(sql).toContain("2026-08-19 01:00:00")
    expect(sql).toContain("coalesce(ep.payload:item_type::varchar, ep.payload:itemtype::varchar)");
    expect(sql).toContain("-- incentive_config_revision: 2026-08-19T00:00:00.000Z");
  });

  it("uses the previous fully buffered hour", () => {
    expect(latestIncentEvaluationHour(new Date("2026-08-19T01:14:59Z"))).toBe("2026-08-18T23:00:00Z");
    expect(latestIncentEvaluationHour(new Date("2026-08-19T01:15:00Z"))).toBe("2026-08-19T00:00:00Z");
  });

  it("evaluates first-ad and no-ads boundaries", () => {
    expect(evaluateIncentFirstAd({ eligibleUsers: 100, medianLevel: 3, observedFirstAds: 100 }).verdict).toBe("pass");
    expect(evaluateIncentFirstAd({ eligibleUsers: 100, medianLevel: 6, observedFirstAds: 100 }).verdict).toBe("pass");
    expect(evaluateIncentFirstAd({ eligibleUsers: 100, medianLevel: 2, observedFirstAds: 100 }).verdict).toBe("fail");
    expect(evaluateIncentFirstAd({ eligibleUsers: 99, medianLevel: 4, observedFirstAds: 99 }).verdict).toBe("insufficient_data");
    expect(evaluateNoAdsPurchases(9)).toBe("pass");
    expect(evaluateNoAdsPurchases(10)).toBe("fail");
  });

  it("requires a complete eligible baseline and fails at z-score -3", () => {
    const evaluationHour = "2026-08-19T00:00:00Z";
    const exactlyMinusThree = 1.05 - 3 * Math.sqrt(0.12 / 47);
    const points = pointsFor(evaluationHour, exactlyMinusThree);
    const boundary = evaluateIncentDensityMetric(points, "fipg", evaluationHour);
    expect(boundary.zScore).toBeCloseTo(-3, 8);
    expect(boundary.verdict).toBe("fail");
    expect(evaluateIncentDensityMetric(points.slice(1), "fipg", evaluationHour).verdict).toBe("insufficient_data");
    const lowVolume = pointsFor(evaluationHour); lowVolume[0].eligibleUsers = 99;
    expect(evaluateIncentDensityMetric(lowVolume, "ripg", evaluationHour).verdict).toBe("insufficient_data");
    const zeroVariance = pointsFor(evaluationHour, 1).map((point) => ({ ...point, fipg: 1 }));
    expect(evaluateIncentDensityMetric(zeroVariance, "fipg", evaluationHour).verdict).toBe("insufficient_data");
  });
});
