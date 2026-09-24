import { z } from "zod";
import { reviewRequestSchema, type ReviewRequest } from "./review-request";
import { observedSchema } from "./observed-model";

const timestamp = z.string().datetime();
const evidence = z.object({ id: z.string().min(1), at: timestamp });
export const traceSchema = z.object({
  observed: observedSchema.optional(),
  purchases: z.array(evidence.extend({ transactionId: z.string(), productId: z.string(), paid: z.boolean(), matchingCertain: z.boolean() })),
  grants: z.array(evidence.extend({ transactionId: z.string(), item: z.string(), quantity: z.number().nonnegative() })),
  entitlements: z.array(evidence.extend({ transactionId: z.string(), start: timestamp, end: timestamp.nullable(), confirmed: z.boolean() })),
  ads: z.array(evidence.extend({ kind: z.enum(["interstitial", "rewarded", "unknown"]) })),
  coverage: z.object({ from: timestamp, through: timestamp, freshThrough: timestamp, complete: z.boolean(), purchasesComplete: z.boolean(), grantsComplete: z.boolean(), entitlementsComplete: z.boolean(), adsComplete: z.boolean(), truncated: z.boolean(), limitations: z.array(z.string()) }),
});
export type Trace = z.infer<typeof traceSchema>;
export type Verdict = "Recommend eligible" | "Recommend not eligible" | "Needs review";
export type Finding = { transactionId: string; product: string; purchasedAt: string; verdict: Verdict; reason: string; nextStep: string; evidence: string[]; basis?: "observed" | "inferred"; scope?: string; details?: string[] };
export type Assessment = { findings: Finding[]; trace: Trace };
export type QueryInput = { idfv: string; from: string; through: string; includeHistoricalEntitlements: true };
export type QueryResult = { status: "pending" } | { status: "complete"; trace: Trace } | { status: "unavailable"; message: string };
export interface TraceProvider {
  // requestKey is stable across retries. Count is read-only but cannot guarantee idempotent submission.
  submit(input: QueryInput, requestKey: string): Promise<string>;
  poll(queryId: string): Promise<QueryResult>;
}
export type Job = {
  id: string; team: string; channel: string; thread: string; user: string;
  review?: ReviewRequest; selectedId?: string; selection?: { message: string; candidates: {id: string; product: string; at: string; amountUsd: number | null; transactionId: string}[]; matchingIds: string[] };
  idfv?: string; asOf?: string; mode?: "demo" | "live"; notice?: string; createdAt: number; deadline: number;
  messageTs?: string; queryId?: string; assessment?: Assessment;
  evidenceRequest?: { source: string; page: number; kind?: "details" };
  error?: string; failures: number; delivered?: boolean; deliveryFailed?: boolean;
};

export function parseIdfv(text: string): { idfv: string; asOf?: string; review?: ReviewRequest } | { error: string } {
  const tokens = text.replace(/<@[A-Z0-9]+>/gi, " ").replace(/\bIDFV\s*:/gi, " ").trim().split(/\s+/).filter(Boolean);
  const filters = tokens.filter(t => /^(dispute|purchase|usd):/i.test(t));
  const remaining = tokens.filter(t => !/^(dispute|purchase|usd):/i.test(t));
  const field = (key: string) => filters.find(t => t.toLowerCase().startsWith(key + ":"))?.split(":").slice(1).join(":");
  if (new Set(filters.map(t => t.split(":")[0].toLowerCase())).size !== filters.length) return { error: "Provide each purchase filter only once." };
  const parsedReview = reviewRequestSchema.safeParse({ dispute: field("dispute"), purchaseDate: field("purchase"), amountUsd: field("usd") });
  const dateTokens = remaining.filter(t => /^asof:/i.test(t));
  const idTokens = remaining.filter(t => !/^asof:/i.test(t));
  const ids = idTokens.filter(t => /^(?:[a-f\d]{32}|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i.test(t));
  if (ids.length > 1) return { error: "Please provide one IDFV per mention." };
  if (idTokens.length !== 1 || ids.length !== 1 || dateTokens.length > 1) return { error: "Please mention me with one IDFV (hyphens optional). To review an earlier ticket, add asof:YYYY-MM-DD (UTC)." };
  const asOf = dateTokens[0]?.slice(5);
  if (asOf && (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf || asOf > new Date().toISOString().slice(0, 10))) return { error: "Use a valid asof:YYYY-MM-DD date on or before today (UTC)." };
  if (dateTokens.length && !asOf) return { error: "Supply a date after asof: (YYYY-MM-DD, UTC)." };
  if (!parsedReview.success) return { error: "Add dispute:no_ads or dispute:items. Optional: purchase:YYYY-MM-DD usd:14.99 asof:YYYY-MM-DD (UTC)." };
  if (asOf && parsedReview.data.purchaseDate > asOf) return { error: "Purchase date must be on or before the ticket date." };
  return { review: parsedReview.data, idfv: ids[0].replaceAll("-", "").toLowerCase(), ...(asOf ? { asOf } : {}) };
}
