// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseIdfv, type Job, type QueryInput } from "@/lib/refund-review/model";
import { assess } from "@/lib/refund-review/rules";
import { demoCases, demoId, fixture, provider } from "@/lib/refund-review/provider";
import { events, interactions } from "@/lib/refund-review/handlers";
import { evidencePage, render, slack, SlackFailure, verifySlack } from "@/lib/refund-review/slack";
import { claimRefundJob, getRefundJob, insertRefundJob, saveRefundJob } from "@/lib/db";
import { workOne } from "@/lib/refund-review/worker";
import { GET as cron } from "@/app/api/cron/refund-review/route";

const input: QueryInput = { idfv: demoId(0), from: "2026-08-16T00:00:00.000Z", through: "2026-09-15T00:00:00.000Z", includeHistoricalEntitlements: true };
const sample = (name: typeof demoCases[number]) => fixture(demoCases.indexOf(name), input);
let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "refund-test-"));
  for (const key of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"]) vi.stubEnv(key, "");
  vi.stubEnv("REFUND_REVIEW_SQLITE_PATH", path.join(directory, "test.sqlite"));
  vi.stubEnv("REFUND_REVIEW_MODE", "demo");
  vi.stubEnv("SLACK_REFUND_SIGNING_SECRET", "test-secret");
  vi.stubEnv("SLACK_REFUND_BOT_TOKEN", "test-token");
  vi.stubEnv("SLACK_REFUND_TEAM_ID", "T1");
  vi.stubEnv("SLACK_REFUND_CHANNEL_IDS", "C1");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
function request(body: unknown, form = false, ts = String(Math.floor(Date.now() / 1000))) {
  const raw = form ? new URLSearchParams({ payload: JSON.stringify(body) }).toString() : JSON.stringify(body);
  const signature = `v0=${crypto.createHmac("sha256", "test-secret").update(`v0:${ts}:${raw}`).digest("hex")}`;
  return new Request("http://localhost/api/slack", { method: "POST", headers: { "x-slack-signature": signature, "x-slack-request-timestamp": ts }, body: raw });
}
const event = (text = demoId(0), id = "E1", thread?: string) => ({ type: "event_callback", team_id: "T1", event_id: id, event: { type: "app_mention", text: `<@BOT> ${text} dispute:items`, channel: "C1", user: "U1", ts: "100.1", ...(thread ? { thread_ts: thread } : {}) } });
const read = async (id = "refund:T1:E1") => JSON.parse((await getRefundJob(id))!.payload) as Job;
const action = (id: string, actionId: string, page = 0) => ({ type: "block_actions", team: { id: "T1" }, channel: { id: "C1" }, user: { id: "U1" }, actions: [{ action_id: actionId, value: JSON.stringify({ id, page }), action_ts: "123.456" }] });
const mockSlack = () => {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ method: url.split("/").at(-1)!, body: JSON.parse(init.body as string) }); return Response.json({ ok: true, ts: "200.1" }); }));
  return calls;
};

describe("input and deterministic findings", () => {
  it("normalizes compact and hyphenated IDs with optional label", () => {
    expect(parseIdfv("<@U123> IDFV: ABCDEF01-2345-6789-ABCD-EF0123456789 dispute:items")).toEqual({ idfv: "abcdef0123456789abcdef0123456789", review: {dispute: "items", purchaseDate: "", amountUsd: ""} });
    expect(parseIdfv(demoId(0) + " dispute:items")).toEqual({ idfv: demoId(0), review: {dispute: "items", purchaseDate: "", amountUsd: ""} });
  });
  it.each(["", "not-an-id", `${demoId(0)} ${demoId(1)}`, `${demoId(0)} ${demoId(0)}`, `x${demoId(0)}`, `${demoId(0)}123`])("rejects ambiguous or malformed input %s", text => expect(parseIdfv(text)).toHaveProperty("error"));
  it.each([
    ["received", "Recommend not eligible"], ["rewarded", "Recommend not eligible"], ["expired", "Recommend not eligible"],
    ["interstitial", "Recommend eligible"], ["not-delivered", "Recommend eligible"], ["partial", "Needs review"],
    ["incomplete", "Needs review"], ["overlap", "Needs review"], ["unknown-product", "Needs review"], ["truncated", "Needs review"], ["uncertain", "Needs review"],
  ] as const)("assesses %s", (name, expected) => {
    const result = assess(sample(name));
    expect(result.findings[0].verdict).toBe(expected);
    expect(result.findings[0].evidence).toContain("purchase-1");
  });
  it("checks each purchase independently", () => expect(assess(sample("multiple")).findings.map(f => f.verdict)).toEqual(["Recommend not eligible", "Recommend eligible"]));
  it("uses expiry as an exclusive boundary", () => {
    const t = sample("expired"); t.ads[0].at = t.entitlements[0].end!;
    expect(assess(t).findings[0].verdict).toBe("Recommend not eligible");
    t.ads[0].at = new Date(Date.parse(t.entitlements[0].end!) - 1).toISOString();
    expect(assess(t).findings[0].verdict).toBe("Recommend eligible");
  });
  it("does not count duplicated grants twice", () => { const t = sample("partial"); t.grants.push(t.grants[0], t.grants[0]); expect(assess(t).findings[0].verdict).toBe("Needs review"); });
  it("requires complete grants, fresh data, and elapsed delivery grace", () => {
    const t = sample("not-delivered"); t.coverage.grantsComplete = false; expect(assess(t).findings[0].verdict).toBe("Needs review");
    t.coverage.grantsComplete = true; t.coverage.freshThrough = input.from; expect(assess(t).findings[0].verdict).toBe("Needs review");
    t.coverage.freshThrough = input.through; t.purchases[0].at = input.through; expect(assess(t).findings[0].verdict).toBe("Needs review");
  });
  it("does not infer an ad failure from no observed ads or unknown formats", () => { const t = sample("rewarded"); t.ads[0].kind = "unknown"; expect(assess(t).findings[0].verdict).toBe("Needs review"); t.ads = []; expect(assess(t).findings[0].verdict).toBe("Needs review"); });
  it("does not fabricate fixtures for real IDs and blocks an unset mode", async () => {
    const p = provider(); expect(await p.poll(await p.submit({ ...input, idfv: "38645146fe0ea5644f7853ee3d88f77e" }, "key"))).toMatchObject({ status: "unavailable" });
    vi.stubEnv("REFUND_REVIEW_MODE", ""); expect(() => provider()).toThrow();
  });
});

describe("signed Slack ingress and durable work", () => {
  it("verifies signatures and rejects replayed or unsigned requests", async () => {
    expect((await events(request(event(), false, "1"))).status).toBe(401);
    expect(verifySlack("x", new Headers())).toBe(false);
    expect((await events(new Request("http://localhost", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await events(request({ type: "url_verification", challenge: "hello" }))).status).toBe(200);
  });
  it("denies other channels and ignores bots", async () => {
    const other = event(); other.event.channel = "C2"; expect((await events(request(other))).status).toBe(403);
    expect((await events(request({ ...event(), event: { ...event().event, bot_id: "B1" } }))).status).toBe(200);
    expect(await getRefundJob("refund:T1:E1")).toBeUndefined();
  });
  it("deduplicates deliveries and keeps original thread", async () => {
    const calls = mockSlack();
    expect((await events(request(event(demoId(0), "E1", "99.1")))).status).toBe(200);
    await events(request(event(demoId(0), "E1", "99.1")));
    expect(calls).toHaveLength(0);
    await workOne(); expect(await workOne()).toBe(false);
    expect(calls.map(c => c.method)).toEqual(["chat.postMessage", "chat.update"]);
    expect(calls[0].body.thread_ts).toBe("99.1");
    expect((await read()).assessment?.findings[0].verdict).toBe("Recommend not eligible");
    expect(JSON.stringify(calls)).toContain("DEMO");
  });
  it("threads top-level mentions and returns correction prompts", async () => {
    const calls = mockSlack(); await events(request(event("bad"))); await workOne();
    expect(calls[0].body.thread_ts).toBe("100.1"); expect((await read()).notice).toContain("IDFV"); expect((await read()).assessment).toBeUndefined();
  });
  it("serves evidence ephemerally only in the original authorized channel", async () => {
    const calls = mockSlack(); await events(request(event())); await workOne();
    const payload = action("refund:T1:E1", "refund_evidence");
    expect((await interactions(request(payload, true))).status).toBe(200); await workOne();
    expect(calls.at(-1)).toMatchObject({ method: "chat.postEphemeral", body: { user: "U1", channel: "C1" } });
    vi.stubEnv("SLACK_REFUND_CHANNEL_IDS", "C1,C2"); payload.channel.id = "C2";
    expect((await interactions(request(payload, true))).status).toBe(403);
  });
  it("times out pending queries and deduplicates Retry clicks", async () => {
    mockSlack(); await events(request(event(demoId(demoCases.indexOf("timeout"))))); await workOne();
    const original = await read(); await workOne(original.deadline + 1);
    expect((await read()).error).toContain("timed out");
    const payload = action(original.id, "refund_retry");
    expect((await interactions(request(payload, true))).status).toBe(200);
    expect((await interactions(request(payload, true))).status).toBe(200);
    expect(await getRefundJob(`retry:${crypto.createHash("sha256").update(original.id).digest("hex")}`)).toBeDefined();
  });
  it("reports query failure as an error, never an eligibility finding", async () => {
    mockSlack(); await events(request(event(demoId(demoCases.indexOf("query-error")))));
    const start = Date.now(); for (let i = 0; i < 5; i++) await workOne(start + i * 240000);
    expect((await read()).error).toBeDefined(); expect((await read()).assessment).toBeUndefined();
  });
  it("claims atomically and prevents an expired worker from overwriting a new lease", async () => {
    await events(request(event())); const now = Date.now();
    const claims = await Promise.all([claimRefundJob(now, "one"), claimRefundJob(now, "two")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const old = claims.find(Boolean)!;
    expect((await claimRefundJob(now + 91000, "successor"))?.id).toBe(old.id);
    expect(await saveRefundJob(old.id, old.lease_token!, "{}", now, true)).toBe(false);
    expect(await saveRefundJob(old.id, "successor", old.payload, now, false)).toBe(true);
  });
  it("recovers a saved message without posting a new progress message", async () => {
    const calls = mockSlack(); await events(request(event()));
    const row = (await claimRefundJob(Date.now(), "crashed"))!; const job = JSON.parse(row.payload) as Job; job.messageTs = "saved-ts";
    await saveRefundJob(row.id, "crashed", JSON.stringify(job), Date.now(), false, false);
    await workOne(Date.now() + 91000);
    expect(calls.map(c => c.method)).toEqual(["chat.update"]); expect(calls[0].body.ts).toBe("saved-ts");
  });
  it("purges expired rows and requires a cron secret", async () => {
    await insertRefundJob("old", "{}", Date.now() - 31 * 86400000); await claimRefundJob(Date.now(), "x");
    expect(await getRefundJob("old")).toBeUndefined();
    vi.stubEnv("CRON_SECRET", ""); expect((await cron(new Request("http://localhost"))).status).toBe(401);
  });
  it("honors Slack Retry-After and retries updates without duplicating posts", async () => {
    const calls = mockSlack(); await events(request(event()));
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(async () => Response.json({ ok: true, ts: "saved" }));
    fetchMock.mockImplementationOnce(async () => Response.json({ ok: false }, { status: 429, headers: { "retry-after": "120" } }));
    await workOne(); expect((await read()).messageTs).toBe("saved");
    expect(await workOne(Date.now() + 60000)).toBe(false);
    await workOne(Date.now() + 121000); expect(calls.map(c => c.method)).toEqual(["chat.update"]);
  });
  it("classifies permanent Slack errors and limits response blocks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "invalid_auth" })));
    await expect(slack("chat.update", {})).rejects.toBeInstanceOf(SlackFailure);
    const j: Job = { id: "x", team: "T1", channel: "C1", user: "U1", thread: "1", createdAt: Date.now(), deadline: Date.now(), failures: 0, assessment: assess(sample("multiple")) };
    expect(render(j).blocks.length).toBeLessThan(50); expect(JSON.stringify(evidencePage(j, 999))).toContain("DEMO");
  });
});

describe("ticket-date propagation", () => {
  it("persists an optional cutoff and queries a fixed 90-day window", async () => {
    mockSlack();
    await events(request(event(`${demoId(0)} asof:2026-09-08`)));
    await workOne();
    const job = await read();
    expect(job.asOf).toBe("2026-09-08");
    const query = JSON.parse(job.queryId!);
    expect(query.through).toBe("2026-09-08T23:59:59.999Z");
    expect(Date.parse(query.through) - Date.parse(query.from)).toBe(90 * 86400000);
  });
});

describe("dispute form and purchase selection", () => {
 it("opens the form from an IDFV-only mention and queues a validated submission", async () => {
  const calls=mockSlack(); const mention=event(); mention.event.text=`<@BOT> ${demoId(0)}`;
  await events(request(mention)); await workOne();
  expect((await read()).review).toBeUndefined(); expect(JSON.stringify(calls)).toContain("Add dispute details");
  const open={...action("refund:T1:E1","refund_details"),trigger_id:"trigger"};
  expect((await interactions(request(open,true))).status).toBe(200); expect(calls.at(-1)?.method).toBe("views.open");
  const form={type:"view_submission",team:{id:"T1"},user:{id:"U1"},view:{id:"V1",callback_id:"refund_details",private_metadata:"refund:T1:E1",state:{values:{dispute:{value:{selected_option:{value:"items"}}},amountUsd:{value:{value:"14.999"}}}}}};
  expect(await (await interactions(request(form,true))).json()).toMatchObject({response_action:"errors",errors:{amountUsd:expect.any(String)}});
  form.view.state.values.amountUsd.value.value="";
  expect((await interactions(request(form,true))).status).toBe(200);
  expect((await interactions(request({...form,team:{id:"T2"}},true))).status).toBe(403);
  expect((await interactions(request(form,true))).status).toBe(200);
  await workOne();expect(await workOne()).toBe(false);
 });
 it("authorizes selected candidates against the original job", async () => {
  const now=Date.now(); const j:Job={id:"choose",team:"T1",channel:"C1",thread:"1",user:"U1",createdAt:now,deadline:now+600000,failures:0,mode:"demo",idfv:demoId(0),review:{dispute:"items",purchaseDate:"",amountUsd:""},selection:{message:"Select",matchingIds:[],candidates:[{id:"p1",product:"Coins",at:new Date(now).toISOString(),amountUsd:1,transactionId:"tx1"}]}};
  await insertRefundJob(j.id,JSON.stringify(j),now);
  const a=action(j.id,"refund_select");a.actions[0].value=JSON.stringify({id:j.id,page:0,selectedId:"missing"}); expect((await interactions(request(a,true))).status).toBe(409);
  a.actions[0].value=JSON.stringify({id:j.id,page:0,selectedId:"p1"});expect((await interactions(request({...a,channel:{id:"C2"}},true))).status).toBe(403);expect((await interactions(request(a,true))).status).toBe(200);
 });
});

it("keeps findings prominent and sends check details privately", async () => {
 const calls=mockSlack();await events(request(event()));await workOne();const original=await read();
 const output=render(original);const serialized=JSON.stringify(output.blocks);
 expect(serialized.indexOf('Finding:')).toBeLessThan(serialized.indexOf('Purchase:'));
 expect(serialized).not.toContain('Coverage:');expect(serialized).toContain('View check details');
 expect((await interactions(request(action(original.id,'refund_check_details'),true))).status).toBe(200);
 await workOne();expect(calls.at(-1)?.method).toBe('chat.postEphemeral');expect(calls.at(-1)?.body.user).toBe('U1');expect(JSON.stringify(calls.at(-1)?.body)).toContain('Coverage:');
 const other=action(original.id,'refund_check_details');other.channel.id='C2';expect((await interactions(request(other,true))).status).toBe(403);
});
