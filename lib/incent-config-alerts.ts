import fs from "node:fs";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";

import { getCountQuery, submitCountSql, type CountQuery } from "@/lib/count-api";
import { listIncentConfigValidatorSettings, type IncentConfigValidatorSettingsRecord } from "@/lib/db";
import { incentConfigPolicy, evaluateIncentDensityMetric, latestIncentEvaluationHour, type DensityPoint } from "@/lib/incent-config-validator";
import { gameplayAlertWebhookUrls } from "@/lib/gameplay-alerts";
import { newSlackDeliveryTraceId, postSlackWebhookMessage, type SlackQueryTrace } from "@/lib/slack-delivery";
import { techLaunchAppIds } from "@/lib/tech-launch";

const sqlPath = path.join(process.cwd(), "data", "tech_launch_incent_config_alerts.sql");

export type IncentConfigAlertKind = "first_interstitial" | "fipg" | "ripg" | "no_ads";
export type IncentConfigAlert = { kind: IncentConfigAlertKind; appName: string; evaluationHour: string; currentValue: number; sampleUsers: number; baselineMean?: number; zScore?: number; queryTrace?: SlackQueryTrace };
type RawRow = { rowType: string; rowKey: string; eventHour: string; metricValue: number | null; eventCount: number; userCount: number };

function sqlLiteral(value: string) { return `'${value.replaceAll("'", "''")}'`; }
function sqlTimestampLiteral(value: string) { return `TO_TIMESTAMP_NTZ(${sqlLiteral(value.replace("T", " ").replace("Z", ""))})`; }
function hourBefore(value: string, hours: number) { const date = new Date(value); date.setUTCHours(date.getUTCHours() - hours); return date.toISOString().replace(/\.\d{3}Z$/, "Z"); }
function replaceRequired(sql: string, pattern: RegExp, replacement: string) { if (!pattern.test(sql)) throw new Error("Could not apply Incent Config alert SQL parameter replacement"); return sql.replace(pattern, replacement); }
function rowValue(row: Record<string, unknown>, key: string) { return row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()]; }
function numeric(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function nonNegativeInteger(value: unknown) { return Math.max(0, Math.round(Number(value) || 0)); }

export function incentConfigAlertEvaluationHour(now = new Date()) { return latestIncentEvaluationHour(now); }
/** Submit at :15, after the agreed ingestion buffer; later calls poll that job. */
export function shouldSubmitIncentConfigAlert(now = new Date()) { return now.getUTCMinutes() === incentConfigPolicy.evaluationBufferMinutes; }
export function incentConfigAlertPreviousEvaluationHour(now = new Date()) { return hourBefore(incentConfigAlertEvaluationHour(now), 1); }
export function incentConfigAlertEvaluationKeyForHour(appName: string, evaluationHour: string) { return ["incent-config", appName, evaluationHour].join(":"); }
export function incentConfigAlertEvaluationKey(appName: string, now = new Date()) { return incentConfigAlertEvaluationKeyForHour(appName, incentConfigAlertEvaluationHour(now)); }

export function buildIncentConfigAlertSql(configuration: IncentConfigValidatorSettingsRecord, now = new Date()) {
  const evaluationHour = incentConfigAlertEvaluationHour(now);
  const densityStart = hourBefore(evaluationHour, incentConfigPolicy.densityBaselineHours);
  const evaluationEnd = hourBefore(evaluationHour, -1);
  let sql = fs.readFileSync(sqlPath, "utf8");
  sql = replaceRequired(sql, /select to_timestamp_ntz\('[^']*'\) -- density start parameter/, `select ${sqlTimestampLiteral(densityStart)} -- density start parameter`);
  sql = replaceRequired(sql, /event_hour < to_timestamp_ntz\('[^']*'\) -- evaluation hour parameter/, `event_hour < ${sqlTimestampLiteral(evaluationHour)} -- evaluation hour parameter`);
  sql = replaceRequired(sql, /lower\(media_source::varchar\) in \([^)]*\) -- media sources parameter/, `lower(media_source::varchar) in (${configuration.mediaSources.map(sqlLiteral).join(", ")}) -- media sources parameter`);
  sql = replaceRequired(sql, /ep\.app_id\s*=\s*\d+\s*-- app id parameter/, `ep.app_id = ${techLaunchAppIds[configuration.appName as keyof typeof techLaunchAppIds]} -- app id parameter`);
  sql = replaceRequired(sql, /ep\.created_at\s*<\s*to_timestamp_ntz\('[^']*'\)\s*-- evaluation end parameter/, `ep.created_at < ${sqlTimestampLiteral(evaluationEnd)} -- evaluation end parameter`);
  sql = replaceRequired(sql, /created_at\s*>=\s*to_timestamp_ntz\('[^']*'\)\s*-- density start parameter/, `created_at >= ${sqlTimestampLiteral(densityStart)} -- density start parameter`);
  sql = replaceRequired(sql, /created_at\s*<\s*to_timestamp_ntz\('[^']*'\)\s*-- evaluation end parameter/, `created_at < ${sqlTimestampLiteral(evaluationEnd)} -- evaluation end parameter`);
  sql = replaceRequired(sql, /created_at\s*>=\s*to_timestamp_ntz\('[^']*'\)\s*-- evaluation hour parameter/, `created_at >= ${sqlTimestampLiteral(evaluationHour)} -- evaluation hour parameter`);
  const outputHourPattern = /to_varchar\(to_timestamp_ntz\('[^']*'\), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'\) as event_hour/g;
  if (!outputHourPattern.test(sql)) throw new Error("Could not apply Incent Config alert output-hour replacement");
  outputHourPattern.lastIndex = 0;
  sql = sql.replace(outputHourPattern, `to_varchar(${sqlTimestampLiteral(evaluationHour)}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_hour`);
  sql = replaceRequired(sql, /event_hour = to_timestamp_ntz\('[^']*'\) -- evaluation hour parameter/, `event_hour = ${sqlTimestampLiteral(evaluationHour)} -- evaluation hour parameter`);
  return sql;
}

function parseRows(resultPreview?: string): RawRow[] {
  if (!resultPreview?.trim()) return [];
  return (parseCsv(resultPreview, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, unknown>>).map((row) => ({
    rowType: String(rowValue(row, "row_type") ?? "").trim(), rowKey: String(rowValue(row, "row_key") ?? "").trim(), eventHour: String(rowValue(row, "event_hour") ?? "").trim(),
    metricValue: numeric(rowValue(row, "metric_value")), eventCount: nonNegativeInteger(rowValue(row, "event_count")), userCount: nonNegativeInteger(rowValue(row, "user_count")),
  }));
}

export function alertsFromIncentConfigQuery(configuration: IncentConfigValidatorSettingsRecord, query: CountQuery, now = new Date(), expectedEvaluationHour = incentConfigAlertEvaluationHour(now)) {
  if (query.status === "error") throw new Error(query.error ?? "Count query failed");
  if (query.status !== "completed") throw new Error("Count query is still running");
  const evaluationHour = expectedEvaluationHour;
  const rows = parseRows(query.result_preview);
  const densityByHour = new Map<string, DensityPoint>();
  for (const row of rows.filter((row) => row.rowType === "density")) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(row.eventHour)) continue;
    const point = densityByHour.get(row.eventHour) ?? { eventHour: row.eventHour, fipg: null, ripg: null, completedGames: row.eventCount, eligibleUsers: row.userCount };
    point.completedGames = row.eventCount; point.eligibleUsers = row.userCount;
    if (row.rowKey === "fipg") point.fipg = row.metricValue;
    if (row.rowKey === "ripg") point.ripg = row.metricValue;
    densityByHour.set(row.eventHour, point);
  }
  const density = [...densityByHour.values()].sort((a, b) => a.eventHour.localeCompare(b.eventHour));
  const alerts: IncentConfigAlert[] = [];
  const first = rows.find((row) => row.rowType === "first_interstitial" && row.eventHour === evaluationHour);
  if (first && first.userCount > incentConfigPolicy.minEligibleUsers && (first.metricValue ?? Number.NEGATIVE_INFINITY) > incentConfigPolicy.firstAdMaxLevel) alerts.push({ kind: "first_interstitial", appName: configuration.appName, evaluationHour, currentValue: first.metricValue!, sampleUsers: first.userCount });
  for (const metric of ["fipg", "ripg"] as const) {
    const result = evaluateIncentDensityMetric(density, metric, evaluationHour);
    if (result.verdict === "fail" && result.currentValue != null && result.baselineMean != null && result.zScore != null) alerts.push({ kind: metric, appName: configuration.appName, evaluationHour, currentValue: result.currentValue, sampleUsers: density.find((point) => point.eventHour === evaluationHour)?.eligibleUsers ?? 0, baselineMean: result.baselineMean, zScore: result.zScore });
  }
  const noAds = rows.find((row) => row.rowType === "no_ads" && row.eventHour === evaluationHour);
  if (noAds && noAds.userCount >= incentConfigPolicy.minEligibleUsers && noAds.eventCount > incentConfigPolicy.noAdsPurchaseLimit) alerts.push({ kind: "no_ads", appName: configuration.appName, evaluationHour, currentValue: noAds.eventCount, sampleUsers: noAds.userCount });
  return { alerts, evaluationHour, density };
}

export async function listIncentConfigAlertConfigurations() { return (await listIncentConfigValidatorSettings()).filter((configuration) => configuration.mediaSources.length); }
export async function submitIncentConfigAlertQuery(configuration: IncentConfigValidatorSettingsRecord, now = new Date()) { return (await submitCountSql(buildIncentConfigAlertSql(configuration, now), { cacheStrategy: "force" })).query; }
export async function getIncentConfigAlertQuery(jobKey: string) { return (await getCountQuery(jobKey, 1000)).query; }

function label(kind: IncentConfigAlertKind) { return kind === "first_interstitial" ? "First interstitial median level" : kind === "no_ads" ? "No-ads purchases" : kind.toUpperCase(); }
export function formatIncentConfigAlertSlackMessage(alerts: IncentConfigAlert[], traceId?: string, queryTraces: SlackQueryTrace[] = []) {
  return ["*Incent Config Validator alert*", ...alerts.map((alert) => {
    const detail = alert.kind === "first_interstitial" ? `${alert.currentValue.toFixed(1)} (threshold > ${incentConfigPolicy.firstAdMaxLevel})` : alert.kind === "no_ads" ? `${alert.currentValue} purchases (threshold > ${incentConfigPolicy.noAdsPurchaseLimit})` : `${alert.currentValue.toFixed(3)} vs ${alert.baselineMean!.toFixed(3)} baseline · z-score ${alert.zScore!.toFixed(2)} (threshold ≤ ${incentConfigPolicy.densityZScoreThreshold})`;
    return [`*Game:* ${alert.appName}`, `*Hour:* ${alert.evaluationHour}`, `• ${label(alert.kind)}: ${detail} · ${alert.sampleUsers} eligible users`].join("\n");
  }), ...(traceId ? [`_Delivery trace: ${traceId}_`] : []), ...(queryTraces.length ? [`_Query jobs: ${queryTraces.map((trace) => `\`${trace.jobKey}\``).join(", ")}_`] : [])].join("\n\n");
}
export async function deliverIncentConfigAlerts(alerts: IncentConfigAlert[]) {
  const webhooks = gameplayAlertWebhookUrls();
  if (!alerts.length) return { delivered: 0, skipped: 0, configured: webhooks.length > 0 };
  const traceId = newSlackDeliveryTraceId("incent-config-alert");
  const queryTraces = [...new Map(alerts.flatMap((alert) => alert.queryTrace ? [[alert.queryTrace.jobKey, alert.queryTrace] as const] : [])).values()];
  if (!webhooks.length) return { delivered: 0, skipped: alerts.length, configured: false, trace: await postSlackWebhookMessage([], "", traceId, queryTraces) };
  const trace = await postSlackWebhookMessage(webhooks, JSON.stringify({ text: formatIncentConfigAlertSlackMessage(alerts, traceId, queryTraces) }), traceId, queryTraces);
  return { delivered: alerts.length, skipped: 0, configured: true, trace };
}
