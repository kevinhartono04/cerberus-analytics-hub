// @vitest-environment node
import type {SenseRunResponse} from "@/lib/ludios-sense-types";
import {expect,it,vi} from "vitest";
import {queueFixture} from "./helpers/sense-queue-postgres";
import {aggregateSenseHistory,classifySense,evaluateSense,shiftDate} from "@/lib/ludios-sense-detection";
import {senseCountryCodes,type SenseStore} from "@/lib/ludios-sense-types";
import type {QueueApp} from "@/lib/ludios-sense-queue-types";
import {QUEUE_DISCOVERY_LIMIT,QUEUE_RUN_LIMIT} from "@/lib/ludios-sense-queue-types";

it("replays a 20,000-candidate warm catalogue through every phase with cold worker contexts and exact detection parity",async()=>{
 const fixture=await queueFixture(),log=vi.spyOn(console,"info").mockImplementation(()=>{});
 const t="2026-09-28",now=new Date().toISOString(),countries=[...senseCountryCodes].sort() as typeof senseCountryCodes;
 const stores:SenseStore[]=["android","ios"],ids=Array.from({length:10000},(_,i)=>"scale-"+String(i).padStart(5,"0"));
 const expected=new Map<string,ReturnType<typeof evaluateSense>>();
 try{
  for(const store of stores){
   let rows:Record<string,unknown>[]=[];
   for(let i=0;i<ids.length;i++){
    const included=i%5===0;
    const histories=included?Object.fromEntries(countries.map(country=>[country,Object.fromEntries(Array.from({length:28},(_,day)=>[shiftDate(t,day-27),(day>=25?600:200)+(i%97)]))])):{};
    const app:QueueApp={appId:ids[i],name:"Game "+ids[i],publisher:"Studio "+(i%100),categories:included?(store==="ios"?["7012"]:["GAME_PUZZLE"]):["BUSINESS"],releaseDate:null,metadataAt:now,discoveredDate:t,histories,
      historyWindows:included?Object.fromEntries(countries.map(country=>[country,[{start:shiftDate(t,-27),end:t,at:now}]])):undefined};
    if(included){expected.set(store+":"+ids[i],evaluateSense(aggregateSenseHistory(histories,countries,t).history,t,null));await fixture.services.persist(app);}
    rows.push({store,app_id:ids[i],discovered_date:t,payload:app});
    if(rows.length===500||i===ids.length-1){
     await fixture.pg.query(`INSERT INTO cerebral.sense_queue_apps(store,app_id,discovered_date,payload,expires_at)
       SELECT store,app_id,discovered_date::date,payload,now()+interval '93 days' FROM jsonb_to_recordset($1::jsonb) AS r(store text,app_id text,discovered_date text,payload jsonb)`,[JSON.stringify(rows)]);rows=[];
    }
   }
  }
  fixture.provider(async(endpoint,p)=>{
   if(!endpoint.endsWith("metrics"))throw new Error("Warm replay unexpectedly requested metadata or history");
   const offset=Number(p.offset);
   return {data:ids.slice(offset,offset+200).map(id=>({app_id:id,est_mobile_downloads:2000})),meta:{total_count:ids.length}};
  });
  let run:SenseRunResponse=(await fixture.engine().start({date:t,countries}))!;let steps=0;
  while(run.status==="running"&&!run.paused&&steps++<1600)run=await fixture.engine().advance(run.jobKey);
  expect(run.status).toBe("completed");expect(run.paused).toBe(false);expect(run.requests).toBe(300);
  const job=(await fixture.store.get(run.jobKey))!;
  expect(job.state.stores.android.candidates).toBe(10000);expect(job.state.stores.ios.candidates).toBe(10000);
  expect(job.discoveryReadBytes).toBeLessThan(QUEUE_DISCOVERY_LIMIT);expect(job.readBytes).toBeLessThan(QUEUE_RUN_LIMIT);
  const seen=new Set<string>();let pages=1;
  for(let page=0;page<pages;page++){
   const report=await fixture.store.report(run.jobKey,page,run.reportRevision,run.result!.generatedAt);pages=report.pageCount;
   for(const game of report.result.games){
    const key=game.store+":"+game.appId,wanted=structuredClone(expected.get(key)!);
    if(game.store==="android")wanted.flags.push("latest_android_provisional");
    expect(game.evaluation).toEqual(wanted);expect(game.classification).toBe("included");expect(seen.has(key)).toBe(false);seen.add(key);
   }
  }
  expect(seen.size).toBe(4000);expect(seen.size).toBe(expected.size);
  const stats={candidates:20000,reports:seen.size,steps,upstreamRequests:job.requests,discoveryReadBytes:job.discoveryReadBytes,totalReadBytes:job.readBytes};
  console.log("QUEUE_WARM_REPLAY",JSON.stringify(stats));
 }finally{log.mockRestore();await fixture.pg.close();}
},120000);
