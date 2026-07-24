import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";

import { getCountQuery, runCountSql, submitCountSql, type CountQuery } from "@/lib/count-api";
import {
  getSavedSpec,
  getSavedSpecSummary,
  getTechLaunchReadinessCache,
  saveTechLaunchReadinessCache,
} from "@/lib/db";
import { parseTechLaunchAppVersions, techLaunchAppOptions, type TechLaunchAppVersionOption } from "@/lib/tech-launch";
import type { GeneratedSpec } from "@/lib/types";

const sqlPath = path.join(process.cwd(), "data", "events_audit.sql");

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const specCheckPlatformOptions = ["android", "ios", "all"] as const;

const specCheckFilterFields = {
  specId: z.string().trim().min(1),
  appName: z.enum(techLaunchAppOptions),
  platform: z.enum(specCheckPlatformOptions),
  appVersion: z.string().trim().min(1).max(80),
  startDate: z.string().regex(datePattern, "Use YYYY-MM-DD"),
  endDate: z.string().regex(datePattern, "Use YYYY-MM-DD"),
};

export const specCheckFilterSchema = z
  .object(specCheckFilterFields)
  .refine((filters) => filters.startDate <= filters.endDate, {
    path: ["endDate"],
    message: "End date must be on or after start date",
  });

export const specCheckRequestSchema = specCheckFilterSchema.extend({
  forceRefresh: z.boolean().optional(),
});

export const specCheckStatusRequestSchema = z.object({
  jobKey: z.string().trim().min(1),
  filters: specCheckFilterSchema,
  forceRefresh: z.boolean().optional(),
});

export const specCheckAppVersionsRequestSchema = z
  .object({
    appName: specCheckFilterFields.appName,
    platform: specCheckFilterFields.platform,
    startDate: specCheckFilterFields.startDate,
    endDate: specCheckFilterFields.endDate,
  })
  .refine((filters) => filters.startDate <= filters.endDate, {
    path: ["endDate"],
    message: "End date must be on or after start date",
  });

export type SpecCheckFilters = z.infer<typeof specCheckFilterSchema>;
export type SpecCheckRequest = z.infer<typeof specCheckRequestSchema>;
export type SpecCheckStatusRequest = z.infer<typeof specCheckStatusRequestSchema>;
export type SpecCheckAppVersionsRequest = z.infer<typeof specCheckAppVersionsRequestSchema>;

export const specCheckAppIds: Record<(typeof techLaunchAppOptions)[number], number> = {
  hexago: 18,
  marble: 22,
  tripletile: 9,
  wooblast: 28,
  woodoku: 4,
  blockkingdom: 117,
  bubblego: 23,
  mahjongbloom: 119,
  wordblast: 122,
  wordoku: 3013,
  jelly: 125,
  bloomsort: 3003,
  wordrush: 3001,
  sizzle: 3004,
  stacksmash: 3011,
  dotpaint: 3005,
  bubblewordchain: 3006,
};

const DEFAULT_ENUM_FIELD_NORMS = ["item", "source", "itemtype", "placement"] as const;

export function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readBaseSql() {
  return fs.readFileSync(sqlPath, "utf8");
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlDateLiteral(value: string) {
  return `to_date(${sqlLiteral(value)})`;
}

function replaceRequired(sql: string, pattern: RegExp, replacement: string) {
  if (!pattern.test(sql)) throw new Error("Could not apply Spec Check SQL parameter replacement");
  return sql.replace(pattern, replacement);
}

function hashText(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function specEnumFieldNorms(spec: GeneratedSpec): string[] {
  const norms = new Set<string>(DEFAULT_ENUM_FIELD_NORMS);
  const addIfEnum = (fieldName: string, canonicalFieldName: string) => {
    const canonicalNorm = normalizeName(canonicalFieldName || fieldName);
    if ((DEFAULT_ENUM_FIELD_NORMS as readonly string[]).includes(canonicalNorm)) {
      const fieldNorm = normalizeName(fieldName);
      if (fieldNorm) norms.add(fieldNorm);
    }
  };
  for (const event of spec.generatedEvents) {
    for (const field of event.payloadFields) addIfEnum(field.fieldName, field.canonicalFieldName);
  }
  for (const payload of spec.platformAdPayloads) addIfEnum(payload.payloadName, payload.canonicalPayloadName);
  return [...norms].sort();
}

export function specEventNameNorms(spec: GeneratedSpec): string[] {
  const norms = new Set<string>();
  for (const event of spec.generatedEvents) {
    const norm = normalizeName(event.eventName);
    if (norm) norms.add(norm);
  }
  for (const payload of spec.platformAdPayloads) {
    const norm = normalizeName(payload.platformEventName);
    if (norm) norms.add(norm);
  }
  return [...norms].sort();
}

export function buildSpecCheckSql(
  filtersInput: unknown,
  enumFieldNorms: string[] = [...DEFAULT_ENUM_FIELD_NORMS],
  specEventNorms: string[] = [],
) {
  const filters = specCheckFilterSchema.parse(filtersInput);
  let sql = readBaseSql();
  sql = replaceRequired(
    sql,
    /to_date\('[^']*'\)\s+as start_date,\s*-- modifiable parameter/,
    `${sqlDateLiteral(filters.startDate)} as start_date, -- modifiable parameter`,
  );
  sql = replaceRequired(
    sql,
    /to_date\('[^']*'\)\s+as end_date,\s*-- modifiable parameter/,
    `${sqlDateLiteral(filters.endDate)} as end_date, -- modifiable parameter`,
  );
  sql = replaceRequired(
    sql,
    /\d+\s+as app_id,\s*-- modifiable parameter/,
    `${specCheckAppIds[filters.appName]} as app_id, -- modifiable parameter`,
  );
  sql = replaceRequired(
    sql,
    /'[^']*'\s+as app_version,\s*-- modifiable parameter/,
    `${sqlLiteral(filters.appVersion.trim())} as app_version, -- modifiable parameter`,
  );
  sql = replaceRequired(
    sql,
    /\S+(?:::string)?\s+as platform\s*-- modifiable parameter/,
    filters.platform === "all"
      ? "null::string as platform -- modifiable parameter"
      : `${sqlLiteral(filters.platform)}::string as platform -- modifiable parameter`,
  );
  const normalizedEnumSet = [...new Set(enumFieldNorms.map(normalizeName).filter(Boolean))].sort();
  const enumList = (normalizedEnumSet.length ? normalizedEnumSet : [...DEFAULT_ENUM_FIELD_NORMS])
    .map(sqlLiteral)
    .join(", ");
  sql = replaceRequired(
    sql,
    /payload_name_norm in \([^)]*\)\s*-- modifiable parameter/,
    `payload_name_norm in (${enumList}) -- modifiable parameter`,
  );
  // Spec-event payload rows sort ahead of other payload rows so the 1000-row
  // Count preview cap truncates untracked-event payloads first, never the
  // rows the deep checks depend on.
  const normalizedEventNorms = [...new Set(specEventNorms.map(normalizeName).filter(Boolean))].sort();
  const eventNormList = (normalizedEventNorms.length ? normalizedEventNorms : [""]).map(sqlLiteral).join(", ");
  sql = replaceRequired(
    sql,
    /case when event_name_norm in \([^)]*\) then 0 else 1 end,\s*-- modifiable parameter/,
    `case when event_name_norm in (${eventNormList}) then 0 else 1 end, -- modifiable parameter`,
  );
  return sql;
}

export function buildSpecCheckAppVersionsSql(filtersInput: unknown) {
  const filters = specCheckAppVersionsRequestSchema.parse(filtersInput);
  const platformPredicate =
    filters.platform === "all" ? "" : `\n  and lower(platform) = lower(${sqlLiteral(filters.platform)})`;
  return `
select
  app_version,
  count(1) as sample_count,
  min(created_at::date)::varchar as first_seen,
  max(created_at::date)::varchar as last_seen
from TDS_DB.PUBLIC.EVENTS_PRODUCTION_LUDIOS_UNION
where app_id = ${specCheckAppIds[filters.appName]}
  and created_at::date between ${sqlDateLiteral(filters.startDate)} and ${sqlDateLiteral(filters.endDate)}${platformPredicate}
  and app_version is not null
  and app_version <> ''
group by 1
order by last_seen desc, sample_count desc, app_version desc
`.trim();
}

export type AuditEventRow = {
  eventName: string;
  eventNameNorm: string;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
};

export type AuditEnumValue = {
  value: string;
  valueNorm: string;
  count: number;
};

export type AuditPayloadRow = {
  eventName: string;
  eventNameNorm: string;
  payloadName: string;
  payloadNameNorm: string;
  observedType: string;
  payloadCount: number;
  distinctValueCount: number | null;
  maxLength: number | null;
  exampleValues: string[];
  enumValues: AuditEnumValue[];
  enumCapped: boolean;
};

export type AuditData = {
  events: AuditEventRow[];
  payloads: AuditPayloadRow[];
  truncated: boolean;
};

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowValue(row: Record<string, unknown>, key: string) {
  return row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
}

function parseEnumValueCounts(raw: string): AuditEnumValue[] {
  if (!raw.trim()) return [];
  return raw
    .split("|||")
    .map((entry) => {
      const separator = entry.lastIndexOf(":::");
      if (separator < 0) return null;
      const value = entry.slice(0, separator);
      const count = toNumber(entry.slice(separator + 3)) ?? 0;
      if (!value) return null;
      return { value, valueNorm: normalizeName(value), count };
    })
    .filter((entry): entry is AuditEnumValue => entry !== null);
}

export function parseAuditRows(resultPreview: string | undefined, numRows?: number): AuditData {
  if (!resultPreview?.trim()) return { events: [], payloads: [], truncated: false };
  const records = parseCsv(resultPreview, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, unknown>>;

  const events: AuditEventRow[] = [];
  const payloads: AuditPayloadRow[] = [];

  for (const row of records) {
    const rowType = String(rowValue(row, "row_type") ?? "").toLowerCase();
    const eventName = String(rowValue(row, "event_name") ?? "");
    if (!eventName) continue;
    const eventNameNorm = normalizeName(eventName);

    if (rowType === "event") {
      events.push({
        eventName,
        eventNameNorm,
        eventCount: toNumber(rowValue(row, "event_count")) ?? 0,
        firstSeen: String(rowValue(row, "first_seen") ?? ""),
        lastSeen: String(rowValue(row, "last_seen") ?? ""),
      });
      continue;
    }

    if (rowType === "payload") {
      const payloadName = String(rowValue(row, "payload_name") ?? "");
      if (!payloadName) continue;
      const enumValues = parseEnumValueCounts(String(rowValue(row, "enum_value_counts") ?? ""));
      const enumRankCount = toNumber(rowValue(row, "enum_value_rank_count")) ?? enumValues.length;
      payloads.push({
        eventName,
        eventNameNorm,
        payloadName,
        payloadNameNorm: normalizeName(payloadName),
        observedType: String(rowValue(row, "observed_type") ?? "").toLowerCase(),
        payloadCount: toNumber(rowValue(row, "payload_count")) ?? 0,
        distinctValueCount: toNumber(rowValue(row, "distinct_value_count")),
        maxLength: toNumber(rowValue(row, "max_length")),
        exampleValues: String(rowValue(row, "example_values") ?? "")
          .split(" | ")
          .map((value) => value.trim())
          .filter(Boolean),
        enumValues,
        enumCapped: enumRankCount >= 50,
      });
    }
  }

  return {
    events,
    payloads,
    truncated: numRows !== undefined && numRows > records.length,
  };
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + substitutionCost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

export function typoDistanceThreshold(length: number) {
  if (length <= 4) return 1;
  if (length <= 10) return 2;
  return 3;
}

function isTypoDistance(aNorm: string, bNorm: string, distance: number) {
  if (distance < 1) return false;
  if (distance > typoDistanceThreshold(Math.max(aNorm.length, bNorm.length))) return false;
  return distance < Math.min(aNorm.length, bNorm.length);
}

type NormMatchResult<S, L> = {
  exactPairs: Array<{ spec: S; live: L }>;
  typoPairs: Array<{ spec: S; live: L; distance: number }>;
  unmatchedSpec: S[];
  unmatchedLive: L[];
};

function matchByNorm<S, L>(
  specItems: S[],
  liveItems: L[],
  specNorm: (item: S) => string,
  liveNorm: (item: L) => string,
): NormMatchResult<S, L> {
  const exactPairs: Array<{ spec: S; live: L }> = [];
  const typoPairs: Array<{ spec: S; live: L; distance: number }> = [];
  const unclaimedLive = new Map<L, string>(liveItems.map((item) => [item, liveNorm(item)]));

  const pendingSpec: Array<{ item: S; norm: string }> = [];
  for (const item of specItems) {
    const norm = specNorm(item);
    const exact = [...unclaimedLive.entries()].find(([, candidateNorm]) => candidateNorm === norm);
    if (exact) {
      exactPairs.push({ spec: item, live: exact[0] });
      unclaimedLive.delete(exact[0]);
    } else {
      pendingSpec.push({ item, norm });
    }
  }

  const unmatchedSpec: S[] = [];
  for (const { item, norm } of pendingSpec.sort((a, b) => a.norm.localeCompare(b.norm))) {
    let best: { live: L; norm: string; distance: number } | null = null;
    for (const [candidate, candidateNorm] of unclaimedLive) {
      const distance = levenshtein(norm, candidateNorm);
      if (!isTypoDistance(norm, candidateNorm, distance)) continue;
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance && candidateNorm.localeCompare(best.norm) < 0)
      ) {
        best = { live: candidate, norm: candidateNorm, distance };
      }
    }
    if (best) {
      typoPairs.push({ spec: item, live: best.live, distance: best.distance });
      unclaimedLive.delete(best.live);
    } else {
      unmatchedSpec.push(item);
    }
  }

  return { exactPairs, typoPairs, unmatchedSpec, unmatchedLive: [...unclaimedLive.keys()] };
}

export function parseExampleValues(example: string): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const segment of example.split(/[,;\n]/)) {
    for (const token of segment.split(/\s+\/\s+/)) {
      const value = token.trim().replace(/^["']+|["']+$/g, "").trim();
      if (!value) continue;
      const norm = normalizeName(value);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      values.push(value);
    }
  }
  return values;
}

export function expectedObservedTypes(specType: string): Set<string> | null {
  const normalized = specType.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("array")) return null;
  if (normalized.includes("bool")) return new Set(["boolean"]);
  if (normalized.includes("int")) return new Set(["integer", "boolean"]);
  if (/float|double|decimal|numeric|number/.test(normalized)) return new Set(["float", "integer", "boolean"]);
  return null;
}

export type SpecCheckFindingType =
  | "missing_event"
  | "event_typo"
  | "untracked_event"
  | "missing_payload"
  | "payload_typo"
  | "untracked_payload"
  | "type_mismatch"
  | "enum_value_typo"
  | "enum_unexpected_value"
  | "enum_missing_coverage"
  | "duplicate_spec_payload";

export type SpecCheckSeverity = "error" | "warning" | "info";

export type SpecCheckFinding = {
  type: SpecCheckFindingType;
  severity: SpecCheckSeverity;
  eventName: string;
  payloadName?: string;
  specValue?: string;
  observedValue?: string;
  count?: number;
  detail: string;
};

type SpecPayloadModel = {
  fieldName: string;
  nameNorm: string;
  canonicalFieldName: string;
  specType: string;
  requiredness: string;
  mandatory: boolean;
  isEnum: boolean;
  allowedValues: string[];
  expectedTypes: Set<string> | null;
};

type SpecEventModel = {
  eventName: string;
  nameNorm: string;
  source: "event" | "platformAd";
  payloads: SpecPayloadModel[];
};

function isMandatoryRequiredness(requiredness: string) {
  return /required|mandatory/i.test(requiredness);
}

function isEnumField(fieldName: string, canonicalFieldName: string) {
  return (DEFAULT_ENUM_FIELD_NORMS as readonly string[]).includes(normalizeName(canonicalFieldName || fieldName));
}

export function specToCheckModel(spec: GeneratedSpec): { events: SpecEventModel[]; findings: SpecCheckFinding[] } {
  const findings: SpecCheckFinding[] = [];
  const events: SpecEventModel[] = [];
  const eventsByNorm = new Map<string, SpecEventModel>();

  const ensureEvent = (eventName: string, source: "event" | "platformAd") => {
    const nameNorm = normalizeName(eventName);
    const existing = eventsByNorm.get(nameNorm);
    if (existing) return existing;
    const model: SpecEventModel = { eventName, nameNorm, source, payloads: [] };
    eventsByNorm.set(nameNorm, model);
    events.push(model);
    return model;
  };

  const addPayload = (
    event: SpecEventModel,
    fieldName: string,
    canonicalFieldName: string,
    specType: string,
    requiredness: string,
    example: string,
  ) => {
    const displayFieldName = canonicalFieldName || fieldName;
    const nameNorm = normalizeName(displayFieldName);
    if (!nameNorm) return;
    const existing = event.payloads.find((payload) => payload.nameNorm === nameNorm);
    const allowedValues = parseExampleValues(example);
    if (existing) {
      const seen = new Set(existing.allowedValues.map(normalizeName));
      for (const value of allowedValues) {
        if (!seen.has(normalizeName(value))) existing.allowedValues.push(value);
      }
      findings.push({
        type: "duplicate_spec_payload",
        severity: "info",
        eventName: event.eventName,
        payloadName: displayFieldName,
        detail: `Spec defines "${displayFieldName}" more than once for ${event.eventName}; example values were merged for checking.`,
      });
      return;
    }
    event.payloads.push({
      fieldName: displayFieldName,
      nameNorm,
      canonicalFieldName,
      specType,
      requiredness,
      mandatory: isMandatoryRequiredness(requiredness),
      isEnum: isEnumField(fieldName, canonicalFieldName),
      allowedValues,
      expectedTypes: expectedObservedTypes(specType),
    });
  };

  for (const event of spec.generatedEvents) {
    const model = ensureEvent(event.eventName, "event");
    for (const field of event.payloadFields) {
      addPayload(model, field.fieldName, field.canonicalFieldName, field.type, field.requiredness, field.example);
    }
  }

  for (const payload of spec.platformAdPayloads) {
    const model = ensureEvent(payload.platformEventName, "platformAd");
    addPayload(model, payload.payloadName, payload.canonicalPayloadName, "", payload.requiredness, payload.example);
  }

  return { events, findings };
}

export type SpecCheckPayloadReport = {
  specName?: string;
  liveName?: string;
  status: "matched" | "typo" | "missing" | "untracked";
  specType?: string;
  observedType?: string;
  requiredness?: string;
  mandatory?: boolean;
  isEnum?: boolean;
  payloadCount?: number;
  distinctValueCount?: number | null;
  exampleValues?: string[];
  findings: SpecCheckFinding[];
};

export type SpecCheckEventReport = {
  specEventName?: string;
  liveEventName?: string;
  source: "event" | "platformAd" | "live-only";
  status: "matched" | "typo" | "missing" | "untracked";
  eventCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  findings: SpecCheckFinding[];
  payloads: SpecCheckPayloadReport[];
};

export type SpecCheckVerdict = "pass" | "warnings" | "fail" | "no data";

export type SpecCheckSummary = {
  verdict: SpecCheckVerdict;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  specEventCount: number;
  liveEventCount: number;
  matchedEventCount: number;
  missingEventCount: number;
  typoEventCount: number;
  untrackedEventCount: number;
  findingCountsByType: Record<SpecCheckFindingType, number>;
};

export type SpecCheckReport = {
  summary: SpecCheckSummary;
  findings: SpecCheckFinding[];
  events: SpecCheckEventReport[];
  truncated: boolean;
};

const AUDIT_EXCLUDED_EVENT_PATTERN = /test|debug|qa/i;

function comparePayloadValues(
  finding: (input: Omit<SpecCheckFinding, "eventName">) => void,
  specPayload: SpecPayloadModel,
  livePayload: AuditPayloadRow,
) {
  if (specPayload.expectedTypes && !specPayload.expectedTypes.has(livePayload.observedType)) {
    finding({
      type: "type_mismatch",
      severity: livePayload.observedType === "string" ? "error" : "warning",
      payloadName: specPayload.fieldName,
      specValue: specPayload.specType,
      observedValue: livePayload.observedType,
      detail: `Spec type "${specPayload.specType}" but live data is ${livePayload.observedType} (e.g. ${livePayload.exampleValues.slice(0, 3).join(", ") || "no examples"}).`,
    });
  }

  if (!specPayload.isEnum || !specPayload.allowedValues.length) return;

  if (livePayload.observedType !== "string") {
    finding({
      type: "type_mismatch",
      severity: "warning",
      payloadName: specPayload.fieldName,
      specValue: specPayload.specType || "string (enum-like)",
      observedValue: livePayload.observedType,
      detail: `Enum-like payload "${specPayload.fieldName}" expected string values but live data is ${livePayload.observedType}; enum value checks skipped.`,
    });
    return;
  }
  if (!livePayload.enumValues.length) return;

  const allowed = specPayload.allowedValues.map((value) => ({ value, norm: normalizeName(value) }));
  const claimed = new Set<string>();

  for (const observed of livePayload.enumValues) {
    const exact = allowed.find((candidate) => candidate.norm === observed.valueNorm);
    if (exact) {
      claimed.add(exact.norm);
      continue;
    }
    let best: { value: string; norm: string; distance: number } | null = null;
    for (const candidate of allowed) {
      const distance = levenshtein(observed.valueNorm, candidate.norm);
      if (!isTypoDistance(observed.valueNorm, candidate.norm, distance)) continue;
      if (!best || distance < best.distance) best = { ...candidate, distance };
    }
    if (best) {
      claimed.add(best.norm);
      finding({
        type: "enum_value_typo",
        severity: "error",
        payloadName: specPayload.fieldName,
        specValue: best.value,
        observedValue: observed.value,
        count: observed.count,
        detail: `Observed value "${observed.value}" (${observed.count}x) looks like a typo of spec value "${best.value}".`,
      });
    } else {
      finding({
        type: "enum_unexpected_value",
        severity: "warning",
        payloadName: specPayload.fieldName,
        observedValue: observed.value,
        count: observed.count,
        detail: `Observed value "${observed.value}" (${observed.count}x) is not in the spec's allowed values for "${specPayload.fieldName}".`,
      });
    }
  }

  for (const candidate of allowed) {
    if (claimed.has(candidate.norm)) continue;
    const caveat = livePayload.enumCapped
      ? " (live values were capped at the top 50; it may exist below the cap)"
      : "";
    finding({
      type: "enum_missing_coverage",
      severity: "warning",
      payloadName: specPayload.fieldName,
      specValue: candidate.value,
      detail: `Spec value "${candidate.value}" for "${specPayload.fieldName}" was never observed in live data${caveat}.`,
    });
  }
}

export function compareSpecToAudit(spec: GeneratedSpec, audit: AuditData): SpecCheckReport {
  const { events: specEvents, findings: modelFindings } = specToCheckModel(spec);
  const findings: SpecCheckFinding[] = [...modelFindings];
  const eventReports: SpecCheckEventReport[] = [];

  const livePayloadsByEvent = new Map<string, AuditPayloadRow[]>();
  for (const payload of audit.payloads) {
    const existing = livePayloadsByEvent.get(payload.eventNameNorm);
    if (existing) existing.push(payload);
    else livePayloadsByEvent.set(payload.eventNameNorm, [payload]);
  }

  const eventMatch = matchByNorm(
    specEvents,
    audit.events,
    (event) => event.nameNorm,
    (event) => event.eventNameNorm,
  );

  const compareEventPair = (
    specEvent: SpecEventModel,
    liveEvent: AuditEventRow,
    status: "matched" | "typo",
    distance?: number,
  ) => {
    const eventFindings: SpecCheckFinding[] = [];
    if (status === "typo") {
      eventFindings.push({
        type: "event_typo",
        severity: "error",
        eventName: specEvent.eventName,
        observedValue: liveEvent.eventName,
        detail: `Live event "${liveEvent.eventName}" looks like a typo of spec event "${specEvent.eventName}" (distance ${distance}).`,
      });
    }

    const livePayloads = livePayloadsByEvent.get(liveEvent.eventNameNorm) ?? [];
    const payloadMatch = matchByNorm(
      specEvent.payloads,
      livePayloads,
      (payload) => payload.nameNorm,
      (payload) => payload.payloadNameNorm,
    );

    const payloadReports: SpecCheckPayloadReport[] = [];

    const comparePayloadPair = (
      specPayload: SpecPayloadModel,
      livePayload: AuditPayloadRow,
      payloadStatus: "matched" | "typo",
      payloadDistance?: number,
    ) => {
      const payloadFindings: SpecCheckFinding[] = [];
      const pushFinding = (input: Omit<SpecCheckFinding, "eventName">) => {
        payloadFindings.push({ ...input, eventName: specEvent.eventName });
      };
      if (payloadStatus === "typo") {
        pushFinding({
          type: "payload_typo",
          severity: "error",
          payloadName: specPayload.fieldName,
          observedValue: livePayload.payloadName,
          detail: `Live payload "${livePayload.payloadName}" looks like a typo of spec payload "${specPayload.fieldName}" (distance ${payloadDistance}).`,
        });
      }
      comparePayloadValues(pushFinding, specPayload, livePayload);
      payloadReports.push({
        specName: specPayload.fieldName,
        liveName: livePayload.payloadName,
        status: payloadStatus,
        specType: specPayload.specType,
        observedType: livePayload.observedType,
        requiredness: specPayload.requiredness,
        mandatory: specPayload.mandatory,
        isEnum: specPayload.isEnum,
        payloadCount: livePayload.payloadCount,
        distinctValueCount: livePayload.distinctValueCount,
        exampleValues: livePayload.exampleValues,
        findings: payloadFindings,
      });
      eventFindings.push(...payloadFindings);
    };

    for (const pair of payloadMatch.exactPairs) comparePayloadPair(pair.spec, pair.live, "matched");
    for (const pair of payloadMatch.typoPairs) comparePayloadPair(pair.spec, pair.live, "typo", pair.distance);

    for (const specPayload of payloadMatch.unmatchedSpec) {
      const missingFinding: SpecCheckFinding = {
        type: "missing_payload",
        severity: "error",
        eventName: specEvent.eventName,
        payloadName: specPayload.fieldName,
        detail: `Spec payload "${specPayload.fieldName}" (${specPayload.requiredness || "requiredness unspecified"}) was never observed on ${liveEvent.eventName}.`,
      };
      eventFindings.push(missingFinding);
      payloadReports.push({
        specName: specPayload.fieldName,
        status: "missing",
        specType: specPayload.specType,
        requiredness: specPayload.requiredness,
        mandatory: specPayload.mandatory,
        isEnum: specPayload.isEnum,
        findings: [missingFinding],
      });
    }

    for (const livePayload of payloadMatch.unmatchedLive) {
      const untrackedFinding: SpecCheckFinding = {
        type: "untracked_payload",
        severity: "info",
        eventName: specEvent.eventName,
        payloadName: livePayload.payloadName,
        count: livePayload.payloadCount,
        detail: `Live payload "${livePayload.payloadName}" (${livePayload.payloadCount}x, ${livePayload.observedType}) is not in the spec for ${specEvent.eventName}.`,
      };
      eventFindings.push(untrackedFinding);
      payloadReports.push({
        liveName: livePayload.payloadName,
        status: "untracked",
        observedType: livePayload.observedType,
        payloadCount: livePayload.payloadCount,
        distinctValueCount: livePayload.distinctValueCount,
        exampleValues: livePayload.exampleValues,
        findings: [untrackedFinding],
      });
    }

    findings.push(...eventFindings);
    eventReports.push({
      specEventName: specEvent.eventName,
      liveEventName: liveEvent.eventName,
      source: specEvent.source,
      status,
      eventCount: liveEvent.eventCount,
      firstSeen: liveEvent.firstSeen,
      lastSeen: liveEvent.lastSeen,
      findings: eventFindings,
      payloads: payloadReports,
    });
  };

  for (const pair of eventMatch.exactPairs) compareEventPair(pair.spec, pair.live, "matched");
  for (const pair of eventMatch.typoPairs) compareEventPair(pair.spec, pair.live, "typo", pair.distance);

  for (const specEvent of eventMatch.unmatchedSpec) {
    const excluded = AUDIT_EXCLUDED_EVENT_PATTERN.test(specEvent.eventName);
    const missingFinding: SpecCheckFinding = {
      type: "missing_event",
      severity: excluded ? "info" : "error",
      eventName: specEvent.eventName,
      detail: excluded
        ? `Spec event "${specEvent.eventName}" matches the audit's test/debug/qa exclusion filter, so it cannot be observed by this check.`
        : `Spec event "${specEvent.eventName}" was never observed in live data.`,
    };
    findings.push(missingFinding);
    eventReports.push({
      specEventName: specEvent.eventName,
      source: specEvent.source,
      status: "missing",
      findings: [missingFinding],
      payloads: specEvent.payloads.map((payload) => ({
        specName: payload.fieldName,
        status: "missing",
        specType: payload.specType,
        requiredness: payload.requiredness,
        mandatory: payload.mandatory,
        isEnum: payload.isEnum,
        findings: [],
      })),
    });
  }

  for (const liveEvent of eventMatch.unmatchedLive) {
    const untrackedFinding: SpecCheckFinding = {
      type: "untracked_event",
      severity: "info",
      eventName: liveEvent.eventName,
      count: liveEvent.eventCount,
      detail: `Live event "${liveEvent.eventName}" (${liveEvent.eventCount}x) is not in the spec.`,
    };
    findings.push(untrackedFinding);
    eventReports.push({
      liveEventName: liveEvent.eventName,
      source: "live-only",
      status: "untracked",
      eventCount: liveEvent.eventCount,
      firstSeen: liveEvent.firstSeen,
      lastSeen: liveEvent.lastSeen,
      findings: [untrackedFinding],
      payloads: (livePayloadsByEvent.get(liveEvent.eventNameNorm) ?? []).map((payload) => ({
        liveName: payload.payloadName,
        status: "untracked",
        observedType: payload.observedType,
        payloadCount: payload.payloadCount,
        distinctValueCount: payload.distinctValueCount,
        exampleValues: payload.exampleValues,
        findings: [],
      })),
    });
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const infoCount = findings.filter((finding) => finding.severity === "info").length;

  const findingCountsByType = {
    missing_event: 0,
    event_typo: 0,
    untracked_event: 0,
    missing_payload: 0,
    payload_typo: 0,
    untracked_payload: 0,
    type_mismatch: 0,
    enum_value_typo: 0,
    enum_unexpected_value: 0,
    enum_missing_coverage: 0,
    duplicate_spec_payload: 0,
  } satisfies Record<SpecCheckFindingType, number>;
  for (const finding of findings) findingCountsByType[finding.type] += 1;

  const verdict: SpecCheckVerdict = !audit.events.length
    ? "no data"
    : errorCount > 0
      ? "fail"
      : warningCount > 0
        ? "warnings"
        : "pass";

  return {
    summary: {
      verdict,
      errorCount,
      warningCount,
      infoCount,
      specEventCount: specEvents.length,
      liveEventCount: audit.events.length,
      matchedEventCount: eventMatch.exactPairs.length,
      missingEventCount: eventMatch.unmatchedSpec.length,
      typoEventCount: eventMatch.typoPairs.length,
      untrackedEventCount: eventMatch.unmatchedLive.length,
      findingCountsByType,
    },
    findings,
    events: eventReports,
    truncated: audit.truncated,
  };
}

export type SpecCheckSpecInfo = {
  id: string;
  gameTitle: string;
  updatedAt: string;
};

export type SpecCheckMetadata = {
  jobKey?: string;
  durationMs?: number;
  numRows?: number;
  executedAt: string;
};

export type SpecCheckCompletedResponse = {
  status: "completed";
  filters: SpecCheckFilters;
  spec: SpecCheckSpecInfo;
  report: SpecCheckReport;
  metadata: SpecCheckMetadata;
  cache: {
    hit: boolean;
    key: string;
    expiresAt: string;
  };
};

export type SpecCheckPendingResponse = {
  status: "running";
  filters: SpecCheckFilters;
  spec: SpecCheckSpecInfo;
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

export type SpecCheckResponse = SpecCheckCompletedResponse | SpecCheckPendingResponse;

export type SpecCheckAppVersionsResponse = {
  filters: SpecCheckAppVersionsRequest;
  versions: TechLaunchAppVersionOption[];
  metadata: SpecCheckMetadata;
  cache: {
    hit: boolean;
    key: string;
    expiresAt: string;
  };
};

export function normalizedSpecCheckFilters(input: unknown): SpecCheckFilters {
  const filters = specCheckFilterSchema.parse(input);
  return {
    specId: filters.specId,
    appName: filters.appName,
    platform: filters.platform,
    appVersion: filters.appVersion.trim(),
    startDate: filters.startDate,
    endDate: filters.endDate,
  };
}

export function specCheckCacheKey(filters: SpecCheckFilters, specUpdatedAt: string, builtSql: string) {
  return `spec-check:${hashText(JSON.stringify({ filters, specUpdatedAt, sqlHash: hashText(builtSql), version: 1 }))}`;
}

export function specCheckAppVersionsCacheKey(filtersInput: unknown) {
  const filters = specCheckAppVersionsRequestSchema.parse(filtersInput);
  return `spec-check:app-versions:${hashText(JSON.stringify({ filters, version: 1 }))}`;
}

function cacheTtlMs() {
  const seconds = Number(process.env.SPEC_CHECK_CACHE_TTL_SECONDS ?? 900);
  return Math.max(60, Number.isFinite(seconds) ? seconds : 900) * 1000;
}

function appVersionsCacheTtlMs() {
  const seconds = Number(process.env.SPEC_CHECK_APP_VERSION_CACHE_TTL_SECONDS ?? 3600);
  return Math.max(60, Number.isFinite(seconds) ? seconds : 3600) * 1000;
}

function specNotFoundResponse() {
  return new Response(JSON.stringify({ error: "Spec not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadSpecForCheck(specId: string): Promise<{ spec: GeneratedSpec; info: SpecCheckSpecInfo }> {
  const [summary, spec] = await Promise.all([getSavedSpecSummary(specId), getSavedSpec(specId)]);
  if (!summary || !spec) throw specNotFoundResponse();
  return {
    spec,
    info: { id: summary.id, gameTitle: summary.gameTitle, updatedAt: summary.updatedAt },
  };
}

function completedResponseFromPayload(payload: string, cacheKey: string): SpecCheckCompletedResponse {
  const parsed = JSON.parse(payload) as Omit<SpecCheckCompletedResponse, "status" | "cache"> & {
    status?: "completed";
    cache: Omit<SpecCheckCompletedResponse["cache"], "hit">;
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

async function cachedSpecCheck(cacheKey: string, now = new Date()): Promise<SpecCheckCompletedResponse | null> {
  const cached = await getTechLaunchReadinessCache(cacheKey);
  if (cached && new Date(cached.expiresAt) > now) {
    try {
      return completedResponseFromPayload(cached.payload, cacheKey);
    } catch {
      // Ignore malformed cache payloads and replace them with a fresh Count result.
    }
  }
  return null;
}

async function completedSpecCheckFromQuery(
  query: CountQuery,
  filters: SpecCheckFilters,
  spec: GeneratedSpec,
  specInfo: SpecCheckSpecInfo,
  cacheKey: string,
): Promise<SpecCheckCompletedResponse> {
  if (query.status === "error") throw new Error(query.error ?? "Count query failed");
  if (query.status !== "completed") throw new Error("Count query is still running");

  const now = new Date();
  const audit = parseAuditRows(query.result_preview, query.result_metadata?.num_rows);
  const report = compareSpecToAudit(spec, audit);
  const expiresAt = new Date(now.getTime() + cacheTtlMs()).toISOString();
  const response: SpecCheckCompletedResponse = {
    status: "completed",
    filters,
    spec: specInfo,
    report,
    metadata: {
      jobKey: query.job_key,
      durationMs: query.result_metadata?.duration,
      numRows: query.result_metadata?.num_rows,
      executedAt: now.toISOString(),
    },
    cache: {
      hit: false,
      key: cacheKey,
      expiresAt,
    },
  };

  await saveTechLaunchReadinessCache({
    cacheKey,
    payload: JSON.stringify(response),
    createdAt: now.toISOString(),
    expiresAt,
  });

  return response;
}

export async function getSpecCheck(input: unknown): Promise<SpecCheckResponse> {
  const request = specCheckRequestSchema.parse(input);
  const filters = normalizedSpecCheckFilters(request);
  const { spec, info } = await loadSpecForCheck(filters.specId);
  const querySql = buildSpecCheckSql(filters, specEnumFieldNorms(spec), specEventNameNorms(spec));
  const cacheKey = specCheckCacheKey(filters, info.updatedAt, querySql);
  const now = new Date();

  if (!request.forceRefresh) {
    const cached = await cachedSpecCheck(cacheKey, now);
    if (cached) return cached;
  }

  const countResult = await submitCountSql(querySql, {
    cacheStrategy: request.forceRefresh ? "force" : "default",
  });

  if (countResult.query.status === "error") throw new Error(countResult.query.error ?? "Count query failed");
  if (countResult.query.status === "completed") {
    const completed = await getCountQuery(countResult.query.job_key, 1000);
    return completedSpecCheckFromQuery(completed.query, filters, spec, info, cacheKey);
  }

  return {
    status: "running",
    filters,
    spec: info,
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

export async function getSpecCheckStatus(input: unknown): Promise<SpecCheckResponse> {
  const request = specCheckStatusRequestSchema.parse(input);
  const filters = normalizedSpecCheckFilters(request.filters);
  const { spec, info } = await loadSpecForCheck(filters.specId);
  const querySql = buildSpecCheckSql(filters, specEnumFieldNorms(spec), specEventNameNorms(spec));
  const cacheKey = specCheckCacheKey(filters, info.updatedAt, querySql);
  if (!request.forceRefresh) {
    const cached = await cachedSpecCheck(cacheKey);
    if (cached) return cached;
  }

  const countResult = await getCountQuery(request.jobKey, 1000);
  if (countResult.query.status === "error") throw new Error(countResult.query.error ?? "Count query failed");
  if (countResult.query.status === "running") {
    return {
      status: "running",
      filters,
      spec: info,
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

  return completedSpecCheckFromQuery(countResult.query, filters, spec, info, cacheKey);
}

function appVersionsResponseFromPayload(payload: string, cacheKey: string): SpecCheckAppVersionsResponse {
  const parsed = JSON.parse(payload) as Omit<SpecCheckAppVersionsResponse, "cache"> & {
    cache: Omit<SpecCheckAppVersionsResponse["cache"], "hit">;
  };
  return {
    ...parsed,
    cache: {
      ...parsed.cache,
      key: cacheKey,
      hit: true,
    },
  };
}

export async function getSpecCheckAppVersions(input: unknown): Promise<SpecCheckAppVersionsResponse> {
  const filters = specCheckAppVersionsRequestSchema.parse(input);
  const cacheKey = specCheckAppVersionsCacheKey(filters);
  const now = new Date();

  const cached = await getTechLaunchReadinessCache(cacheKey);
  if (cached && new Date(cached.expiresAt) > now) {
    try {
      return appVersionsResponseFromPayload(cached.payload, cacheKey);
    } catch {
      // Ignore malformed cache payloads and replace them with a fresh Count result.
    }
  }

  const countResult = await runCountSql(buildSpecCheckAppVersionsSql(filters), {
    cacheStrategy: "default",
    previewRows: 1000,
  });
  if (countResult.query.status === "error") throw new Error(countResult.query.error ?? "Count query failed");

  const versions = parseTechLaunchAppVersions(countResult.query.result_preview);
  const expiresAt = new Date(now.getTime() + appVersionsCacheTtlMs()).toISOString();
  const response: SpecCheckAppVersionsResponse = {
    filters,
    versions,
    metadata: {
      jobKey: countResult.query.job_key,
      durationMs: countResult.query.result_metadata?.duration,
      numRows: countResult.query.result_metadata?.num_rows,
      executedAt: now.toISOString(),
    },
    cache: {
      hit: false,
      key: cacheKey,
      expiresAt,
    },
  };

  await saveTechLaunchReadinessCache({
    cacheKey,
    payload: JSON.stringify(response),
    createdAt: now.toISOString(),
    expiresAt,
  });

  return response;
}
