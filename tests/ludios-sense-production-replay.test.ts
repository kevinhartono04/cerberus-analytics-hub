// @vitest-environment node
import {expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import {queueFixture} from "./helpers/sense-queue-postgres";
import type {SenseFilters,SenseRunResponse} from "@/lib/ludios-sense-types";
import type {QueueApp} from "@/lib/ludios-sense-queue-types";
// Licensed source data stays in an explicit local file; CI uses the synthetic full-scale replay.
const path=process.env.SENSE_QUEUE_REPLAY_FIXTURE;
it.skipIf(!path)("replays the paused production discovery prefix without any upstream calls",async()=>{
 const fixture=await queueFixture(),log=vi.spyOn(console,"info").mockImplementation(()=>{});
 try{
  const source=JSON.parse(readFileSync(path!,"utf8")) as {metadata:{filters:SenseFilters;android_cursor:{rankingDate:string;offset:number;watermark:string;datesFound:number;daysChecked:number};requests:string};seeds:{store:string;appId:string;discoveredDate:string}[];expected:{android:string[];ios:string[]};cache:Record<string,unknown>;reconstructed:unknown[]};
  fixture.services.now=()=>"2026-10-29T08:23:20.000Z";
  for(const [key,value] of Object.entries(source.cache))fixture.cache.set(key,value);
  fixture.provider(async()=>{throw new Error("Replay attempted a paid upstream request");});
  for(let offset=0;offset<source.seeds.length;offset+=500){
   const rows=source.seeds.slice(offset,offset+500).map(seed=>({store:seed.store,app_id:seed.appId,discovered_date:seed.discoveredDate,payload:{appId:seed.appId,name:seed.appId,publisher:"",categories:[],releaseDate:null,discoveredDate:seed.discoveredDate,histories:{}} satisfies QueueApp}));
   await fixture.pg.query(`INSERT INTO cerebral.sense_queue_apps(store,app_id,discovered_date,payload,expires_at)
    SELECT store,app_id,discovered_date::date,payload,now()+interval '93 days' FROM jsonb_to_recordset($1::jsonb) AS r(store text,app_id text,discovered_date text,payload jsonb)`,[JSON.stringify(rows)]);
  }
  let run:SenseRunResponse=(await fixture.engine().start(source.metadata.filters))!;let steps=0;
  for(;steps<100;steps++){
   const current=(await fixture.store.get(run.jobKey))!,s=current.state.stores.android,wanted=source.metadata.android_cursor;
   if(s.rankingDate===wanted.rankingDate&&s.offset===wanted.offset)break;
   expect(current.state.store).toBe("android");expect(s.phase).toBe("discovery");
   run=await fixture.engine().advance(run.jobKey);
   expect(fixture.calls).toHaveLength(0);
   expect(run.paused).toBe(false);expect(run.status).toBe("running");
  }
  expect(steps).toBe(73);
  const current=(await fixture.store.get(run.jobKey))!,cursor=current.state.stores.android;
  expect(cursor.watermark).toBe(source.metadata.android_cursor.watermark);
  expect(cursor.datesFound).toBe(source.metadata.android_cursor.datesFound);
  expect(cursor.daysChecked).toBe(source.metadata.android_cursor.daysChecked);
  for(const store of ["android","ios"] as const){
   const rows=await fixture.pg.query<{app_id:string}>("SELECT app_id FROM cerebral.sense_queue_candidates WHERE job_key=$1 AND store=$2 ORDER BY app_id COLLATE \"C\"",[run.jobKey,store]);
   expect(rows.rows.map(r=>r.app_id)).toEqual([...source.expected[store]].sort());
  }
  expect(fixture.calls).toHaveLength(0);expect(current.discoveryReadBytes).toBeLessThan(10*1024*1024);
  console.log("PRODUCTION_DISCOVERY_REPLAY",JSON.stringify({steps,seedCandidates:source.seeds.length,android:source.expected.android.length,ios:source.expected.ios.length,discoveryReadBytes:current.discoveryReadBytes,requests:fixture.calls.length,exactCachedResponses:72,inferredEmptyResponses:source.reconstructed.length}));
 }finally{log.mockRestore();await fixture.pg.close();}
},60000);
