import crypto from "node:crypto";
import { z } from "zod";
import { getRefundJob, insertRefundJob } from "@/lib/db";
import { parseIdfv, type Job } from "./model";
import { formInput, reviewForm, submissionSchema } from "./form";
import { allowed, verifySlack, slack } from "./slack";
const eventSchema = z.object({ type: z.literal("event_callback"), team_id: z.string(), event_id: z.string(), event: z.object({ type: z.string(), text: z.string().optional(), channel: z.string(), user: z.string().optional(), ts: z.string(), thread_ts: z.string().optional(), bot_id: z.string().optional(), subtype: z.string().optional() }) });
const interactionSchema = z.object({ type: z.literal("block_actions"), trigger_id: z.string().optional(), team: z.object({ id: z.string() }), channel: z.object({ id: z.string() }), user: z.object({ id: z.string() }), actions: z.array(z.object({ action_id: z.string(), value: z.string(), action_ts: z.string() })).length(1) });
const actionValue = z.object({ id: z.string().max(300), page: z.number().int().min(0).max(10000), selectedId: z.string().max(300).optional() });
async function signedBody(request: Request) {
  const raw = await request.text();
  if (raw.length > 128000 || !verifySlack(raw, request.headers)) return undefined;
  return raw;
}
export async function events(request: Request) {
  const raw = await signedBody(request);
  if (raw === undefined) return new Response("Unauthorized", { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const challenge = z.object({ type: z.literal("url_verification"), challenge: z.string() }).safeParse(body);
  if (challenge.success) return Response.json({ challenge: challenge.data.challenge });
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 200 });
  const { team_id: team, event_id, event } = parsed.data;
  if (!allowed(team, event.channel)) return new Response(null, { status: 403 });
  if (event.type !== "app_mention" || event.bot_id || event.subtype || !event.user) return new Response(null, { status: 200 });
  const id = `refund:${team}:${event_id}`;
  let input = parseIdfv(event.text ?? "");
  const detailsNeeded = !/\b(dispute|purchase|usd):/i.test(event.text ?? "");
  if (detailsNeeded) input = parseIdfv(`${event.text ?? ""} dispute:items`);
  const now = Date.now();
  const job: Job = { id, team, channel: event.channel, thread: event.thread_ts ?? event.ts, user: event.user, createdAt: now, deadline: now + 600000, failures: 0, mode: process.env.REFUND_REVIEW_MODE === "live" ? "live" : "demo", ...("idfv" in input ? input : { notice: input.error }) };
  if (detailsNeeded && job.idfv) { job.review = undefined; job.notice = "Select Add dispute details to choose the issue and optionally provide purchase date and USD amount."; }
  try { await insertRefundJob(id, JSON.stringify(job), now); }
  catch { return new Response("Unable to queue check", { status: 503 }); }
  return new Response(null, { status: 200 });
}
export async function interactions(request: Request) {
  const raw = await signedBody(request);
  if (raw === undefined) return new Response("Unauthorized", { status: 401 });
  let body: unknown;
  try { body = JSON.parse(new URLSearchParams(raw).get("payload") ?? ""); } catch { return new Response("Invalid payload", { status: 400 }); }
  const submission = submissionSchema.safeParse(body);
  if (submission.success) {
    const v = submission.data;
    const row = await getRefundJob(v.view.private_metadata);
    if (!row) return new Response("Check expired", {status:410});
    const original = JSON.parse(row.payload) as Job;
    if (original.team !== v.team.id || !allowed(v.team.id, original.channel)) return new Response(null,{status:403});
    const fields=formInput(v);
    if(Object.keys(fields.errors).length) return Response.json({response_action:"errors",errors:fields.errors});
    const now=Date.now();
    const id=`form:${crypto.createHash("sha256").update(`${original.id}:${v.view.id}`).digest("hex")}`;
    const job:Job={id,team:original.team,channel:original.channel,thread:original.thread,user:v.user.id,idfv:original.idfv,review:fields.review,asOf:fields.asOf,mode:original.mode,createdAt:now,deadline:now+600000,failures:0};
    try { await insertRefundJob(id,JSON.stringify(job),now); } catch { return Response.json({response_action:"errors",errors:{dispute:"Could not queue the check. Try again."}}); }
    return new Response(null,{status:200});
  }
  const parsed = interactionSchema.safeParse(body);
  if (!parsed.success) return new Response("Invalid action", { status: 400 });
  const { team, channel, user, actions } = parsed.data;
  if (!allowed(team.id, channel.id)) return new Response(null, { status: 403 });
  let value: z.infer<typeof actionValue>;
  try { value = actionValue.parse(JSON.parse(actions[0].value)); } catch { return new Response("Invalid action", { status: 400 }); }
  try {
    const row = await getRefundJob(value.id);
    if (!row) return new Response("Check expired", { status: 410 });
    const original = JSON.parse(row.payload) as Job;
    if (original.team !== team.id || original.channel !== channel.id) return new Response(null, { status: 403 });
    const action = actions[0].action_id;
    if (action === "refund_details") {
      if (!parsed.data.trigger_id || !original.idfv) return new Response("Action unavailable",{status:409});
      await slack("views.open",{trigger_id:parsed.data.trigger_id,view:reviewForm(original.id,original.mode !== "live")});
      return new Response(null,{status:200});
    }
    if (!["refund_check_details", "refund_select", "refund_retry", "refund_evidence", "refund_previous", "refund_next"].includes(action)) return new Response("Unknown action", { status: 400 });
    if (action === "refund_select") {
      if (!original.selection?.candidates.some(p => p.id === value.selectedId) || !original.review) return new Response("Invalid purchase selection", { status: 409 });
      const now = Date.now();
      const id = `selection:${crypto.createHash("sha256").update(`${original.id}:${value.selectedId}`).digest("hex")}`;
      const job: Job = { id, team: original.team, channel: original.channel, thread: original.thread, user: user.id, idfv: original.idfv, asOf: original.asOf, review: original.review, selectedId: value.selectedId, queryId: original.queryId, mode: original.mode, createdAt: now, deadline: now + 600000, failures: 0 };
      await insertRefundJob(id, JSON.stringify(job), now);
      return new Response(null, { status: 200 });
    }
    const retry = action === "refund_retry";
    if (retry ? !original.error : !original.assessment) return new Response("Action unavailable", { status: 409 });
    const now = Date.now();
    // One retry per failed attempt; repeated clicks do not run multiple queries.
    const id = retry ? `retry:${crypto.createHash("sha256").update(original.id).digest("hex")}` : `evidence:${crypto.createHash("sha256").update(`${original.id}:${user.id}:${actions[0].action_ts}`).digest("hex")}`;
    const job: Job = { id, team: team.id, channel: channel.id, thread: original.thread, user: user.id, createdAt: now, deadline: now + 600000, failures: 0, mode: process.env.REFUND_REVIEW_MODE === "live" ? "live" : "demo", ...(retry ? { idfv: original.idfv, asOf: original.asOf, review: original.review, selectedId: original.selectedId } : { evidenceRequest: { source: original.id, page: value.page, ...(action === "refund_check_details" ? {kind: "details" as const} : {}) } }) };
    await insertRefundJob(id, JSON.stringify(job), now);
    return new Response(null, { status: 200 });
  } catch { return new Response("Unable to queue action", { status: 503 }); }
}
