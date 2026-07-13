"use client";

import {
  Activity,
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Gauge,
  RefreshCw,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import CerberusShell from "@/components/CerberusShell";
import { readDashboardSession, writeDashboardSession } from "@/lib/dashboard-session";

const appOptions = [
  "blockkingdom",
  "bloomsort",
  "bubblego",
  "bubblewordchain",
  "dotpaint",
  "hexago",
  "jelly",
  "mahjongbloom",
  "marble",
  "sizzle",
  "tripletile",
  "wooblast",
  "woodoku",
  "wordblast",
  "wordrush",
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

type AppVersionOption = {
  appVersion: string;
  sampleCount: number;
  firstSeen: string;
  lastSeen: string;
};

type AppVersionsResponse = {
  versions: AppVersionOption[];
  cache: {
    hit: boolean;
    key: string;
    expiresAt: string;
  };
};

type TechLaunchSessionSnapshot = {
  filters: Filters;
  data: ReadinessResponse | null;
  statusText: string;
};

const techLaunchSessionKey = "cerberus.tech-launch.snapshot.v1";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const techLabelClass = "mb-2 block font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500";
const techInputClass =
  "focus-ring h-[42px] w-full rounded-[9px] border border-line/70 bg-[#0a111e] px-3 text-sm font-semibold text-slate-300 shadow-none placeholder:font-normal placeholder:text-slate-500";

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + mondayOffset);
  return next;
}

function monthTitle(date: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

function presetRange(days: number) {
  const end = new Date();
  return { startDate: isoDate(addDays(end, -(days - 1))), endDate: isoDate(end) };
}

function defaultFilters(): Filters {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  return {
    appName: "wordblast",
    platform: "android",
    appVersion: "",
    startDate: isoDate(start),
    endDate: isoDate(end),
  };
}

function isAppName(value: string): value is Filters["appName"] {
  return (appOptions as readonly string[]).includes(value);
}

function isPlatform(value: string): value is Filters["platform"] {
  return value === "android" || value === "ios";
}

function isDateValue(value: string) {
  return datePattern.test(value);
}

function filtersFromSearchParams(params: URLSearchParams): Filters | null {
  const hasFilterParam = ["appName", "platform", "appVersion", "startDate", "endDate"].some((key) => params.has(key));
  if (!hasFilterParam) return null;

  const next = defaultFilters();
  const appName = params.get("appName");
  const platform = params.get("platform");
  const appVersion = params.get("appVersion");
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");

  if (appName) {
    if (!isAppName(appName)) return null;
    next.appName = appName;
  }
  if (platform) {
    if (!isPlatform(platform)) return null;
    next.platform = platform;
  }
  if (appVersion?.trim()) next.appVersion = appVersion.trim();
  if (startDate) {
    if (!isDateValue(startDate)) return null;
    next.startDate = startDate;
  }
  if (endDate) {
    if (!isDateValue(endDate)) return null;
    next.endDate = endDate;
  }
  if (next.startDate > next.endDate) return null;
  return next;
}

function writeFiltersToUrl(filters: Filters, run: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("appName", filters.appName);
  url.searchParams.set("platform", filters.platform);
  if (filters.appVersion) {
    url.searchParams.set("appVersion", filters.appVersion);
  } else {
    url.searchParams.delete("appVersion");
  }
  url.searchParams.set("startDate", filters.startDate);
  url.searchParams.set("endDate", filters.endDate);
  if (run) {
    url.searchParams.set("run", "1");
  } else {
    url.searchParams.delete("run");
  }
  window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
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

function verdictOverviewClasses(verdict: Verdict) {
  if (verdict === "green") return "border-emerald/35 bg-[radial-gradient(420px_200px_at_15%_0%,rgba(78,222,163,0.12),transparent_70%),linear-gradient(180deg,#101a2d,#0d1626)] text-emerald";
  if (verdict === "yellow") return "border-amber/35 bg-[radial-gradient(420px_200px_at_15%_0%,rgba(255,185,95,0.12),transparent_70%),linear-gradient(180deg,#101a2d,#0d1626)] text-amber";
  if (verdict === "red") return "border-rose/35 bg-[radial-gradient(420px_200px_at_15%_0%,rgba(255,122,144,0.12),transparent_70%),linear-gradient(180deg,#101a2d,#0d1626)] text-rose";
  return "border-line/70 bg-[linear-gradient(180deg,#101a2d,#0d1626)] text-[#b3c5ff]";
}

function verdictBarTone(verdict: Verdict): "cobalt" | "emerald" | "amber" | "rose" {
  if (verdict === "green") return "emerald";
  if (verdict === "yellow") return "amber";
  if (verdict === "red") return "rose";
  return "cobalt";
}

function verdictColor(verdict: Verdict) {
  if (verdict === "green") return "#4edea3";
  if (verdict === "yellow") return "#ffb95f";
  if (verdict === "red") return "#ff7a90";
  return "#9ca3b8";
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
    <div className="h-1.5 w-full overflow-hidden rounded bg-[#12192a]">
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

function benchmarkComparisonPct(row: MetricRow) {
  const observed = row.higherIsBetter ? row.p50Value : row.p80Value;
  if (observed === null || row.benchmark === null || row.benchmark === 0) return "n/a";
  const ratio = row.higherIsBetter ? observed / row.benchmark : row.benchmark / observed;
  return `${Math.round(ratio * 100)}%`;
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

function ColumnHeader({
  label,
  description,
  tooltipAlign = "left",
}: {
  label: string;
  description: string;
  tooltipAlign?: "left" | "right";
}) {
  const descriptionId = useId();

  return (
    <span
      className="group relative inline-flex cursor-help items-center"
      tabIndex={0}
      aria-describedby={descriptionId}
      style={{ color: "#77819a" }}
    >
      <span className="border-b border-dotted border-slate-500/70">{label}</span>
      <span
        id={descriptionId}
        role="tooltip"
        className={`pointer-events-none absolute top-full z-30 mt-2 w-56 rounded-md border border-line bg-surface-highest px-3 py-2 text-left text-xs font-medium normal-case leading-snug text-ink opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus:opacity-100 ${
          tooltipAlign === "right" ? "right-0" : "left-0"
        }`}
      >
        {description}
      </span>
    </span>
  );
}

function LoadingSpinner({ className = "h-4 w-4" }: { className?: string }) {
  return <RefreshCw className={`${className} animate-spin`} aria-hidden="true" />;
}

function FilterDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <label className="block">
      <span className={techLabelClass}>{label}</span>
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
        }}
      >
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="focus-ring flex h-[42px] w-full items-center justify-between gap-3 rounded-[9px] border border-line/70 bg-[#0a111e] px-3 text-left text-sm font-semibold text-slate-300"
          aria-expanded={isOpen}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </button>
        {isOpen ? (
          <div className="absolute left-0 top-full z-50 mt-2 max-h-72 w-full overflow-y-auto rounded-[9px] border border-line/70 bg-[#0d1424] p-1 shadow-soft">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`focus-ring block w-full rounded-[7px] px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-[#17223a] ${
                  option.value === value ? "bg-emerald/10 text-emerald" : "text-slate-400"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function DateRangePicker({
  startDate,
  endDate,
  onChange,
}: {
  startDate: string;
  endDate: string;
  onChange: (range: Pick<Filters, "startDate" | "endDate">) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseIsoDate(startDate)));
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const presets = [
    { label: "Today", range: () => presetRange(1) },
    { label: "Yesterday", range: () => {
      const yesterday = addDays(new Date(), -1);
      return { startDate: isoDate(yesterday), endDate: isoDate(yesterday) };
    } },
    { label: "Last 3 days", range: () => presetRange(3) },
    { label: "Last 7 days", range: () => presetRange(7) },
    { label: "Last 14 days", range: () => presetRange(14) },
    { label: "Last 30 days", range: () => presetRange(30) },
    { label: "Last 3 months", range: () => {
      const end = new Date();
      return { startDate: isoDate(addMonths(end, -3)), endDate: isoDate(end) };
    } },
    { label: "Last month", range: () => {
      const month = addMonths(new Date(), -1);
      return { startDate: isoDate(startOfMonth(month)), endDate: isoDate(endOfMonth(month)) };
    } },
    { label: "Last week", range: () => {
      const lastWeekStart = addDays(startOfWeek(new Date()), -7);
      return { startDate: isoDate(lastWeekStart), endDate: isoDate(addDays(lastWeekStart, 6)) };
    } },
    { label: "This month", range: () => {
      const today = new Date();
      return { startDate: isoDate(startOfMonth(today)), endDate: isoDate(today) };
    } },
  ];

  function openPicker() {
    setDraftStart(startDate);
    setDraftEnd(endDate);
    setVisibleMonth(startOfMonth(parseIsoDate(startDate)));
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const viewportPadding = 16;
      const width = Math.min(window.innerWidth - viewportPadding * 2, 760);
      const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding));
      setPopoverPosition({ top: rect.bottom + 8, left, width });
    }
    setIsOpen(true);
  }

  function applyPreset(range: Pick<Filters, "startDate" | "endDate">) {
    setDraftStart(range.startDate);
    setDraftEnd(range.endDate);
    setVisibleMonth(startOfMonth(parseIsoDate(range.startDate)));
    onChange(range);
    setIsOpen(false);
  }

  function selectDate(value: string) {
    if (!draftStart || draftEnd) {
      setDraftStart(value);
      setDraftEnd("");
      return;
    }
    if (value < draftStart) {
      setDraftStart(value);
      setDraftEnd(draftStart);
      return;
    }
    setDraftEnd(value);
  }

  function applyDraft() {
    if (!draftStart || !draftEnd) return;
    onChange({ startDate: draftStart, endDate: draftEnd });
    setIsOpen(false);
  }

  function renderMonth(month: Date) {
    const firstDay = startOfMonth(month);
    const startOffset = firstDay.getDay();
    const days = Array.from({ length: endOfMonth(month).getDate() }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1));
    const blanks = Array.from({ length: startOffset }, (_, index) => index);

    return (
      <div className="min-w-[260px] flex-1">
        <div className="mb-4 text-center text-sm font-bold text-ink">{monthTitle(month)}</div>
        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-500">
          {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
            <div key={`${day}-${index}`} className="py-1">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {blanks.map((blank) => (
            <div key={`blank-${blank}`} className="h-9" />
          ))}
          {days.map((day) => {
            const value = isoDate(day);
            const isStart = value === draftStart;
            const isEnd = value === draftEnd;
            const isInRange = draftStart && draftEnd && value > draftStart && value < draftEnd;
            const isToday = value === isoDate(new Date());
            return (
              <button
                key={value}
                type="button"
                onClick={() => selectDate(value)}
                className={`focus-ring h-9 rounded-md text-sm font-semibold transition-colors ${
                  isStart || isEnd
                    ? "bg-cobalt text-white"
                    : isInRange
                      ? "bg-cobalt/20 text-ink"
                      : "bg-sage text-slate-600 hover:bg-cobalt/15 hover:text-ink"
                } ${isToday && !isStart && !isEnd ? "ring-1 ring-cobalt/60" : ""}`}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <span className={techLabelClass}>Date Range</span>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (isOpen) {
            setIsOpen(false);
            return;
          }
          openPicker();
        }}
        className="focus-ring flex h-[42px] w-full items-center justify-between gap-3 rounded-[9px] border border-line/70 bg-[#0a111e] px-3 text-left text-sm text-slate-300"
      >
        <span className="min-w-0 truncate text-sm">
          {startDate} to {endDate}
        </span>
        <CalendarDays className="h-4 w-4 shrink-0 text-white" />
      </button>

      {isOpen && popoverPosition && typeof document !== "undefined"
        ? createPortal(
        <div
          className="fixed z-[100] overflow-hidden rounded-xl border border-line/70 bg-[#0d1424] shadow-soft"
          style={{ top: popoverPosition.top, left: popoverPosition.left, width: popoverPosition.width }}
        >
          <div className="grid max-h-[520px] grid-cols-1 md:grid-cols-[160px_1fr]">
            <div className="border-b border-line/60 bg-[#0a111e] p-3 md:border-b-0 md:border-r">
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset.range())}
                    className="focus-ring rounded-[7px] px-3 py-2 text-left text-sm font-semibold text-slate-400 hover:bg-[#17223a] hover:text-slate-200"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4">
              <div className="mb-4 flex flex-wrap items-center gap-3 text-xs font-bold uppercase text-slate-500">
                <span>Start</span>
                <span className="rounded-[7px] border border-line/70 bg-[#0a111e] px-3 py-2 font-mono text-slate-300">{draftStart || "Select date"}</span>
                <span>End</span>
                <span className="rounded-[7px] border border-line/70 bg-[#0a111e] px-3 py-2 font-mono text-slate-300">{draftEnd || "Select date"}</span>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
                    className="focus-ring flex h-9 w-9 items-center justify-center rounded-[7px] border border-line/70 bg-[#101a2c] text-slate-400 hover:bg-[#17223a] hover:text-slate-200"
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
                    className="focus-ring flex h-9 w-9 items-center justify-center rounded-[7px] border border-line/70 bg-[#101a2c] text-slate-400 hover:bg-[#17223a] hover:text-slate-200"
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                {renderMonth(visibleMonth)}
                {renderMonth(addMonths(visibleMonth, 1))}
              </div>
              <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="focus-ring h-10 rounded-[8px] border border-line/70 bg-[#121b2c] px-4 text-sm font-semibold text-slate-300 hover:bg-[#17223a]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!draftStart || !draftEnd}
                  onClick={applyDraft}
                  className="focus-ring h-10 rounded-md bg-cobalt px-4 text-sm font-semibold text-white hover:bg-cobalt/90 disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
        : null}
    </div>
  );
}

export default function TechLaunchDashboard() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [data, setData] = useState<ReadinessResponse | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [versionOptions, setVersionOptions] = useState<AppVersionOption[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [versionError, setVersionError] = useState("");
  const [versionCacheStatus, setVersionCacheStatus] = useState("");
  const [isVersionMenuOpen, setIsVersionMenuOpen] = useState(false);
  const [pendingUrlRun, setPendingUrlRun] = useState(false);
  const [isSessionStateReady, setIsSessionStateReady] = useState(false);
  const requestIdRef = useRef(0);
  const versionRequestIdRef = useRef(0);
  const hasReadUrlRef = useRef(false);
  const skipNextUrlSyncRef = useRef(false);

  function updateFilters(patch: Partial<Filters>) {
    requestIdRef.current += 1;
    setIsLoading(false);
    setData(null);
    setError("");
    setStatusText("");
    setFilters((current) => ({ ...current, ...patch }));
  }

  async function postReadiness(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as ReadinessApiResponse;
  }

  async function postAppVersions(body: Pick<Filters, "appName" | "platform" | "startDate" | "endDate">) {
    const response = await fetch("/api/tech-launch/app-versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as AppVersionsResponse;
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

  async function loadReadiness(forceRefresh = false, options: { updateUrlRun?: boolean } = {}) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const filterSnapshot = { ...filters };
    if (options.updateUrlRun !== false) writeFiltersToUrl(filterSnapshot, true);
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
        setError(err instanceof Error ? err.message : "Could not load Launch Readiness data");
        setStatusText("");
      }
    } finally {
      if (requestIdRef.current === requestId) setIsLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlFilters = filtersFromSearchParams(new URLSearchParams(window.location.search));
    const sessionSnapshot = readDashboardSession<TechLaunchSessionSnapshot>(techLaunchSessionKey);
    hasReadUrlRef.current = true;
    skipNextUrlSyncRef.current = true;
    if (urlFilters) {
      setFilters(urlFilters);
      if (new URLSearchParams(window.location.search).get("run") === "1") setPendingUrlRun(true);
    } else if (sessionSnapshot) {
      setFilters(sessionSnapshot.filters);
      setData(sessionSnapshot.data);
      setStatusText(sessionSnapshot.statusText);
    }
    setIsSessionStateReady(true);
  }, []);

  useEffect(() => {
    if (!isSessionStateReady) return;
    writeDashboardSession<TechLaunchSessionSnapshot>(techLaunchSessionKey, { filters, data, statusText });
  }, [data, filters, isSessionStateReady, statusText]);

  useEffect(() => {
    if (!hasReadUrlRef.current) return;
    if (pendingUrlRun) return;
    if (skipNextUrlSyncRef.current) {
      skipNextUrlSyncRef.current = false;
      return;
    }
    writeFiltersToUrl(filters, false);
  }, [filters]);

  useEffect(() => {
    const requestId = versionRequestIdRef.current + 1;
    versionRequestIdRef.current = requestId;
    setIsLoadingVersions(true);
    setVersionError("");
    setVersionCacheStatus("");

    void postAppVersions({
      appName: filters.appName,
      platform: filters.platform,
      startDate: filters.startDate,
      endDate: filters.endDate,
    })
      .then((result) => {
        if (versionRequestIdRef.current !== requestId) return;
        setVersionOptions(result.versions);
        setVersionCacheStatus(result.cache.hit ? "Version list loaded from cache" : "Version list refreshed");
      })
      .catch((err) => {
        if (versionRequestIdRef.current !== requestId) return;
        setVersionOptions([]);
        setVersionError(err instanceof Error ? err.message : "Could not load app versions");
      })
      .finally(() => {
        if (versionRequestIdRef.current === requestId) setIsLoadingVersions(false);
      });
  }, [filters.appName, filters.platform, filters.startDate, filters.endDate]);

  const sortedRows = useMemo(() => {
    const rank: Record<Verdict, number> = { red: 0, yellow: 1, "insufficient data": 2, green: 3 };
    return [...(data?.rows ?? [])].sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.metricTitle.localeCompare(b.metricTitle));
  }, [data]);

  const visibleVersionOptions = useMemo(() => {
    const query = filters.appVersion.trim().toLowerCase();
    if (!query) return versionOptions.slice(0, 12);
    const filtered = versionOptions.filter((option) => option.appVersion.toLowerCase().includes(query));
    return filtered.slice(0, 12);
  }, [filters.appVersion, versionOptions]);

  const selectedVersion = versionOptions.find((option) => option.appVersion === filters.appVersion);
  const hasMissingSelectedVersion = Boolean(filters.appVersion && !isLoadingVersions && !selectedVersion);
  const hasTypedVersion = Boolean(filters.appVersion.trim());
  const canRunReadiness = Boolean(hasTypedVersion && !isLoading);

  useEffect(() => {
    if (!pendingUrlRun || !hasTypedVersion) return;
    setPendingUrlRun(false);
    void loadReadiness(false, { updateUrlRun: false });
  }, [pendingUrlRun, hasTypedVersion]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRunReadiness) return;
    void loadReadiness(false);
  }

  return (
    <CerberusShell
      currentProduct="tech-launch"
      collapsed={sidebarCollapsed}
      onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
    >
        <div className="mb-6">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-emerald">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald shadow-[0_0_10px_#4edea3]" />
            Launch Readiness · Readiness
          </div>
          <h1 className="mt-3 font-display text-[34px] font-extrabold leading-none text-[#f4f6ff]">Readiness Dashboard</h1>
          <p className="mt-2 max-w-2xl text-[13.5px] text-slate-500">
            Live Snowflake telemetry via the Count API, cached by filter set for fast repeat loads.
          </p>
        </div>

        <form onSubmit={submit} className="mb-[22px] rounded-[14px] border border-line/70 bg-[#0b1120] p-4 shadow-soft">
          <div className="grid items-start gap-[14px] md:grid-cols-2 xl:grid-cols-[minmax(150px,1fr)_130px_160px_230px_auto_auto]">
            <FilterDropdown
              label="App"
              value={filters.appName as Filters["appName"]}
              options={appOptions.map((app) => ({ value: app, label: app }))}
              onChange={(appName) => updateFilters({ appName })}
            />
            <FilterDropdown
              label="Platform"
              value={filters.platform}
              options={[
                { value: "android", label: "android" },
                { value: "ios", label: "ios" },
              ]}
              onChange={(platform) => updateFilters({ platform })}
            />
            <label className="block">
              <span className={techLabelClass}>App Version</span>
              <div
                className="relative"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setIsVersionMenuOpen(false);
                }}
              >
                <input
                  value={filters.appVersion}
                  onChange={(event) => {
                    updateFilters({ appVersion: event.target.value });
                    setIsVersionMenuOpen(true);
                  }}
                  onFocus={() => setIsVersionMenuOpen(true)}
                  placeholder={isLoadingVersions ? "Type version or wait for suggestions" : "Type or select version"}
                  className={`${techInputClass} font-mono pr-20`}
                  role="combobox"
                  aria-expanded={isVersionMenuOpen}
                  aria-controls="tech-launch-app-version-options"
                />
                {filters.appVersion ? (
                  <button
                    type="button"
                    onClick={() => {
                      updateFilters({ appVersion: "" });
                      setIsVersionMenuOpen(true);
                    }}
                    className="focus-ring absolute right-9 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] text-slate-500 hover:bg-[#17223a] hover:text-slate-200"
                    aria-label="Clear app version"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setIsVersionMenuOpen((open) => !open)}
                  className="focus-ring absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] text-slate-500 hover:bg-[#17223a] hover:text-slate-200"
                  aria-label="Toggle app version suggestions"
                  aria-expanded={isVersionMenuOpen}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${isVersionMenuOpen ? "rotate-180" : ""}`} />
                </button>
                {isVersionMenuOpen ? (
                  <div
                    id="tech-launch-app-version-options"
                    role="listbox"
                    className="absolute left-0 top-full z-50 mt-2 max-h-72 w-full overflow-y-auto rounded-[9px] border border-line/70 bg-[#0d1424] p-1 shadow-soft"
                  >
                    {isLoadingVersions ? (
                      <div className="flex items-center gap-2 px-3 py-3 text-sm font-semibold text-slate-500">
                        <LoadingSpinner />
                        Loading suggestions...
                      </div>
                    ) : visibleVersionOptions.length ? (
                      visibleVersionOptions.map((option) => (
                        <button
                          key={option.appVersion}
                          type="button"
                          role="option"
                          aria-selected={filters.appVersion === option.appVersion}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            updateFilters({ appVersion: option.appVersion });
                            setIsVersionMenuOpen(false);
                          }}
                          className={`focus-ring block w-full rounded-[7px] px-3 py-2 text-left transition-colors hover:bg-[#17223a] ${
                            filters.appVersion === option.appVersion ? "bg-emerald/10 text-emerald" : "text-slate-400"
                          }`}
                        >
                          <span className="block text-sm font-bold text-slate-200">{option.appVersion}</span>
                          <span className="mt-1 block text-xs">
                            {new Intl.NumberFormat(undefined, { notation: "compact" }).format(option.sampleCount)} samples
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-sm text-slate-500">
                        No matching suggestions. You can still run this typed version.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              <p
                title={versionError || hasMissingSelectedVersion ? "Version may not be available for the selected range" : versionCacheStatus}
                className={`mt-1 h-3 truncate font-mono text-[10px] leading-3 ${versionError || hasMissingSelectedVersion ? "text-amber" : "text-slate-500"}`}
              >
                {versionError
                  ? "Suggestions unavailable"
                  : hasMissingSelectedVersion
                    ? "Not found in range"
                    : isLoadingVersions
                      ? "Loading suggestions"
                      : selectedVersion
                        ? `${new Intl.NumberFormat(undefined, { notation: "compact" }).format(selectedVersion.sampleCount)} samples`
                        : versionCacheStatus ? "Suggestions ready" : "Type or select a version"}
              </p>
            </label>
            <DateRangePicker
              startDate={filters.startDate}
              endDate={filters.endDate}
              onChange={(range) => updateFilters(range)}
            />
            <button
              type="submit"
              disabled={!canRunReadiness}
              className="focus-ring mt-[27px] inline-flex h-[42px] items-center justify-center gap-2 rounded-[9px] bg-cobalt px-[18px] text-sm font-semibold text-white shadow-[0_8px_22px_-8px_#3d82ff] hover:bg-cobalt/90 disabled:opacity-60"
            >
              {isLoading ? <LoadingSpinner /> : <Activity className="h-4 w-4" />}
              {isLoading ? "Running" : "Run"}
            </button>
            <button
              type="button"
              disabled={!canRunReadiness}
              onClick={() => void loadReadiness(true)}
              className="focus-ring mt-[27px] inline-flex h-[42px] items-center justify-center gap-2 rounded-[9px] border border-line/70 bg-[#121b2c] px-4 text-sm font-semibold text-text-muted hover:bg-[#17223a] disabled:opacity-60"
            >
              {isLoading ? <LoadingSpinner /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          </div>
        </form>

        {error ? <div className="mb-5 rounded-[10px] border border-rose/30 bg-rose/10 px-4 py-3 text-sm font-semibold text-rose">{error}</div> : null}

        {data ? (
          <>
            <section className="mb-4 grid gap-4 xl:grid-cols-[1.45fr_0.62fr_0.62fr_0.62fr]">
              <div className={`overflow-hidden rounded-2xl border p-6 ${verdictOverviewClasses(data.summary.overallVerdict)}`}>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Overall Verdict</div>
                <div className="mt-4 flex items-center gap-4">
                  <div className={`flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border ${verdictClasses(data.summary.overallVerdict)}`}>
                    {verdictIcon(data.summary.overallVerdict)}
                  </div>
                  <div>
                    <div className="font-display text-[25px] font-extrabold leading-none">{verdictLabel(data.summary.overallVerdict)}</div>
                    <div className="mt-1.5 text-[12.5px] text-slate-500">{data.summary.metricCount} readiness metrics scored</div>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <div className="rounded-[10px] border border-emerald/30 bg-emerald/10 py-2 text-center">
                    <div className="font-display text-xl font-extrabold text-emerald">{data.summary.greenCount}</div>
                    <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500">Go</div>
                  </div>
                  <div className="rounded-[10px] border border-amber/30 bg-amber/10 py-2 text-center">
                    <div className="font-display text-xl font-extrabold text-amber">{data.summary.yellowCount}</div>
                    <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500">Cautious</div>
                  </div>
                  <div className="rounded-[10px] border border-rose/30 bg-rose/10 py-2 text-center">
                    <div className="font-display text-xl font-extrabold text-rose">{data.summary.redCount}</div>
                    <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500">Hold</div>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-line/70 bg-[linear-gradient(180deg,#101a2d,#0d1626)] p-5 shadow-soft">
                <div className="flex items-center justify-between gap-3 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                  Samples <Database className="h-4 w-4 text-cobalt" />
                </div>
                <div className="mt-4 font-display text-[30px] font-extrabold leading-none text-[#f4f6ff]">{new Intl.NumberFormat().format(data.summary.totalSamples)}</div>
                <div className="mt-2 text-xs leading-relaxed text-slate-500">{data.summary.insufficientCount} metric(s) below sample threshold</div>
              </div>
              <div className="rounded-2xl border border-line/70 bg-[linear-gradient(180deg,#101a2d,#0d1626)] p-5 shadow-soft">
                <div className="flex items-center justify-between gap-3 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                  Weakest <AlertTriangle className="h-4 w-4 text-rose" />
                </div>
                <div className="mt-4 text-[19px] font-extrabold leading-tight text-rose">{data.summary.weakestMetric ?? "None"}</div>
                <div className="mt-2 text-xs leading-relaxed text-slate-500">Lowest % within benchmark</div>
              </div>
              <div className="rounded-2xl border border-line/70 bg-[linear-gradient(180deg,#101a2d,#0d1626)] p-5 shadow-soft">
                <div className="flex items-center justify-between gap-3 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                  Cache <RefreshCw className="h-4 w-4 text-emerald" />
                </div>
                <div className="mt-4 font-display text-[30px] font-extrabold leading-none text-emerald">{isLoading ? "Running" : data.cache.hit ? "Hit" : "Fresh"}</div>
                <div className="mt-2 text-xs leading-relaxed text-slate-500">Expires {new Date(data.cache.expiresAt).toLocaleTimeString()}</div>
              </div>
            </section>

            <section className="relative overflow-hidden rounded-2xl border border-line/70 bg-[#0b1120] shadow-soft" aria-busy={isLoading}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 bg-[#0d1424] px-[18px] py-[15px]">
                <div>
                  <h2 className="font-display text-base font-bold text-[#eef1fb]">Readiness Metrics</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Last run {new Date(data.metadata.executedAt).toLocaleString()}
                    {data.metadata.durationMs ? ` · Count duration ${Math.round(data.metadata.durationMs)}ms` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isLoading ? (
                    <div className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-cobalt/40 bg-cobalt/15 px-3 text-sm font-semibold text-cobalt">
                      <LoadingSpinner />
                      {statusText || "Running Count query..."}
                    </div>
                  ) : null}
                  <div className="rounded-[8px] border border-line/70 bg-[#0a111e] px-3 py-2 font-mono text-[11px] text-slate-500">
                    {data.filters.appName} · {data.filters.platform} · {data.filters.appVersion}
                  </div>
                </div>
              </div>

              <div className="relative overflow-x-auto">
                <div className={`transition-opacity ${isLoading ? "opacity-35" : "opacity-100"}`}>
                <table className="min-w-[1180px] w-full text-left text-sm">
                  <thead className="bg-[#0a1120] font-mono text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">
                        <ColumnHeader label="Metric" description="Telemetry metric being evaluated for launch readiness." />
                      </th>
                      <th className="px-4 py-3">
                        <ColumnHeader label="Verdict" description="Readiness call based on the tolerance-adjusted sample share." />
                      </th>
                      <th className="px-4 py-3">
                        <ColumnHeader label="% Within Benchmark*" description="Share of samples passing the benchmark after the tolerance adjustment." />
                      </th>
                      <th className="px-4 py-3">
                        <ColumnHeader label="Benchmark" description="Launch readiness threshold for this metric." />
                      </th>
                      <th className="px-4 py-3">
                        <ColumnHeader label="Median" description="Middle observed value across samples." />
                      </th>
                      <th className="px-4 py-3">
                        <ColumnHeader label="P80" description="80th percentile value; 80% of samples are at or below this value." />
                      </th>
                      <th className="px-4 py-3">
                        <ColumnHeader label="Samples" description="Number of telemetry samples included for this metric." />
                      </th>
                      <th className="px-4 py-3 text-right">
                        <ColumnHeader
                          label="% vs Benchmark"
                          description="How far the observed value is from the benchmark."
                          tooltipAlign="right"
                        />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/40">
                    {sortedRows.map((row) => (
                      <tr key={row.name} className="hover:bg-[#0e1626]">
                        <td className="px-4 py-4">
                          <div className="text-sm font-semibold text-[#eaeefc]">{row.metricTitle}</div>
                          <div className="mt-1 font-mono text-xs text-slate-500">{row.name}</div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-semibold ${verdictClasses(row.verdict)}`}>
                            {verdictIcon(row.verdict)}
                            {verdictLabel(row.verdict)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="min-w-44">
                            <div className={`mb-2 font-mono text-xs ${row.verdict === "green" ? "text-emerald" : row.verdict === "yellow" ? "text-amber" : row.verdict === "red" ? "text-rose" : "text-slate-500"}`}>{pct(row.pctOfSampleWithTolerance)}</div>
                            <Bar
                              value={row.pctOfSampleWithTolerance}
                              tone={verdictBarTone(row.verdict)}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono text-sm text-slate-300">{compactNumber(row.benchmark)}</td>
                        <td className="px-4 py-4 font-mono text-sm text-slate-300">{compactNumber(row.p50Value)}</td>
                        <td className="px-4 py-4 font-mono text-sm text-slate-300">{compactNumber(row.p80Value)}</td>
                        <td className="px-4 py-4">
                          <span
                            className={`font-mono text-sm ${row.numSample < 50 ? "text-amber" : "text-slate-400"}`}
                          >
                            {new Intl.NumberFormat().format(row.numSample)}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right font-mono text-sm" style={{ color: verdictColor(row.verdict) }}>
                          {benchmarkComparisonPct(row)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>

                {isLoading ? (
                  <div className="pointer-events-none absolute inset-0 flex min-h-56 items-center justify-center bg-[#050b18]/70 backdrop-blur-[1px]">
                    <div className="inline-flex items-center gap-3 rounded-[9px] border border-line/70 bg-[#0d1424] px-4 py-3 text-sm font-semibold text-slate-200 shadow-soft">
                      <LoadingSpinner className="h-5 w-5 text-cobalt" />
                      <span>{statusText || "Running Count query..."}</span>
                    </div>
                  </div>
                ) : null}
              </div>

              {!sortedRows.length ? (
                <div className="border-t border-line/60 px-4 py-10 text-center text-sm text-slate-500">
                  No readiness metrics returned for this filter set.
                </div>
              ) : null}
            </section>

            <p className="mt-3 px-[18px] text-[11.5px] text-slate-500">* A 15% tolerance is applied to the benchmark share.</p>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-line/70 bg-[#0b1120] px-4 py-14 text-center text-sm text-slate-500" aria-busy={isLoading}>
            {isLoading ? (
              <div className="flex flex-col items-center gap-3">
                <LoadingSpinner className="h-6 w-6 text-cobalt" />
                <span>{statusText || "Loading Launch Readiness data..."}</span>
              </div>
            ) : (
              "Run the dashboard to load readiness metrics."
            )}
          </div>
        )}
    </CerberusShell>
  );
}
