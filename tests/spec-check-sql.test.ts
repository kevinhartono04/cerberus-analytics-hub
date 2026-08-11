import { describe, expect, it } from "vitest";

import {
  buildSpecCheckSql,
  buildSpecCheckAppVersionsSql,
  specCheckAppIds,
  specEnumFieldNorms,
  specEventNameNorms,
} from "@/lib/spec-check";
import { makeEvent, makePayloadField, makeSpec } from "./helpers/spec-check-fixtures";

const baseFilters = {
  specId: "spec-1",
  appName: "wordblast" as const,
  platform: "ios" as const,
  appVersion: "1.2.3",
  startDate: "2026-07-01",
  endDate: "2026-07-07",
};

describe("buildSpecCheckSql", () => {
  it("substitutes every modifiable parameter", () => {
    const sql = buildSpecCheckSql(baseFilters);
    expect(sql).toContain("to_date('2026-07-01') as start_date, -- modifiable parameter");
    expect(sql).toContain("to_date('2026-07-08') as end_date, -- modifiable parameter".replace("2026-07-08", "2026-07-07"));
    expect(sql).toContain("122 as app_id, -- modifiable parameter");
    expect(sql).toContain("'1.2.3' as app_version, -- modifiable parameter");
    expect(sql).toContain("'ios'::string as platform -- modifiable parameter");
    expect(sql).not.toContain("3003 as app_id");
    expect(sql).not.toContain("0.04.13");
  });

  it("maps every app name to its app id", () => {
    expect(specCheckAppIds.bloomsort).toBe(3003);
    expect(specCheckAppIds.wordblast).toBe(122);
    expect(specCheckAppIds.hexastack).toBe(3008);
    expect(specCheckAppIds.stacksmash).toBe(3011);
    expect(specCheckAppIds.treasureshot).toBe(3012);
    expect(specCheckAppIds.wordoku).toBe(3013);
    const sql = buildSpecCheckSql({ ...baseFilters, appName: "bloomsort" });
    expect(sql).toContain("3003 as app_id, -- modifiable parameter");

    const stacksmashSql = buildSpecCheckSql({ ...baseFilters, appName: "stacksmash" });
    expect(stacksmashSql).toContain("3011 as app_id, -- modifiable parameter");
    const hexastackSql = buildSpecCheckSql({ ...baseFilters, appName: "hexastack" });
    expect(hexastackSql).toContain("3008 as app_id, -- modifiable parameter");
    const treasureshotSql = buildSpecCheckSql({ ...baseFilters, appName: "treasureshot" });
    expect(treasureshotSql).toContain("3012 as app_id, -- modifiable parameter");
    const wordokuSql = buildSpecCheckSql({ ...baseFilters, appName: "wordoku" });
    expect(wordokuSql).toContain("3013 as app_id, -- modifiable parameter");
  });

  it("escapes single quotes in the app version", () => {
    const sql = buildSpecCheckSql({ ...baseFilters, appVersion: "1.0'0" });
    expect(sql).toContain("'1.0''0' as app_version");
  });

  it("uses a null platform when platform is all", () => {
    const sql = buildSpecCheckSql({ ...baseFilters, platform: "all" });
    expect(sql).toContain("null::string as platform -- modifiable parameter");
  });

  it("substitutes the default enum field set", () => {
    const sql = buildSpecCheckSql(baseFilters);
    expect(sql).toContain("payload_name_norm in ('item', 'itemtype', 'placement', 'source') -- modifiable parameter");
  });

  it("extends the enum field set with spec field names, normalized and deduped", () => {
    const sql = buildSpecCheckSql(baseFilters, ["item", "source", "itemtype", "placement", "type", "Item_Type"]);
    expect(sql).toContain("payload_name_norm in ('item', 'itemtype', 'placement', 'source', 'type') -- modifiable parameter");
  });

  it("prioritizes spec-event payload rows in the order by", () => {
    const sql = buildSpecCheckSql(baseFilters, undefined, ["currencytransaction", "Game_End"]);
    expect(sql).toContain(
      "case when event_name_norm in ('currencytransaction', 'gameend') then 0 else 1 end, -- modifiable parameter",
    );
    expect(sql).toContain("case row_type when 'event' then 0 else 1 end");
  });

  it("keeps generated spec and platform-ad events in the audit allowlist", () => {
    const sql = buildSpecCheckSql(baseFilters);
    expect(sql).toContain("'GAME_START'");
    expect(sql).toContain("'CURRENCY_TRANSACTION'");
    expect(sql).toContain("'STORE_PRODUCT_PURCHASE_STARTED'");
    expect(sql).toContain("'STORE_PRODUCT_PURCHASE_FAILURE'");
    expect(sql).toContain("'AD_CALL_REWARDED'");
    expect(sql).toContain("'AD_CLICK_REWARDED'");
    expect(sql).toContain("'AD_CLOSE_REWARDED'");
    expect(sql).toContain("'AD_IMPRESSION_REWARDED'");
    expect(sql).toContain("'AD_CALL_INTERSTITIAL'");
    expect(sql).toContain("'AD_CLICK_INTERSTITIAL'");
    expect(sql).toContain("'AD_CLOSE_INTERSTITIAL'");
    expect(sql).toContain("'AD_IMPRESSION_INTERSTITIAL'");
  });

  it("keeps a harmless order-by placeholder when no spec event norms are given", () => {
    const sql = buildSpecCheckSql(baseFilters);
    expect(sql).toContain("case when event_name_norm in ('') then 0 else 1 end, -- modifiable parameter");
  });

  it("rejects invalid filters", () => {
    expect(() => buildSpecCheckSql({ ...baseFilters, endDate: "2026-06-01" })).toThrow();
    expect(() => buildSpecCheckSql({ ...baseFilters, appName: "not-a-game" })).toThrow();
  });
});

describe("specEnumFieldNorms", () => {
  it("includes spec field names whose canonical name is enum-like", () => {
    const spec = makeSpec({
      generatedEvents: [
        makeEvent({
          payloadFields: [
            makePayloadField({ fieldName: "type", canonicalFieldName: "source", type: "String", example: '"game_end"' }),
            makePayloadField({ fieldName: "level", canonicalFieldName: "level" }),
          ],
        }),
      ],
      platformAdPayloads: [
        {
          platformEventName: "Ad_Call_Rewarded",
          adFamily: "Rewarded",
          payloadName: "ad_placement",
          canonicalPayloadName: "placement",
          description: "",
          example: '"2x_reward"',
          requiredness: "Required",
        },
      ],
    });
    const norms = specEnumFieldNorms(spec);
    expect(norms).toContain("type");
    expect(norms).toContain("adplacement");
    expect(norms).toContain("item");
    expect(norms).toContain("source");
    expect(norms).toContain("itemtype");
    expect(norms).toContain("placement");
    expect(norms).not.toContain("level");
  });
});

describe("specEventNameNorms", () => {
  it("collects normalized event and platform-ad event names", () => {
    const spec = makeSpec({
      generatedEvents: [makeEvent({ eventName: "Currency_Transaction" })],
      platformAdPayloads: [
        {
          platformEventName: "Ad_Call_Rewarded",
          adFamily: "Rewarded",
          payloadName: "placement",
          canonicalPayloadName: "placement",
          description: "",
          example: "",
          requiredness: "Required",
        },
      ],
    });
    expect(specEventNameNorms(spec)).toEqual(["adcallrewarded", "currencytransaction"]);
  });
});

describe("buildSpecCheckAppVersionsSql", () => {
  it("filters by app id, dates, and platform", () => {
    const sql = buildSpecCheckAppVersionsSql({
      appName: "dotpaint",
      platform: "android",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
    });
    expect(sql).toContain("app_id = 3005");
    expect(sql).toContain("between to_date('2026-07-01') and to_date('2026-07-07')");
    expect(sql).toContain("lower(platform) = lower('android')");
    expect(sql).toContain("EVENTS_PRODUCTION_LUDIOS_UNION");
  });

  it("omits the platform predicate for all platforms", () => {
    const sql = buildSpecCheckAppVersionsSql({
      appName: "dotpaint",
      platform: "all",
      startDate: "2026-07-01",
      endDate: "2026-07-07",
    });
    expect(sql).not.toContain("lower(platform)");
  });
});
