import fs from "node:fs";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";

import { getCountQuery, submitCountSql, type CountQuery } from "@/lib/count-api";
import { techLaunchAppIds, techLaunchAppOptions, techLaunchPlatformOptions } from "@/lib/tech-launch";

const sqlPath = path.join(process.cwd(), "data", "tech_launch_game_monitoring.sql");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const gameMonitoringFilterSchema = z.object({
  appName: z.enum(techLaunchAppOptions),
  platforms: z.array(z.enum(techLaunchPlatformOptions)).min(1).max(techLaunchPlatformOptions.length),
  appVersions: z.array(z.string().trim().min(1).max(80)).max(100),
  startDate: z.string().regex(datePattern, "Use YYYY-MM-DD"),
  endDate: z.string().regex(datePattern, "Use YYYY-MM-DD"),
}).refine((filters) => filters.startDate <= filters.endDate, {
  path: ["endDate"], message: "End date must be on or after start date",
}).refine((filters) => (Date.parse(`${filters.endDate}T00:00:00Z`) - Date.parse(`${filters.startDate}T00:00:00Z`)) / 86_400_000 <= 9, {
  path: ["endDate"], message: "Hourly monitoring supports a maximum ten-day date range",
});

export const gameMonitoringRequestSchema = gameMonitoringFilterSchema.extend({ forceRefresh: z.boolean().optional() });
export const gameMonitoringStatusRequestSchema = z.object({ jobKey: z.string().trim().min(1), filters: gameMonitoringFilterSchema });

export type GameMonitoringFilters = z.infer<typeof gameMonitoringFilterSchema>;
export type GameMonitoringCohort = "d0" | "d1_plus";
export type GameMonitoringPoint = {
  eventDate: string;
  platform: "android" | "ios";
  eventHour: number;
  cohortSegment: GameMonitoringCohort;
  hourlyActiveUsers: number;
  installUsers: number;
  cumulativeInstalls: number;
  purchaseSuccessEvents: number;
  purchasers: number;
  payerRate: number | null;
  sessionStartEvents: number;
  gameStartEvents: number;
  sessionStartUsers: number;
  gameStartUsers: number;
  gameStartRate: number | null;
  gameStartActiveRate: number | null;
  interstitialImpressions: number;
  rewardedImpressions: number;
  bannerImpressions: number;
  fipu: number | null;
  ripu: number | null;
  bipu: number | null;
};

export type GameMonitoringResponse = {
  status: "completed" | "unavailable";
  filters: GameMonitoringFilters;
  points: GameMonitoringPoint[];
  summary: { latestEventDate?: string; lastEventAt?: string; unavailableReason?: string };
  metadata: { executedAt: string; durationMs?: number };
};

export type GameMonitoringPendingResponse = {
  status: "running";
  filters: GameMonitoringFilters;
  metadata: { jobKey: string; submittedAt: string };
  pollAfterMs: number;
};

export type GameMonitoringRunResponse = GameMonitoringResponse | GameMonitoringPendingResponse;

export function normalizedGameMonitoringFilters(input: unknown): GameMonitoringFilters {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const platforms = Array.isArray(source.platforms) ? source.platforms : source.platform ? [source.platform] : ["android"];
  const appVersions = Array.isArray(source.appVersions) ? source.appVersions : source.appVersion ? [source.appVersion] : [];
  return gameMonitoringFilterSchema.parse({
    ...source,
    platforms: [...new Set(platforms.map((value) => String(value).trim().toLowerCase()))].sort(),
    appVersions: [...new Set(appVersions.map((value) => String(value).trim()).filter(Boolean))].sort(),
  });
}

function sqlLiteral(value: string) { return `'${value.replaceAll("'", "''")}'`; }
function sqlDateLiteral(value: string) { return `TO_DATE(${sqlLiteral(value)})`; }
function sqlList(values: string[]) { return values.map(sqlLiteral).join(", "); }
function readBaseSql() { return fs.readFileSync(sqlPath, "utf8"); }
function replaceRequired(sql: string, pattern: RegExp, replacement: string) {
  if (!pattern.test(sql)) throw new Error("Could not apply Game Monitoring SQL parameter replacement");
  return sql.replace(pattern, replacement);
}

export function buildGameMonitoringSql(input: unknown) {
  const filters = normalizedGameMonitoringFilters(input);
  let sql = readBaseSql();
  sql = replaceRequired(sql, /select to_date\('[^']*'\) -- modifiable parameter/, `select ${sqlDateLiteral(filters.startDate)} -- modifiable parameter`);
  sql = replaceRequired(sql, /event_date < to_date\('[^']*'\) -- modifiable parameter/, `event_date < ${sqlDateLiteral(filters.endDate)} -- modifiable parameter`);
  sql = replaceRequired(sql, /ep\.app_id\s*=\s*\d+\s*-- modifiable parameter/, `ep.app_id = ${techLaunchAppIds[filters.appName]} -- modifiable parameter`);
  sql = replaceRequired(sql, /select column1::string as platform from values \([^)]*\) -- modifiable parameter/, `select column1::string as platform from values ${filters.platforms.map((platform) => `(${sqlLiteral(platform)})`).join(", ")} -- modifiable parameter`);
  sql = replaceRequired(sql, /ep\.app_version\s+in\s*\([^)]*\)\s*-- modifiable parameter/, filters.appVersions.length ? `ep.app_version in (${sqlList(filters.appVersions)}) -- modifiable parameter` : "1 = 1 -- modifiable parameter");
  sql = replaceRequired(
    sql,
    /ep\.created_at\s*>=\s*current_date\(\)\s*-\s*7\s*-- modifiable parameter\s*and\s+ep\.created_at\s*<\s*dateadd\(day,\s*1,\s*current_date\(\)\)\s*-- modifiable parameter/i,
    `ep.created_at >= ${sqlDateLiteral(filters.startDate)} -- modifiable parameter\n    and ep.created_at < DATEADD(day, 1, ${sqlDateLiteral(filters.endDate)}) -- modifiable parameter`,
  );
  return sql;
}

function rowValue(row: Record<string, unknown>, key: string) { return row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()]; }
function numberValue(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function nullableNumber(value: unknown) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }

export function parseGameMonitoringRows(resultPreview?: string): { points: GameMonitoringPoint[]; lastEventAt?: string } {
  if (!resultPreview?.trim()) return { points: [] };
  const rows = parseCsv(resultPreview, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, unknown>>;
  let lastEventAt: string | undefined;
  const points = rows.map((row): GameMonitoringPoint | null => {
    const eventDate = String(rowValue(row, "event_date") ?? "").trim();
    const cohortSegment = String(rowValue(row, "cohort_segment") ?? "").trim();
    const platform = String(rowValue(row, "platform") ?? "").trim().toLowerCase();
    const eventHour = Math.round(numberValue(rowValue(row, "event_hour")));
    const rawLastEventAt = String(rowValue(row, "last_event_at") ?? "").trim();
    if (rawLastEventAt) lastEventAt = rawLastEventAt;
    if (!datePattern.test(eventDate) || (cohortSegment !== "d0" && cohortSegment !== "d1_plus") || (platform !== "android" && platform !== "ios") || eventHour < 0 || eventHour > 23) return null;
    return {
      eventDate, platform, eventHour, cohortSegment,
      hourlyActiveUsers: Math.max(0, Math.round(numberValue(rowValue(row, "hourly_active_users")))),
      installUsers: Math.max(0, Math.round(numberValue(rowValue(row, "install_users")))),
      cumulativeInstalls: Math.max(0, Math.round(numberValue(rowValue(row, "cumulative_installs")))),
      purchaseSuccessEvents: Math.max(0, Math.round(numberValue(rowValue(row, "purchase_success_events")))),
      purchasers: Math.max(0, Math.round(numberValue(rowValue(row, "purchasers")))),
      payerRate: nullableNumber(rowValue(row, "payer_rate")),
      sessionStartEvents: Math.max(0, Math.round(numberValue(rowValue(row, "session_start_events")))),
      gameStartEvents: Math.max(0, Math.round(numberValue(rowValue(row, "game_start_events")))),
      sessionStartUsers: Math.max(0, Math.round(numberValue(rowValue(row, "session_start_users")))),
      gameStartUsers: Math.max(0, Math.round(numberValue(rowValue(row, "game_start_users")))),
      gameStartRate: nullableNumber(rowValue(row, "game_start_rate")),
      gameStartActiveRate: nullableNumber(rowValue(row, "game_start_active_rate")),
      interstitialImpressions: Math.max(0, Math.round(numberValue(rowValue(row, "interstitial_impressions")))),
      rewardedImpressions: Math.max(0, Math.round(numberValue(rowValue(row, "rewarded_impressions")))),
      bannerImpressions: Math.max(0, Math.round(numberValue(rowValue(row, "banner_impressions")))),
      fipu: nullableNumber(rowValue(row, "fipu")),
      ripu: nullableNumber(rowValue(row, "ripu")),
      bipu: nullableNumber(rowValue(row, "bipu")),
    };
  }).filter((point): point is GameMonitoringPoint => point !== null).sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.platform.localeCompare(b.platform) || a.cohortSegment.localeCompare(b.cohortSegment) || a.eventHour - b.eventHour);
  return { points, ...(lastEventAt ? { lastEventAt } : {}) };
}

function unavailableResponse(filters: GameMonitoringFilters): GameMonitoringResponse {
  return { status: "unavailable", filters, points: [], summary: { unavailableReason: "This game does not expose the required user_id and cohort_day telemetry contract." }, metadata: { executedAt: new Date().toISOString() } };
}

function unavailableError(error: unknown) { return /cohort_day|user_id|invalid identifier|unknown column|does not exist/i.test(error instanceof Error ? error.message : ""); }

async function completedResponse(query: CountQuery, filters: GameMonitoringFilters): Promise<GameMonitoringResponse> {
  if (query.status === "error") throw new Error(query.error ?? "Count query failed");
  if (query.status !== "completed") throw new Error("Count query is still running");
  const parsed = parseGameMonitoringRows(query.result_preview);
  return {
    status: "completed", filters, points: parsed.points,
    summary: {
      ...(parsed.points.filter((point) => point.hourlyActiveUsers > 0).at(-1)?.eventDate ? { latestEventDate: parsed.points.filter((point) => point.hourlyActiveUsers > 0).at(-1)!.eventDate } : {}),
      ...(parsed.lastEventAt ? { lastEventAt: parsed.lastEventAt } : {}),
    },
    metadata: { executedAt: new Date().toISOString(), ...(query.result_metadata?.duration ? { durationMs: query.result_metadata.duration } : {}) },
  };
}

export async function startGameMonitoring(input: unknown): Promise<GameMonitoringRunResponse> {
  const request = gameMonitoringRequestSchema.parse(input);
  const filters = normalizedGameMonitoringFilters(request);
  try {
    const submitted = await submitCountSql(buildGameMonitoringSql(filters), { cacheStrategy: request.forceRefresh ? "force" : "default" });
    if (submitted.query.status === "error") return completedResponse(submitted.query, filters);
    if (submitted.query.status === "completed") return completedResponse((await getCountQuery(submitted.query.job_key, 1000)).query, filters);
    return { status: "running", filters, metadata: { jobKey: submitted.query.job_key, submittedAt: new Date().toISOString() }, pollAfterMs: 1500 };
  } catch (error) {
    if (unavailableError(error)) return unavailableResponse(filters);
    throw error;
  }
}

export async function getGameMonitoringStatus(input: unknown): Promise<GameMonitoringRunResponse> {
  const request = gameMonitoringStatusRequestSchema.parse(input);
  const filters = normalizedGameMonitoringFilters(request.filters);
  try {
    const result = await getCountQuery(request.jobKey, 1000);
    if (result.query.status === "running") return { status: "running", filters, metadata: { jobKey: request.jobKey, submittedAt: new Date().toISOString() }, pollAfterMs: 1500 };
    return completedResponse(result.query, filters);
  } catch (error) {
    if (unavailableError(error)) return unavailableResponse(filters);
    throw error;
  }
}
