// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ human: vi.fn(), internal: vi.fn(), start: vi.fn(), progress: vi.fn(), page: vi.fn(), worker: vi.fn(), paused: vi.fn(), estimate: vi.fn(), cache: vi.fn(), game: vi.fn(), recent: vi.fn(), icons: vi.fn(), queueGet: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCurrentAppUser: mocks.human, assertInternalAppUser: mocks.internal, jsonError: (e: unknown) => e instanceof Response ? e : Response.json({error:"Unexpected error"},{status:500}) }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
vi.mock("@/lib/ludios-sense", () => ({ startSense: mocks.start, getSenseProgress: mocks.progress, getSenseReportPage: mocks.page, runSenseWorker: mocks.worker, setSensePaused: mocks.paused, estimateSense: mocks.estimate, getCachedSense: mocks.cache, getSenseGame: mocks.game, getSenseWatchlist: mocks.recent }));
vi.mock("@/lib/ludios-sense-icons", () => ({ getSenseIcons: mocks.icons }));
vi.mock("@/lib/ludios-sense-queue-types", () => ({ queueEnabled: () => true }));
vi.mock("@/lib/ludios-sense-queue-runtime", () => ({ senseQueueRuntime: () => ({store:{get:mocks.queueGet}}) }));
import { after } from "next/server";
import { POST as start } from "@/app/api/ludios-sense/route";
import { POST as status } from "@/app/api/ludios-sense/status/route";
import { POST as report } from "@/app/api/ludios-sense/report/route";
import { POST as resume } from "@/app/api/ludios-sense/continue/route";
import { POST as usage } from "@/app/api/ludios-sense/usage/route";
import { POST as cache } from "@/app/api/ludios-sense/cache/route";
import { POST as game } from "@/app/api/ludios-sense/game/route";
import { POST as recent } from "@/app/api/ludios-sense/recent/route";
import { POST as icons } from "@/app/api/ludios-sense/icons/route";
const token = `liz_${"a".repeat(43)}`;
const jobKey = `sense:v1:${"b".repeat(64)}`;
const filters = {date:"2026-11-09",countries:["US"]};
const progress = {jobKey,status:"running",requests:0,progress:"Running",workerActive:false};
const generatedAt = "2026-11-09T00:00:00.000Z";
const request = (body:unknown, credential:string|null=token) => new Request("https://cerebral.example/api/ludios-sense",{method:"POST",headers:{"content-type":"application/json",...(credential===null?{}:{authorization:`Bearer ${credential}`})},body:JSON.stringify(body)});
const routes = {start,status,report,resume,usage,cache,game,recent,icons};
beforeEach(() => {
 vi.resetAllMocks();
 vi.stubEnv("CEREBRAL_LIZ_TOKEN_SHA256",createHash("sha256").update(token).digest("hex"));
 vi.spyOn(console,"info").mockImplementation(()=>{});
 mocks.human.mockRejectedValue(Response.json({error:"Unauthorized"},{status:401}));
 mocks.start.mockResolvedValue(progress);mocks.progress.mockResolvedValue(progress);
 mocks.page.mockResolvedValue({games:[],page:0,pageCount:1});
 mocks.estimate.mockResolvedValue({estimatedRequests:10});mocks.cache.mockResolvedValue(null);
 mocks.recent.mockResolvedValue([]);mocks.game.mockResolvedValue({history:[]});
 mocks.queueGet.mockResolvedValue({state:{}});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
describe("Liz Sense reporting access",()=>{
 it.each(Object.entries(routes))("rejects missing and wrong credentials on %s",async (_name,handler)=>{
  expect((await handler(request({},null))).status).toBe(401);
  mocks.human.mockClear();
  expect((await handler(request({},`liz_${"x".repeat(43)}`))).status).toBe(401);
  expect(mocks.human).not.toHaveBeenCalled();
  for(const name of ["start","progress","page","worker","paused","estimate","cache","game","recent","icons","queueGet"] as const) expect(mocks[name]).not.toHaveBeenCalled();
 });
 it("runs a report and follows progress, continuation and paged results with the same token",async()=>{
  expect((await usage(request(filters))).status).toBe(200);
  expect((await start(request(filters))).status).toBe(200);
  expect(mocks.start).toHaveBeenCalledWith(filters);
  await (vi.mocked(after).mock.calls[0][0] as ()=>Promise<void>)();
  expect(mocks.worker).toHaveBeenCalledWith(jobKey);
  vi.mocked(after).mockClear();
  expect((await status(request({jobKey}))).status).toBe(200);
  expect(after).not.toHaveBeenCalled(); // Polling never restarts the worker.
  expect((await resume(request({jobKey}))).status).toBe(200);
  expect(after).toHaveBeenCalledOnce();
  expect((await report(request({jobKey,generatedAt,page:0}))).status).toBe(200);
  expect(mocks.page).toHaveBeenCalledWith(jobKey,generatedAt,0,undefined);
  expect(mocks.human).not.toHaveBeenCalled();expect(mocks.internal).not.toHaveBeenCalled();
 });
 it("allows cached reports, watchlist and game detail reads",async()=>{
  expect((await cache(request(filters))).status).toBe(200);
  expect((await recent(request({jobKey}))).status).toBe(200);
  expect((await game(request({jobKey,store:"ios",appId:"123",generatedAt}))).status).toBe(200);
 });
 it("enforces validation before launching paid work and preserves runtime quota errors",async()=>{
  expect((await start(request({date:"2026-11-09",countries:[]}))).status).toBe(400);
  expect(mocks.start).not.toHaveBeenCalled();
  mocks.start.mockRejectedValue(Response.json({error:"Request budget reached"},{status:429}));
  expect((await start(request(filters))).status).toBe(429);
  expect(after).not.toHaveBeenCalled();
 });
 it("does not continue paused jobs",async()=>{
  mocks.progress.mockResolvedValue({...progress,paused:true});
  const response=await resume(request({jobKey}));
  expect(await response.json()).toMatchObject({accepted:false});
  expect(after).not.toHaveBeenCalled();
 });
 it("fails closed when the token is revoked, even with a human session",async()=>{
  mocks.human.mockResolvedValue({id:"human"});vi.stubEnv("CEREBRAL_LIZ_TOKEN_SHA256","");
  expect((await start(request(filters))).status).toBe(401);
  expect(mocks.human).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();
 });
 it("keeps internal human session access and rejects external users",async()=>{
  mocks.human.mockResolvedValue({id:"human"});
  expect((await start(request(filters,null))).status).toBe(200);
  expect(mocks.internal).toHaveBeenCalledWith({id:"human"});
  mocks.internal.mockImplementation(()=>{throw Response.json({error:"Forbidden"},{status:403});});
  expect((await start(request(filters,null))).status).toBe(403);
 });
 it("attributes authorization to Liz without logging her token or payload",async()=>{
  await start(request(filters));
  const calls=vi.mocked(console.info).mock.calls.map(c=>String(c[0]));
  const log=JSON.parse(calls.find(c=>c.startsWith('{"event":"cerebral.service_access"'))!);
  expect(log).toMatchObject({actor:"service:liz",action:"sense.start",outcome:"authorized"});
  expect(JSON.stringify(calls)).not.toContain(token);expect(log).not.toHaveProperty("countries");
 });
});
