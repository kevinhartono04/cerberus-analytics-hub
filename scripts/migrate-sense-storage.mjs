/** Offline migration: one legacy row at a time, never run inside a Vercel Function. */
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { encodeHistory, pageSenseManifest } from "../lib/ludios-sense-codec.mjs";
import { migrationBatchSql } from "./sense-migration-batch.mjs";
import { supabaseCa } from "../lib/supabase-ca.ts";
const hash = value => createHash("sha256").update(value).digest("hex");
const recordLimit = 4 * 1024 * 1024;
const historyLimit = 256 * 1024;
const now = () => new Date().toISOString();
const check = (payload,limit) => { if(Buffer.byteLength(payload)>limit) throw new Error(`Converted record is ${Buffer.byteLength(payload)} bytes and exceeds ${limit} bytes; source will not be replaced.`); return payload; };

/** Emit each immutable shard before publishing the compact source record. */
export async function convertSenseRecord(key, document, emit, expiresAt) {
  const states = document.stores ?? (key.startsWith("sense:history:") ? document : null);
  if(states) for(const store of ["android","ios"]) for(const app of Object.values(states[store]?.apps ?? {})) {
    if(app.historyRef) continue;
    const encoded=encodeHistory(app);
    const payload=check(encoded.payload,historyLimit);
    const ref="sense:blob:v4:"+hash(payload);
    await emit(ref,payload,expiresAt);
    app.historyRef=ref;app.historyRefExpiresAt=expiresAt;app.histories={};app.historyWindows=encoded.coverage;delete app.countryHistory;
  }
  if(document.result) {
    const jobKey=document.jobKey ?? /^sense:result:(sense:v1:[a-f0-9]{64}):/.exec(key)?.[1];
    if(!jobKey || !document.result.generatedAt) throw new Error("Report is missing its immutable identity; source will not be replaced.");
    for(const game of document.result.games) {
      if(game.historyLoaded===false) continue;
      const ref="sense:chart:v3:"+hash(JSON.stringify([jobKey,document.result.generatedAt,game.store,game.appId]));
      await emit(ref,check(JSON.stringify(game),historyLimit),expiresAt);
      game.history=[];game.historyLoaded=false;
    }
  }
  document.storageVersion=3;
  return check(JSON.stringify(await pageSenseManifest(document,emit,expiresAt)),recordLimit);
}

async function main() {
  const {values}=parseArgs({options:{key:{type:"string"},"backup-dir":{type:"string"},"verified-cache":{type:"string"},apply:{type:"boolean",default:false},stage:{type:"boolean",default:false},verify:{type:"boolean",default:false},publish:{type:"boolean",default:false}}});
  if(!values.key || !/^(sense:v1:[a-f0-9]{64}(?::summary)?|sense:history:(shared:v2|[A-Z,]+)|sense:result:sense:v1:[a-f0-9]{64}:.+)$/.test(values.key)) throw new Error("Pass --key with exactly one checkpoint, history index, or saved report key.");
  if(!process.env.CEREBRAL_DATABASE_URL) throw new Error("Run in an authorized environment with CEREBRAL_DATABASE_URL already configured; do not paste credentials into commands.");
  if(values.apply && !values["backup-dir"]) throw new Error("--apply requires --backup-dir on a private local disk.");
  if(values.apply && !values.stage && !values.publish)throw new Error("Choose --stage or --publish explicitly with --apply");
  if(values.publish && !values.apply)throw new Error("--publish requires --apply");
  if(values.verify && values.publish)throw new Error("Choose verify or publish, not both");
  if(values.stage && (values.verify || values.publish))throw new Error("Choose stage or verify/publish, not both");
  const sql=postgres(process.env.CEREBRAL_DATABASE_URL,{max:1,prepare:false,ssl:{ca:supabaseCa,rejectUnauthorized:true},connect_timeout:10,idle_timeout:0});
  const lease="sense:upstream:lease",token=crypto.randomUUID();
  let locked=false;
  const cachePath=values.stage && values["verified-cache"] ? resolve(values["verified-cache"]) : null;
  let verifiedCache={};
  if(cachePath)try{verifiedCache=JSON.parse(await readFile(cachePath,"utf8"));}catch(error){if(error.code!=="ENOENT")throw error;}

  try {
    if(values.apply) {
      const rows=await sql`INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at) VALUES(${lease},${token},${now()},${new Date(Date.now()+3600000).toISOString()}) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at,expires_at=excluded.expires_at WHERE cerebral.tech_launch_readiness_cache.expires_at <= ${now()} RETURNING cache_key`;
      if(!rows.length) throw new Error("A scan is active. Leave schedules paused and retry after its lease expires.");locked=true;
    }
    const [metadata]=await sql`SELECT cache_key,created_at,expires_at,octet_length(payload) AS bytes FROM cerebral.tech_launch_readiness_cache WHERE cache_key=${values.key}`;
    if(!metadata)throw new Error("Source record not found.");
    const stageKey="sense:migration:v4:"+hash(values.key);
    let stage;
    if(values.verify || values.publish) {
      const [existing]=await sql`SELECT payload FROM cerebral.tech_launch_readiness_cache WHERE cache_key=${stageKey}`;
      if(!existing)throw new Error("No staged conversion found");
      stage=JSON.parse(existing.payload);
      if(stage.sourceKey!==values.key)throw new Error("Staged source identity differs");
      if(stage.sourceCreatedAt!==metadata.created_at){
        const [current]=await sql`SELECT CASE WHEN octet_length(payload)<=${recordLimit} THEN payload ELSE NULL END AS payload FROM cerebral.tech_launch_readiness_cache WHERE cache_key=${values.key}`;
        if(current?.payload!==stage.payload)throw new Error("Source changed since staging");
        if(values.publish){console.log(JSON.stringify({alreadyPublished:true,key:values.key}));return;}
        if(!values["backup-dir"])throw new Error("Verifying a published record requires its original --backup-dir");
        metadata.created_at=stage.sourceCreatedAt;metadata.expires_at=stage.sourceExpiresAt;
      }
    }
    if(values.stage) {
      const [existing]=await sql`SELECT payload FROM cerebral.tech_launch_readiness_cache WHERE cache_key=${stageKey}`;
      if(existing && JSON.parse(existing.payload).sourceCreatedAt===metadata.created_at){console.log(JSON.stringify({alreadyStaged:true,key:values.key}));return;}
    }
    let row;
    const dir=values["backup-dir"] ? resolve(values["backup-dir"]) : null;
    const stem=hash(values.key+metadata.created_at);
    if(dir) {
      try {
        const audit=JSON.parse(await readFile(resolve(dir,stem+".metadata.json"),"utf8"));
        const payload=await readFile(resolve(dir,stem+".json"),"utf8");
        if(hash(payload)!==audit.sha256)throw new Error("Backup checksum mismatch");
        row={...metadata,payload};
      } catch(error){if(error.code!=="ENOENT")throw error;}
    }
    row ??= (await sql`SELECT cache_key,payload,created_at,expires_at FROM cerebral.tech_launch_readiness_cache WHERE cache_key=${values.key}`)[0];
    if(!row) throw new Error("Source record not found.");
    const document=JSON.parse(row.payload);
    if(document.storageVersion===3){console.log("Already migrated; no changes.");return;}
    if(values["backup-dir"]) {
      await mkdir(dir,{recursive:true,mode:0o700});
      for(const [file,content] of [[stem+".json",row.payload],[stem+".metadata.json",JSON.stringify({...row,payload:undefined,sha256:hash(row.payload)})]]) {
        try{await writeFile(resolve(dir,file),content,{mode:0o600,flag:"wx"});}catch(error){if(error.code!=="EEXIST")throw error;}
      }
    }
    let emitted=0,shardBytes=0;
    if(stage && stage.sourceSha256!==hash(row.payload))throw new Error("Source checksum differs from staged backup");
    const stagedDocument=stage ? JSON.parse(stage.payload) : null;
    const expiresAt=stage?.shardExpiresAt ?? stagedDocument?.android?.appPagesExpiresAt ?? stagedDocument?.stores?.android?.appPagesExpiresAt ?? new Date(Math.max((Math.floor(Date.now()/86400000)+94)*86400000,Date.parse(row.expires_at))).toISOString();
    const states=document.stores ?? (values.key.startsWith("sense:history:") ? document : null);
    if(states) console.log(JSON.stringify({apps:Object.fromEntries(["android","ios"].map(store=>[store,Object.keys(states[store]?.apps ?? {}).length]))}));
    let pending=new Map(),pendingBytes=0;const seen=new Set();let written=0,lastReported=-512;
    async function flush(){
      if(!pending.size)return;
      const batch=[...pending.values()];
      if(written-lastReported>=512){console.log(JSON.stringify({progress:written,batch:batch.length}));lastReported=written;}
      async function writeBatch(batch,canSplit=true){
      const phase="write/checksum";
      try{
        let results;
        try{results=await sql.unsafe(migrationBatchSql(batch,{write:!stage})).simple();}
        catch(error){await sql.unsafe('ROLLBACK').simple();throw error;}
        const checks=results.flat().filter(row=>row.cache_key);
        const actual=new Map(checks.map(r=>[r.cache_key,r]));
        for(const item of batch){const found=actual.get(item.cache_key);if(!found || found.checksum!==hash(item.payload) || found.expires_at<item.expires_at)throw new Error("Shard verification failed: "+item.cache_key);}
      }catch(error){
        if(error.code==="57014" && canSplit && batch.length>1){
          console.log(JSON.stringify({retrySmallerBatch:true,phase,rows:batch.length}));
          const middle=Math.ceil(batch.length/2);await writeBatch(batch.slice(0,middle),false);await writeBatch(batch.slice(middle),false);
        } else throw new Error(`Migration batch ${phase} failed: ${error.message}`,{cause:error});
      }
      }
      await writeBatch(batch);
      if(cachePath)for(const item of batch)verifiedCache[item.cache_key]={checksum:hash(item.payload),expiresAt:item.expires_at};
      written+=batch.length;pending=new Map();pendingBytes=0;
    }
    const converted=await convertSenseRecord(values.key,document,async(key,payload,expiry)=>{
      emitted++;shardBytes+=Buffer.byteLength(payload);
      const cached=verifiedCache[key];
      if(cachePath && cached?.checksum===hash(payload) && cached.expiresAt>=expiry)return;
      if((values.apply || values.verify) && !seen.has(key)) {
        seen.add(key);pending.set(key,{cache_key:key,payload,created_at:now(),expires_at:expiry});pendingBytes+=Buffer.byteLength(payload);
        if(pending.size>=256 || pendingBytes>=(stage ? 4*1024*1024 : 512*1024))await flush();
      }
    },expiresAt);
    if(values.apply || values.verify)await flush();
    if(stage && converted!==stage.payload)throw new Error("Staged manifest differs from verified conversion");
    if(values.verify){console.log(JSON.stringify({verified:true,key:values.key,shards:written}));return;}
    if(values.apply && values.stage) {
      const staged=JSON.stringify({sourceKey:values.key,sourceCreatedAt:row.created_at,sourceSha256:hash(row.payload),sourceExpiresAt:row.expires_at,shardExpiresAt:expiresAt,payload:converted});
      await sql.begin(async tx=>{
        await tx`SET LOCAL statement_timeout=15000`;
        await tx`INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at) VALUES(${stageKey},${staged},${now()},${expiresAt}) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at,expires_at=excluded.expires_at`;
      });
      console.log(JSON.stringify({staged:true,key:values.key,sourceBytes:Buffer.byteLength(row.payload),manifestBytes:Buffer.byteLength(converted),shards:emitted,written,shardBytes}));return;
    }
    if(values.apply) await sql.begin(async tx=>{
      const [owner]=await tx`SELECT payload FROM cerebral.tech_launch_readiness_cache WHERE cache_key=${lease} AND expires_at>${now()} FOR UPDATE`;
      if(owner?.payload!==token) throw new Error("Migration lease expired; source will not be replaced.");
      const rows=await tx`UPDATE cerebral.tech_launch_readiness_cache SET payload=${converted},created_at=${now()} WHERE cache_key=${values.key} AND created_at=${row.created_at} AND encode(sha256(convert_to(payload,'UTF8')),'hex')=${hash(row.payload)} RETURNING cache_key`;
      if(!rows.length) throw new Error("Source changed during conversion; source will not be replaced.");
      if(/^sense:v1:[a-f0-9]{64}$/.test(values.key)) {
        // Keep migrated runs explicitly paused. Resumption is a separate, monitored action.
        await tx`INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at) VALUES(${values.key+":paused"},'true',${now()},${row.expires_at}) ON CONFLICT(cache_key) DO UPDATE SET payload='true',expires_at=excluded.expires_at`;
        if(document.status==="running") await tx`INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at) VALUES(${"sense:pending:"+values.key},'',${now()},${row.expires_at}) ON CONFLICT(cache_key) DO NOTHING`;
        else await tx`DELETE FROM cerebral.tech_launch_readiness_cache WHERE cache_key=${"sense:pending:"+values.key}`;
      }
    });
    console.log(JSON.stringify({applied:values.apply,sourceBytes:Buffer.byteLength(row.payload),manifestBytes:Buffer.byteLength(converted),shards:emitted,shardBytes}));
  } catch(error) {console.error("Migration stopped:",error.message);throw error;} finally {

    if(locked) await sql`UPDATE cerebral.tech_launch_readiness_cache SET expires_at=${now()} WHERE cache_key=${lease} AND payload=${token}`;
    await sql.end({timeout:5});
    if(cachePath){await writeFile(cachePath+".tmp",JSON.stringify(verifiedCache),{mode:0o600});await rename(cachePath+".tmp",cachePath);}

  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error(error instanceof Error ? error.message : "Migration failed");process.exitCode=1;});
