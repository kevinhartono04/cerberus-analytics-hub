"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Gauge,
  RefreshCw,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { FormEvent, ReactNode, useMemo, useRef, useState } from "react";

const appOptions = [
  "hexago",
  "marble",
  "tripletile",
  "wooblast",
  "woodoku",
  "blockkingdom",
  "bubblego",
  "mahjongbloom",
  "wordblast",
  "jelly",
  "bloomsort",
  "wordrush",
  "sizzle",
  "dotpaint",
  "bubblewordchain",
] as const;

type Verdict = "green" | "yellow" | "red" | "insufficient data";

type Filters = {
  appName: string;
  platform: "android" | "ios";
  appVersion: string;
  startDate: string;
  endDate: string;
};

type MetricRow = {
  name: string;
  metricTitle: string;
  pctOfSample: number | null;
  pctOfSampleWithTolerance: number | null;
  p50Value: number | null;
  p80Value: number | null;
  benchmark: number | null;
  numSample: number;
  verdict: Verdict;
  higherIsBetter: boolean;
};

type ReadinessResponse = {
  status: "completed";
  filters: Filters;
  rows: MetricRow[];
  summary: {
    overallVerdict: Verdict;
    metricCount: number;
    greenCount: number;
    yellowCount: number;
    redCount: number;
    insufficientCount: number;
    totalSamples: number;
    weakestMetric?: string;
  };
  metadata: {
    jobKey?: string;
    durationMs?: number;
    numRows?: number;
    executedAt: string;
  };
  cache: {
    hit: boolean;
    key: string;
    expiresAt: string;
  };
};

type ReadinessPendingResponse = {
  status: "running";
  filters: Filters;
  metadata: {
    jobKey: string;
    submittedAt: string;
  };
  cache: {
    hit: false;
    key: string;
  };
  pollAfterMs: number;
};

type ReadinessApiResponse = ReadinessResponse | ReadinessPendingResponse;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function defaultFilters(): Filters {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  return {
    appName: "wordblast",
    platform: "android",
    appVersion: "1.0.0",
    startDate: isoDate(start),
    endDate: isoDate(end),
  };
}

function pct(value: number | null) {
  if (value === null) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function compactNumber(value: number | null) {
  if (value === null) return "n/a";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value);
}

function verdictLabel(verdict: Verdict) {
  if (verdict === "green") return "Go";
  if (verdict === "yellow") return "Cautious";
  if (verdict === "red") return "Hold";
  return "Insufficient";
}

function verdictClasses(verdict: Verdict) {
  if (verdict === "green") return "border-emerald/40 bg-emerald/15 text-emerald";
  if (verdict === "yellow") return "border-amber/40 bg-amber/15 text-amber";
  if (verdict === "red") return "border-rose/40 bg-rose/15 text-rose";
  return "border-line bg-sage text-slate-500";
}

function verdictBarTone(verdict: Verdict): "cobalt" | "emerald" | "amber" | "rose" {
  if (verdict === "green") return "emerald";
  if (verdict === "yellow") return "amber";
  if (verdict === "red") return "rose";
  return "cobalt";
}

function verdictIcon(verdict: Verdict) {
  if (verdict === "green") return <CheckCircle2 className="h-4 w-4" />;
  if (verdict === "yellow") return <AlertTriangle className="h-4 w-4" />;
  if (verdict === "red") return <XCircle className="h-4 w-4" />;
  return <Database className="h-4 w-4" />;
}

function Bar({ value, tone = "cobalt" }: { value: number | null; tone?: "cobalt" | "emerald" | "amber" | "rose" }) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, value * 100));
  const color =
    tone === "emerald" ? "bg-emerald" : tone === "amber" ? "bg-amber" : tone === "rose" ? "bg-rose" : "bg-cobalt";
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-sage">
      <div className={`h-full rounded ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function MetricComparison({ row }: { row: MetricRow }) {
  const observed = row.higherIsBetter ? row.p50Value : row.p80Value;
  if (observed === null || row.benchmark === null || row.benchmark === 0) return <span className="text-slate-500">n/a</span>;
  const ratio = row.higherIsBetter ? observed / row.benchmark : row.benchmark / observed;
  const clipped = Math.max(0, Math.min(1, ratio));
  return (
    <div className="min-w-36">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>{row.higherIsBetter ? "Median vs benchmark" : "P80 vs benchmark"}</span>
        <span className="font-mono">{Math.round(ratio * 100)}%</span>
      </div>
      <Bar value={clipped} tone={verdictBarTone(row.verdict)} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
          <div className="metric-value mt-2 text-3xl font-bold text-ink">{value}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-sage text-cobalt">{icon}</div>
      </div>
      <div className="mt-3 text-sm text-slate-600">{detail}</div>
    </div>
  );
}

export default function TechLaunchDashboard() {
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [data, setData] = useState<ReadinessResponse | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const requestIdRef = useRef(0);

  async function postReadiness(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as ReadinessApiResponse;
  }

  async function wait(ms: number) {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function pollReadiness(jobKey: string, pollFilters: Filters, firstDelayMs: number, requestId: number) {
    let delayMs = firstDelayMs;
    while (requestIdRef.current === requestId) {
      setStatusText("Count query is still running. Waiting for results...");
      await wait(delayMs);
      if (requestIdRef.current !== requestId) return;

      const result = await postReadiness("/api/tech-launch/readiness/status", {
        jobKey,
        filters: pollFilters,
      });
      if (result.status === "completed") {
        if (requestIdRef.current !== requestId) return;
        setData(result);
        setStatusText(result.cache.hit ? "Loaded from cache" : "Query complete");
        return;
      }
      delayMs = result.pollAfterMs;
    }
  }

  async function loadReadiness(forceRefresh = false) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const filterSnapshot = { ...filters };
    setIsLoading(true);
    setError("");
    setStatusText(forceRefresh ? "Submitting fresh Count query..." : "Checking cache...");
    try {
      const result = await postReadiness("/api/tech-launch/readiness", { ...filterSnapshot, forceRefresh });
      if (result.status === "completed") {
        if (requestIdRef.current !== requestId) return;
        setData(result);
        setStatusText(result.cache.hit ? "Loaded from cache" : "Query complete");
        return;
      }
      setStatusText("Count query submitted. Waiting for results...");
      await pollReadiness(result.metadata.jobKey, result.filters, result.pollAfterMs, requestId);
    } catch (err) {
      if (requestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : "Could not load Tech Launch readiness");
        setStatusText("");
      }
    } finally {
      if (requestIdRef.current === requestId) setIsLoading(false);
    }
  }

  const sortedRows = useMemo(() => {
    const rank: Record<Verdict, number> = { red: 0, yellow: 1, "insufficient data": 2, green: 3 };
    return [...(data?.rows ?? [])].sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.metricTitle.localeCompare(b.metricTitle));
  }, [data]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadReadiness(false);
  }

  return (
    <main className="theme-dark min-h-screen bg-mist">
      <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-cobalt">
              <Gauge className="h-4 w-4" />
              Tech Launch
            </div>
            <h1 className="mt-2 text-3xl font-bold text-ink">Readiness Dashboard</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Live Snowflake telemetry via Count API, cached by filter set for fast repeat loads.
            </p>
          </div>
          <a
            href="/"
            className="focus-ring inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-slate-500 hover:bg-sage hover:text-ink"
          >
            Analytics Hub
          </a>
        </div>

        <form onSubmit={submit} className="mb-5 rounded-lg border border-line bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2 font-bold text-ink">
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_auto_auto]">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-ink">App</span>
              <select
                value={filters.appName}
                onChange={(event) => setFilters((current) => ({ ...current, appName: event.target.value }))}
                className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm shadow-sm"
              >
                {appOptions.map((app) => (
                  <option key={app} value={app}>
                    {app}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-ink">Platform</span>
              <select
                value={filters.platform}
                onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value as Filters["platform"] }))}
                className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm shadow-sm"
              >
                <option value="android">android</option>
                <option value="ios">ios</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-ink">App Version</span>
              <input
                value={filters.appVersion}
                onChange={(event) => setFilters((current) => ({ ...current, appVersion: event.target.value }))}
                className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm shadow-sm"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-ink">Start Date</span>
              <input
                type="date"
                value={filters.startDate}
                onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))}
                className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm shadow-sm"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-ink">End Date</span>
              <input
                type="date"
                value={filters.endDate}
                onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))}
                className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm shadow-sm"
              />
            </label>
            <button
              type="submit"
              disabled={isLoading}
              className="focus-ring mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-cobalt px-4 text-sm font-semibold text-white hover:bg-cobalt/90 disabled:opacity-60"
            >
              <Activity className="h-4 w-4" />
              {isLoading ? "Running" : "Run"}
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => void loadReadiness(true)}
              className="focus-ring mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </form>

        {error ? <div className="mb-5 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

        {data ? (
          <>
            <section className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <SummaryCard
                label="Overall"
                value={verdictLabel(data.summary.overallVerdict)}
                detail={`${data.summary.metricCount} readiness metrics scored`}
                icon={verdictIcon(data.summary.overallVerdict)}
              />
              <SummaryCard
                label="Go"
                value={String(data.summary.greenCount)}
                detail={`${data.summary.yellowCount} cautious, ${data.summary.redCount} hold`}
                icon={<CheckCircle2 className="h-5 w-5" />}
              />
              <SummaryCard
                label="Samples"
                value={new Intl.NumberFormat().format(data.summary.totalSamples)}
                detail={`${data.summary.insufficientCount} metric(s) below sample threshold`}
                icon={<Database className="h-5 w-5" />}
              />
              <SummaryCard
                label="Weakest"
                value={data.summary.weakestMetric ?? "None"}
                detail="Lowest % within benchmark for the worst verdict"
                icon={<AlertTriangle className="h-5 w-5" />}
              />
              <SummaryCard
                label="Cache"
                value={isLoading ? "Running" : data.cache.hit ? "Hit" : "Fresh"}
                detail={`Expires ${new Date(data.cache.expiresAt).toLocaleString()}`}
                icon={<RefreshCw className="h-5 w-5" />}
              />
            </section>

            <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div>
                  <h2 className="font-bold text-ink">Readiness Metrics</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Last run {new Date(data.metadata.executedAt).toLocaleString()}
                    {data.metadata.durationMs ? ` · Count duration ${Math.round(data.metadata.durationMs)}ms` : ""}
                    {isLoading && statusText ? ` · ${statusText}` : ""}
                  </p>
                </div>
                <div className="rounded-md border border-line bg-sage px-3 py-2 font-mono text-xs text-slate-500">
                  {data.filters.appName} · {data.filters.platform} · {data.filters.appVersion}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-sage text-[11px] font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Metric</th>
                      <th className="px-4 py-3">Verdict</th>
                      <th className="px-4 py-3">% Within Benchmark*</th>
                      <th className="px-4 py-3">Benchmark</th>
                      <th className="px-4 py-3">Median</th>
                      <th className="px-4 py-3">P80</th>
                      <th className="px-4 py-3">Samples</th>
                      <th className="px-4 py-3">Benchmark View</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {sortedRows.map((row) => (
                      <tr key={row.name}>
                        <td className="px-4 py-4">
                          <div className="font-semibold text-ink">{row.metricTitle}</div>
                          <div className="mt-1 font-mono text-xs text-slate-500">{row.name}</div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-semibold ${verdictClasses(row.verdict)}`}>
                            {verdictIcon(row.verdict)}
                            {verdictLabel(row.verdict)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="min-w-28">
                            <div className="mb-2 font-mono text-xs">{pct(row.pctOfSampleWithTolerance)}</div>
                            <Bar
                              value={row.pctOfSampleWithTolerance}
                              tone={verdictBarTone(row.verdict)}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono">{compactNumber(row.benchmark)}</td>
                        <td className="px-4 py-4 font-mono">{compactNumber(row.p50Value)}</td>
                        <td className="px-4 py-4 font-mono">{compactNumber(row.p80Value)}</td>
                        <td className="px-4 py-4">
                          <span
                            className={`font-mono ${row.numSample < 50 ? "text-amber" : "text-slate-600"}`}
                          >
                            {new Intl.NumberFormat().format(row.numSample)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <MetricComparison row={row} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!sortedRows.length ? (
                <div className="border-t border-line px-4 py-10 text-center text-sm text-slate-500">
                  No readiness metrics returned for this filter set.
                </div>
              ) : null}
            </section>

            <p className="mt-4 text-sm text-slate-500">* 15% tolerance is applied.</p>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-white px-4 py-14 text-center text-sm text-slate-500">
            {isLoading ? statusText || "Loading Tech Launch readiness..." : "Run the dashboard to load readiness metrics."}
          </div>
        )}
      </div>
    </main>
  );
}
