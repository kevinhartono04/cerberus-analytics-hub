"use client";

import { Activity, ArrowUpRight, CheckCircle2, Loader2, Play, Radar, Search } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SenseUsage } from "@/lib/ludios-sense-usage";
import CerberusShell from "@/components/CerberusShell";
import { senseCountries, senseCountryCodes, type SenseCountry, type SenseGame, type SenseRunResponse } from "@/lib/ludios-sense-types";

const labels = { confirmed_momentum: "Confirmed momentum", early_warning: "Early warning", launch_traction: "Traction — growth unconfirmed", insufficient_data: "Insufficient data", none: "No signal" };
const number = (v: number | null) => v === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);
const growth = (game: SenseGame) => game.evaluation.baseline === 0 ? "From zero" : game.evaluation.growth === null ? "—" : `${game.evaluation.growth.toFixed(2)}×`;
const active = (game: SenseGame) => game.evaluation.signal === "confirmed_momentum" || game.evaluation.signal === "early_warning";
const storageKey = "cerberus.ludios-sense.job.v1";
const inputClass = "focus-ring rounded-lg border border-line bg-surface-panel px-3 py-2 text-sm text-ink";
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
  return <div>
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
  const [date, setDate] = useState(() => new Date().toISOString().slice(0,10));
  const [countries, setCountries] = useState<SenseCountry[]>(senseCountryCodes);
  const [scan, setScan] = useState<SenseRunResponse | null>(null);
  const [error, setError] = useState("");
  const [usagePlan, setUsagePlan] = useState<{ usage: SenseUsage; knownGames: number; knownHistoryCalls: number; knownMetadataCalls: number; note: string } | null>(null);
  const [usageError, setUsageError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [group, setGroup] = useState("included");
  const [store, setStore] = useState("all");
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [limit, setLimit] = useState(30);
  const [collapsed, setCollapsed] = useState(false);
  const [details, setDetails] = useState<Record<string, SenseGame>>({});
  const [detailError, setDetailError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const busy = submitting || scan?.status === "running" && !paused;
  const result = scan?.result;
  const games = result?.games ?? [];
  const visible = useMemo(() => games.filter(game => (store === "all" || game.store === store) &&
    (group === "all" || group === "included" && active(game) && game.classification === "included" || group === "review" && active(game) && game.classification === "review" || group === "traction" && game.evaluation.signal === "launch_traction") &&
    `${game.name} ${game.publisher} ${game.appId}`.toLowerCase().includes(search.toLowerCase())), [games, group, store, search]);
  const selected = visible.find(g => `${g.store}:${g.appId}` === selection) ?? visible[0];
  const detailKey = selected && scan ? `${scan.jobKey}:${result?.generatedAt}:${selected.store}:${selected.appId}` : "";
  const selectedDetail = details[detailKey];
  useEffect(() => {
    if (!selected || !scan || selectedDetail) return;
    const abort = new AbortController();
    setDetailError("");
    void fetch("/api/ludios-sense/game", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobKey: scan.jobKey, appId: selected.appId, store: selected.store, generatedAt: result?.generatedAt }), signal: abort.signal })
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
  },[date,countries,Math.floor((scan?.requests ?? 0)/10),scan?.status]);
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
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4"><div><h1 className="font-display text-3xl font-bold text-ink">Ludios Sense</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Spot casual games gaining traction across your test markets. Combined downloads, separate signals for iOS and Android.</p></div><Radar className="h-8 w-8 text-cobalt" /></header>
    <section className="rounded-xl border border-line bg-surface-panel p-5" aria-label="Check filters">
      <div className="flex flex-wrap items-end gap-4"><label className="flex flex-col gap-2 text-xs font-semibold text-slate-500">Date (t)<input aria-label="Date (t)" type="date" value={date} max={new Date().toISOString().slice(0,10)} disabled={Boolean(busy)} onChange={e => setDate(e.target.value)} className={inputClass} /></label><button onClick={run} disabled={Boolean(busy) || !countries.length || !date} className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg bg-cobalt px-5 text-sm font-bold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {busy ? "Checking…" : "Run check"}</button>{scan?.status === "running" ? <button className={`${inputClass} text-cobalt`} onClick={togglePaused}>{paused ? "Resume check" : "Pause check"}</button> : null}</div>
      <fieldset disabled={Boolean(busy)} className="mt-5"><legend className="mb-3 text-xs font-semibold text-slate-500">Countries · downloads combined across your selection</legend><div className="flex flex-wrap gap-2">{senseCountryCodes.map(c => <label key={c} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${countries.includes(c) ? "border-cobalt/40 bg-cobalt/10 text-ink" : "border-line text-slate-500"}`}><input type="checkbox" checked={countries.includes(c)} onChange={e => setCountries(v => e.target.checked ? [...v,c] : v.filter(x => x!==c))} className="accent-cobalt" />{senseCountries[c]}</label>)}</div></fieldset>
      <p className="mt-4 text-xs leading-5 text-slate-500">Today is selected by default. If estimates for t are unavailable, the report uses the latest completed reporting date and shows it explicitly. The minimum is 1,000 combined downloads/day per store.</p>
    </section>
    <details aria-label="API call allowance" className="mt-2 text-xs leading-5 text-slate-500">
      <summary className="ml-auto w-fit cursor-pointer text-[11px] text-slate-400 hover:text-slate-500">API usage</summary>
      <div className="mt-2 rounded-lg bg-surface-table p-3">
      {usagePlan ? <>
        <p>Ludios Sense · {usagePlan.usage.month}: {number(usagePlan.usage.used)} / {number(usagePlan.usage.limit)} calls · {number(usagePlan.usage.remaining)} remaining</p>
        <p>{usagePlan.knownGames ? `Saved candidates: about ${usagePlan.knownHistoryCalls + usagePlan.knownMetadataCalls} calls for history and app details, plus discovery, new games and retries.` : "First scan: call estimate unavailable until candidates are discovered."}</p>
        <p>Tracking since {new Date(usagePlan.usage.trackingStartedAt).toLocaleString()}; earlier calls are excluded. At the allowance, the scan stops with incomplete coverage.</p>
        {usagePlan.usage.organizationUsed !== undefined ? <p>Sensor Tower organization usage: {number(usagePlan.usage.organizationUsed)} / {number(usagePlan.usage.organizationLimit ?? null)} · includes other teams · last observed {new Date(usagePlan.usage.organizationObservedAt!).toLocaleString()}.</p> : <p>Shared organization usage appears after Sensor Tower returns its usage headers.</p>}
      </> : <p>{usageError || "Loading API call allowance…"}</p>}
      </div>
    </details>
    {error ? <div role="alert" className="mt-4 rounded-lg border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-ink">{error}</div> : null}
    {scan ? <div role="status" className="mt-5 flex items-center gap-3 rounded-lg border border-line bg-surface-panel p-4 text-sm text-ink">{scan.status === "completed" ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : busy ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-cobalt" /> : <Activity className="h-5 w-5 shrink-0 text-cobalt" />}<div>{paused ? "Check paused. Resume to continue from the saved step." : scan.progress}<p className="mt-1 text-xs text-slate-500">{scan.requests} API requests{scan.cached ? " · Recently saved result reused" : ""}. One request at a time, with countries batched together. The scan continues on the server when this tab is inactive.</p></div></div> : null}
    {!scan ? <div className="my-16 text-center"><Radar className="mx-auto mb-4 h-10 w-10 text-cobalt/60" /><h2 className="text-lg font-bold text-ink">Find the next game to investigate</h2><p className="mt-2 text-sm text-slate-500">Choose a date and markets, then run a check. Both stores are included.</p></div> : null}
    {result ? <>
      {!result.coverageComplete ? <div role="alert" className="mt-4 rounded-lg border border-amber-400/40 p-4 text-sm text-ink">Partial coverage: {result.errors.join(" ")} Results include only games whose history finished loading. Other games may have been missed.</div> : null}
      <div className="my-6 grid gap-3 sm:grid-cols-3">{[["Growth signals",games.filter(g => active(g) && g.classification === "included").length],["Awaiting genre review",games.filter(g => active(g) && g.classification === "review").length],["Games / stores evaluated",games.length]].map(([label,value]) => <div key={label} className="rounded-xl border border-line bg-surface-panel p-5"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-ink">{value}</p></div>)}</div>
      <p className="mb-4 text-xs leading-5 text-slate-500">Requested t: {result.filters.date} · Evaluated: Android {result.watermarks.android ?? "unavailable"}, iOS {result.watermarks.ios ?? "unavailable"} · Retrieved {new Date(result.generatedAt).toLocaleString()} · Countries: {result.filters.countries.map(c => senseCountries[c]).join(", ")}. {result.coverageComplete ? "Discovery and history requests completed." : "Incomplete coverage."} Latest Android estimates are provisional.</p>
      {changed ? <p className="mb-4 rounded-lg border border-amber-400/40 p-3 text-sm text-ink">Filters changed. Run check to update the report; the results below use the selection shown above.</p> : null}
      <section className="overflow-hidden rounded-xl border border-line bg-surface-panel">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4"><h2 className="mr-auto text-base font-bold text-ink">Research shortlist</h2><select aria-label="Signal group" className={inputClass} value={group} onChange={e => { setGroup(e.target.value); setLimit(30); }}><option value="included">In-scope growth</option><option value="review">Needs genre review</option><option value="traction">Traction, unconfirmed</option><option value="all">All evaluated games</option></select><select aria-label="Store" className={inputClass} value={store} onChange={e => { setStore(e.target.value); setLimit(30); }}><option value="all">Both stores</option><option value="ios">iOS</option><option value="android">Android</option></select><label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><input aria-label="Search games" placeholder="Game or publisher" value={search} onChange={e => { setSearch(e.target.value); setLimit(30); }} className={`${inputClass} pl-9`} /></label></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-surface-table text-xs text-slate-500"><tr>{["Game / store", "Signal", "Latest day", "Growth", "Added / day"].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody>{visible.slice(0,limit).map(g => <tr key={`${g.store}:${g.appId}`} className={`border-t border-line/60 ${selected===g ? "bg-cobalt/5" : ""}`}><td className="px-4 py-4"><button aria-label={`Inspect ${g.name}, ${g.store}`} onClick={() => setSelection(`${g.store}:${g.appId}`)} className="focus-ring text-left font-bold text-cobalt">{g.name}</button><p className="mt-1 text-xs text-slate-500">{g.publisher || "Publisher unavailable"} · {g.store === "ios" ? "iOS" : "Android"}</p></td><td className="px-4 py-4 text-ink">{labels[g.evaluation.signal]}</td><td className="px-4 py-4 font-mono text-ink">{number(g.evaluation.latest)}</td><td className="px-4 py-4 font-mono text-ink">{growth(g)}</td><td className="px-4 py-4 font-mono text-ink">{g.evaluation.added === null ? "—" : `+${number(g.evaluation.added)}`}</td></tr>)}</tbody></table></div>
        {!visible.length ? <p className="p-8 text-center text-sm text-slate-500">No games match this group. Try “Needs genre review” or “All evaluated games”.</p> : null}
        {visible.length > limit ? <button className="focus-ring m-4 text-sm font-semibold text-cobalt" onClick={() => setLimit(v => v + 30)}>Show 30 more</button> : null}
      </section>
      {selected ? <section className="mt-6 rounded-xl border border-line bg-surface-panel p-5" aria-label="Selected game detail"><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-ink">{selected.name}</h2><p className="mt-1 text-xs text-slate-500">{selected.publisher} · {selected.store === "ios" ? "iOS" : "Android"} · {selected.genre}</p></div><a href={selected.url} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-cobalt">Open store listing <ArrowUpRight className="h-4 w-4" /></a></div>
        <div className="mb-5 grid gap-3 sm:grid-cols-3">{[["Latest 3-day average",number(selected.evaluation.recentAverage)],["Rule baseline",number(selected.evaluation.baseline)],["Trigger",selected.evaluation.variant?.replaceAll("_"," ") ?? labels[selected.evaluation.signal]]].map(([label,value]) => <div key={label} className="rounded-lg bg-surface-table p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-bold text-ink">{value}</p></div>)}</div>
        {selectedDetail ? <DownloadChart key={detailKey} game={selectedDetail} /> : <div role="status" className="flex h-56 items-center justify-center text-sm text-slate-500">{detailError || "Loading download chart…"}</div>}
        <div className="mt-5 border-t border-line pt-4 text-xs leading-6 text-slate-500"><p>Observed activity: {selected.evaluation.activityDate ?? "Not established"} · Reported release: {selected.releaseDate ?? "Unknown"}{selected.evaluation.releaseAge !== null ? ` (${selected.evaluation.releaseAge} days before t)` : ""}. Release date does not gate detection.</p><p>Combined countries with observations: {selected.availableCountries.map(c => senseCountries[c]).join(", ") || "None"}.</p>{selected.unavailableCountries.length ? <p>No observations in this lookback: {selected.unavailableCountries.map(c => senseCountries[c]).join(", ")}. These countries are omitted from both the recent period and baseline.</p> : null}<p>Data labels: {selected.evaluation.flags.length ? selected.evaluation.flags.map(f => f.replaceAll("_"," ")).join(" · ") : "No additional data flags"} · Retrieved {new Date(selected.retrievedAt).toLocaleString()}.</p></div>
      </section> : null}
      <p className="my-6 max-w-3xl text-xs leading-6 text-slate-500">Research the gameplay, core mechanics, differentiation, and recent updates. Download growth does not establish organic demand, retention, or commercial success. Thresholds remain provisional. A breakout in one market can be diluted by flat volume elsewhere.</p>
    </> : null}
  </CerberusShell>;
}
