import { encodeHistory, pageSenseManifest, MANIFEST_PAGE_LIMIT, MANIFEST_TOTAL_LIMIT } from "./ludios-sense-codec.mjs";
import { createHash } from "node:crypto";
import { getTechLaunchReadinessCache, saveTechLaunchReadinessCache } from "@/lib/db";
import { type StoredSenseHistory } from "@/lib/ludios-sense-history";

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
  const document=JSON.parse(row.payload);
  const states=document?.stores ?? document;
  let total=0;
  for(const store of ["android","ios"]) {
    const state=states?.[store];
    if(!Array.isArray(state?.appPages)) continue;
    if(state.appPages.length>512) throw new Error("Scan metadata exceeds the bounded page budget");
    for(const ref of state.appPages) {
      if(typeof ref!=="string" || !/^sense:page:v4:[a-f0-9]{64}$/.test(ref)) throw new Error("Invalid scan metadata page");
      const page=await readSenseRecord<Record<string,unknown>>(ref,MANIFEST_PAGE_LIMIT);
      if(!page) throw new Error("Saved scan metadata is unavailable");
      total+=Buffer.byteLength(JSON.stringify(page));
      if(total>MANIFEST_TOTAL_LIMIT) throw new Error("Scan metadata exceeds the bounded page budget");
      Object.assign(state.apps,page);
    }
  }
  if(Array.isArray(document?.result?.gamePages)) {
    if(document.result.gamePages.length>512)throw new Error("Scan metadata exceeds the bounded page budget");
    const games=[];
    for(const ref of document.result.gamePages){
      if(typeof ref!=="string" || !/^sense:games:v4:[a-f0-9]{64}$/.test(ref))throw new Error("Invalid saved report page");
      const page=await readSenseRecord<unknown[]>(ref,MANIFEST_PAGE_LIMIT);
      if(!Array.isArray(page))throw new Error("Saved report page is unavailable");
      total+=Buffer.byteLength(JSON.stringify(page));
      if(total>MANIFEST_TOTAL_LIMIT)throw new Error("Scan metadata exceeds the bounded page budget");
      games.push(...page);
    }
    document.result.games=games;
  }
  return document as T;
}
export async function hydrateSenseHistory(app: ShardedHistory) {
  if (!app.historyRef || hydrated.has(app)) return;
  const histories = await readSenseRecord<StoredSenseHistory["histories"] | (StoredSenseHistory & {format:4})>(app.historyRef, SENSE_HISTORY_LIMIT);
  if (!histories) throw new Error("Saved game history is unavailable; restart this scan after storage recovery.");
  if ("format" in histories && histories.format===4) {
    const full=histories as StoredSenseHistory & {format:4};
    app.histories=full.histories;app.historyWindows=full.historyWindows;app.countryHistory=full.countryHistory;
  } else app.histories=histories as StoredSenseHistory["histories"];
  hydrated.add(app);
}
/** Immutable blobs are committed before their manifest. An interrupted save leaves only an expiring orphan. */
export async function persistSenseHistory(app: ShardedHistory) {
  if (app.historyRef && !hydrated.has(app) && (app.historyRefExpiresAt ?? "") > new Date(Date.now() + 32 * 86400000).toISOString()) return;
  await hydrateSenseHistory(app);
  const encoded=encodeHistory(app);
  if(Buffer.byteLength(encoded.payload)>SENSE_HISTORY_LIMIT) throw new Error("Saved game history exceeds the safe storage limit");
  const payload=encoded.payload;
  const ref = "sense:blob:v4:" + createHash("sha256").update(payload).digest("hex");
  const expiresAt = new Date(Date.now() + 93 * 86400000).toISOString();
  if (ref !== app.historyRef || (app.historyRefExpiresAt ?? "") <= new Date(Date.now() + 32 * 86400000).toISOString()) {
    await saveTechLaunchReadinessCache({cacheKey:ref,payload,createdAt:new Date().toISOString(),expiresAt});
    app.historyRefExpiresAt = expiresAt;
  }
  app.historyRef = ref;
  app.histories = {};
  app.historyWindows=encoded.coverage; delete app.countryHistory;
  hydrated.delete(app);
}
export function senseChartKey(jobKey: string, generatedAt: string, store: string, appId: string) {
  return "sense:chart:v3:" + createHash("sha256").update(JSON.stringify([jobKey,generatedAt,store,appId])).digest("hex");
}

export async function prepareSenseManifest<T>(document:T):Promise<T> {
  return pageSenseManifest(document,async(cacheKey,payload,expiresAt)=>{
    await saveTechLaunchReadinessCache({cacheKey,payload,createdAt:new Date().toISOString(),expiresAt});
  },new Date(Date.now()+93*86400000).toISOString());
}
