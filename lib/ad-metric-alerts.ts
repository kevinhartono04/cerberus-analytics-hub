import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";

import { listAdMetricAlertStates, markAdMetricAlertSlackDelivered, saveAdMetricAlertStates } from "@/lib/db";
import { type CountQuery } from "@/lib/count-api";
import { allAppVersionsAlertScope, allPlatformsAlertScope, gameplayAlertWebhookUrls, type GameplayAlertCronFilters } from "@/lib/gameplay-alerts";
import { techLaunchAppIds } from "@/lib/tech-launch";

const sqlPath = path.join(process.cwd(), "data", "tech_launch_ad_metric_alerts.sql");

export type AdMetric = "fipg" | "ripg";
export type HourlyAdMetricPoint = { eventHour: string; completedGames: number; fipg: number | null; ripg: number | null };
export type AdMetricAlertState = {
  alertKey: string;
  metric: AdMetric;
  appName: string;
  platform: string;
  appVersion: string;
  status: "open" | "resolved";
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  currentValue: number;
  baselineMean: number;
  baselineStddev: number;
  zScore: number;
  threshold: number;
  slackOpenDeliveredAt?: string;
};
export type AdMetricAlertTransition = { type: "opened"; state: AdMetricAlertState };

function sqlLiteral(value: string) { return `'${value.replaceAll("'", "''")}'`; }
function sqlList(values: string[]) { return values.map(sqlLiteral).join(", "); }
function replaceRequired(sql: string, pattern: RegExp, replacement: string) {
  if (!pattern.test(sql)) throw new Error("Could not apply ad metric alert SQL parameter replacement");
  return sql.replace(pattern, replacement);
}
function hourBefore(value: string, hours: number) {
  const date = new Date(value);
  date.setUTCHours(date.getUTCHours() - hours);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
function sqlTimestampLiteral(value: string) { return `TO_TIMESTAMP_NTZ(${sqlLiteral(value.replace("T", " ").replace("Z", ""))})`; }

/** Evaluate the just-finished UTC hour, never the partial in-progress hour. */
export function adMetricEvaluationHour(now = new Date()) {
  const currentHour = new Date(now);
  currentHour.setUTCMinutes(0, 0, 0);
  currentHour.setUTCHours(currentHour.getUTCHours() - 1);
  return currentHour.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The parent cron also serves 15-minute critical-level alerts; ad metrics submit only at :00. */
export function isAdMetricAlertCronWindow(now = new Date()) {
  return now.getUTCMinutes() === 0;
}

export function buildAdMetricAlertSql(filters: GameplayAlertCronFilters, now = new Date()) {
  const evaluationHour = adMetricEvaluationHour(now);
  const startHour = hourBefore(evaluationHour, 12);
  const endHour = hourBefore(evaluationHour, -1);
  let sql = fs.readFileSync(sqlPath, "utf8");
  sql = replaceRequired(sql, /select to_timestamp_ntz\('[^']*'\) -- modifiable parameter/, `select ${sqlTimestampLiteral(startHour)} -- modifiable parameter`);
  sql = replaceRequired(sql, /event_hour < to_timestamp_ntz\('[^']*'\) -- modifiable parameter/, `event_hour < ${sqlTimestampLiteral(evaluationHour)} -- modifiable parameter`);
  sql = replaceRequired(sql, /ep\.app_id\s*=\s*\d+\s*-- modifiable parameter/, `ep.app_id = ${techLaunchAppIds[filters.appName as keyof typeof techLaunchAppIds]} -- modifiable parameter`);
  sql = replaceRequired(sql, /ep\.platform\s+in\s*\([^)]*\)\s*-- modifiable parameter/, `ep.platform in (${sqlList(filters.platforms)}) -- modifiable parameter`);
  sql = replaceRequired(sql, /ep\.app_version\s+in\s*\([^)]*\)\s*-- modifiable parameter/, filters.appVersions.length ? `ep.app_version in (${sqlList(filters.appVersions)}) -- modifiable parameter` : "1 = 1 -- modifiable parameter");
  sql = replaceRequired(sql, /ep\.created_at\s*>=\s*to_timestamp_ntz\('[^']*'\)\s*-- modifiable parameter\s*and\s+ep\.created_at\s*<\s*to_timestamp_ntz\('[^']*'\)\s*-- modifiable parameter/i, `ep.created_at >= ${sqlTimestampLiteral(startHour)} -- modifiable parameter\n    and ep.created_at < ${sqlTimestampLiteral(endHour)} -- modifiable parameter`);
  return sql;
}

function rowValue(row: Record<string, unknown>, key: string) { return row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()]; }
function nullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseHourlyAdMetricRows(resultPreview?: string): HourlyAdMetricPoint[] {
  if (!resultPreview?.trim()) return [];
  return (parseCsv(resultPreview, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, unknown>>)
    .map((row) => ({
      eventHour: String(rowValue(row, "event_hour") ?? "").trim(),
      completedGames: Math.max(0, Math.round(Number(rowValue(row, "completed_games")) || 0)),
      fipg: nullableNumber(rowValue(row, "fipg")),
      ripg: nullableNumber(rowValue(row, "ripg")),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(row.eventHour))
    .sort((first, second) => first.eventHour.localeCompare(second.eventHour));
}

function standardDeviation(values: number[], mean: number) {
  if (values.length < 2) return null;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function evaluateAdMetricAnomalies(points: HourlyAdMetricPoint[], evaluationHour: string, zScoreThreshold: number) {
  const current = points.find((point) => point.eventHour === evaluationHour);
  if (!current || current.completedGames === 0) return [];
  const baselineHours = Array.from({ length: 12 }, (_, index) => hourBefore(evaluationHour, 12 - index));
  const baselineByHour = new Map(points.map((point) => [point.eventHour, point]));
  return (["fipg", "ripg"] as const).flatMap((metric) => {
    const baseline = baselineHours.map((hour) => baselineByHour.get(hour)?.[metric]).filter((value): value is number => value != null);
    const currentValue = current[metric];
    // A full twelve-hour baseline avoids treating a new or sparsely instrumented
    // game as an anomaly. Zero variance is intentionally not an alert.
    if (baseline.length !== 12 || currentValue == null) return [];
    const baselineMean = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
    const baselineStddev = standardDeviation(baseline, baselineMean);
    if (!baselineStddev || baselineStddev <= Number.EPSILON) return [];
    const zScore = (currentValue - baselineMean) / baselineStddev;
    return zScore <= -zScoreThreshold ? [{ metric, currentValue, baselineMean, baselineStddev, zScore }] : [];
  });
}

export function adMetricAlertEvaluationKey(filters: GameplayAlertCronFilters, now = new Date()) {
  return ["ad-metrics", filters.appName, filters.platform, filters.appVersion, adMetricEvaluationHour(now)].join(":");
}

function stateScope(filters: GameplayAlertCronFilters) {
  return { appName: filters.appName, platform: filters.platform, appVersion: filters.appVersion };
}
function alertKey(metric: AdMetric, filters: GameplayAlertCronFilters) { return ["ad-metric", metric, filters.appName, filters.platform, filters.appVersion].join(":"); }

export async function reconcileAdMetricAlertsFromQuery(filters: GameplayAlertCronFilters, query: CountQuery, zScoreThreshold: number, now = new Date()) {
  if (query.status === "error") throw new Error(query.error ?? "Count query failed");
  if (query.status !== "completed") throw new Error("Count query is still running");
  const evaluatedAt = new Date().toISOString();
  const points = parseHourlyAdMetricRows(query.result_preview);
  const anomalies = evaluateAdMetricAnomalies(points, adMetricEvaluationHour(now), zScoreThreshold);
  const existing = new Map((await listAdMetricAlertStates(stateScope(filters))).map((state) => [state.alertKey, state]));
  const current = new Map(anomalies.map((anomaly) => [alertKey(anomaly.metric, filters), anomaly]));
  const next: AdMetricAlertState[] = [];
  const transitions: AdMetricAlertTransition[] = [];
  for (const [key, anomaly] of current) {
    const previous = existing.get(key);
    const state: AdMetricAlertState = {
      alertKey: key, metric: anomaly.metric, ...stateScope(filters), status: "open",
      firstSeenAt: previous?.status === "open" ? previous.firstSeenAt : evaluatedAt, lastSeenAt: evaluatedAt,
      currentValue: anomaly.currentValue, baselineMean: anomaly.baselineMean, baselineStddev: anomaly.baselineStddev, zScore: anomaly.zScore, threshold: zScoreThreshold,
      ...(previous?.slackOpenDeliveredAt ? { slackOpenDeliveredAt: previous.slackOpenDeliveredAt } : {}),
    };
    next.push(state);
    if (previous?.status !== "open" || !previous.slackOpenDeliveredAt) transitions.push({ type: "opened", state });
  }
  for (const [key, previous] of existing) {
    if (current.has(key) || previous.status !== "open") continue;
    next.push({ ...previous, status: "resolved", lastSeenAt: evaluatedAt, resolvedAt: evaluatedAt });
  }
  await saveAdMetricAlertStates(next);
  return { points, anomalies, transitions };
}

export async function undeliveredAdMetricAlertTransitions(filters: GameplayAlertCronFilters): Promise<AdMetricAlertTransition[]> {
  return (await listAdMetricAlertStates(stateScope(filters)))
    .filter((state) => state.status === "open" && !state.slackOpenDeliveredAt)
    .map((state) => ({ type: "opened" as const, state }));
}

function scopeLabel(value: string, all: string, label: string) { return value === all ? `All ${label}` : value; }
function metricLabel(metric: AdMetric) { return metric.toUpperCase(); }
export function formatAdMetricAlertSlackMessage(transitions: AdMetricAlertTransition[]) {
  return ["*Ad engagement anomaly alert*", ...transitions.sort((a, b) => a.state.metric.localeCompare(b.state.metric)).map(({ state }) => [
    `*Game:* ${state.appName}`,
    `*Platform:* ${scopeLabel(state.platform, allPlatformsAlertScope, "platforms")}`,
    `*Version:* ${scopeLabel(state.appVersion, allAppVersionsAlertScope, "versions")}`,
    `• ${metricLabel(state.metric)}: ${(state.currentValue).toFixed(3)} vs ${(state.baselineMean).toFixed(3)} 12-hour mean · z-score ${state.zScore.toFixed(2)} (threshold ≤ −${state.threshold.toFixed(1)})`,
  ].join("\n"))].join("\n\n");
}

export async function deliverAdMetricAlertTransitions(transitions: AdMetricAlertTransition[]) {
  const webhooks = gameplayAlertWebhookUrls();
  if (!webhooks.length || !transitions.length) return { delivered: 0, skipped: transitions.length, configured: webhooks.length > 0 };
  const body = JSON.stringify({ text: formatAdMetricAlertSlackMessage(transitions) });
  const responses = await Promise.all(webhooks.map((webhook) => fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body })));
  const failed = responses.find((response) => !response.ok);
  if (failed) throw new Error(`Slack webhook returned ${failed.status}`);
  await markAdMetricAlertSlackDelivered(transitions.map((transition) => transition.state.alertKey), new Date().toISOString());
  return { delivered: transitions.length, skipped: 0, configured: true };
}
