import { z } from "zod";
import { canonicalFieldName } from "@/lib/canonical";
import {
  generateSpecFromRules,
  payloadsForEvent,
  triggerFor,
} from "@/lib/generator";
import {
  payloadFieldSchema,
  type GameIntake,
  type GeneratedSpec,
  type LibrarySnapshot,
} from "@/lib/types";

export const intakeFields = [
  "genre",
  "coreLoop",
  "gameModes",
  "mechanics",
  "winConditions",
  "loseConditions",
  "economy",
  "itemsOrPowerups",
  "powerupNames",
  "iap",
  "ads",
  "rewardedAdPlacements",
  "interstitialAdPlacements",
  "liveOps",
  "notes",
] as const;
export const ruleSchema = z
  .object({
    mode: z.enum(["default", "always", "never", "any", "all"]),
    conditions: z
      .array(
        z.object({
          field: z.enum(intakeFields),
          operator: z.enum(["contains", "equals", "notContains", "notEmpty"]),
          value: z.string(),
        }),
      )
      .max(50),
  })
  .superRefine((rule, ctx) => {
    if (
      ["any", "all"].includes(rule.mode) &&
      (!rule.conditions.length ||
        rule.conditions.some(
          (c) => c.operator !== "notEmpty" && !c.value.trim(),
        ))
    )
      ctx.addIssue({
        code: "custom",
        message: "Conditional rules need at least one condition with a value.",
      });
  });
export type GenerationRule = z.infer<typeof ruleSchema>;
const fieldSchema = payloadFieldSchema.extend({
  canonicalFieldName: z.string().trim().min(1),
  sourceFieldName: z.string(),
  rule: ruleSchema,
  useIntakeExample: z.boolean(),
});
export type TemplateField = z.infer<typeof fieldSchema>;
const eventSchema = z.object({
  id: z.string().min(1),
  sourceEventName: z.string(),
  eventName: z.string().trim().min(1),
  category: z.string(),
  featurePack: z.string(),
  trigger: z.string(),
  argumentName: z.string(),
  argumentDescription: z.string(),
  argumentExamples: z.string(),
  rule: ruleSchema,
  useIntakeTrigger: z.boolean(),
  generatePowerupFields: z.boolean(),
  fields: z.array(fieldSchema).max(300),
  sharedFieldIds: z.array(z.string()),
});
export const generationConfigSchema = z
  .object({
    events: z.array(eventSchema).min(1).max(300),
    sharedFields: z
      .array(z.object({ id: z.string().min(1), field: fieldSchema }))
      .max(300),
    platformAds: z
      .array(
        z.object({
          platformEventName: z.string().min(1),
          sourcePlatformEventName: z.string(),
          sourceCanonicalPayloadName: z.string(),
          adFamily: z.string(),
          payloadName: z.string().min(1),
          canonicalPayloadName: z.string().min(1),
          description: z.string(),
          example: z.string(),
          requiredness: z.string(),
          rule: ruleSchema,
          useIntakeExample: z.boolean(),
        }),
      )
      .max(300),
  })
  .superRefine((config, ctx) => {
    const unique = (values: string[], label: string) => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: "custom", message: `Duplicate ${label}.` });
    };
    unique(
      config.events.map((e) => e.id),
      "event IDs",
    );
    unique(
      config.events.map((e) => e.eventName.toLowerCase()),
      "event names",
    );
    unique(
      config.sharedFields.map((f) => f.id),
      "shared field IDs",
    );
    unique(
      config.platformAds.map(
        (p) => `${p.platformEventName}:${p.canonicalPayloadName}`,
      ),
      "platform payload names",
    );
    for (const event of config.events) {
      if (
        event.sharedFieldIds.some(
          (id) => !config.sharedFields.some((f) => f.id === id),
        )
      )
        ctx.addIssue({
          code: "custom",
          message: `${event.eventName} references a missing shared field.`,
        });
      unique(event.sharedFieldIds, `shared references in ${event.eventName}`);
      unique(
        event.fields.map((f) => f.canonicalFieldName),
        `payload names in ${event.eventName}`,
      );
      unique(
        event.sharedFieldIds.map(
          (id) =>
            config.sharedFields.find((f) => f.id === id)?.field
              .canonicalFieldName ?? id,
        ),
        `inherited payload names in ${event.eventName}`,
      );
    }
  });
export type GenerationConfig = z.infer<typeof generationConfigSchema>;
export type TemplateEvent = GenerationConfig["events"][number];
export const defaultRule = (): GenerationRule => ({
  mode: "default",
  conditions: [],
});
export function matchesRule(
  rule: GenerationRule,
  intake: GameIntake,
  fallback: boolean,
): boolean {
  if (rule.mode === "default") return fallback;
  if (rule.mode === "always") return true;
  if (rule.mode === "never") return false;
  const matches = rule.conditions.map((c) => {
    const actual = intake[c.field].toLowerCase();
    const value = c.value.toLowerCase();
    return c.operator === "notEmpty"
      ? !!actual.trim()
      : c.operator === "equals"
        ? actual === value
        : c.operator === "notContains"
          ? !actual.includes(value)
          : actual.includes(value);
  });
  return rule.mode === "all" ? matches.every(Boolean) : matches.some(Boolean);
}
export function seedGenerationConfig(
  snapshot: LibrarySnapshot,
): GenerationConfig {
  const events = snapshot.events.map((e, index) => {
    const seen = new Set<string>();
    const fields = snapshot.payloads
      .filter((p) => p.eventName === e.eventName)
      .flatMap((p) => {
        const name = canonicalFieldName(p.canonicalFieldName || p.fieldName);
        if (seen.has(name)) return [];
        seen.add(name);
        return [
          {
            fieldName: p.fieldName,
            canonicalFieldName: name,
            sourceFieldName: name,
            type: p.dataType,
            requiredness: p.requiredness,
            description: p.fieldDescription,
            example: p.example,
            notes: p.note,
            rule: defaultRule(),
            useIntakeExample: true,
          },
        ];
      });
    return {
      id: `event-${index}`,
      sourceEventName: e.eventName,
      eventName: e.eventName,
      category: e.category,
      featurePack: e.featurePack,
      trigger: e.triggerDescription,
      argumentName: e.argumentType,
      argumentDescription: e.argumentDescription,
      argumentExamples: e.argumentExamples,
      rule: defaultRule(),
      useIntakeTrigger: true,
      generatePowerupFields: true,
      fields,
      sharedFieldIds: [] as string[],
    };
  });
  // One shared definition per field name; existing differences stay explicit event overrides.
  const groups = new Map<
    string,
    Array<{ event: TemplateEvent; field: TemplateField }>
  >();
  for (const event of events)
    for (const field of event.fields) {
      const key = field.canonicalFieldName;
      groups.set(key, [...(groups.get(key) ?? []), { event, field }]);
    }
  const sharedFields: GenerationConfig["sharedFields"] = [];
  for (const group of groups.values())
    if (group.length > 1) {
      const id = `shared-${sharedFields.length}`;
      const counts = new Map<string, number>();
      for (const { field } of group) {
        const key = JSON.stringify(field);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      sharedFields.push({ id, field: JSON.parse(common) as TemplateField });
      for (const { event, field } of group) {
        event.sharedFieldIds.push(id);
        if (JSON.stringify(field) === common)
          event.fields = event.fields.filter((f) => f !== field);
      }
    }
  const platformAds = snapshot.platformAdPayloads.map((p) => ({
    platformEventName: p.platformEventName,
    sourcePlatformEventName: p.platformEventName,
    sourceCanonicalPayloadName: canonicalFieldName(
      p.canonicalFieldName || p.fieldName,
    ),
    adFamily: p.adFamily,
    payloadName: p.fieldName,
    canonicalPayloadName: canonicalFieldName(
      p.canonicalFieldName || p.fieldName,
    ),
    description: p.fieldDescription,
    example: p.example,
    requiredness: p.requiredness,
    rule: defaultRule(),
    useIntakeExample: true,
  }));
  return generationConfigSchema.parse({ events, sharedFields, platformAds });
}
export function generateWithConfig(
  intake: GameIntake,
  snapshot: LibrarySnapshot,
  config: GenerationConfig,
  version: number,
): GeneratedSpec {
  const baseline = generateSpecFromRules(intake, snapshot);
  const generatedEvents = config.events
    .filter((e) =>
      matchesRule(
        e.rule,
        intake,
        baseline.generatedEvents.some((b) => b.eventName === e.sourceEventName),
      ),
    )
    .map((e) => {
      const baselineFields = payloadsForEvent(
        snapshot,
        e.sourceEventName,
        intake,
      );
      const fields = new Map(
        e.sharedFieldIds
          .map((id) => config.sharedFields.find((f) => f.id === id)!)
          .map((f) => [f.field.canonicalFieldName, f.field]),
      );
      for (const field of e.fields) fields.set(field.canonicalFieldName, field);
      const payloadFields = [...fields.values()]
        .filter((f) =>
          matchesRule(
            f.rule,
            intake,
            baselineFields.some(
              (b) => b.canonicalFieldName === f.sourceFieldName,
            ),
          ),
        )
        .map(({ rule: _rule, useIntakeExample, sourceFieldName, ...f }) => ({
          ...f,
          example: useIntakeExample
            ? (baselineFields.find(
                (b) => b.canonicalFieldName === sourceFieldName,
              )?.example ?? f.example)
            : f.example,
        }));
      if (e.generatePowerupFields)
        for (const field of baselineFields)
          if (
            field.notes === "Generated from Powerup Names intake." &&
            !fields.has(field.canonicalFieldName) &&
            ![...fields.values()].some(
              (configured) =>
                configured.sourceFieldName === field.canonicalFieldName,
            )
          )
            payloadFields.push(field);
      return {
        eventName: e.eventName,
        category: e.category,
        featurePack: e.featurePack,
        trigger: e.useIntakeTrigger
          ? triggerFor(intake, e.sourceEventName, e.trigger)
          : e.trigger.replace(
              /\{\{(\w+)\}\}/g,
              (match, key: string) => intake[key as keyof GameIntake] ?? match,
            ),
        argumentName: e.argumentName,
        argumentDescription: e.argumentDescription,
        argumentExamples: e.argumentExamples,
        payloadFields,
        sourceReferences: ["Admin event generation template"],
        generationReason:
          e.rule.mode === "default"
            ? (baseline.generatedEvents.find(
                (b) => b.eventName === e.sourceEventName,
              )?.generationReason ?? "Default intake rule")
            : `Published template rule: ${e.rule.mode}`,
        status: "Draft",
      };
    });
  const platformAdPayloads = config.platformAds.flatMap(
    ({
      rule,
      useIntakeExample,
      sourcePlatformEventName,
      sourceCanonicalPayloadName,
      ...p
    }) => {
      const base = baseline.platformAdPayloads.find(
        (b) =>
          b.platformEventName === sourcePlatformEventName &&
          b.canonicalPayloadName === sourceCanonicalPayloadName,
      );
      return matchesRule(rule, intake, !!base)
        ? [
            {
              ...p,
              example: useIntakeExample
                ? (base?.example ?? p.example)
                : p.example,
            },
          ]
        : [];
    },
  );
  return {
    ...baseline,
    generationTemplateVersion: version,
    selectedFeaturePacks: [
      ...new Set([
        ...generatedEvents.map((e) => e.featurePack),
        ...(platformAdPayloads.length
          ? ["Platform Ad Payload Enrichment"]
          : []),
      ]),
    ],
    generatedEvents,
    platformAdPayloads,
  };
}
