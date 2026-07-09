import type { GeneratedEvent, GeneratedPayloadField, GeneratedSpec } from "@/lib/types";
import type { AuditData, AuditEventRow, AuditPayloadRow } from "@/lib/spec-check";
import { normalizeName } from "@/lib/spec-check";

export function makePayloadField(overrides: Partial<GeneratedPayloadField> = {}): GeneratedPayloadField {
  return {
    fieldName: "level",
    canonicalFieldName: "level",
    type: "Integer",
    requiredness: "Required/default (inferred)",
    description: "Level number",
    example: "12",
    notes: "",
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<GeneratedEvent> = {}): GeneratedEvent {
  return {
    eventName: "Level_Start",
    category: "Gameplay",
    featurePack: "Core Gameplay Round",
    trigger: "Player starts a level",
    argumentName: "level",
    argumentDescription: "Level number",
    argumentExamples: "12",
    payloadFields: [makePayloadField()],
    sourceReferences: [],
    generationReason: "test fixture",
    status: "Draft",
    ...overrides,
  };
}

export function makeSpec(overrides: Partial<GeneratedSpec> = {}): GeneratedSpec {
  return {
    id: "spec-1",
    generatedAt: "2026-07-01T00:00:00.000Z",
    intake: {
      gameTitle: "Fixture Game",
      genre: "Puzzle",
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
    selectedFeaturePacks: ["Core Gameplay Round"],
    generatedEvents: [makeEvent()],
    platformAdPayloads: [],
    assumptions: [],
    ...overrides,
  };
}

export function makeAuditEvent(eventName: string, overrides: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    eventName,
    eventNameNorm: normalizeName(eventName),
    eventCount: 100,
    firstSeen: "2026-07-01 00:00:00",
    lastSeen: "2026-07-07 00:00:00",
    ...overrides,
  };
}

export function makeAuditPayload(
  eventName: string,
  payloadName: string,
  overrides: Partial<AuditPayloadRow> = {},
): AuditPayloadRow {
  return {
    eventName,
    eventNameNorm: normalizeName(eventName),
    payloadName,
    payloadNameNorm: normalizeName(payloadName),
    observedType: "integer",
    payloadCount: 100,
    distinctValueCount: 10,
    maxLength: 4,
    exampleValues: ["12"],
    enumValues: [],
    enumCapped: false,
    ...overrides,
  };
}

export function makeAudit(events: AuditEventRow[], payloads: AuditPayloadRow[], truncated = false): AuditData {
  return { events, payloads, truncated };
}

export function enumValue(value: string, count = 10) {
  return { value, valueNorm: normalizeName(value), count };
}
