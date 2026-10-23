/** Offline migration: one legacy row at a time, never run inside a Vercel Function. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import postgres from "postgres";
const hash = value => createHash("sha256").update(value).digest("hex");
const recordLimit = 4 * 1024 * 1024;
const historyLimit = 256 * 1024;
const now = () => new Date().toISOString();
const check = (payload,limit) => { if(Buffer.byteLength(payload)>limit) throw new Error(`Converted record exceeds ${limit} bytes; source will not be replaced.`); return payload; };

/** Emit each immutable shard before publishing the compact source record. */
export async function convertSenseRecord(key, document, emit, expiresAt) {
  const states = document.stores ?? (key.startsWith("sense:history:") ? document : null);
  if(states) for(const store of ["android","ios"]) for(const app of Object.values(states[store]?.apps ?? {})) {
    if(app.historyRef) continue;
    app.historyWindows ??= {};
    for(const country of Object.keys(app.histories ?? {})) {
      const legacy=app.countryHistory?.[country] ?? (app.countryHistory === undefined && app.backfilled && app.historyStart && app.historyEnd ? {start:app.historyStart,end:app.historyEnd,at:app.historyAt ?? ""} : null);
      app.historyWindows[country] ??= legacy ? [legacy] : [];
    }
    const payload=check(JSON.stringify(app.histories ?? {}),historyLimit);
    const ref="sense:blob:v3:"+hash(payload);
    await emit(ref,payload,expiresAt);
    app.historyRef=ref;app.historyRefExpiresAt=expiresAt;app.histories={};
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
  return check(JSON.stringify(document),recordLimit);
}

async function main() {
  const {values}=parseArgs({options:{key:{type:"string"},"backup-dir":{type:"string"},apply:{type:"boolean",default:false}}});
  if(!values.key || !/^(sense:v1:[a-f0-9]{64}|sense:history:(shared:v2|[A-Z,]+)|sense:result:sense:v1:[a-f0-9]{64}:.+)$/.test(values.key)) throw new Error("Pass --key with exactly one checkpoint, history index, or saved report key.");
  if(!process.env.CEREBRAL_DATABASE_URL) throw new Error("Run in an authorized environment with CEREBRAL_DATABASE_URL already configured; do not paste credentials into commands.");
  if(values.apply && !values["backup-dir"]) throw new Error("--apply requires --backup-dir on a private local disk.");
  const sql=postgres(process.env.CEREBRAL_DATABASE_URL,{max:1,connect_timeout:10,idle_timeout:5,connection:{application_name:"sense-offline-storage-migration",statement_timeout:15000,search_path:"cerebral,public"}});
  const lease="sense:upstream:lease",token=crypto.randomUUID();
  let locked=false;
  try {
    if(values.apply) {
      const rows=await sql`INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at) VALUES(${lease},${token},${now()},${new Date(Date.now()+3600000).toISOString()}) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at,expires_at=excluded.expires_at WHERE cerebral.tech_launch_readiness_cache.expires_at <= ${now()} RETURNING cache_key`;
      if(!rows.length) throw new Error("A scan is active. Leave schedules paused and retry after its lease expires.");locked=true;
    }
    const [row]=await sql`SELECT cache_key,payload,created_at,expires_at FROM cerebral.tech_launch_readiness_cache WHERE cache_key=${values.key}`;
    if(!row) throw new Error("Source record not found.");
    const document=JSON.parse(row.payload);
    if(document.storageVersion===3){console.log("Already migrated; no changes.");return;}
    if(values.apply) {
      const dir=resolve(values["backup-dir"]);await mkdir(dir,{recursive:true,mode:0o700});
      const stem=hash(values.key+row.created_at);
      await writeFile(resolve(dir,stem+".json"),row.payload,{mode:0o600,flag:"wx"});
      await writeFile(resolve(dir,stem+".metadata.json"),JSON.stringify({...row,payload:undefined,sha256:hash(row.payload)}),{mode:0o600,flag:"wx"});
    }
    let emitted=0,shardBytes=0;
    const expiresAt=new Date(Math.max(Date.now()+93*86400000,Date.parse(row.expires_at))).toISOString();
    const converted=await convertSenseRecord(values.key,document,async(key,payload,expiry)=>{
      emitted++;shardBytes+=Buffer.byteLength(payload);
      if(values.apply) await sql`INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at) VALUES(${key},${payload},${now()},${expiry}) ON CONFLICT(cache_key) DO UPDATE SET expires_at=greatest(tech_launch_readiness_cache.expires_at,excluded.expires_at)`;
    },expiresAt);
    if(values.apply) await sql.begin(async tx=>{
      const [owner]=await tx`SELECT payload FROM cerebral.tech_launch_readiness_cache WHERE cache_key=${lease} AND expires_at>${now()} FOR UPDATE`;
      if(owner?.payload!==token) throw new Error("Migration lease expired; source will not be replaced.");
      const rows=await tx`UPDATE cerebral.tech_launch_readiness_cache SET payload=${converted},created_at=${now()} WHERE cache_key=${values.key} AND created_at=${row.created_at} RETURNING cache_key`;
      if(!rows.length) throw new Error("Source changed during conversion; source will not be replaced.");
      if(/^sense:v1:[a-f0-9]{64}$/.test(values.key)) {
        // Keep migrated runs explicitly paused. Resumption is a separate, monitored action.
        await tx`INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at) VALUES(${values.key+":paused"},'true',${now()},${row.expires_at}) ON CONFLICT(cache_key) DO UPDATE SET payload='true',expires_at=excluded.expires_at`;
        if(document.status==="running") await tx`INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at) VALUES(${"sense:pending:"+values.key},'',${now()},${row.expires_at}) ON CONFLICT(cache_key) DO NOTHING`;
      }
    });
    console.log(JSON.stringify({applied:values.apply,sourceBytes:Buffer.byteLength(row.payload),manifestBytes:Buffer.byteLength(converted),shards:emitted,shardBytes}));
  } finally {
    if(locked) await sql`UPDATE cerebral.tech_launch_readiness_cache SET expires_at=${now()} WHERE cache_key=${lease} AND payload=${token}`;
    await sql.end();
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error(error instanceof Error ? error.message : "Migration failed");process.exitCode=1;});
