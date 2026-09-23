import crypto from "node:crypto";
import { parse } from "csv-parse/sync";
import { factSchema, observedSchema, type ObservedTrace, type PurchaseFact } from "./observed-model";
import type { Trace } from "./model";
export type TraceWindow = { from: string; through: string };
type Event = { at: string; name: string; user: string; session: string; product: string; amount: number | null; item: string; source: string; transaction: string | null; dollar: number | null; offline: boolean };
export const resourceMatchWindowMs = 120000;
const names = new Set(["Store_Product_Purchase_Success", "Ad_Impression_Interstitial", "Ad_Impression_Rewarded", "Currency_Transaction", "Item_Transaction"]);
const numeric = (value: unknown) => value === "" || value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const iso = (value: string) => { if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid event timestamp"); return new Date(value).toISOString(); };
export function parseEventCsv(csv: string, window: TraceWindow): ObservedTrace {
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
  const events: Event[] = [];
  const limitations: string[] = [];
  let invalid = 0;
  for (const row of rows) {
    try {
      const at = iso(row.CREATED_AT);
      if (at < window.from || at > window.through) continue;
      if (row.APP_ID !== "3011") { invalid++; continue; }
      if (!names.has(row.NAME)) continue;
      const payload = row.PAYLOAD ? JSON.parse(row.PAYLOAD) : {};
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid payload");
      const amount = numeric(row.ARGUMENT_VALUE);
      if (row.NAME.endsWith("_Transaction") && amount === null) throw new Error("Missing signed amount");
      if (row.NAME === "Store_Product_Purchase_Success" && (row.ARGUMENT_TYPE !== "product_id" || !/^\d+$/.test(row.ARGUMENT_VALUE))) throw new Error("Missing product ID");
      events.push({ at, name: row.NAME, user: row.USER_ID, session: row.SESSION_ID, product: row.ARGUMENT_VALUE,
        amount, item: row.NAME === "Currency_Transaction" ? String(payload.currency ?? "unknown currency") : String(payload.itemtype ?? payload.item ?? row.ITEM_TYPE ?? "unknown item"),
        source: String(payload.source ?? payload.type ?? row.SOURCE_TYPE ?? "unknown"), transaction: payload.transaction_id ? String(payload.transaction_id) : null,
        dollar: numeric(payload.dollar_value), offline: row.OFFLINE?.toLowerCase() === "true" });
    } catch { invalid++; }
  }
  events.sort((a, b) => a.at.localeCompare(b.at));
  if (invalid) limitations.push(`${invalid} malformed or unexpected rows were excluded; no definitive recommendation is made.`);
  // Identical source rows can be genuine events. Do not silently deduplicate activity or grants.
  const interstitials = events.filter(e => e.name === "Ad_Impression_Interstitial");
  const purchases: PurchaseFact[] = events.filter(e => e.name === "Store_Product_Purchase_Success").map(p => {
    const before = interstitials.filter(e => e.at < p.at).at(-1);
    const after = interstitials.filter(e => e.at >= p.at);
    const gap = events.filter(e => e.at >= p.at && (!after[0] || e.at < after[0].at));
    return { kind: "purchase", id: `purchase-${crypto.createHash("sha256").update(`${p.at}:${p.product}:${p.transaction ?? ""}`).digest("hex").slice(0, 16)}`, at: p.at, productId: p.product, transactionId: p.transaction,
      dollarValue: p.dollar, session: p.session, offline: p.offline,
      lastInterstitialBefore: before?.at ?? null, firstInterstitialAfter: after[0]?.at ?? null, lastActivityBeforeReturn: gap.at(-1)?.at ?? null,
      activeDaysBeforeReturn: new Set(gap.filter(e => e.name !== "Store_Product_Purchase_Success").map(e => e.at.slice(0, 10))).size,
      activityBeforeReturn: gap.filter(e => e.name !== "Store_Product_Purchase_Success").length,
      rewardedBeforeReturn: gap.filter(e => e.name === "Ad_Impression_Rewarded").length, interstitialAfter: after.length };
  });
  const resources: ObservedTrace["resources"] = [];
  for (const p of purchases) {
    const groups = new Map<string, ObservedTrace["resources"][number]>();
    for (const e of events) {
      if (!e.name.endsWith("_Transaction") || e.session !== p.session || e.amount === null || e.amount === 0 || Math.abs(Date.parse(e.at) - Date.parse(p.at)) > resourceMatchWindowMs) continue;
      const direction = e.amount > 0 ? "received" : "spent";
      const key = JSON.stringify([e.item, e.source, direction]);
      const g = groups.get(key) ?? { kind: "resource", purchaseId: p.id, item: e.item, source: e.source, direction, amount: 0, count: 0, firstAt: e.at, lastAt: e.at };
      g.amount += Math.abs(e.amount); g.count++; g.lastAt = e.at; groups.set(key, g);
    }
    resources.push(...groups.values());
  }
  const days = new Map<string, ObservedTrace["daily"][number]>();
  for (const e of events) {
    const day = e.at.slice(0, 10);
    const d = days.get(day) ?? { kind: "daily", day, events: 0, interstitials: 0, rewarded: 0 };
    d.events++; d.interstitials += Number(e.name === "Ad_Impression_Interstitial"); d.rewarded += Number(e.name === "Ad_Impression_Rewarded"); days.set(day, d);
  }
  return observedSchema.parse({ purchases, resources, daily: [...days.values()], meta: { kind: "meta", ...window, firstAt: events[0]?.at ?? null, lastAt: events.at(-1)?.at ?? null, eventCount: events.length, users: new Set(events.map(e => e.user)).size }, complete: invalid === 0, limitations });
}
export function parseFactCsv(csv: string, totalRows?: number): ObservedTrace {
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
  const facts = rows.map(r => factSchema.parse(JSON.parse(r.FACT ?? r.fact)));
  const meta = facts.filter(f => f.kind === "meta");
  if (meta.length !== 1) throw new Error("Missing or ambiguous trace metadata");
  const dailyCount = facts.filter(f => f.kind === "daily").reduce((sum, d) => sum + d.events, 0);
  const declaredRows = rows.every(row => Number(row.TOTAL_FACTS ?? row.total_facts) === rows.length);
  const complete = declaredRows && (totalRows === undefined || totalRows === rows.length) && rows.length < 1000 && meta[0].invalidRows === 0 && dailyCount === meta[0].eventCount;
  return observedSchema.parse({ meta: meta[0], purchases: facts.filter(f => f.kind === "purchase").sort((a, b) => a.at.localeCompare(b.at)), resources: facts.filter(f => f.kind === "resource").sort((a, b) => a.firstAt.localeCompare(b.firstAt)), daily: facts.filter(f => f.kind === "daily").sort((a, b) => a.day.localeCompare(b.day)), complete, limitations: complete ? [] : ["Query output is incomplete, malformed, truncated, or lacks a verified row count."] });
}
export function observedToTrace(observed: ObservedTrace): Trace {
  return {
    purchases: observed.purchases.map(p => ({ id: p.id, at: p.at, productId: p.productId, transactionId: p.transactionId ?? p.id, paid: true, matchingCertain: !!p.transactionId })),
    grants: [], entitlements: [], ads: [], observed,
    coverage: { from: observed.meta.from, through: observed.meta.through, freshThrough: observed.meta.lastAt ?? observed.meta.from,
      complete: observed.complete, purchasesComplete: observed.complete, grantsComplete: false, entitlementsComplete: false, adsComplete: observed.complete, truncated: !observed.complete,
      limitations: [...observed.limitations, "No explicit entitlement expiry or telemetry-ingestion watermark is supplied. Last observed activity is not a freshness guarantee.", "Purchases before the query window and full bundle quantities are not available."] },
  };
}
