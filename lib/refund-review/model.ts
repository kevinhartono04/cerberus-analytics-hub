import { z } from "zod";
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
  idfv?: string; asOf?: string; mode?: "demo" | "live"; notice?: string; createdAt: number; deadline: number;
  messageTs?: string; queryId?: string; assessment?: Assessment;
  evidenceRequest?: { source: string; page: number };
  error?: string; failures: number; delivered?: boolean; deliveryFailed?: boolean;
};

export function parseIdfv(text: string): { idfv: string; asOf?: string } | { error: string } {
  const tokens = text.replace(/<@[A-Z0-9]+>/gi, " ").replace(/\bIDFV\s*:/gi, " ").trim().split(/\s+/).filter(Boolean);
  const dateTokens = tokens.filter(t => /^asof:/i.test(t));
  const idTokens = tokens.filter(t => !/^asof:/i.test(t));
  const ids = idTokens.filter(t => /^(?:[a-f\d]{32}|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i.test(t));
  if (ids.length > 1) return { error: "Please provide one IDFV per mention." };
  if (idTokens.length !== 1 || ids.length !== 1 || dateTokens.length > 1) return { error: "Please mention me with one IDFV (hyphens optional). To review an earlier ticket, add asof:YYYY-MM-DD (UTC)." };
  const asOf = dateTokens[0]?.slice(5);
  if (asOf && (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf || asOf > new Date().toISOString().slice(0, 10))) return { error: "Use a valid asof:YYYY-MM-DD date on or before today (UTC)." };
  if (dateTokens.length && !asOf) return { error: "Supply a date after asof: (YYYY-MM-DD, UTC)." };
  return { idfv: ids[0].replaceAll("-", "").toLowerCase(), ...(asOf ? { asOf } : {}) };
}
