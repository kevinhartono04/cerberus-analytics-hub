import { historyWindows, mergeCountryHistory, mergeHistoryWindows, requiredHistoryWeeks, type StoredSenseHistory } from "@/lib/ludios-sense-history";
import { safeSenseIconUrl } from "@/lib/ludios-sense-icons";
import { createHash, randomUUID } from "node:crypto";
import { getSenseUsage, reserveSenseRequest, recordSenseOrganizationUsage } from "@/lib/ludios-sense-usage";
import { sensorTowerRequest } from "@/lib/sensortower-api";
import { claimSenseLease, getSenseDetectionReports, getTechLaunchReadinessCache, listPendingSenseJobs, releaseSenseLease, saveTechLaunchReadinessCache } from "@/lib/db";
import { aggregateSenseHistory, classifySense, evaluateSense, senseRuleVersion, shiftDate, validDownloads } from "@/lib/ludios-sense-detection";
import { senseCountryCodes, senseToday } from "@/lib/ludios-sense-types";
import { buildSenseWatchlist } from "@/lib/ludios-sense-watchlist";
import type { SenseCountry, SenseFilters, SenseGame, SenseResult, SenseRunResponse, SenseStore } from "@/lib/ludios-sense-types";

type App = StoredSenseHistory & { appId: string; name: string; publisher: string; iconUrl?: string | null; unifiedAppId?: string | null; categories: string[]; releaseDate: string | null; metadataAt?: string; discoveredDate: string; histories: Partial<Record<SenseCountry, Record<string, number | null>>>; countryHistory?: Partial<Record<SenseCountry, { start: string; end: string; at: string }>>; backfilled?: boolean; historyStart?: string; historyEnd?: string; historyAt?: string };
type StoreState = { apps: Record<string, App>; ids: string[]; historyIds: string[]; watermark?: string; rankingDate: string; datesFound: number; daysChecked: number; offset: number; lastDownloads: number; metadataIndex: number; historyIndex: number; week: number; historyBatchSize?: number; historyWeeks?: number[]; candidateIds?: string[]; phase: "discovery" | "metadata" | "history" | "done" };
type Job = { jobKey: string; filters: SenseFilters; status: SenseRunResponse["status"]; createdAt: string; updatedAt: string; requests: number; progress: string; stores: Record<SenseStore, StoreState>; store: SenseStore; result?: SenseResult; error?: string; retry: number; retryAt?: string; subsetReuseChecked?: boolean; receipts: Array<{ endpoint: string; parameters: Record<string, string | number>; retrievedAt: string }> };
const stores: SenseStore[] = ["android", "ios"];
const now = () => new Date().toISOString();
const trace = (event: string, fields: Record<string, string | number | boolean>) => console.info("[ludios-sense]", JSON.stringify({ event, ...fields }));
const cacheKey = (filters: SenseFilters) => "sense:v1:" + createHash("sha256").update(JSON.stringify({date:filters.date,countries:[...new Set(filters.countries)].sort()})).digest("hex");
const sharedHistoryKey = "sense:history:shared:v2";
const historyKey = (filters: SenseFilters) => "sense:history:" + filters.countries.join(",");
const aliveUntil = () => new Date(Date.now() + 86400000 * 31).toISOString();
async function save(key: string, value: unknown) { await saveTechLaunchReadinessCache({ cacheKey: key, payload: JSON.stringify(value), createdAt: now(), expiresAt: aliveUntil() }); }
async function load<T>(key: string): Promise<T | null> { const record = await getTechLaunchReadinessCache(key); return record && (!record.expiresAt || record.expiresAt > now()) ? JSON.parse(record.payload) as T : null; }
function needsBackfill(app: App, countries: SenseCountry[], t: string) {
  return countries.some(country => {
    const coverage = app.countryHistory?.[country] ?? (app.countryHistory === undefined && app.backfilled && app.histories[country] !== undefined && app.historyStart && app.historyEnd ? { start: app.historyStart, end: app.historyEnd } : null);
    return !coverage || coverage.start > shiftDate(t,-27) || coverage.end < shiftDate(t,-7);
  });
}

/** Merge per-country cache coverage; an older or narrower scan never removes another country's history. */
function mergeHistories(first: Record<SenseStore, StoreState> | null, second: Record<SenseStore, StoreState> | null, countries: SenseCountry[]): Record<SenseStore, StoreState> | null {
  if (!first && !second) return null;
  const combined = {} as Record<SenseStore, StoreState>;
  for (const store of stores) {
    const left = first?.[store], right = second?.[store];
    if (!left && !right) continue;
    const template = (right?.watermark ?? "") >= (left?.watermark ?? "") ? right ?? left! : left!;
    const apps: Record<string, App> = {};
    for (const source of [left, right]) for (const [id, original] of Object.entries(source?.apps ?? {})) {
      const incoming = structuredClone(original);
      const legacy = incoming.countryHistory === undefined;
      incoming.countryHistory ??= {};
      if (legacy && incoming.backfilled && incoming.historyStart && incoming.historyEnd) for (const country of countries) {
        if (incoming.histories[country] !== undefined && !incoming.countryHistory[country]) incoming.countryHistory[country] = { start: incoming.historyStart, end: incoming.historyEnd, at: incoming.historyAt ?? "" };
      }
      const current = apps[id];
      if (!current) { apps[id] = incoming; continue; }
      const metadata = (incoming.metadataAt ?? "") > (current.metadataAt ?? "") ? incoming : current;
      const histories = { ...current.histories }, windows = { ...current.historyWindows };
      for (const country of new Set([...Object.keys(current.histories),...Object.keys(incoming.histories)]) as Set<SenseCountry>) {
        const merged = mergeCountryHistory(current,incoming,country);
        histories[country] = merged.histories; windows[country] = merged.windows;
      }
      apps[id] = { ...metadata, discoveredDate: current.discoveredDate > incoming.discoveredDate ? current.discoveredDate : incoming.discoveredDate, histories, historyWindows:windows };

    }
    combined[store] = { ...template, apps };
  }
  return combined;
}

async function warmHistory(filters: SenseFilters) {
  const basket = await load<Record<SenseStore, StoreState>>(historyKey(filters));
  const shared = await load<Record<SenseStore, StoreState>>(sharedHistoryKey) ?? (filters.countries.length === 7 ? basket : await load<Record<SenseStore, StoreState>>("sense:history:AU,CA,DE,GB,JP,RU,US"));
  return mergeHistories(shared, basket, filters.countries);
}

/** A country subset uses the original saved observations and reporting dates, not revised warm history. */
function subsetJob(source: Job, filters: SenseFilters): Job | null {
  if (source.status !== "completed" || !source.result || source.result.ruleVersion !== senseRuleVersion ||
    source.filters.date !== filters.date || !filters.countries.every(country => source.filters.countries.includes(country))) return null;
  const games: SenseGame[] = [];
  const listingCountry = filters.countries.includes("US") ? "US" : filters.countries[0];
  for (const game of source.result.games) {
    const app = source.stores[game.store]?.apps[game.appId], t = game.evaluation.date;
    // Queried missing observations are reusable; a country that was never queried is not.
    if (!app || !t || requiredHistoryWeeks(app,filters.countries,t,false).length) return null;
    const aggregate = aggregateSenseHistory(app.histories,filters.countries,t);
    const evaluation = evaluateSense(aggregate.history,t,game.releaseDate);
    if (game.store === "android") evaluation.flags.push("latest_android_provisional");
    if (aggregate.unavailableCountries.length) evaluation.flags.push("some_countries_unavailable");
    games.push({...game,...aggregate,evaluation,iconUrl:game.iconUrl ?? app.iconUrl ?? null,unifiedAppId:game.unifiedAppId ?? app.unifiedAppId ?? null,
      url:game.store === "ios" ? `https://apps.apple.com/${listingCountry.toLowerCase()}/app/id${game.appId}` : `https://play.google.com/store/apps/details?id=${encodeURIComponent(game.appId)}&gl=${listingCountry}`});
  }
  sortResultGames(games);
  const timestamp = now();
  return {...source,jobKey:cacheKey(filters),filters,status:"completed",createdAt:timestamp,updatedAt:timestamp,requests:0,retry:0,retryAt:undefined,receipts:[],subsetReuseChecked:true,
    progress:"Recalculated from saved country data. No new Sensor Tower calls.",
    result:{...source.result,filters,generatedAt:timestamp,games,requests:0,reusedFrom:source.result.reusedFrom ?? {jobKey:source.jobKey,countries:source.filters.countries,generatedAt:source.result.generatedAt}}};
}

async function findSubsetJob(filters: SenseFilters): Promise<Job | null> {
  const extras = senseCountryCodes.filter(country => !filters.countries.includes(country));
  if (!extras.length) return null;
  const baskets = Array.from({length:(1 << extras.length)-1},(_,index) => {
    const mask=index+1;
    return [...filters.countries,...extras.filter((_,bit) => mask & (1 << bit))].sort() as SenseCountry[];
  });
  const full = baskets.find(countries => countries.length === senseCountryCodes.length)!;
  // The shared daily report is the usual source. Avoid reading every basket when it suffices.
  const firstKey=cacheKey({...filters,countries:full});
  const firstSummary=await load<SenseRunResponse>(firstKey+":summary");
  let partial: Job | null = null;
  async function candidate(key: string, summary: SenseRunResponse | null) {
    if (summary?.status !== "completed" || summary.result?.ruleVersion !== senseRuleVersion) return null;
    const source=await load<Job>(key);
    return source ? subsetJob(source,filters) : null;
  }
  const first=await candidate(firstKey,firstSummary);
  if (first?.result?.coverageComplete) return first;
  partial=first;
  const remaining=baskets.filter(countries=>countries.length!==full.length).sort((a,b)=>a.length-b.length || a.join().localeCompare(b.join()));
  const summaries=await Promise.all(remaining.map(countries=>load<SenseRunResponse>(cacheKey({...filters,countries})+":summary")));
  for (let index=0;index<remaining.length;index++) {
    const derived=await candidate(cacheKey({...filters,countries:remaining[index]}),summaries[index]);
    if (derived?.result?.coverageComplete) return derived;
    partial ??= derived;
  }
  return partial;
}

async function saveSubsetJob(job: Job) {
  // Retain the audit of calls already attempted by an older in-progress job; derivation adds none.
  const [previous,summary] = await Promise.all([load<Job>(job.jobKey),load<SenseRunResponse>(job.jobKey+":summary")]);
  job.requests=Math.max(job.requests,previous?.requests ?? 0,summary?.requests ?? 0);
  job.result!.requests=job.requests;
  job.receipts=previous?.receipts ?? [];
  await save("sense:result:"+job.jobKey+":"+job.result!.generatedAt,{result:job.result,receipts:job.receipts});
  await saveJob(job);
  await save(job.jobKey+":paused",false);
  trace("subset_report_reused",{scan:job.jobKey.slice(-8),source:job.result!.reusedFrom!.jobKey.slice(-8),countries:job.filters.countries.join(","),games:job.result!.games.length});
}

export async function estimateSense(filters: SenseFilters) {
  const usage = await getSenseUsage();
  const cached = await getCachedSense(filters);
  if (cached?.status === "completed") return {usage,knownGames:cached.result?.games.length ?? 0,knownHistoryCalls:0,knownMetadataCalls:0,cachedReport:true,note:"Saved report ready. No new Sensor Tower calls needed for this selection."};
  const previous = await warmHistory(filters);
  const today = now().slice(0,10), t = filters.date < today ? filters.date : shiftDate(today,-1);
  let historyCalls = 0, metadataCalls = 0, knownGames = 0;
  for (const store of stores) {
    const apps = Object.values(previous?.[store]?.apps ?? {}).filter(app => app.discoveredDate <= t && app.discoveredDate >= shiftDate(t,-30));
    metadataCalls += Math.ceil(apps.filter(a => !a.metadataAt || Date.now() - Date.parse(a.metadataAt) >= 30 * 86400000).length / 100);
    const games = apps.filter(a => classifySense(a.appId,store,a.categories).classification !== "excluded");
    knownGames += games.length;
    const plans = new Map<string,{weeks:number;count:number}>();
    for(const game of games) {
      const weeks=requiredHistoryWeeks(game,filters.countries,t,t>=shiftDate(today,-7));
      const key=weeks.join(","),plan=plans.get(key) ?? {weeks:weeks.length,count:0};
      plan.count++; plans.set(key,plan);
    }
    historyCalls += [...plans.values()].reduce((sum,plan)=>sum+Math.ceil(plan.count/100)*plan.weeks,0);
  }
  return { usage, knownGames, knownHistoryCalls: historyCalls, knownMetadataCalls: metadataCalls, cachedReport:false, note: "Estimate covers saved candidates. Discovery pages, new games and retries add calls. A first scan has no reliable estimate yet." };
}

function response(job: Job, cached = false): SenseRunResponse {
  // Keep large scans below the hosting response limit; charts load on selection.
  const result = job.result ? { ...job.result, games: job.result.games.map(g => ({ ...g, history: [], historyLoaded: false })) } : undefined;
  return { jobKey: job.jobKey, status: job.status, requests: job.requests, progress: job.progress, result, error: job.error, cached };
}

async function saveJob(job: Job) {
  await save(job.jobKey, job);
  await save(job.jobKey + ":summary", response(job));
}

export async function getSenseStatus(key: string): Promise<SenseRunResponse> {
  if (!/^sense:v1:[a-f0-9]{64}$/.test(key)) throw new Response("Invalid scan ID", { status: 400 });
  const summary = await load<SenseRunResponse>(key + ":summary");
  const job = summary ? null : await load<Job>(key);
  if (!summary && !job) throw new Response("Scan not found", { status: 404 });
  return { ...(summary ?? response(job!)), paused: Boolean(await load<boolean>(key + ":paused")) };
}

export async function getSenseGame(key: string, appId: string, store: SenseStore, generatedAt?: string): Promise<SenseGame> {
  if (!/^sense:v1:[a-f0-9]{64}$/.test(key)) throw new Response("Invalid scan ID", { status: 400 });
  const snapshot = generatedAt ? await load<{ result: SenseResult }>("sense:result:" + key + ":" + generatedAt) : null;
  const job = snapshot ? null : await load<Job>(key);
  const result = snapshot?.result ?? job?.result;
  if (generatedAt && result?.generatedAt !== generatedAt) throw new Response("This saved report is unavailable. Run check to refresh it.", { status: 409 });
  const game = result?.games.find(g => g.appId === appId && g.store === store);
  if (!game) throw new Response("Game report not found", { status: 404 });
  return { ...game, historyLoaded: true };
}

export async function getSenseWatchlist(key: string) {
  const current = await getSenseStatus(key);
  if (!current.result) return [];
  const filters = current.result.filters;
  const previous = await getSenseDetectionReports(Array.from({ length: 7 }, (_, i) =>
    cacheKey({ ...filters, date: shiftDate(filters.date, -i - 1) }) + ":summary"));
  return buildSenseWatchlist(current, previous.filter(record => !record.expiresAt || record.expiresAt > now())
    .map(record => JSON.parse(record.payload) as SenseRunResponse));
}

export async function setSensePaused(key: string, paused: boolean): Promise<SenseRunResponse> {
  await getSenseStatus(key);
  await save(key + ":paused", paused);
  return getSenseStatus(key);
}

/** Server work is bounded per invocation; durable jobs resume via the worker cron. */
export async function runSenseWorker(key: string, budgetMs = 240000) {
  const token = randomUUID(), workerKey = "sense:worker:" + key;
  if (!await claimSenseLease(workerKey, token, new Date(Date.now() + budgetMs + 60000).toISOString())) { trace("worker_busy", { scan: key.slice(-8) }); return; }
  trace("worker_started", { scan: key.slice(-8), budgetMs });
  const deadline = Date.now() + budgetMs;
  try {
    while (Date.now() < deadline - 45000) {
      const next = await advanceSense(key);
      if (next.status !== "running" || next.paused) return;
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
  } finally { await releaseSenseLease(workerKey, token); trace("worker_stopped", { scan: key.slice(-8) }); }
}

export async function continuePendingSenseJobs() {
  const pending = await listPendingSenseJobs();
  const states = await Promise.all(pending.map(key => getSenseStatus(key)));
  const keys = states.filter(s => s.status === "running" && !s.paused).slice(0,4).map(s => s.jobKey);
  for (const key of keys) await runSenseWorker(key, Math.floor(240000 / Math.max(1, keys.length)));
  return keys.length;
}

export async function startSense(filters: SenseFilters): Promise<SenseRunResponse> {
  const key = cacheKey(filters), token = randomUUID();
  await save(key + ":paused", false);
  if (!await claimSenseLease(key + ":lease", token, new Date(Date.now() + 60000).toISOString())) {
    const pending = await load<Job>(key);
    if (pending) return response(pending);
    throw new Response(JSON.stringify({ error: "A scan is starting. Try again in a moment." }), { status: 409, headers: { "Content-Type": "application/json" } });
  }
  try {
    const existing = await load<Job>(key);
    if (existing?.status === "completed" && existing.result?.ruleVersion === senseRuleVersion) return response(existing,true);
    const subset = await findSubsetJob(filters);
    if (subset) { await saveSubsetJob(subset); return response(subset,true); }
    if (existing?.status === "running") return response(existing);
    if (!process.env.SENSOR_TOWER_TOKEN?.trim()) throw new Error("Sensor Tower is not configured on this server. Set SENSOR_TOWER_TOKEN in the server environment.");
    const previous = await warmHistory(filters);
    const today = now().slice(0,10);
    const latest = filters.date < today ? filters.date : shiftDate(today, -1);
    const states = Object.fromEntries(stores.map(store => {
      const apps: Record<string, App> = {};
      for (const [id, app] of Object.entries(previous?.[store]?.apps ?? {})) {
        // Do not reuse future observations when the user selects an older t.
        apps[id] = structuredClone(app); // Cache only; candidateIds below controls which games are evaluated.
      }
      return [store, { apps, candidateIds: Object.keys(apps).filter(id => apps[id].discoveredDate <= latest && apps[id].discoveredDate >= shiftDate(latest,-30)), ids: [], historyIds: [], rankingDate: latest, datesFound: 0, daysChecked: 0, offset: 0, lastDownloads: Number.MAX_VALUE, metadataIndex: 0, historyIndex: 0, week: 0, phase: "discovery" }];
    })) as unknown as Record<SenseStore, StoreState>;
    const job: Job = { jobKey: key, filters, status: "running", createdAt: now(), updatedAt: now(), requests: 0, progress: "Discovering Android games across the selected countries…", stores: states, store: "android", retry: 0, receipts: [], subsetReuseChecked:true };
    await saveJob(job);
    return response(job);
  } finally { await releaseSenseLease(key + ":lease", token); }
}

/** Cache-only: may save a recalculated subset, but never starts upstream work. */
export async function getCachedSense(filters: SenseFilters): Promise<SenseRunResponse | null> {
  const key=cacheKey(filters);
  const summary=await load<SenseRunResponse>(key+":summary");
  if (summary?.status === "completed" && summary.result?.ruleVersion === senseRuleVersion) return {...await getSenseStatus(key),cached:true};
  const subset=await findSubsetJob(filters);
  if (subset) {
    const token=randomUUID();
    if (await claimSenseLease(key+":lease",token,new Date(Date.now()+60000).toISOString())) {
      try {
        // An in-flight step may have completed while the source report was being read.
        const current=await load<SenseRunResponse>(key+":summary");
        if (current?.status === "completed" && current.result?.ruleVersion === senseRuleVersion) return {...await getSenseStatus(key),cached:true};
        await saveSubsetJob(subset);
        return response(subset,true);
      } finally { await releaseSenseLease(key+":lease",token); }
    }
  }
  return summary ? {...await getSenseStatus(key),cached:summary.status==="completed"} : null;
}
export async function startDailySense() {
  const filters:SenseFilters={date:senseToday(),countries:["AU","CA","DE","GB","JP","RU","US"]};
  const existing=await getCachedSense(filters);
  return existing && existing.status!=="error" ? existing : startSense(filters);
}

/** One upstream request per step. State and leases survive serverless restarts. */
export async function advanceSense(key: string): Promise<SenseRunResponse> {
  if (!/^sense:v1:[a-f0-9]{64}$/.test(key)) throw new Response("Invalid scan ID", { status: 400 });
  const initial = await getSenseStatus(key);
  if (initial.paused || initial.status !== "running") return initial;
  const lease = randomUUID();
  if (!await claimSenseLease(key + ":lease", lease, new Date(Date.now() + 60000).toISOString())) return initial;
  let requestLease = false;
  try {
    const job = await load<Job>(key);
    if (!job) return initial;
    if (job.status !== "running") return response(job);
    // Existing runs started before subset reuse was available can stop before their next request.
    if (!job.subsetReuseChecked) {
      const subset=await findSubsetJob(job.filters);
      if (subset) { await saveSubsetJob(subset); return response(subset,true); }
      job.subsetReuseChecked=true;
    }
    // The compact summary journals attempted requests without rewriting all histories.
    job.requests = Math.max(job.requests, initial.requests);
    if (job.retryAt && job.retryAt > now()) return response(job);
    const started = Date.now();
    requestLease = await claimSenseLease("sense:upstream:lease", lease, new Date(Date.now() + 60000).toISOString());
    if (!requestLease) return response(job);
    try {
      await step(job);
      job.retry = 0; delete job.retryAt;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sensor Tower request failed";
      job.retry++;
      if (message.includes("allowance") || message.includes("budget")) { job.error = message; await finish(job, false); }
      else if (job.retry >= 3 || message.includes("budget") || message.includes("access") || message.includes("configured") || message.includes("Unexpected") || message.includes("duplicate")) { job.status = "error"; job.error = message; }
      else { job.retryAt = new Date(Date.now() + Math.min(60000, 10000 * 2 ** job.retry)).toISOString(); job.progress = `${message}. Retrying shortly (${job.retry}/3)…`; }
    }
    job.updatedAt = now();
    const owner = await getTechLaunchReadinessCache(key + ":lease");
    if (owner?.payload !== lease) return getSenseStatus(key);
    await saveJob(job);
    trace("step_completed", { scan: key.slice(-8), store: job.store, phase: job.stores[job.store].phase, requests: job.requests, elapsedMs: Date.now() - started, historyCompleted: job.stores[job.store].historyIndex });
    return response(job);
  } finally {
    if (requestLease) await releaseSenseLease("sense:upstream:lease", lease, 1000);
    await releaseSenseLease(key + ":lease", lease);
  }
}

async function sensor(job: Job, endpoint: string, parameters: Record<string, string | number>) {
  const rankingKey = endpoint === "/v1/facets/metrics" ? "sense:ranking:" + createHash("sha256").update(JSON.stringify(parameters)).digest("hex") : null;
  if (rankingKey) { const cached = await load<{ retrievedAt: string; payload: unknown }>(rankingKey); if (cached && Date.now() - Date.parse(cached.retrievedAt) < 7 * 86400000) return cached.payload; }
  if (job.requests >= 1000) throw new Error("Sensor Tower request budget reached; discovery is incomplete. Choose fewer countries or retry later.");
  await reserveSenseRequest();
  job.requests++;
  await save(job.jobKey + ":summary", response(job)); // Durable attempt count; full history is checkpointed once after the response.
  const token = process.env.SENSOR_TOWER_TOKEN?.trim();
  if (!token) throw new Error("Sensor Tower is not configured on this server");
  const url = new URL(endpoint, "https://api.sensortower.com");
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  url.searchParams.set("auth_token", token);
  const started = Date.now();
  const res = await sensorTowerRequest(url);
  await recordSenseOrganizationUsage(res.usageHeaders);
  trace("sensor_response", { scan: job.jobKey.slice(-8), endpoint, status: res.status, elapsedMs: Date.now() - started, apps: String(parameters.app_ids ?? "").split(",").filter(Boolean).length });
  if (res.status < 200 || res.status >= 300) throw new Error(res.status === 401 || res.status === 403 ? "Sensor Tower token or product access is unavailable" : `Sensor Tower returned HTTP ${res.status}`);
  let payload: unknown;
  try { payload = JSON.parse(res.body.replaceAll(token, "[REDACTED]")); } catch { throw new Error("Unexpected Sensor Tower JSON response"); }
  job.receipts.push({ endpoint, parameters, retrievedAt: now() });
  if (rankingKey && Array.isArray((payload as { data?: unknown[] })?.data) && (payload as { data: unknown[] }).data.length) await save(rankingKey, { retrievedAt: now(), payload });
  return payload;
}

async function step(job: Job) {
  const store = job.store, s = job.stores[store], countryList = job.filters.countries.join(",");
  if (s.phase === "discovery") {
    const p = await sensor(job, "/v1/facets/metrics", { bundle: "mobile_store_top_apps", order_by: "est_mobile_downloads:desc", breakdown: "app_id", start_date: s.rankingDate, end_date: s.rankingDate, regions: countryList, devices: store === "ios" ? "iphone,ipad" : "android", entities: "app_id:name", limit: 2000, offset: s.offset }) as { data: Array<{ app_id: string | number; est_mobile_downloads: number }>; entities?: { app_id?: Record<string, { name?: string }> }; meta?: { total_count?: number } };
    if (!Array.isArray(p?.data)) throw new Error("Unexpected Sensor Tower ranking response");
    const seen = new Set<string>();
    for (const row of p.data) {
      const id = String(row.app_id);
      if (!id || !validDownloads(row.est_mobile_downloads) || row.est_mobile_downloads > s.lastDownloads || seen.has(id)) throw new Error("Unexpected ranking order or duplicate app");
      seen.add(id); s.lastDownloads = row.est_mobile_downloads;
      if (row.est_mobile_downloads < 1000) continue;
      s.apps[id] ??= { appId: id, name: p.entities?.app_id?.[id]?.name ?? id, publisher: "", categories: [], releaseDate: null, discoveredDate: s.rankingDate, histories: {} };
      if (s.candidateIds && !s.candidateIds.includes(id)) s.candidateIds.push(id);
      if (s.rankingDate > s.apps[id].discoveredDate) s.apps[id].discoveredDate = s.rankingDate;
    }
    if (p.data.length && !s.watermark) s.watermark = s.rankingDate;
    s.offset += p.data.length;
    const done = !p.data.length || s.lastDownloads < 1000 || s.offset >= (p.meta?.total_count ?? Infinity);
    if (done) {
      if (s.offset > 0) s.datesFound++;
      s.daysChecked++; s.offset = 0; s.lastDownloads = Number.MAX_VALUE;
      s.rankingDate = shiftDate(s.rankingDate, -1);
      if (s.datesFound >= 3 || s.daysChecked >= 7) {
        if (!s.watermark || s.datesFound < 3) throw new Error(`Discovery incomplete for ${store}: three reporting days are not available`);
        s.ids = (s.candidateIds ?? Object.keys(s.apps)).sort(); s.phase = "metadata";
      }
    }
    job.progress = `${store === "ios" ? "iOS" : "Android"}: discovered ${Object.keys(s.apps).length.toLocaleString()} apps above the combined floor; ${s.datesFound}/3 reporting dates checked.`;
  } else if (s.phase === "metadata") {
    const remaining = s.ids.filter(id => !s.apps[id].metadataAt || Date.now() - Date.parse(s.apps[id].metadataAt!) >= 30 * 86400000);
    const batch = remaining.slice(0,100);
    if (batch.length) {
      const p = await sensor(job, `/v1/${store}/apps`, { app_ids: batch.join(","), country: job.filters.countries.includes("US") ? "US" : job.filters.countries[0] }) as { apps: Array<Record<string, unknown>> };
      if (!Array.isArray(p?.apps)) throw new Error("Unexpected Sensor Tower app details response");
      for (const raw of p.apps) {
        const app = s.apps[String(raw.app_id)];
        if (!app || !batch.includes(app.appId)) throw new Error("Unexpected app in metadata response");
        app.name = String(raw.name ?? app.name); app.publisher = String(raw.publisher_name ?? "");
        app.iconUrl = safeSenseIconUrl(raw.icon_url);
        app.unifiedAppId = typeof raw.unified_app_id === "string" && raw.unified_app_id.trim() ? raw.unified_app_id.trim() : null;
        app.categories = Array.isArray(raw.categories) ? raw.categories.map(String) : [];
        app.releaseDate = typeof raw.release_date === "string" ? raw.release_date.slice(0,10) : null;
      }
      // Missing metadata stays reviewable and does not cause an endless loop.
      batch.forEach(id => { s.apps[id].metadataAt = now(); });
      job.progress = `${store === "ios" ? "iOS" : "Android"}: loading app details (${s.ids.length - remaining.length + batch.length}/${s.ids.length}).`;
    } else {
      s.historyIds = s.ids.filter(id => classifySense(id, store, s.apps[id].categories).classification !== "excluded");
      // Group identical interval plans so one missing week never forces a full batch to backfill.
      const plans=new Map(s.historyIds.map(id=>[id,requiredHistoryWeeks(s.apps[id],job.filters.countries,s.watermark!,s.watermark!>=shiftDate(now().slice(0,10),-7))]));
      s.historyIds.sort((a,b)=>plans.get(a)!.length-plans.get(b)!.length || plans.get(a)!.join(",").localeCompare(plans.get(b)!.join(",")) || a.localeCompare(b));
      s.phase = "history";
    }
  } else if (s.phase === "history") {
    const refreshRecent = s.watermark! >= shiftDate(now().slice(0,10),-7);
    if (s.week === 0) {
      const remaining = s.historyIds.slice(s.historyIndex);
      const plan = remaining.length ? requiredHistoryWeeks(s.apps[remaining[0]],job.filters.countries,s.watermark!,refreshRecent) : [];
      const signature=plan.join(",");
      const boundary=remaining.findIndex(id=>requiredHistoryWeeks(s.apps[id],job.filters.countries,s.watermark!,refreshRecent).join(",")!==signature);
      s.historyBatchSize=Math.min(100,boundary<0?remaining.length:boundary);
      s.historyWeeks=plan;
    }
    const batch = s.historyIds.slice(s.historyIndex,s.historyIndex+(s.historyBatchSize ?? 25));
    if (!batch.length) {
      s.phase = "done";
      if (store === "android") { job.store = "ios"; job.progress = "Discovering iOS games across the selected countries…"; }
      else await finish(job);
      return;
    }
    // Finish already-running legacy batches before adopting the interval plan.
    const weeks=s.historyWeeks ?? (batch.every(id=>!needsBackfill(s.apps[id],job.filters.countries,s.watermark!))?[0]:[0,1,2,3]);
    if (!weeks.length) { s.historyIndex+=batch.length; s.week=0; job.progress=`${store}: reused saved download history (${s.historyIndex}/${s.historyIds.length} games).`; return; }
    const length=weeks.length*7;
    const end=shiftDate(s.watermark!,-weeks[s.week]*7),start=shiftDate(end,-6);
    const p = await sensor(job, `/v1/${store}/sales_report_estimates`, { app_ids: batch.join(","), countries: countryList, date_granularity: "daily", start_date: start, end_date: end });
    if (!Array.isArray(p)) throw new Error("Unexpected Sensor Tower history response");
    const normalized = new Map<string, number | null>();
    for (const raw of p) {
      const country = raw[store === "ios" ? "cc" : "c"] as SenseCountry, id = String(raw.aid), date = typeof raw.d === "string" ? raw.d.slice(0,10) : "";
      if (!batch.includes(id) || !job.filters.countries.includes(country) || date < start || date > end) throw new Error("Unexpected app, country or date in history response");
      const parts = store === "ios" ? [raw.iu, raw.au] : [raw.u];
      const value = parts.every(validDownloads) ? parts.reduce((a: number, b: number) => a + b, 0) : null;
      const key = `${id}:${country}:${date}`;
      if (normalized.has(key) && normalized.get(key) !== value) throw new Error("Conflicting duplicate download observation");
      normalized.set(key, value);
    }
    for (const id of batch) {
      const app = s.apps[id];
      for (const country of job.filters.countries) {
        app.histories[country] ??= {};
        for (let i = 0; i < 7; i++) {
          const d = shiftDate(start, i), value = normalized.get(`${id}:${country}:${d}`);
          if (validDownloads(value)) app.histories[country]![d] = value;
          else delete app.histories[country]![d]; // Omitted observations remain missing, including revisions.
        }
        app.historyWindows ??= {};
        app.historyWindows[country] = mergeHistoryWindows([...historyWindows(app,country),{start,end,at:now()}]);
      }
      app.historyAt = now();
    }
    s.week++;
    if (s.week * 7 >= length) { batch.forEach(id => { s.apps[id].backfilled = true; s.apps[id].historyStart = shiftDate(s.watermark!, -27); s.apps[id].historyEnd = s.watermark; }); s.historyIndex += batch.length; s.week = 0; }
    job.progress = `${store === "ios" ? "iOS" : "Android"}: loading ${length}-day download history (${s.historyIndex}/${s.historyIds.length} games complete${s.week ? `; current batch week ${s.week}/${length / 7}` : ""}), all selected countries together.`;
  }
}

function sortResultGames(games: SenseGame[]) {
  const ranks = { confirmed_momentum: 0, early_warning: 1, launch_traction: 2, none: 3, insufficient_data: 4 };
  games.sort((a,b) => ranks[a.evaluation.signal] - ranks[b.evaluation.signal] || (b.evaluation.added ?? 0) - (a.evaluation.added ?? 0) || (b.evaluation.growth ?? 0) - (a.evaluation.growth ?? 0) || a.appId.localeCompare(b.appId));
}

async function finish(job: Job, complete = true) {
  const listingCountry = job.filters.countries.includes("US") ? "US" : job.filters.countries[0];
  const games: SenseGame[] = [];
  for (const store of stores) {
    const s = job.stores[store];
    for (const id of complete ? s.historyIds : s.historyIds.slice(0,s.historyIndex)) {
      const app = s.apps[id], t = s.watermark!;
      const aggregate = aggregateSenseHistory(app.histories, job.filters.countries, t);
      const evaluation = evaluateSense(aggregate.history, t, app.releaseDate);
      if (store === "android") evaluation.flags.push("latest_android_provisional");
      if (aggregate.unavailableCountries.length) evaluation.flags.push("some_countries_unavailable");
      games.push({ appId: id, store, name: app.name, publisher: app.publisher, iconUrl: app.iconUrl, unifiedAppId: app.unifiedAppId, releaseDate: app.releaseDate, ...classifySense(id, store, app.categories), ...aggregate, evaluation, retrievedAt: app.historyAt ?? now(), url: store === "ios" ? `https://apps.apple.com/${listingCountry.toLowerCase()}/app/id${id}` : `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&gl=${listingCountry}` });
    }
  }
  sortResultGames(games);
  job.result = { filters: job.filters, generatedAt: now(), watermarks: Object.fromEntries(stores.map(s => [s, job.stores[s].watermark])), games, requests: job.requests, errors: complete ? [] : [job.error ?? "Call allowance reached; coverage is incomplete."], coverageComplete: complete, ruleVersion: senseRuleVersion };
  await save("sense:result:" + job.jobKey + ":" + job.result.generatedAt, { result: job.result, receipts: job.receipts });
  job.status = "completed"; job.progress = complete ? "Check complete. Downloads are combined across the selected countries, separately for each store." : "Call allowance reached. Partial report saved; some games or stores were not checked.";
  // Historical runs never overwrite a newer warm cache.
  const previous = await load<Record<SenseStore, StoreState>>(historyKey(job.filters));
  if (complete && (!previous || (previous.ios.watermark ?? "") <= (job.stores.ios.watermark ?? ""))) await save(historyKey(job.filters), job.stores);
  await save(sharedHistoryKey, mergeHistories(await load<Record<SenseStore, StoreState>>(sharedHistoryKey), job.stores, job.filters.countries));
}
