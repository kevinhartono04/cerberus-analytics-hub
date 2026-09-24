import crypto from "node:crypto";
import { claimRefundJob, saveRefundJob, getRefundJob } from "@/lib/db";
import type { Job } from "./model";
import { provider } from "./provider";
import { reviewPurchase } from "./review-request";
import { render, slack, SlackFailure, evidencePage, checkDetailsPage } from "./slack";

function messageId(id: string) {
  const hash = crypto.createHash("sha256").update(id).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function workOne(now = Date.now()): Promise<boolean> {
  const token = crypto.randomUUID();
  const row = await claimRefundJob(now, token);
  if (!row) return false;
  const job = JSON.parse(row.payload) as Job;
  const save = (done = false, due = Date.now() + 60000, release = true) => saveRefundJob(job.id, token, JSON.stringify(job), due, done, release);
  try {
    if (job.evidenceRequest) {
      const source = await getRefundJob(job.evidenceRequest.source);
      const original = source ? JSON.parse(source.payload) as Job : undefined;
      if (original?.assessment && original.team === job.team && original.channel === job.channel) {
        await slack("chat.postEphemeral", { channel: job.channel, user: job.user, thread_ts: job.thread, ...(job.evidenceRequest.kind === "details" ? checkDetailsPage(original) : evidencePage(original, job.evidenceRequest.page)) });
      }
      await save(true);
      return true;
    }
    if (!job.messageTs) {
      const result = await slack("chat.postMessage", { channel: job.channel, thread_ts: job.thread, client_msg_id: messageId(job.id), ...render(job) });
      if (!result.ts) throw new SlackFailure(60000, true);
      job.messageTs = result.ts;
      if (!await save(false, now, false)) return true;
    }
    if (!job.notice && !job.error && !job.assessment && !job.selection) {
      if (now >= job.deadline) job.error = "Check timed out after ten minutes. No eligibility finding was made. Please retry.";
      else if (!["demo", "live"].includes(process.env.REFUND_REVIEW_MODE ?? "") || ((job.mode ?? "demo") !== process.env.REFUND_REVIEW_MODE)) job.error = "Provider is not configured or its mode changed. Submit a new mention. No eligibility finding was made.";
      else {
        const p = provider();
        if (!job.queryId) {
          const through = job.asOf ? Math.min(job.createdAt, Date.parse(`${job.asOf}T23:59:59.999Z`)) : job.createdAt;
          if (job.review?.purchaseDate && job.review.purchaseDate < new Date(through - 90 * 86400000).toISOString().slice(0,10)) throw new Error("Purchase outside review window");
          job.queryId = await p.submit({ idfv: job.idfv!, from: new Date(through - 90 * 86400000).toISOString(), through: new Date(through).toISOString(), includeHistoricalEntitlements: true }, job.id);
          if (!await save(false, now, false)) return true;
        }
        const result = await p.poll(job.queryId);
        if (result.status === "pending") { await save(); return true; }
        if (result.status === "unavailable") job.notice = result.message;
        else if (!job.review) job.notice = "Start a new mention with dispute:no_ads or dispute:items.";
        else {
          const reviewed = reviewPurchase(result.trace, job.review, job.selectedId);
          if (reviewed.status === "completed") job.assessment = reviewed.assessment;
          else job.selection = reviewed;
        }
      }
    }
    if (!await save(false, now, false)) return true;
    await slack("chat.update", { channel: job.channel, ts: job.messageTs, ...render(job) });
    job.delivered = true;
    await save(true);
  } catch (error) {
    job.failures += 1;
    if (job.failures >= 4 || Date.now() >= job.deadline) job.error ??= "The check could not complete. No eligibility finding was made. Please retry.";
    const delay = error instanceof SlackFailure ? Math.max(error.retryAfter, Math.min(240000, 15000 * 2 ** job.failures)) : Math.min(240000, 15000 * 2 ** job.failures);
    // Delivery errors cannot be reported to Slack while Slack is unavailable; expose counts through cron.
    const stop = (error instanceof SlackFailure && !error.transient) || job.failures >= 8;
    if (stop) job.deliveryFailed = true;
    // A rate-limit window takes precedence over the ten-minute assessment deadline.
    const next = error instanceof SlackFailure ? Date.now() + delay : Math.min(Date.now() + delay, job.error ? Infinity : job.deadline);
    await save(stop, next);
  }
  return true;
}
