import { z } from "zod";
const time = z.string().datetime();
const count = z.number().int().nonnegative();
export const purchaseFactSchema = z.object({
  kind: z.literal("purchase"), id: z.string(), at: time, productId: z.string(), transactionId: z.string().nullable(),
  dollarValue: z.number().nonnegative().nullable(), session: z.string(), offline: z.boolean(),
  lastInterstitialBefore: time.nullable(), firstInterstitialAfter: time.nullable(),
  lastActivityBeforeReturn: time.nullable(), activeDaysBeforeReturn: count, activityBeforeReturn: count,
  rewardedBeforeReturn: count, interstitialAfter: count,
});
export const resourceFactSchema = z.object({
  kind: z.literal("resource"), purchaseId: z.string(), item: z.string(), source: z.string(),
  direction: z.enum(["received", "spent"]), amount: z.number().nonnegative(), count,
  firstAt: time, lastAt: time,
});
export const dailyFactSchema = z.object({ kind: z.literal("daily"), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), events: count, interstitials: count, rewarded: count });
export const metaFactSchema = z.object({ kind: z.literal("meta"), from: time, through: time, firstAt: time.nullable(), lastAt: time.nullable(), eventCount: count, users: count, invalidRows: count.default(0) });
export const observedSchema = z.object({
  purchases: z.array(purchaseFactSchema), resources: z.array(resourceFactSchema), daily: z.array(dailyFactSchema), meta: metaFactSchema,
  complete: z.boolean(), limitations: z.array(z.string()),
});
export const factSchema = z.discriminatedUnion("kind", [purchaseFactSchema, resourceFactSchema, dailyFactSchema, metaFactSchema]);
export type ObservedTrace = z.infer<typeof observedSchema>;
export type PurchaseFact = z.infer<typeof purchaseFactSchema>;
