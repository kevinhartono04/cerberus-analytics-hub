import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";

import {
  getGameplayAlertSettingsRecord,
  listGameplayAlertStates,
  saveGameplayAlertSettingsRecord,
  saveGameplayAlertStateRecords,
  saveGameplayAlertEvaluationRun,
  markGameplayAlertSlackDelivered,
  type GameplayAlertSettingsRecord,
  type GameplayAlertStateRecord,
} from "@/lib/db";
import { runCountSql } from "@/lib/count-api";
import { normalizedTechLaunchFilters, techLaunchAppOptions, techLaunchFilterSchema, techLaunchPlatformOptions, type TechLaunchFilters } from "@/lib/tech-launch";

const sqlPath = path.join(process.cwd(), "data", "tech_launch_level_fail_rate.sql");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const gameplayAlertSettingsSchema = z.object({
  normalThreshold: z.number().min(0).max(1),
  hardThreshold: z.number().min(0).max(1),
  minPlayers: z.number().int().min(1).max(1_000_000),
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
});

export const levelFailRatePointSchema = z.object({
  level: z.number().int().nonnegative(),
  levelId: z.string().optional(),
  layoutBankId: z.string(),
  layoutHash: z.string().optional(),
  layoutShare: z.number().min(0).max(1),
  layoutCoverage: z.number().min(0).max(1),
  layoutAgeHours: z.number().nonnegative(),
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

export type GameplayAlertState = {
  alertKey: string;
  appName: string;
  platform: string;
  appVersion: string;
  level: number;
  layoutBankId?: string;
  layoutHash?: string;
  difficultyTier: "normal" | "hard";
  status: "open" | "resolved" | "superseded";
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  supersededAt?: string;
  lastFailRate: number;
  lastReachedPlayers: number;
  threshold: number;
  slackOpenDeliveredAt?: string;
  slackResolvedDeliveredAt?: string;
};

export type GameplayAlertTransition = {
  type: "opened" | "resolved";
  state: GameplayAlertState;
};

const defaultSettings: GameplayAlertSettings = { normalThreshold: 0.5, hardThreshold: 0.7, minPlayers: 50 };

function readBaseSql() {
  return fs.readFileSync(sqlPath, "utf8");
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
  let sql = readBaseSql();
  sql = replaceRequired(sql, /app_name\s*=\s*'[^']*'\s*-- modifiable parameter/, `app_name = ${sqlLiteral(filters.appName)} -- modifiable parameter`);
  sql = replaceRequired(sql, /ep\.platform\s+in\s*\([^)]*\)\s*-- modifiable parameter/, `ep.platform in (${sqlList(filters.platforms)}) -- modifiable parameter`);
  sql = replaceRequired(sql, /ep\.app_version\s+in\s*\([^)]*\)\s*-- modifiable parameter/, filters.appVersions.length ? `ep.app_version in (${sqlList(filters.appVersions)}) -- modifiable parameter` : "1 = 1 -- modifiable parameter");
  sql = replaceRequired(
    sql,
    /ep\.created_at::date\s+between\s+current_date\(\)\s*-\s*7\s+and\s+current_date\(\)\s*-- modifiable parameter/i,
    `ep.created_at::date between ${sqlDateLiteral(filters.startDate)} and ${sqlDateLiteral(filters.endDate)} -- modifiable parameter`,
  );
  return sql;
}

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

function settingsFromRecord(record: GameplayAlertSettingsRecord | null): GameplayAlertSettings {
  if (!record) return defaultSettings;
  return gameplayAlertSettingsSchema.parse({
    normalThreshold: record.normalThreshold,
    hardThreshold: record.hardThreshold,
    minPlayers: record.minPlayers,
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

export async function getLevelFailRate(input: unknown): Promise<LevelFailRateResponse> {
  const filters = normalizedLevelFunnelFilters(input);
  const settings = await getGameplayAlertSettings();
  let result;
  try {
    result = await runCountSql(buildLevelFailRateSql(filters), { cacheStrategy: "default", previewRows: 1000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gameplay data query failed";
    if (/public_user_id|invalid identifier|unknown column|does not exist/i.test(message)) {
      return {
        status: "unavailable", filters, settings, points: [],
        summary: { breachCount: 0, eligibleLevelCount: 0, unavailableReason: "This game does not expose the required player, level, outcome, and difficulty telemetry contract." },
        metadata: { executedAt: new Date().toISOString() },
      };
    }
    throw error;
  }
  if (result.query.status === "error") throw new Error(result.query.error ?? "Count query failed");
  const points = parseLevelFailRateRows(result.query.result_preview, settings);
  const openStatesByLevel = new Map<number, GameplayAlertState[]>();
  const persistedStateFilters = filters.platforms.length === 1 && filters.appVersions.length === 1
    ? { appName: filters.appName, platform: filters.platforms[0], appVersion: filters.appVersions[0] }
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
      ...(result.query.result_metadata?.duration ? { durationMs: result.query.result_metadata.duration } : {}),
    },
  };
}

export async function recordGameplayAlertDashboardObservation(filtersInput: unknown, response: LevelFailRateResponse) {
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

export function levelAlertKey(point: Pick<LevelFailRatePoint, "level" | "layoutBankId" | "layoutHash" | "difficultyTier">, filters: TechLaunchFilters) {
  return `${filters.appName}:${filters.platform}:${filters.appVersion}:${point.level}:${point.layoutHash ?? `bank:${point.layoutBankId}`}:${point.difficultyTier}`;
}

function stateFromRecord(record: GameplayAlertStateRecord): GameplayAlertState {
  return {
    alertKey: record.alertKey,
    appName: record.appName,
    platform: record.platform,
    appVersion: record.appVersion,
    level: record.level,
    ...(record.layoutBankId ? { layoutBankId: record.layoutBankId } : {}),
    ...(record.layoutHash ? { layoutHash: record.layoutHash } : {}),
    difficultyTier: record.difficultyTier === "hard" ? "hard" : "normal",
    status: record.status === "resolved" || record.status === "superseded" ? record.status : "open",
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    ...(record.resolvedAt ? { resolvedAt: record.resolvedAt } : {}),
    ...(record.supersededAt ? { supersededAt: record.supersededAt } : {}),
    lastFailRate: record.lastFailRate,
    lastReachedPlayers: record.lastReachedPlayers,
    threshold: record.threshold,
    ...(record.slackOpenDeliveredAt ? { slackOpenDeliveredAt: record.slackOpenDeliveredAt } : {}),
    ...(record.slackResolvedDeliveredAt ? { slackResolvedDeliveredAt: record.slackResolvedDeliveredAt } : {}),
  };
}

export async function reconcileGameplayAlerts(filtersInput: unknown) {
  const filters = normalizedTechLaunchFilters(filtersInput);
  const response = await getLevelFailRate(filters);
  const now = new Date().toISOString();
  const existing = new Map((await listGameplayAlertStates(filters)).map((record) => [record.alertKey, stateFromRecord(record)]));
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
    current.set(matchingOpenState?.alertKey ?? levelAlertKey(point, filters), point);
  }
  const next: GameplayAlertState[] = [];
  const transitions: GameplayAlertTransition[] = [];

  for (const [key, point] of current) {
    const previous = existing.get(key);
    const state: GameplayAlertState = {
      alertKey: key, appName: filters.appName, platform: filters.platform, appVersion: filters.appVersion,
      level: point.level, layoutBankId: point.layoutBankId, ...(point.layoutHash ? { layoutHash: point.layoutHash } : {}), difficultyTier: point.difficultyTier, status: "open",
      firstSeenAt: previous?.status === "open" ? previous.firstSeenAt : now,
      lastSeenAt: now, lastFailRate: point.failRate, lastReachedPlayers: point.reachedPlayers, threshold: point.threshold,
      ...(previous?.slackOpenDeliveredAt ? { slackOpenDeliveredAt: previous.slackOpenDeliveredAt } : {}),
    };
    next.push(state);
    if (previous?.status !== "open" || !previous.slackOpenDeliveredAt) transitions.push({ type: "opened", state });
  }

  for (const [key, previous] of existing) {
    if (previous.status !== "open" || current.has(key)) continue;
    if (pendingLayoutByLevel.has(previous.level)) {
      // A newly observed bank may still be a small portion of traffic. Keep
      // the prior alert state quiet until that bank either matures or vanishes,
      // rather than resolving it or opening another notification mid-rollout.
      next.push({ ...previous, lastSeenAt: now });
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

export async function deliverGameplayAlertTransitions(transitions: GameplayAlertTransition[]) {
  const webhook = process.env.SLACK_GAMEPLAY_ALERT_WEBHOOK_URL?.trim();
  if (!webhook || !transitions.length) return { delivered: 0, skipped: transitions.length, configured: Boolean(webhook) };
  const lines = transitions.map(({ type, state }) => {
    const label = type === "opened" ? "OPEN" : "RESOLVED";
    return `*${label}* · ${state.appName} ${state.appVersion} · Level ${state.level} · Layout bank ${state.layoutBankId ?? "legacy"} · ${state.difficultyTier} · ${(state.lastFailRate * 100).toFixed(1)}% fail rate vs ${(state.threshold * 100).toFixed(0)}% · ${state.lastReachedPlayers} players`;
  });
  const response = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `Gameplay Difficulty Alerts\n${lines.join("\n")}` }) });
  if (!response.ok) throw new Error(`Slack webhook returned ${response.status}`);
  const deliveredAt = new Date().toISOString();
  await Promise.all([
    markGameplayAlertSlackDelivered(transitions.filter((transition) => transition.type === "opened").map((transition) => transition.state.alertKey), "opened", deliveredAt),
    markGameplayAlertSlackDelivered(transitions.filter((transition) => transition.type === "resolved").map((transition) => transition.state.alertKey), "resolved", deliveredAt),
  ]);
  return { delivered: transitions.length, skipped: 0, configured: true };
}

export function dailyGameplayAlertFilters(today = new Date()) {
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  return techLaunchAppOptions.map((appName) => ({ appName, platform: "android" as const, appVersion: "", startDate: iso(start), endDate: iso(end) }));
}

export function isIsoDate(value: string) {
  return datePattern.test(value);
}
