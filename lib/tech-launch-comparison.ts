export type TechLaunchVerdict = "green" | "yellow" | "red" | "insufficient data";

export type ComparableMetricRow = {
  name: string;
  metricTitle: string;
  p50Value: number | null;
  p80Value: number | null;
  benchmark: number | null;
  numSample: number;
  verdict: TechLaunchVerdict;
  higherIsBetter: boolean;
};

export type MetricComparisonStatus = "regressed" | "improved" | "unchanged" | "not-comparable";

export type ComparisonMetricRow = {
  name: string;
  metricTitle: string;
  baseline: ComparableMetricRow | null;
  comparison: ComparableMetricRow | null;
  baselineValue: number | null;
  comparisonValue: number | null;
  absoluteDelta: number | null;
  relativeDelta: number | null;
  status: MetricComparisonStatus;
};

export type ComparisonSummary = {
  regressedCount: number;
  improvedCount: number;
  unchangedCount: number;
  notComparableCount: number;
  largestRegression: ComparisonMetricRow | null;
};

const metricOrder = [
  "Telemetry_First_Load_Time",
  "Telemetry_Subsequent_Load_Time",
  "Telemetry_FPS_Average",
  "Telemetry_FPS_Stability",
  "Telemetry_Runtime_Memory_Use",
  "Telemetry_ThermalState",
  "GooglePlay_UserPerceivedCrashRate7d",
  "GooglePlay_UserPerceivedAnrRate7d",
  "GooglePlay_UserPerceivedLmkRate7d",
];

function observedValue(row: ComparableMetricRow) {
  // Google Play rates are stored in p50Value, while telemetry uses P80 for
  // lower-is-better measurements.
  return row.higherIsBetter ? row.p50Value : row.p80Value ?? row.p50Value;
}

function verdictRank(verdict: TechLaunchVerdict) {
  if (verdict === "green") return 3;
  if (verdict === "yellow") return 2;
  if (verdict === "red") return 1;
  return 0;
}

function comparisonStatus(
  baseline: ComparableMetricRow | null,
  comparison: ComparableMetricRow | null,
  baselineValue: number | null,
  comparisonValue: number | null,
): MetricComparisonStatus {
  if (
    !baseline ||
    !comparison ||
    baseline.verdict === "insufficient data" ||
    comparison.verdict === "insufficient data" ||
    baselineValue === null ||
    comparisonValue === null
  ) {
    return "not-comparable";
  }

  const verdictDelta = verdictRank(baseline.verdict) - verdictRank(comparison.verdict);
  if (verdictDelta < 0) return "regressed";
  if (verdictDelta > 0) return "improved";

  // The selected baseline is the release under review; the comparison side
  // is its reference. All change labels therefore describe the baseline
  // relative to the reference, not the reference relative to the baseline.
  const rawDelta = baselineValue - comparisonValue;
  if (rawDelta === 0) return "unchanged";
  const directionalDelta = baseline.higherIsBetter ? rawDelta : -rawDelta;
  return directionalDelta < 0 ? "regressed" : "improved";
}

function compareRows(a: ComparisonMetricRow, b: ComparisonMetricRow) {
  const aOrder = metricOrder.indexOf(a.name);
  const bOrder = metricOrder.indexOf(b.name);
  const orderDelta = (aOrder < 0 ? Number.MAX_SAFE_INTEGER : aOrder) - (bOrder < 0 ? Number.MAX_SAFE_INTEGER : bOrder);
  if (orderDelta) return orderDelta;
  return a.metricTitle.localeCompare(b.metricTitle);
}

export function createMetricComparison(
  baselineRows: ComparableMetricRow[],
  comparisonRows: ComparableMetricRow[],
): ComparisonMetricRow[] {
  const baselineByName = new Map(baselineRows.map((row) => [row.name, row]));
  const comparisonByName = new Map(comparisonRows.map((row) => [row.name, row]));
  const names = new Set([...baselineByName.keys(), ...comparisonByName.keys()]);

  return [...names]
    .map((name) => {
      const baseline = baselineByName.get(name) ?? null;
      const comparison = comparisonByName.get(name) ?? null;
      const baselineValue = baseline ? observedValue(baseline) : null;
      const comparisonValue = comparison ? observedValue(comparison) : null;
      const absoluteDelta = baselineValue === null || comparisonValue === null ? null : baselineValue - comparisonValue;
      const relativeDelta = absoluteDelta === null || comparisonValue === null || comparisonValue === 0 ? null : absoluteDelta / Math.abs(comparisonValue);
      return {
        name,
        metricTitle: baseline?.metricTitle ?? comparison?.metricTitle ?? name,
        baseline,
        comparison,
        baselineValue,
        comparisonValue,
        absoluteDelta,
        relativeDelta,
        status: comparisonStatus(baseline, comparison, baselineValue, comparisonValue),
      };
    })
    .sort(compareRows);
}

export function summarizeMetricComparison(rows: ComparisonMetricRow[]): ComparisonSummary {
  const byStatus = (status: MetricComparisonStatus) => rows.filter((row) => row.status === status);
  return {
    regressedCount: byStatus("regressed").length,
    improvedCount: byStatus("improved").length,
    unchangedCount: byStatus("unchanged").length,
    notComparableCount: byStatus("not-comparable").length,
    largestRegression: byStatus("regressed")[0] ?? null,
  };
}
