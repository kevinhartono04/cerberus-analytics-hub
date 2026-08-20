import fs from "node:fs";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";

import {
  getIncentConfigValidatorSettings,
  listIncentConfigValidatorSettings,
  saveIncentConfigValidatorSettings,
  type IncentConfigValidatorSettingsRecord,
} from "@/lib/db";
import { getCountQuery, submitCountSql, type CountQuery } from "@/lib/count-api";
import { techLaunchAppIds, techLaunchAppOptions } from "@/lib/tech-launch";

const sqlPath = path.join(process.cwd(), "data", "tech_launch_incent_config_validator.sql");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const incentConfigPolicy = {
  firstAdMinLevel: 3,
  firstAdMaxLevel: 6,
  minEligibleUsers: 100,
  densityBaselineHours: 48,
  densityZScoreThreshold: -3,
  evaluationBufferMinutes: 15,
  noAdsPurchaseLimit: 10,
} as const;

const mediaSourceSchema = z.string().trim().min(1).max(100).regex(/^[a-z0-9_.-]+$/i, "Media sources may contain letters, numbers, dots, underscores, and hyphens").transform((value) => value.toLowerCase());

export const incentConfigSettingsInputSchema = z.object({
  appName: z.enum(techLaunchAppOptions),
  mediaSources: z.array(mediaSourceSchema).min(1, "Add at least one media source").max(100).transform((values) => [...new Set(values)].sort()),
});

export const incentConfigValidatorFilterSchema = z.object({
  appName: z.enum(techLaunchAppOptions),
  startDate: z.string().regex(datePattern, "Use YYYY-MM-DD"),
  endDate: z.string().regex(datePattern, "Use YYYY-MM-DD"),
}).refine((filters) => filters.startDate <= filters.endDate, { path: ["endDate"], message: "End date must be on or after start date" });

export const incentConfigValidatorRequestSchema = incentConfigValidatorFilterSchema.extend({ forceRefresh: z.boolean().optional() });
export const incentConfigValidatorStatusRequestSchema = z.object({ jobKey: z.string().trim().min(1), filters: incentConfigValidatorFilterSchema });

export type IncentConfigValidatorFilters = z.infer<typeof incentConfigValidatorFilterSchema>;
export type IncentConfigValidatorSettings = IncentConfigValidatorSettingsRecord;
export type IncentVerdict = "pass" | "fail" | "insufficient_data";
export type DensityPoint = { eventHour: string; fipg: number | null; ripg: number | null; completedGames: number; eligibleUsers: number };
export type FirstAdHourlyPoint = { eventHour: string; medianLevel: number; users: number };
export type NoAdsHourlyPoint = { eventHour: string; purchaseEvents: number; purchasers: number };

export type IncentConfigValidatorResult = {
  status: "completed";
  filters: IncentConfigValidatorFilters;
  configuration: IncentConfigValidatorSettings;
  policy: typeof incentConfigPolicy;
  evaluatedHour: string;
  checks: {
    firstAd: { verdict: IncentVerdict; medianLevel: number | null; eligibleUsers: number; observedFirstAds: number; hourly: FirstAdHourlyPoint[] };
    fipg: { verdict: IncentVerdict; currentValue: number | null; baselineMean: number | null; baselineStddev: number | null; zScore: number | null; reason?: string };
    ripg: { verdict: IncentVerdict; currentValue: number | null; baselineMean: number | null; baselineStddev: number | null; zScore: number | null; reason?: string };
    noAds: { verdict: "pass" | "fail"; purchaseEvents: number; purchasers: number; peakHour?: string; hourly: NoAdsHourlyPoint[] };
  };
  densityPoints: DensityPoint[];
  metadata: { executedAt: string; durationMs?: number };
};

export type IncentConfigValidatorPendingResponse = {
  status: "running";
  filters: IncentConfigValidatorFilters;
  metadata: { jobKey: string; submittedAt: string };
  pollAfterMs: number;
};
export type IncentConfigValidatorRunResponse = IncentConfigValidatorResult | IncentConfigValidatorPendingResponse;

function sqlLiteral(value: string) { return `'${value.replaceAll("'", "''")}'`; }
function sqlTimestampLiteral(value: string) { return `TO_TIMESTAMP_NTZ(${sqlLiteral(value.replace("T", " ").replace("Z", ""))})`; }
function readBaseSql() { return fs.readFileSync(sqlPath, "utf8"); }
function replaceRequired(sql: string, pattern: RegExp, replacement: string) {
  if (!pattern.test(sql)) throw new Error("Could not apply Incent Config Validator SQL parameter replacement");
  return sql.replace(pattern, replacement);
}
function isoHour(value: Date) { return value.toISOString().replace(/\.\d{3}Z$/, "Z"); }
function hourBefore(value: string, hours: number) { const date = new Date(value); date.setUTCHours(date.getUTCHours() - hours); return isoHour(date); }
function startOfUtcHour(value: Date) { const hour = new Date(value); hour.setUTCMinutes(0, 0, 0); return hour; }

/** The latest hour whose end time has had the agreed 15-minute event buffer. */
export function latestIncentEvaluationHour(now = new Date()) {
  const buffered = new Date(now.getTime() - incentConfigPolicy.evaluationBufferMinutes * 60_000);
  buffered.setUTCMinutes(0, 0, 0);
  buffered.setUTCHours(buffered.getUTCHours() - 1);
  return isoHour(buffered);
}

export function normalizedIncentConfigValidatorFilters(input: unknown): IncentConfigValidatorFilters {
  return incentConfigValidatorFilterSchema.parse(input);
}

export function buildIncentConfigValidatorSql(filtersInput: unknown, configuration: IncentConfigValidatorSettings, now = new Date()) {
  const filters = normalizedIncentConfigValidatorFilters(filtersInput);
  const evaluationHour = latestIncentEvaluationHour(now);
  const densityStart = hourBefore(evaluationHour, incentConfigPolicy.densityBaselineHours);
  const densityEnd = hourBefore(evaluationHour, -1);
  const reportStart = `${filters.startDate} 00:00:00`;
  const selectedReportEndDate = new Date(`${filters.endDate}T00:00:00Z`);
  selectedReportEndDate.setUTCDate(selectedReportEndDate.getUTCDate() + 1);
  // Hourly charts must not generate future zero-value points when the
  // selected date includes today. The current hour is still in progress, so
  // keep the report end at its start and show only fully completed hours.
  const reportEndDate = new Date(Math.min(selectedReportEndDate.getTime(), startOfUtcHour(now).getTime()));
  const reportEnd = `${reportEndDate.toISOString().slice(0, 10)} 00:00:00`;
  const sourceStart = new Date(Math.min(Date.parse(`${filters.startDate}T00:00:00Z`), Date.parse(densityStart))).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
  const sourceEnd = new Date(Math.max(Date.parse(reportEnd.replace(" ", "T") + "Z"), Date.parse(densityEnd))).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
  let sql = readBaseSql();
  sql = replaceRequired(sql, /select to_timestamp_ntz\('[^']*'\) -- density start parameter/, `select ${sqlTimestampLiteral(densityStart)} -- density start parameter`);
  sql = replaceRequired(sql, /event_hour < to_timestamp_ntz\('[^']*'\) -- evaluation hour parameter/, `event_hour < ${sqlTimestampLiteral(evaluationHour)} -- evaluation hour parameter`);
  sql = replaceRequired(sql, /select to_timestamp_ntz\('[^']*'\) -- report hours start parameter/, `select ${sqlTimestampLiteral(reportStart + "Z")} -- report hours start parameter`);
  sql = replaceRequired(sql, /dateadd\(hour, 1, event_hour\) < to_timestamp_ntz\('[^']*'\) -- report hours end parameter/, `dateadd(hour, 1, event_hour) < ${sqlTimestampLiteral(reportEnd + "Z")} -- report hours end parameter`);
  sql = replaceRequired(sql, /lower\(media_source::varchar\) in \([^)]*\) -- media sources parameter/, `lower(media_source::varchar) in (${configuration.mediaSources.map(sqlLiteral).join(", ")}) -- media sources parameter`);
  sql = replaceRequired(sql, /ep\.app_id\s*=\s*\d+\s*-- app id parameter/, `ep.app_id = ${techLaunchAppIds[filters.appName]} -- app id parameter`);
  sql = replaceRequired(sql, /ep\.created_at\s*>=\s*to_timestamp_ntz\('[^']*'\)\s*-- source start parameter/, `ep.created_at >= ${sqlTimestampLiteral(sourceStart + "Z")} -- source start parameter`);
  sql = replaceRequired(sql, /ep\.created_at\s*<\s*to_timestamp_ntz\('[^']*'\)\s*-- source end parameter/, `ep.created_at < ${sqlTimestampLiteral(sourceEnd + "Z")} -- source end parameter`);
  sql = replaceRequired(sql, /created_at\s*>=\s*to_timestamp_ntz\('[^']*'\)\s*-- report start parameter/, `created_at >= ${sqlTimestampLiteral(reportStart + "Z")} -- report start parameter`);
  sql = replaceRequired(sql, /created_at\s*<\s*to_timestamp_ntz\('[^']*'\)\s*-- report end parameter/, `created_at < ${sqlTimestampLiteral(reportEnd + "Z")} -- report end parameter`);
  sql = replaceRequired(sql, /created_at\s*>=\s*to_timestamp_ntz\('[^']*'\)\s*-- density start parameter/, `created_at >= ${sqlTimestampLiteral(densityStart)} -- density start parameter`);
  sql = replaceRequired(sql, /created_at\s*<\s*to_timestamp_ntz\('[^']*'\)\s*-- density end parameter/, `created_at < ${sqlTimestampLiteral(densityEnd)} -- density end parameter`);
  return `${sql}\n-- incentive_config_revision: ${configuration.updatedAt}`;
}

function rowValue(row: Record<string, unknown>, key: string) { return row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()]; }
function numberOrNull(value: unknown) { if (value == null || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function nonNegativeInteger(value: unknown) { return Math.max(0, Math.round(Number(value) || 0)); }

type RawRow = { rowType: string; rowKey: string; eventHour: string; level: number | null; metricValue: number | null; eventCount: number; userCount: number };
function parseRows(resultPreview?: string): RawRow[] {
  if (!resultPreview?.trim()) return [];
  return (parseCsv(resultPreview, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, unknown>>).map((row) => ({
    rowType: String(rowValue(row, "row_type") ?? "").trim(), rowKey: String(rowValue(row, "row_key") ?? "").trim(), eventHour: String(rowValue(row, "event_hour") ?? "").trim(),
    level: numberOrNull(rowValue(row, "level")), metricValue: numberOrNull(rowValue(row, "metric_value")), eventCount: nonNegativeInteger(rowValue(row, "event_count")), userCount: nonNegativeInteger(rowValue(row, "user_count")),
  }));
}

function standardDeviation(values: number[], mean: number) {
  if (values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

export function evaluateIncentDensityMetric(points: DensityPoint[], metric: "fipg" | "ripg", evaluationHour: string) {
  const current = points.find((point) => point.eventHour === evaluationHour);
  if (!current || current.eligibleUsers < incentConfigPolicy.minEligibleUsers || current[metric] == null) {
    return { verdict: "insufficient_data" as const, currentValue: current?.[metric] ?? null, baselineMean: null, baselineStddev: null, zScore: null, reason: `Need ${incentConfigPolicy.minEligibleUsers} eligible users in the evaluated hour` };
  }
  const byHour = new Map(points.map((point) => [point.eventHour, point]));
  const baseline = Array.from({ length: incentConfigPolicy.densityBaselineHours }, (_, index) => byHour.get(hourBefore(evaluationHour, incentConfigPolicy.densityBaselineHours - index)));
  if (baseline.some((point) => !point || point.eligibleUsers < incentConfigPolicy.minEligibleUsers || point[metric] == null)) {
    return { verdict: "insufficient_data" as const, currentValue: current[metric], baselineMean: null, baselineStddev: null, zScore: null, reason: `Need ${incentConfigPolicy.densityBaselineHours} complete eligible baseline hours` };
  }
  const values = baseline.map((point) => point![metric]!);
  const baselineMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const baselineStddev = standardDeviation(values, baselineMean);
  if (!baselineStddev || baselineStddev <= Number.EPSILON) return { verdict: "insufficient_data" as const, currentValue: current[metric], baselineMean, baselineStddev, zScore: null, reason: "Baseline variance is zero" };
  const zScore = (current[metric]! - baselineMean) / baselineStddev;
  return { verdict: zScore <= incentConfigPolicy.densityZScoreThreshold ? "fail" as const : "pass" as const, currentValue: current[metric], baselineMean, baselineStddev, zScore };
}

export function evaluateIncentFirstAd({ eligibleUsers, medianLevel, observedFirstAds }: { eligibleUsers: number; medianLevel: number | null; observedFirstAds: number }) {
  const verdict: IncentVerdict = eligibleUsers < incentConfigPolicy.minEligibleUsers ? "insufficient_data" : observedFirstAds === 0 || medianLevel == null || medianLevel < incentConfigPolicy.firstAdMinLevel || medianLevel > incentConfigPolicy.firstAdMaxLevel ? "fail" : "pass";
  return { verdict, medianLevel, eligibleUsers, observedFirstAds };
}

export function evaluateNoAdsPurchases(purchaseEvents: number) {
  return purchaseEvents >= incentConfigPolicy.noAdsPurchaseLimit ? "fail" as const : "pass" as const;
}

function completedResponse(query: CountQuery, filters: IncentConfigValidatorFilters, configuration: IncentConfigValidatorSettings, now = new Date()): IncentConfigValidatorResult {
  if (query.status === "error") throw new Error(query.error ?? "Count query failed");
  if (query.status !== "completed") throw new Error("Count query is still running");
  const rows = parseRows(query.result_preview);
  const densityRows = rows.filter((row) => row.rowType === "density");
  const densityByHour = new Map<string, DensityPoint>();
  for (const row of densityRows) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(row.eventHour)) continue;
    const point = densityByHour.get(row.eventHour) ?? { eventHour: row.eventHour, fipg: null, ripg: null, completedGames: row.eventCount, eligibleUsers: row.userCount };
    point.completedGames = row.eventCount;
    point.eligibleUsers = row.userCount;
    if (row.rowKey === "fipg") point.fipg = row.metricValue;
    if (row.rowKey === "ripg") point.ripg = row.metricValue;
    densityByHour.set(row.eventHour, point);
  }
  const densityPoints = [...densityByHour.values()].sort((first, second) => first.eventHour.localeCompare(second.eventHour));
  const firstSummary = rows.find((row) => row.rowType === "first_ad_summary");
  const firstAdHourly = rows.filter((row) => row.rowType === "first_ad_hourly" && row.eventHour && row.metricValue != null).map((row) => ({ eventHour: row.eventHour, medianLevel: row.metricValue!, users: row.userCount })).sort((first, second) => first.eventHour.localeCompare(second.eventHour));
  const noAdsHourly = rows.filter((row) => row.rowType === "no_ads_hourly" && row.eventHour).map((row) => ({ eventHour: row.eventHour, purchaseEvents: row.eventCount, purchasers: row.userCount })).sort((first, second) => first.eventHour.localeCompare(second.eventHour));
  const noAdsPeak = noAdsHourly.reduce<NoAdsHourlyPoint | undefined>((peak, point) => !peak || point.purchaseEvents > peak.purchaseEvents ? point : peak, undefined);
  // Use the final generated density point as the source of truth. A Count job
  // can complete after the next 15-minute boundary, so recalculating from
  // `now` here could otherwise evaluate an hour that was not queried.
  const evaluatedHour = densityPoints.at(-1)?.eventHour ?? latestIncentEvaluationHour(now);
  return {
    status: "completed", filters, configuration, policy: incentConfigPolicy, evaluatedHour,
    checks: {
      firstAd: { ...evaluateIncentFirstAd({ eligibleUsers: firstSummary?.userCount ?? 0, medianLevel: firstSummary?.metricValue ?? null, observedFirstAds: firstSummary?.eventCount ?? 0 }), hourly: firstAdHourly },
      fipg: evaluateIncentDensityMetric(densityPoints, "fipg", evaluatedHour),
      ripg: evaluateIncentDensityMetric(densityPoints, "ripg", evaluatedHour),
      noAds: { verdict: evaluateNoAdsPurchases(noAdsPeak?.purchaseEvents ?? 0), purchaseEvents: noAdsPeak?.purchaseEvents ?? 0, purchasers: noAdsPeak?.purchasers ?? 0, ...(noAdsPeak ? { peakHour: noAdsPeak.eventHour } : {}), hourly: noAdsHourly },
    },
    densityPoints,
    metadata: { executedAt: new Date().toISOString(), ...(query.result_metadata?.duration ? { durationMs: query.result_metadata.duration } : {}) },
  };
}

async function configurationFor(appName: IncentConfigValidatorFilters["appName"]) {
  const configuration = await getIncentConfigValidatorSettings(appName);
  if (!configuration || !configuration.mediaSources.length) throw new Error(`No incentivized media sources are configured for ${appName}. An admin can add them below.`);
  return configuration;
}

export async function startIncentConfigValidator(input: unknown): Promise<IncentConfigValidatorRunResponse> {
  const request = incentConfigValidatorRequestSchema.parse(input);
  const filters = normalizedIncentConfigValidatorFilters(request);
  const configuration = await configurationFor(filters.appName);
  const submitted = await submitCountSql(buildIncentConfigValidatorSql(filters, configuration), { cacheStrategy: request.forceRefresh ? "force" : "default" });
  if (submitted.query.status === "error") return completedResponse(submitted.query, filters, configuration);
  if (submitted.query.status === "completed") return completedResponse((await getCountQuery(submitted.query.job_key, 1000)).query, filters, configuration);
  return { status: "running", filters, metadata: { jobKey: submitted.query.job_key, submittedAt: new Date().toISOString() }, pollAfterMs: 1500 };
}

export async function getIncentConfigValidatorStatus(input: unknown): Promise<IncentConfigValidatorRunResponse> {
  const request = incentConfigValidatorStatusRequestSchema.parse(input);
  const filters = normalizedIncentConfigValidatorFilters(request.filters);
  const configuration = await configurationFor(filters.appName);
  const result = await getCountQuery(request.jobKey, 1000);
  if (result.query.status === "running") return { status: "running", filters, metadata: { jobKey: request.jobKey, submittedAt: new Date().toISOString() }, pollAfterMs: 1500 };
  return completedResponse(result.query, filters, configuration);
}

export async function listIncentConfigValidatorConfigurations() { return listIncentConfigValidatorSettings(); }

export async function updateIncentConfigValidatorConfiguration(input: unknown, updatedBy: string) {
  const settings = incentConfigSettingsInputSchema.parse(input);
  const record: IncentConfigValidatorSettingsRecord = { ...settings, updatedAt: new Date().toISOString(), updatedBy };
  await saveIncentConfigValidatorSettings(record);
  return record;
}
