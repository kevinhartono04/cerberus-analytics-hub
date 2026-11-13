// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {queueFixture,type QueueFixture} from "./helpers/sense-queue-postgres";
import {SenseTransferGuard,SENSE_DAY_LIMIT,SENSE_STEP_RESERVATION,SENSE_STEP_LIMIT} from "@/lib/ludios-sense-guard";
import {countSenseRead,limitSenseStepReads,measureSenseTransfer,senseReadBytes} from "@/lib/ludios-sense-transfer";
let f:QueueFixture;
const filters={date:"2026-11-12",countries:["US"] as "US"[]};
beforeEach(async()=>{f=await queueFixture();vi.spyOn(console,"info").mockImplementation(()=>{});vi.spyOn(console,"error").mockImplementation(()=>{});});
afterEach(async()=>{vi.restoreAllMocks();await f.pg.close();});
it("prevents overlapping collection jobs and resumes while preserving derived-data access",async()=>{
 const first=(await f.engine().start(filters))!;
 await expect(f.engine().start({...filters,date:"2026-11-13"})).rejects.toMatchObject({status:409});
 await f.store.pause(first.jobKey,true);
 const second=(await f.engine().start({...filters,date:"2026-11-13"}))!;
 await expect(f.store.pause(first.jobKey,false)).rejects.toMatchObject({status:409});
 expect(second.paused).toBe(false);
});
it("keeps killed-worker reservations charged and settles a receipt only once",async()=>{
 const run=(await f.engine().start(filters))!,guard=new SenseTransferGuard(f.database);
 expect((await guard.reserve(run.jobKey,"killed")).reserved).toBe(true);
 expect((await guard.reserve(run.jobKey,"success")).reserved).toBe(true);
 await guard.settle("success",1000,20,true);await guard.settle("success",1,1,true);
 const {rows}=await f.pg.query<{charged_bytes:number;measured_bytes:number}>("SELECT charged_bytes,measured_bytes FROM cerebral.sense_transfer_budgets WHERE scope=$1",["job:"+run.jobKey]);
 expect(Number(rows[0].charged_bytes)).toBe(SENSE_STEP_RESERVATION+1000);expect(Number(rows[0].measured_bytes)).toBe(1000);
});
it("charges failed checkpoints independently of the successful checkpoint counter",async()=>{
 const run=(await f.engine().start(filters))!;
 f.provider(async()=>{f.crashCheckpoint();return {data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1}};});
 await expect(f.engine().advance(run.jobKey)).rejects.toThrow("Simulated checkpoint crash");
 const {rows}=await f.pg.query<any>("SELECT charged_bytes,measured_bytes,stalled_steps FROM cerebral.sense_transfer_budgets WHERE scope=$1",["job:"+run.jobKey]);
 expect(Number(rows[0].charged_bytes)).toBeGreaterThanOrEqual(SENSE_STEP_RESERVATION);expect(Number(rows[0].measured_bytes)).toBeGreaterThan(0);expect(rows[0].stalled_steps).toBe(1);
 expect((await f.store.get(run.jobKey))!.revision).toBe(0);
});
it("stops across job boundaries when today's shared allowance is exhausted",async()=>{
 const first=(await f.engine().start(filters))!,guard=new SenseTransferGuard(f.database);
 await guard.reserve(first.jobKey,"spent");await guard.settle("spent",SENSE_DAY_LIMIT,100,true);
 await f.store.pause(first.jobKey,true);
 const second=(await f.engine().start({...filters,date:"2026-11-13"}))!;
 const stopped=await f.engine().advance(second.jobKey);
 expect(stopped.paused).toBe(true);expect(stopped.progress).toContain("all checks today");expect(f.calls).toHaveLength(0);
 await expect(f.store.pause(second.jobKey,false)).rejects.toMatchObject({status:409});
});
it("stops before the next expensive step after three failed attempts",async()=>{
 const run=(await f.engine().start(filters))!,guard=new SenseTransferGuard(f.database);
 for(let i=0;i<3;i++){await guard.reserve(run.jobKey,String(i));await guard.settle(String(i),100,20,false);}
 const stopped=await f.engine().advance(run.jobKey);
 expect(stopped.paused).toBe(true);expect(stopped.progress).toContain("without progress");expect(f.calls).toHaveLength(0);
});
it("enforces the per-step allowance inside a longer worker context",async()=>{
 await measureSenseTransfer("test",async()=>{
  countSenseRead("existing");const reset=limitSenseStepReads(senseReadBytes(),SENSE_STEP_LIMIT);
  expect(()=>countSenseRead("x".repeat(SENSE_STEP_LIMIT+1))).toThrow("transfer budget");reset();
  expect(()=>countSenseRead("control")).not.toThrow();
 });
});
