import crypto from "node:crypto";
import { z } from "zod";
import { liveProvider } from "@/lib/refund-review/live-provider";
import { reviewRequestSchema, reviewPurchase } from "@/lib/refund-review/review-request";
import { render, checkDetailsText } from "@/lib/refund-review/slack";

export class AssistanceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export const assistanceInput = reviewRequestSchema.extend({
  idfv: z.string().trim().regex(/^(?:[a-f\d]{32}|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i, "Enter a valid IDFV (32 hexadecimal characters, with optional hyphens).").transform(s => s.replaceAll("-", "").toLowerCase()),
  asOf: z.string().optional().default("").refine(s => !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s && s <= new Date().toISOString().slice(0, 10)), "Use a valid ticket date on or before today (UTC)."),
}).refine(v => !v.purchaseDate || !v.asOf || v.purchaseDate <= v.asOf, "Purchase date must be on or before the ticket date.");
const ticketSchema = z.object({ owner: z.string(), queryId: z.string(), expiresAt: z.number(), createdAt: z.number(), review: reviewRequestSchema.optional() });
function key() {
  if (process.env.AUTH_SECRET) return crypto.createHash("sha256").update(`cs-assistance:v1:${process.env.AUTH_SECRET}`).digest();
  throw new AssistanceError("CS Assistance is not configured. Contact your administrator.", 503);
}
export function sealTicket(value: z.infer<typeof ticketSchema>) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function openTicket(token: string, owner: string, now = Date.now()) {
  let value: z.infer<typeof ticketSchema>;
  try {
    const bytes = Buffer.from(token, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    value = ticketSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()));
  } catch (error) {
    if (error instanceof AssistanceError) throw error;
    throw new AssistanceError("This check is invalid. Start a new check.", 400);
  }
  if (value.owner !== owner) throw new AssistanceError("You do not have access to this check.", 403);
  if (value.expiresAt <= now) throw new AssistanceError("This check timed out. Please run it again.", 410);
  return value;
}
export function checkWindow(asOf: string, now: number) {
  const through = asOf ? Math.min(now, Date.parse(`${asOf}T23:59:59.999Z`)) : now;
  return { from: new Date(through - 90 * 86400000).toISOString(), through: new Date(through).toISOString() };
}
export async function startAssistance(body: unknown, owner: string, now = Date.now()) {
  const input = assistanceInput.parse(body);
  if (!process.env.COUNT_API_KEY || !process.env.COUNT_CONNECTION_KEY || !(process.env.COUNT_CONTEXT_KEY || process.env.COUNT_PROJECT_KEY || process.env.COUNT_CANVAS_KEY)) throw new AssistanceError("The live event query is not configured. Contact your administrator.", 503);
  key(); // Validate configuration before submitting a query.
  const window = checkWindow(input.asOf, now);
  if (input.purchaseDate && input.purchaseDate < window.from.slice(0,10)) throw new AssistanceError("Purchase date is outside the 90-day review window. Choose an earlier ticket date.", 400);
  const queryId = await liveProvider().submit({ idfv: input.idfv, ...window, includeHistoricalEntitlements: true }, crypto.randomUUID());
  const expiresAt = now + 10 * 60000;
  return { status: "pending" as const, token: sealTicket({ owner, queryId, expiresAt, createdAt: now, review: input }), expiresAt, window };
}
export async function pollAssistance(token: string, owner: string, selectedId?: string) {
  const ticket = openTicket(token, owner);
  const response = await liveProvider().poll(ticket.queryId);
  if (response.status === "pending") return { status: "pending" as const };
  if (response.status !== "complete") throw new AssistanceError("No event trace was returned. Check the IDFV and try again.", 502);
  if (!ticket.review) throw new AssistanceError("Start a new check and select a dispute type.", 400);
  const reviewed = reviewPurchase(response.trace, ticket.review, selectedId);
  if (reviewed.status === "selection_required") return reviewed;
  const assessment = reviewed.assessment;
  const message = render({ id: "web-review", team: "", channel: "", thread: "", user: owner, createdAt: ticket.createdAt, deadline: ticket.expiresAt, failures: 0, mode: "live", assessment });
  // Actions are rendered as native web controls. This endpoint never posts to Slack.
  const botSections = message.blocks.flatMap(block => {
    const b = block as { type: string; text?: { text: string } };
    return b.type === "section" && b.text ? [b.text.text] : [];
  });
  return { status: "completed" as const, assessment, botSections, checkDetails: checkDetailsText(assessment.trace), checkedAt: new Date().toISOString() };
}
