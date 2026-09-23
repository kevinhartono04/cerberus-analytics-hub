import crypto from "node:crypto";
import type { Job, Trace } from "./model";
export function verifySlack(raw: string, headers: Headers, now = Date.now()): boolean {
  const secret = process.env.SLACK_REFUND_SIGNING_SECRET;
  const ts = headers.get("x-slack-request-timestamp") ?? "";
  const signature = headers.get("x-slack-signature") ?? "";
  if (!secret || !/^\d+$/.test(ts) || Math.abs(now / 1000 - Number(ts)) > 300 || !/^v0=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = `v0=${crypto.createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
export function allowed(team: string, channel: string) {
  return !!team && !!channel && team === process.env.SLACK_REFUND_TEAM_ID && (process.env.SLACK_REFUND_CHANNEL_IDS ?? "").split(",").map(x => x.trim()).includes(channel);
}
export class SlackFailure extends Error {
  constructor(readonly retryAfter: number, readonly transient: boolean) { super("Slack delivery failed"); }
}
export async function slack(method: string, body: Record<string, unknown>): Promise<{ ts?: string }> {
  if (!process.env.SLACK_REFUND_BOT_TOKEN) throw new SlackFailure(60000, false);
  const r = await fetch(`https://slack.com/api/${method}`, { method: "POST", headers: { authorization: `Bearer ${process.env.SLACK_REFUND_BOT_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) throw new SlackFailure(Math.max(1000, Number(r.headers.get("retry-after")) * 1000 || 60000), r.status === 429 || r.status >= 500 || ["ratelimited", "internal_error", "fatal_error", "service_unavailable"].includes(data.error));
  return data;
}
const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } });
const button = (label: string, action: string, id: string, page = 0) => ({ type: "button", text: { type: "plain_text", text: label }, action_id: action, value: JSON.stringify({ id, page }) });
export function allEvidence(t: Trace): string[] {
  if (t.observed) {
    const o = t.observed;
    return [
      ...o.purchases.map(p => `${p.id} · ${p.at} · Product ${p.productId}, ${p.dollarValue === null ? "price unavailable" : `$${p.dollarValue.toFixed(2)}`} · Store_Product_Purchase_Success`),
      ...o.resources.map(r => `${r.purchaseId} · ${r.firstAt}–${r.lastAt} · ${r.direction} ${r.amount} ${r.item}; source=${r.source}; ${r.count} events. Nearby in session, not transaction-linked.`),
      ...o.daily.map(d => `${d.day} UTC · ${d.events} activity events; ${d.interstitials} interstitials; ${d.rewarded} rewarded ads`),
    ];
  }
  return [
    ...t.purchases.map(p => `${p.id} · ${p.at} · Purchase ${p.transactionId}, product ${p.productId}, payment ${p.paid ? "confirmed" : "unconfirmed"}`),
    ...t.grants.map(g => `${g.id} · ${g.at} · ${g.transactionId}: ${g.quantity} ${g.item}`),
    ...t.entitlements.map(e => `${e.id} · ${e.at} · ${e.transactionId}: benefit ${e.start}–${e.end ?? "permanent"}, ${e.confirmed ? "confirmed" : "unconfirmed"}`),
    ...t.ads.map(a => `${a.id} · ${a.at} · ${a.kind} ad`),
  ];
}
const title = (job: Job) => job.mode === "live" ? "Refund review" : "DEMO — Refund review";
export function render(job: Job) {
  const blocks: unknown[] = [section(`*${title(job)}*`)];
  if (job.notice || job.error) blocks.push(section(esc(job.notice ?? job.error!)));
  else if (job.assessment) {
    const { findings, trace } = job.assessment;
    if (!findings.length) blocks.push(section("*Needs review* — No purchases found in the available trace."));
    for (const f of findings.slice(0, 8)) {
      const evidence = f.details ?? allEvidence(trace).filter(line => f.evidence.some(id => line.startsWith(`${id} ·`))).slice(0, 4);
      blocks.push(section(`*${f.verdict}*${f.basis ? ` (${f.basis})` : ""}\n${f.scope ? `*Scope:* ${esc(f.scope)}\n` : ""}*Purchase:* ${esc(f.product)} · ${f.purchasedAt}\n*Transaction:* ${esc(f.transactionId.length > 32 ? `…${f.transactionId.slice(-16)}` : f.transactionId)}\n*Finding:* ${esc(f.reason)}\n*Evidence:*\n${evidence.slice(0, 7).map(e => `• ${esc(e)}`).join("\n")}\n*CS next step:* ${esc(f.nextStep)}`));
    }
    if (findings.length > 8) blocks.push(section(`${findings.length} purchases assessed. Use View evidence for all purchase assessments.`));
    const c = trace.coverage;
    blocks.push(section(`*Coverage:* ${c.from}–${c.through}\n${trace.observed ? "*Last observed activity:*" : "*Data current through:*"} ${c.freshThrough}\n${trace.observed ? "Events after the review cutoff are excluded. All timestamps are UTC." : "Older purchase and entitlement records included where available."}\n*Limitations:* ${esc(c.limitations.join("; ") || (c.complete && !c.truncated ? "None reported" : "Incomplete or truncated trace"))}\n_Recommendation for CS review. Only the inspected window and purchase issue are assessed._`));
    blocks.push({ type: "actions", elements: [button("View evidence", "refund_evidence", job.id)] });
  } else blocks.push(section("Checking purchase and ad history…"));
  if (job.error) blocks.push({ type: "actions", elements: [button("Retry", "refund_retry", job.id)] });
  return { text: `${title(job)}: ${job.error ?? job.notice ?? (job.assessment ? "Assessment ready for CS review" : "Checking purchase and ad history…")}`, blocks };
}
export function evidencePage(job: Job, page: number) {
  const a = job.assessment!;
  const lines = [...a.findings.flatMap(f => [`${f.product}: ${f.verdict}${f.basis ? ` (${f.basis})` : ""} — ${f.reason} Next: ${f.nextStep} Evidence: ${f.evidence.join(", ")}`, ...(f.details ?? [])]), ...allEvidence(a.trace)];
  const pages = Math.max(1, Math.ceil(lines.length / 5));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { text: `${title(job)} evidence`, blocks: [section(`*${title(job)} — Evidence ${current + 1}/${pages}*`), ...lines.slice(current * 5, (current + 1) * 5).map(l => section(esc(l))), { type: "actions", elements: [button("Previous", "refund_previous", job.id, Math.max(0, current - 1)), button("Next", "refund_next", job.id, Math.min(pages - 1, current + 1))] }] };
}
