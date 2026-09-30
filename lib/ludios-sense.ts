import { createHash, randomUUID } from "node:crypto";
import { sensorTowerRequest } from "@/lib/sensortower-api";
import { claimSenseLease, getTechLaunchReadinessCache, releaseSenseLease, saveTechLaunchReadinessCache } from "@/lib/db";
import { aggregateSenseHistory, classifySense, evaluateSense, senseRuleVersion, shiftDate, validDownloads } from "@/lib/ludios-sense-detection";
import type { SenseCountry, SenseFilters, SenseGame, SenseResult, SenseRunResponse, SenseStore } from "@/lib/ludios-sense-types";

type App = { appId: string; name: string; publisher: string; categories: string[]; releaseDate: string | null; metadataAt?: string; discoveredDate: string; histories: Partial<Record<SenseCountry, Record<string, number | null>>>; backfilled?: boolean; historyAt?: string };
type StoreState = { apps: Record<string, App>; ids: string[]; historyIds: string[]; watermark?: string; rankingDate: string; datesFound: number; daysChecked: number; offset: number; lastDownloads: number; metadataIndex: number; historyIndex: number; week: number; phase: "discovery" | "metadata" | "history" | "done" };
type Job = { jobKey: string; filters: SenseFilters; status: SenseRunResponse["status"]; createdAt: string; updatedAt: string; requests: number; progress: string; stores: Record<SenseStore, StoreState>; store: SenseStore; result?: SenseResult; error?: string; retry: number; retryAt?: string; receipts: Array<{ endpoint: string; parameters: Record<string, string | number>; retrievedAt: string }> };
const stores: SenseStore[] = ["android", "ios"];
const now = () => new Date().toISOString();
const cacheKey = (filters: SenseFilters) => "sense:v1:" + createHash("sha256").update(JSON.stringify(filters)).digest("hex");
const historyKey = (filters: SenseFilters) => "sense:history:" + filters.countries.join(",");
const aliveUntil = () => new Date(Date.now() + 86400000 * 31).toISOString();
async function save(key: string, value: unknown) { await saveTechLaunchReadinessCache({ cacheKey: key, payload: JSON.stringify(value), createdAt: now(), expiresAt: aliveUntil() }); }
async function load<T>(key: string): Promise<T | null> { const record = await getTechLaunchReadinessCache(key); return record ? JSON.parse(record.payload) as T : null; }
function response(job: Job, cached = false): SenseRunResponse { return { jobKey: job.jobKey, status: job.status, requests: job.requests, progress: job.progress, result: job.result, error: job.error, cached }; }

export async function startSense(filters: SenseFilters): Promise<SenseRunResponse> {
  if (!process.env.SENSOR_TOWER_TOKEN?.trim()) throw new Error("Sensor Tower is not configured on this server. Set SENSOR_TOWER_TOKEN in the server environment.");
  const key = cacheKey(filters), token = randomUUID();
  if (!await claimSenseLease(key + ":lease", token, new Date(Date.now() + 60000).toISOString())) {
    const pending = await load<Job>(key);
    if (pending) return response(pending);
    throw new Response(JSON.stringify({ error: "A scan is starting. Try again in a moment." }), { status: 409, headers: { "Content-Type": "application/json" } });
  }
  try {
    const existing = await load<Job>(key);
    if (existing?.status === "running" || existing?.status === "completed" && Date.now() - Date.parse(existing.updatedAt) < 15 * 60000) return response(existing, existing.status === "completed");
    const previous = await load<Record<SenseStore, StoreState>>(historyKey(filters));
    const today = now().slice(0,10);
    const latest = filters.date < today ? filters.date : shiftDate(today, -1);
    const states = Object.fromEntries(stores.map(store => {
      const apps: Record<string, App> = {};
      for (const [id, app] of Object.entries(previous?.[store]?.apps ?? {})) {
        // Do not reuse future observations when the user selects an older t.
        if (app.discoveredDate <= latest && app.discoveredDate >= shiftDate(latest, -30)) apps[id] = structuredClone(app);
      }
      return [store, { apps, ids: [], historyIds: [], rankingDate: latest, datesFound: 0, daysChecked: 0, offset: 0, lastDownloads: Number.MAX_VALUE, metadataIndex: 0, historyIndex: 0, week: 0, phase: "discovery" }];
    })) as unknown as Record<SenseStore, StoreState>;
    const job: Job = { jobKey: key, filters, status: "running", createdAt: now(), updatedAt: now(), requests: 0, progress: "Discovering Android games across the selected countries…", stores: states, store: "android", retry: 0, receipts: [] };
    await save(key, job);
    return response(job);
  } finally { await releaseSenseLease(key + ":lease", token); }
}

/** One upstream request per step. State and leases survive serverless restarts. */
export async function advanceSense(key: string): Promise<SenseRunResponse> {
  if (!/^sense:v1:[a-f0-9]{64}$/.test(key)) throw new Response("Invalid scan ID", { status: 400 });
  const initial = await load<Job>(key);
  if (!initial) throw new Response("Scan not found", { status: 404 });
  if (initial.status !== "running" || initial.retryAt && initial.retryAt > now()) return response(initial);
  const lease = randomUUID();
  if (!await claimSenseLease(key + ":lease", lease, new Date(Date.now() + 60000).toISOString())) return response(initial);
  let requestLease = false;
  try {
    const job = await load<Job>(key);
    if (!job || job.status !== "running") return response(job ?? initial);
    requestLease = await claimSenseLease("sense:upstream:lease", lease, new Date(Date.now() + 60000).toISOString());
    if (!requestLease) return response(job);
    if (job.requests >= 1000) { job.status = "error"; job.error = "Request budget reached. Discovery is incomplete; choose fewer countries or retry later."; await save(key, job); return response(job); }
    job.requests++;
    await save(key, job); // Count attempts even if the host shuts down during a request.
    try {
      await step(job);
      job.retry = 0; delete job.retryAt;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sensor Tower request failed";
      job.retry++;
      if (job.retry >= 3 || message.includes("access") || message.includes("configured") || message.includes("Unexpected") || message.includes("duplicate")) { job.status = "error"; job.error = message; }
      else { job.retryAt = new Date(Date.now() + Math.min(60000, 10000 * 2 ** job.retry)).toISOString(); job.progress = `${message}. Retrying shortly (${job.retry}/3)…`; }
    }
    job.updatedAt = now();
    const owner = await getTechLaunchReadinessCache(key + ":lease");
    if (owner?.payload !== lease) return response(await load<Job>(key) ?? initial);
    await save(key, job);
    return response(job);
  } finally {
    if (requestLease) await releaseSenseLease("sense:upstream:lease", lease, 1000);
    await releaseSenseLease(key + ":lease", lease);
  }
}

async function sensor(job: Job, endpoint: string, parameters: Record<string, string | number>) {
  const token = process.env.SENSOR_TOWER_TOKEN?.trim();
  if (!token) throw new Error("Sensor Tower is not configured on this server");
  const url = new URL(endpoint, "https://api.sensortower.com");
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  url.searchParams.set("auth_token", token);
  const res = await sensorTowerRequest(url);
  if (res.status < 200 || res.status >= 300) throw new Error(res.status === 401 || res.status === 403 ? "Sensor Tower token or product access is unavailable" : `Sensor Tower returned HTTP ${res.status}`);
  let payload: unknown;
  try { payload = JSON.parse(res.body.replaceAll(token, "[REDACTED]")); } catch { throw new Error("Unexpected Sensor Tower JSON response"); }
  job.receipts.push({ endpoint, parameters, retrievedAt: now() });
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
        s.ids = Object.keys(s.apps).sort(); s.phase = "metadata";
      }
    }
    job.progress = `${store === "ios" ? "iOS" : "Android"}: discovered ${Object.keys(s.apps).length.toLocaleString()} apps above the combined floor; ${s.datesFound}/3 reporting dates checked.`;
  } else if (s.phase === "metadata") {
    const remaining = s.ids.filter(id => !s.apps[id].metadataAt || Date.now() - Date.parse(s.apps[id].metadataAt!) >= 7 * 86400000);
    const batch = remaining.slice(0,100);
    if (batch.length) {
      const p = await sensor(job, `/v1/${store}/apps`, { app_ids: batch.join(","), country: job.filters.countries.includes("US") ? "US" : job.filters.countries[0] }) as { apps: Array<Record<string, unknown>> };
      if (!Array.isArray(p?.apps)) throw new Error("Unexpected Sensor Tower app details response");
      for (const raw of p.apps) {
        const app = s.apps[String(raw.app_id)];
        if (!app || !batch.includes(app.appId)) throw new Error("Unexpected app in metadata response");
        app.name = String(raw.name ?? app.name); app.publisher = String(raw.publisher_name ?? "");
        app.categories = Array.isArray(raw.categories) ? raw.categories.map(String) : [];
        app.releaseDate = typeof raw.release_date === "string" ? raw.release_date.slice(0,10) : null;
      }
      // Missing metadata stays reviewable and does not cause an endless loop.
      batch.forEach(id => { s.apps[id].metadataAt = now(); });
      job.progress = `${store === "ios" ? "iOS" : "Android"}: loading app details (${s.ids.length - remaining.length + batch.length}/${s.ids.length}).`;
    } else {
      s.historyIds = s.ids.filter(id => classifySense(id, store, s.apps[id].categories).classification !== "excluded");
      s.phase = "history";
      job.requests--; // This transition did not make an upstream call.
    }
  } else if (s.phase === "history") {
    const batch = s.historyIds.slice(s.historyIndex, s.historyIndex + 25);
    if (!batch.length) {
      s.phase = "done";
      job.requests--;
      if (store === "android") { job.store = "ios"; job.progress = "Discovering iOS games across the selected countries…"; }
      else await finish(job);
      return;
    }
    const length = batch.every(id => s.apps[id].backfilled && Object.keys(s.apps[id].histories).some(c => Object.hasOwn(s.apps[id].histories[c as SenseCountry] ?? {}, shiftDate(s.watermark!, -27)))) ? 7 : 28;
    const end = shiftDate(s.watermark!, -s.week * 7), start = shiftDate(end, -6);
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
        for (let i = 0; i < 7; i++) { const d = shiftDate(start, i); app.histories[country]![d] = normalized.get(`${id}:${country}:${d}`) ?? null; }
        Object.keys(app.histories[country]!).filter(d => d < shiftDate(s.watermark!, -27) || d > s.watermark!).forEach(d => { delete app.histories[country]![d]; });
      }
      app.historyAt = now();
    }
    s.week++;
    if (s.week * 7 >= length) { batch.forEach(id => { s.apps[id].backfilled = true; }); s.historyIndex += batch.length; s.week = 0; }
    job.progress = `${store === "ios" ? "iOS" : "Android"}: loading ${length}-day download history (${Math.min(s.historyIndex + batch.length, s.historyIds.length)}/${s.historyIds.length} games), all selected countries together.`;
  }
}

async function finish(job: Job) {
  const games: SenseGame[] = [];
  for (const store of stores) {
    const s = job.stores[store];
    for (const id of s.historyIds) {
      const app = s.apps[id], t = s.watermark!;
      const aggregate = aggregateSenseHistory(app.histories, job.filters.countries, t);
      const evaluation = evaluateSense(aggregate.history, t, app.releaseDate);
      if (store === "android") evaluation.flags.push("latest_android_provisional");
      if (aggregate.unavailableCountries.length) evaluation.flags.push("some_countries_unavailable");
      games.push({ appId: id, store, name: app.name, publisher: app.publisher, releaseDate: app.releaseDate, ...classifySense(id, store, app.categories), ...aggregate, evaluation, retrievedAt: app.historyAt ?? now(), url: store === "ios" ? `https://apps.apple.com/us/app/id${id}` : `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}` });
    }
  }
  const ranks = { confirmed_momentum: 0, early_warning: 1, launch_traction: 2, none: 3, insufficient_data: 4 };
  games.sort((a,b) => ranks[a.evaluation.signal] - ranks[b.evaluation.signal] || (b.evaluation.added ?? 0) - (a.evaluation.added ?? 0) || (b.evaluation.growth ?? 0) - (a.evaluation.growth ?? 0) || a.appId.localeCompare(b.appId));
  job.result = { filters: job.filters, generatedAt: now(), watermarks: Object.fromEntries(stores.map(s => [s, job.stores[s].watermark])), games, requests: job.requests, errors: [], coverageComplete: true, ruleVersion: senseRuleVersion };
  job.status = "completed"; job.progress = "Check complete. Downloads are combined across the selected countries, separately for each store.";
  // Historical runs never overwrite a newer warm cache.
  const previous = await load<Record<SenseStore, StoreState>>(historyKey(job.filters));
  if (!previous || (previous.ios.watermark ?? "") <= (job.stores.ios.watermark ?? "")) await save(historyKey(job.filters), job.stores);
}
