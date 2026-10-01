import { randomUUID } from "node:crypto";
import { claimSenseLease, getTechLaunchReadinessCache, releaseSenseLease, saveTechLaunchReadinessCache } from "@/lib/db";
import { recordSenseOrganizationUsage, reserveSenseRequest } from "@/lib/ludios-sense-usage";
import { sensorTowerRequest } from "@/lib/sensortower-api";
import type { SenseCountry, SenseGame, SenseStore } from "@/lib/ludios-sense-types";

const ttl = 30 * 86400000;
const key = (store: SenseStore, id: string) => `sense:icon:${store}:${id}`;
export function safeSenseIconUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.searchParams.has("auth_token") ? url.href : null; } catch { return null; }
}

/** Only callers with a validated report selection may request these metadata batches. */
export async function getSenseIcons(games: SenseGame[], store: SenseStore, country: SenseCountry) {
  const icons: Record<string, string | null> = {};
  const unifiedIds: Record<string, string | null> = {};
  async function missing() {
    const ids: string[] = [];
    for (const game of games) {
      if (game.iconUrl !== undefined && game.unifiedAppId !== undefined) { icons[game.appId] = safeSenseIconUrl(game.iconUrl); unifiedIds[game.appId] = game.unifiedAppId; continue; }
      const cached = await getTechLaunchReadinessCache(key(store, game.appId));
      const metadata = cached ? JSON.parse(cached.payload) : null;
      if (cached?.expiresAt && cached.expiresAt > new Date().toISOString() && metadata.unifiedAppId !== undefined) { icons[game.appId] = safeSenseIconUrl(metadata.iconUrl); unifiedIds[game.appId] = metadata.unifiedAppId; }
      else ids.push(game.appId);
    }
    return ids;
  }
  let ids = await missing();
  if (!ids.length) return { icons, unifiedIds, requests: 0 };
  const token = process.env.SENSOR_TOWER_TOKEN;
  if (!token) throw new Response("Icon metadata unavailable", { status: 503 });
  const lease = randomUUID();
  if (!await claimSenseLease("sense:upstream:lease", lease, new Date(Date.now() + 60000).toISOString())) throw new Response("Icon metadata is waiting for the active request", { status: 503 });
  let requested = false;
  try {
    ids = await missing(); // Another page may have filled the cache before we acquired the lease.
    if (!ids.length) return { icons, unifiedIds, requests: 0 };
    await reserveSenseRequest();
    const url = new URL(`/v1/${store}/apps`, "https://api.sensortower.com");
    url.searchParams.set("app_ids", ids.join(",")); url.searchParams.set("country", country); url.searchParams.set("auth_token", token);
    requested = true;
    const response = await sensorTowerRequest(url);
    await recordSenseOrganizationUsage(response.usageHeaders);
    if (response.status !== 200) throw new Error("Icon metadata unavailable");
    const payload = JSON.parse(response.body.replaceAll(token, "[REDACTED]"));
    if (!Array.isArray(payload.apps)) throw new Error("Unexpected icon metadata response");
    const received = new Map(payload.apps.map((app: Record<string, unknown>) => [String(app.app_id), { iconUrl: safeSenseIconUrl(app.icon_url), unifiedAppId: typeof app.unified_app_id === "string" && app.unified_app_id.trim() ? app.unified_app_id.trim() : null }]));
    for (const id of ids) {
      const metadata = received.get(id) as {iconUrl:string|null;unifiedAppId:string|null} | undefined;
      icons[id] = metadata?.iconUrl ?? null;
      unifiedIds[id] = metadata?.unifiedAppId ?? null;
      await saveTechLaunchReadinessCache({ cacheKey: key(store,id), payload: JSON.stringify({ iconUrl: icons[id], unifiedAppId: unifiedIds[id] }), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ttl).toISOString() });
    }
    return { icons, unifiedIds, requests: 1 };
  } finally { await releaseSenseLease("sense:upstream:lease", lease, requested ? 1000 : 0); }
}
