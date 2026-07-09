"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  BookOpen,
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
import { useEffect, useMemo, useState } from "react";
import { UseFormReturn, useForm } from "react-hook-form";

import ProductSwitcher from "@/components/ProductSwitcher";
import { splitTextList } from "@/lib/canonical";
import {
  GeneratedEvent,
  GeneratedPayloadField,
  GeneratedSpec,
  GameIntake,
  intakeSchema,
  AppUser,
  LibrarySnapshot,
  SavedSpecSummary,
  UserRole,
} from "@/lib/types";

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
      <span className="mb-2 block text-sm font-semibold text-ink">{label}</span>
      <textarea
        {...register(name)}
        placeholder={placeholder}
        className="focus-ring min-h-24 w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm shadow-sm"
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
      <span className="mb-2 block text-sm font-semibold text-ink">{label}</span>
      <input
        {...register(name)}
        placeholder={placeholder}
        className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm shadow-sm"
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

  function toggle(option: string) {
    const next = selectedSet.has(option)
      ? selected.filter((item) => item !== option)
      : [...selected, option];
    form.setValue(name, next.join(", "), { shouldDirty: true, shouldValidate: true });
  }

  return (
    <details className={`rounded-md border border-line border-l-2 bg-white shadow-sm open:shadow-md ${tone.border}`}>
      <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-3 rounded-md px-4 py-3">
        <span>
          <span className={`block text-sm font-semibold ${tone.text}`}>{label}</span>
          <span className="mt-1 block text-xs text-slate-500">
            {selected.length ? `${selected.length} selected` : helper}
          </span>
        </span>
        <ToneChip tone={tone}>Choose</ToneChip>
      </summary>
      <div className="border-t border-line p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <label
              key={option}
              className="flex items-start gap-2 rounded-md border border-line bg-mist px-3 py-2 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(option)}
                onChange={() => toggle(option)}
                className="mt-0.5 h-4 w-4 rounded border-line text-cobalt"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
        {allowCustom ? (
          <label className="mt-3 block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Selected / custom entries
            </span>
            <textarea
              {...form.register(name)}
              className="focus-ring min-h-20 w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm"
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
  if (lower.includes("game") || lower.includes("play") || lower.includes("core")) {
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
    <div className="space-y-3">
      {payloadFields.map((payload, payloadIndex) => (
        <div key={`payload-${payloadIndex}`} className="rounded-md border border-line bg-mist p-3">
          <div className="grid gap-3 lg:grid-cols-[180px_104px_minmax(280px,1fr)_180px_76px]">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Payload</span>
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
                className="focus-ring h-9 w-full rounded-md border border-line bg-white px-2 font-mono text-sm font-semibold text-cobalt"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Type</span>
              <select
                aria-label={`${eventName} ${payload.canonicalFieldName} data type`}
                value={canonicalPayloadDataType(payload.type) ?? normalizePayloadDataType(payload, { inferFromExample: true })}
                disabled={!canEdit}
                onChange={(event) => onChange(payloadIndex, { type: event.target.value })}
                className="focus-ring h-9 w-full rounded-full border border-line bg-white px-2 font-mono text-[11px] font-semibold text-cyan disabled:opacity-60"
              >
                {payloadDataTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Description</span>
              <textarea
                aria-label={`${eventName} ${payload.canonicalFieldName} description`}
                value={payload.description}
                readOnly={!canEdit}
                onChange={(event) => onChange(payloadIndex, { description: event.target.value })}
                className="focus-ring min-h-20 w-full rounded-md border border-line bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Example</span>
              <textarea
                aria-label={`${eventName} ${payload.canonicalFieldName} example`}
                value={payload.example}
                readOnly={!canEdit}
                onChange={(event) => onChange(payloadIndex, { example: event.target.value })}
                className="focus-ring min-h-20 w-full rounded-md border border-line bg-white px-2 py-1 font-mono text-sm text-emerald"
              />
            </label>
            <div className="mt-5 flex gap-1.5">
              <button
                type="button"
                title="Duplicate payload"
                aria-label={`${eventName} duplicate ${payload.canonicalFieldName}`}
                disabled={!canEdit}
                onClick={() => onDuplicate(payloadIndex)}
                className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-slate-500 hover:bg-sage hover:text-ink disabled:opacity-50"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Remove payload"
                aria-label={`${eventName} remove ${payload.canonicalFieldName}`}
                disabled={!canEdit}
                onClick={() => onDelete(payloadIndex)}
                className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose/40 bg-rose/10 text-rose hover:bg-rose/20 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={!canEdit}
        onClick={onAdd}
        className="focus-ring inline-flex items-center gap-1 rounded-md border border-line bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric label="Events" value={library.events.length} />
        <Metric label="Payload Rows" value={library.payloads.length} />
        <Metric label="Feature Packs" value={library.generationPacks.length} />
        <Metric label="Ad Payload Rows" value={library.platformAdPayloads.length} />
      </div>

      <div className="flex items-center gap-3 rounded-md border border-line bg-white px-3 py-2 shadow-sm">
        <Search className="h-4 w-4 text-slate-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search events, packs, categories..."
          className="focus-ring w-full border-0 bg-transparent text-sm outline-none"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-md border border-line bg-white shadow-sm">
          <div className="border-b border-line px-4 py-3 font-semibold">Generation Packs</div>
          <div className="divide-y divide-line">
            {library.generationPacks.map((pack) => (
              <div key={pack.featurePack} className="p-4">
                <div className="font-semibold text-ink">{pack.featurePack}</div>
                <p className="mt-1 text-sm text-slate-600">{pack.applicableWhen}</p>
                <p className="mt-2 text-xs font-semibold text-slate-500">{pack.launchPriority}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-line bg-white shadow-sm">
          <div className="border-b border-line px-4 py-3 font-semibold">Governance Decisions</div>
          <div className="divide-y divide-line">
            {library.governanceDecisions.map((decision) => (
              <div key={decision.area} className="p-4 text-sm">
                <div className="font-semibold text-ink">{decision.area}</div>
                <p className="mt-1 text-slate-600">{decision.decision}</p>
                {decision.legacy_aliases ? (
                  <p className="mt-2 text-xs text-slate-500">Aliases: {decision.legacy_aliases}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-white shadow-sm">
        <div className="border-b border-line px-4 py-3 font-semibold">Event Catalog</div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="sticky top-0 bg-sage text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Pack</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Payloads</th>
                <th className="px-3 py-2">Guidance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.map((event) => (
                <tr key={event.eventName}>
                  <td className="px-3 py-3 font-semibold">{event.eventName}</td>
                  <td className="px-3 py-3">{event.featurePack}</td>
                  <td className="px-3 py-3">{event.category}</td>
                  <td className="px-3 py-3 text-slate-600">{event.canonicalPayloadFields}</td>
                  <td className="px-3 py-3 text-slate-600">{event.generatorGuidance}</td>
                </tr>
              ))}
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

  if (!spec) {
    return (
      <section className="rounded-md border border-dashed border-line bg-white p-10 text-center shadow-sm">
        <Sparkles className="mx-auto h-8 w-8 text-cobalt" />
        <h2 className="mt-4 text-xl font-bold text-ink">No spec generated yet</h2>
        <p className="mt-2 text-sm text-slate-600">Fill the game intake and generate a draft analytics spec.</p>
      </section>
    );
  }

  const selectedEvent = spec.generatedEvents[selectedEventIndex] ?? null;
  const selectedAdPayloadGroup =
    filteredAdPayloadGroups.find((group) => group.key === selectedAdPayloadGroupKey) ?? filteredAdPayloadGroups[0] ?? null;

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric label="Generated Events" value={spec.generatedEvents.length} />
        <Metric label="Feature Packs" value={spec.selectedFeaturePacks.length} />
        <Metric label="Platform Ad Payloads" value={spec.platformAdPayloads.length} />
        <Metric label="Review Status" value={reviewStatusForEvents(spec.generatedEvents)} />
      </div>

      <div className="flex flex-col justify-between gap-3 rounded-md border border-line bg-white p-4 shadow-sm md:flex-row md:items-center">
        <div>
          <h2 className="text-lg font-bold text-ink">{spec.intake.gameTitle}</h2>
          <p className="text-sm text-slate-600">Generated {new Date(spec.generatedAt).toLocaleString()}</p>
          {saveStatus ? <p className="mt-1 text-xs font-semibold text-cobalt">{saveStatus}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canEdit}
            onClick={addCustomEvent}
            className="focus-ring inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add Event
          </button>
          <button
            type="button"
            disabled={!canEdit}
            onClick={onSave}
            className="focus-ring inline-flex items-center gap-2 rounded-md bg-cobalt px-3 py-2 text-sm font-semibold text-white hover:bg-cobalt/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Save Spec
          </button>
        </div>
      </div>

      <div className="rounded-md border border-line bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-3">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder="Filter generated events..."
            className="focus-ring w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <div className="max-h-[720px] overflow-auto rounded-md border border-line bg-mist">
            <div className="sticky top-0 border-b border-line bg-sage px-3 py-2 text-xs font-semibold uppercase text-slate-600">
              Events
            </div>
            <div className="divide-y divide-line">
              {filteredEventIndexes.map((eventIndex) => {
                const eventRow = spec.generatedEvents[eventIndex];
                const isSelected = eventIndex === selectedEventIndex;
                const tone = categoryTone(`${eventRow.category} ${eventRow.featurePack} ${eventRow.eventName}`);
                return (
                  <button
                    key={`${eventRow.eventName}-${eventIndex}`}
                    type="button"
                    onClick={() => setSelectedEventIndex(eventIndex)}
                    className={`focus-ring block w-full border-l-2 px-3 py-3 text-left text-sm ${tone.border} ${
                      isSelected ? "bg-sage shadow-sm" : "hover:bg-sage"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className={`truncate font-mono text-sm font-semibold ${tone.text}`}>{eventRow.eventName}</div>
                        <div className="mt-1 truncate text-xs text-slate-600">{eventRow.featurePack}</div>
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

            <div className="rounded-md border border-line bg-white p-4">
            {selectedEvent ? (
              <div className="space-y-5">
                <div className="flex flex-col justify-between gap-3 border-b border-line pb-4 md:flex-row md:items-start">
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">Event Details</div>
                    <h3 className={`mt-1 font-mono text-lg font-bold ${categoryTone(`${selectedEvent.category} ${selectedEvent.featurePack} ${selectedEvent.eventName}`).text}`}>
                      {selectedEvent.eventName}
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ToneChip tone={categoryTone(`${selectedEvent.category} ${selectedEvent.featurePack} ${selectedEvent.eventName}`)}>
                        {selectedEvent.category}
                      </ToneChip>
                      <span className="text-sm text-slate-600">{selectedEvent.featurePack}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => duplicateEvent(selectedEventIndex)}
                      className="focus-ring inline-flex items-center justify-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold hover:bg-sage disabled:opacity-50"
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

                <div className="grid gap-4 md:grid-cols-[1fr_220px_220px]">
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase text-slate-500">Event Name</span>
                    <input
                      value={selectedEvent.eventName}
                      readOnly={!canEdit}
                      onChange={(event) => updateEvent(selectedEventIndex, { eventName: event.target.value })}
                      className="focus-ring h-11 w-full rounded-md border border-line px-3 text-sm font-semibold"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase text-slate-500">Grouping</span>
                    <select
                      value={eventGroupIdForEvent(selectedEvent)}
                      disabled={!canEdit}
                      onChange={(event) => updateEvent(selectedEventIndex, eventGroupPatch(event.target.value as EventGroupId))}
                      className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm font-semibold"
                    >
                      {eventGroupOptions.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase text-slate-500">Status</span>
                    <select
                      value={selectedEvent.status}
                      disabled={!canEdit}
                      onChange={(event) => updateEvent(selectedEventIndex, { status: event.target.value })}
                      className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                    >
                      <option>Draft</option>
                      <option>Reviewed</option>
                      <option>Needs changes</option>
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase text-slate-500">Trigger Condition</span>
                  <textarea
                    value={selectedEvent.trigger}
                    readOnly={!canEdit}
                    onChange={(event) => updateEvent(selectedEventIndex, { trigger: event.target.value })}
                    className="focus-ring min-h-24 w-full rounded-md border border-line px-3 py-2 text-sm"
                  />
                </label>

                <div>
                  <div className="mb-3">
                    <h4 className="font-bold text-ink">Argument Details</h4>
                    <p className="text-sm text-slate-600">Edit the event argument key, value description, and example values.</p>
                  </div>
                  <div className="grid gap-3 rounded-md border border-line bg-mist p-3 lg:grid-cols-[220px_1fr_260px]">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Argument Type</span>
                      <input
                        aria-label={`${selectedEvent.eventName} argument type`}
                        value={selectedEvent.argumentName}
                        readOnly={!canEdit}
                        onChange={(event) => updateEvent(selectedEventIndex, { argumentName: event.target.value })}
                        className="focus-ring h-10 w-full rounded-md border border-line bg-white px-3 font-mono text-sm font-semibold text-cobalt"
                        placeholder="reason"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Argument Value Description</span>
                      <textarea
                        aria-label={`${selectedEvent.eventName} argument value description`}
                        value={selectedEvent.argumentDescription}
                        readOnly={!canEdit}
                        onChange={(event) => updateEvent(selectedEventIndex, { argumentDescription: event.target.value })}
                        className="focus-ring min-h-20 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
                        placeholder="<the reason for the game round to end>"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Argument Value Example</span>
                      <textarea
                        aria-label={`${selectedEvent.eventName} argument value example`}
                        value={selectedEvent.argumentExamples}
                        readOnly={!canEdit}
                        onChange={(event) => updateEvent(selectedEventIndex, { argumentExamples: event.target.value })}
                        className="focus-ring min-h-20 w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-sm text-emerald"
                        placeholder='"win", "lose"'
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-ink">Payload Details</h4>
                      <p className="text-sm text-slate-600">Edit field names, descriptions, and example values for this event.</p>
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
              <div className="rounded-md border border-dashed border-line p-10 text-center text-sm text-slate-500">
                Select an event to review its details.
              </div>
            )}
          </div>
        </div>
      </div>

      {spec.platformAdPayloads.length ? (
        <div className="rounded-md border border-line bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h3 className="font-bold text-ink">Platform Ad Payload Enrichment</h3>
              <p className="mt-1 text-sm text-slate-600">
                Edit one payload definition per ad type. Changes apply to every platform-triggered event in that ad type.
              </p>
            </div>
            <span className="w-fit rounded bg-sage px-2 py-1 text-xs font-semibold uppercase text-slate-600">
              {adPayloadGroups.length} payload definitions
            </span>
          </div>

          <div className="mb-3 flex items-center gap-3">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              value={adPayloadFilter}
              onChange={(event) => setAdPayloadFilter(event.target.value)}
              placeholder="Filter ad payloads..."
              className="focus-ring w-full rounded-md border border-line px-3 py-2 text-sm"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
            <div className="max-h-[560px] overflow-auto rounded-md border border-line bg-mist">
              <div className="sticky top-0 border-b border-line bg-sage px-3 py-2 text-xs font-semibold uppercase text-slate-600">
                Ad Payload Definitions
              </div>
              <div className="divide-y divide-line">
                {filteredAdPayloadGroups.map((group) => {
                  const isSelected = group.key === selectedAdPayloadGroup?.key;
                  const tone = categoryTone(`${group.adFamily} ad payload`);
                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => setSelectedAdPayloadGroupKey(group.key)}
                      className={`focus-ring block w-full border-l-2 px-3 py-3 text-left text-sm ${tone.border} ${
                        isSelected ? "bg-sage shadow-sm" : "hover:bg-sage"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className={`truncate font-mono text-sm font-semibold ${tone.text}`}>{group.canonicalPayloadName}</div>
                          <div className="mt-1 truncate text-xs text-slate-600">{group.adFamily} Ads</div>
                        </div>
                        <ToneChip tone={tone}>{group.platformEventNames.length} events</ToneChip>
                      </div>
                      <div className="mt-2 line-clamp-2 text-xs text-slate-500">{group.description}</div>
                      <div className="mt-2 truncate font-mono text-xs text-slate-700">{group.example}</div>
                    </button>
                  );
                })}
                {!filteredAdPayloadGroups.length ? (
                  <div className="px-3 py-8 text-center text-sm text-slate-500">No matching ad payloads</div>
                ) : null}
              </div>
            </div>

            <div className="rounded-md border border-line bg-white p-4">
              {selectedAdPayloadGroup ? (
                <div className="space-y-5">
                  <div className="flex flex-col justify-between gap-3 border-b border-line pb-4 md:flex-row md:items-start">
                    <div>
                      <div className="text-xs font-semibold uppercase text-slate-500">Ad Payload Definition</div>
                      <h4 className={`mt-1 font-mono text-lg font-bold ${categoryTone(`${selectedAdPayloadGroup.adFamily} ad payload`).text}`}>
                        {selectedAdPayloadGroup.canonicalPayloadName}
                      </h4>
                      <p className="text-sm text-slate-600">
                        Applies to all {selectedAdPayloadGroup.adFamily.toLowerCase()} platform ad events.
                      </p>
                    </div>
                    <ToneChip tone={categoryTone(`${selectedAdPayloadGroup.adFamily} ad payload`)}>
                      {selectedAdPayloadGroup.requiredness}
                    </ToneChip>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                    <div className="rounded-md border border-line bg-mist p-3">
                      <div className="text-xs font-semibold uppercase text-slate-500">Ad Family</div>
                      <div className="mt-1 break-words text-sm font-semibold text-ink">{selectedAdPayloadGroup.adFamily}</div>
                    </div>
                    <div className="rounded-md border border-line bg-mist p-3">
                      <div className="text-xs font-semibold uppercase text-slate-500">Affected Events</div>
                      <div className="mt-1 break-words text-sm font-semibold text-ink">
                        {selectedAdPayloadGroup.platformEventNames.join(", ")}
                      </div>
                    </div>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase text-slate-500">Payload Name</span>
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
                      className="focus-ring h-11 w-full rounded-md border border-line px-3 text-sm font-semibold"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase text-slate-500">Requiredness</span>
                    <input
                      data-testid="ad-payload-requiredness"
                      aria-label={`${selectedAdPayloadGroup.adFamily} ${selectedAdPayloadGroup.canonicalPayloadName} requiredness`}
                      value={selectedAdPayloadGroup.requiredness}
                      readOnly={!canEdit}
                      onChange={(event) =>
                        updatePlatformAdPayloadGroup(selectedAdPayloadGroup, { requiredness: event.target.value })
                      }
                      className="focus-ring h-11 w-full rounded-md border border-line px-3 text-sm"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase text-slate-500">Description</span>
                    <textarea
                      data-testid="ad-payload-description"
                      aria-label={`${selectedAdPayloadGroup.adFamily} ${selectedAdPayloadGroup.canonicalPayloadName} platform description`}
                      value={selectedAdPayloadGroup.description}
                      readOnly={!canEdit}
                      onChange={(event) =>
                        updatePlatformAdPayloadGroup(selectedAdPayloadGroup, { description: event.target.value })
                      }
                      className="focus-ring min-h-24 w-full rounded-md border border-line px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase text-slate-500">Example</span>
                    <textarea
                      data-testid="ad-payload-example"
                      aria-label={`${selectedAdPayloadGroup.adFamily} ${selectedAdPayloadGroup.canonicalPayloadName} platform example`}
                      value={selectedAdPayloadGroup.example}
                      readOnly={!canEdit}
                      onChange={(event) => updatePlatformAdPayloadGroup(selectedAdPayloadGroup, { example: event.target.value })}
                      className="focus-ring min-h-20 w-full rounded-md border border-line px-3 py-2 font-mono text-sm"
                    />
                  </label>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-line p-10 text-center text-sm text-slate-500">
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-md border border-line bg-white p-5 shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-ink">Import Spec Details</h3>
            <p className="mt-1 text-sm text-slate-600">{file.name}</p>
          </div>
          <button
            type="button"
            aria-label="Cancel import"
            disabled={isImporting}
            onClick={onCancel}
            className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-mist text-slate-500 hover:bg-sage disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-ink">Game Name</span>
            <input
              value={gameTitle}
              onChange={(event) => onGameTitleChange(event.target.value)}
              className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm shadow-sm"
              required
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-ink">Genre</span>
            <input
              value={genre}
              onChange={(event) => onGenreChange(event.target.value)}
              placeholder="Optional"
              className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm shadow-sm"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={isImporting}
            onClick={onCancel}
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
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
      <label className="focus-ring inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-slate-50">
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
      <section className="rounded-md border border-dashed border-line bg-white p-10 text-center shadow-sm">
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
        <FileText className="mx-auto h-8 w-8 text-cobalt" />
        <h2 className="mt-4 text-xl font-bold text-ink">No saved specs yet</h2>
        <p className="mt-2 text-sm text-slate-600">Generate a draft or import an existing analytics spec.</p>
        <div className="mt-5 flex justify-center">
          <ImportControl />
        </div>
        {importStatus ? <p className="mt-3 text-sm font-semibold text-cobalt">{importStatus}</p> : null}
      </section>
    );
  }

  return (
    <section className="space-y-4">
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
      <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end">
        <div>
          <h2 className="text-xl font-bold text-ink">Saved Game Specs</h2>
          <p className="text-sm text-slate-600">Open saved specs with access based on your role.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <ImportControl />
          <Metric label="Saved Specs" value={savedSpecs.length} />
        </div>
      </div>
      {importStatus ? <p className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-cobalt">{importStatus}</p> : null}

      <div className="overflow-hidden rounded-md border border-line bg-white shadow-sm">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="bg-sage text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2">Game</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Genre</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Events</th>
              <th className="px-3 py-2">Payloads</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {savedSpecs.map((savedSpec) => (
              <tr key={savedSpec.id}>
                <td className="px-3 py-3">
                  <div className="font-semibold text-ink">{savedSpec.gameTitle}</div>
                  <div className="text-xs text-slate-500">Generated {new Date(savedSpec.generatedAt).toLocaleString()}</div>
                </td>
                <td className="px-3 py-3">
                  <div className="font-semibold text-ink">{savedSpec.ownerName || "Legacy"}</div>
                  <div className="text-xs text-slate-500">{savedSpec.ownerEmail || "Unassigned"}</div>
                </td>
                <td className="px-3 py-3">{savedSpec.genre || "Unspecified"}</td>
                <td className="px-3 py-3">
                  <StatusChip status={savedSpec.status} />
                </td>
                <td className="px-3 py-3">{savedSpec.eventCount}</td>
                <td className="px-3 py-3">{savedSpec.payloadCount}</td>
                <td className="px-3 py-3">{new Date(savedSpec.updatedAt).toLocaleString()}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      title="Open in Spec Viewer"
                      aria-label={`Open ${savedSpec.gameTitle} in Spec Viewer`}
                      onClick={() => onOpen(savedSpec.id)}
                      className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-cobalt px-2.5 text-xs font-semibold text-white hover:bg-cobalt/90"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span className="hidden xl:inline">Open</span>
                    </button>
                    {savedSpec.canEdit ? (
                      <button
                        type="button"
                        title="Edit in Editor"
                        aria-label={`Edit ${savedSpec.gameTitle} in Editor`}
                        onClick={() => onEdit(savedSpec.id)}
                        className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-line bg-white px-2.5 text-xs font-semibold hover:bg-sage"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span className="hidden xl:inline">Edit</span>
                      </button>
                    ) : null}
                    {savedSpec.canDelete ? (
                      <button
                        type="button"
                        title="Delete saved spec"
                        aria-label={`Delete ${savedSpec.gameTitle}`}
                        onClick={() => {
                          if (window.confirm(`Delete ${savedSpec.gameTitle}?`)) void onDelete(savedSpec.id);
                        }}
                        className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-rose/40 bg-rose/10 px-2.5 text-xs font-semibold text-rose hover:bg-rose/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="hidden xl:inline">Delete</span>
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    <section className="space-y-4">
      <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end">
        <div>
          <h2 className="text-xl font-bold text-ink">User Roles</h2>
          <p className="text-sm text-slate-600">Assign admin, editor, or viewer access for signed-in users.</p>
        </div>
        <Metric label="Users" value={users.length} />
      </div>

      {status ? <p className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-cobalt">{status}</p> : null}

      <div className="overflow-hidden rounded-md border border-line bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-sage text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-3 py-3">
                  <div className="font-semibold text-ink">{user.name || user.email}</div>
                  <div className="text-xs text-slate-500">{user.email}</div>
                </td>
                <td className="px-3 py-3">
                  <select
                    value={user.role}
                    disabled={user.id === currentUser?.id}
                    onChange={(event) => void updateRole(user.id, event.target.value as UserRole)}
                    className="focus-ring h-10 rounded-md border border-line bg-white px-3 text-sm font-semibold disabled:opacity-60"
                  >
                    {(["admin", "editor", "viewer"] as UserRole[]).map((role) => (
                      <option key={role} value={role}>
                        {roleLabels[role]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-3">{new Date(user.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
            {!users.length && !isLoading ? (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-sm text-slate-500">
                  No users have signed in yet.
                </td>
              </tr>
            ) : null}
            {isLoading ? (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-sm text-slate-500">
                  Loading users...
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
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

function EventSpecCard({ event }: { event: GeneratedEvent }) {
  const tone = categoryTone(`${event.category} ${event.featurePack} ${event.eventName}`);
  return (
    <article className={`overflow-hidden rounded-md border border-line border-l-2 bg-white shadow-sm ${tone.border}`}>
      <div className="border-b border-line bg-mist/50 px-4 py-4">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div className="flex min-w-0 gap-3">
            <div className={`mt-1 h-11 w-1.5 shrink-0 rounded-full ${tone.bar}`} />
            <div className="min-w-0">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-wide text-slate-500">Event</div>
              <h4 className={`mt-1 truncate font-mono text-2xl font-bold leading-tight ${tone.text}`}>{event.eventName}</h4>
              <p className="mt-1 text-sm font-semibold text-slate-600">{event.featurePack}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ToneChip tone={tone}>{event.payloadFields.length} payloads</ToneChip>
            <StatusChip status={event.status} />
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-700">{event.trigger || "No trigger description yet."}</p>
      </div>

      {(event.argumentName || event.argumentDescription || event.argumentExamples) ? (
        <div className="grid gap-3 border-b border-line bg-mist/50 px-4 py-3 md:grid-cols-3">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">Argument</div>
            <div className={`mt-1 font-mono text-sm font-semibold ${tone.text}`}>{event.argumentName || "-"}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">Description</div>
            <div className="mt-1 text-sm text-slate-700">{event.argumentDescription || "-"}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">Examples</div>
            <div className="mt-1 font-mono text-xs text-slate-700">{event.argumentExamples || "-"}</div>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <div className={`flex items-center justify-between border-b border-line px-3 py-2 ${tone.table}`}>
          <div className="font-mono text-xs font-semibold uppercase tracking-wide">Payload Fields</div>
          <div className="font-mono text-[11px] font-semibold">{event.payloadFields.length} rows</div>
        </div>
        <table className="w-full min-w-[880px] text-left text-[15px]">
          <thead className={`text-xs uppercase ${tone.table}`}>
            <tr>
              <th className="px-3 py-2">Payload</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Example</th>
              <th className="px-3 py-2">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {event.payloadFields.map((payload, payloadIndex) => (
              <tr key={`${event.eventName}-${payload.canonicalFieldName}-${payloadIndex}`}>
                <td className={`px-3 py-3 align-top font-mono text-base font-bold ${tone.text}`}>{payload.canonicalFieldName}</td>
                <td className="px-3 py-3 align-top text-slate-700">{payload.description}</td>
                <td className="px-3 py-3 align-top font-mono text-sm text-emerald">{payload.example}</td>
                <td className="px-3 py-3 align-top"><DataTypePill type={payload.type} /></td>
              </tr>
            ))}
            {!event.payloadFields.length ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-500">
                  No payloads specified for this event.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function PlatformAdEventCard({
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
    <article className={`overflow-hidden rounded-md border border-line border-l-2 bg-white shadow-sm ${tone.border}`}>
      <div className="flex flex-col justify-between gap-3 border-b border-line bg-mist/50 px-4 py-4 md:flex-row md:items-start">
        <div className="flex min-w-0 gap-3">
          <div className={`mt-1 h-11 w-1.5 shrink-0 rounded-full ${tone.bar}`} />
          <div className="min-w-0">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wide text-slate-500">Payload Group</div>
            <h4 className={`mt-1 truncate font-mono text-2xl font-bold leading-tight ${tone.text}`}>{eventName}</h4>
            <p className="mt-1 text-sm font-semibold text-slate-600">{adFamily} platform ad event</p>
          </div>
        </div>
        <ToneChip tone={tone}>{payloads.length} payloads</ToneChip>
      </div>

      <div className="overflow-x-auto">
        <div className={`flex items-center justify-between border-b border-line px-3 py-2 ${tone.table}`}>
          <div className="font-mono text-xs font-semibold uppercase tracking-wide">Payload Fields</div>
          <div className="font-mono text-[11px] font-semibold">{payloads.length} rows</div>
        </div>
        <table className="w-full min-w-[760px] text-left text-[15px]">
          <thead className={`text-xs uppercase ${tone.table}`}>
            <tr>
              <th className="px-3 py-2">Payload</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Example</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {payloads.map((payload, payloadIndex) => (
              <tr key={`${payload.platformEventName}-${payload.canonicalPayloadName}-${payloadIndex}`}>
                <td className={`px-3 py-3 align-top font-mono text-base font-bold ${tone.text}`}>{payload.canonicalPayloadName}</td>
                <td className="px-3 py-3 align-top text-slate-700">{payload.description}</td>
                <td className="px-3 py-3 align-top font-mono text-sm text-emerald">{payload.example}</td>
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
      <section className="rounded-md border border-line bg-white p-10 text-center shadow-sm">
        <Table2 className="mx-auto h-8 w-8 text-cobalt" />
        <h2 className="mt-4 text-xl font-bold text-ink">Loading saved specs</h2>
      </section>
    );
  }

  if (!savedSpecs.length) {
    return (
      <section className="rounded-md border border-dashed border-line bg-white p-10 text-center shadow-sm">
        <Table2 className="mx-auto h-8 w-8 text-cobalt" />
        <h2 className="mt-4 text-xl font-bold text-ink">No saved specs to view</h2>
        <p className="mt-2 text-sm text-slate-600">Generate and save a game spec first, then it will appear here.</p>
      </section>
    );
  }

  if (!activeSpec) {
    return (
      <section className="rounded-md border border-line bg-white p-10 text-center shadow-sm">
        <Table2 className="mx-auto h-8 w-8 text-cobalt" />
        <h2 className="mt-4 text-xl font-bold text-ink">Select a game spec</h2>
      </section>
    );
  }

  const activeSummary = savedSpecs.find((item) => item.id === activeSpec.id);
  const canEditSpec = canEditActiveSpec(activeSpec.id);

  return (
    <section className="space-y-4">
      <div className="rounded-md border border-line bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-cobalt">
              <Table2 className="h-4 w-4" />
              Spec Viewer
            </div>
            <h2 className="mt-1 text-xl font-bold text-ink">{activeSpec.intake.gameTitle}</h2>
            <p className="text-sm text-slate-600">
              {activeSpec.intake.genre || "Unspecified genre"} · {activeSpec.generatedEvents.length} events ·{" "}
              {rowsForSpec(activeSpec).length} payload rows
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onCopyShareLink(activeSpec.id)}
              className="focus-ring inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold hover:bg-sage"
            >
              <Link2 className="h-4 w-4" />
              Copy Link
            </button>
            {canEditSpec ? (
              <button
                type="button"
                onClick={() => onOpenEdit(activeSpec.id)}
                className="focus-ring inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
              >
                <Pencil className="h-4 w-4" />
                Edit in Editor
              </button>
            ) : null}
          </div>
        </div>
        {shareStatus ? <div className="border-b border-line px-4 py-2 text-xs font-semibold text-cobalt">{shareStatus}</div> : null}

        {savedSpecs.length > 1 ? (
          <div className="flex gap-1 overflow-x-auto border-b border-line bg-mist px-3 pt-3">
            {savedSpecs.map((savedSpec) => (
              <button
                key={savedSpec.id}
                type="button"
                onClick={() => setActiveSpecId(savedSpec.id)}
                className={`focus-ring shrink-0 rounded-t-md border border-b-0 px-4 py-2 text-sm font-semibold ${
                  activeSpec.id === savedSpec.id
                    ? "border-line bg-sage text-ink"
                    : "border-transparent bg-transparent text-slate-600 hover:bg-white/70"
                }`}
              >
                {savedSpec.gameTitle}
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-4">
          <Metric label="Status" value={activeSummary?.status ?? reviewStatusForEvents(activeSpec.generatedEvents)} />
          <Metric label="Events" value={activeSpec.generatedEvents.length} />
          <Metric label="Payload Rows" value={rowsForSpec(activeSpec).length} />
          <Metric label="Updated" value={activeSummary ? new Date(activeSummary.updatedAt).toLocaleDateString() : "-"} />
        </div>

        <div className="border-t border-line px-4 py-4">
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Spec groups">
            {groups.map((group) => {
              const eventCount = group.events.length + platformEventCount(group.platformAdPayloads);
              const payloadCount = payloadCountForEvents(group.events) + group.platformAdPayloads.length;
              const isActive = group.id === activeGroup?.id;
              const tone = categoryTone(group.label);
              return (
                <button
                  key={group.id}
                  type="button"
                  aria-label={`View ${group.label} spec group`}
                  aria-selected={isActive}
                  onClick={() => {
                    setActiveGroupId(group.id);
                    setQuery("");
                  }}
                  className={`focus-ring shrink-0 rounded-md border px-4 py-3 text-left text-sm ${
                    isActive ? `border-cobalt bg-cobalt text-white shadow-sm` : `border-line bg-white text-slate-700 hover:bg-mist`
                  }`}
                >
                  <div className={`mb-2 h-1 w-10 rounded ${isActive ? "bg-white/80" : tone.bar}`} />
                  <div className={`font-mono text-base font-bold leading-tight ${isActive ? "text-white" : tone.text}`}>{group.label}</div>
                  <div className={`mt-1 font-mono text-xs ${isActive ? "text-white/80" : "text-slate-500"}`}>
                    {eventCount} events · {payloadCount} payloads
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {activeGroup ? (
          <div className="border-t border-line bg-mist/50 px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">Current Group</div>
                <div className="mt-1 flex items-center gap-3">
                  <div className={`h-8 w-1.5 rounded-full ${categoryTone(activeGroup.label).bar}`} />
                  <h3 className={`font-mono text-2xl font-bold leading-tight ${categoryTone(activeGroup.label).text}`}>
                    {activeGroup.label}
                  </h3>
                </div>
                <p className="mt-1 text-sm text-slate-600">{activeGroup.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:min-w-72">
                <div className="rounded-md border border-line bg-white px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-slate-500">Events</div>
                  <div className="mt-1 text-lg font-bold text-ink">
                    {activeGroup.events.length + platformEventCount(activeGroup.platformAdPayloads)}
                  </div>
                </div>
                <div className="rounded-md border border-line bg-white px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-slate-500">Payloads</div>
                  <div className="mt-1 text-lg font-bold text-ink">
                    {payloadCountForEvents(activeGroup.events) + activeGroup.platformAdPayloads.length}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-md border border-line bg-white px-3 py-2 shadow-sm">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${activeGroup.label.toLowerCase()} specs...`}
                className="focus-ring w-full border-0 bg-transparent text-sm outline-none"
              />
            </div>

            <div className="mt-4 space-y-4">
              {filteredGroupEvents.map((event) => (
                <EventSpecCard key={event.eventName} event={event} />
              ))}

              {filteredPlatformAdPayloadGroups.map((platformEvent) => (
                <PlatformAdEventCard
                  key={platformEvent.eventName}
                  eventName={platformEvent.eventName}
                  adFamily={platformEvent.adFamily}
                  payloads={platformEvent.payloads}
                />
              ))}

              {!filteredGroupEvents.length && !filteredPlatformAdPayloadGroups.length ? (
                <div className="rounded-md border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-slate-500">
                  No specs match the current search in {activeGroup.label}.
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="border-t border-line px-4 py-10 text-center text-sm text-slate-500">
            No grouped specs are available for this game.
          </div>
        )}
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
  const visibleNavigationItems = navigationItems.filter((item) => item.tab !== "users" || canManageUsers(auth.user));
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

  return (
    <main className="theme-dark min-h-screen bg-mist">
      <div className="flex min-h-screen">
        <aside
          className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-line bg-white/95 transition-[width] duration-200 ${
            sidebarCollapsed ? "w-20" : "w-20 md:w-72"
          }`}
        >
          <div className={`border-b border-line px-4 py-5 ${sidebarCollapsed ? "text-center" : ""}`}>
            <div
              className={`flex items-center gap-3 ${
                sidebarCollapsed ? "justify-center" : "max-md:justify-center"
              }`}
            >
              <img
                src="/cerberus_logo_512.png"
                alt="Cerberus Analytics Hub"
                className="h-10 w-10 shrink-0 rounded-md object-contain"
              />
              {sidebarCollapsed ? null : (
                <h1 className="text-lg font-bold leading-tight text-ink max-md:hidden">Cerberus Analytics Hub</h1>
              )}
            </div>
            <div className="mt-4">
              <ProductSwitcher current="spec-generator" collapsed={sidebarCollapsed} />
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Primary navigation">
            {sidebarCollapsed ? null : (
              <div className="px-3 pb-2 pt-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 max-md:hidden">
                Workflow
              </div>
            )}
            {visibleNavigationItems.map((item) => (
              <SidebarNavButton
                key={item.tab}
                item={item}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                collapsed={sidebarCollapsed}
              />
            ))}
          </nav>

          <div className="border-t border-line p-3">
            <AuthPanel auth={auth} collapsed={sidebarCollapsed} />
          </div>

          <div className="border-t border-line p-3">
            <button
              type="button"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setSidebarCollapsed((value) => !value)}
              className={`focus-ring flex h-10 w-full items-center gap-2 rounded-md border border-line bg-mist px-3 text-sm font-semibold text-slate-500 hover:bg-sage hover:text-ink ${
                sidebarCollapsed ? "justify-center" : "justify-start max-md:justify-center"
              }`}
            >
              {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              {sidebarCollapsed ? null : <span className="max-md:hidden">Collapse</span>}
            </button>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-8">
        {activeTab === "intake" ? (
          <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 rounded-lg border border-line bg-white p-5 shadow-soft">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-ink">Game Title</span>
                  <input
                    {...form.register("gameTitle")}
                    className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm shadow-sm"
                    placeholder="Sizzle Sort"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-ink">Genre</span>
                  <input
                    {...form.register("genre")}
                    className="focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm shadow-sm"
                    placeholder="Match-3 timed puzzle"
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
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
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Game Modes" name="gameModes" register={form.register} />
                <Field label="Win Conditions" name="winConditions" register={form.register} />
                <Field label="Lose Conditions" name="loseConditions" register={form.register} />
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
                <p className="rounded-md border border-line bg-sage p-3 text-sm text-slate-700">
                  Sign in as an admin or editor to generate and save specs.
                </p>
              ) : null}
              {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={isGenerating || !canCreateOrEdit}
                  className="focus-ring inline-flex items-center gap-2 rounded-md bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt/90 disabled:opacity-60"
                >
                  <Play className="h-4 w-4" />
                  {isGenerating ? "Generating..." : "Generate Spec"}
                </button>
                <button
                  type="button"
                  onClick={() => form.reset(exampleIntake)}
                  className="focus-ring inline-flex items-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                >
                  <Sparkles className="h-4 w-4" />
                  Load Example
                </button>
              </div>
            </form>

            <aside className="space-y-4">
              <div className="rounded-lg border border-line bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 font-bold text-ink">
                  <Library className="h-4 w-4" />
                  Library Seed
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Seeded from {library.events.length} canonical events and {library.generationPacks.length} generation packs.
                </p>
              </div>
              <div className="rounded-lg border border-line bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 font-bold text-ink">
                  <BookOpen className="h-4 w-4" />
                  Intake Tips
                </div>
                <ul className="mt-2 space-y-2 text-sm text-slate-600">
                  {splitTextList("Mention ads only if the game has ads; Include IAP/store terms if purchases exist; Add lose conditions to improve Game_End payload recommendations").map(
                    (tip) => (
                      <li key={tip}>{tip}</li>
                    ),
                  )}
                </ul>
              </div>
            </aside>
          </section>
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
          </div>
        </section>
      </div>
    </main>
  );
}
