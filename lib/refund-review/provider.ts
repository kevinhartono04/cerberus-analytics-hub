import { liveProvider } from "./live-provider";
import type { QueryInput, Trace, TraceProvider } from "./model";
export const demoCases = ["received", "rewarded", "expired", "interstitial", "not-delivered", "partial", "incomplete", "overlap", "unknown-product", "multiple", "query-error", "timeout", "truncated", "uncertain", "no-purchases"] as const;
export const demoId = (index: number) => `000000000000000000000000${String(index + 1).padStart(8, "0")}`;
export function fixture(index: number, input: QueryInput): Trace {
  const now = Date.parse(input.through);
  const at = (days: number) => new Date(now - days * 86400000).toISOString();
  const name = demoCases[index];
  const adCase = ["rewarded", "expired", "interstitial", "overlap"].includes(name);
  const trace: Trace = {
    purchases: [{ id: "purchase-1", at: at(25), transactionId: "demo-tx-1", productId: adCase ? (["expired", "overlap"].includes(name) ? "season" : "no_ads") : name === "unknown-product" ? "unmapped" : "coins", paid: true, matchingCertain: name !== "uncertain" }],
    grants: [], entitlements: [], ads: [],
    coverage: { from: input.from, through: input.through, freshThrough: input.through, complete: name !== "incomplete", purchasesComplete: true, grantsComplete: true, entitlementsComplete: true, adsComplete: true, truncated: name === "truncated", limitations: name === "incomplete" ? ["Demo: missing telemetry interval"] : name === "truncated" ? ["Demo: result row limit reached"] : [] },
  };
  if (["received", "partial", "multiple"].includes(name)) trace.grants.push({ id: "grant-1", at: at(25), transactionId: "demo-tx-1", item: "coins", quantity: name === "partial" ? 40 : 100 });
  if (adCase) {
    trace.entitlements.push({ id: "benefit-1", at: at(25), transactionId: "demo-tx-1", start: at(25), end: ["expired", "overlap"].includes(name) ? at(5) : null, confirmed: true });
    trace.ads.push({ id: "ad-1", at: at(2), kind: name === "rewarded" ? "rewarded" : "interstitial" });
  }
  if (name === "overlap") trace.entitlements.push({ id: "benefit-2", at: at(10), transactionId: "older-purchase", start: at(10), end: null, confirmed: true });
  if (name === "multiple") trace.purchases.push({ id: "purchase-2", at: at(3), transactionId: "demo-tx-2", productId: "coins", paid: true, matchingCertain: true });
  if (name === "no-purchases") trace.purchases = [];
  return trace;
}
export function provider(): TraceProvider {
  if (process.env.REFUND_REVIEW_MODE === "live") return liveProvider();
  if (process.env.REFUND_REVIEW_MODE !== "demo") throw new Error("Provider not configured");
  return {
    async submit(input) { return JSON.stringify(input); },
    async poll(queryId) {
      const input = JSON.parse(queryId) as QueryInput;
      const index = demoCases.findIndex((_, i) => demoId(i) === input.idfv);
      if (index === -1) return { status: "unavailable", message: "No demo fixture available for this IDFV." };
      if (demoCases[index] === "query-error") throw new Error("Demo query failure");
      if (demoCases[index] === "timeout") return { status: "pending" };
      return { status: "complete", trace: fixture(index, input) };
    },
  };
}
