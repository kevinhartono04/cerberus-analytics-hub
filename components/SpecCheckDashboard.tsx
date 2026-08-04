"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Database,
  Info,
  MessageSquareText,
  RefreshCw,
  SearchCheck,
  XCircle,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
  "stacksmash",
  "treasureshot",
  "tripletile",
  "wooblast",
  "woodoku",
  "wordblast",
  "wordoku",
  "wordrush",
] as const;

const platformOptions = ["all", "android", "ios"] as const;

type Platform = (typeof platformOptions)[number];

type Filters = {
  specId: string;
  appName: string;
  platform: Platform;
  appVersion: string;
  startDate: string;
  endDate: string;
};

type SavedSpecSummary = {
  id: string;
  gameTitle: string;
  genre: string;
  status: string;
  eventCount: number;
  payloadCount: number;
  updatedAt: string;
};

type FindingType =
  | "missing_event"
  | "event_typo"
  | "untracked_event"
  | "missing_payload"
  | "payload_typo"
  | "untracked_payload"
  | "type_mismatch"
  | "enum_value_typo"
  | "enum_unexpected_value"
  | "enum_missing_coverage"
  | "duplicate_spec_payload";

type Severity = "error" | "warning" | "info";

type Finding = {
  type: FindingType;
  severity: Severity;
  eventName: string;
  payloadName?: string;
  specValue?: string;
  observedValue?: string;
  count?: number;
  detail: string;
};

type PayloadReport = {
  specName?: string;
  liveName?: string;
  status: "matched" | "typo" | "missing" | "untracked";
  specType?: string;
  observedType?: string;
  requiredness?: string;
  mandatory?: boolean;
  isEnum?: boolean;
  payloadCount?: number;
  distinctValueCount?: number | null;
  exampleValues?: string[];
  findings: Finding[];
};

type EventReport = {
  specEventName?: string;
  liveEventName?: string;
  source: "event" | "platformAd" | "live-only";
  status: "matched" | "typo" | "missing" | "untracked";
  eventCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  findings: Finding[];
  payloads: PayloadReport[];
};

type Verdict = "pass" | "warnings" | "fail" | "no data";

type Report = {
  summary: {
    verdict: Verdict;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    specEventCount: number;
    liveEventCount: number;
    matchedEventCount: number;
    missingEventCount: number;
    typoEventCount: number;
    untrackedEventCount: number;
    findingCountsByType: Record<FindingType, number>;
  };
  findings: Finding[];
  events: EventReport[];
  truncated: boolean;
};

type CompletedResponse = {
  status: "completed";
  filters: Filters;
  spec: { id: string; gameTitle: string; updatedAt: string };
  report: Report;
  metadata: { jobKey?: string; durationMs?: number; numRows?: number; executedAt: string };
  cache: { hit: boolean; key: string; expiresAt: string };
};

type PendingResponse = {
  status: "running";
  filters: Filters;
  spec: { id: string; gameTitle: string; updatedAt: string };
  metadata: { jobKey: string; submittedAt: string };
  cache: { hit: false; key: string };
  pollAfterMs: number;
};

type ApiResponse = CompletedResponse | PendingResponse;

type AppVersionOption = {
  appVersion: string;
  sampleCount: number;
  firstSeen: string;
  lastSeen: string;
};

type AppVersionsResponse = {
  versions: AppVersionOption[];
  cache: { hit: boolean; key: string; expiresAt: string };
};

type SpecCheckSessionSnapshot = {
  filters: Filters;
  data: CompletedResponse | null;
  statusText: string;
};

const specCheckSessionKey = "cerberus.spec-check.snapshot.v1";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

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
    specId: "",
    appName: "bloomsort",
    platform: "all",
    appVersion: "",
    startDate: isoDate(start),
    endDate: isoDate(end),
  };
}

function isAppName(value: string) {
  return (appOptions as readonly string[]).includes(value);
}

function isPlatform(value: string): value is Platform {
  return (platformOptions as readonly string[]).includes(value);
}

function filtersFromSearchParams(params: URLSearchParams): Filters | null {
  const hasFilterParam = ["specId", "appName", "platform", "appVersion", "startDate", "endDate"].some((key) =>
    params.has(key),
  );
  if (!hasFilterParam) return null;

  const next = defaultFilters();
  const specId = params.get("specId");
  const appName = params.get("appName");
  const platform = params.get("platform");
  const appVersion = params.get("appVersion");
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");

  if (specId?.trim()) next.specId = specId.trim();
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
    if (!datePattern.test(startDate)) return null;
    next.startDate = startDate;
  }
  if (endDate) {
    if (!datePattern.test(endDate)) return null;
    next.endDate = endDate;
  }
  if (next.startDate > next.endDate) return null;
  return next;
}

function writeFiltersToUrl(filters: Filters, run: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (filters.specId) {
    url.searchParams.set("specId", filters.specId);
  } else {
    url.searchParams.delete("specId");
  }
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

function verdictLabel(verdict: Verdict) {
  if (verdict === "pass") return "Pass";
  if (verdict === "warnings") return "Warnings";
  if (verdict === "fail") return "Fail";
  return "No Data";
}

function verdictClasses(verdict: Verdict) {
  if (verdict === "pass") return "border-emerald/40 bg-emerald/15 text-emerald";
  if (verdict === "warnings") return "border-amber/40 bg-amber/15 text-amber";
  if (verdict === "fail") return "border-rose/40 bg-rose/15 text-rose";
  return "border-line/80 bg-surface-hover text-text-muted";
}

function verdictIcon(verdict: Verdict) {
  if (verdict === "pass") return <CheckCircle2 className="h-4 w-4" />;
  if (verdict === "warnings") return <AlertTriangle className="h-4 w-4" />;
  if (verdict === "fail") return <XCircle className="h-4 w-4" />;
  return <Database className="h-4 w-4" />;
}

function severityRank(severity: Severity) {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

function SeverityChip({ severity }: { severity: Severity }) {
  const classes =
    severity === "error"
      ? "border-rose/40 bg-rose/15 text-rose"
      : severity === "warning"
        ? "border-amber/40 bg-amber/15 text-amber"
        : "border-line/80 bg-surface-hover text-text-muted";
  const icon =
    severity === "error" ? (
      <XCircle className="h-3.5 w-3.5" />
    ) : severity === "warning" ? (
      <AlertTriangle className="h-3.5 w-3.5" />
    ) : (
      <Info className="h-3.5 w-3.5" />
    );
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${classes}`}>
      {icon}
      {severity}
    </span>
  );
}

function eventStatusClasses(status: EventReport["status"]) {
  if (status === "matched") return "border-emerald/40 bg-emerald/15 text-emerald";
  if (status === "typo") return "border-rose/40 bg-rose/15 text-rose";
  if (status === "missing") return "border-rose/40 bg-rose/15 text-rose";
  return "border-line/80 bg-surface-hover text-text-muted";
}

function payloadStatusClasses(status: PayloadReport["status"]) {
  return eventStatusClasses(status);
}

type SummaryTone = "neutral" | "emerald" | "amber" | "rose" | "cobalt";

function summaryToneClasses(tone: SummaryTone) {
  if (tone === "emerald") return "bg-emerald/15 text-emerald";
  if (tone === "amber") return "bg-amber/15 text-amber";
  if (tone === "rose") return "bg-rose/15 text-rose";
  if (tone === "cobalt") return "bg-cobalt/15 text-cobalt";
  return "bg-surface-hover text-cobalt";
}

function summaryToneForVerdict(verdict: Verdict): SummaryTone {
  if (verdict === "pass") return "emerald";
  if (verdict === "warnings") return "amber";
  if (verdict === "fail") return "rose";
  return "neutral";
}

function summaryValueClass(tone: SummaryTone) {
  if (tone === "emerald") return "text-emerald";
  if (tone === "amber") return "text-amber";
  if (tone === "rose") return "text-rose";
  if (tone === "cobalt") return "text-cobalt";
  return "text-ink";
}

function overviewVerdictClasses(verdict: Verdict) {
  if (verdict === "pass") return "verdict-overview verdict-overview-emerald border-emerald/35 text-emerald";
  if (verdict === "warnings") return "verdict-overview verdict-overview-amber border-amber/35 text-amber";
  if (verdict === "fail") return "verdict-overview verdict-overview-rose border-rose/35 text-rose";
  return "border-line/70 surface-gradient text-brand-muted";
}

function SpecCheckOverviewCard({
  summary,
  specName,
  appName,
  appVersion,
}: {
  summary: Report["summary"];
  specName: string;
  appName: string;
  appVersion: string;
}) {
  const verdict = summary.verdict;
  const matchedCount = summary.matchedEventCount + summary.typoEventCount;

  return (
    <div className={`rounded-[14px] border p-5 shadow-soft ${overviewVerdictClasses(verdict)}`}>
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#8b93ad" }}>
        Overall Verdict
      </div>
      <div className="mt-4 flex items-center gap-3.5">
        <div className={`flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] border ${verdictClasses(verdict)}`}>
          {verdictIcon(verdict)}
        </div>
        <div className="min-w-0">
          <div className="font-display text-[25px] font-extrabold leading-none">{verdictLabel(verdict)}</div>
          <div className="mt-1.5 truncate text-[12.5px] text-text-subtle">{specName} vs {appName} {appVersion}</div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        <div className="rounded-[10px] border border-rose/30 bg-rose/10 py-2 text-center">
          <div className="font-display text-xl font-extrabold text-rose">{summary.errorCount}</div>
          <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#9b7890" }}>Errors</div>
        </div>
        <div className="rounded-[10px] border border-amber/30 bg-amber/10 py-2 text-center">
          <div className="font-display text-xl font-extrabold text-amber">{summary.warningCount}</div>
          <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#a28a68" }}>Warnings</div>
        </div>
        <div className="rounded-[10px] border border-emerald/30 bg-emerald/10 py-2 text-center">
          <div className="font-display text-xl font-extrabold text-emerald">{matchedCount}/{summary.specEventCount}</div>
          <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#668f81" }}>Matched</div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone?: SummaryTone;
}) {
  return (
    <div className="rounded-[14px] border border-line/70 surface-gradient p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#8b93ad" }}>{label}</div>
          <div className={`metric-value mt-4 text-[30px] font-extrabold leading-none ${summaryValueClass(tone)}`}>{value}</div>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${summaryToneClasses(tone)}`}>{icon}</div>
      </div>
      <div className="mt-2 text-xs leading-relaxed text-text-subtle">{detail}</div>
    </div>
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
  placeholder,
  disabled,
}: {
  label: string;
  value: T | "";
  options: Array<{ value: T; label: string; detail?: string }>;
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <label className="block">
      <span className="mb-2 block font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-subtle">{label}</span>
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
        }}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen((open) => !open)}
          className="focus-ring flex h-11 w-full items-center justify-between gap-3 rounded-[9px] border border-line/80 bg-surface-panel px-3 text-left text-[13px] font-semibold text-ink shadow-sm disabled:opacity-60"
          aria-expanded={isOpen}
        >
          <span className={`truncate ${selected ? "text-ink" : "text-text-subtle"}`}>
            {selected?.label ?? placeholder ?? String(value)}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-text-subtle transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </button>
        {isOpen ? (
          <div className="absolute left-0 top-full z-50 mt-2 max-h-72 w-full overflow-y-auto rounded-[9px] border border-line/80 bg-surface-raised p-1 shadow-soft">
            {options.length ? (
              options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`focus-ring block w-full rounded-md px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-surface-hover ${
                    option.value === value ? "bg-cobalt/15 text-ink" : "text-text-muted"
                  }`}
                >
                  <span className="block truncate">{option.label}</span>
                  {option.detail ? <span className="mt-0.5 block truncate text-xs font-normal text-text-subtle">{option.detail}</span> : null}
                </button>
              ))
            ) : (
              <div className="px-3 py-3 text-sm text-text-subtle">{placeholder ?? "No options available."}</div>
            )}
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
    {
      label: "Yesterday",
      range: () => {
        const yesterday = addDays(new Date(), -1);
        return { startDate: isoDate(yesterday), endDate: isoDate(yesterday) };
      },
    },
    { label: "Last 3 days", range: () => presetRange(3) },
    { label: "Last 7 days", range: () => presetRange(7) },
    { label: "Last 14 days", range: () => presetRange(14) },
    { label: "Last 30 days", range: () => presetRange(30) },
    {
      label: "Last week",
      range: () => {
        const lastWeekStart = addDays(startOfWeek(new Date()), -7);
        return { startDate: isoDate(lastWeekStart), endDate: isoDate(addDays(lastWeekStart, 6)) };
      },
    },
    {
      label: "This month",
      range: () => {
        const today = new Date();
        return { startDate: isoDate(startOfMonth(today)), endDate: isoDate(today) };
      },
    },
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
    const days = Array.from(
      { length: endOfMonth(month).getDate() },
      (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1),
    );
    const blanks = Array.from({ length: startOffset }, (_, index) => index);

    return (
      <div className="min-w-[260px] flex-1">
        <div className="mb-4 text-center text-sm font-bold text-ink">{monthTitle(month)}</div>
        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-bold text-text-subtle">
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
                      : "bg-surface-hover text-text-muted hover:bg-cobalt/15 hover:text-ink"
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
      <span className="mb-2 block font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-subtle">Date Range</span>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openPicker())}
        className="focus-ring flex h-11 w-full items-center justify-between gap-3 rounded-[9px] border border-line/80 bg-surface-panel px-3 text-left text-sm shadow-sm"
      >
        <span className="min-w-0 truncate text-sm font-semibold text-ink">
          {startDate} to {endDate}
        </span>
        <CalendarDays className="h-4 w-4 shrink-0 text-text-subtle" />
      </button>

      {isOpen && popoverPosition && typeof document !== "undefined"
        ? createPortal(
        <div
          className="fixed z-[100] overflow-hidden rounded-[12px] border border-line/80 bg-surface-popover shadow-soft"
          style={{ top: popoverPosition.top, left: popoverPosition.left, width: popoverPosition.width }}
        >
          <div className="grid max-h-[520px] grid-cols-1 md:grid-cols-[160px_1fr]">
            <div className="border-b border-line/70 bg-surface-panel p-3 md:border-b-0 md:border-r">
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset.range())}
                    className="focus-ring rounded-md px-3 py-2 text-left text-sm font-semibold text-text-muted hover:bg-surface-hover hover:text-ink"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4">
              <div className="mb-4 flex flex-wrap items-center gap-3 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-text-subtle">
                <span>Start</span>
                <span className="rounded-md border border-line/80 bg-surface-panel px-3 py-2 font-mono text-ink">{draftStart || "Select date"}</span>
                <span>End</span>
                <span className="rounded-md border border-line/80 bg-surface-panel px-3 py-2 font-mono text-ink">{draftEnd || "Select date"}</span>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
                    className="focus-ring flex h-9 w-9 items-center justify-center rounded-md border border-line/80 bg-surface-panel text-text-muted hover:bg-surface-hover hover:text-ink"
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
                    className="focus-ring flex h-9 w-9 items-center justify-center rounded-md border border-line/80 bg-surface-panel text-text-muted hover:bg-surface-hover hover:text-ink"
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
                  className="focus-ring h-10 rounded-md border border-line/80 bg-surface-raised px-4 text-sm font-semibold text-text-muted hover:bg-surface-hover hover:text-ink"
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

const findingSections: Array<{ title: string; description: string; types: FindingType[] }> = [
  {
    title: "Events",
    description: "Spec events missing from live data, live names that look like typos, and untracked live events.",
    types: ["missing_event", "event_typo", "untracked_event"],
  },
  {
    title: "Payloads",
    description: "Spec payload fields missing from matched events, payload-name typos, and untracked live payloads.",
    types: ["missing_payload", "payload_typo", "untracked_payload", "duplicate_spec_payload"],
  },
  {
    title: "Data Types",
    description: "Numeric or boolean spec payloads whose live values arrive as a different type.",
    types: ["type_mismatch"],
  },
  {
    title: "Enum Values",
    description: "Value checks for item, source, item_type, and placement against the spec's allowed values.",
    types: ["enum_value_typo", "enum_unexpected_value", "enum_missing_coverage"],
  },
];

function findingTypeLabel(type: FindingType) {
  const labels: Record<FindingType, string> = {
    missing_event: "Missing event",
    event_typo: "Event typo",
    untracked_event: "Untracked event",
    missing_payload: "Missing payload",
    payload_typo: "Payload typo",
    untracked_payload: "Untracked payload",
    type_mismatch: "Type mismatch",
    enum_value_typo: "Value typo",
    enum_unexpected_value: "Unexpected value",
    enum_missing_coverage: "Missing coverage",
    duplicate_spec_payload: "Duplicate spec payload",
  };
  return labels[type];
}

function eventDetailRailClasses(status: EventReport["status"]) {
  if (status === "matched") return "border-emerald/70 bg-emerald/[0.035]";
  if (status === "typo" || status === "missing") return "border-rose/70 bg-rose/[0.035]";
  return "border-cyan/70 bg-cyan/[0.035]";
}

function DetailTooltip({ detail }: { detail: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="focus-ring flex h-7 w-7 items-center justify-center rounded-md border border-cobalt/30 bg-cobalt/10 text-cyan transition-colors hover:border-cyan/50 hover:bg-cyan/10 hover:text-cyan"
        aria-label={detail}
      >
        <MessageSquareText className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-80 rounded-md border border-cobalt/30 bg-surface-raised px-3 py-2 text-left text-xs font-medium leading-relaxed text-ink shadow-soft ring-1 ring-cobalt/10 group-hover:block group-focus-within:block"
      >
        <span className="absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-l border-t border-cobalt/30 bg-surface-raised" />
        {detail}
      </span>
    </span>
  );
}

function FindingsSection({
  title,
  description,
  findings,
  expanded,
  onToggle,
}: {
  title: string;
  description: string;
  findings: Finding[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const sorted = [...findings].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || a.eventName.localeCompare(b.eventName),
  );
  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const infoCount = findings.filter((finding) => finding.severity === "info").length;

  return (
    <article className={`overflow-hidden rounded-[14px] border border-line/70 bg-surface-card shadow-soft ${expanded ? "md:col-span-2" : ""}`}>
      <button
        type="button"
        onClick={onToggle}
        className="focus-ring flex w-full cursor-pointer items-center justify-between gap-3 bg-surface-popover px-4 py-3.5 text-left hover:bg-surface-raised"
        aria-expanded={expanded}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[15px] font-bold text-ink">{title}</span>
            <span className="font-mono text-[11px] font-semibold text-text-subtle">{findings.length} findings</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-text-subtle">{description}</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold">
          {errorCount ? <span className="rounded-md border border-rose/40 bg-rose/15 px-2 py-0.5 text-rose">{errorCount} errors</span> : null}
          {warningCount ? <span className="rounded-md border border-amber/40 bg-amber/15 px-2 py-0.5 text-amber">{warningCount} warnings</span> : null}
          {infoCount && !errorCount && !warningCount ? <span className="rounded-md border border-line/80 bg-surface-hover px-2 py-0.5 text-text-muted">{infoCount} info</span> : null}
          {!findings.length ? <span className="rounded-md border border-emerald/40 bg-emerald/15 px-2 py-0.5 text-emerald">clean</span> : null}
          <ChevronDown className={`h-4 w-4 text-text-subtle transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>
      {expanded && findings.length ? (
        <div className="overflow-x-auto border-t border-line">
          <table className="min-w-full text-left text-sm">
            <thead
              className="bg-surface-panel font-mono text-[10px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: "#697692" }}
            >
              <tr>
                <th className="px-4 py-2.5">Severity</th>
                <th className="px-4 py-2.5">Check</th>
                <th className="px-4 py-2.5">Event</th>
                <th className="px-4 py-2.5">Payload</th>
                <th className="px-4 py-2.5">Spec → Observed</th>
                <th className="px-4 py-2.5 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60 text-text-muted">
              {sorted.map((finding, index) => (
                <tr
                  key={`${finding.type}-${finding.eventName}-${finding.payloadName ?? ""}-${finding.observedValue ?? ""}-${index}`}
                  className="hover:bg-surface-raised"
                >
                  <td className="px-4 py-3">
                    <SeverityChip severity={finding.severity} />
                  </td>
                  <td
                    className="px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.02em]"
                    style={{ color: "#76a5ff" }}
                  >
                    {findingTypeLabel(finding.type)}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-ink">{finding.eventName}</td>
                  <td className="px-4 py-3 font-mono text-sm text-ink">{finding.payloadName ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-sm">
                    {finding.specValue || finding.observedValue ? (
                      <span>
                        <span className="text-emerald">{finding.specValue ?? "—"}</span>
                        <span className="mx-1.5 text-text-subtle">→</span>
                        <span className="text-rose">{finding.observedValue ?? "—"}</span>
                        {typeof finding.count === "number" ? <span className="ml-1.5 text-text-subtle">({finding.count}x)</span> : null}
                      </span>
                    ) : (
                      <span className="text-text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DetailTooltip detail={finding.detail} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : expanded ? (
        <div className="border-t border-line/70 px-4 py-4 text-sm text-text-subtle">No findings in this category.</div>
      ) : null}
    </article>
  );
}

function eventStatusRank(event: EventReport) {
  if (event.status === "missing") return 0;
  if (event.status === "typo") return 1;
  if (event.status === "matched") return event.findings.length ? 2 : 3;
  return 4;
}

function EventDrilldown({ event }: { event: EventReport }) {
  const name = event.specEventName ?? event.liveEventName ?? "";
  const errorCount = event.findings.filter((finding) => finding.severity === "error").length;
  const warningCount = event.findings.filter((finding) => finding.severity === "warning").length;

  return (
    <details className="group border-b border-line/60 last:border-b-0">
      <summary className="focus-ring flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3.5 hover:bg-surface-raised">
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold uppercase ${eventStatusClasses(event.status)}`}>
          {event.status}
        </span>
        <span className="font-mono text-sm font-semibold text-ink">{name}</span>
        {event.status === "typo" && event.liveEventName ? (
          <span className="font-mono text-xs text-rose">live: {event.liveEventName}</span>
        ) : null}
        {event.source === "platformAd" ? (
          <span className="rounded-md border border-cyan/40 bg-cyan/10 px-2 py-0.5 text-xs font-semibold text-cyan">platform ad</span>
        ) : null}
        {event.source === "live-only" ? (
          <span className="rounded-md border border-line/80 bg-surface-hover px-2 py-0.5 text-xs font-semibold text-text-muted">not in spec</span>
        ) : null}
          <span className="ml-auto flex items-center gap-2 text-xs text-text-subtle">
          {typeof event.eventCount === "number" ? <span className="font-mono">{new Intl.NumberFormat().format(event.eventCount)} events</span> : null}
          {event.firstSeen ? <span className="hidden font-mono md:inline">{event.firstSeen.slice(0, 10)} → {event.lastSeen?.slice(0, 10)}</span> : null}
          {errorCount ? <span className="font-semibold text-rose">{errorCount}E</span> : null}
          {warningCount ? <span className="font-semibold text-amber">{warningCount}W</span> : null}
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className={`ml-3 border-l-2 ${eventDetailRailClasses(event.status)} overflow-x-auto border-t border-line/60 px-4 py-3`}>
        {event.payloads.length ? (
          <table className="min-w-full text-left text-sm">
            <thead
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: "#697692" }}
            >
              <tr>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Spec Payload</th>
                <th className="py-2 pr-4">Live Payload</th>
                <th className="py-2 pr-4">Spec Type</th>
                <th className="py-2 pr-4">Observed</th>
                <th className="py-2 pr-4">Requiredness</th>
                <th className="py-2 pr-4">Findings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {event.payloads.map((payload, index) => (
                <tr
                  key={`${payload.specName ?? payload.liveName}-${index}`}
                  className={index % 2 ? "bg-surface-raised/70" : "bg-surface-card/40"}
                >
                  <td className="py-2.5 pr-4">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold uppercase ${payloadStatusClasses(payload.status)}`}>
                      {payload.status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-ink">{payload.specName ?? "—"}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-ink">{payload.liveName ?? "—"}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-text-muted">{payload.specType || "—"}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-text-muted">{payload.observedType ?? "—"}</td>
                  <td className="py-2.5 pr-4 text-xs text-text-muted">{payload.requiredness || "—"}</td>
                  <td className="py-2.5 pr-4">
                    {payload.findings.length ? (
                      <ul className="space-y-1">
                        {payload.findings.map((finding, findingIndex) => (
                          <li key={findingIndex} className="flex items-start gap-2 text-[11px] leading-relaxed text-text-subtle">
                            <SeverityChip severity={finding.severity} />
                            <span className="pt-0.5">{finding.detail}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-text-subtle">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="py-2 text-sm text-text-subtle">No payload fields observed or specified for this event.</div>
        )}
      </div>
    </details>
  );
}

export default function SpecCheckDashboard() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [specs, setSpecs] = useState<SavedSpecSummary[]>([]);
  const [specsError, setSpecsError] = useState("");
  const [isLoadingSpecs, setIsLoadingSpecs] = useState(true);
  const [data, setData] = useState<CompletedResponse | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [versionOptions, setVersionOptions] = useState<AppVersionOption[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [versionError, setVersionError] = useState("");
  const [isVersionMenuOpen, setIsVersionMenuOpen] = useState(false);
  const [pendingUrlRun, setPendingUrlRun] = useState(false);
  const [expandedFindingSection, setExpandedFindingSection] = useState<string | null>(null);
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
    setExpandedFindingSection(null);
    setFilters((current) => ({ ...current, ...patch }));
  }

  async function postSpecCheck(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as ApiResponse;
  }

  async function wait(ms: number) {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function pollSpecCheck(
    jobKey: string,
    pollFilters: Filters,
    firstDelayMs: number,
    requestId: number,
    forceRefresh: boolean,
  ) {
    let delayMs = firstDelayMs;
    while (requestIdRef.current === requestId) {
      setStatusText("Count query is still running. Waiting for results...");
      await wait(delayMs);
      if (requestIdRef.current !== requestId) return;

      const result = await postSpecCheck("/api/spec-check/status", { jobKey, filters: pollFilters, forceRefresh });
      if (result.status === "completed") {
        if (requestIdRef.current !== requestId) return;
        setData(result);
        setStatusText(result.cache.hit ? "Loaded from cache" : "Check complete");
        return;
      }
      delayMs = result.pollAfterMs;
    }
  }

  async function runCheck(forceRefresh = false, options: { updateUrlRun?: boolean } = {}) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const filterSnapshot = { ...filters };
    if (options.updateUrlRun !== false) writeFiltersToUrl(filterSnapshot, true);
    setIsLoading(true);
    setError("");
    setStatusText(forceRefresh ? "Submitting fresh Count query..." : "Checking cache...");
    try {
      const result = await postSpecCheck("/api/spec-check", { ...filterSnapshot, forceRefresh });
      if (result.status === "completed") {
        if (requestIdRef.current !== requestId) return;
        setData(result);
        setStatusText(result.cache.hit ? "Loaded from cache" : "Check complete");
        return;
      }
      setStatusText("Count query submitted. Waiting for results...");
      await pollSpecCheck(result.metadata.jobKey, filterSnapshot, result.pollAfterMs, requestId, forceRefresh);
    } catch (err) {
      if (requestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : "Could not run Analytics QA");
        setStatusText("");
      }
    } finally {
      if (requestIdRef.current === requestId) setIsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setIsLoadingSpecs(true);
    fetch("/api/specs")
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()) as SavedSpecSummary[];
      })
      .then((summaries) => {
        if (cancelled) return;
        setSpecs(summaries);
        setSpecsError("");
      })
      .catch(() => {
        if (cancelled) return;
        setSpecs([]);
        setSpecsError("Could not load saved specs. Sign in on the Analytics Hub, then reload this page.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSpecs(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlFilters = filtersFromSearchParams(new URLSearchParams(window.location.search));
    const sessionSnapshot = readDashboardSession<SpecCheckSessionSnapshot>(specCheckSessionKey);
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
    writeDashboardSession<SpecCheckSessionSnapshot>(specCheckSessionKey, { filters, data, statusText });
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

    fetch("/api/spec-check/app-versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appName: filters.appName,
        platform: filters.platform,
        startDate: filters.startDate,
        endDate: filters.endDate,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()) as AppVersionsResponse;
      })
      .then((result) => {
        if (versionRequestIdRef.current !== requestId) return;
        setVersionOptions(result.versions);
      })
      .catch(() => {
        if (versionRequestIdRef.current !== requestId) return;
        setVersionOptions([]);
        setVersionError("Version suggestions could not load. You can still run a known version.");
      })
      .finally(() => {
        if (versionRequestIdRef.current === requestId) setIsLoadingVersions(false);
      });
  }, [filters.appName, filters.platform, filters.startDate, filters.endDate]);

  const selectedSpec = specs.find((spec) => spec.id === filters.specId);

  const visibleVersionOptions = useMemo(() => {
    const query = filters.appVersion.trim().toLowerCase();
    if (!query) return versionOptions.slice(0, 12);
    return versionOptions.filter((option) => option.appVersion.toLowerCase().includes(query)).slice(0, 12);
  }, [filters.appVersion, versionOptions]);

  const sortedEvents = useMemo(() => {
    if (!data) return [];
    return [...data.report.events].sort(
      (a, b) =>
        eventStatusRank(a) - eventStatusRank(b) ||
        (a.specEventName ?? a.liveEventName ?? "").localeCompare(b.specEventName ?? b.liveEventName ?? ""),
    );
  }, [data]);

  const findingsBySection = useMemo(
    () =>
      findingSections.map((section) => ({
        ...section,
        findings: data ? data.report.findings.filter((finding) => section.types.includes(finding.type)) : [],
      })),
    [data],
  );

  const canRun = Boolean(filters.specId && filters.appVersion.trim() && !isLoading);

  useEffect(() => {
    setExpandedFindingSection(null);
  }, [data?.metadata.executedAt]);

  useEffect(() => {
    if (!pendingUrlRun || !filters.specId || !filters.appVersion.trim()) return;
    setPendingUrlRun(false);
    void runCheck(false, { updateUrlRun: false });
  }, [pendingUrlRun, filters.specId, filters.appVersion]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRun) return;
    void runCheck(false);
  }

  return (
    <CerberusShell
      currentProduct="spec-check"
      collapsed={sidebarCollapsed}
      onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
    >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cyan">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_10px_#48d9ff]" />
              <ClipboardCheck className="h-4 w-4" />
              Analytics QA · Live vs Spec
            </div>
            <h1 className="mt-3 font-display text-3xl font-extrabold leading-tight text-ink">Implementation Check</h1>
            <p className="mt-2 max-w-3xl text-[13.5px] text-text-subtle">
              Pulls live events from Snowflake via the Count API and checks them against a saved spec for typos,
              completeness, data types, and enum values.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="mb-5 rounded-[14px] border border-line/70 bg-surface-card p-4 shadow-soft">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.6fr_1fr_0.8fr_1fr_1.5fr_auto_auto]">
            <FilterDropdown
              label="Saved Spec"
              value={filters.specId}
              options={specs.map((spec) => ({
                value: spec.id,
                label: spec.gameTitle,
                detail: `${spec.eventCount} events · ${spec.payloadCount} payloads · updated ${new Date(spec.updatedAt).toLocaleDateString()}`,
              }))}
              onChange={(specId) => updateFilters({ specId })}
              placeholder={isLoadingSpecs ? "Loading saved specs..." : specs.length ? "Select a saved spec" : "No saved specs found"}
              disabled={isLoadingSpecs}
            />
            <FilterDropdown
              label="App"
              value={filters.appName}
              options={appOptions.map((app) => ({ value: app, label: app }))}
              onChange={(appName) => updateFilters({ appName })}
            />
            <FilterDropdown
              label="Platform"
              value={filters.platform}
              options={platformOptions.map((platform) => ({ value: platform, label: platform }))}
              onChange={(platform) => updateFilters({ platform })}
            />
            <label className="block">
              <span className="mb-2 block font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-subtle">App Version</span>
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
                  placeholder={isLoadingVersions ? "Type version or wait" : "Type or select version"}
                  className="focus-ring h-11 w-full rounded-[9px] border border-line/80 bg-surface-panel px-3 pr-10 font-mono text-[13px] font-semibold text-ink shadow-sm placeholder:text-text-subtle"
                  role="combobox"
                  aria-expanded={isVersionMenuOpen}
                  aria-controls="spec-check-app-version-options"
                />
                <button
                  type="button"
                  onClick={() => setIsVersionMenuOpen((open) => !open)}
                  className="focus-ring absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover hover:text-ink"
                  aria-label="Toggle app version suggestions"
                  aria-expanded={isVersionMenuOpen}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${isVersionMenuOpen ? "rotate-180" : ""}`} />
                </button>
                {isVersionMenuOpen ? (
                  <div
                    id="spec-check-app-version-options"
                    role="listbox"
                    className="absolute left-0 top-full z-50 mt-2 max-h-72 w-full overflow-y-auto rounded-[9px] border border-line/80 bg-surface-raised p-1 shadow-soft"
                  >
                    {isLoadingVersions ? (
                      <div className="flex items-center gap-2 px-3 py-3 text-sm font-semibold text-text-muted">
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
                          className={`focus-ring block w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-hover ${
                            filters.appVersion === option.appVersion ? "bg-cobalt/15 text-ink" : "text-text-muted"
                          }`}
                        >
                          <span className="block font-mono text-sm font-bold text-ink">{option.appVersion}</span>
                          <span className="mt-1 block text-xs text-text-subtle">
                            {new Intl.NumberFormat(undefined, { notation: "compact" }).format(option.sampleCount)} events
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-sm text-text-subtle">No matching suggestions. You can still run a typed version.</div>
                    )}
                  </div>
                ) : null}
              </div>
              <p className={`mt-2 min-h-5 text-[11px] ${versionError ? "text-amber" : "text-text-subtle"}`}>
                {versionError || "Type a version or choose from suggestions."}
              </p>
            </label>
            <DateRangePicker
              startDate={filters.startDate}
              endDate={filters.endDate}
              onChange={(range) => updateFilters(range)}
            />
            <button
              type="submit"
              disabled={!canRun}
              className="focus-ring mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-[9px] bg-cobalt px-4 text-sm font-semibold text-white shadow-[0_8px_22px_-8px_#1f6fff] hover:bg-cobalt/90 disabled:opacity-60"
            >
              {isLoading ? <LoadingSpinner /> : <SearchCheck className="h-4 w-4" />}
              {isLoading ? "Checking" : "Run Check"}
            </button>
            <button
              type="button"
              disabled={!canRun}
              onClick={() => void runCheck(true)}
              className="focus-ring mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-[9px] border border-line/80 bg-surface-raised px-4 text-sm font-semibold text-text-muted hover:bg-surface-hover hover:text-ink disabled:opacity-60"
            >
              {isLoading ? <LoadingSpinner /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          </div>
          {specsError ? <p className="mt-3 text-sm text-amber">{specsError}</p> : null}
        </form>

        {error ? <div className="mb-5 rounded-md border border-rose/40 bg-rose/10 p-3 text-sm text-rose">{error}</div> : null}

        {data ? (
          <>
            {data.report.truncated ? (
              <div className="mb-5 flex items-start gap-3 rounded-md border border-amber/40 bg-amber/10 p-3 text-sm text-amber">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Count returned more rows than the preview limit, so this report may be incomplete. Narrow the date
                  range and re-run for full coverage.
                </span>
              </div>
            ) : null}

            <section className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-[1.45fr_0.62fr_0.62fr_0.62fr]">
              <SpecCheckOverviewCard
                summary={data.report.summary}
                specName={data.spec.gameTitle}
                appName={data.filters.appName}
                appVersion={data.filters.appVersion}
              />
              <SummaryCard
                label="Live Events"
                value={new Intl.NumberFormat().format(data.report.summary.liveEventCount)}
                detail={`${new Intl.NumberFormat().format(data.metadata.numRows ?? 0)} live rows inspected`}
                icon={<Database className="h-5 w-5" />}
                tone="cobalt"
              />
              <SummaryCard
                label="Findings"
                value={String(data.report.findings.length)}
                detail={`${data.report.summary.errorCount} errors · ${data.report.summary.warningCount} warnings`}
                icon={<AlertTriangle className="h-5 w-5" />}
                tone={data.report.summary.errorCount ? "rose" : data.report.summary.warningCount ? "amber" : "emerald"}
              />
              <SummaryCard
                label="Cache"
                value={isLoading ? "Running" : data.cache.hit ? "Hit" : "Fresh"}
                detail={`Expires ${new Date(data.cache.expiresAt).toLocaleString()}`}
                icon={<RefreshCw className="h-5 w-5" />}
              />
            </section>

            <div className="relative">
              {isLoading ? (
                <div className="sticky top-4 z-40 mb-5 flex items-center justify-between gap-3 rounded-lg border border-cobalt/30 bg-surface-raised/95 px-4 py-3 text-sm font-semibold text-ink shadow-soft backdrop-blur">
                  <span className="flex items-center gap-2">
                    <LoadingSpinner className="h-4 w-4 text-cobalt" />
                    {statusText || "Running Analytics QA..."}
                  </span>
                  <span className="hidden font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-subtle sm:inline">Existing results remain visible</span>
                </div>
              ) : null}

              <div className={`transition-opacity ${isLoading ? "opacity-40" : "opacity-100"}`}>
                {data.report.summary.verdict === "no data" ? (
                  <div className="rounded-[14px] border border-dashed border-line/80 bg-surface-card px-4 py-14 text-center text-sm text-text-subtle">
                    No live events found for {data.filters.appName} {data.filters.appVersion} in this date range. Check the
                    app, platform, and version — the app may not send events to the Ludios events table yet.
                  </div>
                ) : (
                  <>
                    <section className="mb-5 grid gap-4 md:grid-cols-2">
                      {findingsBySection.map((section) => (
                        <FindingsSection
                          key={section.title}
                          title={section.title}
                          description={section.description}
                          findings={section.findings}
                          expanded={expandedFindingSection === section.title}
                          onToggle={() =>
                            setExpandedFindingSection((current) => (current === section.title ? null : section.title))
                          }
                        />
                      ))}
                    </section>

                    <section className="relative overflow-hidden rounded-[14px] border border-line/70 bg-surface-card shadow-soft" aria-busy={isLoading}>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 bg-surface-popover px-4 py-3.5">
                        <div>
                          <h2 className="font-display text-[15px] font-bold text-ink">Event Drill-down</h2>
                          <p className="mt-1 text-[12.5px] text-text-subtle">
                            Last run {new Date(data.metadata.executedAt).toLocaleString()}
                            {data.metadata.durationMs ? ` · Count duration ${Math.round(data.metadata.durationMs)}ms` : ""}
                            {` · ${data.report.summary.liveEventCount} live events`}
                          </p>
                        </div>
                        <div className="rounded-md border border-line/80 bg-surface-panel px-3 py-2 font-mono text-[11px] text-text-muted">
                          {data.filters.appName} · {data.filters.platform} · {data.filters.appVersion}
                        </div>
                      </div>
                      <div>
                        {sortedEvents.map((event, index) => (
                          <EventDrilldown key={`${event.specEventName ?? event.liveEventName}-${index}`} event={event} />
                        ))}
                      </div>
                    </section>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <div
            className="rounded-[14px] border border-dashed border-line/80 bg-surface-card px-4 py-14 text-center text-sm text-text-subtle"
            aria-busy={isLoading}
          >
            {isLoading ? (
              <div className="flex flex-col items-center gap-3">
                <LoadingSpinner className="h-6 w-6 text-cobalt" />
                <span>{statusText || "Running Analytics QA..."}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <span>
                  {selectedSpec
                    ? `Checking "${selectedSpec.gameTitle}" — pick the app, version, and date range, then run.`
                    : "Select a saved spec, app, and version, then run the check."}
                </span>
                <span className="max-w-2xl text-[11.5px] leading-relaxed text-text-subtle">
                  The check flags event and payload typos, missing or untracked items, data-type mismatches, and enum
                  value drift for item, source, item_type, and placement.
                </span>
              </div>
            )}
          </div>
        )}
    </CerberusShell>
  );
}
