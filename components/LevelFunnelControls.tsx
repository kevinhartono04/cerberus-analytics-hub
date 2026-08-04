"use client";

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, XCircle } from "lucide-react";
import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";

type DateRange = { startDate: string; endDate: string };
type VersionOption = { appVersion: string; sampleCount: number };

const labelClass = "mb-2 block font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500";
const inputClass = "focus-ring h-[42px] w-full rounded-[9px] border border-line/70 bg-surface-panel px-3 text-sm font-semibold text-slate-300 placeholder:font-normal placeholder:text-slate-500";

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
  const mondayOffset = next.getDay() === 0 ? -6 : 1 - next.getDay();
  next.setDate(next.getDate() + mondayOffset);
  return next;
}

function monthTitle(date: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

function presetRange(days: number): DateRange {
  const end = new Date();
  return { startDate: isoDate(addDays(end, -(days - 1))), endDate: isoDate(end) };
}

export function FunnelFilterDropdown<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
        <button type="button" disabled={disabled} onClick={() => setIsOpen((open) => !open)} className={`${inputClass} flex items-center justify-between gap-3 text-left disabled:opacity-60`} aria-expanded={isOpen}>
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </button>
        {isOpen ? <div className="absolute left-0 top-full z-50 mt-2 max-h-72 w-full overflow-y-auto rounded-[9px] border border-line/70 bg-surface-popover p-1 shadow-soft">
          {options.map((option) => <button key={option.value} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.value); setIsOpen(false); }} className={`focus-ring block w-full rounded-[7px] px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-surface-hover ${option.value === value ? "bg-emerald/10 text-emerald" : "text-slate-400"}`}>{option.label}</button>)}
        </div> : null}
      </div>
    </label>
  );
}

export function FunnelMultiSelect<T extends string>({ label, values, options, onChange, emptyLabel, required = false }: {
  label: string;
  values: T[];
  options: Array<{ value: T; label: string }>;
  onChange: (values: T[]) => void;
  emptyLabel: string;
  required?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabels = options.filter((option) => values.includes(option.value)).map((option) => option.label);
  const display = !values.length ? emptyLabel : values.length === options.length ? `All ${label.toLowerCase()}s` : selectedLabels.join(", ");

  function toggle(value: T) {
    const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
    if (required && !next.length) return;
    onChange(next);
  }

  return <label className="block"><span className={labelClass}>{label}</span><div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}><button type="button" onClick={() => setIsOpen((open) => !open)} className={`${inputClass} flex items-center justify-between gap-3 text-left`} aria-expanded={isOpen}><span className="truncate">{display}</span><ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} /></button>{isOpen ? <div className="absolute left-0 top-full z-50 mt-2 w-full rounded-[9px] border border-line/70 bg-surface-popover p-1 shadow-soft">{options.map((option) => { const checked = values.includes(option.value); return <button key={option.value} type="button" role="checkbox" aria-checked={checked} onMouseDown={(event) => event.preventDefault()} onClick={() => toggle(option.value)} className={`focus-ring flex w-full items-center gap-2 rounded-[7px] px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-surface-hover ${checked ? "text-emerald" : "text-slate-400"}`}><span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? "border-emerald bg-emerald text-[#0a111e]" : "border-slate-600"}`}>{checked ? "✓" : ""}</span>{option.label}</button>; })}</div> : null}</div></label>;
}

export function FunnelVersionMultiSelect({ values, options, loading, error, onChange }: {
  values: string[];
  options: VersionOption[];
  loading: boolean;
  error?: string;
  onChange: (values: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const visibleOptions = options.filter((option) => option.appVersion.toLowerCase().includes(search.toLowerCase()));
  const formatter = new Intl.NumberFormat(undefined, { notation: "compact" });
  const display = !values.length ? "All versions" : values.length === 1 ? values[0] : `${values.length} versions`;
  const selectedSampleCount = options.filter((option) => values.includes(option.appVersion)).reduce((total, option) => total + option.sampleCount, 0);

  function toggle(version: string) {
    onChange(values.includes(version) ? values.filter((item) => item !== version) : [...values, version].sort());
  }

  const typedVersion = search.trim();
  const canAddTypedVersion = Boolean(typedVersion) && !values.includes(typedVersion);
  function addTypedVersion() {
    if (!canAddTypedVersion) return;
    onChange([...values, typedVersion].sort());
    setSearch("");
  }

  return (
    <div className="block">
      <span className={labelClass}>Version</span>
      <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
        <button type="button" onClick={() => setIsOpen((open) => !open)} className={`${inputClass} flex items-center justify-between gap-3 text-left`} aria-expanded={isOpen}>
          <span className="truncate font-mono">{display}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </button>
        {isOpen ? <div className="absolute left-0 top-full z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-[9px] border border-line/70 bg-surface-popover p-1 shadow-soft">
          <div className="sticky top-0 bg-surface-popover p-1">
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTypedVersion(); } }} placeholder="Search or type a version" className="focus-ring h-9 w-full rounded-[7px] border border-line/70 bg-surface-panel px-2 text-sm text-slate-200 placeholder:text-slate-500" />
          </div>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onChange([])} className={`focus-ring block w-full rounded-[7px] px-3 py-2 text-left text-sm font-semibold hover:bg-surface-hover ${!values.length ? "bg-emerald/10 text-emerald" : "text-slate-400"}`}>All versions</button>
          {canAddTypedVersion ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={addTypedVersion} className="focus-ring block w-full rounded-[7px] px-3 py-2 text-left text-sm font-semibold text-cobalt hover:bg-cobalt/10">Use “{typedVersion}”</button> : null}
          {loading ? <div className="flex items-center gap-2 px-3 py-3 text-sm font-semibold text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" />Loading suggestions...</div> : visibleOptions.map((option) => {
            const checked = values.includes(option.appVersion);
            return <button key={option.appVersion} type="button" role="checkbox" aria-checked={checked} onMouseDown={(event) => event.preventDefault()} onClick={() => toggle(option.appVersion)} className={`focus-ring flex w-full items-center gap-2 rounded-[7px] px-3 py-2 text-left transition-colors hover:bg-surface-hover ${checked ? "text-emerald" : "text-slate-400"}`}><span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-emerald bg-emerald text-[#0a111e]" : "border-slate-600"}`}>{checked ? "✓" : ""}</span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-200">{option.appVersion}</span><span className="mt-1 block text-xs">{formatter.format(option.sampleCount)} samples</span></span></button>;
          })}
          {!loading && !visibleOptions.length && !canAddTypedVersion ? <div className="px-3 py-3 text-sm text-slate-500">No matching versions.</div> : null}
        </div> : null}
      </div>
      <p title={error} className={`mt-1 h-3 truncate font-mono text-[10px] leading-3 ${error ? "text-amber" : "text-slate-500"}`}>{error ? "Suggestions unavailable" : loading ? "Loading suggestions" : !values.length ? "All versions accepted" : `${formatter.format(selectedSampleCount)} samples across selected versions`}</p>
    </div>
  );
}

export function FunnelVersionPicker({ value, options, loading, error, onChange }: {
  value: string;
  options: VersionOption[];
  loading: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.appVersion === value);
  const visibleOptions = options.filter((option) => option.appVersion.toLowerCase().includes(value.toLowerCase()));
  const formatter = new Intl.NumberFormat(undefined, { notation: "compact" });

  return (
    <label className="block">
      <span className={labelClass}>Version</span>
      <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
        <input value={value} onChange={(event) => { onChange(event.target.value); setIsOpen(true); }} onFocus={() => setIsOpen(true)} placeholder={loading ? "Type version or wait for suggestions" : "Type or select version"} className={`${inputClass} font-mono pr-20`} role="combobox" aria-expanded={isOpen} aria-controls="level-funnel-version-options" />
        {value ? <button type="button" onClick={() => { onChange(""); setIsOpen(true); }} className="focus-ring absolute right-9 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] text-slate-500 hover:bg-surface-hover hover:text-slate-200" aria-label="Clear app version"><XCircle className="h-4 w-4" /></button> : null}
        <button type="button" onClick={() => setIsOpen((open) => !open)} className="focus-ring absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] text-slate-500 hover:bg-surface-hover hover:text-slate-200" aria-label="Toggle app version suggestions" aria-expanded={isOpen}><ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} /></button>
        {isOpen ? <div id="level-funnel-version-options" role="listbox" className="absolute left-0 top-full z-50 mt-2 max-h-72 w-full overflow-y-auto rounded-[9px] border border-line/70 bg-surface-popover p-1 shadow-soft">
          {loading ? <div className="flex items-center gap-2 px-3 py-3 text-sm font-semibold text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" />Loading suggestions...</div> : visibleOptions.length ? visibleOptions.map((option) => <button key={option.appVersion} type="button" role="option" aria-selected={value === option.appVersion} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.appVersion); setIsOpen(false); }} className={`focus-ring block w-full rounded-[7px] px-3 py-2 text-left transition-colors hover:bg-surface-hover ${value === option.appVersion ? "bg-emerald/10 text-emerald" : "text-slate-400"}`}><span className="block text-sm font-bold text-slate-200">{option.appVersion}</span><span className="mt-1 block text-xs">{formatter.format(option.sampleCount)} samples</span></button>) : <div className="px-3 py-3 text-sm text-slate-500">No matching suggestions. You can still run this typed version.</div>}
        </div> : null}
      </div>
      <p title={error || (!selected && value ? "Version may not be available for the selected range" : undefined)} className={`mt-1 h-3 truncate font-mono text-[10px] leading-3 ${error || (!selected && value) ? "text-amber" : "text-slate-500"}`}>{error ? "Suggestions unavailable" : loading ? "Loading suggestions" : selected ? `${formatter.format(selected.sampleCount)} samples` : value ? "Not found in range" : "Type or select a version"}</p>
    </label>
  );
}

export function FunnelDateRangePicker({ startDate, endDate, onChange }: { startDate: string; endDate: string; onChange: (range: DateRange) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseIsoDate(startDate)));
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const presets = [
    { label: "Today", range: () => presetRange(1) },
    { label: "Yesterday", range: () => { const yesterday = addDays(new Date(), -1); return { startDate: isoDate(yesterday), endDate: isoDate(yesterday) }; } },
    { label: "Last 3 days", range: () => presetRange(3) },
    { label: "Last 7 days", range: () => presetRange(7) },
    { label: "Last 14 days", range: () => presetRange(14) },
    { label: "Last 30 days", range: () => presetRange(30) },
    { label: "Last 3 months", range: () => { const end = new Date(); return { startDate: isoDate(addMonths(end, -3)), endDate: isoDate(end) }; } },
    { label: "Last month", range: () => { const month = addMonths(new Date(), -1); return { startDate: isoDate(startOfMonth(month)), endDate: isoDate(endOfMonth(month)) }; } },
    { label: "Last week", range: () => { const start = addDays(startOfWeek(new Date()), -7); return { startDate: isoDate(start), endDate: isoDate(addDays(start, 6)) }; } },
    { label: "This month", range: () => { const today = new Date(); return { startDate: isoDate(startOfMonth(today)), endDate: isoDate(today) }; } },
  ];

  function openPicker() {
    setDraftStart(startDate); setDraftEnd(endDate); setVisibleMonth(startOfMonth(parseIsoDate(startDate)));
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const padding = 16;
      const width = Math.min(window.innerWidth - padding * 2, 760);
      setPopoverPosition({ top: rect.bottom + 8, left: Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding)), width });
    }
    setIsOpen(true);
  }

  function selectDate(value: string) {
    if (!draftStart || draftEnd) { setDraftStart(value); setDraftEnd(""); return; }
    if (value < draftStart) { setDraftStart(value); setDraftEnd(draftStart); return; }
    setDraftEnd(value);
  }

  function renderMonth(month: Date) {
    const firstDay = startOfMonth(month);
    const days = Array.from({ length: endOfMonth(month).getDate() }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1));
    return <div className="min-w-[260px] flex-1"><div className="mb-4 text-center text-sm font-bold text-ink">{monthTitle(month)}</div><div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-500">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <div key={`${day}-${index}`} className="py-1">{day}</div>)}</div><div className="grid grid-cols-7 gap-1">{Array.from({ length: firstDay.getDay() }, (_, index) => <div key={`blank-${index}`} className="h-9" />)}{days.map((day) => { const value = isoDate(day); const selected = value === draftStart || value === draftEnd; const inRange = draftStart && draftEnd && value > draftStart && value < draftEnd; const isToday = value === isoDate(new Date()); return <button key={value} type="button" onClick={() => selectDate(value)} className={`focus-ring h-9 rounded-md text-sm font-semibold transition-colors ${selected ? "bg-cobalt text-white" : inRange ? "bg-cobalt/20 text-ink" : "bg-sage text-slate-600 hover:bg-cobalt/15 hover:text-ink"} ${isToday && !selected ? "ring-1 ring-cobalt/60" : ""}`}>{day.getDate()}</button>; })}</div></div>;
  }

  return <div className="relative"><span className={labelClass}>Date range</span><button ref={triggerRef} type="button" onClick={() => isOpen ? setIsOpen(false) : openPicker()} className={`${inputClass} flex items-center justify-between gap-3 text-left`}><span className="min-w-0 truncate text-sm">{startDate} to {endDate}</span><CalendarDays className="h-4 w-4 shrink-0 text-slate-300" /></button>{isOpen && popoverPosition && typeof document !== "undefined" ? createPortal(<div className="fixed z-[100] overflow-hidden rounded-xl border border-line/70 bg-surface-popover shadow-soft" style={{ top: popoverPosition.top, left: popoverPosition.left, width: popoverPosition.width }}><div className="grid max-h-[520px] grid-cols-1 md:grid-cols-[160px_1fr]"><div className="border-b border-line/60 bg-surface-panel p-3 md:border-b-0 md:border-r"><div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">{presets.map((preset) => <button key={preset.label} type="button" onClick={() => { const range = preset.range(); setDraftStart(range.startDate); setDraftEnd(range.endDate); setVisibleMonth(startOfMonth(parseIsoDate(range.startDate))); onChange(range); setIsOpen(false); }} className="focus-ring rounded-[7px] px-3 py-2 text-left text-sm font-semibold text-slate-400 hover:bg-surface-hover hover:text-slate-200">{preset.label}</button>)}</div></div><div className="p-4"><div className="mb-4 flex flex-wrap items-center gap-3 text-xs font-bold uppercase text-slate-500"><span>Start</span><span className="rounded-[7px] border border-line/70 bg-surface-panel px-3 py-2 font-mono text-slate-300">{draftStart || "Select date"}</span><span>End</span><span className="rounded-[7px] border border-line/70 bg-surface-panel px-3 py-2 font-mono text-slate-300">{draftEnd || "Select date"}</span><div className="ml-auto flex gap-2"><button type="button" onClick={() => setVisibleMonth((current) => addMonths(current, -1))} className="focus-ring flex h-9 w-9 items-center justify-center rounded-[7px] border border-line/70 bg-surface-raised text-slate-400 hover:bg-surface-hover hover:text-slate-200" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button><button type="button" onClick={() => setVisibleMonth((current) => addMonths(current, 1))} className="focus-ring flex h-9 w-9 items-center justify-center rounded-[7px] border border-line/70 bg-surface-raised text-slate-400 hover:bg-surface-hover hover:text-slate-200" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button></div></div><div className="grid gap-6 lg:grid-cols-2">{renderMonth(visibleMonth)}{renderMonth(addMonths(visibleMonth, 1))}</div><div className="mt-5 flex justify-end gap-2 border-t border-line pt-4"><button type="button" onClick={() => setIsOpen(false)} className="focus-ring h-10 rounded-[8px] border border-line/70 bg-surface-raised px-4 text-sm font-semibold text-slate-300 hover:bg-surface-hover">Cancel</button><button type="button" disabled={!draftStart || !draftEnd} onClick={() => { if (!draftStart || !draftEnd) return; onChange({ startDate: draftStart, endDate: draftEnd }); setIsOpen(false); }} className="focus-ring h-10 rounded-md bg-cobalt px-4 text-sm font-semibold text-white hover:bg-cobalt/90 disabled:opacity-50">Apply</button></div></div></div></div>, document.body) : null}</div>;
}
