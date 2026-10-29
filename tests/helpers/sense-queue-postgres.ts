import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {SenseQueueStore} from "@/lib/ludios-sense-queue-store";
import {SenseQueueEngine,type QueueServices} from "@/lib/ludios-sense-queue-engine";
import type {QueueDatabase} from "@/lib/ludios-sense-queue-store";
import {countSenseRead} from "@/lib/ludios-sense-transfer";
import {encodeHistory} from "@/lib/ludios-sense-codec.mjs";
import {senseChartKey} from "@/lib/ludios-sense-storage";
import type {QueueApp} from "@/lib/ludios-sense-queue-types";
import type {SenseGame} from "@/lib/ludios-sense-types";

export async function queueFixture(){
  const pg=new PGlite();
  await pg.exec(`CREATE ROLE cerebral_app; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA cerebral AUTHORIZATION cerebral_app;
    CREATE TABLE cerebral.tech_launch_readiness_cache(cache_key text PRIMARY KEY,payload text NOT NULL,created_at text NOT NULL,expires_at text NOT NULL);
    ALTER TABLE cerebral.tech_launch_readiness_cache OWNER TO cerebral_app;`);
  await pg.exec(readFileSync(new URL("../../supabase/migrations/20261029092437_sense_work_queue.sql",import.meta.url),"utf8"));
  const cache=new Map<string,unknown>(),charts=new Map<string,SenseGame>(),sql:string[]=[];
  const calls:{endpoint:string;parameters:Record<string,string|number>}[]=[];
  let failCheckpoint=false;
  const wrap=(connection:Pick<PGlite,"query">):QueueDatabase=>({
    async query<T extends Record<string,unknown>>(statement:string,parameters:unknown[]=[],options?:{safetyControl?:boolean}):Promise<T[]>{
      sql.push(statement);
      if(failCheckpoint && statement.startsWith("UPDATE cerebral.sense_queue_jobs SET state=$2")){failCheckpoint=false;throw new Error("Simulated checkpoint crash");}
      const result=await connection.query<T>(statement,parameters);
      if(result.rows.length)countSenseRead(JSON.stringify(result.rows),!options?.safetyControl);
      return result.rows;
    },
    async transaction<T>(work:(database:QueueDatabase)=>Promise<T>){return pg.transaction(tx=>work(wrap(tx)));},
  });
  const database=wrap(pg),store=new SenseQueueStore(database);
  const services:QueueServices={
    async readCache<T>(key:string,_maxBytes?:number,projection?:"ranking"):Promise<T|null>{
      let value=cache.get(key);if(value===undefined)return null;
      if(projection==="ranking"){
        const row=structuredClone(value) as {retrievedAt:string;payload:{data?:Record<string,unknown>[];meta?:unknown;entities?:{app_id?:Record<string,{name?:string}>}}};
        if(Array.isArray(row.payload.data))value={retrievedAt:row.retrievedAt,payload:{meta:row.payload.meta,data:row.payload.data.map(r=>({app_id:r.app_id,est_mobile_downloads:r.est_mobile_downloads,name:r.name ?? row.payload.entities?.app_id?.[String(r.app_id)]?.name ?? null}))}};
      }
      countSenseRead(JSON.stringify(value));return structuredClone(value) as T;
    },
    async writeCache(key,value){cache.set(key,structuredClone(value));},
    async hydrate(app){
      if(app.historyRef && !Object.keys(app.histories).length){
        const saved=await services.readCache<{histories:QueueApp["histories"];historyWindows:QueueApp["historyWindows"]}>(app.historyRef);
        if(!saved)throw new Error("Saved history is unavailable");app.histories=saved.histories;app.historyWindows=saved.historyWindows;
      }
    },
    async persist(app){
      if(app.historyRef&&!Object.keys(app.histories).length)return;
      const encoded=encodeHistory(app),ref="sense:blob:v4:"+createHash("sha256").update(encoded.payload).digest("hex");
      cache.set(ref,JSON.parse(encoded.payload));app.historyRef=ref;app.historyRefExpiresAt="2099-01-01";app.histories={};app.historyWindows=encoded.coverage;delete app.countryHistory;
    },
    async chart(key,generatedAt,game){charts.set(senseChartKey(key,generatedAt,game.store,game.appId),structuredClone(game));},
    async request(endpoint,parameters){calls.push({endpoint,parameters});return provider(endpoint,parameters);},
    async reserve(){},async upstream(work){return work();},now:()=>new Date().toISOString(),
  };
  let provider:QueueServices["request"]=async(endpoint)=>{
    if(endpoint.endsWith("metrics"))return {data:[{app_id:"123",est_mobile_downloads:2000}],meta:{total_count:1},entities:{app_id:{"123":{name:"Test game"}}}};
    if(endpoint.endsWith("/apps"))return {apps:[{app_id:"123",name:"Test game",publisher_name:"Studio",categories:endpoint.includes("ios")?["7012"]:["GAME_PUZZLE"]}]};
    return [];
  };
  return {pg,database,store,services,cache,charts,calls,sql,
    engine:()=>new SenseQueueEngine(store,services),
    provider(value:QueueServices["request"]){provider=value;},
    crashCheckpoint(){failCheckpoint=true;},
  };
}
export type QueueFixture=Awaited<ReturnType<typeof queueFixture>>;
