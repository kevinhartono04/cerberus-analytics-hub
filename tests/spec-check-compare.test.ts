import { describe, expect, it } from "vitest";

import { compareSpecToAudit, levenshtein, typoDistanceThreshold, type SpecCheckFinding } from "@/lib/spec-check";
import {
  enumValue,
  makeAudit,
  makeAuditEvent,
  makeAuditPayload,
  makeEvent,
  makePayloadField,
  makeSpec,
} from "./helpers/spec-check-fixtures";

function findingsOfType(findings: SpecCheckFinding[], type: SpecCheckFinding["type"]) {
  return findings.filter((finding) => finding.type === type);
}

describe("levenshtein", () => {
  it("computes edit distances", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("abc", "ab")).toBe(1);
    expect(levenshtein("abc", "acb")).toBe(2);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });

  it("scales the typo threshold with length", () => {
    expect(typoDistanceThreshold(3)).toBe(1);
    expect(typoDistanceThreshold(8)).toBe(2);
    expect(typoDistanceThreshold(20)).toBe(3);
  });
});

describe("compareSpecToAudit", () => {
  it("passes cleanly when live data matches the spec", () => {
    const spec = makeSpec();
    const audit = makeAudit(
      [makeAuditEvent("level_start")],
      [makeAuditPayload("level_start", "level", { observedType: "integer" })],
    );
    const report = compareSpecToAudit(spec, audit);
    expect(report.summary.verdict).toBe("pass");
    expect(report.findings).toHaveLength(0);
    expect(report.summary.matchedEventCount).toBe(1);
    expect(report.events[0]).toMatchObject({ status: "matched", specEventName: "Level_Start", liveEventName: "level_start" });
  });

  it("reports missing spec events and untracked live events", () => {
    const spec = makeSpec({ generatedEvents: [makeEvent({ eventName: "Currency_Transaction" })] });
    const audit = makeAudit([makeAuditEvent("Session_Heartbeat")], []);
    const report = compareSpecToAudit(spec, audit);

    const missing = findingsOfType(report.findings, "missing_event");
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe("error");
    expect(missing[0].eventName).toBe("Currency_Transaction");

    const untracked = findingsOfType(report.findings, "untracked_event");
    expect(untracked).toHaveLength(1);
    expect(untracked[0].severity).toBe("info");
    expect(report.summary.verdict).toBe("fail");
  });

  it("detects event name typos and still compares payloads under the typo pair", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          eventName: "Currency_Transaction",
          payloadFields: [makePayloadField({ fieldName: "amount", canonicalFieldName: "amount", type: "Integer" })],
        }),
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("Currency_Transactoin")],
      [makeAuditPayload("Currency_Transactoin", "amount", { observedType: "integer" })],
    );
    const report = compareSpecToAudit(spec, audit);

    const typos = findingsOfType(report.findings, "event_typo");
    expect(typos).toHaveLength(1);
    expect(typos[0].severity).toBe("error");
    expect(typos[0].observedValue).toBe("Currency_Transactoin");
    expect(findingsOfType(report.findings, "untracked_event")).toHaveLength(0);
    expect(findingsOfType(report.findings, "missing_event")).toHaveLength(0);

    const eventReport = report.events.find((event) => event.status === "typo");
    expect(eventReport?.payloads).toHaveLength(1);
    expect(eventReport?.payloads[0].status).toBe("matched");
    expect(report.summary.verdict).toBe("fail");
  });

  it("does not call distant names typos", () => {
    const spec = makeSpec({ generatedEvents: [makeEvent({ eventName: "Level_Start" })] });
    const audit = makeAudit([makeAuditEvent("Level_End")], []);
    const report = compareSpecToAudit(spec, audit);
    expect(findingsOfType(report.findings, "event_typo")).toHaveLength(0);
    expect(findingsOfType(report.findings, "missing_event")).toHaveLength(1);
    expect(findingsOfType(report.findings, "untracked_event")).toHaveLength(1);
  });

  it("prefers exact matches over typo claims", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          eventName: "Level_Start",
          payloadFields: [makePayloadField({ fieldName: "source", canonicalFieldName: "source", type: "String" })],
        }),
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("level_start")],
      [
        makeAuditPayload("level_start", "source", { observedType: "string" }),
        makeAuditPayload("level_start", "sourc", { observedType: "string" }),
      ],
    );
    const report = compareSpecToAudit(spec, audit);
    expect(findingsOfType(report.findings, "payload_typo")).toHaveLength(0);
    const untracked = findingsOfType(report.findings, "untracked_payload");
    expect(untracked).toHaveLength(1);
    expect(untracked[0].payloadName).toBe("sourc");
  });

  it("treats every missing payload as an error", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          payloadFields: [
            makePayloadField({ fieldName: "level", requiredness: "Required/default (inferred)" }),
            makePayloadField({ fieldName: "duration", canonicalFieldName: "duration", requiredness: "Optional (inferred)" }),
          ],
        }),
      ],
    });
    const audit = makeAudit([makeAuditEvent("level_start")], []);
    const report = compareSpecToAudit(spec, audit);
    const missing = findingsOfType(report.findings, "missing_payload");
    expect(missing).toHaveLength(2);
    expect(missing.find((finding) => finding.payloadName === "level")?.severity).toBe("error");
    expect(missing.find((finding) => finding.payloadName === "duration")?.severity).toBe("error");
  });

  it("detects payload name typos", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({ payloadFields: [makePayloadField({ fieldName: "placement", canonicalFieldName: "placement", type: "String" })] }),
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("level_start")],
      [makeAuditPayload("level_start", "placment", { observedType: "string" })],
    );
    const report = compareSpecToAudit(spec, audit);
    const typos = findingsOfType(report.findings, "payload_typo");
    expect(typos).toHaveLength(1);
    expect(typos[0].observedValue).toBe("placment");
    expect(findingsOfType(report.findings, "untracked_payload")).toHaveLength(0);
  });

  it("compares canonical spec payload names rather than legacy source aliases", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          eventName: "Store_Product_Purchase_Failure",
          payloadFields: [
            makePayloadField({
              fieldName: "dollar_vallue",
              canonicalFieldName: "dollar_value",
              type: "Float",
              requiredness: "Required",
            }),
          ],
        }),
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("Store_Product_Purchase_Failure")],
      [makeAuditPayload("Store_Product_Purchase_Failure", "dollar_value", { observedType: "float" })],
    );
    const report = compareSpecToAudit(spec, audit);

    expect(findingsOfType(report.findings, "payload_typo")).toHaveLength(0);
    expect(findingsOfType(report.findings, "missing_payload")).toHaveLength(0);
    expect(findingsOfType(report.findings, "untracked_payload")).toHaveLength(0);
    expect(report.events[0]?.payloads[0]).toMatchObject({
      specName: "dollar_value",
      liveName: "dollar_value",
      status: "matched",
    });
  });

  it("uses the saved canonical payload name as the spec contract", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          payloadFields: [
            makePayloadField({
              fieldName: "item",
              canonicalFieldName: "itemtype",
              type: "String",
              requiredness: "Required",
            }),
          ],
        }),
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("level_start")],
      [makeAuditPayload("level_start", "itemtype", { observedType: "string" })],
    );
    const report = compareSpecToAudit(spec, audit);

    expect(findingsOfType(report.findings, "payload_typo")).toHaveLength(0);
    expect(findingsOfType(report.findings, "missing_payload")).toHaveLength(0);
    expect(findingsOfType(report.findings, "untracked_payload")).toHaveLength(0);
    expect(report.events[0]?.payloads[0]).toMatchObject({
      specName: "itemtype",
      liveName: "itemtype",
      status: "matched",
    });
  });

  it("does not match live legacy aliases when the spec canonical name is different", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          payloadFields: [
            makePayloadField({
              fieldName: "itemtype",
              canonicalFieldName: "item",
              type: "String",
              requiredness: "Required",
            }),
          ],
        }),
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("level_start")],
      [makeAuditPayload("level_start", "itemtype", { observedType: "string" })],
    );
    const report = compareSpecToAudit(spec, audit);

    expect(findingsOfType(report.findings, "payload_typo")).toHaveLength(0);
    expect(findingsOfType(report.findings, "missing_payload")).toHaveLength(1);
    expect(findingsOfType(report.findings, "untracked_payload")).toHaveLength(1);
    expect(report.events[0]?.payloads.map((payload) => payload.status)).toEqual(["missing", "untracked"]);
  });

  it("checks numeric payload types only", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          payloadFields: [
            makePayloadField({ fieldName: "level", type: "Integer" }),
            makePayloadField({ fieldName: "duration", canonicalFieldName: "duration", type: "Float" }),
            makePayloadField({ fieldName: "session_flag", canonicalFieldName: "session_flag", type: "Boolean" }),
            makePayloadField({ fieldName: "screen", canonicalFieldName: "screen", type: "String", example: "" }),
          ],
        }),
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("level_start")],
      [
        makeAuditPayload("level_start", "level", { observedType: "string", exampleValues: ["abc"] }),
        makeAuditPayload("level_start", "duration", { observedType: "integer" }),
        makeAuditPayload("level_start", "session_flag", { observedType: "boolean" }),
        makeAuditPayload("level_start", "screen", { observedType: "integer" }),
      ],
    );
    const report = compareSpecToAudit(spec, audit);
    const mismatches = findingsOfType(report.findings, "type_mismatch");
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ payloadName: "level", severity: "error", observedValue: "string" });
  });

  it("accepts boolean-classified values for integer payloads", () => {
    const spec = makeSpec({
      generatedEvents: [makeEvent({ payloadFields: [makePayloadField({ fieldName: "level", type: "Integer" })] })],
    });
    const audit = makeAudit(
      [makeAuditEvent("level_start")],
      [makeAuditPayload("level_start", "level", { observedType: "boolean" })],
    );
    const report = compareSpecToAudit(spec, audit);
    expect(findingsOfType(report.findings, "type_mismatch")).toHaveLength(0);
  });

  it("warns when an integer payload arrives as float", () => {
    const spec = makeSpec({
      generatedEvents: [makeEvent({ payloadFields: [makePayloadField({ fieldName: "level", type: "Integer" })] })],
    });
    const audit = makeAudit(
      [makeAuditEvent("level_start")],
      [makeAuditPayload("level_start", "level", { observedType: "float" })],
    );
    const report = compareSpecToAudit(spec, audit);
    const mismatches = findingsOfType(report.findings, "type_mismatch");
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].severity).toBe("warning");
  });

  it("checks enum values for typos, unexpected values, and coverage", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          eventName: "Currency_Transaction",
          payloadFields: [
            makePayloadField({
              fieldName: "type",
              canonicalFieldName: "source",
              type: "String",
              example: '"game_end", "collection", "season_pass"',
            }),
          ],
        }),
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("currency_transaction")],
      [
        makeAuditPayload("currency_transaction", "source", {
          observedType: "string",
          enumValues: [enumValue("game_end", 90), enumValue("collectoin", 8), enumValue("bonus_wheel", 2)],
        }),
      ],
    );
    const report = compareSpecToAudit(spec, audit);

    const typos = findingsOfType(report.findings, "enum_value_typo");
    expect(typos).toHaveLength(1);
    expect(typos[0]).toMatchObject({ observedValue: "collectoin", specValue: "collection", count: 8, severity: "error" });

    const unexpected = findingsOfType(report.findings, "enum_unexpected_value");
    expect(unexpected).toHaveLength(1);
    expect(unexpected[0]).toMatchObject({ observedValue: "bonus_wheel", severity: "warning" });

    const coverage = findingsOfType(report.findings, "enum_missing_coverage");
    expect(coverage).toHaveLength(1);
    expect(coverage[0]).toMatchObject({ specValue: "season_pass", severity: "warning" });
    expect(report.summary.verdict).toBe("fail");
  });

  it("caveats missing coverage when live enum values were capped", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          payloadFields: [
            makePayloadField({ fieldName: "item", canonicalFieldName: "item", type: "String", example: '"rare_item"' }),
          ],
        }),
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("level_start")],
      [
        makeAuditPayload("level_start", "item", {
          observedType: "string",
          enumValues: [enumValue("common_item", 100)],
          enumCapped: true,
        }),
      ],
    );
    const report = compareSpecToAudit(spec, audit);
    const coverage = findingsOfType(report.findings, "enum_missing_coverage");
    expect(coverage).toHaveLength(1);
    expect(coverage[0].detail).toContain("capped");
  });

  it("skips enum checks when the spec has no example values", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          payloadFields: [makePayloadField({ fieldName: "source", canonicalFieldName: "source", type: "String", example: "" })],
        }),
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("level_start")],
      [
        makeAuditPayload("level_start", "source", {
          observedType: "string",
          enumValues: [enumValue("anything_at_all")],
        }),
      ],
    );
    const report = compareSpecToAudit(spec, audit);
    expect(report.findings).toHaveLength(0);
  });

  it("warns when an enum-like payload is not string-typed in live data", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          payloadFields: [makePayloadField({ fieldName: "source", canonicalFieldName: "source", type: "String", example: '"click"' })],
        }),
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("level_start")],
      [makeAuditPayload("level_start", "source", { observedType: "integer" })],
    );
    const report = compareSpecToAudit(spec, audit);
    const mismatches = findingsOfType(report.findings, "type_mismatch");
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].severity).toBe("warning");
    expect(mismatches[0].detail).toContain("Enum-like");
  });

  it("treats platform ad payloads as pseudo-events", () => {
    const spec = makeSpec({
      generatedEvents: [],
      platformAdPayloads: [
        {
          platformEventName: "Ad_Call_Rewarded",
          adFamily: "Rewarded",
          payloadName: "placement",
          canonicalPayloadName: "placement",
          description: "",
          example: '"2x_reward", "daily_reward"',
          requiredness: "Required payload enrichment",
        },
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("ad_call_rewarded")],
      [
        makeAuditPayload("ad_call_rewarded", "placement", {
          observedType: "string",
          enumValues: [enumValue("2x_reward", 40)],
        }),
      ],
    );
    const report = compareSpecToAudit(spec, audit);
    const eventReport = report.events.find((event) => event.specEventName === "Ad_Call_Rewarded");
    expect(eventReport?.source).toBe("platformAd");
    expect(eventReport?.status).toBe("matched");
    const coverage = findingsOfType(report.findings, "enum_missing_coverage");
    expect(coverage).toHaveLength(1);
    expect(coverage[0].specValue).toBe("daily_reward");
  });

  it("merges duplicate spec payload definitions and notes them", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          payloadFields: [
            makePayloadField({ fieldName: "item", canonicalFieldName: "item", type: "String", example: '"hammer"' }),
            makePayloadField({ fieldName: "item", canonicalFieldName: "item", type: "String", example: '"bomb"' }),
          ],
        }),
      ],
    });
    const audit = makeAudit(
      [makeAuditEvent("level_start")],
      [
        makeAuditPayload("level_start", "item", {
          observedType: "string",
          enumValues: [enumValue("hammer"), enumValue("bomb")],
        }),
      ],
    );
    const report = compareSpecToAudit(spec, audit);
    expect(findingsOfType(report.findings, "duplicate_spec_payload")).toHaveLength(1);
    expect(findingsOfType(report.findings, "enum_missing_coverage")).toHaveLength(0);
    expect(findingsOfType(report.findings, "enum_unexpected_value")).toHaveLength(0);
  });

  it("downgrades missing events that the audit filter excludes", () => {
    const spec = makeSpec({ generatedEvents: [makeEvent({ eventName: "AB_Test_Assignment" })] });
    const audit = makeAudit([makeAuditEvent("level_start")], []);
    const report = compareSpecToAudit(spec, audit);
    const missing = findingsOfType(report.findings, "missing_event");
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe("info");
    expect(missing[0].detail).toContain("exclusion filter");
  });

  it("returns no data when the audit is empty", () => {
    const report = compareSpecToAudit(makeSpec(), makeAudit([], []));
    expect(report.summary.verdict).toBe("no data");
    expect(report.summary.liveEventCount).toBe(0);
  });

  it("handles a spec with zero events against live data", () => {
    const spec = makeSpec({ generatedEvents: [], platformAdPayloads: [] });
    const audit = makeAudit([makeAuditEvent("level_start")], [makeAuditPayload("level_start", "level")]);
    const report = compareSpecToAudit(spec, audit);
    expect(report.summary.verdict).toBe("pass");
    expect(report.summary.specEventCount).toBe(0);
    expect(findingsOfType(report.findings, "untracked_event")).toHaveLength(1);
  });

  it("propagates the truncation flag", () => {
    const report = compareSpecToAudit(makeSpec(), makeAudit([makeAuditEvent("level_start")], [], true));
    expect(report.truncated).toBe(true);
  });
});
