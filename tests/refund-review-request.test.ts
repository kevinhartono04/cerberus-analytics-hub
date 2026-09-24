// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { observedSchema } from "@/lib/refund-review/observed-model";
import { observedToTrace } from "@/lib/refund-review/event-trace";
import { reviewPurchase, reviewRequestSchema } from "@/lib/refund-review/review-request";
import { parseIdfv } from "@/lib/refund-review/model";
const trace = () => observedToTrace(observedSchema.parse(JSON.parse(fs.readFileSync("tests/fixtures/refund-review/sample-facts.json", "utf8"))));
const noAds = { dispute: "no_ads" as const, purchaseDate: "2026-08-19", amountUsd: "14.99" };
describe("Focused purchase reviews", () => {
 it.each([0, 2, 5])("does not use event user counts (%s) as an ownership verdict", users => { const t = trace(); t.observed!.meta.users = users; const r = reviewPurchase(t, noAds); expect(r.status).toBe("completed"); if(r.status === "completed") { expect(r.assessment.findings).toHaveLength(1); expect(r.assessment.findings[0].verdict).toBe("Recommend not eligible"); } });
 it("routes a VIP item complaint to delivery rules rather than ad expiry", () => { const r = reviewPurchase(trace(), {...noAds, dispute: "items"}); if(r.status !== "completed") throw Error(); expect(r.assessment.findings[0].scope).toBe("Item/coin delivery"); expect(r.assessment.findings[0].verdict).toBe("Needs review"); expect(r.assessment.findings[0].reason).not.toContain("benefit ending"); });
 it("requires selection for multiple purchases and preserves full entitlement context", () => { const t=trace(); const r=reviewPurchase(t,{...noAds,purchaseDate:"",amountUsd:""}); expect(r.status).toBe("selection_required"); const chosen=reviewPurchase(t,noAds,t.purchases[0].id); if(chosen.status !== "completed") throw Error(); expect(chosen.assessment.trace.purchases).toHaveLength(2); });
 it("does not silently substitute a purchase after an amount mismatch", () => { const t=trace();const r=reviewPurchase(t,{...noAds,amountUsd:"15.99"}); expect(r.status).toBe("selection_required"); if(r.status === "selection_required") { expect(r.matchingIds).toEqual([]); expect(r.candidates).toHaveLength(2); } expect(()=>reviewPurchase(t,noAds,"made-up-id")).toThrow(); });
 it("requires selection if several transactions have the same price/date", () => {const t=trace(); const p={...t.purchases[0],id:"second",transactionId:"second"}; t.purchases.push(p);t.observed!.purchases.push({...t.observed!.purchases[0],id:"second",transactionId:"second"});expect(reviewPurchase(t,noAds).status).toBe("selection_required");});
 it.each(["-1","0","14.999","NaN","1e2"])("rejects invalid amount %s", amountUsd => expect(reviewRequestSchema.safeParse({...noAds,amountUsd}).success).toBe(false));
 it("parses Slack fields and requires a dispute", () => {const id="00000000000000000000000000000001";expect(parseIdfv(id)).toHaveProperty("error");expect(parseIdfv(`${id} dispute:no_ads purchase:2026-08-19 usd:14.99`)).toMatchObject({review:noAds});expect(parseIdfv(`${id} dispute:items usd:14.99 usd:9.99`)).toHaveProperty("error");});
});
