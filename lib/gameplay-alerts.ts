import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";

import {
  getGameplayAlertSettingsRecord,
  listGameplayAlertQueryJobs,
  listGameplayAlertStates,
  saveGameplayAlertSettingsRecord,
  saveGameplayAlertQueryJobRecords,
  saveGameplayAlertStateRecords,
  saveGameplayAlertEvaluationRun,
  markGameplayAlertSlackDelivered,
  type GameplayAlertSettingsRecord,
  type GameplayAlertQueryJobRecord,
  type GameplayAlertStateRecord,
} from "@/lib/db";
import { getCountQuery, runCountSql, submitCountSql, type CountQuery } from "@/lib/count-api";
import { normalizedTechLaunchFilters, techLaunchAppIds, techLaunchAppOptions, techLaunchFilterSchema, techLaunchPlatformOptions, type TechLaunchFilters } from "@/lib/tech-launch";

const sqlPath = path.join(process.cwd(), "data", "tech_launch_level_fail_rate.sql");
const criticalSqlPath = path.join(process.cwd(), "data", "tech_launch_critical_level_fail_rate.sql");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export const allAppVersionsAlertScope = "__all_versions__";
export const allPlatformsAlertScope = "__all_platforms__";
export const gameplayAlertTimeZone = "Australia/Melbourne";
export const criticalGameplayAlertThreshold = 0.7;
export const criticalGameplayAlertMinPlayers = 50;
export type GameplayAlertKind = "daily" | "critical";

export const gameplayAlertTargetSchema = z.object({
  appName: z.enum(techLaunchAppOptions),
  platforms: z.array(z.enum(techLaunchPlatformOptions)).min(1)
    .transform((platforms) => [...new Set(platforms)].sort())
    .pipe(z.array(z.enum(techLaunchPlatformOptions)).min(1).max(techLaunchPlatformOptions.length)),
  // An empty value is an intentional "all versions" target, not an invalid
  // partially configured target.
  appVersion: z.string().trim().max(80).default(""),
});

export type GameplayAlertTarget = z.infer<typeof gameplayAlertTargetSchema>;
type GameplayAlertStateScope = { appName: string; platform: string; appVersion: string };
type GameplayAlertStateFilter = GameplayAlertStateScope & { alertKind: GameplayAlertKind };
export type GameplayAlertCronFilters = GameplayAlertStateScope & {
  platforms: Array<"android" | "ios">;
  appVersions: string[];
  startDate: string;
  endDate: string;
};

export const gameplayAlertSettingsSchema = z.object({
  normalThreshold: z.number().min(0).max(1),
  hardThreshold: z.number().min(0).max(1),
  minPlayers: z.number().int().min(1).max(1_000_000),
  alertTargets: z.array(gameplayAlertTargetSchema).max(25).default([]),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type GameplayAlertSettings = z.infer<typeof gameplayAlertSettingsSchema>;

export const levelFunnelFilterSchema = z.object({
  appName: z.enum(techLaunchAppOptions),
  platforms: z.array(z.enum(techLaunchPlatformOptions)).min(1).max(techLaunchPlatformOptions.length),
  appVersions: z.array(z.string().trim().min(1).max(80)).max(100),
  startDate: z.string().regex(datePattern, "Use YYYY-MM-DD"),
  endDate: z.string().regex(datePattern, "Use YYYY-MM-DD"),
}).refine((filters) => filters.startDate <= filters.endDate, {
  path: ["endDate"],
  message: "End date must be on or after start date",
});

export type LevelFunnelFilters = z.infer<typeof levelFunnelFilterSchema>;

export const levelFailRateRequestSchema = levelFunnelFilterSchema.extend({
  forceRefresh: z.boolean().optional(),
});

export const levelFailRateStatusRequestSchema = z.object({
  jobKey: z.string().trim().min(1),
  filters: levelFunnelFilterSchema,
});

export function normalizedLevelFunnelFilters(input: unknown): LevelFunnelFilters {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const platforms = Array.isArray(source.platforms) ? source.platforms : source.platform ? [source.platform] : ["android"];
  const appVersions = Array.isArray(source.appVersions) ? source.appVersions : source.appVersion ? [source.appVersion] : [];
  return levelFunnelFilterSchema.parse({
    ...source,
    platforms: [...new Set(platforms.map((value) => String(value).trim().toLowerCase()))].sort(),
    appVersions: [...new Set(appVersions.map((value) => String(value).trim()).filter(Boolean))].sort(),
  });
}

export const gameplayAlertSettingsInputSchema = gameplayAlertSettingsSchema.pick({
  normalThreshold: true,
  hardThreshold: true,
  minPlayers: true,
  alertTargets: true,
});

export const levelFailRatePointSchema = z.object({
  level: z.number().int().nonnegative(),
  levelId: z.string().optional(),
  layoutBankId: z.string(),
  layoutHash: z.string().optional(),
  layoutShare: z.number().min(0).max(1),
  layoutCoverage: z.number().min(0).max(1),
  layoutAgeHours: z.number().nonnegative(),
  hasRecentActivity: z.boolean(),
  layoutStable: z.boolean(),
  layoutUpdatePending: z.boolean(),
  pendingLayoutBankId: z.string().optional(),
  pendingLayoutHash: z.string().optional(),
  pendingLayoutShare: z.number().min(0).max(1).optional(),
  pendingLayoutRecentPlayers: z.number().int().nonnegative().optional(),
  pendingLayoutAgeHours: z.number().nonnegative().optional(),
  previousAlert: z.object({
    layoutBankId: z.string().optional(),
    layoutHash: z.string().optional(),
    failRate: z.number().min(0).max(1),
    reachedPlayers: z.number().int().nonnegative(),
    threshold: z.number().min(0).max(1),
  }).optional(),
  previousBankAssessment: z.object({
    layoutBankId: z.string(),
    layoutHash: z.string().optional(),
    difficultyTier: z.enum(["normal", "hard"]),
    failRate: z.number().min(0).max(1),
    reachedPlayers: z.number().int().nonnegative(),
    threshold: z.number().min(0).max(1),
  }).optional(),
  difficultyTier: z.enum(["normal", "hard"]),
  usedDifficultyFallback: z.boolean(),
  reachedPlayers: z.number().int().nonnegative(),
  failedPlayers: z.number().int().nonnegative(),
  failRate: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  eligible: z.boolean(),
  breached: z.boolean(),
});

export type LevelFailRatePoint = z.infer<typeof levelFailRatePointSchema>;

export const levelFailRateResponseSchema = z.object({
  status: z.enum(["completed", "unavailable"]),
  filters: levelFunnelFilterSchema,
  settings: gameplayAlertSettingsSchema,
  points: z.array(levelFailRatePointSchema),
  summary: z.object({
    breachCount: z.number().int().nonnegative(),
    eligibleLevelCount: z.number().int().nonnegative(),
    unavailableReason: z.string().optional(),
  }),
  metadata: z.object({ executedAt: z.string(), durationMs: z.number().optional() }),
});

export type LevelFailRateResponse = z.infer<typeof levelFailRateResponseSchema>;

export type LevelFailRatePendingResponse = {
  status: "running";
  filters: LevelFunnelFilters;
  settings: GameplayAlertSettings;
  metadata: { jobKey: string; submittedAt: string };
  pollAfterMs: number;
};

export type LevelFailRateRunResponse = LevelFailRateResponse | LevelFailRatePendingResponse;

export type GameplayAlertState = {
  alertKey: string;
  alertKind: GameplayAlertKind;
  appName: string;
  platform: string;
  appVersion: string;
  level: number;
  layoutBankId?: string;
  layoutHash?: string;
  difficultyTier: "normal" | "hard";
  status: "open" | "pending" | "resolved" | "superseded";
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  supersededAt?: string;
  lastFailRate: number;
  lastReachedPlayers: number;
  threshold: number;
  slackOpenDeliveredAt?: string;
  slackPendingDeliveredAt?: string;
  slackResolvedDeliveredAt?: string;
};

export type GameplayAlertTransition = {
  type: "opened" | "daily-open" | "pending" | "resolved";
  state: GameplayAlertState;
};

const defaultSettings: GameplayAlertSettings = {
  normalThreshold: 0.5,
  hardThreshold: 0.7,
  minPlayers: 50,
  alertTargets: [{ appName: "stacksmash", platforms: ["android", "ios"], appVersion: "" }],
};

function readBaseSql() {
  return fs.readFileSync(sqlPath, "utf8");
}

function readCriticalSql() {
  return fs.readFileSync(criticalSqlPath, "utf8");
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlDateLiteral(value: string) {
  return `TO_DATE(${sqlLiteral(value)})`;
}

function sqlList(values: string[]) {
  return values.map(sqlLiteral).join(", ");
}

function replaceRequired(sql: string, pattern: RegExp, replacement: string) {
  if (!pattern.test(sql)) throw new Error("Could not apply gameplay alert SQL parameter replacement");
  return sql.replace(pattern, replacement);
}

export function buildLevelFailRateSql(filtersInput: unknown) {
  const filters = normalizedLevelFunnelFilters(filtersInput);
  const appId = techLaunchAppIds[filters.appName];
  let sql = readBaseSql();
  sql = replaceRequired(sql, /ep\.app_id\s*=\s*\d+\s*-- modifiable parameter/, `ep.app_id = ${appId} -- modifiable parameter`);
  sql = replaceRequired(sql, /ep\.platform\s+in\s*\([^)]*\)\s*-- modifiable parameter/, `ep.platform in (${sqlList(filters.platforms)}) -- modifiable parameter`);
  sql = replaceRequired(sql, /ep\.app_version\s+in\s*\([^)]*\)\s*-- modifiable parameter/, filters.appVersions.length ? `ep.app_version in (${sqlList(filters.appVersions)}) -- modifiable parameter` : "1 = 1 -- modifiable parameter");
  sql = replaceRequired(
    sql,
    /ep\.created_at\s*>=\s*current_date\(\)\s*-\s*7\s*-- modifiable parameter\s*and\s+ep\.created_at\s*<\s*dateadd\(day,\s*1,\s*current_date\(\)\)\s*-- modifiable parameter/i,
    `ep.created_at >= ${sqlDateLiteral(filters.startDate)} -- modifiable parameter\n    and ep.created_at < DATEADD(day, 1, ${sqlDateLiteral(filters.endDate)}) -- modifiable parameter`,
  );
  return sql;
}

/** A short, current-revision query used only by the all-day critical evaluator. */
export function buildCriticalLevelFailRateSql(filtersInput: unknown) {
  const filters = normalizedLevelFunnelFilters(filtersInput);
  const appId = techLaunchAppIds[filters.appName];
  let sql = readCriticalSql();
  sql = replaceRequired(sql, /ep\.app_id\s*=\s*\d+\s*-- modifiable parameter/, `ep.app_id = ${appId} -- modifiable parameter`);
  sql = replaceRequired(sql, /ep\.platform\s+in\s*\([^)]*\)\s*-- modifiable parameter/, `ep.platform in (${sqlList(filters.platforms)}) -- modifiable parameter`);
  sql = replaceRequired(sql, /ep\.app_version\s+in\s*\([^)]*\)\s*-- modifiable parameter/, filters.appVersions.length ? `ep.app_version in (${sqlList(filters.appVersions)}) -- modifiable parameter` : "1 = 1 -- modifiable parameter");
  return sql;
}

export const criticalLevelFailRatePointSchema = z.object({
  level: z.number().int().nonnegative(),
  levelId: z.string().optional(),
  layoutBankId: z.string().min(1),
  layoutHash: z.string().optional(),
  difficultyTier: z.enum(["normal", "hard"]),
  reachedPlayers: z.number().int().nonnegative(),
  failedPlayers: z.number().int().nonnegative(),
  failRate: z.number().min(0).max(1),
});

export type CriticalLevelFailRatePoint = z.infer<typeof criticalLevelFailRatePointSchema>;

function rowValue(row: Record<string, unknown>, key: string) {
  return row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBoolean(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

export function parseLevelFailRateRows(resultPreview: string | undefined, settings: GameplayAlertSettings): LevelFailRatePoint[] {
  if (!resultPreview?.trim()) return [];
  const rows = parseCsv(resultPreview, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, unknown>>;
  return rows
    .map((row) => {
      const difficultyTier = String(rowValue(row, "difficulty_tier")).toLowerCase() === "hard" ? "hard" as const : "normal" as const;
      const levelId = String(rowValue(row, "level_id") ?? "").trim();
      const reachedPlayers = Math.max(0, Math.round(toNumber(rowValue(row, "reached_players"))));
      const failedPlayers = Math.min(reachedPlayers, Math.max(0, Math.round(toNumber(rowValue(row, "failed_players")))));
      const failRate = Math.min(1, Math.max(0, toNumber(rowValue(row, "fail_rate"))));
      const layoutBankId = String(rowValue(row, "layout_bank_id") ?? "").trim();
      const layoutHash = String(rowValue(row, "layout_hash") ?? "").trim();
      const layoutShare = Math.min(1, Math.max(0, toNumber(rowValue(row, "layout_share"))));
      const layoutCoverage = Math.min(1, Math.max(0, toNumber(rowValue(row, "layout_coverage"))));
      const layoutAgeHours = Math.max(0, toNumber(rowValue(row, "layout_age_hours")));
      const hasRecentActivity = toBoolean(rowValue(row, "has_recent_activity"));
      const layoutStable = toBoolean(rowValue(row, "layout_is_stable"));
      const layoutUpdatePending = toBoolean(rowValue(row, "layout_update_pending"));
      const pendingLayoutBankId = String(rowValue(row, "pending_layout_bank_id") ?? "").trim();
      const pendingLayoutHash = String(rowValue(row, "pending_layout_hash") ?? "").trim();
      const pendingLayoutShare = Math.min(1, Math.max(0, toNumber(rowValue(row, "pending_layout_share"))));
      const pendingLayoutRecentPlayers = Math.max(0, Math.round(toNumber(rowValue(row, "pending_layout_recent_players"))));
      const pendingLayoutAgeHours = Math.max(0, toNumber(rowValue(row, "pending_layout_age_hours")));
      const previousLayoutBankId = String(rowValue(row, "previous_layout_bank_id") ?? "").trim();
      const previousLayoutHash = String(rowValue(row, "previous_layout_hash") ?? "").trim();
      const previousLayoutDifficultyTier = String(rowValue(row, "previous_layout_difficulty_tier")).toLowerCase() === "hard" ? "hard" as const : "normal" as const;
      const previousLayoutReachedPlayers = Math.max(0, Math.round(toNumber(rowValue(row, "previous_layout_reached_players"))));
      const previousLayoutFailRate = Math.min(1, Math.max(0, toNumber(rowValue(row, "previous_layout_fail_rate"))));
      const previousLayoutThreshold = previousLayoutDifficultyTier === "hard" ? settings.hardThreshold : settings.normalThreshold;
      const threshold = difficultyTier === "hard" ? settings.hardThreshold : settings.normalThreshold;
      const eligible = Boolean(layoutBankId) && layoutStable && !layoutUpdatePending && reachedPlayers >= settings.minPlayers;
      return {
        level: Math.round(toNumber(rowValue(row, "level"))),
        ...(levelId ? { levelId } : {}),
        layoutBankId,
        ...(layoutHash ? { layoutHash } : {}),
        layoutShare,
        layoutCoverage,
        layoutAgeHours,
        hasRecentActivity,
        layoutStable,
        layoutUpdatePending,
        ...(pendingLayoutBankId ? { pendingLayoutBankId, ...(pendingLayoutHash ? { pendingLayoutHash } : {}), pendingLayoutShare, pendingLayoutRecentPlayers, pendingLayoutAgeHours } : {}),
        ...(previousLayoutBankId && previousLayoutReachedPlayers >= settings.minPlayers && previousLayoutFailRate >= previousLayoutThreshold ? {
          previousBankAssessment: {
            layoutBankId: previousLayoutBankId,
            ...(previousLayoutHash ? { layoutHash: previousLayoutHash } : {}),
            difficultyTier: previousLayoutDifficultyTier,
            failRate: previousLayoutFailRate,
            reachedPlayers: previousLayoutReachedPlayers,
            threshold: previousLayoutThreshold,
          },
        } : {}),
        difficultyTier,
        usedDifficultyFallback: toBoolean(rowValue(row, "used_difficulty_fallback")),
        reachedPlayers,
        failedPlayers,
        failRate,
        threshold,
        eligible,
        breached: eligible && failRate >= threshold,
      };
    })
    .filter((point) => point.level >= 0)
    .sort((a, b) => a.level - b.level || a.difficultyTier.localeCompare(b.difficultyTier));
}

export function parseCriticalLevelFailRateRows(resultPreview: string | undefined): CriticalLevelFailRatePoint[] {
  if (!resultPreview?.trim()) return [];
  const rows = parseCsv(resultPreview, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, unknown>>;
  return rows
    .map((row) => {
      const levelId = String(rowValue(row, "level_id") ?? "").trim();
      const layoutBankId = String(rowValue(row, "layout_bank_id") ?? "").trim();
      const layoutHash = String(rowValue(row, "layout_hash") ?? "").trim();
      const reachedPlayers = Math.max(0, Math.round(toNumber(rowValue(row, "reached_players"))));
      const failedPlayers = Math.min(reachedPlayers, Math.max(0, Math.round(toNumber(rowValue(row, "failed_players")))));
      return {
        level: Math.round(toNumber(rowValue(row, "level"))),
        ...(levelId ? { levelId } : {}),
        layoutBankId,
        ...(layoutHash ? { layoutHash } : {}),
        difficultyTier: String(rowValue(row, "difficulty_tier")).toLowerCase() === "hard" ? "hard" as const : "normal" as const,
        reachedPlayers,
        failedPlayers,
        failRate: Math.min(1, Math.max(0, toNumber(rowValue(row, "fail_rate")))),
      };
    })
    .filter((point) => point.level >= 0 && Boolean(point.layoutBankId))
    .sort((first, second) => first.level - second.level);
}

function settingsFromRecord(record: GameplayAlertSettingsRecord | null): GameplayAlertSettings {
  if (!record) return defaultSettings;
  return gameplayAlertSettingsSchema.parse({
    normalThreshold: record.normalThreshold,
    hardThreshold: record.hardThreshold,
    minPlayers: record.minPlayers,
    alertTargets: record.alertTargets,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  });
}

export async function getGameplayAlertSettings() {
  return settingsFromRecord(await getGameplayAlertSettingsRecord());
}

export async function updateGameplayAlertSettings(input: unknown, actorId: string) {
  const settings = gameplayAlertSettingsInputSchema.parse(input);
  const now = new Date().toISOString();
  await saveGameplayAlertSettingsRecord({ ...settings, updatedAt: now, updatedBy: actorId });
  return { ...settings, updatedAt: now, updatedBy: actorId };
}

function unavailableLevelFailRateResponse(filters: LevelFunnelFilters, settings: GameplayAlertSettings): LevelFailRateResponse {
  return {
    status: "unavailable", filters, settings, points: [],
    summary: { breachCount: 0, eligibleLevelCount: 0, unavailableReason: "This game does not expose the required player, level, outcome, and difficulty telemetry contract." },
    metadata: { executedAt: new Date().toISOString() },
  };
}

function isUnavailableTelemetryError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /public_user_id|invalid identifier|unknown column|does not exist/i.test(message);
}

async function completedLevelFailRateResponse(query: CountQuery, filters: LevelFunnelFilters, settings: GameplayAlertSettings): Promise<LevelFailRateResponse> {
  if (query.status === "error") {
    const error = new Error(query.error ?? "Count query failed");
    if (isUnavailableTelemetryError(error)) return unavailableLevelFailRateResponse(filters, settings);
    throw error;
  }
  if (query.status !== "completed") throw new Error("Count query is still running");
  const points = parseLevelFailRateRows(query.result_preview, settings);
  const openStatesByLevel = new Map<number, GameplayAlertState[]>();
  const persistedStateFilters = filters.platforms.length === 1 && filters.appVersions.length === 1
    ? { appName: filters.appName, platform: filters.platforms[0], appVersion: filters.appVersions[0], alertKind: "daily" as const }
    : null;
  for (const record of persistedStateFilters ? await listGameplayAlertStates(persistedStateFilters) : []) {
    const state = stateFromRecord(record);
    if (state.status !== "open") continue;
    const states = openStatesByLevel.get(state.level) ?? [];
    states.push(state);
    openStatesByLevel.set(state.level, states);
  }
  const pointsWithPreviousAlerts = points.map((point) => {
    if (!point.layoutUpdatePending) return point;
    const previous = openStatesByLevel.get(point.level)?.find((state) => point.pendingLayoutHash
      ? state.layoutHash !== point.pendingLayoutHash
      : state.layoutBankId !== point.pendingLayoutBankId);
    if (!previous) return point;
    return {
      ...point,
      previousAlert: {
        ...(previous.layoutBankId ? { layoutBankId: previous.layoutBankId } : {}),
        ...(previous.layoutHash ? { layoutHash: previous.layoutHash } : {}),
        failRate: previous.lastFailRate,
        reachedPlayers: previous.lastReachedPlayers,
        threshold: previous.threshold,
      },
    };
  });
  const now = new Date().toISOString();
  return {
    status: "completed",
    filters,
    settings,
    points: pointsWithPreviousAlerts,
    summary: {
      breachCount: pointsWithPreviousAlerts.filter((point) => point.breached).length,
      eligibleLevelCount: pointsWithPreviousAlerts.filter((point) => point.eligible).length,
    },
    metadata: {
      executedAt: now,
      ...(query.result_metadata?.duration ? { durationMs: query.result_metadata.duration } : {}),
    },
  };
}

export async function getLevelFailRate(input: unknown): Promise<LevelFailRateResponse> {
  const filters = normalizedLevelFunnelFilters(input);
  const settings = await getGameplayAlertSettings();
  try {
    const result = await runCountSql(buildLevelFailRateSql(filters), { cacheStrategy: "default", previewRows: 1000 });
    return completedLevelFailRateResponse(result.query, filters, settings);
  } catch (error) {
    if (isUnavailableTelemetryError(error)) return unavailableLevelFailRateResponse(filters, settings);
    throw error;
  }
}

export async function startLevelFailRate(input: unknown): Promise<LevelFailRateRunResponse> {
  const request = levelFailRateRequestSchema.parse(input);
  const filters = normalizedLevelFunnelFilters(request);
  const settings = await getGameplayAlertSettings();
  try {
    const submitted = await submitCountSql(buildLevelFailRateSql(filters), { cacheStrategy: request.forceRefresh ? "force" : "default" });
    if (submitted.query.status === "error") return completedLevelFailRateResponse(submitted.query, filters, settings);
    if (submitted.query.status === "completed") {
      const completed = await getCountQuery(submitted.query.job_key, 1000);
      return completedLevelFailRateResponse(completed.query, filters, settings);
    }
    return {
      status: "running",
      filters,
      settings,
      metadata: { jobKey: submitted.query.job_key, submittedAt: new Date().toISOString() },
      pollAfterMs: 1500,
    };
  } catch (error) {
    if (isUnavailableTelemetryError(error)) return unavailableLevelFailRateResponse(filters, settings);
    throw error;
  }
}

export async function getLevelFailRateStatus(input: unknown): Promise<LevelFailRateRunResponse> {
  const request = levelFailRateStatusRequestSchema.parse(input);
  const filters = normalizedLevelFunnelFilters(request.filters);
  const settings = await getGameplayAlertSettings();
  try {
    const result = await getCountQuery(request.jobKey, 1000);
    if (result.query.status === "running") {
      return {
        status: "running",
        filters,
        settings,
        metadata: { jobKey: request.jobKey, submittedAt: new Date().toISOString() },
        pollAfterMs: 1500,
      };
    }
    return completedLevelFailRateResponse(result.query, filters, settings);
  } catch (error) {
    if (isUnavailableTelemetryError(error)) return unavailableLevelFailRateResponse(filters, settings);
    throw error;
  }
}

export async function recordGameplayAlertDashboardObservation(filtersInput: unknown, response: LevelFailRateRunResponse) {
  const filters = normalizedLevelFunnelFilters(filtersInput);
  if (response.status !== "completed") return;
  await saveGameplayAlertEvaluationRun({
    id: crypto.randomUUID(),
    evaluatedAt: new Date().toISOString(),
    filters: JSON.stringify(filters),
    result: JSON.stringify(response),
    transitionCount: 0,
    source: "dashboard",
  });
}

function gameplayAlertStateScope(input: unknown, alertKind: GameplayAlertKind = "daily"): GameplayAlertStateFilter {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const appName = String(source.appName ?? "").trim();
  const platform = String(source.platform ?? "").trim();
  const appVersion = String(source.appVersion ?? "").trim();
  if (!appName || !platform || !appVersion) throw new Error("Gameplay alert state scope is incomplete");
  return { appName, platform, appVersion, alertKind };
}

export function levelAlertKey(point: Pick<LevelFailRatePoint, "level" | "layoutBankId" | "layoutHash" | "difficultyTier">, filters: GameplayAlertStateScope, alertKind: GameplayAlertKind = "daily") {
  return `${alertKind}:${filters.appName}:${filters.platform}:${filters.appVersion}:${point.level}:${point.layoutHash ?? `bank:${point.layoutBankId}`}:${point.difficultyTier}`;
}

function stateFromRecord(record: GameplayAlertStateRecord): GameplayAlertState {
  return {
    alertKey: record.alertKey,
    alertKind: record.alertKind === "critical" ? "critical" : "daily",
    appName: record.appName,
    platform: record.platform,
    appVersion: record.appVersion,
    level: record.level,
    ...(record.layoutBankId ? { layoutBankId: record.layoutBankId } : {}),
    ...(record.layoutHash ? { layoutHash: record.layoutHash } : {}),
    difficultyTier: record.difficultyTier === "hard" ? "hard" : "normal",
    status: record.status === "pending" || record.status === "resolved" || record.status === "superseded" ? record.status : "open",
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    ...(record.resolvedAt ? { resolvedAt: record.resolvedAt } : {}),
    ...(record.supersededAt ? { supersededAt: record.supersededAt } : {}),
    lastFailRate: record.lastFailRate,
    lastReachedPlayers: record.lastReachedPlayers,
    threshold: record.threshold,
    ...(record.slackOpenDeliveredAt ? { slackOpenDeliveredAt: record.slackOpenDeliveredAt } : {}),
    ...(record.slackPendingDeliveredAt ? { slackPendingDeliveredAt: record.slackPendingDeliveredAt } : {}),
    ...(record.slackResolvedDeliveredAt ? { slackResolvedDeliveredAt: record.slackResolvedDeliveredAt } : {}),
  };
}

async function reconcileGameplayAlertResponse(filters: GameplayAlertStateScope, response: LevelFailRateResponse, alertKind: GameplayAlertKind = "daily") {
  const now = new Date().toISOString();
  const stateFilters = { ...filters, alertKind };
  const existing = new Map((await listGameplayAlertStates(stateFilters)).map((record) => [record.alertKey, stateFromRecord(record)]));
  if (response.status !== "completed") {
    await saveGameplayAlertEvaluationRun({ id: crypto.randomUUID(), evaluatedAt: now, filters: JSON.stringify(filters), result: JSON.stringify(response), transitionCount: 0 });
    return { response, transitions: [] as GameplayAlertTransition[] };
  }
  const activeLayoutByLevel = new Map(response.points.map((point) => [point.level, point]));
  const pendingLayoutByLevel = new Map(response.points.filter((point) => point.layoutUpdatePending).map((point) => [point.level, point]));
  const stateMatchesRevision = (state: GameplayAlertState, point: LevelFailRatePoint) => {
    if (point.layoutHash) return state.layoutHash ? state.layoutHash === point.layoutHash : state.layoutBankId === point.layoutBankId;
    return !state.layoutHash && state.layoutBankId === point.layoutBankId;
  };
  const current = new Map<string, LevelFailRatePoint>();
  for (const point of response.points.filter((candidate) => candidate.breached)) {
    const matchingOpenState = [...existing.values()].find((state) => state.status === "open" && state.level === point.level && state.difficultyTier === point.difficultyTier && stateMatchesRevision(state, point));
    current.set(matchingOpenState?.alertKey ?? levelAlertKey(point, filters, alertKind), point);
  }
  const next: GameplayAlertState[] = [];
  const transitions: GameplayAlertTransition[] = [];

  for (const [key, point] of current) {
    const previous = existing.get(key);
    const state: GameplayAlertState = {
      alertKey: key, alertKind, appName: filters.appName, platform: filters.platform, appVersion: filters.appVersion,
      level: point.level, layoutBankId: point.layoutBankId, ...(point.layoutHash ? { layoutHash: point.layoutHash } : {}), difficultyTier: point.difficultyTier, status: "open",
      firstSeenAt: previous?.status === "open" ? previous.firstSeenAt : now,
      lastSeenAt: now, lastFailRate: point.failRate, lastReachedPlayers: point.reachedPlayers, threshold: point.threshold,
      ...(previous?.slackOpenDeliveredAt ? { slackOpenDeliveredAt: previous.slackOpenDeliveredAt } : {}),
    };
    next.push(state);
    if (previous?.status !== "open" || !previous.slackOpenDeliveredAt) transitions.push({ type: "opened", state });
  }

  for (const [key, previous] of existing) {
    if (current.has(key) || (previous.status !== "open" && previous.status !== "pending")) continue;
    if (pendingLayoutByLevel.has(previous.level)) {
      // Match the funnel: a new revision means the old-bank breach is no
      // longer an open alert. Retain it only as a pending recheck until the
      // current revision has enough stable, adopted traffic.
      const state = { ...previous, status: "pending" as const, lastSeenAt: now };
      next.push(state);
      if (previous.status === "open" && previous.slackOpenDeliveredAt && !previous.slackPendingDeliveredAt) transitions.push({ type: "pending", state });
      continue;
    }
    const activeLayout = activeLayoutByLevel.get(previous.level);
    if (!activeLayout || !activeLayout.layoutStable) {
      next.push(previous);
      continue;
    }
    if (!stateMatchesRevision(previous, activeLayout)) {
      next.push({ ...previous, status: "superseded", lastSeenAt: now, supersededAt: now });
      continue;
    }
    const state = { ...previous, status: "resolved" as const, lastSeenAt: now, resolvedAt: now };
    next.push(state);
    // A resolution is useful only when the team was previously told that the
    // breach opened; otherwise a delayed webhook configuration would produce
    // a confusing standalone "resolved" notification.
    if (previous.slackOpenDeliveredAt && !previous.slackResolvedDeliveredAt) transitions.push({ type: "resolved", state });
  }

  await saveGameplayAlertStateRecords(next);
  await saveGameplayAlertEvaluationRun({ id: crypto.randomUUID(), evaluatedAt: now, filters: JSON.stringify(filters), result: JSON.stringify(response), transitionCount: transitions.length });
  return { response, transitions };
}

export async function reconcileGameplayAlerts(filtersInput: unknown) {
  const filters = normalizedTechLaunchFilters(filtersInput);
  return reconcileGameplayAlertResponse(filters, await getLevelFailRate(filters));
}

export async function reconcileGameplayAlertsFromQuery(filtersInput: unknown, query: CountQuery, queryFiltersInput: unknown = filtersInput) {
  const filters = gameplayAlertStateScope(filtersInput);
  const settings = await getGameplayAlertSettings();
  return reconcileGameplayAlertResponse(filters, await completedLevelFailRateResponse(query, normalizedLevelFunnelFilters(queryFiltersInput), settings));
}

function criticalStateMatchesRevision(state: GameplayAlertState, point: CriticalLevelFailRatePoint) {
  if (point.layoutHash) return state.layoutHash ? state.layoutHash === point.layoutHash : state.layoutBankId === point.layoutBankId;
  return !state.layoutHash && state.layoutBankId === point.layoutBankId;
}

/** Reconciles the short-window alert independently of the daily stability rules. */
export async function reconcileCriticalGameplayAlertsFromQuery(filtersInput: unknown, query: CountQuery) {
  const filters = gameplayAlertStateScope(filtersInput, "critical");
  if (query.status === "error") throw new Error(query.error ?? "Count query failed");
  if (query.status !== "completed") throw new Error("Count query is still running");

  const now = new Date().toISOString();
  const points = parseCriticalLevelFailRateRows(query.result_preview);
  const existing = new Map((await listGameplayAlertStates(filters)).map((record) => [record.alertKey, stateFromRecord(record)]));
  const current = new Map<string, CriticalLevelFailRatePoint>();
  for (const point of points) {
    if (point.reachedPlayers < criticalGameplayAlertMinPlayers || point.failRate <= criticalGameplayAlertThreshold) continue;
    const matchingOpenState = [...existing.values()].find((state) => state.status === "open" && state.level === point.level && criticalStateMatchesRevision(state, point));
    const key = matchingOpenState?.alertKey ?? `critical:${filters.appName}:${filters.platform}:${filters.appVersion}:${point.level}:${point.layoutHash ?? `bank:${point.layoutBankId}`}`;
    current.set(key, point);
  }

  const next: GameplayAlertState[] = [];
  const transitions: GameplayAlertTransition[] = [];
  for (const [key, point] of current) {
    const previous = existing.get(key);
    const state: GameplayAlertState = {
      alertKey: key,
      alertKind: "critical",
      appName: filters.appName,
      platform: filters.platform,
      appVersion: filters.appVersion,
      level: point.level,
      layoutBankId: point.layoutBankId,
      ...(point.layoutHash ? { layoutHash: point.layoutHash } : {}),
      difficultyTier: point.difficultyTier,
      status: "open",
      firstSeenAt: previous?.status === "open" ? previous.firstSeenAt : now,
      lastSeenAt: now,
      lastFailRate: point.failRate,
      lastReachedPlayers: point.reachedPlayers,
      threshold: criticalGameplayAlertThreshold,
      ...(previous?.slackOpenDeliveredAt ? { slackOpenDeliveredAt: previous.slackOpenDeliveredAt } : {}),
    };
    next.push(state);
    if (previous?.status !== "open" || !previous.slackOpenDeliveredAt) transitions.push({ type: "opened", state });
  }

  for (const [key, previous] of existing) {
    if (current.has(key) || previous.status !== "open") continue;
    // Critical recoveries are persisted so a later re-breach can notify again,
    // but they deliberately do not create a Slack resolution message.
    next.push({ ...previous, status: "resolved", lastSeenAt: now, resolvedAt: now });
  }

  await saveGameplayAlertStateRecords(next);
  await saveGameplayAlertEvaluationRun({
    id: crypto.randomUUID(),
    evaluatedAt: now,
    filters: JSON.stringify(filters),
    result: JSON.stringify({ status: "completed", points, threshold: criticalGameplayAlertThreshold, minPlayers: criticalGameplayAlertMinPlayers }),
    transitionCount: transitions.length,
    source: "critical",
  });
  return { points, transitions };
}

export async function undeliveredGameplayAlertTransitions(filtersInput: unknown, alertKind: GameplayAlertKind = "daily"): Promise<GameplayAlertTransition[]> {
  const filters = gameplayAlertStateScope(filtersInput, alertKind);
  const transitions: GameplayAlertTransition[] = [];
  for (const record of await listGameplayAlertStates(filters)) {
    const state = stateFromRecord(record);
    if (state.status === "open" && !state.slackOpenDeliveredAt) transitions.push({ type: "opened", state });
    if (alertKind === "daily" && state.status === "pending" && state.slackOpenDeliveredAt && !state.slackPendingDeliveredAt) transitions.push({ type: "pending", state });
    if (alertKind === "daily" && state.status === "resolved" && state.slackOpenDeliveredAt && !state.slackResolvedDeliveredAt) transitions.push({ type: "resolved", state });
  }
  return transitions;
}

/**
 * Current status alerts deliberately come from the state reconciled by the
 * completed Count query, rather than from a fresh dashboard query. That keeps
 * the daily Slack digest tied to one auditable evaluation and avoids a second
 * moving-data calculation during the GitHub Actions polling loop.
 */
export async function openGameplayAlertStates(filtersInput: unknown): Promise<GameplayAlertState[]> {
  const filters = gameplayAlertStateScope(filtersInput);
  return (await listGameplayAlertStates(filters)).map(stateFromRecord).filter((state) => state.status === "open");
}

function compactPlayerCount(value: number) {
  if (value < 1_000) return String(value);
  const divisor = value >= 1_000_000 ? 1_000_000 : 1_000;
  const suffix = divisor === 1_000_000 ? "M" : "K";
  const scaled = value / divisor;
  const digits = scaled < 10 ? 1 : 0;
  return `${Number(scaled.toFixed(digits))}${suffix}`;
}

function checkedAtLabel(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value).replace(",", "") + " WIB";
}

function alertSection(type: GameplayAlertTransition["type"]) {
  if (type === "pending") return { key: "pending", heading: "Pending recheck" };
  if (type === "resolved") return { key: "resolved", heading: "Resolved levels" };
  return { key: "open", heading: "Open levels" };
}

export function formatGameplayAlertSlackMessage(transitions: GameplayAlertTransition[], checkedAt = new Date()) {
  const groups = new Map<string, { state: GameplayAlertState; sections: Map<string, { heading: string; states: GameplayAlertState[] }> }>();
  for (const transition of transitions) {
    const platform = transition.state.platform === allPlatformsAlertScope ? "All platforms" : transition.state.platform;
    const appVersion = transition.state.appVersion === allAppVersionsAlertScope ? "All versions" : transition.state.appVersion;
    const key = `${transition.state.appName}:${platform}:${appVersion}`;
    const group = groups.get(key) ?? { state: transition.state, sections: new Map() };
    const section = alertSection(transition.type);
    const bucket = group.sections.get(section.key) ?? { heading: section.heading, states: [] };
    bucket.states.push(transition.state);
    group.sections.set(section.key, bucket);
    groups.set(key, group);
  }

  const sectionOrder = ["open", "pending", "resolved"];
  const critical = transitions.length > 0 && transitions.every((transition) => transition.state.alertKind === "critical");
  return [critical ? "*Critical Gameplay Alert*" : "*Gameplay Difficulty Alerts*", ...[...groups.values()].map((group) => {
    const platform = group.state.platform === allPlatformsAlertScope ? "All platforms" : group.state.platform;
    const appVersion = group.state.appVersion === allAppVersionsAlertScope ? "All versions" : group.state.appVersion;
    const sections = sectionOrder.flatMap((key) => {
      const section = group.sections.get(key);
      if (!section) return [];
      const levels = section.states
        .sort((a, b) => a.level - b.level || a.difficultyTier.localeCompare(b.difficultyTier))
        .map((state) => `• Level ${state.level} · ${state.difficultyTier} · ${(state.lastFailRate * 100).toFixed(1)}% · ${compactPlayerCount(state.lastReachedPlayers)} players`);
      return [`*${critical ? "Critical levels (>70% fail rate, 50+ players)" : section.heading} (${levels.length})*`, ...levels];
    });
    return [`*Game:* ${group.state.appName}`, `*Platform:* ${platform}`, `*Version:* ${appVersion}`, `*Checked:* ${checkedAtLabel(checkedAt)}`, "", ...sections].join("\n");
  })].join("\n\n");
}

/** The primary channel remains backwards-compatible; an optional second URL mirrors alerts to another channel. */
export function gameplayAlertWebhookUrls(environment: { SLACK_GAMEPLAY_ALERT_WEBHOOK_URL?: string; SLACK_GAMEPLAY_ALERT_ADDITIONAL_WEBHOOK_URL?: string } = {
  SLACK_GAMEPLAY_ALERT_WEBHOOK_URL: process.env.SLACK_GAMEPLAY_ALERT_WEBHOOK_URL,
  SLACK_GAMEPLAY_ALERT_ADDITIONAL_WEBHOOK_URL: process.env.SLACK_GAMEPLAY_ALERT_ADDITIONAL_WEBHOOK_URL,
}) {
  return [...new Set([
    environment.SLACK_GAMEPLAY_ALERT_WEBHOOK_URL,
    environment.SLACK_GAMEPLAY_ALERT_ADDITIONAL_WEBHOOK_URL,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export async function deliverGameplayAlertTransitions(transitions: GameplayAlertTransition[]) {
  const webhooks = gameplayAlertWebhookUrls();
  if (!webhooks.length || !transitions.length) return { delivered: 0, skipped: transitions.length, configured: webhooks.length > 0 };
  const message = JSON.stringify({ text: formatGameplayAlertSlackMessage(transitions) });
  const responses = await Promise.all(webhooks.map((webhook) => fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: message })));
  const failed = responses.find((response) => !response.ok);
  if (failed) throw new Error(`Slack webhook returned ${failed.status}`);
  const deliveredAt = new Date().toISOString();
  await Promise.all([
    markGameplayAlertSlackDelivered(transitions.filter((transition) => transition.type === "opened" || transition.type === "daily-open").map((transition) => transition.state.alertKey), "opened", deliveredAt),
    markGameplayAlertSlackDelivered(transitions.filter((transition) => transition.type === "pending").map((transition) => transition.state.alertKey), "pending", deliveredAt),
    markGameplayAlertSlackDelivered(transitions.filter((transition) => transition.type === "resolved").map((transition) => transition.state.alertKey), "resolved", deliveredAt),
  ]);
  return { delivered: transitions.length, skipped: 0, configured: true };
}

export function gameplayAlertCronFilters(settings: GameplayAlertSettings, today = new Date()): GameplayAlertCronFilters[] {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: gameplayAlertTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(today).reduce<Record<string, string>>((parts, part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
    return parts;
  }, {});
  const endDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  // Use UTC noon for calendar arithmetic so the date remains stable across
  // Melbourne's daylight-saving transition.
  const start = new Date(`${endDate}T12:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  return settings.alertTargets.map((target) => ({
    appName: target.appName,
    // Keep the state identity aligned with the aggregate query. A target that
    // includes both platforms is one alert scope, not two duplicated alerts.
    platform: target.platforms.length === 1 ? target.platforms[0] : allPlatformsAlertScope,
    platforms: target.platforms,
    appVersion: target.appVersion || allAppVersionsAlertScope,
    appVersions: target.appVersion ? [target.appVersion] : [],
    startDate: iso(start),
    endDate,
  }));
}

export function gameplayAlertEvaluationKey(filters: GameplayAlertStateScope & Pick<LevelFunnelFilters, "startDate" | "endDate">) {
  return [filters.appName, filters.platform, filters.appVersion, filters.startDate, filters.endDate].join(":");
}

/** One asynchronous job per target; a completed critical job is replaced on the next 15-minute run. */
export function criticalGameplayAlertEvaluationKey(filters: GameplayAlertStateScope) {
  return ["critical", filters.appName, filters.platform, filters.appVersion].join(":");
}

export function dailyGameplayAlertFilters(today = new Date()) {
  return gameplayAlertCronFilters(defaultSettings, today);
}

export function isIsoDate(value: string) {
  return datePattern.test(value);
}
