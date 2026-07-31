"use client";

import { AlertTriangle, CheckCircle2, RefreshCw, X, XCircle } from "lucide-react";
import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import CerberusShell from "@/components/CerberusShell";
import { FunnelDateRangePicker, FunnelFilterDropdown, FunnelMultiSelect, FunnelVersionMultiSelect } from "@/components/LevelFunnelControls";

const appOptions = [
  "blockkingdom", "bloomsort", "bubblego", "bubblewordchain", "dotpaint", "hexago", "jelly", "mahjongbloom", "marble",
  "sizzle", "stacksmash", "treasureshot", "tripletile", "wooblast", "woodoku", "wordblast", "wordoku", "wordrush",
] as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const levelFunnelPendingJobStorageKey = "tech-launch:level-funnel:pending-count-job";
const slowQueryAfterMs = 45_000;

type Filters = {
  appName: string;
  platforms: Array<"android" | "ios">;
  appVersions: string[];
  startDate: string;
  endDate: string;
};

type AccessResponse = {
  authenticated: boolean;
  user?: { role: "admin" | "editor" | "viewer" } | null;
  access: { techLaunchApps: string[] } | null;
};

type AppVersionsResponse = { versions: Array<{ appVersion: string; sampleCount: number }> };

type GameplayAlertSettings = {
  normalThreshold: number;
  hardThreshold: number;
  minPlayers: number;
  alertTargets: GameplayAlertTarget[];
  updatedAt?: string;
};

type GameplayAlertTarget = {
  appName: typeof appOptions[number];
  platforms: Array<"android" | "ios">;
  appVersion: string;
};

type LevelFailRatePoint = {
  level: number;
  levelId?: string;
  layoutBankId: string;
  layoutShare: number;
  layoutCoverage: number;
  layoutAgeHours: number;
  layoutStable: boolean;
  layoutUpdatePending: boolean;
  pendingLayoutBankId?: string;
  pendingLayoutShare?: number;
  pendingLayoutRecentPlayers?: number;
  pendingLayoutAgeHours?: number;
  previousAlert?: {
    layoutBankId?: string;
    failRate: number;
    reachedPlayers: number;
    threshold: number;
  };
  previousBankAssessment?: {
    layoutBankId: string;
    difficultyTier: "normal" | "hard";
    failRate: number;
    reachedPlayers: number;
    threshold: number;
  };
  difficultyTier: "normal" | "hard";
  usedDifficultyFallback: boolean;
  reachedPlayers: number;
  failedPlayers: number;
  failRate: number;
  threshold: number;
  eligible: boolean;
  breached: boolean;
};

type LevelFailRateResponse = {
  status: "completed" | "unavailable";
  filters: Filters;
  settings: GameplayAlertSettings;
  points: LevelFailRatePoint[];
  summary: { breachCount: number; eligibleLevelCount: number; unavailableReason?: string };
  metadata: { executedAt: string; durationMs?: number };
};

type LevelFailRatePendingResponse = {
  status: "running";
  filters: Filters;
  settings: GameplayAlertSettings;
  metadata: { jobKey: string; submittedAt: string };
  pollAfterMs: number;
};

type LevelFailRateRunResponse = LevelFailRateResponse | LevelFailRatePendingResponse;

type PendingLevelFunnelJob = {
  jobKey: string;
  filters: Filters;
  submittedAt: string;
  pollAfterMs: number;
};

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function defaultFilters(): Filters {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  return { appName: "stacksmash", platforms: ["android", "ios"], appVersions: [], startDate: isoDate(start), endDate: isoDate(end) };
}

function isAppName(value: string): value is typeof appOptions[number] {
  return (appOptions as readonly string[]).includes(value);
}

function isDateValue(value: string) {
  return datePattern.test(value);
}

function isPendingLevelFunnelJob(value: unknown): value is PendingLevelFunnelJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<PendingLevelFunnelJob>;
  const filters = job.filters;
  if (!filters) return false;
  return typeof job.jobKey === "string" && Boolean(job.jobKey.trim())
    && typeof job.submittedAt === "string" && Number.isFinite(Date.parse(job.submittedAt))
    && typeof job.pollAfterMs === "number" && Number.isFinite(job.pollAfterMs) && job.pollAfterMs >= 0
    && isAppName(filters.appName ?? "")
    && Array.isArray(filters.platforms) && filters.platforms.length > 0 && filters.platforms.every((platform) => platform === "android" || platform === "ios")
    && Array.isArray(filters.appVersions) && filters.appVersions.every((version) => typeof version === "string")
    && typeof filters.startDate === "string" && isDateValue(filters.startDate)
    && typeof filters.endDate === "string" && isDateValue(filters.endDate)
    && filters.startDate <= filters.endDate;
}

function readPendingLevelFunnelJob(): PendingLevelFunnelJob | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(levelFunnelPendingJobStorageKey);
    if (!stored) return null;
    const job: unknown = JSON.parse(stored);
    if (isPendingLevelFunnelJob(job)) return job;
  } catch {
    // Storage can be unavailable in a private browser context. The live job
    // remains safe in Count; only the convenience of a later resume is lost.
  }
  return null;
}

function persistPendingLevelFunnelJob(job: PendingLevelFunnelJob) {
  try {
    window.sessionStorage.setItem(levelFunnelPendingJobStorageKey, JSON.stringify(job));
  } catch {
    // Keep polling even if this browser cannot persist session state.
  }
}

function clearPendingLevelFunnelJob() {
  try {
    window.sessionStorage.removeItem(levelFunnelPendingJobStorageKey);
  } catch {
    // Nothing else to clean up when storage is unavailable.
  }
}

function formatElapsedTime(elapsedMs: number) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function filtersFromSearchParams(params: URLSearchParams): Filters | null {
  const hasFilterParam = ["appName", "platform", "appVersion", "startDate", "endDate"].some((key) => params.has(key));
  if (!hasFilterParam) return null;

  const next = defaultFilters();
  const appName = params.get("appName");
  const platforms = [...new Set(params.getAll("platform").map((value) => value.trim().toLowerCase()))];
  const appVersions = [...new Set(params.getAll("appVersion").map((value) => value.trim()).filter(Boolean))];
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");
  if (appName && !isAppName(appName)) return null;
  if (appName) next.appName = appName;
  if (platforms.length) {
    if (platforms.some((platform) => platform !== "android" && platform !== "ios")) return null;
    next.platforms = platforms as Filters["platforms"];
  }
  next.appVersions = appVersions;
  if (startDate) {
    if (!isDateValue(startDate)) return null;
    next.startDate = startDate;
  }
  if (endDate) {
    if (!isDateValue(endDate)) return null;
    next.endDate = endDate;
  }
  return next.startDate <= next.endDate ? next : null;
}

function writeFiltersToUrl(filters: Filters, run: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("appName", filters.appName);
  url.searchParams.delete("platform");
  filters.platforms.forEach((platform) => url.searchParams.append("platform", platform));
  url.searchParams.delete("appVersion");
  filters.appVersions.forEach((appVersion) => url.searchParams.append("appVersion", appVersion));
  url.searchParams.set("startDate", filters.startDate);
  url.searchParams.set("endDate", filters.endDate);
  if (run) url.searchParams.set("run", "1");
  else url.searchParams.delete("run");
  window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
}

async function responseMessage(response: Response) {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { error?: string };
    return parsed.error ?? body;
  } catch {
    return body || "Request failed";
  }
}

function AlertSettings({ settings, canManage, onSave }: { settings: GameplayAlertSettings; canManage: boolean; onSave: (value: Pick<GameplayAlertSettings, "normalThreshold" | "hardThreshold" | "minPlayers" | "alertTargets">) => Promise<void> }) {
  const [normal, setNormal] = useState(String(Math.round(settings.normalThreshold * 100)));
  const [hard, setHard] = useState(String(Math.round(settings.hardThreshold * 100)));
  const [minimum, setMinimum] = useState(String(settings.minPlayers));
  const [targets, setTargets] = useState<GameplayAlertTarget[]>(settings.alertTargets);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setNormal(String(Math.round(settings.normalThreshold * 100)));
    setHard(String(Math.round(settings.hardThreshold * 100)));
    setMinimum(String(settings.minPlayers));
    setTargets(settings.alertTargets);
  }, [settings]);

  if (!canManage) return null;
  return (
    <details className="rounded-[9px] border border-line/70 bg-[#0a111e] px-3 py-2 text-xs text-slate-400">
      <summary className="cursor-pointer font-semibold text-slate-300">Alert delivery and thresholds (admin)</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <label><span className="font-mono text-[10px] uppercase text-slate-500">Normal %</span><input aria-label="Normal fail threshold" value={normal} onChange={(event) => setNormal(event.target.value)} type="number" min="0" max="100" className="mt-1 h-8 w-full rounded border border-line bg-[#0d1424] px-2 text-slate-200" /></label>
        <label><span className="font-mono text-[10px] uppercase text-slate-500">Hard %</span><input aria-label="Hard fail threshold" value={hard} onChange={(event) => setHard(event.target.value)} type="number" min="0" max="100" className="mt-1 h-8 w-full rounded border border-line bg-[#0d1424] px-2 text-slate-200" /></label>
        <label><span className="font-mono text-[10px] uppercase text-slate-500">Min players</span><input aria-label="Minimum players" value={minimum} onChange={(event) => setMinimum(event.target.value)} type="number" min="1" className="mt-1 h-8 w-full rounded border border-line bg-[#0d1424] px-2 text-slate-200" /></label>
      </div>
      <div className="mt-4 border-t border-line/60 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Slack alert targets</p><p className="mt-1 text-[11px] text-slate-500">Each target can evaluate one version or aggregate all versions for its game and platforms.</p></div><button type="button" onClick={() => setTargets((current) => [...current, { appName: "stacksmash", platforms: ["android", "ios"], appVersion: "" }])} className="rounded border border-line px-2 py-1 font-semibold text-slate-300 hover:bg-sage">Add target</button></div>
        <div className="mt-3 space-y-2">
          {targets.map((target, index) => <div key={`${target.appName}-${target.appVersion}-${index}`} className="grid gap-2 rounded border border-line/70 bg-[#0d1424] p-2 md:grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_auto_auto] md:items-end">
            <label><span className="font-mono text-[10px] uppercase text-slate-500">Game</span><select aria-label={`Alert game ${index + 1}`} value={target.appName} onChange={(event) => setTargets((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, appName: event.target.value as GameplayAlertTarget["appName"] } : entry))} className="mt-1 h-8 w-full rounded border border-line bg-[#0a111e] px-2 text-slate-200">{appOptions.map((app) => <option key={app} value={app}>{app}</option>)}</select></label>
            <div><label><span className="font-mono text-[10px] uppercase text-slate-500">App version</span><input aria-label={`Alert app version ${index + 1}`} disabled={!target.appVersion} value={target.appVersion} onChange={(event) => setTargets((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, appVersion: event.target.value } : entry))} placeholder={target.appVersion ? "e.g. 0.2.0" : "All versions"} className="mt-1 h-8 w-full rounded border border-line bg-[#0a111e] px-2 text-slate-200 disabled:cursor-not-allowed disabled:opacity-60" /></label><label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400"><input type="checkbox" checked={!target.appVersion} onChange={(event) => setTargets((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, appVersion: event.target.checked ? "" : "0.2.0" } : entry))} />All versions</label></div>
            <fieldset className="mt-1 flex h-8 items-center gap-3 rounded border border-line bg-[#0a111e] px-2"><legend className="sr-only">Platforms for {target.appName}</legend>{(["android", "ios"] as const).map((platform) => <label key={platform} className="flex items-center gap-1.5 text-[11px] text-slate-300"><input type="checkbox" checked={target.platforms.includes(platform)} onChange={(event) => setTargets((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, platforms: event.target.checked ? [...new Set([...entry.platforms, platform])] : entry.platforms.filter((value) => value !== platform) } : entry))} />{platform}</label>)}</fieldset>
            <button type="button" aria-label={`Remove alert target ${index + 1}`} onClick={() => setTargets((current) => current.filter((_, entryIndex) => entryIndex !== index))} className="h-8 rounded border border-rose/30 px-2 font-semibold text-rose hover:bg-rose/10">Remove</button>
          </div>)}
          {!targets.length ? <p className="rounded border border-dashed border-line/70 px-3 py-2 text-[11px] text-slate-500">No Slack targets configured. The scheduled evaluator will not send alerts.</p> : null}
        </div>
      </div>
      <button type="button" disabled={saving} onClick={() => {
        const value = { normalThreshold: Number(normal) / 100, hardThreshold: Number(hard) / 100, minPlayers: Number(minimum), alertTargets: targets.map((target) => ({ ...target, appVersion: target.appVersion.trim() })) };
        if (!Number.isFinite(value.normalThreshold) || !Number.isFinite(value.hardThreshold) || !Number.isInteger(value.minPlayers)) { setMessage("Enter valid thresholds and player count."); return; }
        if (value.alertTargets.some((target) => !target.platforms.length)) { setMessage("Every alert target needs at least one platform."); return; }
        setSaving(true); setMessage("");
        void onSave(value).then(() => setMessage("Saved.")).catch((error) => setMessage(error instanceof Error ? error.message : "Could not save settings.")).finally(() => setSaving(false));
      }} className="mt-4 h-8 rounded bg-cobalt px-3 font-semibold text-white disabled:opacity-60">{saving ? "Saving" : "Save alert configuration"}</button>
      {message ? <p className="mt-2 text-xs text-amber">{message}</p> : null}
    </details>
  );
}

function FailRateChart({ data, loading }: { data: LevelFailRateResponse; loading: boolean }) {
  const points = data.points;
  const breaches = points.filter((point) => point.breached);
  const pendingUpdates = points.filter((point) => point.layoutUpdatePending);
  const pendingRechecks = pendingUpdates.filter((point) => point.previousBankAssessment || point.previousAlert);
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(1000);
  const [selectedPointKey, setSelectedPointKey] = useState<string | null>(null);
  const [hoveredPointKey, setHoveredPointKey] = useState<string | null>(null);
  const xMin = Math.min(...points.map((point) => point.level));
  const xMax = Math.max(...points.map((point) => point.level));
  const pixelsPerLevel = Math.max(7, (viewportWidth - 86) / 100);
  const chartWidth = Math.max(viewportWidth, 96 + (xMax - xMin) * pixelsPerLevel);
  const plotStart = 44;
  const plotEnd = chartWidth - 42;
  const x = (level: number) => plotStart + (level - xMin) * pixelsPerLevel;
  const y = (rate: number) => 180 - rate * 140;
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const referenceRates = Array.from(new Set([0, data.settings.normalThreshold, data.settings.hardThreshold, 1])).sort((first, second) => first - second);
  const isThreshold = (rate: number) => Math.abs(rate - data.settings.normalThreshold) < 0.0001 || Math.abs(rate - data.settings.hardThreshold) < 0.0001;
  const thresholdLabel = (rate: number) => [
    Math.abs(rate - data.settings.normalThreshold) < 0.0001 ? `Normal ${percent(rate)}` : null,
    Math.abs(rate - data.settings.hardThreshold) < 0.0001 ? `Hard ${percent(rate)}` : null,
  ].filter(Boolean).join(" · ");
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.level)},${y(point.failRate)}`).join(" ");
  const pointKey = (point: LevelFailRatePoint) => `${point.level}-${point.layoutBankId}-${point.difficultyTier}`;
  const tickLevels = Array.from({ length: Math.floor((xMax - xMin) / 10) + 1 }, (_, index) => xMin + index * 10).filter((level) => level <= xMax);
  const hoveredPoint = points.find((point) => pointKey(point) === hoveredPointKey) ?? null;
  const hoveredPrevious = hoveredPoint ? hoveredPoint.previousBankAssessment ?? hoveredPoint.previousAlert : null;
  const hoveredTooltipX = hoveredPoint ? Math.max(plotStart, Math.min(plotEnd - 142, x(hoveredPoint.level) - 57)) : 0;
  const hoveredTooltipY = hoveredPoint ? Math.max(8, y(hoveredPoint.failRate) - (hoveredPrevious ? 65 : 49)) : 0;
  const breachGroups = Array.from(breaches.reduce((groups, point) => {
    const group = groups.get(point.layoutBankId) ?? [];
    group.push(point);
    groups.set(point.layoutBankId, group);
    return groups;
  }, new Map<string, LevelFailRatePoint[]>()).entries()).sort(([firstBank], [secondBank]) => firstBank.localeCompare(secondBank, undefined, { numeric: true }));

  useEffect(() => {
    const node = chartScrollRef.current;
    if (!node) return;
    const updateWidth = () => setViewportWidth(Math.max(1, node.clientWidth));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSelectedPointKey((current) => current && points.some((point) => pointKey(point) === current) ? current : null);
  }, [data.metadata.executedAt, points]);

  function focusPoint(point: LevelFailRatePoint) {
    setSelectedPointKey(pointKey(point));
    const container = chartScrollRef.current;
    if (!container) return;
    container.scrollTo({ left: Math.max(0, x(point.level) - container.clientWidth / 2), behavior: "smooth" });
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-line/70 bg-[#0b1120] shadow-soft" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line/60 bg-[#0d1424] px-[18px] py-[15px]">
        <div>
          <div className="flex items-center gap-2"><AlertTriangle className={`h-4 w-4 ${breaches.length ? "text-rose" : pendingRechecks.length ? "text-amber" : "text-emerald"}`} /><h2 className="font-display text-base font-bold text-[#eef1fb]">Level fail rate</h2></div>
          <p className="mt-1 text-xs text-slate-500">Unique players with a loss ÷ unique players who started. Eligibility follows stable, adopted level revisions; unchanged hashes continue across bank changes.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={`rounded-[8px] border px-3 py-2 font-mono text-[11px] ${data.status === "unavailable" ? "border-amber/30 bg-amber/10 text-amber" : breaches.length ? "border-rose/30 bg-rose/10 text-rose" : "border-emerald/30 bg-emerald/10 text-emerald"}`}>{data.status === "unavailable" ? "data unavailable" : `${breaches.length} open breach${breaches.length === 1 ? "" : "es"}`}</span>
          {pendingRechecks.length ? <span className="rounded-[8px] border border-amber/30 bg-amber/10 px-3 py-2 font-mono text-[11px] text-amber">{pendingRechecks.length} pending recheck{pendingRechecks.length === 1 ? "" : "s"}</span> : null}
          {pendingUpdates.length ? <span className="rounded-[8px] border border-line/70 bg-[#0a111e] px-3 py-2 font-mono text-[11px] text-slate-400">{pendingUpdates.length} layout updates</span> : null}
        </div>
      </div>
      {data.status === "unavailable" ? <div className="px-[18px] py-10 text-center text-sm text-amber">{data.summary.unavailableReason ?? "Gameplay alert data is unavailable."}</div> : null}
      {data.status === "completed" && !points.length ? <div className="px-[18px] py-10 text-center text-sm text-slate-500">No gameplay events were found for this filter set.</div> : null}
      {data.status === "completed" && points.length ? <>
        <div className="flex items-center justify-between gap-3 border-b border-line/40 px-[18px] py-2 font-mono text-[10px] text-slate-500"><span>Scroll horizontally to inspect the level timeline</span><span className="shrink-0">100 levels per view</span></div>
        <div ref={chartScrollRef} className="overflow-x-auto overscroll-x-contain px-4 pb-2 pt-5" tabIndex={0} aria-label="Scrollable level fail rate chart">
          <svg viewBox={`0 0 ${chartWidth} 215`} style={{ width: chartWidth, minWidth: chartWidth }} className="h-[230px] max-w-none" role="img" aria-label="Level fail rate line chart">
            {referenceRates.map((rate) => <g key={rate}><line x1={plotStart} x2={plotEnd} y1={y(rate)} y2={y(rate)} stroke={isThreshold(rate) ? "#64748b" : "#263247"} strokeDasharray={isThreshold(rate) ? "4 4" : undefined} /><text x="6" y={y(rate) + 4} fill="#94a3b8" fontSize="10">{percent(rate)}</text>{isThreshold(rate) ? <text x={plotEnd + 7} y={y(rate) + 4} fill={Math.abs(rate - data.settings.hardThreshold) < 0.0001 ? "#c084fc" : "#94a3b8"} fontSize="10">{thresholdLabel(rate)}</text> : null}</g>)}
            {tickLevels.map((level) => <g key={level}><line x1={x(level)} x2={x(level)} y1="184" y2="188" stroke="#64748b" /><text x={x(level)} y="204" textAnchor="middle" fill="#94a3b8" fontSize="10">{level}</text></g>)}
            <path d={path} fill="none" stroke="#60a5fa" strokeWidth="2.5" />
            {points.map((point) => {
              const selected = pointKey(point) === selectedPointKey;
              const previous = point.previousBankAssessment ?? point.previousAlert;
              return <g key={pointKey(point)}>{selected ? <><line x1={x(point.level)} x2={x(point.level)} y1="28" y2="185" stroke="#fbbf24" strokeDasharray="3 3" /><circle cx={x(point.level)} cy={y(point.failRate)} r="10" fill="none" stroke="#fbbf24" strokeWidth="2.5" /></> : null}<circle cx={x(point.level)} cy={y(point.failRate)} r={selected ? "6" : "5"} fill={previous ? "#fbbf24" : point.breached ? "#fb7185" : point.eligible ? "#60a5fa" : "#64748b"} onMouseEnter={() => setHoveredPointKey(pointKey(point))} onMouseLeave={() => setHoveredPointKey((current) => current === pointKey(point) ? null : current)} style={{ cursor: "pointer" }}><title>Level {point.level}{point.levelId ? ` (ID ${point.levelId})` : ""}; current bank {point.layoutBankId}: {percent(point.failRate)} fail rate; threshold {percent(point.threshold)}; {point.reachedPlayers} players reached; {point.failedPlayers} failed; {Math.round(point.layoutShare * 100)}% current-layout share; {Math.round(point.layoutAgeHours)}h active{previous ? `; previous bank ${previous.layoutBankId ?? "legacy"}: ${percent(previous.failRate)} breach, now warming bank ${point.pendingLayoutBankId}` : point.layoutUpdatePending ? `; new layout bank ${point.pendingLayoutBankId} is warming up` : ""}{!point.layoutStable ? "; migration or warm-up pending" : ""}{point.usedDifficultyFallback ? "; difficulty fallback used" : ""}</title></circle></g>;
            })}
            {hoveredPoint ? <g pointerEvents="none"><rect x={hoveredTooltipX} y={hoveredTooltipY} width="142" height={hoveredPrevious ? "53" : "37"} rx="6" fill="#0d1424" stroke="#475569" /><text x={hoveredTooltipX + 8} y={hoveredTooltipY + 15} fill="#e2e8f0" fontSize="11" fontWeight="700">Level {hoveredPoint.level}</text><text x={hoveredTooltipX + 8} y={hoveredTooltipY + 30} fill="#94a3b8" fontSize="10">Current: {percent(hoveredPoint.failRate)} · bank {hoveredPoint.layoutBankId}</text>{hoveredPrevious ? <text x={hoveredTooltipX + 8} y={hoveredTooltipY + 45} fill="#fbbf24" fontSize="10">Previous: {percent(hoveredPrevious.failRate)} · bank {hoveredPrevious.layoutBankId ?? "legacy"}</text> : null}</g> : null}
          </svg>
        </div>
        <div className="border-t border-line/60 px-[18px] py-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Flagged levels</div><p className="mt-1 text-xs text-slate-500">Select a level to bring it into view.</p></div><span className="rounded-md border border-rose/20 bg-rose/10 px-2 py-1 font-mono text-[10px] text-rose">{breaches.length} open · {pendingRechecks.length} pending</span></div>
          {breaches.length || pendingRechecks.length ? <div className="mt-3 space-y-4">{breachGroups.map(([layoutBankId, group]) => <section key={layoutBankId} aria-label={`Layout bank ${layoutBankId} flagged levels`}><div className="flex items-center justify-between border-b border-line/50 pb-2"><div className="flex items-center gap-2"><span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">Assessed layout bank</span><span className="rounded bg-cobalt/10 px-1.5 py-0.5 font-mono text-xs font-bold text-cobalt">{layoutBankId}</span></div><span className="font-mono text-[10px] text-slate-500">{group.length} level{group.length === 1 ? "" : "s"}</span></div><ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{group.map((point) => {
            const selected = pointKey(point) === selectedPointKey;
            const overage = Math.round((point.failRate - point.threshold) * 100);
            return <li key={pointKey(point)}><button type="button" aria-pressed={selected} aria-label={`Focus level ${point.level}${point.levelId ? `, ID ${point.levelId}` : ""} in layout bank ${point.layoutBankId}: ${percent(point.failRate)} failure rate, ${overage} percentage points above threshold, ${new Intl.NumberFormat(undefined, { notation: "compact" }).format(point.reachedPlayers)} players reached`} onClick={() => focusPoint(point)} className={`focus-ring flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${selected ? "border-amber/60 bg-amber/10" : "border-rose/25 bg-rose/10 hover:border-rose/55 hover:bg-rose/15"}`}><span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="font-mono text-[11px] font-bold text-[#eef1fb]">Level {point.level}</span>{point.levelId ? <span className="rounded bg-[#0a111e] px-1 py-0.5 font-mono text-[9px] font-semibold text-slate-400" title={`Payload level_id: ${point.levelId}`}>ID {point.levelId}</span> : null}</span><span className="mt-0.5 block truncate text-[11px] text-slate-400">+{overage} pts · {new Intl.NumberFormat(undefined, { notation: "compact" }).format(point.reachedPlayers)} reached{point.difficultyTier === "hard" ? " · Hard" : ""}</span></span><span className="font-mono text-lg font-bold text-rose">{percent(point.failRate)}</span></button></li>;
          })}</ul></section>)}{pendingRechecks.length ? <section aria-label="Previously flagged levels pending recheck" className="rounded-xl border border-amber/25 bg-amber/5 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-amber">Previous-bank breach · pending recheck</div><p className="mt-1 text-xs text-slate-400">Recomputed from the dominant bank immediately before the updated bank first appeared.</p></div><span className="rounded-md border border-amber/25 bg-amber/10 px-2 py-1 font-mono text-[10px] text-amber">{pendingRechecks.length} level{pendingRechecks.length === 1 ? "" : "s"}</span></div><ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{pendingRechecks.map((point) => { const selected = pointKey(point) === selectedPointKey; const previous = point.previousBankAssessment ?? point.previousAlert!; const remainingHours = Math.max(0, 24 - Math.round(point.pendingLayoutAgeHours ?? 0)); return <li key={pointKey(point)}><button type="button" aria-pressed={selected} aria-label={`Focus previous-bank breach for level ${point.level}; bank ${previous.layoutBankId ?? "legacy"} had ${percent(previous.failRate)} fail rate; bank ${point.pendingLayoutBankId} is pending evaluation`} onClick={() => focusPoint(point)} className={`focus-ring flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${selected ? "border-amber/70 bg-amber/15" : "border-amber/25 bg-[#0d1424] hover:border-amber/55"}`}><span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="font-mono text-[11px] font-bold text-[#eef1fb]">Level {point.level}</span>{point.levelId ? <span className="rounded bg-[#0a111e] px-1 py-0.5 font-mono text-[9px] font-semibold text-slate-400" title={`Payload level_id: ${point.levelId}`}>ID {point.levelId}</span> : null}<span className="rounded bg-amber/15 px-1 py-0.5 font-mono text-[9px] font-bold text-amber">UPDATED</span></span><span className="mt-1 block truncate text-[11px] text-slate-300">{percent(previous.failRate)} on bank {previous.layoutBankId ?? "legacy"} <span className="text-slate-600">→</span> bank {point.pendingLayoutBankId}</span><span className="mt-0.5 block text-[11px] text-slate-500">Evaluating · {remainingHours ? `~${remainingHours}h remaining` : "data pending"}</span></span><span className="font-mono text-sm font-bold text-amber">{percent(previous.failRate)}</span></button></li>; })}</ul></section> : null}</div> : <p className="mt-2 text-xs text-slate-500">No levels breach the configured thresholds. {data.summary.eligibleLevelCount} level(s) have a stable, sufficiently adopted layout bank.</p>}
        </div>
      </> : null}
      {loading ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#050b18]/60"><div className="inline-flex items-center gap-2 rounded-lg border border-line bg-[#0d1424] px-3 py-2 text-sm text-slate-200"><RefreshCw className="h-4 w-4 animate-spin text-cobalt" />Running level check…</div></div> : null}
    </section>
  );
}

export default function LevelFunnelDashboard() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [allowedApps, setAllowedApps] = useState<string[] | null>(null);
  const [role, setRole] = useState<"admin" | "editor" | "viewer">("viewer");
  const [versions, setVersions] = useState<AppVersionsResponse["versions"]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionError, setVersionError] = useState("");
  const [data, setData] = useState<LevelFailRateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryStatus, setQueryStatus] = useState("");
  const [pendingJob, setPendingJob] = useState<PendingLevelFunnelJob | null>(() => readPendingLevelFunnelJob());
  const [queryElapsedMs, setQueryElapsedMs] = useState(0);
  const [accessError, setAccessError] = useState("");
  const [error, setError] = useState("");
  const queryRequestIdRef = useRef(0);
  const hasResumedPendingJobRef = useRef(false);
  const hasReadUrlRef = useRef(false);
  const skipNextUrlSyncRef = useRef(false);
  const [pendingUrlRun, setPendingUrlRun] = useState(false);

  const selectableApps = useMemo(() => allowedApps?.length ? appOptions.filter((app) => allowedApps.includes(app)) : appOptions, [allowedApps]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me").then(async (response) => {
      if (!response.ok) throw new Error(await responseMessage(response));
      return (await response.json()) as AccessResponse;
    }).then((response) => {
      if (cancelled) return;
      const apps = response.authenticated ? response.access?.techLaunchApps ?? [] : [];
      setAllowedApps(apps);
      setRole(response.user?.role ?? "viewer");
      setAccessError(apps.length ? "" : "Your account does not have Launch Readiness access. Contact your Tripledot administrator.");
      if (apps.length) setFilters((current) => apps.includes(current.appName) ? current : { ...current, appName: apps[0], appVersions: [] });
    }).catch((reason) => {
      if (!cancelled) { setAllowedApps([]); setAccessError(reason instanceof Error ? reason.message : "Could not load account access"); }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlFilters = filtersFromSearchParams(params);
    hasReadUrlRef.current = true;
    skipNextUrlSyncRef.current = true;
    if (urlFilters) {
      setFilters(urlFilters);
      if (params.get("run") === "1") setPendingUrlRun(true);
    }
  }, []);

  useEffect(() => {
    if (!pendingJob) {
      setQueryElapsedMs(0);
      return;
    }
    const updateElapsed = () => setQueryElapsedMs(Math.max(0, Date.now() - Date.parse(pendingJob.submittedAt)));
    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(intervalId);
  }, [pendingJob?.jobKey, pendingJob?.submittedAt]);

  useEffect(() => () => { queryRequestIdRef.current += 1; }, []);

  useEffect(() => {
    if (allowedApps && !allowedApps.includes(filters.appName)) return;
    let cancelled = false;
    setVersionsLoading(true);
    setVersionError("");
    void Promise.all(filters.platforms.map(async (platform) => {
      const response = await fetch("/api/tech-launch/app-versions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appName: filters.appName, platform, startDate: filters.startDate, endDate: filters.endDate }) });
      if (!response.ok) throw new Error(await responseMessage(response));
      return (await response.json()) as AppVersionsResponse;
    }))
      .then((results) => {
        if (cancelled) return;
        const merged = new Map<string, number>();
        for (const result of results) for (const version of result.versions) merged.set(version.appVersion, (merged.get(version.appVersion) ?? 0) + version.sampleCount);
        setVersions([...merged.entries()].map(([appVersion, sampleCount]) => ({ appVersion, sampleCount })).sort((first, second) => second.sampleCount - first.sampleCount || second.appVersion.localeCompare(first.appVersion, undefined, { numeric: true })));
      })
      .catch((reason) => { if (!cancelled) { setVersions([]); setVersionError(reason instanceof Error ? reason.message : "Could not load version suggestions"); } })
      .finally(() => { if (!cancelled) setVersionsLoading(false); });
    return () => { cancelled = true; };
  }, [allowedApps, filters.appName, filters.platforms, filters.startDate, filters.endDate]);

  function updateFilters(patch: Partial<Filters>) {
    queryRequestIdRef.current += 1;
    clearPendingLevelFunnelJob();
    setPendingJob(null);
    setFilters((current) => ({ ...current, ...patch }));
    setData(null);
    setError(""); setQueryStatus("");
  }

  function discardPendingJob() {
    clearPendingLevelFunnelJob();
    setPendingJob(null);
    setQueryStatus("");
  }

  function stopWaitingForJob() {
    if (!pendingJob) return;
    queryRequestIdRef.current += 1;
    discardPendingJob();
    setLoading(false);
    setError("");
    setQueryStatus("Stopped waiting for the Count job. It may continue running in Count.");
  }

  async function pollPendingJob(initialJob: PendingLevelFunnelJob, requestId: number) {
    let job = initialJob;
    while (queryRequestIdRef.current === requestId) {
      setQueryStatus(`Count job ${job.jobKey} is running.`);
      await wait(job.pollAfterMs);
      if (queryRequestIdRef.current !== requestId) return false;
      const statusResponse = await fetch("/api/tech-launch/level-fail-rate/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobKey: job.jobKey, filters: job.filters }) });
      if (!statusResponse.ok) throw new Error(await responseMessage(statusResponse));
      const result = (await statusResponse.json()) as LevelFailRateRunResponse;
      if (result.status !== "running") {
        if (queryRequestIdRef.current !== requestId) return false;
        setData(result);
        discardPendingJob();
        return true;
      }
      job = { ...job, pollAfterMs: result.pollAfterMs };
      setPendingJob(job);
      persistPendingLevelFunnelJob(job);
    }
    return false;
  }

  async function resumePendingJob(job = pendingJob) {
    if (!job || !allowedApps?.includes(job.filters.appName)) return;
    const requestId = queryRequestIdRef.current + 1;
    queryRequestIdRef.current = requestId;
    setLoading(true); setError(""); setQueryStatus(`Resuming Count job ${job.jobKey}…`);
    setPendingJob(job);
    persistPendingLevelFunnelJob(job);
    try {
      await pollPendingJob(job, requestId);
    } catch (reason) {
      if (queryRequestIdRef.current === requestId) {
        setError(reason instanceof Error ? reason.message : "Could not resume the level funnel check");
        setQueryStatus(`Could not reach Count. Job ${job.jobKey} is saved so you can resume polling.`);
      }
    } finally {
      if (queryRequestIdRef.current === requestId) setLoading(false);
    }
  }

  async function runCheck(forceRefresh = false) {
    if (!allowedApps?.includes(filters.appName)) return;
    const requestId = queryRequestIdRef.current + 1;
    queryRequestIdRef.current = requestId;
    const filterSnapshot = { ...filters };
    discardPendingJob();
    writeFiltersToUrl(filterSnapshot, true);
    setLoading(true); setError(""); setQueryStatus(forceRefresh ? "Submitting a fresh Count query…" : "Submitting the Count query…");
    try {
      const response = await fetch("/api/tech-launch/level-fail-rate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...filterSnapshot, forceRefresh }) });
      if (!response.ok) throw new Error(await responseMessage(response));
      let result = (await response.json()) as LevelFailRateRunResponse;
      if (result.status === "running") {
        const job: PendingLevelFunnelJob = { jobKey: result.metadata.jobKey, filters: result.filters, submittedAt: result.metadata.submittedAt, pollAfterMs: result.pollAfterMs };
        setPendingJob(job);
        persistPendingLevelFunnelJob(job);
        await pollPendingJob(job, requestId);
        return;
      }
      if (queryRequestIdRef.current === requestId) { setData(result); setQueryStatus(""); }
    } catch (reason) {
      if (queryRequestIdRef.current === requestId) {
        setError(reason instanceof Error ? reason.message : "Could not run level funnel check");
        setQueryStatus(pendingJob ? `Could not reach Count. The current job is saved so you can resume polling.` : "");
      }
    } finally {
      if (queryRequestIdRef.current === requestId) setLoading(false);
    }
  }

  useEffect(() => {
    if (hasResumedPendingJobRef.current || allowedApps === null) return;
    const savedJob = readPendingLevelFunnelJob();
    if (!savedJob) { hasResumedPendingJobRef.current = true; return; }
    if (!allowedApps.includes(savedJob.filters.appName)) { discardPendingJob(); hasResumedPendingJobRef.current = true; return; }
    hasResumedPendingJobRef.current = true;
    setFilters(savedJob.filters);
    writeFiltersToUrl(savedJob.filters, true);
    void resumePendingJob(savedJob);
  }, [allowedApps]);

  useEffect(() => {
    if (!pendingUrlRun || allowedApps === null || !allowedApps.includes(filters.appName)) return;
    // A persisted job takes precedence over a stale `run=1` URL marker. The
    // marker describes intent to run, whereas the saved Count key lets us
    // continue the already-billed query instead of submitting a duplicate.
    if (pendingJob) { setPendingUrlRun(false); return; }
    setPendingUrlRun(false);
    void runCheck();
  }, [allowedApps, pendingJob, pendingUrlRun]);

  useEffect(() => {
    if (!hasReadUrlRef.current || pendingUrlRun) return;
    if (skipNextUrlSyncRef.current) {
      skipNextUrlSyncRef.current = false;
      return;
    }
    writeFiltersToUrl(filters, false);
  }, [filters, pendingUrlRun]);

  async function saveSettings(value: Pick<GameplayAlertSettings, "normalThreshold" | "hardThreshold" | "minPlayers" | "alertTargets">) {
    const response = await fetch("/api/tech-launch/gameplay-alert-settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    if (!response.ok) throw new Error(await responseMessage(response));
    const settings = (await response.json()) as GameplayAlertSettings;
    setData((current) => current ? {
      ...current,
      settings,
      points: current.points.map((point) => { const threshold = point.difficultyTier === "hard" ? settings.hardThreshold : settings.normalThreshold; return { ...point, threshold, breached: point.eligible && point.failRate >= threshold }; }),
      summary: { ...current.summary, breachCount: current.points.filter((point) => point.eligible && point.failRate >= (point.difficultyTier === "hard" ? settings.hardThreshold : settings.normalThreshold)).length },
    } : current);
  }

  const breachCount = data?.summary.breachCount ?? 0;
  const alertUnavailable = data?.status === "unavailable";
  const slowQuery = Boolean(pendingJob && queryElapsedMs >= slowQueryAfterMs);
  return (
    <CerberusShell currentProduct="tech-launch" activeLaunchSection="level-funnel" collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)} contentClassName="max-w-[1320px]">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div><div className="font-mono text-[11px] font-semibold uppercase tracking-[0.13em] text-cobalt">Launch Readiness · Level Funnel Check</div><h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-[#eef1fb]">Level Funnel Check</h1><p className="mt-2 max-w-2xl text-sm text-slate-500">Monitor player failure rates by level and alert only on stable, sufficiently adopted layout banks.</p></div>
        <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${alertUnavailable ? "border-amber/30 bg-amber/10 text-amber" : data ? breachCount ? "border-rose/30 bg-rose/10 text-rose" : "border-emerald/30 bg-emerald/10 text-emerald" : "border-line/70 bg-[#0a111e] text-slate-400"}`}>{alertUnavailable ? <XCircle className="h-4 w-4" /> : data ? breachCount ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{alertUnavailable ? "Gameplay data unavailable" : data ? `${breachCount} open alert${breachCount === 1 ? "" : "s"}` : "Awaiting a level check"}</div>
      </header>

      {accessError ? <div className="mb-5 rounded-[10px] border border-rose/30 bg-rose/10 px-4 py-3 text-sm font-semibold text-rose">{accessError}</div> : null}
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); void runCheck(); }} className="mb-5 rounded-2xl border border-line/70 bg-[#0b1120] p-4 shadow-soft">
        <div className="grid items-start gap-[14px] md:grid-cols-2 xl:grid-cols-[minmax(150px,1fr)_130px_160px_300px_auto_auto]">
          <FunnelFilterDropdown label="App" value={filters.appName} options={selectableApps.map((app) => ({ value: app, label: app }))} onChange={(appName) => updateFilters({ appName, appVersions: [] })} disabled={!allowedApps?.length} />
          <FunnelMultiSelect label="Platform" values={filters.platforms} options={[{ value: "android", label: "android" }, { value: "ios", label: "ios" }]} onChange={(platforms) => updateFilters({ platforms, appVersions: [] })} emptyLabel="Select platform" required />
          <FunnelVersionMultiSelect values={filters.appVersions} options={versions} loading={versionsLoading} error={versionError} onChange={(appVersions) => updateFilters({ appVersions })} />
          <FunnelDateRangePicker startDate={filters.startDate} endDate={filters.endDate} onChange={(range) => updateFilters(range)} />
          <button type="submit" disabled={loading || !allowedApps?.length} className="focus-ring mt-[18px] inline-flex h-10 items-center justify-center gap-2 rounded-[8px] bg-cobalt px-4 text-sm font-bold text-white hover:bg-cobalt/90 disabled:cursor-not-allowed disabled:opacity-50">{loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}{loading ? "Running…" : "Run"}</button>
          <button type="button" onClick={() => void runCheck(true)} disabled={loading || !allowedApps?.length} className="focus-ring mt-[18px] inline-flex h-10 items-center gap-2 rounded-[8px] border border-line/70 bg-[#0a111e] px-4 text-sm font-semibold text-slate-300 hover:bg-sage disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
        </div>
        <p className="mt-4 border-t border-line/60 pt-4 text-xs text-slate-500">A new level hash pauses only that changed level while it is adopted; unchanged levels continue normally across bank changes.</p>
        {pendingJob ? <div role="status" className={`mt-3 rounded-lg border px-3 py-2 text-xs ${slowQuery ? "border-amber/40 bg-amber/10 text-amber" : "border-cobalt/30 bg-cobalt/10 text-slate-300"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{slowQuery ? "Slow Count query — still running" : "Count query running"}</span><div className="flex items-center gap-2"><span className="font-mono">Elapsed: {formatElapsedTime(queryElapsedMs)}</span><button type="button" onClick={stopWaitingForJob} title="Stops polling in this dashboard; the Count job may continue running." className="focus-ring inline-flex items-center gap-1 rounded border border-rose/45 bg-rose/10 px-2 py-1 text-[11px] font-semibold text-rose hover:bg-rose/20"><X className="h-3.5 w-3.5" aria-hidden="true" />Stop waiting</button></div></div>
          <p className="mt-1 font-mono text-[11px] text-slate-400">Count job key: <span className="select-all text-slate-200">{pendingJob.jobKey}</span></p>
          {slowQuery ? <p className="mt-2 text-[11px] leading-5 text-amber">This query is taking longer than usual, but Count is still processing it. You can leave this page and return later; this job will be resumed instead of submitted again.</p> : <p className="mt-1 text-[11px] text-slate-500">The result will appear automatically when Count finishes.</p>}
          {!loading ? <button type="button" onClick={() => void resumePendingJob()} className="focus-ring mt-2 rounded border border-current/40 px-2 py-1 text-[11px] font-semibold hover:bg-white/5">Resume polling</button> : null}
        </div> : null}
        {queryStatus && !pendingJob ? <p className="mt-2 text-xs font-medium text-cobalt">{queryStatus}</p> : null}
      </form>

      {error ? <div className="mb-5 rounded-[10px] border border-rose/30 bg-rose/10 px-4 py-3 text-sm font-semibold text-rose">{error}</div> : null}
      {data ? <div className="space-y-4"><FailRateChart data={data} loading={loading} />{role === "admin" ? <div className="rounded-2xl border border-line/70 bg-[#0b1120] p-4 shadow-soft"><div className="mb-3 text-sm font-bold text-[#eef1fb]">Alert configuration</div><AlertSettings settings={data.settings} canManage onSave={saveSettings} /></div> : null}<p className="text-right font-mono text-[10px] text-slate-500">Query freshness: {new Date(data.metadata.executedAt).toLocaleString()}</p></div> : !loading && !accessError ? <div className="rounded-2xl border border-dashed border-line/70 bg-[#0b1120]/70 px-6 py-14 text-center text-sm text-slate-500">Select filters, then run the check to view level fail-rate alerts.</div> : null}
    </CerberusShell>
  );
}
