import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";

import { getCountQuery, submitCountSql, type CountQuery } from "@/lib/count-api";
import { getTechLaunchReadinessCache, saveTechLaunchReadinessCache } from "@/lib/db";

const sqlPath = path.join(process.cwd(), "data", "tech_launch_telemetry_metrics.sql");

export const techLaunchAppOptions = [
  "hexago",
  "marble",
  "tripletile",
  "wooblast",
  "woodoku",
  "blockkingdom",
  "bubblego",
  "mahjongbloom",
  "wordblast",
  "jelly",
  "bloomsort",
  "wordrush",
  "sizzle",
  "dotpaint",
  "bubblewordchain",
] as const;

export const techLaunchPlatformOptions = ["android", "ios"] as const;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const techLaunchFilterSchema = z
  .object({
    appName: z.enum(techLaunchAppOptions),
    platform: z.enum(techLaunchPlatformOptions),
    appVersion: z.string().trim().min(1).max(80),
    startDate: z.string().regex(datePattern, "Use YYYY-MM-DD"),
    endDate: z.string().regex(datePattern, "Use YYYY-MM-DD"),
  })
  .refine((filters) => filters.startDate <= filters.endDate, {
    path: ["endDate"],
    message: "End date must be on or after start date",
  });

export const techLaunchRequestSchema = techLaunchFilterSchema.extend({
  forceRefresh: z.boolean().optional(),
});

export const techLaunchStatusRequestSchema = z.object({
  jobKey: z.string().trim().min(1),
  filters: techLaunchFilterSchema,
});

export type TechLaunchFilters = z.infer<typeof techLaunchFilterSchema>;
export type TechLaunchRequest = z.infer<typeof techLaunchRequestSchema>;
export type TechLaunchStatusRequest = z.infer<typeof techLaunchStatusRequestSchema>;
export type TechLaunchVerdict = "green" | "yellow" | "red" | "insufficient data";

export type TechLaunchMetricRow = {
  name: string;
  metricTitle: string;
  pctOfSample: number | null;
  pctOfSampleWithTolerance: number | null;
  p50Value: number | null;
  p80Value: number | null;
  benchmark: number | null;
  numSample: number;
  verdict: TechLaunchVerdict;
  higherIsBetter: boolean;
};

export type TechLaunchSummary = {
  overallVerdict: TechLaunchVerdict;
  metricCount: number;
  greenCount: number;
  yellowCount: number;
  redCount: number;
  insufficientCount: number;
  totalSamples: number;
  weakestMetric?: string;
};

export type TechLaunchMetadata = {
  jobKey?: string;
  durationMs?: number;
  numRows?: number;
  executedAt: string;
};

export type TechLaunchReadinessCompletedResponse = {
  status: "completed";
  filters: TechLaunchFilters;
  rows: TechLaunchMetricRow[];
  summary: TechLaunchSummary;
  metadata: TechLaunchMetadata;
  cache: {
    hit: boolean;
    key: string;
    expiresAt: string;
  };
};

export type TechLaunchReadinessPendingResponse = {
  status: "running";
  filters: TechLaunchFilters;
  metadata: {
    jobKey: string;
    submittedAt: string;
  };
  cache: {
    hit: false;
    key: string;
  };
  pollAfterMs: number;
};

export type TechLaunchReadinessResponse = TechLaunchReadinessCompletedResponse | TechLaunchReadinessPendingResponse;

function readBaseSql() {
  return fs.readFileSync(sqlPath, "utf8");
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlDateLiteral(value: string) {
  return `TO_DATE(${sqlLiteral(value)})`;
}

function replaceRequired(sql: string, pattern: RegExp, replacement: string) {
  if (!pattern.test(sql)) throw new Error("Could not apply Tech Launch SQL parameter replacement");
  return sql.replace(pattern, replacement);
}

export function buildTechLaunchSql(filtersInput: unknown) {
  const filters = techLaunchFilterSchema.parse(filtersInput);
  let sql = readBaseSql();
  sql = replaceRequired(
    sql,
    /app_name\s*=\s*'[^']*'\s*-- modifiable parameter/,
    `app_name = ${sqlLiteral(filters.appName)} -- modifiable parameter`,
  );
  sql = replaceRequired(
    sql,
    /ep\.platform\s*=\s*'[^']*'\s*-- modifiable parameter/,
    `ep.platform = ${sqlLiteral(filters.platform)} -- modifiable parameter`,
  );
  sql = replaceRequired(
    sql,
    /ep\.created_at(?:::date)?\s+between\s+current_date\(\)\s*-\s*7\s+and\s+current_date\(\)\s*-- modifiable parameter/i,
    `ep.created_at::date between ${sqlDateLiteral(filters.startDate)} and ${sqlDateLiteral(filters.endDate)} -- modifiable parameter`,
  );
  sql = replaceRequired(
    sql,
    /app_version\s*=\s*'[^']*'\s*-- modifiable parameter/,
    `app_version = ${sqlLiteral(filters.appVersion)} -- modifiable parameter`,
  );
  return sql;
}

export function normalizedTechLaunchFilters(input: unknown): TechLaunchFilters {
  const filters = techLaunchFilterSchema.parse(input);
  return {
    appName: filters.appName,
    platform: filters.platform,
    appVersion: filters.appVersion.trim(),
    startDate: filters.startDate,
    endDate: filters.endDate,
  };
}

function hashText(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function techLaunchCacheKey(filtersInput: unknown) {
  const filters = normalizedTechLaunchFilters(filtersInput);
  const sqlVersionHash = hashText(readBaseSql());
  return hashText(JSON.stringify({ filters, sqlVersionHash }));
}

function cacheTtlMs() {
  const seconds = Number(process.env.TECH_LAUNCH_CACHE_TTL_SECONDS ?? 900);
  return Math.max(60, Number.isFinite(seconds) ? seconds : 900) * 1000;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toVerdict(value: unknown): TechLaunchVerdict {
  if (value === "green" || value === "yellow" || value === "red" || value === "insufficient data") return value;
  return "insufficient data";
}

function rowValue(row: Record<string, unknown>, key: string) {
  return row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
}

export function parseTechLaunchRows(resultPreview: string | undefined): TechLaunchMetricRow[] {
  if (!resultPreview?.trim()) return [];
  const records = parseCsv(resultPreview, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, unknown>>;

  return records.map((row) => {
    const name = String(rowValue(row, "name") ?? "");
    return {
      name,
      metricTitle: String(rowValue(row, "metric_title") ?? name),
      pctOfSample: toNumber(rowValue(row, "pct_of_sample")),
      pctOfSampleWithTolerance: toNumber(rowValue(row, "pct_of_sample_w_tolerance")),
      p50Value: toNumber(rowValue(row, "p50_value")),
      p80Value: toNumber(rowValue(row, "p80_value")),
      benchmark: toNumber(rowValue(row, "benchmark")),
      numSample: toNumber(rowValue(row, "num_sample")) ?? 0,
      verdict: toVerdict(rowValue(row, "verdict")),
      higherIsBetter: name === "Telemetry_FPS_Average",
    };
  });
}

export function summarizeTechLaunchRows(rows: TechLaunchMetricRow[]): TechLaunchSummary {
  const greenCount = rows.filter((row) => row.verdict === "green").length;
  const yellowCount = rows.filter((row) => row.verdict === "yellow").length;
  const redCount = rows.filter((row) => row.verdict === "red").length;
  const insufficientCount = rows.filter((row) => row.verdict === "insufficient data").length;
  const scoredRows = rows.filter((row) => row.verdict !== "insufficient data");
  const verdictRank: Record<TechLaunchVerdict, number> = {
    red: 0,
    yellow: 1,
    "insufficient data": 2,
    green: 3,
  };
  const weakestMetric = [...rows].sort((a, b) => {
    const verdictDelta = verdictRank[a.verdict] - verdictRank[b.verdict];
    if (verdictDelta) return verdictDelta;
    const aScore = a.pctOfSampleWithTolerance ?? Number.POSITIVE_INFINITY;
    const bScore = b.pctOfSampleWithTolerance ?? Number.POSITIVE_INFINITY;
    return aScore - bScore;
  })[0]?.metricTitle;

  let overallVerdict: TechLaunchVerdict = "insufficient data";
  if (scoredRows.length) {
    if (redCount > 0) overallVerdict = "red";
    else if (yellowCount > 0 || insufficientCount > 0) overallVerdict = "yellow";
    else overallVerdict = "green";
  }

  return {
    overallVerdict,
    metricCount: rows.length,
    greenCount,
    yellowCount,
    redCount,
    insufficientCount,
    totalSamples: rows.reduce((total, row) => total + row.numSample, 0),
    ...(weakestMetric ? { weakestMetric } : {}),
  };
}

function responseFromPayload(payload: string, cacheKey: string): TechLaunchReadinessCompletedResponse {
  const parsed = JSON.parse(payload) as Omit<TechLaunchReadinessCompletedResponse, "status" | "cache"> & {
    status?: "completed";
    cache: Omit<TechLaunchReadinessCompletedResponse["cache"], "hit">;
  };
  return {
    ...parsed,
    status: "completed",
    cache: {
      ...parsed.cache,
      key: cacheKey,
      hit: true,
    },
  };
}

async function cachedTechLaunchReadiness(
  filters: TechLaunchFilters,
  cacheKey: string,
  now = new Date(),
): Promise<TechLaunchReadinessCompletedResponse | null> {
    const cached = await getTechLaunchReadinessCache(cacheKey);
    if (cached && new Date(cached.expiresAt) > now) {
      try {
        return responseFromPayload(cached.payload, cacheKey);
      } catch {
        // Ignore malformed cache payloads and replace them with a fresh Count result.
      }
    }
  return null;
}

async function completedResponseFromQuery(
  query: CountQuery,
  filters: TechLaunchFilters,
  cacheKey: string,
  cacheHit: boolean,
): Promise<TechLaunchReadinessCompletedResponse> {
  if (query.status === "error") throw new Error(query.error ?? "Count query failed");
  if (query.status !== "completed") throw new Error("Count query is still running");

  const now = new Date();
  const rows = parseTechLaunchRows(query.result_preview);
  const summary = summarizeTechLaunchRows(rows);
  const expiresAt = new Date(now.getTime() + cacheTtlMs()).toISOString();
  const response: TechLaunchReadinessCompletedResponse = {
    status: "completed",
    filters,
    rows,
    summary,
    metadata: {
      jobKey: query.job_key,
      durationMs: query.result_metadata?.duration,
      numRows: query.result_metadata?.num_rows,
      executedAt: now.toISOString(),
    },
    cache: {
      hit: cacheHit,
      key: cacheKey,
      expiresAt,
    },
  };

  if (!cacheHit) {
    await saveTechLaunchReadinessCache({
      cacheKey,
      payload: JSON.stringify(response),
      createdAt: now.toISOString(),
      expiresAt,
    });
  }

  return response;
}

export async function getTechLaunchReadiness(input: unknown): Promise<TechLaunchReadinessResponse> {
  const request = techLaunchRequestSchema.parse(input);
  const filters = normalizedTechLaunchFilters(request);
  const cacheKey = techLaunchCacheKey(filters);
  const now = new Date();

  if (!request.forceRefresh) {
    const cached = await cachedTechLaunchReadiness(filters, cacheKey, now);
    if (cached) return cached;
  }

  const querySql = buildTechLaunchSql(filters);
  const countResult = await submitCountSql(querySql, {
    cacheStrategy: request.forceRefresh ? "force" : "default",
  });

  if (countResult.query.status === "error") throw new Error(countResult.query.error ?? "Count query failed");
  if (countResult.query.status === "completed") {
    const completed = await getCountQuery(countResult.query.job_key, 1000);
    return completedResponseFromQuery(completed.query, filters, cacheKey, false);
  }

  return {
    status: "running",
    filters,
    metadata: {
      jobKey: countResult.query.job_key,
      submittedAt: now.toISOString(),
    },
    cache: {
      hit: false,
      key: cacheKey,
    },
    pollAfterMs: 1500,
  };
}

export async function getTechLaunchReadinessStatus(input: unknown): Promise<TechLaunchReadinessResponse> {
  const request = techLaunchStatusRequestSchema.parse(input);
  const filters = normalizedTechLaunchFilters(request.filters);
  const cacheKey = techLaunchCacheKey(filters);
  const cached = await cachedTechLaunchReadiness(filters, cacheKey);
  if (cached) return cached;

  const countResult = await getCountQuery(request.jobKey, 1000);
  if (countResult.query.status === "error") throw new Error(countResult.query.error ?? "Count query failed");
  if (countResult.query.status === "running") {
    return {
      status: "running",
      filters,
      metadata: {
        jobKey: countResult.query.job_key,
        submittedAt: new Date().toISOString(),
      },
      cache: {
        hit: false,
        key: cacheKey,
      },
      pollAfterMs: 1500,
    };
  }

  return completedResponseFromQuery(countResult.query, filters, cacheKey, false);
}
