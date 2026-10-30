// @vitest-environment node
import {afterEach,beforeEach,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {queueFixture,type QueueFixture} from "./helpers/sense-queue-postgres";
import {queueKey} from "@/lib/ludios-sense-queue-types";
let f:QueueFixture;
const bootstrap=readFileSync(new URL("../scripts/sense-queue-bootstrap.sql",import.meta.url),"utf8");
const adopt=readFileSync(new URL("../scripts/sense-queue-adopt.sql",import.meta.url),"utf8");
const oldKey="sense:v1:"+"b".repeat(64),filters={date:"2026-09-28",countries:["JP","US"] as ("JP"|"US")[]};
const app={appId:"123",name:"Shared metadata",publisher:"Studio",categories:["GAME_PUZZLE"],releaseDate:null,discoveredDate:"2026-09-28",histories:{}};
async function put(key:string,value:unknown){await f.pg.query("INSERT INTO cerebral.tech_launch_readiness_cache VALUES($1,$2,$3,$4)",[key,JSON.stringify(value),"2026-09-29T03:00:00.000Z","2099-01-01T00:00:00.000Z"]);}
beforeEach(async()=>{f=await queueFixture();});
afterEach(async()=>{await f.pg.close();});
async function legacy(){
 await put("sense:history:shared:v2",{android:{apps:{"123":app}},ios:{apps:{}}});
 const cursor={phase:"discovery",rankingDate:filters.date,offset:200,datesFound:0,daysChecked:0,lastDownloads:2000,historyIndex:0,candidateIds:["123"]};
 const source={filters,store:"android",status:"running",requests:71,databaseReadBytes:418694119,stores:{android:{...cursor,apps:{"123":{...app,name:"Paused snapshot"}}},ios:{...cursor,offset:0,candidateIds:[],apps:{}}},receipts:[{endpoint:"/v1/facets/metrics",parameters:{offset:0},retrievedAt:"2026-09-29T03:00:00Z"}]};
 await put(oldKey,source);await put(oldKey+":paused",true);await put(oldKey+":summary",{requests:72,status:"running"});
 return source;
}
it("bootstraps inside Postgres, respects private-role access and preserves newer app rows",async()=>{
 await legacy();await f.pg.exec("SET ROLE cerebral_app");await f.pg.exec(bootstrap);
 const initial=await f.pg.query<{payload:typeof app}>("SELECT payload FROM cerebral.sense_queue_apps");expect(initial.rows[0].payload).toEqual(app);
 await f.pg.query("UPDATE cerebral.sense_queue_apps SET version=1,payload=jsonb_set(payload,'{name}','\"New metadata\"')");
 await f.pg.exec(bootstrap);
 expect((await f.pg.query("SELECT payload->>'name' AS name,version::integer FROM cerebral.sense_queue_apps")).rows).toEqual([{name:"New metadata",version:1}]);
 const access=await f.pg.query("SELECT has_table_privilege('anon','cerebral.sense_queue_jobs','SELECT') AS anon,has_table_privilege('authenticated','cerebral.sense_queue_candidates','SELECT') AS authenticated");
 expect(access.rows).toEqual([{anon:false,authenticated:false}]);
});
it("adopts the exact paused cursor and candidate snapshots while retaining attempts and the original checkpoint",async()=>{
 const source=await legacy();await f.pg.exec(bootstrap);
 await f.pg.query("SELECT set_config('sense.queue_adopt_key',$1,false)",[oldKey]);await f.pg.exec(adopt);
 const key=queueKey(filters),job=(await f.store.get(key))!;
 expect(job.paused).toBe(true);expect(job.safetyReason).toContain("Legacy resource stop");expect(job.requests).toBe(72);
 expect(job.state.legacyReadBytes).toBe(418694119);expect(job.readBytes).toBe(0);
 expect(job.state.stores.android.offset).toBe(200);expect(job.state.stores.android.candidates).toBe(1);
 expect((await f.store.batch(key,"android","metadata"))[0].app.name).toBe("Paused snapshot");
 const original=await f.pg.query<{payload:string}>("SELECT payload FROM cerebral.tech_launch_readiness_cache WHERE cache_key=$1",[oldKey]);
 expect(JSON.parse(original.rows[0].payload)).toEqual(source);
 await expect(f.store.pause(key,false)).rejects.toMatchObject({status:409});
 await expect(f.pg.exec(adopt)).rejects.toThrow("already exists");
 expect((await f.store.get(key))!.paused).toBe(true);
});
it("rejects an active source before creating a queue job",async()=>{
 await legacy();await f.pg.exec(bootstrap);
 await f.pg.query("UPDATE cerebral.tech_launch_readiness_cache SET payload='false' WHERE cache_key=$1",[oldKey+":paused"]);
 await f.pg.query("SELECT set_config('sense.queue_adopt_key',$1,false)",[oldKey]);
 await expect(f.pg.exec(adopt)).rejects.toThrow("already be paused");expect(await f.store.get(queueKey(filters))).toBeNull();
});
it("rolls bootstrap back if a referenced observation blob is missing",async()=>{
 await put("sense:history:shared:v2",{android:{apps:{"123":{...app,historyRef:"sense:blob:v4:"+"f".repeat(64)}}},ios:{apps:{}}});
 await expect(f.pg.exec(bootstrap)).rejects.toThrow("reference is missing");
 expect((await f.pg.query("SELECT count(*)::integer AS n FROM cerebral.sense_queue_apps")).rows).toEqual([{n:0}]);
 expect((await f.pg.query("SELECT count(*)::integer AS n FROM cerebral.tech_launch_readiness_cache WHERE cache_key='sense:queue-bootstrap:v1'")).rows).toEqual([{n:0}]);
});
it("rolls adoption back when candidate snapshots are incomplete",async()=>{
 await legacy();await f.pg.exec(bootstrap);
 await f.pg.query("UPDATE cerebral.tech_launch_readiness_cache SET payload=jsonb_set(payload::jsonb,'{stores,android,apps}','{}'::jsonb)::text WHERE cache_key=$1",[oldKey]);
 await f.pg.query("SELECT set_config('sense.queue_adopt_key',$1,false)",[oldKey]);
 await expect(f.pg.exec(adopt)).rejects.toThrow("Incomplete candidate import");expect(await f.store.get(queueKey(filters))).toBeNull();
});
