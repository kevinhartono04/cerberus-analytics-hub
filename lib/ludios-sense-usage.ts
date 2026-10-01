import { getTechLaunchReadinessCache, saveTechLaunchReadinessCache } from "@/lib/db";
export type SenseUsage = { month: string; used: number; limit: number; remaining: number; trackingStartedAt: string; organizationUsed?: number; organizationLimit?: number; organizationObservedAt?: string };
const month = () => new Date().toISOString().slice(0,7);
const key = () => "sense:usage:" + month();
const allowance = () => { const v = Number(process.env.SENSE_MONTHLY_REQUEST_LIMIT ?? 1000); return Number.isSafeInteger(v) && v > 0 ? v : 1000; };
export async function getSenseUsage(): Promise<SenseUsage> {
  const stored = await getTechLaunchReadinessCache(key());
  const raw = stored ? JSON.parse(stored.payload) : {};
  const limit = allowance(), used = Number.isSafeInteger(raw.used) && raw.used >= 0 ? raw.used : 0;
  return { ...raw, month: month(), used, limit, remaining: Math.max(0, limit - used), trackingStartedAt: raw.trackingStartedAt ?? new Date().toISOString() };
}
async function save(usage: SenseUsage) {
  await saveTechLaunchReadinessCache({ cacheKey: key(), payload: JSON.stringify(usage), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000 * 62).toISOString() });
}
/** Called only while the scan holds the global upstream lease. Counts failed attempts too. */
export async function reserveSenseRequest() {
  const usage = await getSenseUsage();
  if (usage.organizationLimit !== undefined && usage.organizationUsed !== undefined && usage.organizationUsed >= usage.organizationLimit) throw new Error("Sensor Tower organization allowance reached; coverage is incomplete.");
  if (usage.remaining <= 0) throw new Error("Ludios Sense monthly call allowance reached; coverage is incomplete.");
  usage.used++; usage.remaining--;
  await save(usage);
}
export async function recordSenseOrganizationUsage(headers?: Record<string, string | undefined>) {
  const count = Number(headers?.["x-api-usage-count"]), limit = Number(headers?.["x-api-usage-limit"]);
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(limit) || limit <= 0) return;
  const usage = await getSenseUsage();
  usage.organizationUsed = count; usage.organizationLimit = limit; usage.organizationObservedAt = new Date().toISOString();
  await save(usage);
}
