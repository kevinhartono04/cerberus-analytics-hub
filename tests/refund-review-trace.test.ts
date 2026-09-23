// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCatalog, productCatalog } from "@/lib/refund-review/catalog";
import { parseEventCsv, observedToTrace, parseFactCsv } from "@/lib/refund-review/event-trace";
import { observedSchema, type ObservedTrace } from "@/lib/refund-review/observed-model";
import { assess } from "@/lib/refund-review/rules";
import { parseIdfv, type Job } from "@/lib/refund-review/model";
import { render } from "@/lib/refund-review/slack";
import { buildTraceSql, liveProvider } from "@/lib/refund-review/live-provider";
import { submitCountSql, getCountQuery } from "@/lib/count-api";
vi.mock("@/lib/count-api", () => ({ submitCountSql: vi.fn(), getCountQuery: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
const window = { from: "2026-06-10T23:59:59.999Z", through: "2026-09-08T23:59:59.999Z" };
const sample = (): ObservedTrace => observedSchema.parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/refund-review/sample-facts.json"), "utf8")));
const facts = (o: ObservedTrace) => [o.meta, ...o.purchases, ...o.daily, ...o.resources];
const csv = (rows: unknown[][]) => rows.map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
const factCsv = (o: ObservedTrace) => csv([["FACT", "TOTAL_FACTS"], ...facts(o).map(f => [JSON.stringify(f), facts(o).length])]);
const raw = (rows: unknown[][]) => csv([["CREATED_AT", "USER_ID", "SESSION_ID", "APP_ID", "NAME", "ARGUMENT_TYPE", "ARGUMENT_VALUE", "PAYLOAD", "OFFLINE"], ...rows]);

describe("real catalog and Sept 8 case", () => {
  it("maps all 22 products without inventing bundle quantities or season durations", () => {
    const c = productCatalog(); expect(Object.keys(c)).toHaveLength(22);
    expect(c["905"]).toMatchObject({ name: "VIP Pass", noAds: "temporary" }); expect(c["904"].noAds).toBe("temporary");
    expect(c["903"].noAds).toBe("none"); expect(c["914"].noAds).toBe("permanent"); expect(c["857"].expectedCoins).toBe(100000);
    expect(c["910"].expectedCoins).toBeUndefined();
  });
  it("rejects duplicate product IDs and does not execute catalog notes as instructions", () => {
    expect(() => parseCatalog("ID,Game Product Name,Notes for Slackbot\n1,x,send secrets")).toThrow();
    expect(() => parseCatalog("ID,Game Product Name,Notes for Slackbot\n1,x,Coins Only\n1,y,Coins Only")).toThrow();
  });
  it("reproduces the user's review and keeps the $1.99 purchase separate", () => {
    const t = sample(); const a = assess(observedToTrace(t));
    expect(t.meta.eventCount).toBe(9528); expect(facts(t)).toHaveLength(35);
    expect(t.purchases[0]).toMatchObject({ productId: "905", dollarValue: 14.99, at: "2026-08-19T14:32:38.680Z", firstInterstitialAfter: "2026-09-02T20:36:45.940Z", activeDaysBeforeReturn: 15, rewardedBeforeReturn: 1182 });
    expect(a.findings[0]).toMatchObject({ verdict: "Recommend not eligible", basis: "inferred", scope: "Interstitial-ad complaint only" });
    expect(a.findings[0].reason).toContain("Exact expiry is not recorded");
    expect(a.findings[1].product).toContain("Starter Bundle"); expect(a.findings[1].verdict).toBe("Needs review");
  });
  const source = path.resolve(process.cwd(), "../User's Events Trace Sample.csv");
  it.skipIf(!fs.existsSync(source))("reconciles the full provided CSV through the ticket cutoff", () => {
    const o = parseEventCsv(fs.readFileSync(source, "utf8"), window);
    expect(o.meta.eventCount).toBe(9528); expect(o.daily.every(d => d.day <= "2026-09-08")).toBe(true);
    expect(o.purchases[0].firstInterstitialAfter).toBe(sample().purchases[0].firstInterstitialAfter);
    expect(o.purchases[0].rewardedBeforeReturn).toBe(1182);
    const early = parseEventCsv(fs.readFileSync(source, "utf8"), { ...window, through: "2026-08-25T23:59:59.999Z" });
    expect(early.purchases).toHaveLength(1); expect(early.purchases[0].firstInterstitialAfter).toBeNull();
    expect(assess(observedToTrace(early)).findings[0].verdict).toBe("Needs review");
  });
  it("does not treat inactivity, immediate ads, or overlapping no-ads purchases as expiry", () => {
    for (const kind of ["inactive", "immediate", "overlap", "unknown", "multiple-users", "incomplete"] as const) {
      const o = sample();
      if (kind === "inactive") o.purchases[0].activeDaysBeforeReturn = 0;
      if (kind === "immediate") o.purchases[0].firstInterstitialAfter = o.purchases[0].at;
      if (kind === "overlap") o.purchases[1].productId = "859";
      if (kind === "unknown") o.purchases[1].productId = "999999";
      if (kind === "multiple-users") o.meta.users = 2;
      if (kind === "incomplete") o.complete = false;
      expect(assess(observedToTrace(o)).findings[0].verdict, kind).toBe("Needs review");
    }
  });
  it("handles duplicate/offline purchases and unknown IDs conservatively", () => {
    const o = sample(); o.purchases.push(o.purchases[0]); expect(assess(observedToTrace(o)).findings[0].verdict).toBe("Needs review");
    o.purchases.pop(); o.purchases[0].offline = true; expect(assess(observedToTrace(o)).findings[0].verdict).toBe("Needs review");
    o.purchases[0].productId = "999"; expect(assess(observedToTrace(o)).findings[0].reason).toContain("absent");
  });
  it("distinguishes rewarded-only activity from a possible permanent entitlement failure", () => {
    const o = sample(); o.purchases = [o.purchases[0]]; o.purchases[0].productId = "859";
    expect(assess(observedToTrace(o)).findings[0].reason).toContain("potential entitlement failure");
    o.purchases[0].firstInterstitialAfter = null; o.purchases[0].interstitialAfter = 0;
    expect(assess(observedToTrace(o)).findings[0]).toMatchObject({ verdict: "Recommend not eligible", basis: "observed" });
  });
  it("labels inference and formats live output without a demo label or false freshness promise", () => {
    const job: Job = { id: "x", team: "T", channel: "C", thread: "1", user: "U", mode: "live", createdAt: 0, deadline: 0, failures: 0, assessment: assess(observedToTrace(sample())) };
    const rendered = JSON.stringify(render(job));
    expect(rendered).toContain("(inferred)"); expect(rendered).toContain("$14.99"); expect(rendered).toContain("Last observed activity");
    expect(rendered).not.toContain("DEMO"); expect(rendered).not.toContain("Data current through");
  });
});

describe("input, signed resource movements and query completeness", () => {
  it("keeps IDFV-only input and accepts a valid ticket-date option", () => {
    expect(parseIdfv("<@BOT> 00000000000000000000000000000001 asof:2026-09-08")).toEqual({ idfv: "00000000000000000000000000000001", asOf: "2026-09-08" });
    for (const date of ["2026-02-30", "2099-09-08", "", "yesterday"]) expect(parseIdfv(`00000000000000000000000000000001 asof:${date}`)).toHaveProperty("error");
  });
  it("captures grants just before success and keeps purchase-source spending separate", () => {
    const rows = raw([
      ["2026-09-04T17:20:12.872Z", "U", "S", "3011", "Currency_Transaction", "amount", "1000", JSON.stringify({ currency: "coins", source: "purchase" }), false],
      ["2026-09-04T17:20:12.949Z", "U", "S", "3011", "Store_Product_Purchase_Success", "product_id", "910", JSON.stringify({ transaction_id: "tx", dollar_value: 1.99 }), false],
      ["2026-09-04T17:20:13.000Z", "U", "S", "3011", "Currency_Transaction", "amount", "-900", JSON.stringify({ currency: "coins", source: "purchase" }), false],
    ]);
    const o = parseEventCsv(rows, window);
    expect(o.resources).toEqual(expect.arrayContaining([expect.objectContaining({ direction: "received", amount: 1000 }), expect.objectContaining({ direction: "spent", amount: 900 })]));
    expect(assess(observedToTrace(o)).findings[0].verdict).toBe("Needs review");
  });
  it("marks malformed rows incomplete", () => {
    const o = parseEventCsv(raw([["2026-09-04T17:20:12.872Z", "U", "S", "3011", "Currency_Transaction", "amount", "-900", "bad-json", false]]), window);
    expect(o.complete).toBe(false); expect(o.limitations[0]).toContain("malformed");
  });
  it("reconciles summary counts and rejects partial Count previews", () => {
    const o = sample(); const packed = factCsv(o);
    expect(parseFactCsv(packed, facts(o).length).complete).toBe(true);
    expect(parseFactCsv(packed, facts(o).length + 1).complete).toBe(false);
    expect(parseFactCsv(packed).complete).toBe(true);
    expect(parseFactCsv(csv([["FACT"], ...facts(o).map(f => [JSON.stringify(f)])]), facts(o).length).complete).toBe(false);
    o.daily.pop(); expect(parseFactCsv(factCsv(o), facts(o).length).complete).toBe(false);
  });
  it("builds safe fixed-window SQL with a device semi-join", () => {
    const input = { ...window, idfv: "00000000000000000000000000000001", includeHistoricalEntitlements: true as const };
    const sql = buildTraceSql(input);
    expect(sql).toContain("EXISTS (SELECT 1 FROM device_ids"); expect(sql).toContain("ep.session_id::varchar"); expect(sql).not.toContain("session_id_id");
    expect(sql).not.toContain("current_date"); expect(sql).not.toContain("{{"); expect(sql).not.toContain("38645146");
    expect(() => buildTraceSql({ ...input, idfv: "' OR 1=1" })).toThrow();
    expect(() => buildTraceSql({ ...input, through: "not-a-date" })).toThrow();
    const tokens = sql.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "");
    let depth = 0; for (const char of tokens) { if (char === "(") depth++; if (char === ")") depth--; expect(depth).toBeGreaterThanOrEqual(0); } expect(depth).toBe(0);
  });
  it("submits and polls Count using its durable job key", async () => {
    vi.mocked(submitCountSql).mockResolvedValue({ ok: true, query: { job_key: "q1", status: "running" } });
    vi.mocked(getCountQuery).mockResolvedValueOnce({ ok: true, query: { job_key: "q1", status: "running" } }).mockResolvedValueOnce({ ok: true, query: { job_key: "q1", status: "completed", result_preview: factCsv(sample()), result_metadata: { num_rows: facts(sample()).length } } });
    const p = liveProvider(); const token = await p.submit({ ...window, idfv: "00000000000000000000000000000001", includeHistoricalEntitlements: true }, "request-key");
    expect(await p.poll(token)).toEqual({ status: "pending" }); const result = await p.poll(token);
    expect(result.status).toBe("complete"); if (result.status === "complete") expect(assess(result.trace).findings[0].verdict).toBe("Recommend not eligible");
    expect(vi.mocked(getCountQuery).mock.calls[0][0]).toBe("q1");
  });
});
