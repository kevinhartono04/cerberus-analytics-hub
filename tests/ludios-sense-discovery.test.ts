// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {queueFixture,type QueueFixture} from "./helpers/sense-queue-postgres";
import mapping from "@/data/ludios-sense/genre-map.json";
import {classifySense} from "@/lib/ludios-sense-detection";
import {senseRetainedCandidatePredicate} from "@/lib/ludios-sense-discovery";
import type {SenseStore,SenseRunResponse} from "@/lib/ludios-sense-types";

let fixture:QueueFixture;
beforeEach(async()=>{fixture=await queueFixture();vi.spyOn(console,"info").mockImplementation(()=>{});});
afterEach(async()=>{vi.restoreAllMocks();await fixture.pg.close();});

it("retains every classifier-eligible category and unknown while skipping known non-games in SQL",async()=>{
 const entries=(Object.keys(mapping.category_ids) as SenseStore[]).flatMap(store=>[
  ...Object.keys(mapping.category_ids[store]).map(category=>({store,categories:[category]})),
  {store,categories:[]},{store,categories:[store==="ios"?"6000":"BUSINESS",store==="ios"?"7012":"GAME_PUZZLE"]},
  {store,categories:["unrecognised-category"]},
 ]).map((entry,index)=>({...entry,app_id:String(index),payload:{appId:String(index),name:"Fixture",publisher:"",releaseDate:null,histories:{},categories:entry.categories,discoveredDate:"2026-11-12"}}));
 await fixture.pg.query(`INSERT INTO cerebral.sense_queue_apps(store,app_id,discovered_date,payload,expires_at)
  SELECT store,app_id,'2026-11-12',payload,'2099-01-01' FROM jsonb_to_recordset($1::jsonb) AS r(store text,app_id text,payload jsonb)`,[JSON.stringify(entries)]);
 const run=(await fixture.engine().start({date:"2026-11-13",countries:["AU","CA","DE","GB","JP","RU","US"]}))!;
 const retained=(await fixture.pg.query<{app_id:string}>("SELECT app_id FROM cerebral.sense_queue_candidates WHERE job_key=$1 ORDER BY app_id",[run.jobKey])).rows.map(r=>r.app_id);
 expect(retained).toEqual(entries.filter(e=>classifySense(e.app_id,e.store,e.categories).classification!=="excluded").map(e=>e.app_id).sort());
 expect((await fixture.pg.query("SELECT count(*)::int n FROM cerebral.sense_queue_apps")).rows[0]).toEqual({n:entries.length});
});

it("honors explicit inclusion and exclusion overrides in retained filtering",async()=>{
 const result=await fixture.pg.query<{app_id:string}>(`SELECT app_id FROM (VALUES
  ('android','business','{"categories":["BUSINESS"]}'::jsonb),
  ('android','game','{"categories":["GAME_PUZZLE"]}'::jsonb)
 ) AS apps(store,app_id,payload) WHERE ${senseRetainedCandidatePredicate.replaceAll('$3','$1')}`,
 [JSON.stringify({"android:business":{status:"included"},"android:game":{status:"excluded"}})]);
 expect(result.rows).toEqual([{app_id:"business"}]);
});

it("does not reinterpret a pre-filter discovery cursor under a different ranking",async()=>{
 const run=(await fixture.engine().start({date:"2026-11-13",countries:["US"]}))!;
 await fixture.pg.query("UPDATE cerebral.sense_queue_jobs SET state=jsonb_set(state-'discoveryVersion','{stores,android,offset}','200') WHERE job_key=$1",[run.jobKey]);
 await fixture.engine().advance(run.jobKey);
 expect(fixture.calls[0].parameters.offset).toBe(200);
 expect(fixture.calls[0].parameters.app_primary_categories).toBeUndefined();
});

it("discovers both stores with broad Games filters and unchanged markets, threshold and reporting dates",async()=>{
 const countries=["AU","CA","DE","GB","JP","RU","US"] as const;
 fixture.provider(async(endpoint,p)=>endpoint.endsWith("metrics")?{data:[{app_id:"below",est_mobile_downloads:999}],meta:{total_count:1}}:{apps:[]});
 let run:SenseRunResponse=(await fixture.engine().start({date:"2026-11-13",countries:[...countries]}))!;
 for(let n=0;n<50&&run.status==="running";n++)run=await fixture.engine().advance(run.jobKey);
 expect(run.status).toBe("completed");
 const calls=fixture.calls.filter(c=>c.endpoint.endsWith("metrics"));
 expect(calls).toHaveLength(6);
 for(const {parameters:p} of calls){
  expect(p.app_primary_categories).toBe(p.devices==="android"?"game":"6014");
  expect(p.app_game_categories).toBeUndefined();expect(p.unified_app_primary_categories).toBeUndefined();
  expect(p.regions).toBe(countries.join(","));expect(p.breakdown).toBe("app_id");
  expect(p.start_date).toBe(p.end_date);expect(p.order_by).toBe("est_mobile_downloads:desc");
 }
 expect((await fixture.pg.query("SELECT count(*)::int n FROM cerebral.sense_queue_candidates")).rows[0]).toEqual({n:0});
});
