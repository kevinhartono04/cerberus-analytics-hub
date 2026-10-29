import { encodeHistory, pageSenseManifest, MANIFEST_PAGE_LIMIT, MANIFEST_TOTAL_LIMIT } from "./ludios-sense-codec.mjs";
import { createHash } from "node:crypto";
import { getTechLaunchReadinessCache, saveTechLaunchReadinessCache } from "@/lib/db";
import { type StoredSenseHistory } from "@/lib/ludios-sense-history";
import { cachedSensePage, rememberSensePage } from "@/lib/ludios-sense-transfer";

export const SENSE_RECORD_LIMIT = 4 * 1024 * 1024;
export const SENSE_HISTORY_LIMIT = 256 * 1024;
export type ShardedHistory = StoredSenseHistory & { historyRef?: string; historyRefExpiresAt?: string };
const hydrated = new WeakSet<ShardedHistory>();
type PageRange = { ref: string; first: string; last: string };
type PagedState = { apps: Record<string, unknown>; appPages?: string[]; appPageRanges?: PageRange[]; appPagesExpiresAt?: string };
const fullyLoadedStates = new WeakSet<object>();
const partialStates = new WeakMap<object, PageRange[]>();
export function boundedSenseJson(value: unknown, maxBytes = SENSE_RECORD_LIMIT) {
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload) > maxBytes) throw new Error("Saved scan exceeds the safe storage limit; offline migration is required before resuming.");
  return payload;
}
export async function readSenseDocument<T>(key: string, maxBytes = SENSE_RECORD_LIMIT): Promise<T | null> {
  const cached = cachedSensePage(key);
  if (cached !== undefined) {
    if (Buffer.byteLength(cached) > maxBytes) throw new Error("Saved scan exceeds the safe storage limit");
    return JSON.parse(cached) as T;
  }
  const row = await getTechLaunchReadinessCache(key, maxBytes);
  if (!row || (row.expiresAt && row.expiresAt <= new Date().toISOString())) return null;
  // Defense in depth for alternate adapters; SQL enforces this before transfer in production.
  if (Buffer.byteLength(row.payload) > maxBytes) throw new Error("Saved scan exceeds the safe storage limit; offline migration is required before resuming.");
  rememberSensePage(key, row.payload,row.expiresAt);
  return JSON.parse(row.payload) as T;
}

/** Select whole bounded pages containing a batch; retain untouched references for checkpoint writes. */
export async function hydrateSenseApps(state: PagedState, ids?: string[]) {
  if (!Array.isArray(state.appPages) || fullyLoadedStates.has(state)) return;
  const pending = partialStates.get(state) ?? state.appPageRanges;
  const indexed = pending && state.appPages.every(ref => state.appPageRanges?.some(range => range.ref === ref));
  const ranges = indexed ? pending : state.appPages.map(ref => ({ref,first:"",last:""}));
  const remaining: PageRange[] = [];
  for (const range of ranges) {
    if (ids && indexed && !ids.some(id => id >= range.first && id <= range.last)) { remaining.push(range); continue; }
    if (!/^sense:page:v4:[a-f0-9]{64}$/.test(range.ref)) throw new Error("Invalid scan metadata page");
    const page = await readSenseDocument<Record<string, unknown>>(range.ref, MANIFEST_PAGE_LIMIT);
    if (!page) throw new Error("Saved scan metadata is unavailable");
    Object.assign(state.apps, page);
  }
  if (remaining.length) partialStates.set(state, remaining);
  else { partialStates.delete(state); fullyLoadedStates.add(state); }
}

export async function readSenseRecord<T>(key: string, maxBytes = SENSE_RECORD_LIMIT, selectApps?: (document: T) => Partial<Record<"android" | "ios", string[]>> | undefined): Promise<T | null> {
  const document = await readSenseDocument<any>(key, maxBytes);
  if (document === null) return null;
  if(key.startsWith("sense:chart:v3:") && document?.format===4 && document.chartRef){
    if(!/^sense:chart-blob:v4:[a-f0-9]{64}$/.test(document.chartRef))throw new Error("Invalid saved chart reference");
    const chart=await readSenseRecord<T>(document.chartRef,SENSE_HISTORY_LIMIT);
    if(!chart)throw new Error("Saved game history is unavailable");
    return chart;
  }
  const states=document?.stores ?? document;
  const selection = selectApps?.(document);
  let total=0;
  for(const store of ["android","ios"]) {
    const state=states?.[store];
    if(!Array.isArray(state?.appPages)) continue;
    if(state.appPages.length>512) throw new Error("Scan metadata exceeds the bounded page budget");
    await hydrateSenseApps(state, selection ? selection[store as "android" | "ios"] ?? [] : undefined);
    total+=Buffer.byteLength(JSON.stringify(state.apps));
    if(total>MANIFEST_TOTAL_LIMIT) throw new Error("Scan metadata exceeds the bounded page budget");
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
  if(document===null || typeof document!=="object" || Array.isArray(document))return document;
  const source=document as {stores?:Record<string,PagedState>;android?:PagedState;ios?:PagedState};
  const input={...source, ...(source.stores ? {stores:{...source.stores}} : {})};
  // Keep each original page boundary when editing a sparse batch. Repacking disjoint
  // pages together would create overlapping lookup ranges and amplify later reads.
  for(const store of ["android","ios"] as const){
    const state=source.stores?.[store] ?? source[store];
    if(!state || !partialStates.has(state))continue;
    if(input.stores)input.stores[store]={...state,apps:{}};
    else input[store]={...state,apps:{}};
  }
  const expiry=new Date(Date.now()+93*86400000).toISOString();
  const emit=async(cacheKey:string,payload:string,expiresAt:string)=>{
    await saveTechLaunchReadinessCache({cacheKey,payload,createdAt:new Date().toISOString(),expiresAt});
  };
  const paged=await pageSenseManifest(input,emit,expiry);
  for(const store of ["android","ios"] as const){
    const original=source.stores?.[store] ?? source[store];
    const output=paged.stores?.[store] ?? paged[store];
    const untouched=original && partialStates.get(original);
    if(!original || !untouched?.length || !output)continue;
    const ranges=[...untouched];
    for(const range of original.appPageRanges ?? []){
      if(untouched.some(page=>page.ref===range.ref))continue;
      const apps=Object.fromEntries(Object.entries(original.apps).filter(([id])=>id>=range.first && id<=range.last));
      const updated=await pageSenseManifest({android:{...original,apps},ios:{apps:{}}},emit,expiry);
      ranges.push(...updated.android.appPageRanges ?? []);
    }
    ranges.sort((a,b)=>a.first < b.first ? -1 : a.first > b.first ? 1 : 0);
    if(ranges.length>512)throw new Error("Scan metadata exceeds the bounded page budget");
    output.appPageRanges=ranges;
    output.appPages=ranges.map(range=>range.ref);
    output.appPagesExpiresAt=original.appPagesExpiresAt;
  }
  return paged as T;
}

/** Timestamp identities point to immutable chart content shared across identical saved snapshots. */
export async function persistSenseChart(cacheKey:string,chart:unknown){
  const payload=boundedSenseJson(chart,SENSE_HISTORY_LIMIT);
  const chartRef="sense:chart-blob:v4:"+createHash("sha256").update(payload).digest("hex");
  const createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+93*86400000).toISOString();
  await saveTechLaunchReadinessCache({cacheKey:chartRef,payload,createdAt,expiresAt});
  await saveTechLaunchReadinessCache({cacheKey,payload:JSON.stringify({format:4,chartRef}),createdAt,expiresAt});
}
