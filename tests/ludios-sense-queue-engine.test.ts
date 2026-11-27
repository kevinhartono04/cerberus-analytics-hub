// @vitest-environment node
import type {SenseRunResponse} from "@/lib/ludios-sense-types";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {queueFixture,type QueueFixture} from "./helpers/sense-queue-postgres";
import {shiftDate,aggregateSenseHistory,evaluateSense} from "@/lib/ludios-sense-detection";
import {measureSenseTransfer} from "@/lib/ludios-sense-transfer";
import {QUEUE_RUN_LIMIT,queueKey} from "@/lib/ludios-sense-queue-types";
import {senseChartKey} from "@/lib/ludios-sense-storage";
let fixture:QueueFixture;
beforeEach(async()=>{fixture=await queueFixture();vi.spyOn(console,"info").mockImplementation(()=>{});});
afterEach(async()=>{vi.restoreAllMocks();await fixture.pg.close();});
const filters={date:"2026-09-28",countries:["JP","US"] as ("JP"|"US")[]};
async function finish(key:string,max=100){
 let run:SenseRunResponse=await fixture.engine().progress(key);
 for(let i=0;i<max&&run.status==="running"&&!run.paused;i++)run=await fixture.engine().advance(key);
 return run;
}
describe("database-backed Sense queue",()=>{
 it("runs both stores through discovery, metadata, history and finalization with detector parity",async()=>{
  fixture.provider(async(endpoint,p)=>{
   if(endpoint.endsWith("metrics"))return {data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1}};
   if(endpoint.endsWith("/apps"))return {apps:[{app_id:"123",name:"Test game",publisher_name:"Studio",categories:endpoint.includes("ios")?["7012"]:["GAME_PUZZLE"]}]};
   const rows=[];
   for(let date=String(p.start_date);date<=String(p.end_date);date=shiftDate(date,1))for(const country of ["JP","US"]){
    const value=date>=shiftDate(filters.date,-2)?600:200;
    rows.push(endpoint.includes("ios")?{aid:"123",cc:country,d:date,iu:value,au:0}:{aid:"123",c:country,d:date,u:value});
   }
   return rows;
  });
  const start=await fixture.engine().start(filters),run=await finish(start!.jobKey);
  expect(run.status).toBe("completed");expect(run.requests).toBe(fixture.calls.length);
  const page=await fixture.store.report(run.jobKey,0,run.reportRevision,run.result!.generatedAt);
  expect(page.result.games).toHaveLength(2);
  expect(page.result.games.every(g=>g.evaluation.signal==="confirmed_momentum"&&g.evaluation.latest===1200)).toBe(true);
  const chart=fixture.charts.get(senseChartKey(run.jobKey,run.result!.generatedAt,"ios","123"))!;
  const expected=Array.from({length:28},(_,i)=>({date:shiftDate(filters.date,i-27),downloads:i>=25?1200:400}));
  expect(chart.history).toEqual(expected);expect(chart.evaluation).toEqual(evaluateSense(expected,filters.date,null));
  expect(fixture.calls.filter(c=>c.endpoint.endsWith("metrics"))).toHaveLength(6);
  expect(await fixture.store.detections(run.jobKey)).toHaveLength(2);
  await fixture.pg.query("UPDATE cerebral.sense_queue_candidates SET result=jsonb_set(result,'{evaluation,signal}','\"none\"') WHERE job_key=$1 AND store='ios'",[run.jobKey]);
  expect((await fixture.store.detections(run.jobKey)).map(game=>game.store)).toEqual(["android"]);
  expect((await fixture.store.observations(run.jobKey,[{store:"ios",appId:"123"},{store:"ios",appId:"123"},{store:"android",appId:"absent"}])).map(game=>game.evaluation.signal)).toEqual(["none"]);
  const saved=await fixture.store.get(run.jobKey);
  expect(JSON.stringify(saved!.state)).not.toContain("historyRef");expect(JSON.stringify(saved!.state)).not.toContain('"apps"');
  expect(Buffer.byteLength(JSON.stringify(saved!.state))).toBeLessThan(4096);
  expect((await fixture.engine().start(filters))?.cached).toBe(true);
 });
 it("rolls candidate and cursor changes back together and reuses a received response after interruption",async()=>{
  const start=(await fixture.engine().start(filters))!;
  fixture.provider(async()=>{fixture.crashCheckpoint();return {data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1}};});
  await expect(fixture.engine().advance(start.jobKey)).rejects.toThrow("Simulated checkpoint crash");
  expect((await fixture.store.get(start.jobKey))!.state.stores.android.datesFound).toBe(0);
  expect((await fixture.pg.query("SELECT count(*)::integer AS n FROM cerebral.sense_queue_candidates")).rows).toEqual([{n:0}]);
  const resumed=await fixture.engine().advance(start.jobKey);
  expect(resumed.requests).toBe(1);expect(fixture.calls).toHaveLength(1);
  expect((await fixture.store.get(start.jobKey))!.state.stores.android.datesFound).toBe(1);
  expect((await fixture.pg.query("SELECT count(*)::integer AS n FROM cerebral.sense_queue_candidates")).rows).toEqual([{n:1}]);
 });
 it("honors an in-flight pause and never clears it when Run check is pressed",async()=>{
  const start=(await fixture.engine().start(filters))!;
  fixture.provider(async()=>{await fixture.store.pause(start.jobKey,true);return {data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1}};});
  const run=await fixture.engine().advance(start.jobKey);
  expect(run.paused).toBe(true);expect((await fixture.engine().start(filters))!.paused).toBe(true);
  expect((await fixture.store.get(start.jobKey))!.state.stores.android.datesFound).toBe(0);
  await fixture.engine().advance(start.jobKey);expect(fixture.calls).toHaveLength(1);
 });
 it("persists safety stops and rejects an ordinary resume",async()=>{
  const start=(await fixture.engine().start(filters))!;
  await fixture.pg.query("UPDATE cerebral.sense_queue_jobs SET read_bytes=$2 WHERE job_key=$1",[start.jobKey,QUEUE_RUN_LIMIT]);
  expect((await fixture.engine().advance(start.jobKey)).paused).toBe(true);
  await expect(fixture.store.pause(start.jobKey,false)).rejects.toMatchObject({status:409});
  expect((await fixture.engine().start(filters))!.paused).toBe(true);expect(fixture.calls).toHaveLength(0);
 });
 it("does not let a stale owner commit over a newer lease",async()=>{
  const start=(await fixture.engine().start(filters))!;
  fixture.provider(async()=>{
   await fixture.pg.query("UPDATE cerebral.sense_queue_jobs SET lease_token='new-owner',lease_until=now()+interval '1 minute' WHERE job_key=$1",[start.jobKey]);
   return {data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1}};
  });
  await fixture.engine().advance(start.jobKey);
  expect((await fixture.store.get(start.jobKey))!.revision).toBe(0);
  expect((await fixture.pg.query("SELECT lease_token FROM cerebral.sense_queue_jobs")).rows).toEqual([{lease_token:"new-owner"}]);
 });
 it("derives a country subset from the original observation snapshots without provider calls",async()=>{
  fixture.provider(async(endpoint,p)=>{
   if(endpoint.endsWith("metrics"))return {data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1}};
   if(endpoint.endsWith("/apps"))return {apps:[{app_id:"123",categories:endpoint.includes("ios")?["7012"]:["GAME_PUZZLE"]}]};
   const rows=[];
   for(let date=String(p.start_date);date<=String(p.end_date);date=shiftDate(date,1))for(const country of ["JP","US"]){
    const value=country==="JP"?(date>=shiftDate(filters.date,-2)?3000:300):100;
    rows.push(endpoint.includes("ios")?{aid:"123",cc:country,d:date,iu:value,au:0}:{aid:"123",c:country,d:date,u:value});
   }
   return rows;
  });
  const original=(await fixture.engine().start(filters))!;await finish(original.jobKey);
  fixture.calls.length=0;
  const subset=(await fixture.engine().cached({date:filters.date,countries:["US"]}))!;
  const completed=await finish(subset.jobKey);
  expect(completed.status).toBe("completed");expect(completed.result!.reusedFrom?.jobKey).toBe(original.jobKey);
  const report=await fixture.store.report(completed.jobKey,0);
  expect(report.result.games.every(g=>g.evaluation.latest===100&&g.evaluation.signal==="none")).toBe(true);
  expect(fixture.calls).toHaveLength(0);
 });
 it("pins report pages to the stored revision",async()=>{
  const start=(await fixture.engine().start(filters))!;const run=await finish(start.jobKey);
  await expect(fixture.store.report(run.jobKey,0,"2020-01-01T00:00:00.000Z",run.result!.generatedAt)).rejects.toMatchObject({status:409});
 });
});

it("caches fresh excluded metadata so the next date does not fetch non-games again",async()=>{
 fixture.provider(async(endpoint)=>endpoint.endsWith("metrics")?{data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1}}:endpoint.endsWith("/apps")?{apps:[{app_id:"123",name:"Business app",categories:["BUSINESS"]}]}:[]);
 const run=(await fixture.engine().start(filters))!;expect((await finish(run.jobKey)).status).toBe("completed");
 expect((await fixture.pg.query("SELECT count(*)::integer AS n FROM cerebral.sense_queue_apps")).rows).toEqual([{n:2}]);
 fixture.calls.length=0;
 const next=(await fixture.engine().start({...filters,date:shiftDate(filters.date,1)}))!;
 expect((await finish(next.jobKey)).status).toBe("completed");
 expect(fixture.calls.some(c=>c.endpoint.endsWith("/apps"))).toBe(false);
});
it("finishes with explicit partial coverage when the call allowance is exhausted",async()=>{
 const run=(await fixture.engine().start(filters))!;
 fixture.services.reserve=async()=>{throw new Error("Monthly Sensor Tower allowance reached");};
 const partial=await finish(run.jobKey);
 expect(partial.status).toBe("completed");expect(partial.result!.coverageComplete).toBe(false);
 expect(partial.result!.errors.join()).toContain("allowance");expect(fixture.calls).toHaveLength(0);
});
it("recreates an expired job atomically without overriding a live paused job",async()=>{
 const first=(await fixture.engine().start(filters))!;await fixture.engine().advance(first.jobKey);
 await fixture.store.pause(first.jobKey,true,"Safety stop");
 expect((await fixture.engine().start(filters))!.paused).toBe(true);
 await fixture.pg.query("UPDATE cerebral.sense_queue_jobs SET expires_at=now()-interval '1 day' WHERE job_key=$1",[first.jobKey]);
 const fresh=(await fixture.engine().start(filters))!;
 expect(fresh.requests).toBe(0);expect(fresh.paused).toBe(false);
 expect((await fixture.pg.query("SELECT count(*)::integer AS n FROM cerebral.sense_queue_candidates")).rows).toEqual([{n:0}]);
});
it("packs interleaved stale metadata into full requests without losing fresh candidates",async()=>{
 fixture.services.now=()=>"2026-11-16T00:00:00.000Z";
 const start=(await fixture.engine().start(filters))!;
 const ids=Array.from({length:100},(_,i)=>String(i).padStart(3,"0"));
 await fixture.pg.query(`UPDATE cerebral.sense_queue_jobs SET state=jsonb_set(jsonb_set(state,'{stores,android,phase}','"metadata"'),'{stores,android,watermark}','"2026-09-28"') WHERE job_key=$1`,[start.jobKey]);
 for(let i=0;i<ids.length;i++){
  const app={appId:ids[i],name:ids[i],publisher:"",categories:["GAME_PUZZLE"],releaseDate:null,discoveredDate:filters.date,histories:{},...(i%2?{metadataAt:"2026-11-15T00:00:00.000Z"}:i%4?{metadataAt:"2026-10-01T00:00:00.000Z"}:{})};
  await fixture.pg.query(`INSERT INTO cerebral.sense_queue_candidates(job_key,store,app_id,discovered_date,payload) VALUES($1,'android',$2,$3,$4)`,[start.jobKey,ids[i],filters.date,JSON.stringify(app)]);
 }
 fixture.provider(async(endpoint,p)=>({apps:String(p.app_ids).split(",").map(app_id=>({app_id,name:app_id,categories:["GAME_PUZZLE"]}))}));
 for(let i=0;i<4;i++)await fixture.engine().advance(start.jobKey);
 expect(fixture.calls).toHaveLength(2);
 expect(fixture.calls.map(call=>String(call.parameters.app_ids).split(",").length)).toEqual([25,25]);
 const refreshed=fixture.calls.flatMap(call=>String(call.parameters.app_ids).split(","));
 expect(new Set(refreshed)).toEqual(new Set(ids.filter((_,i)=>i%2===0)));
 const result=await fixture.pg.query<{app_id:string;stage:string}>("SELECT app_id,stage FROM cerebral.sense_queue_candidates WHERE job_key=$1",[start.jobKey]);
 expect(result.rows).toHaveLength(100);expect(result.rows.every(row=>row.stage==="history")).toBe(true);
});
