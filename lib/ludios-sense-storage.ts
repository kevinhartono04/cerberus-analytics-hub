import { createHash } from "node:crypto";
import { getTechLaunchReadinessCache, saveTechLaunchReadinessCache } from "@/lib/db";
import { historyWindows, type StoredSenseHistory } from "@/lib/ludios-sense-history";
import type { SenseCountry } from "@/lib/ludios-sense-types";

export const SENSE_RECORD_LIMIT = 4 * 1024 * 1024;
export const SENSE_HISTORY_LIMIT = 256 * 1024;
export type ShardedHistory = StoredSenseHistory & { historyRef?: string; historyRefExpiresAt?: string };
const hydrated = new WeakSet<ShardedHistory>();
export function boundedSenseJson(value: unknown, maxBytes = SENSE_RECORD_LIMIT) {
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload) > maxBytes) throw new Error("Saved scan exceeds the safe storage limit; offline migration is required before resuming.");
  return payload;
}
export async function readSenseRecord<T>(key: string, maxBytes = SENSE_RECORD_LIMIT): Promise<T | null> {
  const row = await getTechLaunchReadinessCache(key, maxBytes);
  if (!row || (row.expiresAt && row.expiresAt <= new Date().toISOString())) return null;
  // Defense in depth for alternate adapters; SQL enforces this before transfer in production.
  if (Buffer.byteLength(row.payload) > maxBytes) throw new Error("Saved scan exceeds the safe storage limit; offline migration is required before resuming.");
  return JSON.parse(row.payload) as T;
}
export async function hydrateSenseHistory(app: ShardedHistory) {
  if (!app.historyRef || hydrated.has(app)) return;
  const histories = await readSenseRecord<StoredSenseHistory["histories"]>(app.historyRef, SENSE_HISTORY_LIMIT);
  if (!histories) throw new Error("Saved game history is unavailable; restart this scan after storage recovery.");
  app.histories = histories;
  hydrated.add(app);
}
/** Immutable blobs are committed before their manifest. An interrupted save leaves only an expiring orphan. */
export async function persistSenseHistory(app: ShardedHistory) {
  if (app.historyRef && !hydrated.has(app) && (app.historyRefExpiresAt ?? "") > new Date(Date.now() + 32 * 86400000).toISOString()) return;
  await hydrateSenseHistory(app);
  // Preserve coverage for legacy rows before removing inline observations.
  app.historyWindows ??= {};
  for (const country of Object.keys(app.histories) as SenseCountry[]) app.historyWindows[country] ??= historyWindows(app, country);
  const payload = boundedSenseJson(app.histories, SENSE_HISTORY_LIMIT);
  const ref = "sense:blob:v3:" + createHash("sha256").update(payload).digest("hex");
  const expiresAt = new Date(Date.now() + 93 * 86400000).toISOString();
  if (ref !== app.historyRef || (app.historyRefExpiresAt ?? "") <= new Date(Date.now() + 32 * 86400000).toISOString()) {
    await saveTechLaunchReadinessCache({cacheKey:ref,payload,createdAt:new Date().toISOString(),expiresAt});
    app.historyRefExpiresAt = expiresAt;
  }
  app.historyRef = ref;
  app.histories = {};
  hydrated.delete(app);
}
export function senseChartKey(jobKey: string, generatedAt: string, store: string, appId: string) {
  return "sense:chart:v3:" + createHash("sha256").update(JSON.stringify([jobKey,generatedAt,store,appId])).digest("hex");
}
