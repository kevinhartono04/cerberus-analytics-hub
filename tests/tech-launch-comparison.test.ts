import { describe, expect, it } from "vitest";

import { createMetricComparison, summarizeMetricComparison, type ComparableMetricRow } from "@/lib/tech-launch-comparison";

function metric(overrides: Partial<ComparableMetricRow> = {}): ComparableMetricRow {
  return {
    name: "Telemetry_First_Load_Time",
    metricTitle: "First load time",
    p50Value: 8,
    p80Value: 10,
    benchmark: 12,
    numSample: 100,
    verdict: "green",
    higherIsBetter: false,
    ...overrides,
  };
}

describe("Tech Launch metric comparison", () => {
  it("merges rows by stable metric name and reports a faster baseline as an improvement", () => {
    const rows = createMetricComparison([metric()], [metric({ p80Value: 12, verdict: "yellow" })]);

    expect(rows).toEqual([
      expect.objectContaining({
        name: "Telemetry_First_Load_Time",
        baselineValue: 10,
        comparisonValue: 12,
        absoluteDelta: -2,
        relativeDelta: -2 / 12,
        status: "improved",
      }),
    ]);
  });

  it("treats lower baseline FPS as a regression", () => {
    const rows = createMetricComparison(
      [metric({ name: "Telemetry_FPS_Average", metricTitle: "FPS", p50Value: 50, p80Value: 45, higherIsBetter: true })],
      [metric({ name: "Telemetry_FPS_Average", metricTitle: "FPS", p50Value: 55, p80Value: 48, higherIsBetter: true })],
    );

    expect(rows[0]).toMatchObject({ baselineValue: 50, comparisonValue: 55, status: "regressed" });
  });

  it("uses p50 Google Play rates when P80 is unavailable", () => {
    const rows = createMetricComparison(
      [metric({ name: "GooglePlay_UserPerceivedCrashRate7d", p50Value: 0.008, p80Value: null })],
      [metric({ name: "GooglePlay_UserPerceivedCrashRate7d", p50Value: 0.012, p80Value: null, verdict: "yellow" })],
    );

    expect(rows[0]).toMatchObject({ baselineValue: 0.008, comparisonValue: 0.012, status: "improved" });
  });

  it("marks missing or insufficient rows as not comparable and sorts them after regressions", () => {
    const rows = createMetricComparison(
      [metric({ p80Value: 15, verdict: "red" }), metric({ name: "Telemetry_Runtime_Memory_Use", metricTitle: "Memory", verdict: "insufficient data" })],
      [metric(), metric({ name: "Telemetry_FPS_Average", metricTitle: "FPS", higherIsBetter: true })],
    );

    expect(rows.map((row) => row.status)).toEqual(["regressed", "not-comparable", "not-comparable"]);
    expect(summarizeMetricComparison(rows)).toMatchObject({ regressedCount: 1, notComparableCount: 2, largestRegression: expect.objectContaining({ name: "Telemetry_First_Load_Time" }) });
  });

  it("reports equal observed values and verdicts as unchanged", () => {
    const rows = createMetricComparison([metric()], [metric()]);
    expect(rows[0]?.status).toBe("unchanged");
  });
});
