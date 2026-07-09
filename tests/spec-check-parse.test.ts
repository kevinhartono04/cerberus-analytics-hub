import { describe, expect, it } from "vitest";

import { normalizeName, parseAuditRows, parseExampleValues } from "@/lib/spec-check";

const header =
  "row_type,event_name,event_name_norm,payload_name,payload_name_norm,observed_type,event_count,payload_count,distinct_value_count,first_seen,last_seen,max_length,example_values,enum_value_counts,enum_value_rank_count";

describe("normalizeName", () => {
  it("matches the SQL normalization", () => {
    expect(normalizeName("Level_Start")).toBe("levelstart");
    expect(normalizeName("Ad-Call Rewarded!")).toBe("adcallrewarded");
    expect(normalizeName("item_type")).toBe("itemtype");
  });
});

describe("parseAuditRows", () => {
  it("parses event and payload rows", () => {
    const csv = [
      header,
      'event,Level_Start,levelstart,,,,120,,,2026-07-01 08:00:00,2026-07-07 20:00:00,,,,',
      'payload,Level_Start,levelstart,level,level,integer,118,118,42,2026-07-01 08:00:00,2026-07-07 20:00:00,3,1 | 2 | 3,,',
    ].join("\n");

    const data = parseAuditRows(csv, 2);
    expect(data.truncated).toBe(false);
    expect(data.events).toHaveLength(1);
    expect(data.events[0]).toMatchObject({
      eventName: "Level_Start",
      eventNameNorm: "levelstart",
      eventCount: 120,
      firstSeen: "2026-07-01 08:00:00",
    });
    expect(data.payloads).toHaveLength(1);
    expect(data.payloads[0]).toMatchObject({
      payloadName: "level",
      observedType: "integer",
      payloadCount: 118,
      distinctValueCount: 42,
      maxLength: 3,
      exampleValues: ["1", "2", "3"],
      enumValues: [],
      enumCapped: false,
    });
  });

  it("parses enum value counts including values containing colons", () => {
    const csv = [
      header,
      'payload,Currency_Transaction,currencytransaction,item,item,string,50,50,3,2026-07-01,2026-07-07,12,shuffle | boost:er,shuffle:::40|||boost:er:::10,2',
    ].join("\n");

    const data = parseAuditRows(csv);
    expect(data.payloads[0].enumValues).toEqual([
      { value: "shuffle", valueNorm: "shuffle", count: 40 },
      { value: "boost:er", valueNorm: "booster", count: 10 },
    ]);
    expect(data.payloads[0].enumCapped).toBe(false);
  });

  it("flags the enum cap at 50 ranked values", () => {
    const entries = Array.from({ length: 50 }, (_, index) => `value${index}:::1`).join("|||");
    const csv = [header, `payload,E,e,source,source,string,50,50,60,2026-07-01,2026-07-07,8,,${entries},50`].join("\n");
    const data = parseAuditRows(csv);
    expect(data.payloads[0].enumValues).toHaveLength(50);
    expect(data.payloads[0].enumCapped).toBe(true);
  });

  it("handles uppercase headers", () => {
    const csv = [header.toUpperCase(), 'event,Level_End,levelend,,,,10,,,2026-07-01,2026-07-07,,,,'].join("\n");
    const data = parseAuditRows(csv);
    expect(data.events).toHaveLength(1);
    expect(data.events[0].eventName).toBe("Level_End");
  });

  it("marks truncation when Count reports more rows than the preview", () => {
    const csv = [header, 'event,Level_Start,levelstart,,,,120,,,2026-07-01,2026-07-07,,,,'].join("\n");
    expect(parseAuditRows(csv, 1200).truncated).toBe(true);
    expect(parseAuditRows(csv, 1).truncated).toBe(false);
  });

  it("returns empty data for an empty preview", () => {
    expect(parseAuditRows(undefined)).toEqual({ events: [], payloads: [], truncated: false });
    expect(parseAuditRows("  ")).toEqual({ events: [], payloads: [], truncated: false });
  });
});

describe("parseExampleValues", () => {
  it("splits comma-separated quoted lists", () => {
    expect(parseExampleValues('"powerup_hint", "2x_reward", "ad_reward"')).toEqual([
      "powerup_hint",
      "2x_reward",
      "ad_reward",
    ]);
  });

  it("splits slash-separated values", () => {
    expect(parseExampleValues("game_screen / home_screen")).toEqual(["game_screen", "home_screen"]);
  });

  it("keeps values with embedded slashes when not whitespace-delimited", () => {
    expect(parseExampleValues("n/a")).toEqual(["n/a"]);
  });

  it("dedupes by normalized value and drops empties", () => {
    expect(parseExampleValues('"click", click, , CLICK, auto')).toEqual(["click", "auto"]);
  });

  it("returns empty for an empty example", () => {
    expect(parseExampleValues("")).toEqual([]);
  });
});
