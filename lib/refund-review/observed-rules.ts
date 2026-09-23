import type { Assessment, Finding, Trace } from "./model";
import { productCatalog, type CatalogProduct } from "./catalog";
// Evidence threshold only: this is not a season length or entitlement duration.
export const minimumActiveDaysForSeasonInference = 2;
export function assessObserved(trace: Trace, catalog: Record<string, CatalogProduct> = productCatalog()): Assessment {
  const o = trace.observed!;
  const findings = o.purchases.map((p): Finding => {
    const product = catalog[p.productId];
    const nearby = o.resources.filter(r => r.purchaseId === p.id);
    const f: Finding = { transactionId: p.transactionId ?? p.id, product: `${product?.name ?? "Unknown product"} (ID ${p.productId})${p.dollarValue === null ? "" : ` · $${p.dollarValue.toFixed(2)}`}`, purchasedAt: p.at,
      verdict: "Needs review", reason: "Evidence is insufficient to assess this purchase.", nextStep: "Confirm the disputed purchase and inspect the missing evidence.", evidence: [p.id], basis: "observed", details: [] };
    const details = f.details!;
    if (product) details.push(`Catalog benefits: ${product.notes}.`);
    if (product?.noAds !== "none") {
    if (p.lastInterstitialBefore) details.push(`Last interstitial before purchase: ${p.lastInterstitialBefore}.`);
    if (p.firstInterstitialAfter) details.push(`First interstitial at/after purchase: ${p.firstInterstitialAfter}.`);
    details.push(`Before ${p.firstInterstitialAfter ? "interstitials returned" : "the review cutoff"}: ${p.activityBeforeReturn} activity events across ${p.activeDaysBeforeReturn} active calendar days; ${p.rewardedBeforeReturn} rewarded ads. No interstitials recorded in that interval.`);
    if (p.lastActivityBeforeReturn) details.push(`Last observed activity in that interval: ${p.lastActivityBeforeReturn}.`);
    }
    // Clock/order differences are common: credits can precede purchase-success by milliseconds.
    for (const r of nearby.filter(r => r.source === "purchase")) details.push(`${r.direction === "received" ? "Received" : "Spent"} ${r.amount} ${r.item} (${r.firstAt}–${r.lastAt}), source=${r.source}; within ±2 minutes in the same session. Temporal association only.`);
    const review = (reason: string) => { f.reason = reason; return f; };
    if (!o.complete) return review("The retrieved trace is incomplete or truncated; absence of events is not reliable.");
    if (o.meta.users !== 1) return review("This IDFV maps to zero or multiple users; purchase ownership is ambiguous.");
    if (!product) return review("The product is absent from the supplied catalog.");
    if (!p.transactionId || p.offline || o.purchases.filter(x => x.id === p.id || x.transactionId === p.transactionId).length > 1) return review("The purchase-success record is offline, duplicated, or lacks a transaction ID.");
    if (product.noAds === "none") {
      f.scope = "Item/coin delivery";
      if (nearby.some(r => r.direction === "received" && r.source === "purchase")) return review("Purchase-related credits were observed nearby, but transaction linkage and/or exact package contents are not confirmed. Spending is shown separately and does not prove full delivery.");
      return review("No directly linked delivery is available. Missing credits do not establish payment failure or refund eligibility.");
    }
    f.scope = "Interstitial-ad complaint only";
    const conflicting = o.purchases.filter(other => other.id !== p.id && (!catalog[other.productId] || catalog[other.productId].noAds !== "none"));
    if (conflicting.length) return review("Other no-ads or unmapped purchases may overlap this benefit; review each entitlement before interpreting the ad gap.");
    if (product.noAds === "temporary") {
      if (!p.firstInterstitialAfter || !p.lastInterstitialBefore || p.activeDaysBeforeReturn < minimumActiveDaysForSeasonInference || Date.parse(p.firstInterstitialAfter) - Date.parse(p.at) < 2 * 86400000 || !p.rewardedBeforeReturn) return review("The catalog confirms temporary no-ads, but the trace does not show a sufficiently supported before/during/after pattern. Check the season's actual expiry.");
      f.verdict = "Recommend not eligible";
      f.basis = "inferred";
      f.reason = "The purchase includes temporary no-ads. Interstitials stopped during observed play and later resumed, consistent with the season benefit ending. Exact expiry is not recorded.";
      f.nextStep = "Explain that VIP no-ads is temporary. Confirm the season dates before a final denial if the customer disputes the expiry; this recommendation does not assess missing items.";
      details.push("The gap is observed behavior, not a fixed season duration or a confirmed entitlement interval.");
      return f;
    }
    if (p.firstInterstitialAfter) return review("Interstitials were recorded after a permanent no-ads purchase. This is a potential entitlement failure; verify activation/restoration or revocation before approving a refund.");
    if (!p.rewardedBeforeReturn || p.activeDaysBeforeReturn < 1) return review("Insufficient post-purchase activity to assess the ad complaint.");
    f.verdict = "Recommend not eligible"; f.basis = "observed";
    f.reason = "Only rewarded ads were recorded after this purchase within the inspected window. Rewarded ads are not covered by no-ads.";
    f.nextStep = "Explain which ad format the pack removes and confirm whether the customer's complaint concerns rewarded ads. Item delivery is a separate assessment.";
    return f;
  });
  return { findings, trace };
}
