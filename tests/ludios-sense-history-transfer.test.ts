// @vitest-environment node
import {expect,it,vi} from "vitest";
import {queueFixture} from "./helpers/sense-queue-postgres";
import {aggregateSenseHistory,evaluateSense,shiftDate} from "@/lib/ludios-sense-detection";
import {senseCountryCodes,type SenseRunResponse,type SenseStore} from "@/lib/ludios-sense-types";
import type {QueueApp} from "@/lib/ludios-sense-queue-types";
// Benchmark only: observe a complete baseline instead of stopping at 250 MiB.
// Production limits and the upstream attempt limit are unchanged.
vi.mock("@/lib/ludios-sense-queue-types",async original=>({...await original<typeof import("@/lib/ludios-sense-queue-types")>(),...(process.env.SENSE_BENCHMARK_BASELINE ? {QUEUE_RUN_LIMIT:2*1024*1024*1024}:{})}));
it("measures a full seven-country, two-store report with 118-day shared histories and a recent revision",async()=>{
 const f=await queueFixture(),log=vi.spyOn(console,"info").mockImplementation(()=>{});
 const t="2026-11-12",countries=[...senseCountryCodes].sort(),now="2026-11-13T00:00:00.000Z";
 const ids=Array.from({length:10000},(_,i)=>"history-"+String(i).padStart(5,"0"));
 const expected=new Map<string,ReturnType<typeof evaluateSense>>();
 f.services.now=()=>now;
 try{
  for(const store of ["android","ios"] as SenseStore[]){
   let rows:unknown[]=[];
   for(let i=0;i<ids.length;i++){
    const included=i%5<2;
    const histories=included?Object.fromEntries(countries.map(country=>[country,Object.fromEntries(Array.from({length:118},(_,day)=>[shiftDate(t,day-117),200+i%97]))])):{};
    const app:QueueApp={appId:ids[i],name:"Game "+ids[i],publisher:"Studio",categories:included?(store==="ios"?["7012"]:["GAME_PUZZLE"]):["BUSINESS"],releaseDate:null,metadataAt:now,discoveredDate:t,histories,
     historyWindows:included?Object.fromEntries(countries.map(country=>[country,[{start:shiftDate(t,-117),end:t,at:"2026-11-12T00:00:00.000Z"}]])):undefined};
    if(included){
     await f.services.persist(app);
     const revised=Object.fromEntries(countries.map(country=>[country,Object.fromEntries(Array.from({length:28},(_,day)=>[shiftDate(t,day-27),(day>=25?600:200)+i%97]))]));
     expected.set(store+":"+ids[i],evaluateSense(aggregateSenseHistory(revised,countries,t).history,t,null));
    }
    rows.push({store,app_id:ids[i],discovered_date:t,payload:app});
    if(rows.length===500||i===ids.length-1){await f.pg.query(`INSERT INTO cerebral.sense_queue_apps(store,app_id,discovered_date,payload,expires_at)
     SELECT store,app_id,discovered_date::date,payload,now()+interval '93 days' FROM jsonb_to_recordset($1::jsonb) AS r(store text,app_id text,discovered_date text,payload jsonb)`,[JSON.stringify(rows)]);rows=[];}
   }
  }
  f.provider(async(endpoint,p)=>{
   if(endpoint.endsWith("metrics"))return {data:ids.slice(Number(p.offset),Number(p.offset)+200).map(app_id=>({app_id,est_mobile_downloads:2000})),meta:{total_count:ids.length}};
   if(!endpoint.endsWith("sales_report_estimates"))throw new Error("Unexpected metadata refresh");
   const rows=[];
   for(const aid of String(p.app_ids).split(","))for(const country of countries)for(let d=String(p.start_date);d<=String(p.end_date);d=shiftDate(d,1)){
    const value=(d>=shiftDate(t,-2)?600:200)+Number(aid.slice(-5))%97;
    rows.push(endpoint.includes("ios")?{aid,cc:country,d,iu:value,au:0}:{aid,c:country,d,u:value});
   }
   return rows;
  });
  let run:SenseRunResponse=(await f.engine().start({date:t,countries}))!;let steps=0;
  while(run.status==="running"&&!run.paused&&steps++<2500)run=await f.engine().advance(run.jobKey);
  expect(run.status).toBe("completed");expect(run.paused).toBe(false);expect(run.result?.coverageComplete).toBe(true);
  const job=(await f.store.get(run.jobKey))!;
  const seen=new Set<string>();let pages=1;
  for(let page=0;page<pages;page++){
   const report=await f.store.report(run.jobKey,page,run.reportRevision,run.result!.generatedAt);pages=report.pageCount;
   for(const game of report.result.games){const key=game.store+":"+game.appId,wanted=structuredClone(expected.get(key)!);if(game.store==="android")wanted.flags.push("latest_android_provisional");expect(game.evaluation).toEqual(wanted);expect(seen.has(key)).toBe(false);seen.add(key);}
  }
  expect(seen.size).toBe(8000);expect(job.requests).toBe(620);
  if(!process.env.SENSE_BENCHMARK_BASELINE)expect(job.readBytes).toBeLessThan(250*1024*1024);
  // Shared storage must retain historical observations outside this run's window.
  const shared=await f.store.shared([{appId:ids[0],store:"android"} as any]);await f.services.hydrate(shared[0].app);
  expect(shared[0].app.histories.US?.[shiftDate(t,-117)]).toBe(200);
  console.log("FULL_HISTORY_REPORT",JSON.stringify({candidates:20000,reports:seen.size,countries:countries.length,analysisDays:28,retainedDays:118,steps,upstreamRequests:job.requests,discoveryReadBytes:job.discoveryReadBytes,totalReadBytes:job.readBytes}));
 }finally{log.mockRestore();await f.pg.close();}
},240000);
