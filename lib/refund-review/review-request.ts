import { z } from "zod";
import type { Trace } from "./model";
import { assessObserved } from "./observed-rules";
import { assess } from "./rules";
import { productCatalog } from "./catalog";
const date = z.string().refine(s => !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s && s <= new Date().toISOString().slice(0,10)), "Use a valid date on or before today (UTC).");
export const reviewRequestSchema = z.object({
  dispute: z.enum(["items", "no_ads"]),
  purchaseDate: date.optional().default(""),
  amountUsd: z.string().optional().default("").refine(s => !s || (/^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0 && Number(s) <= 100000), "Enter a positive USD amount with at most two decimal places."),
});
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;
export function reviewPurchase(trace: Trace, request: ReviewRequest, selectedId?: string) {
  const catalog = productCatalog();
  const candidates = trace.purchases.map(p => {
    const observed = trace.observed?.purchases.find(o => o.id === p.id);
    return { id: p.id, product: catalog[p.productId]?.name ?? p.productId, at: p.at, amountUsd: observed?.dollarValue ?? null, transactionId: p.transactionId };
  });
  const matches = candidates.filter(p => (!request.purchaseDate || p.at.slice(0,10) === request.purchaseDate) && (!request.amountUsd || (p.amountUsd !== null && Math.round(p.amountUsd * 100) === Math.round(Number(request.amountUsd)*100))));
  const chosen = selectedId ? candidates.find(p => p.id === selectedId) : matches.length === 1 ? matches[0] : undefined;
  if (selectedId && !chosen) throw new Error("Selected purchase is not in this trace");
  if (!chosen) return { status: "selection_required" as const, candidates: [...candidates].sort((a,b) => request.purchaseDate ? Math.abs(Date.parse(a.at)-Date.parse(request.purchaseDate))-Math.abs(Date.parse(b.at)-Date.parse(request.purchaseDate)) : a.at.localeCompare(b.at)), message: !candidates.length ? "No purchases found in the inspected window. Check the IDFV and ticket date." : !matches.length ? "No exact match for the supplied date and USD amount. Select a purchase below only after confirming it with the customer." : "Multiple purchases match. Select the disputed purchase.", matchingIds: matches.map(p => p.id) };
  // Keep the full trace: overlapping no-ads purchases must still be considered.
  const assessment = trace.observed ? assessObserved(trace, catalog, request.dispute) : assess(trace, undefined, request.dispute);
  assessment.findings = assessment.findings.filter(f => f.evidence.includes(chosen.id));
  return { status: "completed" as const, assessment };
}
