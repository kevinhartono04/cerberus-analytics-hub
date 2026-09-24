import { assessObserved } from "./observed-rules";
import { traceSchema, type Assessment, type Trace, type Finding } from "./model";

export type Product = { name: string; items?: Record<string, number>; noAds?: "permanent" | "temporary"; deliveryGraceMs: number };
// Synthetic product definitions only. Production catalog must be explicitly supplied later.
export const demoProducts: Record<string, Product> = {
  coins: { name: "Coin pack", items: { coins: 100 }, deliveryGraceMs: 60 * 60 * 1000 },
  no_ads: { name: "Permanent no-ads pack", noAds: "permanent", deliveryGraceMs: 60 * 60 * 1000 },
  season: { name: "Season pass", noAds: "temporary", deliveryGraceMs: 60 * 60 * 1000 },
};
const review = "Do not approve or decline yet. Confirm the disputed transaction and resolve the evidence gap described above.";
export function assess(input: Trace, products: Record<string, Product> = demoProducts, dispute?: "items" | "no_ads"): Assessment {
  const trace = traceSchema.parse(input);
  if (trace.observed) return assessObserved(trace, undefined, dispute);
  const c = trace.coverage;
  const findings = trace.purchases.map((p): Finding => {
    const product = products[p.productId];
    const f: Finding = { transactionId: p.transactionId, product: product?.name ?? p.productId, purchasedAt: p.at, verdict: "Needs review", reason: "Evidence is insufficient to assess this purchase.", nextStep: review, evidence: [p.id] };
    const set = (verdict: Finding["verdict"], reason: string, ids: string[] = [], nextStep?: string) => { f.verdict = verdict; f.reason = reason; f.evidence.push(...ids); f.evidence = [...new Set(f.evidence)]; f.nextStep = nextStep ?? (verdict === "Recommend eligible" ? "Refund recommended for this purchase issue. Confirm the disputed transaction and follow the refund process." : verdict === "Recommend not eligible" ? "No refund recommended for this purchase issue. Explain the verified delivery or benefit terms." : review); return f; };
    if (!product) return set("Needs review", "Product benefits are not configured.");
    if (dispute) f.scope = dispute === "items" ? "Item/coin delivery" : "Interstitial-ad complaint only";
    if (dispute === "items" && !product.items) return set("Needs review", "Expected package contents are not configured for an item-delivery assessment.");
    if (dispute === "no_ads" && !product.noAds) return set("Needs review", "This product has no configured no-ads benefit.");
    if (!p.paid || !p.matchingCertain || trace.purchases.filter(x => x.transactionId === p.transactionId).length !== 1) return set("Needs review", "Payment or transaction matching is uncertain.");
    if (!c.complete || c.truncated || !c.purchasesComplete || Date.parse(c.freshThrough) < Date.parse(c.through)) return set("Needs review", "The trace is incomplete, stale, or truncated.");
    if (Date.parse(c.freshThrough) - Date.parse(p.at) < product.deliveryGraceMs) return set("Needs review", "The delivery grace period has not elapsed.");
    if (!dispute && product.items && product.noAds) return set("Needs review", "Bundled benefits require a dedicated product rule.");
    if (product.items && dispute !== "no_ads") {
      if (!c.grantsComplete) return set("Needs review", "Grant history is incomplete.");
      const grants = trace.grants.filter(g => g.transactionId === p.transactionId);
      if (new Set(grants.map(g => g.id)).size !== grants.length || grants.some(g => Date.parse(g.at) < Date.parse(p.at))) return set("Needs review", "Grant evidence is duplicated or inconsistent.", grants.map(g => g.id));
      const delivered = Object.entries(product.items).every(([item, quantity]) => grants.filter(g => g.item === item).reduce((n, g) => n + g.quantity, 0) >= quantity);
      if (delivered) return set("Recommend not eligible", "Expected items and quantities were granted for this purchase.", grants.map(g => g.id), "No refund recommended for missing items. The expected items and quantities were delivered.");
      if (grants.length) return set("Needs review", "Only partial or unexpected grants were found.", grants.map(g => g.id));
      return set("Recommend eligible", "Payment is confirmed; complete grant history shows no delivery after the grace period.");
    }
    if (!product.noAds || !c.entitlementsComplete || !c.adsComplete) return set("Needs review", "Ad or entitlement history is incomplete.");
    const own = trace.entitlements.filter(e => e.transactionId === p.transactionId);
    if (own.length !== 1 || !own[0].confirmed) return set("Needs review", "The purchase entitlement is missing or conflicting.", own.map(e => e.id));
    const e = own[0];
    f.evidence.push(e.id);
    if (Date.parse(e.start) < Date.parse(p.at) || (e.end && Date.parse(e.end) <= Date.parse(e.start)) || (product.noAds === "permanent" && e.end !== null) || (product.noAds === "temporary" && !e.end)) return set("Needs review", "Entitlement dates conflict with the configured product benefits.");
    const ads = trace.ads.filter(a => Date.parse(a.at) >= Math.max(Date.parse(e.start), Date.parse(c.from)) && Date.parse(a.at) <= Date.parse(c.through));
    if (ads.some(a => a.kind === "unknown")) return set("Needs review", "Some ads have an unknown format.", ads.filter(a => a.kind === "unknown").map(a => a.id));
    const activeAt = (start: string, end: string | null, at: string) => Date.parse(at) >= Date.parse(start) && (!end || Date.parse(at) < Date.parse(end));
    const violations = ads.filter(a => a.kind === "interstitial" && activeAt(e.start, e.end, a.at));
    if (violations.length) return set("Recommend eligible", "Interstitial ads occurred while this no-ads entitlement was active.", violations.map(a => a.id));
    const expiredAds = ads.filter(a => a.kind === "interstitial" && e.end && Date.parse(a.at) >= Date.parse(e.end));
    if (expiredAds.length) {
      const others = trace.entitlements.filter(other => other.id !== e.id && expiredAds.some(a => activeAt(other.start, other.end, a.at)));
      if (others.length) return set("Needs review", "Another entitlement overlaps ads after this benefit expired.", [...expiredAds.map(a => a.id), ...others.map(o => o.id)]);
      return set("Recommend not eligible", "Interstitial ads resumed after the temporary no-ads benefit expired.", expiredAds.map(a => a.id), "No refund recommended for this ad complaint. Explain that the temporary no-ads benefit expired before interstitial ads returned.");
    }
    const rewarded = ads.filter(a => a.kind === "rewarded");
    if (rewarded.length) return set("Recommend not eligible", "Only rewarded ads were observed; this pack blocks interstitial ads, not rewarded ads.", rewarded.map(a => a.id), "No refund recommended for this ad complaint. Explain that the pack removes interstitial ads; rewarded ads remain available and optional.");
    return set("Needs review", "No relevant ad events were observed in the inspected window.");
  });
  return { findings, trace };
}
