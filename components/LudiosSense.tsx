"use client";

import { Activity, Loader2, Play, Radar, Search, SlidersHorizontal } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SenseUsage } from "@/lib/ludios-sense-usage";
import { groupSenseGames, senseCurrentSignal, senseWorthAttention, senseAttentionRank, sortSenseGroups } from "@/lib/ludios-sense-presentation";
import { SenseGameGrid, SenseDetailDrawer } from "@/components/LudiosSenseBrowser";
import CerberusShell from "@/components/CerberusShell";
import { senseCountries, senseCountryCodes, senseToday, type SenseCountry, type SenseGame, type SenseRunResponse } from "@/lib/ludios-sense-types";

const labels = { confirmed_momentum: "Confirmed momentum", early_warning: "Early warning", launch_traction: "Traction — growth unconfirmed", insufficient_data: "Insufficient data", none: "No current signal" };
const number = (v: number | null) => v === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);
const active = (game: SenseGame) => game.evaluation.signal === "confirmed_momentum" || game.evaluation.signal === "early_warning";
const storageKey = "cerberus.ludios-sense.job.v1";
const inputClass = "focus-ring rounded-lg border border-line/70 bg-surface-panel px-3 py-2.5 text-sm text-ink shadow-sm transition-colors hover:border-cobalt/40";
async function call(path: string, body: unknown, signal?: AbortSignal): Promise<SenseRunResponse> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const value = await res.json();
  if (!res.ok) throw new Error(value.error ?? "The check could not be completed");
  return value;
}

function DownloadChart({ game }: { game: SenseGame }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...game.history.map(p => p.downloads ?? 0));
  const x = (i: number) => 50 + i * 680 / 27;
  const y = (v: number) => 210 - v * 185 / max;
  let path = "", connected = false;
  game.history.forEach((point,i) => { if (point.downloads === null) { connected = false; return; } path += `${connected ? "L" : "M"}${x(i)},${y(point.downloads)} `; connected = true; });
  return <div className="rounded-xl border border-line/60 surface-gradient p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-ink">28-day combined downloads</h3><span className="text-xs text-slate-500">{hover === null ? "Hover to inspect a day" : `${game.history[hover].date} · ${number(game.history[hover].downloads)} downloads`}</span></div>
    <svg viewBox="0 0 750 250" className="w-full" role="img" aria-label={`28-day combined daily downloads for ${game.name} on ${game.store}`} onMouseLeave={() => setHover(null)}>
      {[0,.5,1].map(f => <g key={f}><line x1="50" x2="730" y1={y(max*f)} y2={y(max*f)} stroke="var(--chart-grid)" /><text x="42" y={y(max*f)+4} textAnchor="end" fontSize="11" fill="var(--chart-label)">{new Intl.NumberFormat(undefined,{notation:"compact",maximumFractionDigits:1}).format(max*f)}</text></g>)}
      <path d={path} fill="none" stroke="#6d5ef7" strokeWidth="2.5" />
      {game.history.map((point,i) => <g key={point.date}>
        {point.downloads !== null ? <circle cx={x(i)} cy={y(point.downloads)} r={hover === i ? 5 : 2} fill="#6d5ef7"><title>{point.date}: {number(point.downloads)} downloads</title></circle> : null}
        <rect x={x(i)-12} y="10" width="24" height="205" fill="transparent" onMouseEnter={() => setHover(i)}><title>{point.date}: {number(point.downloads)}</title></rect>
        {i%7 === 0 || i===27 ? <text x={x(i)} y="238" textAnchor="middle" fontSize="11" fill="var(--chart-label)">{point.date.slice(5)}</text> : null}
      </g>)}
    </svg>
    <p className="text-xs text-slate-500">Estimated downloads per day. Missing observations appear as gaps.</p>
  </div>;
}

export default function LudiosSense() {
  // Set the limit after hydration so cached server HTML cannot freeze it at build day.
  const [today, setToday] = useState("");
  const [date, setDate] = useState(() => senseToday());
  useEffect(() => {
    const refreshToday = () => setToday(senseToday());
    refreshToday();
    const timer = window.setInterval(refreshToday, 60_000);
    window.addEventListener("focus", refreshToday);
    document.addEventListener("visibilitychange", refreshToday);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshToday);
      document.removeEventListener("visibilitychange", refreshToday);
    };
  }, []);
  const [countries, setCountries] = useState<SenseCountry[]>(senseCountryCodes);
  const [scan, setScan] = useState<SenseRunResponse | null>(null);
  const [error, setError] = useState("");
  const [usagePlan, setUsagePlan] = useState<{ usage: SenseUsage; knownGames: number; knownHistoryCalls: number; knownMetadataCalls: number; cachedReport?: boolean; note: string } | null>(null);
  const [usageError, setUsageError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [group, setGroup] = useState("attention");
  const [recent, setRecent] = useState<SenseGame[]>([]);
  const [recentError, setRecentError] = useState("");
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentAttempt, setRecentAttempt] = useState(0);
  const [store, setStore] = useState("all");
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [limit, setLimit] = useState(30);
  const [collapsed, setCollapsed] = useState(false);
  const [details, setDetails] = useState<Record<string, SenseGame>>({});
  const [detailError, setDetailError] = useState("");
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const [iconRequests, setIconRequests] = useState(0);
  const [unifiedIds, setUnifiedIds] = useState<Record<string,string|null>>({});
  const controller = useRef<AbortController | null>(null);
  const busy = submitting || scan?.status === "running" && !paused;
  const result = scan?.result;
  const currentGames = result?.games ?? [];
  const games = useMemo(() => {
    const map = new Map(currentGames.map(g => [`${g.store}:${g.appId}`, g]));
    for (const game of recent) map.set(`${game.store}:${game.appId}`, game);
    return [...map.values()];
  }, [currentGames, recent]);
  useEffect(() => {
    setRecent([]); setRecentError("");
    if (!scan?.jobKey || !result) { setRecentLoading(false); return; }
    const abort = new AbortController();
    setRecentLoading(true);
    const jobKey = scan.jobKey;
    async function loadDetections() {
      for (let attempt=0;attempt<2;attempt++) {
        const request = new AbortController();
        const cancel = () => request.abort();
        abort.signal.addEventListener("abort",cancel,{once:true});
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            fetch("/api/ludios-sense/recent", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jobKey}),signal:request.signal})
              .then(async r => { if (!r.ok) throw new Error("Saved detections unavailable"); return await r.json(); }),
            new Promise<never>((_,reject) => { timer=setTimeout(() => {request.abort();reject(new Error("Saved detections timed out"));},20000); }),
          ]);
        } catch {
          if (abort.signal.aborted) return;
          if (attempt===1) throw new Error("Saved detections could not be loaded. This shortlist is incomplete; retry to restore recent games.");
        } finally {
          clearTimeout(timer);
          abort.signal.removeEventListener("abort",cancel);
        }
      }
    }
    void loadDetections()
      .then(value => {if (!abort.signal.aborted) setRecent(value.games ?? []);})
      .catch(e => {if (!abort.signal.aborted) setRecentError(e instanceof Error ? e.message : "Recent detections unavailable");})
      .finally(() => {if (!abort.signal.aborted) setRecentLoading(false);});
    return () => abort.abort();
  }, [scan?.jobKey, result?.generatedAt, recentAttempt]);
  const storeGroups = useMemo(() => sortSenseGroups(groupSenseGames(games.filter(game => store === "all" || game.store === store),unifiedIds)),[games,store,unifiedIds]);
  const matchesGroup = (game: SenseGame, filter: string) => filter === "attention" ? senseWorthAttention(game) :
    filter === "recent" ? Boolean(game.watch) || senseCurrentSignal(game) :
    filter === "included" ? senseCurrentSignal(game) :
    filter === "review" ? active(game) && game.classification === "review" :
    filter === "traction" ? game.evaluation.signal === "launch_traction" : game.watch?.currentObserved !== false;
  const tabs = [
    ["attention","Worth attention"],["recent","Recent detections"],["included","Current signals"],
    ["review","Genre review"],["traction","Unconfirmed traction"],["all","All evaluated"],
  ];
  const grouped = storeGroups.filter(item => item.members.some(game => matchesGroup(game,group)) &&
    item.members.some(game => `${game.name} ${game.publisher} ${game.appId}`.toLowerCase().includes(search.toLowerCase())));
  const visible = grouped.flatMap(item => item.members);
  const iconSelection = JSON.stringify(grouped.slice(0,limit).flatMap(group=>group.members).filter(g => g.watch?.currentObserved !== false && (g.iconUrl === undefined || g.unifiedAppId === undefined)).map(g => ({ appId:g.appId, store:g.store })));
  useEffect(() => {
    if (!scan?.jobKey) return;
    const abort = new AbortController();
    const selection = JSON.parse(iconSelection) as Array<{appId:string;store:"ios"|"android"}>;
    void (async () => {
      for (const store of ["ios","android"] as const) {
        const ids = selection.filter(g => g.store === store && (icons[`${store}:${g.appId}`] === undefined || unifiedIds[`${store}:${g.appId}`] === undefined)).map(g => g.appId);
        for (let i=0; i<ids.length && !abort.signal.aborted; i+=100) {
          const batch = ids.slice(i,i+100);
          try {
            let response: Response | undefined;
            for (let attempt=0; attempt<6 && !abort.signal.aborted; attempt++) {
              response = await fetch("/api/ludios-sense/icons", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jobKey:scan.jobKey,store,appIds:batch}),signal:abort.signal});
              if (response.status !== 503) break;
              await new Promise<void>(resolve => { const timer = setTimeout(resolve,2000); abort.signal.addEventListener("abort",()=>{clearTimeout(timer);resolve();},{once:true}); });
            }
            if (!response?.ok || abort.signal.aborted) continue;
            const value = await response.json() as {icons:Record<string,string|null>;unifiedIds?:Record<string,string|null>;requests:number};
            if (!abort.signal.aborted && value.requests) setIconRequests(count => count + value.requests);
            if (!abort.signal.aborted) {
              setIcons(old => ({...old,...Object.fromEntries(Object.entries(value.icons).map(([id,url])=>[`${store}:${id}`,url]))}));
              setUnifiedIds(old => ({...old,...Object.fromEntries(Object.entries(value.unifiedIds ?? {}).map(([id,unified])=>[`${store}:${id}`,unified]))}));
            }
          } catch { /* Icons are optional; a placeholder keeps the report usable. */ }
        }
      }
    })();
    return () => abort.abort();
  }, [scan?.jobKey, iconSelection]);
  const selected = games.find(g => `${g.store}:${g.appId}` === selection);
  const selectedMembers = selected ? groupSenseGames(games,unifiedIds).find(item => item.members.includes(selected))?.members ?? [selected] : [];
  const chartJobKey = selected?.watch?.sourceJobKey ?? scan?.jobKey;
  const chartGeneratedAt = selected?.watch?.sourceGeneratedAt ?? result?.generatedAt;
  const detailKey = selected && scan ? `${chartJobKey}:${chartGeneratedAt}:${selected.store}:${selected.appId}` : "";
  const selectedDetail = details[detailKey];
  useEffect(() => {
    if (!selected || !scan || selectedDetail) return;
    const abort = new AbortController();
    setDetailError("");
    void fetch("/api/ludios-sense/game", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobKey: chartJobKey, appId: selected.appId, store: selected.store, generatedAt: chartGeneratedAt }), signal: abort.signal })
      .then(async r => { if (!r.ok) throw new Error("Could not load this game's download chart. Select another game and try again."); return await r.json() as SenseGame; })
      .then(game => { if (!abort.signal.aborted) setDetails(v => ({ ...v, [detailKey]: game })); })
      .catch(e => { if (!abort.signal.aborted) setDetailError(e instanceof Error ? e.message : "Chart unavailable"); });
    return () => abort.abort();
  }, [detailKey, selectedDetail]);
  useEffect(() => {
    try {
      const pending = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (pending && /^sense:v1:[a-f0-9]{64}$/.test(pending.jobKey)) {
        setScan({ jobKey: pending.jobKey, status: "running", progress: "Resuming saved check…", requests: 0 });
        if (typeof pending.date === "string") setDate(pending.date);
        if (Array.isArray(pending.countries) && pending.countries.length && pending.countries.every((c: string) => c in senseCountries)) setCountries(pending.countries);
      }
    } catch { /* Browser storage is optional. */ }
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (!date || !countries.length) return;
    const abort=new AbortController();
    const timer=setTimeout(()=> {
      void fetch("/api/ludios-sense/cache",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({date,countries}),signal:abort.signal})
        .then(async r=>r.ok?await r.json():null)
        .then(value=> { if(!abort.signal.aborted && value?.scan) {setScan(value.scan);setPaused(Boolean(value.scan.paused));setSelection(null);} })
        .catch(()=>{/* The user can still run a check if cache lookup is unavailable. */});
    },250);
    return ()=>{clearTimeout(timer);abort.abort();};
  },[date,countries]);
  useEffect(() => {
    if (scan?.status !== "running" || paused) return;
    const abort = new AbortController(); controller.current = abort;
    let stopped = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await call("/api/ludios-sense/status", { jobKey: scan.jobKey }, abort.signal);
        if (!stopped) { setScan(next); setPaused(Boolean(next.paused)); if (next.status === "error") setError(next.error ?? "Check failed"); }
      } catch (e) {
        if (!stopped && !abort.signal.aborted) { setError(e instanceof Error ? e.message : "Connection lost. Resume the check to continue."); setPaused(true); }
      }
    }, 1000);
    return () => { stopped = true; clearTimeout(timer); abort.abort(); };
  }, [scan, paused]);
  useEffect(() => {
    if (!date || !countries.length) return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      setUsageError("");
      void fetch("/api/ludios-sense/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({date,countries}), signal: abort.signal })
        .then(async r => { if (!r.ok) throw new Error("API allowance unavailable"); return r.json(); })
        .then(value => { if (!value?.usage) throw new Error("API allowance unavailable"); if (!abort.signal.aborted) setUsagePlan(value); })
        .catch(() => { if (!abort.signal.aborted) setUsageError("API allowance could not be loaded. The server still enforces the limit."); });
    },350);
    return () => { clearTimeout(timer); abort.abort(); };
  },[date,countries,Math.floor((scan?.requests ?? 0)/10),scan?.status,iconRequests]);
  async function run() {
    setSubmitting(true); setError(""); setPaused(false); setSelection(null);
    try {
      const next = await call("/api/ludios-sense", { date, countries });
      setScan(next);
      try { sessionStorage.setItem(storageKey, JSON.stringify({ jobKey: next.jobKey, date, countries })); } catch { /* optional */ }
    } catch (e) { setError(e instanceof Error ? e.message : "Check failed"); }
    finally { setSubmitting(false); }
  }
  async function togglePaused() {
    if (!scan) return;
    const nextPaused = !paused;
    setPaused(nextPaused); setError("");
    try { setScan(await call("/api/ludios-sense/status", { jobKey: scan.jobKey, action: nextPaused ? "pause" : "resume" })); }
    catch (e) { setPaused(!nextPaused); setError(e instanceof Error ? e.message : "Could not change the scan state"); }
  }
  const changed = result && (date !== result.filters.date || [...countries].sort().join(",") !== result.filters.countries.join(","));
  return <CerberusShell currentProduct="ludios-sense" collapsed={collapsed} onToggleCollapsed={() => setCollapsed(v => !v)}>
    <header className="mb-4 flex flex-wrap sm:mb-6 items-center justify-between gap-3">
      <div><p className="mb-1 hidden text-[10px] font-bold uppercase sm:block tracking-[0.18em] text-cobalt">Casual game discovery</p><h1 className="font-display text-2xl font-extrabold sm:text-3xl tracking-tight text-ink">Ludios Sense</h1><p className="mt-1 hidden text-sm text-slate-500 sm:block">Games worth a closer look.</p></div>
    </header>
    <section className="sense-panel rounded-2xl border border-line/70 bg-surface-card p-4" aria-label="Check filters">
      <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        <label className="flex min-w-0 flex-col gap-1.5 text-[11px] font-semibold text-slate-500">Report date · WIB<input aria-label="Date (t)" type="date" value={date} max={today || undefined} disabled={Boolean(busy)} onChange={e => setDate(e.target.value)} className={`${inputClass} min-w-0 px-2 text-xs sm:px-3 sm:text-sm`} /></label>
        <details className="relative"><summary className={`${inputClass} flex cursor-pointer list-none items-center gap-1.5 px-2 text-xs sm:gap-2 sm:px-3 sm:text-sm`}><SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-cobalt" />Markets <span className="text-xs text-slate-500">{countries.length}<span className="hidden sm:inline"> selected</span></span></summary>
          <fieldset disabled={Boolean(busy)} className="absolute right-0 top-full z-20 mt-2 w-64 max-w-[calc(100vw-32px)] rounded-xl border border-line bg-surface-card p-4 shadow-xl"><legend className="sr-only">Countries</legend><p className="mb-3 text-xs text-slate-500">Downloads combined across your selection</p><div className="flex flex-col gap-3">{senseCountryCodes.map(c => <label key={c} className="flex cursor-pointer items-center gap-2 text-xs text-ink"><input type="checkbox" checked={countries.includes(c)} onChange={e => setCountries(v => e.target.checked ? [...v,c] : v.filter(x => x!==c))} className="accent-cobalt" />{senseCountries[c]}</label>)}</div></fieldset>
        </details>
        <button onClick={run} disabled={Boolean(busy) || !countries.length || !date} className="focus-ring col-span-2 inline-flex h-[42px] justify-center items-center gap-2 rounded-lg bg-cobalt px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-cobalt/90 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {busy ? "Checking…" : "Run check"}</button>
        {scan?.status === "running" ? <button className={`${inputClass} text-cobalt`} onClick={togglePaused}>{paused ? "Resume check" : "Pause check"}</button> : null}
        {result ? <span className="ml-auto hidden pb-3 text-[11px] sm:block text-slate-500">{result.reusedFrom ? "Saved country data · 0 new calls" : result.coverageComplete ? "Saved report" : "Partial report"} · {result.filters.date}</span> : null}
      </div>
    </section>
    <details aria-label="API call allowance" className="mt-2 text-xs leading-5 text-slate-500">
      <summary className="ml-auto w-fit cursor-pointer text-[11px] text-slate-400 hover:text-slate-500">API usage</summary>
      <div className="mt-2 rounded-lg bg-surface-table p-3">
      {usagePlan ? <>
        <p>Ludios Sense · {usagePlan.usage.month}: {number(usagePlan.usage.used)} / {number(usagePlan.usage.limit)} calls · {number(usagePlan.usage.remaining)} remaining</p>
        <p>{usagePlan.cachedReport ? "Saved report ready. No new Sensor Tower calls needed for this selection." : usagePlan.knownGames ? `Saved candidates: about ${usagePlan.knownHistoryCalls + usagePlan.knownMetadataCalls} calls for history and app details, plus discovery, new games and retries.` : "First scan: call estimate unavailable until candidates are discovered."}</p>
        <p>Tracking since {new Date(usagePlan.usage.trackingStartedAt).toLocaleString()}; earlier calls are excluded. At the allowance, the scan stops with incomplete coverage.</p>
        {usagePlan.usage.organizationUsed !== undefined ? <p>Sensor Tower organization usage: {number(usagePlan.usage.organizationUsed)} / {number(usagePlan.usage.organizationLimit ?? null)} · includes other teams · last observed {new Date(usagePlan.usage.organizationObservedAt!).toLocaleString()}.</p> : <p>Shared organization usage appears after Sensor Tower returns its usage headers.</p>}
      </> : <p>{usageError || "Loading API call allowance…"}</p>}
      </div>
    </details>
    {error ? <div role="alert" className="mt-4 rounded-lg border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-ink">{error}</div> : null}
    {scan?.status === "running" || scan?.status === "error" ? <div role="status" className="mt-4 flex items-center gap-3 rounded-xl border border-cobalt/20 bg-cobalt/5 p-4 text-sm text-ink">{busy ? <Loader2 className="h-4 w-4 animate-spin text-cobalt" /> : <Activity className="h-4 w-4 text-cobalt" />}<span>{paused ? "Check paused. Resume to continue from the saved step." : scan.progress}</span></div> : null}
    {!scan ? <div className="sense-panel my-8 rounded-2xl border border-dashed border-cobalt/20 surface-card-gradient px-6 py-14 text-center"><Radar className="mx-auto mb-4 h-10 w-10 text-cobalt/60" /><h2 className="text-lg font-bold text-ink">Find the next game to investigate</h2><p className="mt-2 text-sm text-slate-500">Choose a date and markets, then run a check. Both stores are included.</p></div> : null}
    {result ? <>
      {!result.coverageComplete ? <div role="alert" className="mt-4 rounded-lg border border-amber-400/40 p-4 text-sm text-ink">Partial coverage: {result.errors.join(" ")} Results include only games whose history finished loading. Other games may have been missed.</div> : null}
      <details className="my-3 text-xs text-slate-500"><summary className="focus-ring w-fit cursor-pointer rounded text-[11px]">Report details</summary><div className="mt-2 space-y-2 rounded-xl border border-line/60 bg-surface-table p-4">
        <p>Requested t: {result.filters.date} · Evaluated: Android {result.watermarks.android ?? "unavailable"}, iOS {result.watermarks.ios ?? "unavailable"} · Retrieved {new Date(result.generatedAt).toLocaleString()}.</p>
        <p>Countries: {result.filters.countries.map(c => senseCountries[c]).join(", ")} · {currentGames.length} game/store records evaluated. Latest Android estimates are provisional.</p>
        <p>{result.reusedFrom ? `Recalculated from saved ${result.reusedFrom.countries.join(", ")} data · source retrieved ${new Date(result.reusedFrom.generatedAt).toLocaleString()} · No new Sensor Tower calls.` : scan?.cached ? `Shared saved report · ${scan.requests} API requests in the original scan · No new scan started.` : `${scan?.requests ?? 0} API requests.`} Shared seven-market reports run at 04:00 WIB. Actual reporting dates may be earlier.</p>
        <p>Recent detections are retained for seven reporting days using saved reports for the same markets. Holding scale requires at least 1,000 latest-day downloads and a three-day average of at least 80% of the last detected average.</p>
        <p>Download growth does not establish organic demand, retention, or commercial success. Investigate gameplay, differentiation, and updates. A single-market breakout may be diluted by flat volume elsewhere.</p>
      </div></details>
      {changed ? <p className="mb-4 rounded-lg border border-amber-400/40 p-3 text-sm text-ink">Filters changed. Run check to update the report. These results use {result.filters.date} · {result.filters.countries.map(c => senseCountries[c]).join(", ")}.</p> : null}
      <section className="sense-panel mt-5 rounded-2xl border border-line/70 bg-surface-card" aria-label="Research shortlist">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 p-4 sm:p-5"><h2 className="font-display text-base sm:text-lg font-bold text-ink">Research shortlist</h2><div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap"><select aria-label="Store" className={`${inputClass} min-w-0 px-2 text-xs sm:px-3 sm:text-sm`} value={store} onChange={e => { setStore(e.target.value); setLimit(30); }}><option value="all">Both stores</option><option value="ios">iOS</option><option value="android">Android</option></select><label className="relative min-w-0"><Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input aria-label="Search games" placeholder="Game or publisher" value={search} onChange={e => { setSearch(e.target.value); setLimit(30); }} className={`${inputClass} w-full min-w-0 pl-9 text-xs sm:w-48 sm:text-sm`} /></label></div></div>
        <div role="group" aria-label="Signal group" className="flex gap-1.5 overflow-x-auto border-b border-line/60 p-3 sm:flex-wrap">{tabs.map(([value,label]) => <button key={value} aria-pressed={group === value} onClick={() => { setGroup(value); setLimit(30); }} className={`focus-ring shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${group === value ? "bg-cobalt/10 text-cobalt" : "text-slate-500 hover:bg-surface-table"}`}>{label}<span className="ml-2 opacity-60">{["attention","recent"].includes(value) && (recentLoading || recentError) ? "…" : storeGroups.filter(item => item.members.some(game => matchesGroup(game,value))).length}</span></button>)}</div>
        {recentError ? <div role="alert" className="px-5 pt-4 text-xs text-amber"><p>{recentError}</p><button className="focus-ring mt-2 rounded-lg border border-line px-3 py-2 font-semibold" onClick={() => setRecentAttempt(value => value+1)}>Retry saved detections</button></div> : null}
        {recentLoading ? <p role="status" className="px-5 pt-4 text-xs text-slate-500">Loading saved detections… This shortlist is incomplete until history loads.</p> : null}
        <div className="p-5 sm:p-6">
          {group === "attention" ? [{label:"Current signals",rank:0},{label:"Holding scale",rank:2}].map(({label,rank}) => {
            const items = grouped.slice(0,limit).filter(item => rank === 0 ? senseAttentionRank(item.members[0]) < 2 : senseAttentionRank(item.members[0]) === 2);
            return items.length ? <div key={label} className="mb-7 last:mb-0"><div className="mb-5 flex items-center gap-3"><h3 className="text-xs font-bold text-ink">{label}</h3><span className="h-px flex-1 bg-line/60" /></div><SenseGameGrid groups={items} icons={icons} onInspect={game => setSelection(`${game.store}:${game.appId}`)} /></div> : null;
          }) : <SenseGameGrid groups={grouped.slice(0,limit)} icons={icons} onInspect={game => setSelection(`${game.store}:${game.appId}`)} />}
          {!visible.length ? <div className="py-12 text-center"><Radar aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-cobalt/40" /><p className="text-sm font-semibold text-ink">{search ? "No games match your search" : "No games in this view"}</p><p className="mt-1 text-xs text-slate-500">Try another filter or browse all recent detections.</p></div> : null}
          {grouped.length > limit ? <button className="focus-ring mt-6 rounded-lg border border-line px-4 py-2 text-xs font-semibold text-cobalt" onClick={() => setLimit(v => v + 30)}>Show 30 more</button> : null}
        </div>
      </section>
      {selected ? <SenseDetailDrawer game={selected} members={selectedMembers} onSelect={game => setSelection(`${game.store}:${game.appId}`)} onClose={() => setSelection(null)}>
        <div className="mb-5 grid gap-3 sm:grid-cols-3">{[["Latest 3-day average",number(selected.evaluation.recentAverage)],["Rule baseline",number(selected.evaluation.baseline)],["Trigger",selected.evaluation.variant?.replaceAll("_"," ") ?? labels[selected.evaluation.signal]]].map(([label,value]) => <div key={label} className="rounded-xl border border-line/60 bg-surface-table p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-bold text-ink">{value}</p></div>)}</div>
        {selected.watch?.currentObserved === false ? <p className="mb-3 text-xs text-amber">Not evaluated in this report. The chart below is from the saved report dated {selected.watch.lastDetected}; current downloads are unavailable.</p> : null}
        {selectedDetail ? <DownloadChart key={detailKey} game={selectedDetail} /> : <div role="status" className="flex h-56 items-center justify-center text-sm text-slate-500">{detailError || "Loading download chart…"}</div>}
        <div className="mt-5 border-t border-line pt-4 text-xs leading-6 text-slate-500"><p>Observed activity: {selected.evaluation.activityDate ?? "Not established"} · Reported release: {selected.releaseDate ?? "Unknown"}{selected.evaluation.releaseAge !== null ? ` (${selected.evaluation.releaseAge} days before t)` : ""}. Release date does not gate detection.</p><p>Combined countries with observations: {selected.availableCountries.map(c => senseCountries[c]).join(", ") || "None"}.</p>{selected.unavailableCountries.length ? <p>No observations in this lookback: {selected.unavailableCountries.map(c => senseCountries[c]).join(", ")}. These countries are omitted from both the recent period and baseline.</p> : null}<p>Data labels: {selected.evaluation.flags.length ? selected.evaluation.flags.map(f => f.replaceAll("_"," ")).join(" · ") : "No additional data flags"} · Retrieved {new Date(selected.retrievedAt).toLocaleString()}.</p></div>
      </SenseDetailDrawer> : null}
    </> : null}
  </CerberusShell>;
}
