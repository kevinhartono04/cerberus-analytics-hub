"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  FileText,
  Link2,
  Library,
  LogIn,
  LogOut,
  Pencil,
  Play,
  Plus,
  Save,
  Search,
  Shield,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  UserCog,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { UseFormReturn, useForm } from "react-hook-form";

import CerberusShell, { ShellNavItem } from "@/components/CerberusShell";
import { splitTextList } from "@/lib/canonical";
import {
  GeneratedEvent,
  GeneratedPayloadField,
  GeneratedSpec,
  GameIntake,
  intakeSchema,
  AppUser,
  LibrarySnapshot,
  PartnerDomainAccess,
  SavedSpecSummary,
  UserRole,
} from "@/lib/types";

const techLaunchApps = [
  "blockkingdom", "bloomsort", "bubblego", "bubblewordchain", "dotpaint", "hexago", "jelly", "mahjongbloom",
  "marble", "sizzle", "stacksmash", "tripletile", "wooblast", "woodoku", "wordblast", "wordrush",
] as const;

function defaultPartnerExpiryDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

type Tab = "intake" | "review" | "viewer" | "specs" | "library" | "users";

const navigationItems: Array<{ tab: Tab; label: string; icon: LucideIcon }> = [
  { tab: "intake", label: "Intake", icon: Wand2 },
  { tab: "review", label: "Editor", icon: Sparkles },
  { tab: "viewer", label: "Spec Viewer", icon: Table2 },
  { tab: "specs", label: "Saved Specs", icon: FileText },
  { tab: "library", label: "Library", icon: Library },
  { tab: "users", label: "Users", icon: UserCog },
];

function tabFromParam(value: string | null): Tab | null {
  if (
    value === "intake" ||
    value === "review" ||
    value === "viewer" ||
    value === "specs" ||
    value === "library" ||
    value === "users"
  ) {
    return value;
  }
  return null;
}

type AuthState = {
  authenticated: boolean;
  user: AppUser | null;
  access?: {
    accountType: "internal" | "external";
    techLaunchApps: string[];
  } | null;
};

const exampleIntake: GameIntake = {
  gameTitle: "Sample Match Timed",
  genre: "Match-3 timed puzzle",
  coreLoop: "Level / round based",
  gameModes: "Journey, Daily Challenge",
  mechanics: "Limited time, Match objectives, Powerups, Revive, Play-on, Difficulty tiers",
  winConditions: "Complete all level objectives before time expires",
  loseConditions: "Out of time, delivery failed",
  economy: "Currency, Item inventory",
  itemsOrPowerups: "shuffle, takeaway, hourglass, toolkit",
  powerupNames: "shuffle, takeaway, hourglass, toolkit",
  iap: "Store enabled, Paid products",
  ads: "Rewarded Ads, Interstitial Ads",
  rewardedAdPlacements: "2x_rewards, daily_reward, ad_reward, powerup",
  interstitialAdPlacements: "game_end, session_resume, mid_game",
  liveOps: "Events / seasons, Missions / milestones",
  notes: "Include platform ad payload enrichment but do not create manual ad lifecycle specs.",
};

const intakeOptionGroups: Array<{
  name: keyof Pick<GameIntake, "coreLoop" | "mechanics" | "economy" | "iap" | "ads" | "liveOps">;
  label: string;
  helper: string;
  options: string[];
}> = [
  {
    name: "coreLoop",
    label: "Game Structure",
    helper: "Pick the broad play structure.",
    options: ["Level / round based", "Session based"],
  },
  {
    name: "mechanics",
    label: "Mechanics",
    helper: "Pick mechanics that affect payload requirements.",
    options: ["Limited moves", "Limited time", "Match objectives", "Powerups", "Revive", "Play-on", "Difficulty tiers"],
  },
  {
    name: "economy",
    label: "Economy",
    helper: "Pick systems that require transaction tracking.",
    options: ["Currency", "Item inventory", "Lives / energy"],
  },
  {
    name: "iap",
    label: "IAP",
    helper: "Pick paid purchase surfaces.",
    options: ["Store enabled", "Paid products"],
  },
  {
    name: "ads",
    label: "Ads",
    helper: "Pick ad formats used by the game.",
    options: ["Rewarded Ads", "Interstitial Ads"],
  },
  {
    name: "liveOps",
    label: "Live Ops",
    helper: "Pick limited-time or recurring event systems.",
    options: ["Events / seasons", "Missions / milestones", "Leaderboards"],
  },
];

const rewardedAdPlacementOptions = ["2x_rewards", "daily_reward", "ad_reward", "powerup"];
const interstitialAdPlacementOptions = ["game_end", "session_resume", "mid_game"];
const payloadDataTypeOptions = ["String", "Integer", "Float", "Bool", "Array"];
type PayloadDataType = (typeof payloadDataTypeOptions)[number];

const intakeLabelClass = "mb-2 block font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500";
const intakeInputClass =
  "focus-ring h-[42px] w-full rounded-[9px] border border-line/70 bg-[#0a111e] px-3 text-sm font-semibold text-slate-300 shadow-none placeholder:text-slate-500";
const intakeTextareaClass =
  "focus-ring min-h-[62px] w-full resize-y rounded-[9px] border border-line/70 bg-[#0a111e] px-3 py-2 text-sm leading-relaxed text-slate-300 shadow-none placeholder:text-slate-500";
const editorLabelClass = "mb-2 block font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500";
const editorInputClass =
  "focus-ring h-[42px] w-full rounded-[9px] border border-line/70 bg-[#0a111e] px-3 text-sm font-semibold text-slate-300 shadow-none placeholder:text-slate-500 disabled:opacity-60";
const editorTextareaClass =
  "focus-ring min-h-[62px] w-full resize-y rounded-[9px] border border-line/70 bg-[#0a111e] px-3 py-2 text-sm leading-relaxed text-slate-300 shadow-none placeholder:text-slate-500 disabled:opacity-60";

const eventGroupOptions = [
  {
    id: "gameplay",
    label: "Core Gameplay",
    category: "Gameplay",
    featurePack: "Core Gameplay",
  },
  {
    id: "economy",
    label: "Economy",
    category: "Economy",
    featurePack: "Economy",
  },
  {
    id: "iap",
    label: "IAP",
    category: "IAP",
    featurePack: "IAP",
  },
  {
    id: "iaa",
    label: "IAA",
    category: "IAA",
    featurePack: "Platform Ad Payload Enrichment",
  },
  {
    id: "liveOps",
    label: "Live Ops",
    category: "Live Ops",
    featurePack: "Live Ops",
  },
  {
    id: "custom",
    label: "Custom",
    category: "Custom",
    featurePack: "Custom Review Additions",
  },
] as const;

type EventGroupId = (typeof eventGroupOptions)[number]["id"];

const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

function canCreateSpecs(user: AppUser | null) {
  return user?.role === "admin" || user?.role === "editor";
}

function canManageUsers(user: AppUser | null) {
  return user?.role === "admin";
}

function summaryFromSpec(spec: GeneratedSpec): SavedSpecSummary {
  return {
    id: spec.id,
    gameTitle: spec.intake.gameTitle,
    genre: spec.intake.genre,
    status: reviewStatusForEvents(spec.generatedEvents),
    eventCount: spec.generatedEvents.length,
    payloadCount: spec.generatedEvents.reduce((total, event) => total + event.payloadFields.length, 0) + spec.platformAdPayloads.length,
    generatedAt: spec.generatedAt,
    savedAt: spec.generatedAt,
    updatedAt: spec.generatedAt,
    canEdit: false,
    canDelete: false,
  };
}

function Field({
  label,
  name,
  register,
  placeholder,
}: {
  label: string;
  name: keyof GameIntake;
  register: ReturnType<typeof useForm<GameIntake>>["register"];
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className={intakeLabelClass}>{label}</span>
      <textarea
        {...register(name)}
        placeholder={placeholder}
        className={intakeTextareaClass}
      />
    </label>
  );
}

function TextInput({
  label,
  name,
  register,
  placeholder,
  help,
}: {
  label: string;
  name: keyof GameIntake;
  register: ReturnType<typeof useForm<GameIntake>>["register"];
  placeholder?: string;
  help?: string;
}) {
  return (
    <label className="block">
      <span className={intakeLabelClass}>{label}</span>
      <input
        {...register(name)}
        placeholder={placeholder}
        className={intakeInputClass}
      />
      {help ? <span className="mt-2 block text-xs text-slate-500">{help}</span> : null}
    </label>
  );
}

function CheckboxDropdown({
  form,
  name,
  label,
  helper,
  options,
  allowCustom = true,
}: {
  form: UseFormReturn<GameIntake>;
  name: keyof GameIntake;
  label: string;
  helper: string;
  options: string[];
  allowCustom?: boolean;
}) {
  const value = form.watch(name) ?? "";
  const selected = splitTextList(value);
  const selectedSet = new Set(selected);
  const tone = categoryTone(label);
  const visibleSelections = selected.slice(0, 5);
  const hiddenSelectionCount = Math.max(0, selected.length - visibleSelections.length);

  function toggle(option: string) {
    const next = selectedSet.has(option)
      ? selected.filter((item) => item !== option)
      : [...selected, option];
    form.setValue(name, next.join(", "), { shouldDirty: true, shouldValidate: true });
  }

  return (
    <details className={`group rounded-[11px] border border-line/70 border-l-2 bg-[#0a111e] shadow-none open:shadow-soft ${tone.border}`}>
      <summary className="focus-ring flex cursor-pointer list-none items-start justify-between gap-3 rounded-[11px] px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-3">
            <span className="block text-sm font-bold text-slate-300">{label}</span>
            <span className="shrink-0 font-mono text-[10px] text-slate-500">
              {selected.length ? `${selected.length} selected` : "Optional"}
            </span>
          </span>
          {visibleSelections.length ? (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {visibleSelections.map((item) => (
                <span key={item} className="rounded-[7px] border border-line/80 bg-[#151c2e] px-2 py-1 text-[11px] text-slate-300">
                  {item}
                </span>
              ))}
              {hiddenSelectionCount ? (
                <span className="rounded-[7px] border border-line bg-sage px-2 py-1 text-[11px] text-slate-500">
                  +{hiddenSelectionCount}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="mt-2 block text-xs leading-relaxed text-slate-500">{helper}</span>
          )}
        </span>
        <span className="tone-chip w-fit rounded border border-line/80 bg-[#151c2e] px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-slate-400">
          Choose
        </span>
      </summary>
      <div className="border-t border-line/70 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <label
              key={option}
              className="flex items-start gap-2 rounded-md border border-line/70 bg-[#0d1424] px-3 py-2 text-sm text-text-muted hover:bg-sage"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(option)}
                onChange={() => toggle(option)}
                className="mt-0.5 h-4 w-4 rounded border-line bg-[#0a111e] text-cobalt"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
        {allowCustom ? (
          <label className="mt-3 block">
            <span className={intakeLabelClass}>
              Selected / custom entries
            </span>
            <textarea
              {...form.register(name)}
              className={intakeTextareaClass}
              placeholder="Selections appear here. Add custom items separated by commas."
            />
          </label>
        ) : null}
      </div>
    </details>
  );
}

function statusTone(status: string) {
  const lower = status.toLowerCase();
  if (lower.includes("review") || lower.includes("approved") || lower.includes("final")) {
    return {
      chip: "border-emerald/30 bg-emerald/10 text-emerald",
      metric: "text-emerald",
      bar: "bg-emerald",
    };
  }
  if (lower.includes("change") || lower.includes("error") || lower.includes("fail")) {
    return {
      chip: "border-rose/30 bg-rose/10 text-rose",
      metric: "text-rose",
      bar: "bg-rose",
    };
  }
  if (lower.includes("draft")) {
    return {
      chip: "border-amber/30 bg-amber/10 text-amber",
      metric: "text-amber",
      bar: "bg-amber",
    };
  }
  return {
    chip: "border-line bg-sage text-slate-500",
    metric: "text-ink",
    bar: "bg-line",
  };
}

function categoryTone(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes("economy") || lower.includes("currency") || lower.includes("transaction")) {
    return {
      text: "text-emerald",
      border: "border-l-emerald",
      chip: "border-emerald/30 bg-emerald/10 text-emerald",
      table: "bg-emerald/10 text-emerald",
      bar: "bg-emerald",
    };
  }
  if (lower.includes("iap") || lower.includes("store") || lower.includes("purchase")) {
    return {
      text: "text-amber",
      border: "border-l-amber",
      chip: "border-amber/30 bg-amber/10 text-amber",
      table: "bg-amber/10 text-amber",
      bar: "bg-amber",
    };
  }
  if (lower.includes("ad") || lower.includes("iaa") || lower.includes("rewarded") || lower.includes("interstitial")) {
    return {
      text: "text-cyan",
      border: "border-l-cyan",
      chip: "border-cyan/30 bg-cyan/10 text-cyan",
      table: "bg-cyan/10 text-cyan",
      bar: "bg-cyan",
    };
  }
  if (lower.includes("live") || lower.includes("event") || lower.includes("mission")) {
    return {
      text: "text-violet",
      border: "border-l-violet",
      chip: "border-violet/30 bg-violet/10 text-violet",
      table: "bg-violet/10 text-violet",
      bar: "bg-violet",
    };
  }
  if (
    lower.includes("game") ||
    lower.includes("play") ||
    lower.includes("core") ||
    lower.includes("mechanic") ||
    lower.includes("powerup") ||
    lower.includes("revive")
  ) {
    return {
      text: "text-cobalt",
      border: "border-l-cobalt",
      chip: "border-cobalt/30 bg-cobalt/10 text-cobalt",
      table: "bg-cobalt/10 text-cobalt",
      bar: "bg-cobalt",
    };
  }
  return {
    text: "text-slate-500",
    border: "border-l-line",
    chip: "border-line bg-sage text-slate-500",
    table: "bg-sage text-slate-500",
    bar: "bg-line",
  };
}

function metricTone(label: string, value: string | number) {
  const lowerLabel = label.toLowerCase();
  if (lowerLabel.includes("status")) return statusTone(String(value));
  if (lowerLabel.includes("event")) return { metric: "text-cobalt", bar: "bg-cobalt" };
  if (lowerLabel.includes("payload")) return { metric: "text-emerald", bar: "bg-emerald" };
  if (lowerLabel.includes("pack")) return { metric: "text-violet", bar: "bg-violet" };
  if (lowerLabel.includes("updated")) return { metric: "text-amber", bar: "bg-amber" };
  return { metric: "text-ink", bar: "bg-line" };
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`status-chip w-fit rounded border px-2 py-1 text-[11px] font-semibold ${statusTone(status).chip}`}>
      {status}
    </span>
  );
}

function ToneChip({ children, tone }: { children: React.ReactNode; tone: ReturnType<typeof categoryTone> }) {
  return (
    <span className={`tone-chip w-fit rounded border px-2 py-1 text-[11px] font-semibold uppercase ${tone.chip}`}>
      {children}
    </span>
  );
}

function DataTypePill({ type }: { type: string }) {
  const normalizedType = normalizePayloadDataType({ type, fieldName: "", canonicalFieldName: "", description: "", example: "" });
  const lower = normalizedType.toLowerCase();
  const tone = lower.includes("int") || lower.includes("number") || lower.includes("float")
    ? "border-amber/30 bg-amber/10 text-amber"
    : lower.includes("bool")
      ? "border-violet/30 bg-violet/10 text-violet"
      : lower.includes("id")
        ? "border-cyan/30 bg-cyan/10 text-cyan"
        : "border-cobalt/30 bg-cobalt/10 text-cobalt";

  return (
    <span className={`tone-chip inline-flex w-fit items-center rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold ${tone}`}>
      {normalizedType || "-"}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  const tone = metricTone(label, value);
  return (
    <div className="relative overflow-hidden rounded-md border border-line bg-white p-4 shadow-sm">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${tone.bar}`} />
      <div className="font-mono text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`metric-value mt-2 text-3xl font-bold leading-none ${tone.metric}`}>{value}</div>
    </div>
  );
}

function EditorMetric({ label, value }: { label: string; value: string | number }) {
  const tone = metricTone(label, value);
  return (
    <div className="relative overflow-hidden rounded-[14px] border border-line/70 bg-[linear-gradient(180deg,#101a2d,#0d1626)] px-[18px] py-4">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${tone.bar}`} />
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</div>
      <div className={`metric-value mt-2 font-display text-3xl font-extrabold leading-none ${tone.metric}`}>{value}</div>
    </div>
  );
}

function payloadFieldFromName(name: string): GeneratedPayloadField {
  return {
    fieldName: name,
    canonicalFieldName: name,
    type: "string",
    requiredness: "Recommended",
    description: "Custom payload field added during spec review.",
    example: "",
    notes: "Review data type, requiredness, and example before implementation.",
  };
}

function isIdLikePayload(payload: Pick<GeneratedPayloadField, "fieldName" | "canonicalFieldName" | "description">) {
  const name = `${payload.canonicalFieldName || payload.fieldName}`.toLowerCase();
  const description = payload.description.toLowerCase();
  return (
    name === "id" ||
    name.endsWith("_id") ||
    name.includes("_id_") ||
    /(user|player|game|round|bank|set|level|session|product|order|transaction|placement|ad)id$/.test(name) ||
    /\bid\b/.test(description) ||
    /\bidentifier\b/.test(description)
  );
}

function unquoteExample(example: string) {
  return example.trim().replace(/^["']|["']$/g, "");
}

function inferDataTypeFromExample(example: string): PayloadDataType | null {
  const trimmed = unquoteExample(example);
  if (!trimmed) return null;
  if (/^\[.*\]$/.test(trimmed)) return "Array";
  if (/^(true|false)$/i.test(trimmed)) return "Bool";
  if (/^-?\d+(\.0+)?$/.test(trimmed)) return "Integer";
  if (/^-?\d*\.\d+$/.test(trimmed) || /^-?\d+e[+-]?\d+$/i.test(trimmed)) return "Float";
  return null;
}

function canonicalPayloadDataType(value: string): PayloadDataType | null {
  const normalized = value.trim().toLowerCase();
  return payloadDataTypeOptions.find((option) => option.toLowerCase() === normalized) ?? null;
}

function normalizePayloadDataType(
  payload: Pick<GeneratedPayloadField, "type" | "fieldName" | "canonicalFieldName" | "description" | "example">,
  options: { inferFromExample?: boolean } = {},
): PayloadDataType {
  const raw = payload.type.trim().toLowerCase();
  const canonicalType = canonicalPayloadDataType(payload.type);
  if (canonicalType && (!options.inferFromExample || canonicalType !== "String")) return canonicalType;

  if (isIdLikePayload(payload)) return "String";

  const inferred = inferDataTypeFromExample(payload.example);

  if (raw.includes("array") || raw.includes("list")) return "Array";
  if (raw.includes("bool")) return "Bool";
  if (raw.includes("float") || raw.includes("double") || raw.includes("decimal")) return "Float";
  if (raw.includes("int")) return "Integer";
  if (raw.includes("number") || raw.includes("numeric")) return inferred === "Float" ? "Float" : "Integer";
  if (inferred && (raw === "" || raw === "string" || raw === "text")) return inferred;
  if (raw.includes("string") || raw.includes("text") || raw.includes("id")) return "String";

  return inferred ?? "String";
}

function normalizeSpecPayloadTypes(spec: GeneratedSpec, options: { inferFromExample?: boolean } = {}): GeneratedSpec {
  return {
    ...spec,
    generatedEvents: spec.generatedEvents.map((event) => ({
      ...event,
      payloadFields: event.payloadFields.map((payload) => ({
        ...payload,
        type: normalizePayloadDataType(payload, options),
      })),
    })),
  };
}

function eventGroupForId(groupId: EventGroupId) {
  return eventGroupOptions.find((group) => group.id === groupId) ?? eventGroupOptions[eventGroupOptions.length - 1];
}

function eventGroupIdForEvent(event: Pick<GeneratedEvent, "eventName" | "category" | "featurePack">): EventGroupId {
  const value = `${event.category} ${event.featurePack} ${event.eventName}`.toLowerCase();
  if (value.includes("economy") || value.includes("currency") || value.includes("transaction")) return "economy";
  if (value.includes("iap") || value.includes("store") || value.includes("purchase")) return "iap";
  if (value.includes("iaa") || value.includes("ad") || value.includes("rewarded") || value.includes("interstitial")) return "iaa";
  if (value.includes("live") || value.includes("mission") || event.eventName.startsWith("Event_")) return "liveOps";
  if (value.includes("gameplay") || value.includes("core") || event.eventName === "Game_Start" || event.eventName === "Game_End") return "gameplay";
  return "custom";
}

function eventGroupPatch(groupId: EventGroupId): Pick<GeneratedEvent, "category" | "featurePack"> {
  const group = eventGroupForId(groupId);
  return {
    category: group.category,
    featurePack: group.featurePack,
  };
}

function uniqueEventName(events: GeneratedEvent[], baseName: string) {
  const existingNames = new Set(events.map((event) => event.eventName));
  if (!existingNames.has(baseName)) return baseName;
  let suffix = 2;
  while (existingNames.has(`${baseName}_${suffix}`)) suffix += 1;
  return `${baseName}_${suffix}`;
}

function newCustomEvent(index: number, groupId: EventGroupId): GeneratedEvent {
  const group = eventGroupForId(groupId);
  return {
    eventName: `Custom_Event_${index}`,
    category: group.category,
    featurePack: group.featurePack,
    trigger: "",
    argumentName: "",
    argumentDescription: "",
    argumentExamples: "",
    payloadFields: [],
    sourceReferences: ["Manual reviewer addition"],
    generationReason: "Added manually during spec review.",
    status: "Draft",
  };
}

function reviewStatusForEvents(events: GeneratedEvent[]) {
  if (!events.length) return "Draft";
  if (events.some((event) => event.status === "Needs changes")) return "Needs changes";
  if (events.every((event) => event.status === "Reviewed")) return "Reviewed";
  return "Draft";
}

type PlatformAdPayloadRow = GeneratedSpec["platformAdPayloads"][number];

type AdPayloadGroup = {
  key: string;
  adFamily: string;
  canonicalPayloadName: string;
  payloadName: string;
  description: string;
  example: string;
  requiredness: string;
  platformEventNames: string[];
  rowIndexes: number[];
};

function adPayloadGroupKey(adFamily: string, canonicalPayloadName: string) {
  return `${adFamily}::${canonicalPayloadName}`;
}

function adPayloadGroupsFor(payloads: PlatformAdPayloadRow[]) {
  const groups = new Map<string, AdPayloadGroup>();

  payloads.forEach((payload, index) => {
    const key = adPayloadGroupKey(payload.adFamily, payload.canonicalPayloadName);
    const existing = groups.get(key);
    if (existing) {
      existing.rowIndexes.push(index);
      if (!existing.platformEventNames.includes(payload.platformEventName)) {
        existing.platformEventNames.push(payload.platformEventName);
      }
      return;
    }

    groups.set(key, {
      key,
      adFamily: payload.adFamily,
      canonicalPayloadName: payload.canonicalPayloadName,
      payloadName: payload.payloadName,
      description: payload.description,
      example: payload.example,
      requiredness: payload.requiredness,
      platformEventNames: [payload.platformEventName],
      rowIndexes: [index],
    });
  });

  return [...groups.values()].sort(
    (left, right) =>
      left.adFamily.localeCompare(right.adFamily) || left.canonicalPayloadName.localeCompare(right.canonicalPayloadName),
  );
}

function PayloadDetailsEditor({
  eventName,
  payloadFields,
  onChange,
  onDelete,
  onDuplicate,
  onAdd,
  canEdit,
}: {
  eventName: string;
  payloadFields: GeneratedPayloadField[];
  onChange: (payloadIndex: number, patch: Partial<GeneratedPayloadField>) => void;
  onDelete: (payloadIndex: number) => void;
  onDuplicate: (payloadIndex: number) => void;
  onAdd: () => void;
  canEdit: boolean;
}) {
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-line/60">
        <div className="grid min-w-[820px] grid-cols-[200px_110px_minmax(260px,1fr)_170px_78px] gap-0 border-b border-line/60 bg-[#0d1424] px-3 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-slate-500">
          <div>Payload</div>
          <div>Type</div>
          <div>Description</div>
          <div>Example</div>
          <div />
        </div>
        <div>
          {payloadFields.map((payload, payloadIndex) => {
            const rowTone = payloadIndex % 2 === 0 ? "bg-[#0a111e]" : "bg-[#0c1423]";
            return (
              <div
                key={`payload-${payloadIndex}`}
                className={`grid min-w-[820px] grid-cols-[200px_110px_minmax(260px,1fr)_170px_78px] items-center border-b border-line/40 px-3 py-2.5 last:border-b-0 hover:bg-[#101a2c] ${rowTone}`}
              >
                <input
                  aria-label={`${eventName} payload name ${payloadIndex + 1}`}
                  value={payload.canonicalFieldName}
                  readOnly={!canEdit}
                  onChange={(event) =>
                    onChange(payloadIndex, {
                      fieldName: event.target.value,
                      canonicalFieldName: event.target.value,
                    })
                  }
                  className="focus-ring mr-3 min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 font-mono text-[13px] font-semibold text-cobalt hover:border-line/60 focus:border-line/80"
                />
                <select
                  aria-label={`${eventName} ${payload.canonicalFieldName} data type`}
                  value={canonicalPayloadDataType(payload.type) ?? normalizePayloadDataType(payload, { inferFromExample: true })}
                  disabled={!canEdit}
                  onChange={(event) => onChange(payloadIndex, { type: event.target.value })}
                  className="focus-ring mr-3 h-8 rounded-full border border-line/70 bg-[#121b2c] px-2 font-mono text-[11px] font-semibold text-slate-300 disabled:opacity-60"
                >
                  {payloadDataTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <textarea
                  aria-label={`${eventName} ${payload.canonicalFieldName} description`}
                  value={payload.description}
                  readOnly={!canEdit}
                  onChange={(event) => onChange(payloadIndex, { description: event.target.value })}
                  className="focus-ring mr-3 min-h-10 resize-y rounded-md border border-transparent bg-transparent px-2 py-1 text-[12.5px] leading-snug text-slate-400 hover:border-line/60 focus:border-line/80"
                />
                <textarea
                  aria-label={`${eventName} ${payload.canonicalFieldName} example`}
                  value={payload.example}
                  readOnly={!canEdit}
                  onChange={(event) => onChange(payloadIndex, { example: event.target.value })}
                  className="focus-ring mr-3 min-h-10 resize-y rounded-md border border-transparent bg-transparent px-2 py-1 font-mono text-xs leading-snug text-slate-300 hover:border-line/60 focus:border-line/80"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    title="Duplicate payload"
                    aria-label={`${eventName} duplicate ${payload.canonicalFieldName}`}
                    disabled={!canEdit}
                    onClick={() => onDuplicate(payloadIndex)}
                    className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md border border-line/70 bg-[#121b2c] text-slate-500 hover:bg-sage hover:text-slate-300 disabled:opacity-50"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Remove payload"
                    aria-label={`${eventName} remove ${payload.canonicalFieldName}`}
                    disabled={!canEdit}
                    onClick={() => onDelete(payloadIndex)}
                    className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose/40 bg-rose/10 text-rose hover:bg-rose/20 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        disabled={!canEdit}
        onClick={onAdd}
        className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-[9px] border border-dashed border-line/80 bg-transparent px-3.5 py-2 text-xs font-semibold text-slate-400 hover:border-cobalt hover:text-cobalt disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Payload
      </button>
    </div>
  );
}

function SidebarNavButton({
  item,
  activeTab,
  setActiveTab,
  collapsed,
}: {
  item: (typeof navigationItems)[number];
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const isActive = activeTab === item.tab;

  return (
    <button
      type="button"
      title={collapsed ? item.label : undefined}
      aria-label={item.label}
      aria-current={isActive ? "page" : undefined}
      onClick={() => setActiveTab(item.tab)}
      className={`focus-ring group flex h-11 w-full items-center gap-3 rounded-md border px-3 text-sm font-semibold transition-colors ${
        collapsed ? "justify-center" : "justify-start max-md:justify-center"
      } ${
        isActive
          ? "border-cobalt bg-cobalt text-white"
          : "border-transparent bg-transparent text-slate-500 hover:border-line hover:bg-sage hover:text-ink"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-white" : "text-slate-500 group-hover:text-ink"}`} />
      {collapsed ? null : <span className="truncate max-md:hidden">{item.label}</span>}
    </button>
  );
}

function AuthPanel({ auth, collapsed }: { auth: AuthState; collapsed: boolean }) {
  if (!auth.authenticated || !auth.user) {
    return (
      <a
        href="/sign-in"
        title={collapsed ? "Sign in" : undefined}
        className={`focus-ring flex h-10 w-full items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-cobalt hover:bg-sage ${
          collapsed ? "justify-center" : "justify-start max-md:justify-center"
        }`}
      >
        <LogIn className="h-4 w-4" />
        {collapsed ? null : <span className="max-md:hidden">Sign in</span>}
      </a>
    );
  }

  return (
    <div className={collapsed ? "space-y-2 text-center" : "space-y-2"}>
      {collapsed ? (
        <div title={`${auth.user.email} · ${roleLabels[auth.user.role]}`} className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-sage">
          <Shield className="h-4 w-4 text-cobalt" />
        </div>
      ) : (
        <div className="max-md:hidden">
          <div className="truncate text-sm font-bold text-ink">{auth.user.name || auth.user.email}</div>
          <div className="truncate text-xs text-slate-500">{auth.user.email}</div>
          <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-cobalt/30 bg-cobalt/10 px-2 py-1 text-[11px] font-bold uppercase text-cobalt">
            <Shield className="h-3 w-3" />
            {roleLabels[auth.user.role]}
          </div>
        </div>
      )}
      <a
        href="/api/auth/signout?callbackUrl=/sign-in"
        title={collapsed ? "Sign out" : undefined}
        className={`focus-ring flex h-9 w-full items-center gap-2 rounded-md border border-line bg-mist px-3 text-xs font-semibold text-slate-600 hover:bg-sage hover:text-ink ${
          collapsed ? "justify-center" : "justify-start max-md:justify-center"
        }`}
      >
        <LogOut className="h-3.5 w-3.5" />
        {collapsed ? null : <span className="max-md:hidden">Sign out</span>}
      </a>
    </div>
  );
}

function LibraryBrowser({ library }: { library: LibrarySnapshot }) {
  const [query, setQuery] = useState("");
  const lower = query.toLowerCase();
  const events = library.events.filter((event) =>
    [event.eventName, event.featurePack, event.category, event.generatorGuidance].join(" ").toLowerCase().includes(lower),
  );

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cobalt">
          <span className="h-1.5 w-1.5 rounded-full bg-cobalt shadow-[0_0_10px_#3d82ff]" />
          Event Design · Library
        </div>
        <h1 className="mt-3 font-display text-[34px] font-extrabold leading-none text-[#f4f6ff]">Reference Library</h1>
        <p className="mt-2 max-w-3xl text-[13.5px] text-slate-500">
          The canonical events, generation packs, and governance decisions the generator matches against.
        </p>
      </div>

      <div className="grid gap-[14px] sm:grid-cols-2 xl:grid-cols-4">
        <EditorMetric label="Events" value={library.events.length} />
        <EditorMetric label="Payload Rows" value={library.payloads.length} />
        <EditorMetric label="Feature Packs" value={library.generationPacks.length} />
        <EditorMetric label="Ad Payload Rows" value={library.platformAdPayloads.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-line/70 bg-[#0b1120] shadow-soft">
          <div className="border-b border-line/60 bg-[#0d1424] px-[18px] py-[14px] font-display text-sm font-bold text-[#eef1fb]">Generation Packs</div>
          <div className="divide-y divide-line/40">
            {library.generationPacks.map((pack) => (
              <div key={pack.featurePack} className="px-[18px] py-[15px]">
                <div className="text-[13.5px] font-semibold text-[#eaeefc]">{pack.featurePack}</div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">{pack.applicableWhen}</p>
                <p className="mt-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.04em] text-amber">{pack.launchPriority}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="self-start overflow-hidden rounded-2xl border border-line/70 bg-[#0b1120] shadow-soft">
          <div className="border-b border-line/60 bg-[#0d1424] px-[18px] py-[14px] font-display text-sm font-bold text-[#eef1fb]">Governance Decisions</div>
          <div className="divide-y divide-line/40">
            {library.governanceDecisions.map((decision) => (
              <div key={decision.area} className="px-[18px] py-[15px]">
                <div className="text-[13.5px] font-semibold text-[#eaeefc]">{decision.area}</div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-400">{decision.decision}</p>
                {decision.legacy_aliases ? (
                  <p className="mt-2 font-mono text-[11px] text-slate-500">Aliases: {decision.legacy_aliases}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line/70 bg-[#0b1120] shadow-soft">
        <div className="flex flex-col gap-3 border-b border-line/60 bg-[#0d1424] px-[18px] py-[14px] sm:flex-row sm:items-center sm:justify-between">
          <div className="font-display text-sm font-bold text-[#eef1fb]">Event Catalog</div>
          <div className="flex items-center gap-2 rounded-[9px] border border-line/70 bg-[#0a111e] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search events, packs, categories"
              className="focus-ring w-full border-0 bg-transparent text-[12.5px] text-slate-300 outline-none placeholder:text-slate-500 sm:w-[220px]"
            />
          </div>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[960px] text-left text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-[#0a1120] font-mono text-[9.5px] uppercase tracking-[0.09em] text-slate-500">
              <tr>
                <th className="px-[18px] py-3 font-semibold">Event</th>
                <th className="px-3 py-3 font-semibold">Pack</th>
                <th className="px-3 py-3 font-semibold">Category</th>
                <th className="px-[18px] py-3 font-semibold">Payloads & Guidance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/40">
              {events.map((event) => {
                const tone = categoryTone(`${event.category} ${event.featurePack} ${event.eventName}`);
                return (
                  <tr key={event.eventName} className="hover:bg-[#0e1626]">
                    <td className={`px-[18px] py-3.5 align-top font-mono text-[12.5px] font-semibold ${tone.text}`}>{event.eventName}</td>
                    <td className="px-3 py-3.5 align-top text-slate-400">{event.featurePack}</td>
                    <td className="px-3 py-3.5 align-top">
                      <span className={`inline-flex rounded-[6px] border px-2 py-0.5 font-mono text-[10px] font-semibold ${tone.chip}`}>{event.category}</span>
                    </td>
                    <td className="px-[18px] py-3.5 align-top">
                      <div className="font-mono text-[11.5px] text-slate-400">{event.canonicalPayloadFields}</div>
                      <div className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{event.generatorGuidance}</div>
                    </td>
                  </tr>
                );
              })}
              {!events.length ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">No events match the current search.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SpecReview({
  spec,
  setSpec,
  onSave,
  saveStatus,
  canEdit,
}: {
  spec: GeneratedSpec | null;
  setSpec: (spec: GeneratedSpec) => void;
  onSave: () => Promise<void>;
  saveStatus: string;
  canEdit: boolean;
}) {
  const [globalFilter, setGlobalFilter] = useState("");
  const [selectedEventIndex, setSelectedEventIndex] = useState(0);
  const [adPayloadFilter, setAdPayloadFilter] = useState("");
  const [selectedAdPayloadGroupKey, setSelectedAdPayloadGroupKey] = useState("");
  const filteredEventIndexes = useMemo(() => {
    if (!spec) return [];
    const lower = globalFilter.toLowerCase();
    return spec.generatedEvents
      .map((event, index) => ({ event, index }))
      .filter(({ event }) =>
        [event.eventName, event.featurePack, event.category, event.status, event.trigger].join(" ").toLowerCase().includes(lower),
      )
      .map(({ index }) => index);
  }, [globalFilter, spec]);
  const adPayloadGroups = useMemo(() => adPayloadGroupsFor(spec?.platformAdPayloads ?? []), [spec?.platformAdPayloads]);
  const filteredAdPayloadGroups = useMemo(() => {
    if (!spec) return [];
    const lower = adPayloadFilter.toLowerCase();
    return adPayloadGroups.filter((group) =>
      [
        group.adFamily,
        group.canonicalPayloadName,
        group.description,
        group.example,
        group.requiredness,
        ...group.platformEventNames,
      ]
        .join(" ")
        .toLowerCase()
        .includes(lower),
    );
  }, [adPayloadFilter, adPayloadGroups, spec]);

  useEffect(() => {
    if (!spec?.generatedEvents.length) {
      setSelectedEventIndex(0);
      return;
    }
    if (selectedEventIndex >= spec.generatedEvents.length) {
      setSelectedEventIndex(spec.generatedEvents.length - 1);
    }
  }, [selectedEventIndex, spec?.generatedEvents.length]);

  useEffect(() => {
    if (!adPayloadGroups.length) {
      setSelectedAdPayloadGroupKey("");
      return;
    }
    if (!adPayloadGroups.some((group) => group.key === selectedAdPayloadGroupKey)) {
      setSelectedAdPayloadGroupKey(adPayloadGroups[0].key);
    }
  }, [adPayloadGroups, selectedAdPayloadGroupKey]);

  function updateEvent(rowIndex: number, patch: Partial<GeneratedEvent>) {
    if (!spec) return;
    const nextEvents = spec.generatedEvents.map((item, index) => (index === rowIndex ? { ...item, ...patch } : item));
    setSpec({ ...spec, generatedEvents: nextEvents });
  }

  function addCustomEvent() {
    if (!spec) return;
    const nextEvent = newCustomEvent(spec.generatedEvents.length + 1, "custom");
    setSpec({
      ...spec,
      generatedEvents: [...spec.generatedEvents, nextEvent],
    });
    setSelectedEventIndex(spec.generatedEvents.length);
  }

  function duplicateEvent(rowIndex: number) {
    if (!spec) return;
    const eventToDuplicate = spec.generatedEvents[rowIndex];
    if (!eventToDuplicate) return;
    const copiedName = uniqueEventName(spec.generatedEvents, `${eventToDuplicate.eventName}_copy`);
    const duplicatedEvent: GeneratedEvent = {
      ...eventToDuplicate,
      eventName: copiedName,
      payloadFields: eventToDuplicate.payloadFields.map((payload) => ({ ...payload })),
      sourceReferences: [...eventToDuplicate.sourceReferences],
      generationReason: eventToDuplicate.generationReason
        ? `${eventToDuplicate.generationReason} Duplicated during spec review.`
        : "Duplicated during spec review.",
      status: "Draft",
    };
    const nextEvents = [
      ...spec.generatedEvents.slice(0, rowIndex + 1),
      duplicatedEvent,
      ...spec.generatedEvents.slice(rowIndex + 1),
    ];
    setSpec({ ...spec, generatedEvents: nextEvents });
    setSelectedEventIndex(rowIndex + 1);
  }

  function deleteEvent(rowIndex: number) {
    if (!spec) return;
    const nextEvents = spec.generatedEvents.filter((_item, index) => index !== rowIndex);
    setSpec({ ...spec, generatedEvents: nextEvents });
    setSelectedEventIndex(Math.max(0, Math.min(rowIndex, nextEvents.length - 1)));
  }

  function updateEventPayload(rowIndex: number, payloadIndex: number, patch: Partial<GeneratedPayloadField>) {
    if (!spec) return;
    const eventRow = spec.generatedEvents[rowIndex];
    const nextPayloadFields = eventRow.payloadFields.map((payload, index) =>
      index === payloadIndex ? { ...payload, ...patch } : payload,
    );
    updateEvent(rowIndex, { payloadFields: nextPayloadFields });
  }

  function addEventPayload(rowIndex: number) {
    if (!spec) return;
    const eventRow = spec.generatedEvents[rowIndex];
    updateEvent(rowIndex, {
      payloadFields: [...eventRow.payloadFields, payloadFieldFromName(`custom_payload_${eventRow.payloadFields.length + 1}`)],
    });
  }

  function duplicateEventPayload(rowIndex: number, payloadIndex: number) {
    if (!spec) return;
    const eventRow = spec.generatedEvents[rowIndex];
    const payloadToDuplicate = eventRow.payloadFields[payloadIndex];
    if (!payloadToDuplicate) return;
    const copiedName = `${payloadToDuplicate.canonicalFieldName || payloadToDuplicate.fieldName || "payload"}_copy`;
    const duplicatedPayload: GeneratedPayloadField = {
      ...payloadToDuplicate,
      fieldName: copiedName,
      canonicalFieldName: copiedName,
      notes: payloadToDuplicate.notes
        ? `${payloadToDuplicate.notes} Duplicated during spec review.`
        : "Duplicated during spec review.",
    };
    updateEvent(rowIndex, {
      payloadFields: [
        ...eventRow.payloadFields.slice(0, payloadIndex + 1),
        duplicatedPayload,
        ...eventRow.payloadFields.slice(payloadIndex + 1),
      ],
    });
  }

  function deleteEventPayload(rowIndex: number, payloadIndex: number) {
    if (!spec) return;
    const eventRow = spec.generatedEvents[rowIndex];
    updateEvent(rowIndex, {
      payloadFields: eventRow.payloadFields.filter((_payload, index) => index !== payloadIndex),
    });
  }

  function updatePlatformAdPayloadGroup(
    group: AdPayloadGroup,
    patch: Partial<GeneratedSpec["platformAdPayloads"][number]>,
  ) {
    if (!spec) return;
    const targetRows = new Set(group.rowIndexes);
    const platformAdPayloads = spec.platformAdPayloads.map((payload, index) =>
      targetRows.has(index) ? { ...payload, ...patch } : payload,
    );
    setSpec({ ...spec, platformAdPayloads });
  }

  function deletePlatformAdPayloadGroup(group: AdPayloadGroup) {
    if (!spec) return;
    const targetRows = new Set(group.rowIndexes);
    setSpec({
      ...spec,
      platformAdPayloads: spec.platformAdPayloads.filter((_payload, index) => !targetRows.has(index)),
    });
    setSelectedAdPayloadGroupKey("");
  }

  if (!spec) {
    return (
      <section className="rounded-2xl border border-dashed border-line/70 bg-[linear-gradient(180deg,#0e1626,#0c1421)] p-10 text-center shadow-soft">
        <Sparkles className="mx-auto h-8 w-8 text-cobalt" />
        <h2 className="mt-4 font-display text-xl font-bold text-slate-200">No spec generated yet</h2>
        <p className="mt-2 text-sm text-slate-500">Fill the game intake and generate a draft analytics spec.</p>
      </section>
    );
  }

  const selectedEvent = spec.generatedEvents[selectedEventIndex] ?? null;
  const selectedAdPayloadGroup =
    filteredAdPayloadGroups.find((group) => group.key === selectedAdPayloadGroupKey) ?? filteredAdPayloadGroups[0] ?? null;

  return (
    <section className="space-y-[26px]">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cobalt">
            <span className="h-1.5 w-1.5 rounded-full bg-cobalt shadow-[0_0_10px_#3d82ff]" />
            Event Design · Editor
          </div>
          <h1 className="mt-3 font-display text-[34px] font-extrabold leading-none text-[#f4f6ff]">
            {spec.intake.gameTitle || "Untitled Spec"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Generated {new Date(spec.generatedAt).toLocaleString()} · {spec.generatedEvents.length} events
            {spec.intake.genre ? ` · ${spec.intake.genre}` : ""}
          </p>
          {saveStatus ? <p className="mt-1 text-xs font-semibold text-cobalt">{saveStatus}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canEdit}
            onClick={addCustomEvent}
            className="focus-ring inline-flex h-11 items-center gap-2 rounded-[10px] border border-line/70 bg-[#121b2c] px-4 text-sm font-semibold text-slate-300 hover:bg-[#17223a] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add Event
          </button>
          <button
            type="button"
            disabled={!canEdit}
            onClick={onSave}
            className="focus-ring inline-flex h-11 items-center gap-2 rounded-[10px] bg-cobalt px-[18px] text-sm font-semibold text-white shadow-[0_8px_22px_-8px_#3d82ff] hover:bg-cobalt/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Save Spec
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[14px] md:grid-cols-4">
        <EditorMetric label="Generated Events" value={spec.generatedEvents.length} />
        <EditorMetric label="Feature Packs" value={spec.selectedFeaturePacks.length} />
        <EditorMetric label="Ad Payloads" value={spec.platformAdPayloads.length} />
        <EditorMetric label="Review Status" value={reviewStatusForEvents(spec.generatedEvents)} />
      </div>

      <div className="grid items-start gap-[18px] xl:grid-cols-[minmax(280px,372px)_minmax(0,1fr)]">
          <div className="min-w-0 overflow-hidden rounded-2xl border border-line/70 bg-[#0b1120]">
            <div className="flex items-center gap-2 border-b border-line/60 bg-[#0d1424] px-4 py-3">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                value={globalFilter}
                onChange={(event) => setGlobalFilter(event.target.value)}
                placeholder="Filter events"
                className="focus-ring min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-300 outline-none placeholder:text-slate-500"
              />
              <span className="font-mono text-[10px] text-slate-600">{filteredEventIndexes.length}</span>
            </div>
            <div className="max-h-[640px] overflow-auto">
              {filteredEventIndexes.map((eventIndex) => {
                const eventRow = spec.generatedEvents[eventIndex];
                const isSelected = eventIndex === selectedEventIndex;
                const tone = categoryTone(`${eventRow.category} ${eventRow.featurePack} ${eventRow.eventName}`);
                return (
                  <button
                    key={`${eventRow.eventName}-${eventIndex}`}
                    type="button"
                    onClick={() => setSelectedEventIndex(eventIndex)}
                    className={`focus-ring block w-full border-b border-line/40 border-l-[3px] px-4 py-3 text-left text-sm ${tone.border} ${
                      isSelected ? "bg-[#141d30]" : "hover:bg-[#111a2c]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className={`truncate font-mono text-sm font-semibold ${tone.text}`}>{eventRow.eventName}</div>
                        <div className="mt-1 truncate text-xs text-slate-500">{eventRow.featurePack}</div>
                      </div>
                      <StatusChip status={eventRow.status} />
                    </div>
                    <div className="mt-2 line-clamp-2 text-xs text-slate-500">{eventRow.trigger}</div>
                    <div className="mt-2 font-mono text-[11px] font-semibold uppercase text-slate-500">
                      {eventRow.payloadFields.length} payloads
                    </div>
                  </button>
                );
              })}
              {!filteredEventIndexes.length ? (
                <div className="px-3 py-8 text-center text-sm text-slate-500">No matching events</div>
              ) : null}
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border border-line/70 bg-[linear-gradient(180deg,#0e1626,#0c1421)] p-[22px]">
            {selectedEvent ? (
              <div className="space-y-5">
                <div className="flex flex-col justify-between gap-3 border-b border-line/60 pb-4 md:flex-row md:items-start">
                  <div>
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                      Event Details
                    </div>
                    <h3 className={`mt-1 font-mono text-lg font-bold ${categoryTone(`${selectedEvent.category} ${selectedEvent.featurePack} ${selectedEvent.eventName}`).text}`}>
                      {selectedEvent.eventName}
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ToneChip tone={categoryTone(`${selectedEvent.category} ${selectedEvent.featurePack} ${selectedEvent.eventName}`)}>
                        {selectedEvent.category}
                      </ToneChip>
                      <span className="text-sm text-slate-500">{selectedEvent.featurePack}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => duplicateEvent(selectedEventIndex)}
                      className="focus-ring inline-flex items-center justify-center gap-2 rounded-[9px] border border-line/70 bg-[#121b2c] px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-[#17223a] disabled:opacity-50"
                    >
                      <Copy className="h-4 w-4" />
                      Duplicate Event
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => deleteEvent(selectedEventIndex)}
                      className="focus-ring inline-flex items-center justify-center gap-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 text-sm font-semibold text-rose hover:bg-rose/20 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete Event
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(160px,220px)_minmax(160px,220px)]">
                  <label className="block">
                    <span className={editorLabelClass}>Event Name</span>
                    <input
                      value={selectedEvent.eventName}
                      readOnly={!canEdit}
                      onChange={(event) => updateEvent(selectedEventIndex, { eventName: event.target.value })}
                      className={`${editorInputClass} font-mono`}
                    />
                  </label>
                  <label className="block">
                    <span className={editorLabelClass}>Grouping</span>
                    <select
                      value={eventGroupIdForEvent(selectedEvent)}
                      disabled={!canEdit}
                      onChange={(event) => updateEvent(selectedEventIndex, eventGroupPatch(event.target.value as EventGroupId))}
                      className={editorInputClass}
                    >
                      {eventGroupOptions.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={editorLabelClass}>Status</span>
                    <select
                      value={selectedEvent.status}
                      disabled={!canEdit}
                      onChange={(event) => updateEvent(selectedEventIndex, { status: event.target.value })}
                      className={editorInputClass}
                    >
                      <option>Draft</option>
                      <option>Reviewed</option>
                      <option>Needs changes</option>
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className={editorLabelClass}>Trigger Condition</span>
                  <textarea
                    value={selectedEvent.trigger}
                    readOnly={!canEdit}
                    onChange={(event) => updateEvent(selectedEventIndex, { trigger: event.target.value })}
                    className={`${editorTextareaClass} min-h-24`}
                  />
                </label>

                <div>
                  <div className="mb-3">
                    <h4 className="font-bold text-slate-200">Argument Details</h4>
                    <p className="text-sm text-slate-500">Edit the event argument key, value description, and example values.</p>
                  </div>
                  <div className="grid gap-3 rounded-xl border border-line/60 bg-[#0a111e] p-3 lg:grid-cols-[minmax(160px,220px)_minmax(0,1fr)_minmax(180px,260px)]">
                    <label className="block">
                      <span className={editorLabelClass}>Argument Type</span>
                      <input
                        aria-label={`${selectedEvent.eventName} argument type`}
                        value={selectedEvent.argumentName}
                        readOnly={!canEdit}
                        onChange={(event) => updateEvent(selectedEventIndex, { argumentName: event.target.value })}
                        className={`${editorInputClass} font-mono`}
                        placeholder="reason"
                      />
                    </label>
                    <label className="block">
                      <span className={editorLabelClass}>Argument Value Description</span>
                      <textarea
                        aria-label={`${selectedEvent.eventName} argument value description`}
                        value={selectedEvent.argumentDescription}
                        readOnly={!canEdit}
                        onChange={(event) => updateEvent(selectedEventIndex, { argumentDescription: event.target.value })}
                        className={`${editorTextareaClass} min-h-20`}
                        placeholder="<the reason for the game round to end>"
                      />
                    </label>
                    <label className="block">
                      <span className={editorLabelClass}>Argument Value Example</span>
                      <textarea
                        aria-label={`${selectedEvent.eventName} argument value example`}
                        value={selectedEvent.argumentExamples}
                        readOnly={!canEdit}
                        onChange={(event) => updateEvent(selectedEventIndex, { argumentExamples: event.target.value })}
                        className={`${editorTextareaClass} min-h-20 font-mono`}
                        placeholder='"win", "lose"'
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-slate-200">Payload Details</h4>
                      <p className="text-sm text-slate-500">Edit field names, descriptions, and example values for this event.</p>
                    </div>
                  </div>
                  <PayloadDetailsEditor
                    eventName={selectedEvent.eventName}
                    payloadFields={selectedEvent.payloadFields}
                    onChange={(payloadIndex, patch) => updateEventPayload(selectedEventIndex, payloadIndex, patch)}
                    onDelete={(payloadIndex) => deleteEventPayload(selectedEventIndex, payloadIndex)}
                    onDuplicate={(payloadIndex) => duplicateEventPayload(selectedEventIndex, payloadIndex)}
                    onAdd={() => addEventPayload(selectedEventIndex)}
                    canEdit={canEdit}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line/70 p-10 text-center text-sm text-slate-500">
                Select an event to review its details.
              </div>
            )}
          </div>
        </div>

      {spec.platformAdPayloads.length ? (
        <div className="rounded-2xl border border-line/70 bg-[linear-gradient(180deg,#0e1626,#0c1421)] p-[22px]">
          <div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h3 className="font-bold text-slate-200">Platform Ad Payload Enrichment</h3>
              <p className="mt-1 text-sm text-slate-500">
                Edit one payload definition per ad type. Changes apply to every platform-triggered event in that ad type.
              </p>
            </div>
            <span className="w-fit rounded-md border border-line/70 bg-[#121b2c] px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
              {adPayloadGroups.length} payload definitions
            </span>
          </div>

          <div className="mb-3 flex items-center gap-3 rounded-xl border border-line/70 bg-[#0a111e] px-3 py-2">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              value={adPayloadFilter}
              onChange={(event) => setAdPayloadFilter(event.target.value)}
              placeholder="Filter ad payloads..."
              className="focus-ring min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-300 outline-none placeholder:text-slate-500"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
            <div className="min-w-0 max-h-[560px] overflow-auto rounded-xl border border-line/70 bg-[#0b1120]">
              <div className="sticky top-0 border-b border-line/60 bg-[#0d1424] px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                Ad Payload Definitions
              </div>
              <div className="divide-y divide-line/40">
                {filteredAdPayloadGroups.map((group) => {
                  const isSelected = group.key === selectedAdPayloadGroup?.key;
                  const tone = categoryTone(`${group.adFamily} ad payload`);
                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => setSelectedAdPayloadGroupKey(group.key)}
                      className={`focus-ring block w-full border-l-2 px-3 py-3 text-left text-sm ${tone.border} ${
                        isSelected ? "bg-[#141d30]" : "hover:bg-[#111a2c]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className={`truncate font-mono text-sm font-semibold ${tone.text}`}>{group.canonicalPayloadName}</div>
                          <div className="mt-1 truncate text-xs text-slate-500">{group.adFamily} Ads</div>
                        </div>
                        <ToneChip tone={tone}>{group.platformEventNames.length} events</ToneChip>
                      </div>
                      <div className="mt-2 line-clamp-2 text-xs text-slate-500">{group.description}</div>
                      <div className="mt-2 truncate font-mono text-xs text-slate-500">{group.example}</div>
                    </button>
                  );
                })}
                {!filteredAdPayloadGroups.length ? (
                  <div className="px-3 py-8 text-center text-sm text-slate-500">No matching ad payloads</div>
                ) : null}
              </div>
            </div>

            <div className="min-w-0 rounded-xl border border-line/70 bg-[#0a111e] p-4">
              {selectedAdPayloadGroup ? (
                <div className="space-y-5">
                  <div className="flex flex-col justify-between gap-3 border-b border-line/60 pb-4 md:flex-row md:items-start">
                    <div>
                      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                        Ad Payload Definition
                      </div>
                      <h4 className={`mt-1 font-mono text-lg font-bold ${categoryTone(`${selectedAdPayloadGroup.adFamily} ad payload`).text}`}>
                        {selectedAdPayloadGroup.canonicalPayloadName}
                      </h4>
                      <p className="text-sm text-slate-500">
                        Applies to all {selectedAdPayloadGroup.adFamily.toLowerCase()} platform ad events.
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ToneChip tone={categoryTone(`${selectedAdPayloadGroup.adFamily} ad payload`)}>
                        {selectedAdPayloadGroup.requiredness}
                      </ToneChip>
                      <button
                        type="button"
                        title="Remove ad payload"
                        aria-label={`Remove ${selectedAdPayloadGroup.canonicalPayloadName} from ${selectedAdPayloadGroup.adFamily} ad events`}
                        disabled={!canEdit}
                        onClick={() => deletePlatformAdPayloadGroup(selectedAdPayloadGroup)}
                        className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose/40 bg-rose/10 text-rose hover:bg-rose/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                    <div className="rounded-xl border border-line/60 bg-[#0d1424] p-3">
                      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                        Ad Family
                      </div>
                      <div className="mt-1 break-words text-sm font-semibold text-slate-300">{selectedAdPayloadGroup.adFamily}</div>
                    </div>
                    <div className="rounded-xl border border-line/60 bg-[#0d1424] p-3">
                      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                        Affected Events
                      </div>
                      <div className="mt-1 break-words text-sm font-semibold text-slate-300">
                        {selectedAdPayloadGroup.platformEventNames.join(", ")}
                      </div>
                    </div>
                  </div>

                  <label className="block">
                    <span className={editorLabelClass}>Payload Name</span>
                    <input
                      data-testid="ad-payload-name"
                      aria-label={`${selectedAdPayloadGroup.adFamily} ${selectedAdPayloadGroup.canonicalPayloadName} payload name`}
                      value={selectedAdPayloadGroup.canonicalPayloadName}
                      readOnly={!canEdit}
                      onChange={(event) => {
                        const nextName = event.target.value;
                        updatePlatformAdPayloadGroup(selectedAdPayloadGroup, {
                          payloadName: nextName,
                          canonicalPayloadName: nextName,
                        });
                        setSelectedAdPayloadGroupKey(adPayloadGroupKey(selectedAdPayloadGroup.adFamily, nextName));
                      }}
                      className={`${editorInputClass} font-mono`}
                    />
                  </label>

                  <label className="block">
                    <span className={editorLabelClass}>Requiredness</span>
                    <input
                      data-testid="ad-payload-requiredness"
                      aria-label={`${selectedAdPayloadGroup.adFamily} ${selectedAdPayloadGroup.canonicalPayloadName} requiredness`}
                      value={selectedAdPayloadGroup.requiredness}
                      readOnly={!canEdit}
                      onChange={(event) =>
                        updatePlatformAdPayloadGroup(selectedAdPayloadGroup, { requiredness: event.target.value })
                      }
                      className={editorInputClass}
                    />
                  </label>

                  <label className="block">
                    <span className={editorLabelClass}>Description</span>
                    <textarea
                      data-testid="ad-payload-description"
                      aria-label={`${selectedAdPayloadGroup.adFamily} ${selectedAdPayloadGroup.canonicalPayloadName} platform description`}
                      value={selectedAdPayloadGroup.description}
                      readOnly={!canEdit}
                      onChange={(event) =>
                        updatePlatformAdPayloadGroup(selectedAdPayloadGroup, { description: event.target.value })
                      }
                      className={`${editorTextareaClass} min-h-24`}
                    />
                  </label>

                  <label className="block">
                    <span className={editorLabelClass}>Example</span>
                    <textarea
                      data-testid="ad-payload-example"
                      aria-label={`${selectedAdPayloadGroup.adFamily} ${selectedAdPayloadGroup.canonicalPayloadName} platform example`}
                      value={selectedAdPayloadGroup.example}
                      readOnly={!canEdit}
                      onChange={(event) => updatePlatformAdPayloadGroup(selectedAdPayloadGroup, { example: event.target.value })}
                      className={`${editorTextareaClass} min-h-20 font-mono`}
                    />
                  </label>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-line/70 p-10 text-center text-sm text-slate-500">
                  Select an ad payload to review its details.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ImportDetailsDialog({
  file,
  gameTitle,
  genre,
  isImporting,
  onGameTitleChange,
  onGenreChange,
  onCancel,
  onSubmit,
}: {
  file: File | null;
  gameTitle: string;
  genre: string;
  isImporting: boolean;
  onGameTitleChange: (value: string) => void;
  onGenreChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!file) return null;
  const canSubmit = Boolean(gameTitle.trim()) && !isImporting;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-line/70 bg-[#0d1424] p-5 shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-cobalt">Saved Specs</div>
            <h3 className="mt-2 font-display text-lg font-bold text-[#f2f5ff]">Import Spec Details</h3>
            <p className="mt-1 text-sm text-slate-500">{file.name}</p>
          </div>
          <button
            type="button"
            aria-label="Cancel import"
            disabled={isImporting}
            onClick={onCancel}
            className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-line/70 bg-[#0a111e] text-slate-500 hover:bg-[#17223a] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className={editorLabelClass}>Game Name</span>
            <input
              value={gameTitle}
              onChange={(event) => onGameTitleChange(event.target.value)}
              className={editorInputClass}
              required
              autoFocus
            />
          </label>
          <label className="block">
            <span className={editorLabelClass}>Genre</span>
            <input
              value={genre}
              onChange={(event) => onGenreChange(event.target.value)}
              placeholder="Optional"
              className={editorInputClass}
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={isImporting}
            onClick={onCancel}
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-[9px] border border-line/70 bg-[#121b2c] px-3 text-sm font-semibold text-text-muted hover:bg-[#17223a] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-cobalt px-3 text-sm font-semibold text-white hover:bg-cobalt/90 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {isImporting ? "Importing..." : "Save Imported Spec"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SavedSpecsBrowser({
  savedSpecs,
  onOpen,
  onEdit,
  onDelete,
  onImport,
  canImport,
  importStatus,
  isImporting,
}: {
  savedSpecs: SavedSpecSummary[];
  onOpen: (id: string) => Promise<void>;
  onEdit: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onImport: (file: File, details: { gameTitle: string; genre: string }) => Promise<void>;
  canImport: boolean;
  importStatus: string;
  isImporting: boolean;
}) {
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importGameTitle, setImportGameTitle] = useState("");
  const [importGenre, setImportGenre] = useState("");

  function titleFromFile(file: File) {
    return file.name.replace(/\.(xlsx|csv)$/i, "").trim();
  }

  function stageImport(file: File) {
    setPendingImportFile(file);
    setImportGameTitle(titleFromFile(file));
    setImportGenre("");
  }

  function closeImportDetails() {
    if (isImporting) return;
    setPendingImportFile(null);
    setImportGameTitle("");
    setImportGenre("");
  }

  async function submitImportDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingImportFile || !importGameTitle.trim()) return;
    await onImport(pendingImportFile, {
      gameTitle: importGameTitle.trim(),
      genre: importGenre.trim(),
    });
    closeImportDetails();
  }

  function ImportControl() {
    if (!canImport) return null;
    return (
      <label className="focus-ring inline-flex h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-line/70 bg-[#121b2c] px-4 text-sm font-semibold text-text-muted hover:bg-[#17223a]">
        <Upload className="h-4 w-4" />
        {isImporting ? "Importing..." : "Import Spec"}
        <input
          type="file"
          accept=".xlsx,.csv"
          disabled={isImporting}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) stageImport(file);
          }}
        />
      </label>
    );
  }

  if (!savedSpecs.length) {
    return (
      <section className="space-y-6">
        <ImportDetailsDialog
          file={pendingImportFile}
          gameTitle={importGameTitle}
          genre={importGenre}
          isImporting={isImporting}
          onGameTitleChange={setImportGameTitle}
          onGenreChange={setImportGenre}
          onCancel={closeImportDetails}
          onSubmit={submitImportDetails}
        />
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cobalt">
            <span className="h-1.5 w-1.5 rounded-full bg-cobalt shadow-[0_0_10px_#3d82ff]" />
            Event Design · Saved Specs
          </div>
          <h1 className="mt-3 font-display text-[34px] font-extrabold leading-none text-[#f4f6ff]">Saved Specs</h1>
          <p className="mt-2 text-[13.5px] text-slate-500">Saved Game Specs are ready to view, edit if you own them, or import from XLSX / CSV.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-line/70 bg-[#0b1120] px-6 py-14 text-center shadow-soft">
          <FileText className="mx-auto h-8 w-8 text-cobalt" />
          <h2 className="mt-4 font-display text-xl font-bold text-[#f2f5ff]">No saved specs yet</h2>
          <p className="mt-2 text-sm text-slate-500">Generate a draft or import an existing analytics spec.</p>
          <div className="mt-5 flex justify-center">
            <ImportControl />
          </div>
          {importStatus ? <p className="mt-3 text-sm font-semibold text-cobalt">{importStatus}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <ImportDetailsDialog
        file={pendingImportFile}
        gameTitle={importGameTitle}
        genre={importGenre}
        isImporting={isImporting}
        onGameTitleChange={setImportGameTitle}
        onGenreChange={setImportGenre}
        onCancel={closeImportDetails}
        onSubmit={submitImportDetails}
      />
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cobalt">
            <span className="h-1.5 w-1.5 rounded-full bg-cobalt shadow-[0_0_10px_#3d82ff]" />
            Event Design · Saved Specs
          </div>
          <h1 className="mt-3 font-display text-[34px] font-extrabold leading-none text-[#f4f6ff]">Saved Specs</h1>
          <p className="mt-2 text-[13.5px] text-slate-500">
            Saved Game Specs · {savedSpecs.length} {savedSpecs.length === 1 ? "spec" : "specs"} · open to view, edit if you own them, or import from XLSX / CSV.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ImportControl />
          <div className="rounded-[10px] border border-line/70 bg-[#0d1424] px-3 py-2 text-right">
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">Saved Specs</div>
            <div className="mt-0.5 font-display text-xl font-extrabold text-cobalt">{savedSpecs.length}</div>
          </div>
        </div>
      </div>
      {importStatus ? <p className="rounded-[10px] border border-cobalt/20 bg-cobalt/10 px-4 py-3 text-sm font-semibold text-cobalt">{importStatus}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {savedSpecs.map((savedSpec) => {
          const initials = savedSpec.gameTitle
            .split(/[\s_-]+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase())
            .join("");
          const owner = savedSpec.ownerName || savedSpec.ownerEmail || "Legacy";
          return (
            <article key={savedSpec.id} className="flex min-h-[272px] flex-col rounded-2xl border border-line/70 bg-[linear-gradient(180deg,#0e1626,#0c1421)] p-5 shadow-soft transition-colors hover:border-line">
              <div className="flex items-start justify-between gap-3">
                <div className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] border font-display text-sm font-extrabold ${statusTone(savedSpec.status).chip}`}>
                  {initials || "SP"}
                </div>
                <StatusChip status={savedSpec.status} />
              </div>
              <h2 className="mt-4 truncate font-display text-[17px] font-bold text-[#f2f5ff]">{savedSpec.gameTitle}</h2>
              <p className="mt-1 truncate text-[12.5px] text-slate-500">{savedSpec.genre || "Unspecified"}</p>
              <div className="mt-4 flex items-end gap-[18px] border-t border-line/40 pt-4">
                <div>
                  <div className="font-display text-lg font-extrabold text-[#eaeefc]">{savedSpec.eventCount}</div>
                  <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500">Events</div>
                </div>
                <div>
                  <div className="font-display text-lg font-extrabold text-[#eaeefc]">{savedSpec.payloadCount}</div>
                  <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500">Payloads</div>
                </div>
                <div className="ml-auto min-w-0 text-right">
                  <div className="truncate text-[11.5px] text-slate-500">{new Date(savedSpec.updatedAt).toLocaleDateString()}</div>
                  <div className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.06em] text-slate-600" title={owner}>{owner}</div>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  title="Open in Spec Viewer"
                  aria-label="Open"
                  onClick={() => onOpen(savedSpec.id)}
                  className="focus-ring inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-[9px] border border-line/70 bg-[#101a2c] px-3 text-xs font-semibold text-text-muted hover:bg-[#16223a]"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Open
                </button>
                {savedSpec.canEdit ? (
                  <button
                    type="button"
                    title="Edit in Editor"
                    aria-label={`Edit ${savedSpec.gameTitle} in Editor`}
                    onClick={() => onEdit(savedSpec.id)}
                    className="focus-ring inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-[9px] bg-cobalt px-3 text-xs font-semibold text-white hover:bg-cobalt/90"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                ) : null}
                {savedSpec.canDelete ? (
                  <button
                    type="button"
                    title="Delete saved spec"
                    aria-label="Delete"
                    onClick={() => {
                      if (window.confirm(`Delete ${savedSpec.gameTitle}?`)) void onDelete(savedSpec.id);
                    }}
                    className="focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-rose/40 bg-rose/10 text-rose hover:bg-rose/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PartnerDomainAccessAdmin() {
  const [domains, setDomains] = useState<PartnerDomainAccess[]>([]);
  const [domain, setDomain] = useState("");
  const [allowedApps, setAllowedApps] = useState<string[]>([]);
  const [expiresOn, setExpiresOn] = useState(defaultPartnerExpiryDate);
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function loadDomains() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/partner-access-domains");
      if (!response.ok) throw new Error(await response.text());
      setDomains((await response.json()) as PartnerDomainAccess[]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load partner domains");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadDomains();
  }, []);

  function resetForm() {
    setDomain("");
    setAllowedApps([]);
    setExpiresOn(defaultPartnerExpiryDate());
    setEnabled(true);
  }

  function toggleApp(app: string) {
    setAllowedApps((current) => (current.includes(app) ? current.filter((item) => item !== app) : [...current, app]));
  }

  async function saveDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Saving partner access...");
    try {
      const response = await fetch("/api/partner-access-domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, enabled, expiresOn, allowedApps }),
      });
      if (!response.ok) throw new Error(await response.text());
      const saved = (await response.json()) as PartnerDomainAccess;
      setDomains((current) => [...current.filter((item) => item.domain !== saved.domain), saved].sort((a, b) => a.domain.localeCompare(b.domain)));
      resetForm();
      setStatus("Partner domain saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save partner domain");
    }
  }

  function editDomain(item: PartnerDomainAccess) {
    setDomain(item.domain);
    setAllowedApps(item.allowedApps);
    setExpiresOn(item.expiresAt.slice(0, 10));
    setEnabled(item.enabled);
    setStatus(`Editing ${item.domain}`);
  }

  async function removeDomain(value: string) {
    setStatus(`Revoking ${value}...`);
    try {
      const response = await fetch("/api/partner-access-domains", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: value }),
      });
      if (!response.ok) throw new Error(await response.text());
      setDomains((current) => current.filter((item) => item.domain !== value));
      if (domain === value) resetForm();
      setStatus("Partner domain revoked");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not revoke partner domain");
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-line/70 bg-[#0b1120] p-5 shadow-soft">
      <div>
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald">Partner access</div>
        <h2 className="mt-2 text-lg font-bold text-[#f4f6ff]">Launch Readiness partner domains</h2>
        <p className="mt-1 text-sm text-slate-500">Verified Google users at an active domain inherit these permitted apps.</p>
      </div>
      {status ? <p className="rounded-[9px] border border-cobalt/20 bg-cobalt/10 px-3 py-2 text-sm text-cobalt">{status}</p> : null}
      <form onSubmit={saveDomain} className="grid gap-4 rounded-[12px] border border-line/60 bg-[#0d1424] p-4 lg:grid-cols-[minmax(180px,1fr)_160px_auto]">
        <label className="block">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Corporate domain</span>
          <input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="partnerstudio.com" required className="focus-ring mt-1.5 h-10 w-full rounded-[8px] border border-line/70 bg-[#101a2c] px-3 text-sm text-slate-200" />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Expires on</span>
          <input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} required className="focus-ring mt-1.5 h-10 w-full rounded-[8px] border border-line/70 bg-[#101a2c] px-3 text-sm text-slate-200" />
        </label>
        <label className="mt-6 inline-flex h-10 items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-4 w-4 accent-cobalt" /> Enabled
        </label>
        <fieldset className="lg:col-span-3">
          <legend className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Permitted apps</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {techLaunchApps.map((app) => (
              <label key={app} className={`inline-flex cursor-pointer items-center gap-2 rounded-[7px] border px-2.5 py-1.5 text-xs font-semibold ${allowedApps.includes(app) ? "border-emerald/40 bg-emerald/10 text-emerald" : "border-line/70 text-slate-400"}`}>
                <input type="checkbox" checked={allowedApps.includes(app)} onChange={() => toggleApp(app)} className="sr-only" />
                {app}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex gap-2 lg:col-span-3">
          <button type="submit" className="focus-ring inline-flex h-10 items-center gap-2 rounded-[8px] bg-cobalt px-4 text-sm font-semibold text-white hover:bg-cobalt/90"><Plus className="h-4 w-4" />{domain ? "Save domain" : "Add domain"}</button>
          <button type="button" onClick={resetForm} className="focus-ring h-10 rounded-[8px] border border-line/70 px-4 text-sm font-semibold text-slate-400 hover:bg-[#17223a]">Clear</button>
        </div>
      </form>
      <div className="overflow-x-auto rounded-[12px] border border-line/60">
        <div className="grid min-w-[680px] grid-cols-[1.2fr_1.7fr_140px_170px] border-b border-line/50 bg-[#0a1120] px-4 py-2.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.09em] text-slate-500"><div>Domain</div><div>Apps</div><div>Expiry</div><div className="text-right">Manage</div></div>
        {domains.map((item) => (
          <div key={item.domain} className="grid min-w-[680px] grid-cols-[1.2fr_1.7fr_140px_170px] items-center border-b border-line/40 px-4 py-3 text-sm last:border-b-0">
            <div className="font-semibold text-slate-200">{item.domain}<span className={`ml-2 rounded px-1.5 py-0.5 font-mono text-[9px] ${item.enabled && new Date(item.expiresAt).getTime() > Date.now() ? "bg-emerald/10 text-emerald" : "bg-rose/10 text-rose"}`}>{item.enabled && new Date(item.expiresAt).getTime() > Date.now() ? "active" : item.enabled ? "expired" : "disabled"}</span></div>
            <div className="text-xs text-slate-400">{item.allowedApps.join(", ")}</div>
            <div className="font-mono text-xs text-slate-400">{item.expiresAt.slice(0, 10)}</div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => editDomain(item)} className="focus-ring rounded-[7px] border border-line/70 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-[#17223a]">Edit</button><button type="button" onClick={() => void removeDomain(item.domain)} className="focus-ring inline-flex rounded-[7px] border border-rose/40 px-2.5 py-1.5 text-xs font-semibold text-rose hover:bg-rose/10"><Trash2 className="mr-1 h-3.5 w-3.5" />Revoke</button></div>
          </div>
        ))}
        {!domains.length && !isLoading ? <p className="px-4 py-8 text-center text-sm text-slate-500">No partner domains configured.</p> : null}
        {isLoading ? <p className="px-4 py-8 text-center text-sm text-slate-500">Loading partner domains...</p> : null}
      </div>
    </section>
  );
}

function UserRoleAdmin({ currentUser }: { currentUser: AppUser | null }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("");

  async function loadUsers() {
    setIsLoading(true);
    setStatus("");
    try {
      const response = await fetch("/api/users");
      if (!response.ok) throw new Error(await response.text());
      setUsers((await response.json()) as AppUser[]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load users");
    } finally {
      setIsLoading(false);
    }
  }

  async function updateRole(id: string, role: UserRole) {
    setStatus("Saving role...");
    try {
      const response = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) throw new Error(await response.text());
      const updated = (await response.json()) as AppUser;
      setUsers((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setStatus("Role updated");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update role");
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cobalt">
          <span className="h-1.5 w-1.5 rounded-full bg-cobalt shadow-[0_0_10px_#3d82ff]" />
          Event Design · Users
        </div>
        <h1 className="mt-3 font-display text-[34px] font-extrabold leading-none text-[#f4f6ff]">User Access</h1>
        <p className="mt-2 text-[13.5px] text-slate-500">Admins manage roles. Access is gated to approved organization accounts.</p>
      </div>

      {status ? <p className="rounded-[10px] border border-cobalt/20 bg-cobalt/10 px-4 py-3 text-sm font-semibold text-cobalt">{status}</p> : null}

      <div className="w-full overflow-x-auto rounded-2xl border border-line/70 bg-[#0b1120] shadow-soft">
        <div className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_220px_180px] border-b border-line/50 bg-[#0a1120] px-5 py-3 font-mono text-[9.5px] font-semibold uppercase tracking-[0.09em] text-slate-500">
          <div>User</div><div>Role</div><div className="text-right">Manage</div>
        </div>
        <div className="max-h-[620px] overflow-auto">
          {users.map((user) => {
            const displayName = user.name || user.email;
            const initials = displayName
              .split(/[.\s@_-]+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase())
              .join("");
            const roleTone = user.role === "admin"
              ? "border-cobalt/30 bg-cobalt/10 text-cobalt"
              : user.role === "editor"
                ? "border-emerald/30 bg-emerald/10 text-emerald"
                : "border-cyan/30 bg-cyan/10 text-cyan";
            const isCurrentUser = user.id === currentUser?.id;
            const isExternalUser = !user.email.toLowerCase().endsWith("@tripledotstudios.com");
            return (
              <div key={user.id} className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_220px_180px] items-center border-b border-line/40 px-5 py-3.5 last:border-b-0 hover:bg-[#0e1626]">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border font-display text-[13px] font-bold ${roleTone}`}>
                    {initials || "US"}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold text-[#eaeefc]">{displayName}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{user.email}</div>
                  </div>
                </div>
                <div>
                  <span className={`inline-flex items-center gap-2 rounded-[8px] border px-2.5 py-1.5 font-mono text-[10.5px] font-semibold capitalize ${roleTone}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {roleLabels[user.role]}
                  </span>
                </div>
                <div className="flex justify-end">
                  <select
                    aria-label={`Change ${displayName} role`}
                    value={user.role}
                    disabled={isCurrentUser || isExternalUser}
                    onChange={(event) => void updateRole(user.id, event.target.value as UserRole)}
                    className="focus-ring h-9 w-[132px] rounded-[8px] border border-line/70 bg-[#101a2c] px-2 text-xs font-semibold text-slate-300 hover:bg-[#16223a] disabled:cursor-not-allowed disabled:opacity-50"
                    title={isExternalUser ? "External users are always viewers" : isCurrentUser ? "Your role cannot be changed here" : "Change user role"}
                  >
                    {(["admin", "editor", "viewer"] as UserRole[]).map((role) => (
                      <option key={role} value={role}>{roleLabels[role]}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
          {!users.length && !isLoading ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">No users have signed in yet.</div>
          ) : null}
          {isLoading ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">Loading users...</div>
          ) : null}
        </div>
      </div>
      <PartnerDomainAccessAdmin />
    </section>
  );
}

type SpecViewerRow = {
  id: string;
  eventName: string;
  category: string;
  featurePack: string;
  trigger: string;
  argumentName: string;
  argumentDescription: string;
  argumentExamples: string;
  payloadName: string;
  payloadDescription: string;
  payloadExample: string;
  payloadType: string;
  requiredness: string;
  notes: string;
  status: string;
};

type SpecViewerGroupId = "gameplay" | "economy" | "iap" | "iaa" | "liveOps" | "other";

type SpecViewerGroup = {
  id: SpecViewerGroupId;
  label: string;
  description: string;
  events: GeneratedEvent[];
  platformAdPayloads: PlatformAdPayloadRow[];
};

const specViewerGroupMeta: Array<Pick<SpecViewerGroup, "id" | "label" | "description">> = [
  {
    id: "gameplay",
    label: "Core Gameplay",
    description: "Core round lifecycle specs: Game_Start and Game_End.",
  },
  {
    id: "economy",
    label: "Economy",
    description: "Currency_Transaction and Item_Transaction specs.",
  },
  {
    id: "iap",
    label: "IAP",
    description: "Store_Open and Store_Product_Purchase_* specs.",
  },
  {
    id: "iaa",
    label: "IAA",
    description: "Platform ad event payload specs for Ad_* events.",
  },
  {
    id: "liveOps",
    label: "Live Ops",
    description: "Event_Start, Event_Progress, and Event_End specs.",
  },
  {
    id: "other",
    label: "Other",
    description: "Additional custom or uncategorized event specs.",
  },
];

function groupIdForEvent(event: GeneratedEvent): SpecViewerGroupId {
  const groupId = eventGroupIdForEvent(event);
  if (groupId !== "custom") return groupId;
  const eventName = event.eventName;
  if (eventName === "Game_Start" || eventName === "Game_End") return "gameplay";
  if (eventName === "Currency_Transaction" || eventName === "Item_Transaction") return "economy";
  if (eventName === "Store_Open" || eventName.startsWith("Store_Product_Purchase_")) return "iap";
  if (eventName.startsWith("Ad_")) return "iaa";
  if (eventName.startsWith("Event_")) return "liveOps";
  return "other";
}

function payloadCountForEvents(events: GeneratedEvent[]) {
  return events.reduce((total, event) => total + event.payloadFields.length, 0);
}

function platformEventCount(payloads: PlatformAdPayloadRow[]) {
  return new Set(payloads.map((payload) => payload.platformEventName)).size;
}

function specViewerGroupsFor(spec: GeneratedSpec): SpecViewerGroup[] {
  const groups = new Map<SpecViewerGroupId, SpecViewerGroup>(
    specViewerGroupMeta.map((meta) => [meta.id, { ...meta, events: [], platformAdPayloads: [] }]),
  );

  spec.generatedEvents.forEach((event) => {
    groups.get(groupIdForEvent(event))?.events.push(event);
  });

  spec.platformAdPayloads.forEach((payload) => {
    groups.get("iaa")?.platformAdPayloads.push(payload);
  });

  return [...groups.values()].filter((group) => group.events.length || group.platformAdPayloads.length);
}

function eventMatchesQuery(event: GeneratedEvent, lowerQuery: string) {
  if (!lowerQuery) return true;
  return [
    event.eventName,
    event.category,
    event.featurePack,
    event.trigger,
    event.argumentName,
    event.argumentDescription,
    event.argumentExamples,
    event.status,
    ...event.payloadFields.flatMap((payload) => [
      payload.canonicalFieldName,
      payload.description,
      payload.example,
      payload.type,
      payload.requiredness,
      payload.notes,
    ]),
  ]
    .join(" ")
    .toLowerCase()
    .includes(lowerQuery);
}

function adPayloadMatchesQuery(payload: PlatformAdPayloadRow, lowerQuery: string) {
  if (!lowerQuery) return true;
  return [
    payload.platformEventName,
    payload.adFamily,
    payload.canonicalPayloadName,
    payload.description,
    payload.example,
    payload.requiredness,
  ]
    .join(" ")
    .toLowerCase()
    .includes(lowerQuery);
}

function groupedPlatformAdPayloads(payloads: PlatformAdPayloadRow[]) {
  const groups = new Map<string, { eventName: string; adFamily: string; payloads: PlatformAdPayloadRow[] }>();
  payloads.forEach((payload) => {
    const existing = groups.get(payload.platformEventName);
    if (existing) {
      existing.payloads.push(payload);
      return;
    }
    groups.set(payload.platformEventName, {
      eventName: payload.platformEventName,
      adFamily: payload.adFamily,
      payloads: [payload],
    });
  });
  return [...groups.values()].sort((left, right) => left.eventName.localeCompare(right.eventName));
}

function rowsForSpec(spec: GeneratedSpec): SpecViewerRow[] {
  return spec.generatedEvents.flatMap((event) => {
    if (!event.payloadFields.length) {
      return [
        {
          id: `${event.eventName}-event`,
          eventName: event.eventName,
          category: event.category,
          featurePack: event.featurePack,
          trigger: event.trigger,
          argumentName: event.argumentName,
          argumentDescription: event.argumentDescription,
          argumentExamples: event.argumentExamples,
          payloadName: "",
          payloadDescription: "",
          payloadExample: "",
          payloadType: "",
          requiredness: "",
          notes: "",
          status: event.status,
        },
      ];
    }
    return event.payloadFields.map((payload, payloadIndex) => ({
      id: `${event.eventName}-${payload.canonicalFieldName}-${payloadIndex}`,
      eventName: event.eventName,
      category: event.category,
      featurePack: event.featurePack,
      trigger: event.trigger,
      argumentName: event.argumentName,
      argumentDescription: event.argumentDescription,
      argumentExamples: event.argumentExamples,
      payloadName: payload.canonicalFieldName,
      payloadDescription: payload.description,
      payloadExample: payload.example,
      payloadType: payload.type,
      requiredness: payload.requiredness,
      notes: payload.notes,
      status: event.status,
    }));
  });
}

function ViewerEventRow({ event }: { event: GeneratedEvent }) {
  const tone = categoryTone(`${event.category} ${event.featurePack} ${event.eventName}`);
  return (
    <article className="overflow-hidden rounded-[12px] border border-line/70 bg-[#0b1120] shadow-[0_8px_18px_rgba(0,0,0,0.12)] transition-colors hover:border-line hover:bg-[#0e1626]">
      <div className={`h-0.5 ${tone.bar}`} />
      <div className="grid min-w-[760px] grid-cols-[1.4fr_150px_2fr_90px] border-b border-line/40 bg-[#0a1120] px-5 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
        <div>Event</div><div>Category</div><div>Trigger</div><div className="text-right">Payloads</div>
      </div>
      <div className="grid min-w-[760px] grid-cols-[1.4fr_150px_2fr_90px] items-center px-5 py-4">
        <div className="min-w-0 pr-4">
          <h3 className={`truncate font-mono text-[15px] font-semibold ${tone.text}`}>{event.eventName}</h3>
          <p className="mt-1 truncate text-[13px] text-slate-500">{event.featurePack}</p>
        </div>
        <div>
          <span className={`inline-flex rounded-[7px] border px-2.5 py-1 font-mono text-[11px] font-semibold ${tone.chip}`}>{event.category || "Other"}</span>
        </div>
        <p className="pr-4 text-[14px] leading-relaxed text-slate-400">{event.trigger || "No trigger description yet."}</p>
        <div className="text-right font-mono text-[15px] font-semibold text-slate-300">{event.payloadFields.length}</div>
      </div>

      {(event.argumentName || event.argumentDescription || event.argumentExamples || event.payloadFields.length) ? (
        <div className="border-t border-line/30 bg-[#090f1b] px-5 py-4">
          {(event.argumentName || event.argumentDescription || event.argumentExamples) ? (
            <section aria-label="Event context" className="mb-4 rounded-[10px] border border-line/50 bg-[#0d1626] p-4">
              <div className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Event Context</div>
              <div className="grid gap-4 md:grid-cols-[1.1fr_1.1fr_1fr]">
                <div>
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Argument</div>
                  <div className={`mt-1.5 font-mono text-[14px] font-semibold ${tone.text}`}>{event.argumentName || "-"}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Description</div>
                  <div className="mt-1.5 text-[13.5px] leading-relaxed text-slate-300">{event.argumentDescription || "-"}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Examples</div>
                  <div className="mt-1.5 font-mono text-[13px] leading-relaxed text-slate-300">{event.argumentExamples || "-"}</div>
                </div>
              </div>
            </section>
          ) : null}
          <div className="overflow-x-auto">
            <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Payload Definition</div>
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
                <tr>
                  <th className="pb-2.5 pr-3 font-semibold">Payload</th>
                  <th className="pb-2.5 px-3 font-semibold">Description</th>
                  <th className="pb-2.5 px-3 font-semibold">Example</th>
                  <th className="pb-2.5 pl-3 font-semibold">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/30">
                {event.payloadFields.map((payload, payloadIndex) => (
                  <tr key={`${event.eventName}-${payload.canonicalFieldName}-${payloadIndex}`}>
                    <td className={`py-3 pr-3 align-top font-mono text-[14px] font-semibold ${tone.text}`}>{payload.canonicalFieldName}</td>
                    <td className="px-3 py-3 align-top text-[14px] leading-relaxed text-slate-300">{payload.description}</td>
                    <td className="px-3 py-3 align-top font-mono text-[13px] text-emerald">{payload.example}</td>
                    <td className="py-3 pl-3 align-top"><DataTypePill type={payload.type} /></td>
                  </tr>
                ))}
                {!event.payloadFields.length ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-sm text-slate-500">No payloads specified for this event.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ViewerPlatformAdRow({
  eventName,
  adFamily,
  payloads,
}: {
  eventName: string;
  adFamily: string;
  payloads: PlatformAdPayloadRow[];
}) {
  const tone = categoryTone(`${adFamily} ad event`);
  return (
    <article className="overflow-hidden rounded-[12px] border border-line/70 bg-[#0b1120] shadow-[0_8px_18px_rgba(0,0,0,0.12)] transition-colors hover:border-line hover:bg-[#0e1626]">
      <div className={`h-0.5 ${tone.bar}`} />
      <div className="grid min-w-[760px] grid-cols-[1.4fr_150px_2fr_90px] border-b border-line/40 bg-[#0a1120] px-5 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
        <div>Event</div><div>Category</div><div>Trigger</div><div className="text-right">Payloads</div>
      </div>
      <div className="grid min-w-[760px] grid-cols-[1.4fr_150px_2fr_90px] items-center px-5 py-4">
        <div className="min-w-0 pr-4">
          <h3 className={`truncate font-mono text-[15px] font-semibold ${tone.text}`}>{eventName}</h3>
          <p className="mt-1 truncate text-[13px] text-slate-500">Platform Ad Payload Enrichment</p>
        </div>
        <div><span className={`inline-flex rounded-[7px] border px-2.5 py-1 font-mono text-[11px] font-semibold ${tone.chip}`}>IAA</span></div>
        <p className="pr-4 text-[14px] leading-relaxed text-slate-400">{adFamily} platform ad event payloads.</p>
        <div className="text-right font-mono text-[15px] font-semibold text-slate-300">{payloads.length}</div>
      </div>
      <div className="overflow-x-auto border-t border-line/30 bg-[#090f1b] px-5 py-4">
        <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Payload Definition</div>
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
            <tr><th className="pb-2.5 pr-3 font-semibold">Payload</th><th className="pb-2.5 px-3 font-semibold">Description</th><th className="pb-2.5 pl-3 font-semibold">Example</th></tr>
          </thead>
          <tbody className="divide-y divide-line/30">
            {payloads.map((payload, payloadIndex) => (
              <tr key={`${payload.platformEventName}-${payload.canonicalPayloadName}-${payloadIndex}`}>
                <td className={`py-3 pr-3 align-top font-mono text-[14px] font-semibold ${tone.text}`}>{payload.canonicalPayloadName}</td>
                <td className="px-3 py-3 align-top text-[14px] leading-relaxed text-slate-300">{payload.description}</td>
                <td className="py-3 pl-3 align-top font-mono text-[13px] text-emerald">{payload.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function SpecViewer({
  specs,
  savedSpecs,
  activeSpecId,
  setActiveSpecId,
  isLoading,
  onOpenEdit,
  onCopyShareLink,
  shareStatus,
  canEditActiveSpec,
}: {
  specs: GeneratedSpec[];
  savedSpecs: SavedSpecSummary[];
  activeSpecId: string;
  setActiveSpecId: (id: string) => void;
  isLoading: boolean;
  onOpenEdit: (id: string) => Promise<void>;
  onCopyShareLink: (id: string) => Promise<void>;
  shareStatus: string;
  canEditActiveSpec: (id: string) => boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<SpecViewerGroupId>("gameplay");
  const [isSpecMenuOpen, setIsSpecMenuOpen] = useState(false);
  const activeSpec = specs.find((item) => item.id === activeSpecId) ?? specs[0] ?? null;
  const groups = useMemo(() => (activeSpec ? specViewerGroupsFor(activeSpec) : []), [activeSpec]);
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? null;
  const filteredGroupEvents = useMemo(() => {
    if (!activeGroup) return [];
    const lower = query.toLowerCase();
    return activeGroup.events.filter((event) => eventMatchesQuery(event, lower));
  }, [activeGroup, query]);
  const filteredPlatformAdPayloadGroups = useMemo(() => {
    if (!activeGroup) return [];
    const lower = query.toLowerCase();
    return groupedPlatformAdPayloads(activeGroup.platformAdPayloads.filter((payload) => adPayloadMatchesQuery(payload, lower)));
  }, [activeGroup, query]);

  useEffect(() => {
    if (!groups.length) return;
    if (!groups.some((group) => group.id === activeGroupId)) {
      setActiveGroupId(groups[0].id);
    }
  }, [activeGroupId, groups]);

  if (isLoading) {
    return (
      <section className="rounded-2xl border border-line/70 bg-[#0b1120] p-10 text-center shadow-soft">
        <Table2 className="mx-auto h-8 w-8 text-cobalt" />
        <h2 className="mt-4 font-display text-xl font-bold text-[#f2f5ff]">Loading saved specs</h2>
      </section>
    );
  }

  if (!savedSpecs.length) {
    return (
      <section className="rounded-2xl border border-dashed border-line/70 bg-[#0b1120] p-10 text-center shadow-soft">
        <Table2 className="mx-auto h-8 w-8 text-cobalt" />
        <h2 className="mt-4 font-display text-xl font-bold text-[#f2f5ff]">No saved specs to view</h2>
        <p className="mt-2 text-sm text-slate-500">Generate and save a game spec first, then it will appear here.</p>
      </section>
    );
  }

  if (!activeSpec) {
    return (
      <section className="rounded-2xl border border-line/70 bg-[#0b1120] p-10 text-center shadow-soft">
        <Table2 className="mx-auto h-8 w-8 text-cobalt" />
        <h2 className="mt-4 font-display text-xl font-bold text-[#f2f5ff]">Select a game spec</h2>
      </section>
    );
  }

  const activeSummary = savedSpecs.find((item) => item.id === activeSpec.id);
  const canEditSpec = canEditActiveSpec(activeSpec.id);

  return (
    <section>
      <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cobalt">
            <span className="h-1.5 w-1.5 rounded-full bg-cobalt shadow-[0_0_10px_#3d82ff]" />
            Event Design · Viewer
          </div>
          {savedSpecs.length > 1 ? (
            <div
              className="relative mt-2 inline-flex max-w-full"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setIsSpecMenuOpen(false);
              }}
            >
              <h1 className="max-w-full">
                <button
                  type="button"
                  onClick={() => setIsSpecMenuOpen((open) => !open)}
                  aria-haspopup="listbox"
                  aria-expanded={isSpecMenuOpen}
                  aria-controls="saved-spec-options"
                  className="focus-ring group flex max-w-full items-center rounded-[10px] border border-transparent py-1 pl-2 pr-9 text-left font-display text-[34px] font-extrabold leading-none text-[#f4f6ff] transition-colors hover:border-cobalt/40 hover:bg-cobalt/10 focus:border-cobalt/60 focus:bg-cobalt/10"
                >
                  <span className="truncate">{activeSpec.intake.gameTitle}</span>
                  <ChevronDown className={`pointer-events-none absolute right-3 h-5 w-5 shrink-0 text-cobalt transition-transform ${isSpecMenuOpen ? "rotate-180" : ""}`} />
                </button>
              </h1>
              {isSpecMenuOpen ? (
                <div
                  id="saved-spec-options"
                  role="listbox"
                  aria-label="Saved game specs"
                  className="absolute left-0 top-full z-50 mt-2 w-[min(92vw,390px)] overflow-hidden rounded-[12px] border border-line/80 bg-[#101a2d] p-1.5 shadow-soft"
                >
                  <div className="px-2.5 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Saved Game Specs</div>
                  {savedSpecs.map((savedSpec) => {
                    const isActive = savedSpec.id === activeSpec.id;
                    return (
                      <button
                        key={savedSpec.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setActiveSpecId(savedSpec.id);
                          setIsSpecMenuOpen(false);
                        }}
                        className={`focus-ring relative block w-full rounded-[9px] px-3 py-2.5 text-left transition-colors ${
                          isActive ? "bg-cobalt/15 text-[#f2f5ff]" : "text-[#cbd2e8] hover:bg-[#17223a]"
                        }`}
                      >
                        {isActive ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-cobalt" /> : null}
                        <span className="block truncate text-[14px] font-semibold">{savedSpec.gameTitle}</span>
                        <span className="mt-1 block font-mono text-[10px] text-slate-500">
                          {savedSpec.eventCount} events · {savedSpec.payloadCount} payload rows
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <h1 className="mt-3 font-display text-[34px] font-extrabold leading-none text-[#f4f6ff]">{activeSpec.intake.gameTitle}</h1>
          )}
          <p className="mt-2 text-[13.5px] text-slate-500">
            Read-only view · shareable with viewers · {activeSpec.intake.genre || "Unspecified genre"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => onCopyShareLink(activeSpec.id)}
            className="focus-ring inline-flex h-11 items-center gap-2 rounded-[10px] border border-line/70 bg-[#121b2c] px-4 text-sm font-semibold text-text-muted hover:bg-[#17223a]"
          >
            <Link2 className="h-4 w-4" />
            Copy Share Link
          </button>
          {canEditSpec ? (
            <button
              type="button"
              onClick={() => onOpenEdit(activeSpec.id)}
              className="focus-ring inline-flex h-11 items-center gap-2 rounded-[10px] bg-cobalt px-[18px] text-sm font-semibold text-white shadow-[0_8px_22px_-8px_#3d82ff] hover:bg-cobalt/90"
            >
              <Pencil className="h-4 w-4" />
              Open in Editor
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line/70 bg-[#0b1120] shadow-soft">
        <div className="flex flex-col gap-3 border-b border-line/50 bg-[#0d1424] px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <StatusChip status={activeSummary?.status ?? reviewStatusForEvents(activeSpec.generatedEvents)} />
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
              {activeSpec.generatedEvents.length} events · {rowsForSpec(activeSpec).length} payload rows
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 items-center gap-2 rounded-[7px] border border-line/70 bg-[#0a111e] px-2.5">
              <Search className="h-3.5 w-3.5 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search this spec"
                className="focus-ring w-40 border-0 bg-transparent text-xs text-slate-300 outline-none placeholder:text-slate-500"
              />
            </div>
          </div>
        </div>
        {shareStatus ? <div className="border-b border-cobalt/20 bg-cobalt/10 px-5 py-2 text-xs font-semibold text-cobalt">{shareStatus}</div> : null}

        <div className="border-b border-line/50 bg-[#0a1120]">
          <div className="flex items-stretch overflow-x-auto" role="tablist" aria-label="Event categories">
            <div className="flex w-[118px] shrink-0 flex-col justify-center border-r border-line/50 px-4">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Event</span>
              <span className="mt-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Categories</span>
            </div>
            {groups.map((group) => {
              const eventCount = group.events.length + platformEventCount(group.platformAdPayloads);
              const payloadCount = payloadCountForEvents(group.events) + group.platformAdPayloads.length;
              const isActive = group.id === activeGroup?.id;
              const tone = categoryTone(group.label);
              return (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  aria-label={`View ${group.id === "gameplay" ? "Gameplay" : group.label} event category`}
                  aria-selected={isActive}
                  onClick={() => { setActiveGroupId(group.id); setQuery(""); }}
                  className={`relative flex min-w-[166px] shrink-0 flex-col justify-center border-r border-line/50 px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cobalt ${
                    isActive
                      ? "bg-[linear-gradient(135deg,rgba(61,130,255,0.18),rgba(13,20,36,0.72))] text-[#f2f5ff]"
                      : "bg-[#0a1120] text-slate-400 hover:bg-[#101a2d] hover:text-[#eef1fb]"
                  }`}
                >
                  {isActive ? <span className={`absolute inset-y-0 left-0 w-0.5 ${tone.bar}`} /> : null}
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <span className={`h-1.5 w-1.5 rounded-full ${isActive ? tone.bar : "bg-slate-500"}`} />
                    {group.label}
                  </span>
                  <span className="mt-1 font-mono text-[10px] font-medium text-slate-500">{eventCount} events · {payloadCount} payloads</span>
                </button>
              );
            })}
          </div>
        </div>

        {activeGroup ? (
          <div>
            <div className="flex flex-col gap-2 border-b border-line/40 px-5 py-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className={`font-display text-sm font-bold ${categoryTone(activeGroup.label).text}`}>{activeGroup.label}</h2>
                <p className="mt-1 text-xs text-slate-500">{activeGroup.description}</p>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
                {activeGroup.events.length + platformEventCount(activeGroup.platformAdPayloads)} events · {payloadCountForEvents(activeGroup.events) + activeGroup.platformAdPayloads.length} payloads
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[760px] space-y-3 p-3">
                {filteredGroupEvents.map((event) => <ViewerEventRow key={event.eventName} event={event} />)}
                {filteredPlatformAdPayloadGroups.map((platformEvent) => (
                  <ViewerPlatformAdRow key={platformEvent.eventName} eventName={platformEvent.eventName} adFamily={platformEvent.adFamily} payloads={platformEvent.payloads} />
                ))}
                {!filteredGroupEvents.length && !filteredPlatformAdPayloadGroups.length ? (
                  <div className="px-5 py-10 text-center text-sm text-slate-500">No specs match the current search in {activeGroup.label}.</div>
                ) : null}
              </div>
            </div>
          </div>
        ) : <div className="px-5 py-10 text-center text-sm text-slate-500">No grouped specs are available for this game.</div>}
      </div>
    </section>
  );
}

export default function MvpApp({ library }: { library: LibrarySnapshot }) {
  const [activeTab, setActiveTab] = useState<Tab>("intake");
  const [hasReadUrlState, setHasReadUrlState] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [spec, setSpec] = useState<GeneratedSpec | null>(null);
  const [savedSpecs, setSavedSpecs] = useState<SavedSpecSummary[]>([]);
  const [viewerSpecs, setViewerSpecs] = useState<GeneratedSpec[]>([]);
  const [viewerActiveSpecId, setViewerActiveSpecId] = useState("");
  const [isViewerLoading, setIsViewerLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [auth, setAuth] = useState<AuthState>({ authenticated: false, user: null });

  const form = useForm<GameIntake>({
    resolver: zodResolver(intakeSchema),
    defaultValues: {
      gameTitle: "",
      genre: "",
      coreLoop: "",
      gameModes: "",
      mechanics: "",
      winConditions: "",
      loseConditions: "",
      economy: "",
      itemsOrPowerups: "",
      powerupNames: "",
      iap: "",
      ads: "",
      rewardedAdPlacements: "",
      interstitialAdPlacements: "",
      liveOps: "",
      notes: "",
    },
  });

  const selectedAds = splitTextList(form.watch("ads") ?? "");
  const showRewardedPlacements = selectedAds.includes("Rewarded Ads");
  const showInterstitialPlacements = selectedAds.includes("Interstitial Ads");
  const formErrors = Object.values(form.formState.errors)
    .map((formError) => formError?.message)
    .filter(Boolean);
  const visibleNavigationItems = navigationItems.filter((item) => auth.access?.accountType !== "external" && (item.tab !== "users" || canManageUsers(auth.user)));
  const activeSavedSpec = spec ? savedSpecs.find((savedSpec) => savedSpec.id === spec.id) : undefined;
  const canCreateOrEdit = canCreateSpecs(auth.user);
  const canSaveActiveSpec = canCreateOrEdit && (activeSavedSpec ? Boolean(activeSavedSpec.canEdit) : true);

  async function refreshMe() {
    const response = await fetch("/api/me");
    if (!response.ok) throw new Error(await response.text());
    setAuth((await response.json()) as AuthState);
  }

  async function refreshSavedSpecs() {
    const response = await fetch("/api/specs");
    if (!response.ok) throw new Error(await response.text());
    setSavedSpecs((await response.json()) as SavedSpecSummary[]);
  }

  function viewerShareUrl(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "viewer");
    url.searchParams.set("spec", id);
    return url.toString();
  }

  async function copyViewerShareLink(id: string) {
    if (!id) return;
    const url = viewerShareUrl(id);
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("Share link copied");
    } catch {
      window.prompt("Copy this share link", url);
      setShareStatus("Share link ready");
    }
  }

  async function loadViewerSpecs(targetSpecId = viewerActiveSpecId) {
    setIsViewerLoading(true);
    setError("");
    try {
      if (targetSpecId && !auth.authenticated) {
        const specResponse = await fetch(`/api/specs/${targetSpecId}`);
        if (!specResponse.ok) throw new Error(await specResponse.text());
        const publicSpec = normalizeSpecPayloadTypes((await specResponse.json()) as GeneratedSpec, { inferFromExample: true });
        setViewerSpecs([publicSpec]);
        setSavedSpecs([summaryFromSpec(publicSpec)]);
        setViewerActiveSpecId(publicSpec.id);
        return;
      }

      const response = await fetch("/api/specs");
      if (!response.ok) throw new Error(await response.text());
      const summaries = (await response.json()) as SavedSpecSummary[];
      setSavedSpecs(summaries);
      const fullSpecs = await Promise.all(
        summaries.map(async (summary) => {
          const specResponse = await fetch(`/api/specs/${summary.id}`);
          if (!specResponse.ok) throw new Error(await specResponse.text());
          return normalizeSpecPayloadTypes((await specResponse.json()) as GeneratedSpec, { inferFromExample: true });
        }),
      );
      setViewerSpecs(fullSpecs);
      if (!fullSpecs.some((item) => item.id === targetSpecId)) {
        setViewerActiveSpecId(fullSpecs[0]?.id ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load saved specs");
    } finally {
      setIsViewerLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlSpecId = params.get("spec") ?? "";
    const urlTab = tabFromParam(params.get("tab")) ?? (urlSpecId ? "viewer" : null);
    if (urlSpecId) setViewerActiveSpecId(urlSpecId);
    if (urlTab) setActiveTab(urlTab);
    setHasReadUrlState(true);
  }, []);

  useEffect(() => {
    if (!hasReadUrlState) return;
    const url = new URL(window.location.href);
    if (activeTab === "intake") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", activeTab);
    }
    if (activeTab === "viewer" && viewerActiveSpecId) {
      url.searchParams.set("spec", viewerActiveSpecId);
    } else {
      url.searchParams.delete("spec");
    }
    window.history.replaceState(null, "", url.toString());
  }, [activeTab, hasReadUrlState, viewerActiveSpecId]);

  useEffect(() => {
    if (!shareStatus) return;
    const timeout = window.setTimeout(() => setShareStatus(""), 2500);
    return () => window.clearTimeout(timeout);
  }, [shareStatus]);

  useEffect(() => {
    refreshMe().catch((err) => {
      setError(err instanceof Error ? err.message : "Could not load user");
    });
  }, []);

  useEffect(() => {
    if (auth.access?.accountType === "external") window.location.replace("/tech-launch");
  }, [auth.access?.accountType]);

  useEffect(() => {
    if (!auth.authenticated) return;
    refreshSavedSpecs().catch((err) => {
      setError(err instanceof Error ? err.message : "Could not load saved specs");
    });
  }, [auth.authenticated, auth.user?.id]);

  useEffect(() => {
    if (auth.user?.role === "viewer" && (activeTab === "intake" || activeTab === "review")) {
      setActiveTab("viewer");
    }
    if (!canManageUsers(auth.user) && activeTab === "users") {
      setActiveTab("viewer");
    }
  }, [activeTab, auth.user]);

  useEffect(() => {
    if (activeTab === "viewer" && hasReadUrlState) {
      void loadViewerSpecs();
    }
  }, [activeTab, auth.authenticated, hasReadUrlState]);

  async function onSubmit(values: GameIntake) {
    if (!canCreateOrEdit) {
      setError("Only admins and editors can generate specs.");
      return;
    }
    setIsGenerating(true);
    setError("");
    setSaveStatus("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error(await response.text());
      const generated = normalizeSpecPayloadTypes((await response.json()) as GeneratedSpec, { inferFromExample: true });
      setSpec(generated);
      setActiveTab("review");
      await refreshSavedSpecs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  async function saveCurrentSpec() {
    if (!spec) return;
    if (!canSaveActiveSpec) {
      setError("You do not have permission to save this spec.");
      return;
    }
    setError("");
    setSaveStatus("Saving...");
    try {
      const response = await fetch("/api/specs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeSpecPayloadTypes(spec)),
      });
      if (!response.ok) throw new Error(await response.text());
      const saved = (await response.json()) as SavedSpecSummary;
      await refreshSavedSpecs();
      if (activeTab === "viewer") await loadViewerSpecs();
      setSaveStatus(`Saved ${new Date(saved.updatedAt).toLocaleString()}`);
    } catch (err) {
      setSaveStatus("");
      setError(err instanceof Error ? err.message : "Could not save spec");
    }
  }

  async function importSpecFile(file: File, details: { gameTitle: string; genre: string }) {
    if (!canCreateOrEdit) {
      setError("Only admins and editors can import specs.");
      return;
    }
    setError("");
    setSaveStatus("");
    setImportStatus("Importing...");
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("gameTitle", details.gameTitle);
      formData.append("genre", details.genre);
      const response = await fetch("/api/specs/import", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { spec: GeneratedSpec; summary: SavedSpecSummary };
      const importedSpec = normalizeSpecPayloadTypes(result.spec, { inferFromExample: true });
      setSpec(importedSpec);
      form.reset(importedSpec.intake);
      await refreshSavedSpecs();
      setSaveStatus(`Imported ${result.summary.gameTitle}`);
      setImportStatus(`Imported ${result.summary.gameTitle}`);
      setActiveTab("review");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not import spec";
      setImportStatus(message);
      setError(message);
    } finally {
      setIsImporting(false);
    }
  }

  async function openSavedSpec(id: string) {
    setError("");
    const summary = savedSpecs.find((item) => item.id === id);
    if (summary && !summary.canEdit) {
      setViewerActiveSpecId(id);
      setActiveTab("viewer");
      return;
    }
    const response = await fetch(`/api/specs/${id}`);
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    const savedSpec = normalizeSpecPayloadTypes((await response.json()) as GeneratedSpec, { inferFromExample: true });
    setSpec(savedSpec);
    form.reset(savedSpec.intake);
    setSaveStatus("Saved spec loaded");
    setActiveTab("review");
  }

  async function viewSavedSpec(id: string) {
    setError("");
    setViewerActiveSpecId(id);
    setActiveTab("viewer");
    await loadViewerSpecs(id);
  }

  async function deleteSpec(id: string) {
    setError("");
    const response = await fetch(`/api/specs/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    if (spec?.id === id) {
      setSpec(null);
      setSaveStatus("");
    }
    setViewerSpecs((items) => items.filter((item) => item.id !== id));
    if (viewerActiveSpecId === id) setViewerActiveSpecId("");
    await refreshSavedSpecs();
  }

  const shellNavigationItems: ShellNavItem<Tab>[] = visibleNavigationItems.map((item) => ({
    id: item.tab,
    label: item.label,
    icon: item.icon,
  }));

  return (
    <CerberusShell<Tab>
      currentProduct="spec-generator"
      navItems={shellNavigationItems}
      activeNav={activeTab}
      onNavChange={setActiveTab}
      collapsed={sidebarCollapsed}
      onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      contentClassName={activeTab === "review" ? "max-w-none" : "max-w-[1320px]"}
      user={{
        authenticated: auth.authenticated,
        name: auth.user?.name,
        email: auth.user?.email,
        roleLabel: auth.user ? roleLabels[auth.user.role] : undefined,
        accountType: auth.access?.accountType,
      }}
    >
        {activeTab === "intake" ? (
          <>
          <div className="mb-6">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cobalt">
              <span className="h-1.5 w-1.5 rounded-full bg-cobalt shadow-[0_0_10px_#3d82ff]" />
              Event Design · Intake
            </div>
            <h1 className="mt-3 font-display text-3xl font-extrabold leading-tight text-[#f4f6ff]">Describe the game</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              Fill the intake and generate a draft analytics spec matched against the reference library.
            </p>
          </div>
          <section className="grid items-start gap-[18px] lg:grid-cols-[1fr_320px]">
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-[18px] rounded-2xl border border-line/70 bg-[linear-gradient(180deg,#0e1626,#0c1421)] p-[22px] shadow-soft"
            >
              <div className="grid gap-[14px] md:grid-cols-2">
                <label className="block">
                  <span className={intakeLabelClass}>Game Title</span>
                  <input
                    {...form.register("gameTitle")}
                    className={intakeInputClass}
                    placeholder="Sizzle Sort"
                  />
                </label>
                <label className="block">
                  <span className={intakeLabelClass}>Genre</span>
                  <input
                    {...form.register("genre")}
                    className={intakeInputClass}
                    placeholder="Match-3 timed puzzle"
                  />
                </label>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Feature Selection</div>
              <div className="grid gap-3 md:grid-cols-2">
                {intakeOptionGroups.map((group) => (
                  <CheckboxDropdown key={group.name} form={form} {...group} allowCustom={group.name !== "ads"} />
                ))}
                {showRewardedPlacements ? (
                  <CheckboxDropdown
                    form={form}
                    name="rewardedAdPlacements"
                    label="Rewarded Ad Placements"
                    helper="Pick where rewarded ads can appear."
                    options={rewardedAdPlacementOptions}
                    allowCustom={false}
                  />
                ) : null}
                {showInterstitialPlacements ? (
                  <CheckboxDropdown
                    form={form}
                    name="interstitialAdPlacements"
                    label="Interstitial Ad Placements"
                    helper="Pick where interstitial ads can appear."
                    options={interstitialAdPlacementOptions}
                    allowCustom={false}
                  />
                ) : null}
              </div>
              <div className="grid gap-[14px] md:grid-cols-2">
                <Field label="Win Conditions" name="winConditions" register={form.register} />
                <Field label="Lose Conditions" name="loseConditions" register={form.register} />
                <Field label="Game Modes" name="gameModes" register={form.register} />
                <Field label="Items / Powerups" name="itemsOrPowerups" register={form.register} />
                <TextInput
                  label="Powerup Names"
                  name="powerupNames"
                  register={form.register}
                  placeholder="shuffle, takeaway, hourglass, toolkit"
                  help="Generates Game_End payloads like powerup_shuffle_used and transaction item examples like powerup_shuffle."
                />
                <Field label="Notes" name="notes" register={form.register} />
              </div>
              {formErrors.length ? (
                <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                  {formErrors.map((message) => (
                    <div key={message}>{message}</div>
                  ))}
                </div>
              ) : null}
              {!canCreateOrEdit ? (
                <p className="rounded-md border border-line bg-sage p-3 text-sm text-slate-600">
                  Sign in as an admin or editor to generate and save specs.
                </p>
              ) : null}
              {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="submit"
                  disabled={isGenerating || !canCreateOrEdit}
                  className="focus-ring inline-flex h-11 items-center gap-2 rounded-[10px] bg-cobalt px-[18px] text-sm font-semibold text-white shadow-[0_8px_22px_-8px_#3d82ff] hover:bg-cobalt/90 disabled:opacity-60"
                >
                  <Play className="h-4 w-4" />
                  {isGenerating ? "Generating..." : "Generate Spec"}
                </button>
                <button
                  type="button"
                  onClick={() => form.reset(exampleIntake)}
                  className="focus-ring inline-flex h-11 items-center gap-2 rounded-[10px] border border-line/70 bg-[#121b2c] px-4 text-sm font-semibold text-text-muted hover:bg-[#17223a]"
                >
                  <Sparkles className="h-4 w-4" />
                  Load Example
                </button>
              </div>
            </form>

            <aside className="space-y-[14px]">
              <div className="rounded-[14px] border border-line/70 bg-[linear-gradient(180deg,#101a2d,#0d1626)] p-[18px] shadow-soft">
                <div className="flex items-center gap-2 font-display text-sm font-bold text-slate-300">
                  <Library className="h-4 w-4 text-slate-400" />
                  Library Seed
                </div>
                <p className="mt-3 text-[12.5px] leading-relaxed text-slate-500">
                  Seeded from <span className="font-semibold text-text-muted">{library.events.length} canonical events</span> and{" "}
                  <span className="font-semibold text-text-muted">{library.generationPacks.length} generation packs</span>.
                </p>
              </div>
              <div className="rounded-[14px] border border-line/70 bg-[linear-gradient(180deg,#101a2d,#0d1626)] p-[18px] shadow-soft">
                <div className="flex items-center gap-2 font-display text-sm font-bold text-slate-300">
                  <BookOpen className="h-4 w-4 text-slate-400" />
                  Intake Tips
                </div>
                <ul className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-slate-500">
                  {splitTextList("Mention ads only if the game has ads; Include IAP/store terms if purchases exist; Add lose conditions to improve Game_End payload recommendations").map(
                    (tip) => (
                      <li key={tip} className="flex gap-2">
                        <span className="mt-px text-cobalt">›</span>
                        <span>{tip}</span>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </aside>
          </section>
          </>
        ) : null}

        {activeTab === "review" ? (
          <SpecReview spec={spec} setSpec={setSpec} onSave={saveCurrentSpec} saveStatus={saveStatus} canEdit={canSaveActiveSpec} />
        ) : null}
        {activeTab === "viewer" ? (
          <SpecViewer
            specs={viewerSpecs}
            savedSpecs={savedSpecs}
            activeSpecId={viewerActiveSpecId}
            setActiveSpecId={setViewerActiveSpecId}
            isLoading={isViewerLoading}
            onOpenEdit={openSavedSpec}
            onCopyShareLink={copyViewerShareLink}
            shareStatus={shareStatus}
            canEditActiveSpec={(id) => Boolean(savedSpecs.find((item) => item.id === id)?.canEdit)}
          />
        ) : null}
        {activeTab === "specs" ? (
          <SavedSpecsBrowser
            savedSpecs={savedSpecs}
            onOpen={viewSavedSpec}
            onEdit={openSavedSpec}
            onDelete={deleteSpec}
            onImport={importSpecFile}
            canImport={canCreateOrEdit}
            importStatus={importStatus}
            isImporting={isImporting}
          />
        ) : null}
        {activeTab === "library" ? <LibraryBrowser library={library} /> : null}
        {activeTab === "users" && canManageUsers(auth.user) ? <UserRoleAdmin currentUser={auth.user} /> : null}
    </CerberusShell>
  );
}
