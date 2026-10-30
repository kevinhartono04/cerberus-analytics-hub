import type {SenseGame,SenseRunResponse,SenseStore} from "./ludios-sense-types";
import type {QueueApp,QueueCandidate,QueueChange,QueueJob,QueueState,SharedChange} from "./ludios-sense-queue-types";
import {QUEUE_PAGE_SIZE} from "./ludios-sense-queue-types";
import {senseReadBytes} from "./ludios-sense-transfer";

type Row=Record<string,unknown>;
export interface QueueDatabase {
  query<T extends Row=Row>(statement:string,parameters?:unknown[],options?:{safetyControl?:boolean}):Promise<T[]>;
  transaction<T>(work:(database:QueueDatabase)=>Promise<T>):Promise<T>;
}
const columns="job_key,state,revision,requests,read_bytes,discovery_read_bytes,paused,safety_reason,updated_at,expires_at";
const iso=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
function job(row:Row):QueueJob {
  return {key:String(row.job_key),state:row.state as QueueState,revision:Number(row.revision),requests:Number(row.requests),readBytes:Number(row.read_bytes),discoveryReadBytes:Number(row.discovery_read_bytes),paused:Boolean(row.paused),safetyReason:row.safety_reason as string|null,updatedAt:iso(row.updated_at),expiresAt:iso(row.expires_at)};
}
function candidate(row:Row):QueueCandidate {
  return {appId:String(row.app_id),store:row.store as SenseStore,app:row.payload as QueueApp,stage:String(row.stage),weeks:row.weeks as number[],weekIndex:Number(row.week_index)};
}
export function queueProgress(current:QueueJob):SenseRunResponse & {queueEngine:1} {
  const state=current.state,reports=state.stores.android.reports+state.stores.ios.reports;
  return {queueEngine:1,jobKey:current.key,status:state.status,progress:current.safetyReason ?? state.progress,requests:current.requests,paused:current.paused,error:state.error,reportRevision:current.updatedAt,reportPageCount:state.result?Math.max(1,Math.ceil(reports/QUEUE_PAGE_SIZE)):0,
    ...(state.result?{result:{...state.result,requests:current.requests,games:[]},reportLoaded:false}:{})};
}
async function summary(database:QueueDatabase,current:QueueJob) {
  await database.query(`INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at)
    VALUES($1,$2,$3,$4) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at,expires_at=excluded.expires_at`,
    [current.key+":summary",JSON.stringify(queueProgress(current)),current.updatedAt,current.expiresAt]);
}
export class SenseQueueStore {
  constructor(readonly database:QueueDatabase){}
  async get(key:string):Promise<QueueJob|null>{
    const [row]=await this.database.query(`SELECT ${columns} FROM cerebral.sense_queue_jobs WHERE job_key=$1 AND expires_at>now()`,[key]);
    return row?job(row):null;
  }
  async create(key:string,state:QueueState,source?:string):Promise<QueueJob>{
    return this.database.transaction(async db=>{
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[key]);
      const [old]=await db.query("SELECT expires_at,lease_until FROM cerebral.sense_queue_jobs WHERE job_key=$1 FOR UPDATE",[key]);
      if(old && iso(old.expires_at)<=new Date().toISOString()){
        if(old.lease_until && iso(old.lease_until)>new Date().toISOString())throw new Error("Expired scan is busy; retry shortly");
        await db.query("DELETE FROM cerebral.sense_queue_candidates WHERE job_key=$1",[key]);
        await db.query("DELETE FROM cerebral.sense_queue_attempts WHERE job_key=$1",[key]);
        await db.query("DELETE FROM cerebral.sense_queue_jobs WHERE job_key=$1",[key]);
      }
      const [created]=await db.query(`INSERT INTO cerebral.sense_queue_jobs(job_key,report_date,countries,rule_version,state,expires_at)
        VALUES($1,$2,$3,$4,$5::jsonb,now()+interval '31 days') ON CONFLICT(job_key) DO NOTHING RETURNING job_key`,
        [key,state.filters.date,state.filters.countries,state.result?.ruleVersion ?? "1.4-aggregate",JSON.stringify(state)]);
      if(created){
        if(source){
          await db.query(`INSERT INTO cerebral.sense_queue_candidates(job_key,store,app_id,discovered_date,stage,payload)
            SELECT $1,store,app_id,discovered_date,'finalize',payload FROM cerebral.sense_queue_candidates WHERE job_key=$2 AND result IS NOT NULL`,[key,source]);
        }else{
          // Copy warm candidate snapshots within Postgres; no catalogue crosses the connection.
          await db.query(`INSERT INTO cerebral.sense_queue_candidates(job_key,store,app_id,discovered_date,payload)
            SELECT $1,store,app_id,discovered_date,payload FROM cerebral.sense_queue_apps
            WHERE discovered_date BETWEEN $2::date-30 AND $2::date AND expires_at>now()`,[key,state.stores.android.rankingDate]);
        }
        const counts=await db.query(`SELECT store,count(*)::integer AS count FROM cerebral.sense_queue_candidates WHERE job_key=$1 GROUP BY store`,[key]);
        for(const row of counts)state.stores[row.store as SenseStore].candidates=Number(row.count);
        await db.query(`UPDATE cerebral.sense_queue_jobs SET state=$2::jsonb WHERE job_key=$1`,[key,JSON.stringify(state)]);
      }
      const [row]=await db.query(`SELECT ${columns} FROM cerebral.sense_queue_jobs WHERE job_key=$1`,[key]);
      const current=job(row);await summary(db,current);return current;
    });
  }
  async claim(key:string,token:string):Promise<QueueJob|null>{
    const [row]=await this.database.query(`UPDATE cerebral.sense_queue_jobs SET lease_token=$2,lease_until=now()+interval '90 seconds'
      WHERE job_key=$1 AND NOT paused AND state->>'status'='running' AND expires_at>now() AND (lease_until IS NULL OR lease_until<=now()) RETURNING ${columns}`,[key,token]);
    return row?{...job(row),token}:null;
  }
  async release(key:string,token:string){
    await this.database.query(`UPDATE cerebral.sense_queue_jobs SET lease_until=now(),lease_token=NULL WHERE job_key=$1 AND lease_token=$2`,[key,token]);
  }
  private async owned(db:QueueDatabase,current:QueueJob){
    const [row]=await db.query(`SELECT ${columns},(lease_token=$2 AND lease_until>now()) AS owned FROM cerebral.sense_queue_jobs WHERE job_key=$1 FOR UPDATE`,[current.key,current.token]);
    if(!row || !row.owned || row.paused || Number(row.revision)!==current.revision)throw new Error("Queue checkpoint lost its lease or was paused");
    return job(row);
  }
  async pause(key:string,paused:boolean,reason?:string){
    return this.database.transaction(async db=>{
      const [row]=await db.query(`UPDATE cerebral.sense_queue_jobs SET paused=$2,safety_reason=coalesce($3,safety_reason),updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond')
        WHERE job_key=$1 AND ($2 OR safety_reason IS NULL) RETURNING ${columns}`,[key,paused,reason ?? null],{safetyControl:true});
      if(!row)throw Response.json({error:"This scan has a safety stop. Review its budget before resuming."},{status:409});
      const current=job(row);
      await db.query(`INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at,expires_at=excluded.expires_at`,[key+":paused",JSON.stringify(paused),current.updatedAt,current.expiresAt]);
      await summary(db,current);return current;
    });
  }
  async batch(key:string,store:SenseStore,stage:"metadata"|"history"|"finalize"):Promise<QueueCandidate[]>{
    const rows=stage==="history" ? await this.database.query(`WITH first AS (
      SELECT weeks,week_index FROM cerebral.sense_queue_candidates WHERE job_key=$1 AND store=$2 AND stage='history'
      ORDER BY week_index,jsonb_array_length(weeks),weeks::text,app_id COLLATE "C" LIMIT 1)
      SELECT c.app_id,c.store,c.payload,c.stage,c.weeks,c.week_index FROM cerebral.sense_queue_candidates c JOIN first f ON c.weeks=f.weeks AND c.week_index=f.week_index
      WHERE c.job_key=$1 AND c.store=$2 AND c.stage='history' ORDER BY c.app_id COLLATE "C" LIMIT 25`,[key,store]) :
      await this.database.query(`SELECT app_id,store,payload,stage,weeks,week_index FROM cerebral.sense_queue_candidates
        WHERE job_key=$1 AND store=$2 AND stage=$3 ORDER BY app_id COLLATE "C" LIMIT 25`,[key,store,stage]);
    return rows.map(candidate);
  }
  async shared(batch:QueueCandidate[]):Promise<SharedChange[]>{
    if(!batch.length)return [];
    const rows=await this.database.query(`SELECT a.store,a.app_id,a.payload,a.version FROM cerebral.sense_queue_apps a JOIN
      jsonb_to_recordset($1::jsonb) AS input(store text,app_id text) ON a.store=input.store AND a.app_id=input.app_id `,[JSON.stringify(batch.map(c=>({store:c.store,app_id:c.appId})))]);
    return batch.map(c=>{const found=rows.find(r=>r.store===c.store&&r.app_id===c.appId);return {store:c.store,appId:c.appId,app:found?found.payload as QueueApp:c.app,version:found?Number(found.version):null};});
  }
  async recordAttempt(current:QueueJob,requestId:string,endpoint:string,parameters:Record<string,string|number>){
    return this.database.transaction(async db=>{
      const fresh=await this.owned(db,current);
      if(fresh.requests>=1000)throw new Error("Sensor Tower request budget reached; coverage is incomplete.");
      await db.query(`INSERT INTO cerebral.sense_queue_attempts(request_id,job_key,endpoint,parameters) VALUES($1,$2,$3,$4::jsonb)`,[requestId,current.key,endpoint,JSON.stringify(parameters)]);
      const [row]=await db.query(`UPDATE cerebral.sense_queue_jobs SET requests=requests+1 WHERE job_key=$1 RETURNING ${columns}`,[current.key]);
      const updated=job(row);await summary(db,updated);return updated.requests;
    });
  }
  async commit(current:QueueJob,next:QueueState,changes:QueueChange[],readStart:number,options?:{ranking?:{appId:string;name:string;date:string}[];shared?:SharedChange[]}):Promise<QueueJob>{
    return this.database.transaction(async db=>{
      const fresh=await this.owned(db,current);
      if(options?.ranking?.length){
        const input=JSON.stringify(options.ranking.map(r=>({app_id:r.appId,name:r.name,discovered_date:r.date})));
        const [added]=await db.query(`WITH inserted AS (INSERT INTO cerebral.sense_queue_candidates(job_key,store,app_id,discovered_date,payload)
          SELECT $1,$2,r.app_id,r.discovered_date::date,coalesce(a.payload,jsonb_build_object('appId',r.app_id,'name',r.name,'publisher','','categories','[]'::jsonb,'releaseDate',NULL,'histories','{}'::jsonb,'discoveredDate',r.discovered_date))
          FROM jsonb_to_recordset($3::jsonb) AS r(app_id text,name text,discovered_date text)
          LEFT JOIN cerebral.sense_queue_apps a ON a.store=$2 AND a.app_id=r.app_id AND a.expires_at>now()
          ON CONFLICT(job_key,store,app_id) DO NOTHING RETURNING app_id) SELECT count(*)::integer AS count FROM inserted`,[current.key,current.state.store,input]);
        next.stores[current.state.store].candidates+=Number(added.count);
        if(next.stores[current.state.store].candidates>25000)throw new Error("Unexpected candidate limit reached");
        await db.query(`UPDATE cerebral.sense_queue_candidates c SET discovered_date=greatest(c.discovered_date,r.discovered_date::date),
          payload=jsonb_set(c.payload,'{discoveredDate}',to_jsonb(greatest(c.payload->>'discoveredDate',r.discovered_date)))
          FROM jsonb_to_recordset($3::jsonb) AS r(app_id text,name text,discovered_date text) WHERE c.job_key=$1 AND c.store=$2 AND c.app_id=r.app_id`,[current.key,current.state.store,input]);
      }
      if(changes.length){
        const rows=await db.query(`UPDATE cerebral.sense_queue_candidates c SET payload=r.payload,stage=r.stage,weeks=r.weeks,week_index=r.week_index,
          result=coalesce(r.result,c.result),sort_rank=coalesce(r.sort_rank,c.sort_rank),sort_added=coalesce(r.sort_added,c.sort_added),sort_growth=coalesce(r.sort_growth,c.sort_growth)
          FROM jsonb_to_recordset($2::jsonb) AS r(store text,app_id text,payload jsonb,stage text,weeks jsonb,week_index integer,result jsonb,sort_rank integer,sort_added double precision,sort_growth double precision)
          WHERE c.job_key=$1 AND c.store=r.store AND c.app_id=r.app_id RETURNING c.app_id`,[current.key,JSON.stringify(changes.map(c=>({store:c.store,app_id:c.appId,payload:c.app,stage:c.stage,weeks:c.weeks,week_index:c.weekIndex,...(c.result?{result:c.result,sort_rank:({confirmed_momentum:0,early_warning:1,launch_traction:2,none:3,insufficient_data:4})[c.result.evaluation.signal],sort_added:c.result.evaluation.added ?? -1,sort_growth:c.result.evaluation.growth ?? -1}:{})})))]);
        if(rows.length!==changes.length)throw new Error("Queue candidate disappeared during checkpoint");
      }
      for(const app of options?.shared ?? []){
        const rows=app.version===null ? await db.query(`INSERT INTO cerebral.sense_queue_apps(store,app_id,discovered_date,payload,expires_at)
          VALUES($1,$2,$3,$4::jsonb,least(now()+interval '93 days',coalesce($5::timestamptz,now()+interval '93 days'))) ON CONFLICT(store,app_id) DO NOTHING RETURNING app_id`,[app.store,app.appId,app.app.discoveredDate,JSON.stringify(app.app),app.app.historyRefExpiresAt ?? null]) :
          await db.query(`UPDATE cerebral.sense_queue_apps SET payload=$4::jsonb,discovered_date=$3,version=version+1,expires_at=least(now()+interval '93 days',coalesce($6::timestamptz,now()+interval '93 days'))
            WHERE store=$1 AND app_id=$2 AND version=$5 RETURNING app_id`,[app.store,app.appId,app.app.discoveredDate,JSON.stringify(app.app),app.version,app.app.historyRefExpiresAt ?? null]);
        if(rows.length!==1)throw new Error("Shared app changed; retry this checkpoint");
      }
      const delta=Math.max(0,senseReadBytes()-readStart),discovery=current.state.stores[current.state.store].phase==="discovery"?delta:0;
      const [row]=await db.query(`UPDATE cerebral.sense_queue_jobs SET state=$2::jsonb,revision=revision+1,read_bytes=read_bytes+$3,discovery_read_bytes=discovery_read_bytes+$4,
        updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') WHERE job_key=$1 RETURNING ${columns}`,[current.key,JSON.stringify(next),delta,discovery]);
      const updated=job(row);await summary(db,updated);return updated;
    });
  }
  async report(key:string,page:number,revision?:string,generatedAt?:string){
    return this.database.transaction(async db=>{
      const [row]=await db.query(`SELECT ${columns} FROM cerebral.sense_queue_jobs WHERE job_key=$1 AND expires_at>now() FOR SHARE`,[key]);
      if(!row)throw Response.json({error:"Report unavailable"},{status:404});
      const current=job(row),meta=current.state.result;
      if(!meta || revision && current.updatedAt!==revision || generatedAt && meta.generatedAt!==generatedAt)throw Response.json({error:"Report changed; reload it"},{status:409});
      const pages=Math.max(1,Math.ceil((current.state.stores.android.reports+current.state.stores.ios.reports)/QUEUE_PAGE_SIZE));
      if(!Number.isInteger(page)||page<0||page>=pages)throw Response.json({error:"Report page not found"},{status:404});
      const rows=await db.query(`SELECT result FROM cerebral.sense_queue_candidates WHERE job_key=$1 AND result IS NOT NULL
        ORDER BY sort_rank,sort_added DESC,sort_growth DESC,app_id COLLATE "C",store LIMIT $2 OFFSET $3`,[key,QUEUE_PAGE_SIZE,page*QUEUE_PAGE_SIZE]);
      return {result:{...meta,requests:current.requests,games:rows.map(r=>r.result as SenseGame)},page,pageCount:pages,revision:current.updatedAt};
    });
  }
  async detections(key:string):Promise<SenseGame[]>{
    const rows=await this.database.query(`SELECT result FROM cerebral.sense_queue_candidates WHERE job_key=$1
      AND result->>'classification'='included' AND result #>> '{evaluation,signal}' IN ('confirmed_momentum','early_warning')`,[key]);
    return rows.map(row=>row.result as SenseGame);
  }
  async observations(key:string,ids:{store:SenseStore;appId:string}[]):Promise<SenseGame[]>{
    const unique=[...new Map(ids.map(id=>[id.store+":"+id.appId,id])).values()],games:SenseGame[]=[];
    for(let offset=0;offset<unique.length;offset+=100){
      const rows=await this.database.query(`SELECT c.result FROM cerebral.sense_queue_candidates c JOIN
        jsonb_to_recordset($2::jsonb) AS input(store text,app_id text) ON c.store=input.store AND c.app_id=input.app_id
        WHERE c.job_key=$1 AND c.result IS NOT NULL`,[key,JSON.stringify(unique.slice(offset,offset+100).map(id=>({store:id.store,app_id:id.appId})))]);
      games.push(...rows.map(row=>row.result as SenseGame));
    }
    return games;
  }
  async subsetSource(filters:QueueState["filters"],ruleVersion:string):Promise<QueueJob|null>{
    const [row]=await this.database.query(`SELECT ${columns} FROM cerebral.sense_queue_jobs WHERE report_date=$1 AND countries @> $2::text[] AND rule_version=$3
      AND state->>'status'='completed' AND expires_at>now() ORDER BY coalesce((state #>> '{result,coverageComplete}')::boolean,false) DESC,cardinality(countries),updated_at DESC LIMIT 1`,[filters.date,filters.countries,ruleVersion]);
    return row?job(row):null;
  }
}
