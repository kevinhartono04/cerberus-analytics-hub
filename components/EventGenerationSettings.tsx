"use client";
import React, { useEffect, useState } from "react";
import CerberusShell from "@/components/CerberusShell";
import {
  intakeFields,
  type GenerationConfig,
  type GenerationRule,
  type TemplateField,
} from "@/lib/event-generation-config";
import type { GameIntake, GeneratedSpec } from "@/lib/types";

type RecordState = {
  revision: number;
  version: number;
  draft: GenerationConfig;
  published: GenerationConfig;
  updatedBy: string;
  updatedAt: string;
};
const input =
  "focus-ring w-full rounded-lg border border-line/70 bg-surface-panel px-3 py-2 text-sm text-ink";
const button =
  "focus-ring rounded-lg border border-line/70 px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-panel disabled:opacity-40";
const panel = "rounded-xl border border-line/70 bg-surface-card p-5";
const label = "mb-1 block text-xs font-semibold text-slate-500";
const emptyIntake: GameIntake = {
  gameTitle: "Preview Game",
  ...Object.fromEntries(intakeFields.map((k) => [k, ""])),
} as GameIntake;
const friendlyName = (name: string) =>
  name === "iap"
    ? "In-app purchases"
    : name
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase());
const ruleLabels: Record<GenerationRule["mode"], string> = {
  default: "Use existing intake rules",
  always: "Include in every game",
  never: "Do not generate",
  any: "Match any condition",
  all: "Match all conditions",
};
const exampleGames: Array<{ name: string; intake: GameIntake }> = [
  {
    name: "Simple level game",
    intake: {
      ...emptyIntake,
      gameTitle: "Example Level Game",
      genre: "Puzzle",
      coreLoop: "Complete a level",
      winConditions: "Complete objectives",
      loseConditions: "No moves left",
      mechanics: "Limited moves",
    },
  },
  {
    name: "Game with economy & ads",
    intake: {
      ...emptyIntake,
      gameTitle: "Example Puzzle Game",
      genre: "Puzzle",
      coreLoop: "Complete a level",
      mechanics: "Limited moves, Powerups, Revive",
      economy: "Currency, Item inventory",
      powerupNames: "Shuffle, Hammer",
      ads: "Rewarded Ads, Interstitial Ads",
      rewardedAdPlacements: "powerup, revive",
      interstitialAdPlacements: "game_end",
      iap: "Store",
    },
  },
];
function AdvancedRules({
  rule,
  onChange,
  children,
}: {
  rule: GenerationRule;
  onChange: (rule: GenerationRule) => void;
  children?: React.ReactNode;
}) {
  return (
    <details className="rounded-lg border border-line/60 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-cobalt">
        Advanced generation rules · {ruleLabels[rule.mode]}
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-xs text-slate-500">
          Only change these rules if you want to change when this event or field
          is generated.
        </p>
        <RuleEditor rule={rule} onChange={onChange} />
        {children}
      </div>
    </details>
  );
}
function describeChanges(before: unknown, after: unknown, path = ""): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const key = (v: unknown, i: number) => {
      if (!v || typeof v !== "object") return String(v);
      const row = v as Record<string, unknown>;
      return String(
        row.id ??
          (row.platformEventName
            ? `${row.platformEventName} / ${row.canonicalPayloadName}`
            : (row.canonicalFieldName ?? i)),
      );
    };
    const old = new Map(before.map((v, i) => [key(v, i), v]));
    const next = new Map(after.map((v, i) => [key(v, i), v]));
    return [...new Set([...old.keys(), ...next.keys()])].flatMap((k) =>
      describeChanges(old.get(k), next.get(k), `${path} / ${k}`),
    );
  }
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object"
  ) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter(
        (k) =>
          ![
            "id",
            "sourceFieldName",
            "sourceEventName",
            "sourcePlatformEventName",
            "sourceCanonicalPayloadName",
          ].includes(k),
      )
      .flatMap((k) =>
        describeChanges(
          a[k],
          b[k],
          path ? `${path} / ${friendlyName(k)}` : friendlyName(k),
        ),
      );
  }
  const display = (value: unknown): string =>
    typeof value === "object" && value !== null
      ? String(
          (value as Record<string, unknown>).eventName ??
            (value as Record<string, unknown>).canonicalFieldName ??
            "definition",
        )
      : value === ""
        ? "empty"
        : String(value);
  if (before === undefined) return [`Added ${path || display(after)}`];
  if (after === undefined) return [`Removed ${path || display(before)}`];
  return [`${path}: ${display(before)} → ${display(after)}`];
}
const newField = (): TemplateField => ({
  fieldName: "new_field",
  canonicalFieldName: "new_field",
  sourceFieldName: "",
  type: "String",
  requiredness: "Required",
  description: "",
  example: "",
  notes: "",
  rule: { mode: "always", conditions: [] },
  useIntakeExample: false,
});
function TextField({
  title,
  value,
  onChange,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className={label}>{title}</span>
      {/description|trigger|notes/i.test(title) ? (
        <textarea
          rows={2}
          className={input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
function Toggle({
  title,
  checked,
  onChange,
}: {
  title: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {title}
    </label>
  );
}
function RuleEditor({
  rule,
  onChange,
}: {
  rule: GenerationRule;
  onChange: (rule: GenerationRule) => void;
}) {
  return (
    <div className="space-y-3">
      <label>
        <span className={label}>Include when</span>
        <select
          className={input}
          value={rule.mode}
          onChange={(e) =>
            onChange({
              ...rule,
              mode: e.target.value as GenerationRule["mode"],
            })
          }
        >
          <option value="default">Keep existing intake rules</option>
          <option value="always">Always</option>
          <option value="never">Never</option>
          <option value="any">Any condition matches</option>
          <option value="all">All conditions match</option>
        </select>
      </label>
      {rule.mode === "default" ? (
        <p className="text-xs text-slate-500">
          Uses the original feature-pack and mechanic rules. Choose a condition
          mode to replace them. New events and fields should use Always or
          explicit conditions.
        </p>
      ) : null}
      {["any", "all"].includes(rule.mode) ? (
        <>
          {rule.conditions.map((c, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <select
                aria-label={`Intake field ${i + 1}`}
                className={`${input} !w-auto`}
                value={c.field}
                onChange={(e) =>
                  onChange({
                    ...rule,
                    conditions: rule.conditions.map((v, j) =>
                      j === i
                        ? { ...v, field: e.target.value as typeof c.field }
                        : v,
                    ),
                  })
                }
              >
                {intakeFields.map((f) => (
                  <option key={f} value={f}>
                    {friendlyName(f)}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Operator ${i + 1}`}
                className={`${input} !w-auto`}
                value={c.operator}
                onChange={(e) =>
                  onChange({
                    ...rule,
                    conditions: rule.conditions.map((v, j) =>
                      j === i
                        ? {
                            ...v,
                            operator: e.target.value as typeof c.operator,
                          }
                        : v,
                    ),
                  })
                }
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
                <option value="notContains">does not contain</option>
                <option value="notEmpty">is not empty</option>
              </select>
              {c.operator !== "notEmpty" ? (
                <input
                  aria-label={`Condition value ${i + 1}`}
                  className={`${input} !w-48`}
                  value={c.value}
                  onChange={(e) =>
                    onChange({
                      ...rule,
                      conditions: rule.conditions.map((v, j) =>
                        j === i ? { ...v, value: e.target.value } : v,
                      ),
                    })
                  }
                />
              ) : null}
              <button
                className={button}
                onClick={() =>
                  onChange({
                    ...rule,
                    conditions: rule.conditions.filter((_, j) => i !== j),
                  })
                }
              >
                Remove condition
              </button>
            </div>
          ))}
          <button
            className={button}
            onClick={() =>
              onChange({
                ...rule,
                conditions: [
                  ...rule.conditions,
                  { field: "mechanics", operator: "contains", value: "" },
                ],
              })
            }
          >
            Add condition
          </button>
          <p className="text-xs text-slate-500">
            Comparisons ignore case. “Contains” matches text anywhere in the
            intake value.
          </p>
        </>
      ) : null}
    </div>
  );
}
function FieldEditor({
  field,
  onChange,
  onRemove,
  override,
}: {
  field: TemplateField;
  onChange: (f: TemplateField) => void;
  onRemove: () => void;
  override?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-line/60 p-4">
      <div className="flex justify-between gap-3">
        <strong className="font-mono text-sm text-ink">
          {field.canonicalFieldName}
          {override ? " · Customized for this event" : ""}
        </strong>
        <button className={button} onClick={onRemove}>
          {override ? "Use shared definition" : "Remove field"}
        </button>
      </div>
      {override ? (
        <p className="text-xs text-slate-500">
          These values apply only to this event. “Use shared definition”
          discards this customization and restores the shared values.
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <TextField
          title="Payload name"
          value={field.canonicalFieldName}
          onChange={(v) =>
            onChange({ ...field, canonicalFieldName: v, fieldName: v })
          }
        />
        <TextField
          title="Type"
          value={field.type}
          onChange={(v) => onChange({ ...field, type: v })}
        />
        <TextField
          title="Requiredness"
          value={field.requiredness}
          onChange={(v) => onChange({ ...field, requiredness: v })}
        />
        <TextField
          title="Description"
          value={field.description}
          onChange={(v) => onChange({ ...field, description: v })}
        />
        <TextField
          title="Example values"
          value={field.example}
          onChange={(v) =>
            onChange({ ...field, example: v, useIntakeExample: false })
          }
        />
        <TextField
          title="Notes"
          value={field.notes}
          onChange={(v) => onChange({ ...field, notes: v })}
        />
      </div>
      <AdvancedRules
        rule={field.rule}
        onChange={(v) => onChange({ ...field, rule: v })}
      >
        <Toggle
          title="Generate example values from the game intake when available"
          checked={field.useIntakeExample}
          onChange={(v) => onChange({ ...field, useIntakeExample: v })}
        />
      </AdvancedRules>
    </div>
  );
}
export default function EventGenerationSettings() {
  const [record, setRecord] = useState<RecordState | null>(null);
  const [config, setConfig] = useState<GenerationConfig | null>(null);
  const [section, setSection] = useState<
    "events" | "shared" | "ads" | "preview" | "publish"
  >("events");
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [sharedSearch, setSharedSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [intake, setIntake] = useState<GameIntake>(emptyIntake);
  const [preview, setPreview] = useState<GeneratedSpec | null>(null);
  const [tested, setTested] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/event-generation", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setRecord(data);
        setConfig(data.draft);
        setSelected(data.draft.events[0]?.id ?? "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  const dirty =
    !!config &&
    !!record &&
    JSON.stringify(config) !== JSON.stringify(record.draft);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function edit(next: GenerationConfig) {
    setConfig(next);
    setStatus("");
    setPreview(null);
    setTested("");
  }
  async function action(actionName: "save" | "preview" | "publish") {
    if (!config || !record) return false;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const r = await fetch("/api/admin/event-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: actionName,
          revision: record.revision,
          config,
          ...(actionName === "preview" ? { intake } : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Request failed");
      if (actionName === "preview") {
        setPreview(data);
        setTested(JSON.stringify(config));
        setStatus(
          "Preview generated from this draft. Nothing was saved as a game spec.",
        );
      } else {
        setRecord(data);
        setConfig(data.draft);
        setStatus(
          actionName === "publish"
            ? `Version ${data.version} published. Future generation now uses this template.`
            : "Draft saved. Live generation is unchanged.",
        );
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const event = config?.events.find((e) => e.id === selected);
  function patchEvent(patch: Partial<NonNullable<typeof event>>) {
    if (config && event)
      edit({
        ...config,
        events: config.events.map((e) =>
          e.id === event.id ? { ...e, ...patch } : e,
        ),
      });
  }
  const changes =
    config && record
      ? [
          ...config.events
            .filter(
              (e) =>
                JSON.stringify(e) !==
                JSON.stringify(
                  record.published.events.find((p) => p.id === e.id),
                ),
            )
            .map((e) => ({
              name: e.eventName,
              before: record.published.events.find((p) => p.id === e.id),
              after: e,
            })),
          ...record.published.events
            .filter((e) => !config.events.some((p) => p.id === e.id))
            .map((e) => ({
              name: `Removed: ${e.eventName}`,
              before: e,
              after: undefined,
            })),
          ...(JSON.stringify(config.sharedFields) !==
          JSON.stringify(record.published.sharedFields)
            ? [
                {
                  name: "Shared payload definitions",
                  before: record.published.sharedFields,
                  after: config.sharedFields,
                },
              ]
            : []),
          ...(JSON.stringify(config.platformAds) !==
          JSON.stringify(record.published.platformAds)
            ? [
                {
                  name: "Platform ad payloads",
                  before: record.published.platformAds,
                  after: config.platformAds,
                },
              ]
            : []),
        ]
      : [];
  return (
    <CerberusShell
      currentProduct="admin"
      activeAdminSection="event-generation"
      contentClassName="max-w-[1500px]"
    >
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-cobalt">
            Admin · Events Studio
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink">
            Event Generation
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Edit the master template used to generate tracking specs for every
            game.
          </p>
          {record ? (
            <p className="mt-2 text-xs text-slate-500">
              Published version {record.version} ·{" "}
              {dirty
                ? "Unsaved changes"
                : record.revision
                  ? "Draft saved"
                  : "Using the original template"}
              {record.updatedBy
                ? ` · Last updated by ${record.updatedBy}`
                : " · Original library defaults"}
            </p>
          ) : null}
        </div>
        <button
          disabled={!config || busy || !dirty}
          className={`${button} bg-cobalt !text-white`}
          onClick={() => action("save")}
        >
          Save draft
        </button>
      </header>
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-400/40 p-4 text-sm text-red-400"
        >
          {error}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="mb-4 text-sm text-cobalt">
          {status}
        </p>
      ) : null}
      {!config ? (
        !error ? (
          <p className="text-slate-500">Loading generation settings…</p>
        ) : null
      ) : (
        <>
          <nav
            aria-label="Template workflow"
            className="mb-5 grid gap-3 sm:grid-cols-3"
          >
            {(
              [
                [
                  "events",
                  "1. Edit template",
                  "Choose an event and update its fields.",
                ],
                [
                  "preview",
                  "2. Test with a game",
                  "See exactly what your template generates.",
                ],
                [
                  "publish",
                  "3. Publish",
                  "Apply the draft to future generation.",
                ],
              ] as const
            ).map(([id, title, help]) => {
              const active =
                id === "events"
                  ? !["preview", "publish"].includes(section)
                  : section === id;
              return (
                <button
                  key={id}
                  disabled={busy}
                  aria-current={active ? "step" : undefined}
                  className={`${panel} text-left ${active ? "!border-cobalt bg-cobalt/5" : ""}`}
                  onClick={() => setSection(id)}
                >
                  <span
                    className={`block text-sm font-bold ${active ? "text-cobalt" : "text-ink"}`}
                  >
                    {title}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {help}
                  </span>
                </button>
              );
            })}
          </nav>
          {!["preview", "publish"].includes(section) ? (
            <>
              <div className="mb-5 rounded-xl bg-cobalt/5 p-4 text-sm text-ink">
                <strong>Start here:</strong> Select an event, then edit its
                payload names and example values. Save your draft and test it
                before publishing. Your edits stay in draft until you publish.
              </div>
              <nav
                aria-label="Template editors"
                className="mb-5 flex flex-wrap gap-2"
              >
                {(
                  [
                    ["events", "Events & payloads"],
                    ["shared", "Fields shared across events"],
                    ["ads", "Platform ad payloads"],
                  ] as const
                ).map(([id, title]) => (
                  <button
                    key={id}
                    disabled={busy}
                    className={`${button} ${section === id ? "bg-cobalt/10 !text-cobalt" : ""}`}
                    aria-pressed={section === id}
                    onClick={() => setSection(id)}
                  >
                    {title}
                  </button>
                ))}
              </nav>
            </>
          ) : null}
          <fieldset disabled={busy} className="min-w-0">
            {section === "events" ? (
              <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
                <aside className={panel}>
                  <input
                    aria-label="Search events"
                    placeholder="Search events…"
                    className={input}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button
                    className={`${button} my-3 w-full`}
                    onClick={() => {
                      const id = crypto.randomUUID();
                      edit({
                        ...config,
                        events: [
                          ...config.events,
                          {
                            id,
                            sourceEventName: "",
                            eventName: "New_Event",
                            category: "Custom",
                            featurePack: "Custom",
                            trigger: "",
                            argumentName: "",
                            argumentDescription: "",
                            argumentExamples: "",
                            rule: { mode: "always", conditions: [] },
                            useIntakeTrigger: false,
                            generatePowerupFields: false,
                            fields: [],
                            sharedFieldIds: [],
                          },
                        ],
                      });
                      setSelected(id);
                    }}
                  >
                    Add event
                  </button>
                  <div className="space-y-1">
                    {config.events
                      .filter((e) =>
                        `${e.eventName} ${e.featurePack}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((e) => (
                        <button
                          key={e.id}
                          onClick={() => setSelected(e.id)}
                          className={`w-full rounded-lg p-3 text-left ${e.id === selected ? "bg-cobalt/10 text-cobalt" : "text-ink hover:bg-surface-panel"}`}
                        >
                          <span className="block break-all font-mono text-sm">
                            {e.eventName}
                          </span>
                          <span className="text-xs text-slate-500">
                            {
                              new Set([
                                ...e.fields.map((f) => f.canonicalFieldName),
                                ...e.sharedFieldIds.map(
                                  (id) =>
                                    config.sharedFields.find((s) => s.id === id)
                                      ?.field.canonicalFieldName,
                                ),
                              ]).size
                            }{" "}
                            fields · {ruleLabels[e.rule.mode]}
                          </span>
                        </button>
                      ))}
                  </div>
                </aside>
                <section className={`${panel} space-y-5`}>
                  {event ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <h2 className="text-xl font-bold text-ink">
                          {event.eventName}
                        </h2>
                        <button
                          className={button}
                          onClick={() => {
                            edit({
                              ...config,
                              events: config.events.filter(
                                (e) => e.id !== event.id,
                              ),
                            });
                            setSelected(
                              config.events.find((e) => e.id !== event.id)
                                ?.id ?? "",
                            );
                          }}
                        >
                          Remove event
                        </button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <TextField
                          title="Event name"
                          value={event.eventName}
                          onChange={(v) => patchEvent({ eventName: v })}
                        />
                        <TextField
                          title="Category"
                          value={event.category}
                          onChange={(v) => patchEvent({ category: v })}
                        />
                        <TextField
                          title="Feature pack label"
                          value={event.featurePack}
                          onChange={(v) => patchEvent({ featurePack: v })}
                        />
                      </div>
                      <TextField
                        title="When this event fires"
                        value={event.trigger}
                        onChange={(v) =>
                          patchEvent({ trigger: v, useIntakeTrigger: false })
                        }
                      />
                      <div className="grid gap-3 md:grid-cols-3">
                        <TextField
                          title="Argument name"
                          value={event.argumentName}
                          onChange={(v) => patchEvent({ argumentName: v })}
                        />
                        <TextField
                          title="Argument description"
                          value={event.argumentDescription}
                          onChange={(v) =>
                            patchEvent({ argumentDescription: v })
                          }
                        />
                        <TextField
                          title="Argument examples"
                          value={event.argumentExamples}
                          onChange={(v) => patchEvent({ argumentExamples: v })}
                        />
                      </div>
                      <AdvancedRules
                        rule={event.rule}
                        onChange={(v) => patchEvent({ rule: v })}
                      >
                        {["Game_Start", "Game_End"].includes(
                          event.sourceEventName,
                        ) ? (
                          <Toggle
                            title="Use default intake-specific trigger wording"
                            checked={event.useIntakeTrigger}
                            onChange={(v) =>
                              patchEvent({ useIntakeTrigger: v })
                            }
                          />
                        ) : null}
                        <p className="text-xs text-slate-500">
                          Trigger descriptions can use intake placeholders such
                          as {"{{gameTitle}}"}.
                        </p>
                        {event.sourceEventName === "Game_End" ? (
                          <Toggle
                            title="Generate per-powerup counters from intake (Game_End)"
                            checked={event.generatePowerupFields}
                            onChange={(v) =>
                              patchEvent({ generatePowerupFields: v })
                            }
                          />
                        ) : null}
                      </AdvancedRules>
                      <h3 className="font-bold text-ink">Shared payloads</h3>
                      <p className="text-xs text-slate-500">
                        These fields come from a shared definition. Edit the
                        shared definition to update all events using it, or
                        customize a field only for this event.
                      </p>
                      {config.sharedFields
                        .filter((f) => event.sharedFieldIds.includes(f.id))
                        .map((f) => (
                          <div
                            key={f.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/50 p-3"
                          >
                            <Toggle
                              title={`${f.field.canonicalFieldName} · ${f.field.type} · ${event.fields.find((p) => p.canonicalFieldName === f.field.canonicalFieldName)?.example || f.field.example || "No example"}${event.fields.some((p) => p.canonicalFieldName === f.field.canonicalFieldName) ? " · Customized below" : " · Shared"}`}
                              checked={event.sharedFieldIds.includes(f.id)}
                              onChange={(v) =>
                                patchEvent({
                                  sharedFieldIds: v
                                    ? [...event.sharedFieldIds, f.id]
                                    : event.sharedFieldIds.filter(
                                        (id) => id !== f.id,
                                      ),
                                })
                              }
                            />
                            <button
                              className={button}
                              onClick={() => {
                                setSharedSearch(f.field.canonicalFieldName);
                                setSection("shared");
                              }}
                            >
                              Edit shared definition
                            </button>
                            {event.sharedFieldIds.includes(f.id) ? (
                              <button
                                className={button}
                                disabled={event.fields.some(
                                  (p) =>
                                    p.canonicalFieldName ===
                                    f.field.canonicalFieldName,
                                )}
                                onClick={() =>
                                  patchEvent({
                                    fields: [
                                      ...event.fields,
                                      structuredClone(f.field),
                                    ],
                                  })
                                }
                              >
                                Customize for this event
                              </button>
                            ) : null}
                          </div>
                        ))}
                      <label>
                        <span className={label}>Link another shared field</span>
                        <select
                          className={input}
                          value=""
                          onChange={(e) => {
                            if (e.target.value)
                              patchEvent({
                                sharedFieldIds: [
                                  ...event.sharedFieldIds,
                                  e.target.value,
                                ],
                              });
                          }}
                        >
                          <option value="">Choose a shared field…</option>
                          {config.sharedFields
                            .filter((f) => !event.sharedFieldIds.includes(f.id))
                            .map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.field.canonicalFieldName} · {f.field.type}
                              </option>
                            ))}
                        </select>
                      </label>
                      <h3 className="font-bold text-ink">
                        Fields defined for this event
                      </h3>
                      {event.fields.map((f, i) => (
                        <FieldEditor
                          key={i}
                          field={f}
                          override={event.sharedFieldIds.some(
                            (id) =>
                              config.sharedFields.find((s) => s.id === id)
                                ?.field.canonicalFieldName ===
                              f.canonicalFieldName,
                          )}
                          onChange={(v) =>
                            patchEvent({
                              fields: event.fields.map((p, j) =>
                                j === i ? v : p,
                              ),
                            })
                          }
                          onRemove={() =>
                            patchEvent({
                              fields: event.fields.filter((_, j) => i !== j),
                            })
                          }
                        />
                      ))}
                      <button
                        className={button}
                        onClick={() =>
                          patchEvent({ fields: [...event.fields, newField()] })
                        }
                      >
                        Add payload field
                      </button>
                    </>
                  ) : (
                    <p className="text-slate-500">Select an event.</p>
                  )}
                </section>
              </div>
            ) : null}
            {section === "shared" ? (
              <section className={`${panel} space-y-5`}>
                <h2 className="text-xl font-bold text-ink">
                  Shared payload definitions
                </h2>
                <p className="text-sm text-slate-500">
                  Changes here apply to every event using the shared definition
                  after publishing. Events marked “customized” keep their own
                  values. To use the shared values again, open that event and
                  choose “Use shared definition”.
                </p>
                <div className="flex flex-wrap gap-3">
                  <input
                    aria-label="Search shared fields"
                    placeholder="Search shared fields…"
                    className={`${input} max-w-sm`}
                    value={sharedSearch}
                    onChange={(e) => setSharedSearch(e.target.value)}
                  />
                  <button
                    className={button}
                    onClick={() => setSharedSearch("")}
                  >
                    Show all shared fields
                  </button>
                  <button
                    className={button}
                    onClick={() => setSection("events")}
                  >
                    Back to selected event
                  </button>
                </div>
                {config.sharedFields.map((s, i) => {
                  if (
                    !s.field.canonicalFieldName
                      .toLowerCase()
                      .includes(sharedSearch.toLowerCase())
                  )
                    return null;
                  const users = config.events.filter((e) =>
                    e.sharedFieldIds.includes(s.id),
                  );
                  return (
                    <div key={s.id}>
                      <p className="mb-2 text-sm text-cobalt">
                        Used by {users.length} events:{" "}
                        {users
                          .map(
                            (e) =>
                              `${e.eventName}${e.fields.some((f) => f.canonicalFieldName === s.field.canonicalFieldName) ? " (customized)" : ""}`,
                          )
                          .join(", ") || "None"}
                      </p>
                      <FieldEditor
                        field={s.field}
                        onChange={(v) =>
                          edit({
                            ...config,
                            sharedFields: config.sharedFields.map((f, j) =>
                              i === j ? { ...f, field: v } : f,
                            ),
                          })
                        }
                        onRemove={() =>
                          edit({
                            ...config,
                            sharedFields: config.sharedFields.filter(
                              (f) => f.id !== s.id,
                            ),
                            events: config.events.map((e) => ({
                              ...e,
                              sharedFieldIds: e.sharedFieldIds.filter(
                                (id) => id !== s.id,
                              ),
                            })),
                          })
                        }
                      />
                    </div>
                  );
                })}
                <button
                  className={button}
                  onClick={() =>
                    edit({
                      ...config,
                      sharedFields: [
                        ...config.sharedFields,
                        { id: crypto.randomUUID(), field: newField() },
                      ],
                    })
                  }
                >
                  Add shared field
                </button>
              </section>
            ) : null}
            {section === "ads" ? (
              <section className={`${panel} space-y-5`}>
                <h2 className="text-xl font-bold text-ink">
                  Platform ad payloads
                </h2>
                {config.platformAds.map((p, i) => {
                  const patch = (value: Partial<typeof p>) =>
                    edit({
                      ...config,
                      platformAds: config.platformAds.map((v, j) =>
                        i === j ? { ...v, ...value } : v,
                      ),
                    });
                  return (
                    <details
                      key={i}
                      className="rounded-lg border border-line/60 p-4"
                    >
                      <summary className="cursor-pointer font-mono text-sm text-ink">
                        {p.platformEventName} · {p.canonicalPayloadName} ·{" "}
                        {p.example || "No example"}
                      </summary>
                      <div className="mt-4 space-y-3">
                        <div className="grid gap-3 md:grid-cols-3">
                          {(
                            [
                              "platformEventName",
                              "adFamily",
                              "canonicalPayloadName",
                              "description",
                              "example",
                              "requiredness",
                            ] as const
                          ).map((k) => (
                            <TextField
                              key={k}
                              title={friendlyName(k)}
                              value={p[k]}
                              onChange={(v) =>
                                patch({
                                  [k]: v,
                                  ...(k === "example"
                                    ? { useIntakeExample: false }
                                    : {}),
                                  ...(k === "canonicalPayloadName"
                                    ? { payloadName: v }
                                    : {}),
                                })
                              }
                            />
                          ))}
                        </div>
                        <Toggle
                          title="Use intake placement examples when available"
                          checked={p.useIntakeExample}
                          onChange={(v) => patch({ useIntakeExample: v })}
                        />
                        <AdvancedRules
                          rule={p.rule}
                          onChange={(v) => patch({ rule: v })}
                        />
                        <button
                          className={button}
                          onClick={() =>
                            edit({
                              ...config,
                              platformAds: config.platformAds.filter(
                                (_, j) => i !== j,
                              ),
                            })
                          }
                        >
                          Remove platform payload
                        </button>
                      </div>
                    </details>
                  );
                })}
                <button
                  className={button}
                  onClick={() =>
                    edit({
                      ...config,
                      platformAds: [
                        ...config.platformAds,
                        {
                          platformEventName: "New_Platform_Event",
                          sourcePlatformEventName: "",
                          sourceCanonicalPayloadName: "",
                          adFamily: "Rewarded",
                          payloadName: "new_field",
                          canonicalPayloadName: "new_field",
                          description: "",
                          example: "",
                          requiredness: "Required",
                          rule: { mode: "always", conditions: [] },
                          useIntakeExample: false,
                        },
                      ],
                    })
                  }
                >
                  Add platform payload
                </button>
              </section>
            ) : null}
            {section === "preview" ? (
              <section className={`${panel} space-y-5`}>
                <h2 className="text-xl font-bold text-ink">
                  See what a game would generate
                </h2>
                <p className="text-sm text-slate-500">
                  Start with an example game or enter your own details. This
                  preview uses your draft without saving a game spec or changing
                  live generation.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">
                    Fill an example:
                  </span>
                  {exampleGames.map((example) => (
                    <button
                      key={example.name}
                      className={button}
                      onClick={() => {
                        setIntake({ ...example.intake });
                        setPreview(null);
                        setTested("");
                      }}
                    >
                      {example.name}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  Separate multiple selections with commas, for example:
                  Powerups, Revive. Use “Rewarded Ads” or “Interstitial Ads” for
                  ads, and enter their placements below.
                </p>
                <div className="grid gap-3 md:grid-cols-3">
                  {(
                    [
                      "gameTitle",
                      "genre",
                      "coreLoop",
                      "mechanics",
                      "economy",
                      "powerupNames",
                      "iap",
                      "ads",
                      "rewardedAdPlacements",
                      "interstitialAdPlacements",
                    ] as const
                  ).map((k) => (
                    <TextField
                      key={k}
                      title={friendlyName(k)}
                      value={intake[k]}
                      onChange={(v) => {
                        setIntake({ ...intake, [k]: v });
                        setPreview(null);
                        setTested("");
                      }}
                    />
                  ))}
                </div>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-cobalt">
                    More game details (optional)
                  </summary>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {(
                      [
                        "gameModes",
                        "winConditions",
                        "loseConditions",
                        "itemsOrPowerups",
                        "liveOps",
                        "notes",
                      ] as const
                    ).map((k) => (
                      <TextField
                        key={k}
                        title={friendlyName(k)}
                        value={intake[k]}
                        onChange={(v) => {
                          setIntake({ ...intake, [k]: v });
                          setPreview(null);
                          setTested("");
                        }}
                      />
                    ))}
                  </div>
                </details>
                <button
                  className={`${button} bg-cobalt !text-white`}
                  onClick={() => action("preview")}
                >
                  {busy ? "Generating preview…" : "Generate preview"}
                </button>
                {preview ? (
                  <div className="space-y-4">
                    <p className="font-semibold text-ink">
                      {preview.generatedEvents.length} events ·{" "}
                      {preview.platformAdPayloads.length} platform payloads
                    </p>
                    {preview.generatedEvents.map((e) => (
                      <details
                        key={e.eventName}
                        open
                        className="rounded-lg border border-line/60 p-4"
                      >
                        <summary className="font-mono text-ink">
                          {e.eventName} · {e.payloadFields.length} fields
                        </summary>
                        <p className="my-3 text-sm text-slate-500">
                          {e.trigger}
                        </p>
                        <p className="mb-3 text-xs text-slate-500">
                          {e.argumentName}: {e.argumentExamples} ·{" "}
                          {e.generationReason}
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm text-ink">
                            <thead>
                              <tr>
                                {[
                                  "Field",
                                  "Type",
                                  "Requiredness",
                                  "Description",
                                  "Example",
                                ].map((h) => (
                                  <th
                                    key={h}
                                    className="p-2 text-xs text-slate-500"
                                  >
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {e.payloadFields.map((f) => (
                                <tr
                                  key={f.canonicalFieldName}
                                  className="border-t border-line/50"
                                >
                                  {[
                                    f.canonicalFieldName,
                                    f.type,
                                    f.requiredness,
                                    f.description,
                                    f.example,
                                  ].map((v, i) => (
                                    <td key={i} className="p-2">
                                      {v || "—"}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    ))}
                    <details>
                      <summary className="cursor-pointer text-sm text-cobalt">
                        Full generated spec JSON, including platform payloads
                      </summary>
                      <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-surface-panel p-4 text-xs text-ink">
                        {JSON.stringify(preview, null, 2)}
                      </pre>
                    </details>
                  </div>
                ) : null}
              </section>
            ) : null}
            {section === "publish" ? (
              <section className={`${panel} space-y-5`}>
                <h2 className="text-xl font-bold text-ink">
                  Review and publish your template
                </h2>
                <p className="text-sm text-slate-500">
                  Publishing applies to all future generation. Existing saved
                  specs keep their contents and template version.
                </p>
                <div className="rounded-lg bg-surface-panel p-4 text-sm text-ink">
                  <p className="font-semibold">Before you publish</p>
                  <ul className="mt-2 space-y-2">
                    <li>
                      {dirty
                        ? "○ Save your latest changes."
                        : "✓ No unsaved changes."}
                    </li>
                    <li>
                      {tested === JSON.stringify(config)
                        ? "✓ Preview generated for this draft."
                        : "○ Generate a preview in step 2."}
                    </li>
                    <li>
                      {changes.length
                        ? `${changes.length} changed ${changes.length === 1 ? "section" : "sections"} compared with published version ${record?.version}.`
                        : "No differences from the published template."}
                    </li>
                  </ul>
                  {dirty ? (
                    <button
                      className={`${button} mt-3`}
                      onClick={() => action("save")}
                    >
                      Save draft
                    </button>
                  ) : null}
                  {tested !== JSON.stringify(config) ? (
                    <button
                      className={`${button} mt-3 ml-2`}
                      onClick={() => setSection("preview")}
                    >
                      Go to test with a game
                    </button>
                  ) : null}
                </div>
                {changes.map((c, i) => (
                  <details
                    key={i}
                    open
                    className="rounded-lg border border-line/60 p-3"
                  >
                    <summary className="cursor-pointer text-sm font-semibold text-ink">
                      {c.name}
                    </summary>
                    <ul className="mt-3 space-y-1 text-sm text-ink">
                      {describeChanges(c.before, c.after).map((change, j) => (
                        <li key={j} className="break-words">
                          {change}
                        </li>
                      ))}
                    </ul>
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-slate-500">
                        View full definitions (JSON)
                      </summary>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <p className={label}>Published</p>
                          <pre className="max-h-80 overflow-auto bg-surface-panel p-3 text-xs text-ink">
                            {JSON.stringify(c.before ?? "Not present", null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className={label}>Draft</p>
                          <pre className="max-h-80 overflow-auto bg-surface-panel p-3 text-xs text-ink">
                            {JSON.stringify(c.after ?? "Removed", null, 2)}
                          </pre>
                        </div>
                      </div>
                    </details>
                  </details>
                ))}
                {!changes.length ? (
                  <p className="text-sm text-slate-500">
                    No changes to publish.
                  </p>
                ) : null}
                {!dirty &&
                changes.length > 0 &&
                tested === JSON.stringify(config) ? (
                  <p className="text-sm text-slate-500">
                    Ready to publish. This version will be used the next time
                    someone generates a spec.
                  </p>
                ) : null}
                <button
                  className={`${button} bg-cobalt !text-white`}
                  disabled={
                    dirty ||
                    !changes.length ||
                    tested !== JSON.stringify(config)
                  }
                  onClick={() => action("publish")}
                >
                  {busy
                    ? "Publishing…"
                    : `Publish version ${(record?.version ?? 0) + 1}`}
                </button>
              </section>
            ) : null}
          </fieldset>
          {section !== "publish" ? (
            <footer className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/70 bg-surface-card p-4 shadow-lg">
              <p className="text-sm text-slate-500">
                {section === "preview"
                  ? tested === JSON.stringify(config)
                    ? "Preview ready. Review the results, then continue."
                    : "Generate a preview to unlock publishing."
                  : "Save your draft, then see what it generates for a game."}
              </p>
              <button
                disabled={
                  busy ||
                  (section === "preview" && tested !== JSON.stringify(config))
                }
                className={`${button} bg-cobalt !text-white`}
                onClick={async () => {
                  if (dirty && !(await action("save"))) return;
                  setSection(section === "preview" ? "publish" : "preview");
                }}
              >
                {busy
                  ? "Saving…"
                  : section === "preview"
                    ? dirty
                      ? "Save draft & review changes →"
                      : "Review changes →"
                    : dirty
                      ? "Save draft & test →"
                      : "Test with a game →"}
              </button>
            </footer>
          ) : null}
        </>
      )}
    </CerberusShell>
  );
}
