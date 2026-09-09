"use client";

import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import React, { FormEvent, useEffect, useState } from "react";

import CerberusShell from "@/components/CerberusShell";
import { FunnelFilterDropdown } from "@/components/LevelFunnelControls";
import type { AdjustEventMatch, AdjustEventsCheckResult } from "@/lib/adjust-events";

type AccessResponse = {
  authenticated: boolean;
  access: {
    techLaunchApps: string[];
  } | null;
};

const savedResultKey = "adjust-events-check-result:v1";

function responseMessage(response: Response) {
  return response.json()
    .then((body: { error?: string }) => body.error || `Request failed (${response.status})`)
    .catch(() => `Request failed (${response.status})`);
}

function isEventMatch(value: unknown): value is AdjustEventMatch {
  if (!value || typeof value !== "object") return false;
  const match = value as Partial<AdjustEventMatch>;
  return (match.matchedField === "id" || match.matchedField === "name")
    && typeof match.matchedValue === "string"
    && (match.id === undefined || typeof match.id === "string")
    && (match.name === undefined || typeof match.name === "string")
    && (match.shortName === undefined || typeof match.shortName === "string")
    && (match.section === undefined || typeof match.section === "string");
}

function readSavedResult() {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(savedResultKey) ?? "null");
    if (!value || typeof value !== "object") return null;
    const result = value as Partial<AdjustEventsCheckResult>;
    if (result.status !== "completed" || typeof result.appName !== "string" || (result.platform !== "android" && result.platform !== "ios") || typeof result.checkedAt !== "string" || (result.overallStatus !== "pass" && result.overallStatus !== "fail") || !Array.isArray(result.checks) || !result.journeyMilestones) return null;
    const checksValid = result.checks.every((check) => check && typeof check === "object" && typeof check.expected === "string" && Array.isArray(check.acceptedNames) && check.acceptedNames.every((name) => typeof name === "string") && (check.status === "detected" || check.status === "missing") && Array.isArray(check.matches) && check.matches.every(isEventMatch) && Array.isArray(check.nearMatches) && check.nearMatches.every(isEventMatch));
    const journey = result.journeyMilestones;
    const milestonesValid = Array.isArray(journey.milestones) && journey.milestones.every((milestone) => isEventMatch(milestone) && typeof milestone.level === "number");
    return checksValid && (journey.status === "detected" || journey.status === "missing") && milestonesValid && Array.isArray(journey.nearMatches) && journey.nearMatches.every(isEventMatch) ? result as AdjustEventsCheckResult : null;
  } catch {
    return null;
  }
}

function saveResult(result: AdjustEventsCheckResult | null) {
  try {
    if (result) window.sessionStorage.setItem(savedResultKey, JSON.stringify(result));
    else window.sessionStorage.removeItem(savedResultKey);
  } catch {
    // Session storage can be disabled or unavailable in private browsing.
  }
}

function MatchList({ matches, title, maxItems = 5 }: { matches: AdjustEventMatch[]; title: string; maxItems?: number }) {
  if (!matches.length) return null;
  const visibleMatches = matches.slice(0, maxItems);
  return (
    <div className="mt-3 rounded-lg border border-line/60 bg-surface-panel/60 px-3 py-2">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</p>
      <ul className="mt-1.5 space-y-1 text-xs text-slate-300">
        {visibleMatches.map((match) => (
          <li key={`${match.matchedField}-${match.matchedValue}-${match.id ?? ""}-${match.name ?? ""}`}>
            <span className="font-mono text-cobalt">{match.matchedValue}</span>
            {match.id && match.id !== match.matchedValue ? <span className="text-slate-500"> · id: {match.id}</span> : null}
            {match.name && match.name !== match.matchedValue ? <span className="text-slate-500"> · name: {match.name}</span> : null}
          </li>
        ))}
      </ul>
      {matches.length > visibleMatches.length ? <p className="mt-2 text-[11px] text-slate-500">+{matches.length - visibleMatches.length} more variants</p> : null}
    </div>
  );
}

function StatusPill({ status }: { status: "detected" | "missing" }) {
  const detected = status === "detected";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold ${detected ? "border-emerald/30 bg-emerald/10 text-emerald" : "border-rose/30 bg-rose/10 text-rose"}`}>
      {detected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {detected ? "Detected" : "Missing"}
    </span>
  );
}

export default function AdjustEventsCheckDashboard() {
  const [allowedApps, setAllowedApps] = useState<string[] | null>(null);
  const [appName, setAppName] = useState("");
  const [platform, setPlatform] = useState<"android" | "ios">("android");
  const [showAllMilestones, setShowAllMilestones] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AdjustEventsCheckResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me")
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        return (await response.json()) as AccessResponse;
      })
      .then((response) => {
        if (cancelled) return;
        const apps = response.access?.techLaunchApps ?? [];
        const savedResult = readSavedResult();
        const validSavedResult = savedResult && apps.includes(savedResult.appName) ? savedResult : null;
        setAllowedApps(apps);
        setAppName((current) => validSavedResult?.appName ?? (apps.includes(current) ? current : apps[0] ?? ""));
        setPlatform(validSavedResult?.platform ?? "android");
        setResult(validSavedResult);
        setStorageReady(true);
      })
      .catch((reason) => {
        if (!cancelled) {
          setAllowedApps([]);
          setError(reason instanceof Error ? reason.message : "Could not load available apps");
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (storageReady) saveResult(result);
  }, [result, storageReady]);

  const summary = result ? {
    detected: result.checks.filter((check) => check.status === "detected").length + (result.journeyMilestones.status === "detected" ? 1 : 0),
    total: result.checks.length + 1,
  } : null;
  const appOptions = allowedApps?.length
    ? allowedApps.map((app) => ({ value: app, label: app }))
    : [{ value: "", label: allowedApps ? "No apps available" : "Loading apps…" }];
  const milestonePreview = result?.journeyMilestones.milestones.slice(0, 16) ?? [];
  const visibleMilestones = showAllMilestones ? result?.journeyMilestones.milestones ?? [] : milestonePreview;

  async function run() {
    if (!appName) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/tech-launch/adjust-events-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appName, platform }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setResult((await response.json()) as AdjustEventsCheckResult);
      setShowAllMilestones(false);
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : "Could not run Adjust Events Check");
    } finally {
      setLoading(false);
    }
  }

  return (
    <CerberusShell currentProduct="tech-launch" activeLaunchSection="adjust-events-check" contentClassName="max-w-[1160px]">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.13em] text-cobalt">Launch Readiness · Adjust Events Check</div>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink">Adjust Events Check</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">Confirm that required launch events are visible for the selected app and platform in Adjust. This validates Adjust visibility, not recent event delivery volume.</p>
        </div>
        <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${result?.overallStatus === "pass" ? "border-emerald/30 bg-emerald/10 text-emerald" : result ? "border-rose/30 bg-rose/10 text-rose" : "border-line/70 bg-surface-panel text-slate-400"}`}>
          {result?.overallStatus === "pass" ? <CheckCircle2 className="h-4 w-4" /> : result ? <AlertTriangle className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          {result?.overallStatus === "pass" ? "All required events detected" : result ? "Events need attention" : "Awaiting a check"}
        </div>
      </header>

      <form onSubmit={(event: FormEvent) => { event.preventDefault(); void run(); }} className="mb-5 rounded-2xl border border-line/70 bg-surface-card p-4 shadow-soft">
        <div className="grid items-start gap-[14px] md:grid-cols-[minmax(220px,1fr)_150px_auto]">
          <FunnelFilterDropdown label="App" value={appName} options={appOptions} onChange={(nextApp) => { setAppName(nextApp); setResult(null); setShowAllMilestones(false); }} disabled={!allowedApps?.length || loading} />
          <FunnelFilterDropdown label="Platform" value={platform} options={[{ value: "android", label: "android" }, { value: "ios", label: "ios" }]} onChange={(nextPlatform) => { setPlatform(nextPlatform); setResult(null); setShowAllMilestones(false); }} disabled={loading} />
          <button type="submit" disabled={!appName || loading} className="focus-ring inline-flex h-[42px] items-center justify-center gap-2 rounded-[8px] bg-cobalt px-5 text-sm font-bold text-white hover:bg-cobalt/90 disabled:cursor-not-allowed disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Checking…" : "Run check"}
          </button>
        </div>
        <p className="mt-3 border-t border-line/60 pt-3 text-xs text-slate-500">Runs live against Adjust each time. Event names must match exactly, including capitalization; likely variants are shown as near matches.</p>
      </form>

      {error ? <div role="alert" className="mb-5 rounded-[10px] border border-rose/30 bg-rose/10 px-4 py-3 text-sm font-semibold text-rose">{error}</div> : null}

      {result && summary ? (
        <div className="space-y-5">
          <section className={`rounded-2xl border p-4 ${result.overallStatus === "pass" ? "border-emerald/30 bg-emerald/5" : "border-rose/30 bg-rose/5"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-ink">{summary.detected} of {summary.total} required checks detected</h2>
                <p className="mt-1 text-xs text-slate-500">Checked {new Date(result.checkedAt).toLocaleString()} for {result.appName} · {result.platform}.</p>
              </div>
              <span className={`font-mono text-xs font-bold uppercase ${result.overallStatus === "pass" ? "text-emerald" : "text-rose"}`}>{result.overallStatus}</span>
            </div>
          </section>

          <section aria-label="Required Adjust events" className="grid gap-3 md:grid-cols-3">
            {result.checks.map((check) => (
              <article key={check.expected} className="rounded-2xl border border-line/70 bg-surface-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-mono text-xs font-bold text-ink">{check.expected}</p><p className="mt-1 text-xs text-slate-500">{check.acceptedNames.length > 1 ? `Accepts ${check.acceptedNames.join(" or ")}` : "Exact event name"}</p></div>
                  <StatusPill status={check.status} />
                </div>
                <MatchList matches={check.matches} title="Adjust matches" />
                <MatchList matches={check.nearMatches} title="Near matches — not counted" />
              </article>
            ))}
          </section>

          <section aria-label="Journey level milestones" className="rounded-2xl border border-line/70 bg-surface-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="font-display text-lg font-bold text-ink">Journey level milestones</h2><p className="mt-1 text-sm text-slate-500">Each detected event is a level-complete checkpoint: <span className="font-mono">Journey_Level_WonX</span>, where X is the level number.</p></div>
              <StatusPill status={result.journeyMilestones.status} />
            </div>
            {result.journeyMilestones.milestones.length ? (
              <div className="mt-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-line/60 bg-surface-panel/60 px-3 py-2"><p className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">Checkpoints found</p><p className="mt-1 font-display text-xl font-bold text-ink">{result.journeyMilestones.milestones.length}</p></div>
                  <div className="rounded-lg border border-line/60 bg-surface-panel/60 px-3 py-2"><p className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">First checkpoint</p><p className="mt-1 font-display text-xl font-bold text-ink">Level {result.journeyMilestones.milestones[0]?.level}</p></div>
                  <div className="rounded-lg border border-line/60 bg-surface-panel/60 px-3 py-2"><p className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">Highest checkpoint</p><p className="mt-1 font-display text-xl font-bold text-ink">Level {result.journeyMilestones.milestones.at(-1)?.level}</p></div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {visibleMilestones.map((milestone) => <span key={`${milestone.level}-${milestone.matchedValue}`} className="rounded-md border border-cobalt/30 bg-cobalt/10 px-2.5 py-1 font-mono text-xs font-semibold text-cobalt">Level {milestone.level}</span>)}
                </div>
                {result.journeyMilestones.milestones.length > milestonePreview.length ? <button type="button" onClick={() => setShowAllMilestones((current) => !current)} className="focus-ring mt-3 rounded-md border border-line/70 bg-surface-panel px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-sage">{showAllMilestones ? "Show fewer checkpoints" : `Show all ${result.journeyMilestones.milestones.length} checkpoints`}</button> : null}
              </div>
            ) : <p className="mt-4 text-sm text-slate-500">No exact Journey_Level_WonX events were found.</p>}
            <MatchList matches={result.journeyMilestones.nearMatches} title="Near matches — not counted" />
          </section>
        </div>
      ) : !loading && !error ? <div className="rounded-2xl border border-dashed border-line/70 bg-surface-card/70 px-6 py-14 text-center text-sm text-slate-500"><XCircle className="mx-auto mb-3 h-5 w-5 text-slate-500" />Select an app and run the check to view its Adjust event coverage.</div> : null}
    </CerberusShell>
  );
}
