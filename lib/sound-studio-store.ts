import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import postgres from "postgres";
import {supabaseCa} from "./supabase-ca";

// Separate tables and local database; Event Studio data is never rewritten.
const ddl = `CREATE TABLE IF NOT EXISTS sound_studio_records (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)`;
let client: postgres.Sql | undefined;
let ready: Promise<void> | undefined;
function connection() {
  const url = process.env.CEREBRAL_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) {
    if (process.env.NODE_ENV === "production") throw new Error("Sound Studio database is not configured.");
    return null;
  }
  const hostname = new URL(url).hostname;
  return client ??= postgres(url, {max:1,prepare:false,connect_timeout:15,...(hostname.endsWith(".supabase.co") || hostname.endsWith(".pooler.supabase.com") ? {ssl:{ca:supabaseCa,rejectUnauthorized:true}} : {})});
}
function local(sql: string) {
  const file = process.env.SOUND_STUDIO_LOCAL_DB || path.join(process.cwd(),"data","sound-studio.sqlite");
  fs.mkdirSync(path.dirname(file),{recursive:true});
  return execFileSync("sqlite3",["-cmd",".timeout 5000","-json",file],{input:sql,encoding:"utf8",maxBuffer:8*1024*1024}).trim();
}
const quote=(v:string)=>"'"+v.replaceAll("'","''")+"'";
async function database() {
  const sql=connection();
  if(!sql){local(ddl);return null;}
  ready ??= sql.begin(async tx=>{await tx.unsafe(ddl);await tx`ALTER TABLE sound_studio_records ENABLE ROW LEVEL SECURITY`;}).then(()=>undefined).catch(e=>{ready=undefined;throw e;});
  await ready;return sql;
}
export async function readSoundRecord<T>(id:string):Promise<{revision:number;value:T}|null> {
  const sql=await database();
  const rows=sql ? await sql`SELECT revision,payload FROM sound_studio_records WHERE id=${id}` : JSON.parse(local(`SELECT revision,payload FROM sound_studio_records WHERE id=${quote(id)};`) || '[]');
  return rows[0] ? {revision:Number(rows[0].revision),value:JSON.parse(rows[0].payload)} : null;
}
// Compare-and-swap prevents two open browsers from overwriting one another.
export async function writeSoundRecord(id:string,value:unknown,expected:number):Promise<boolean> {
  const payload=JSON.stringify(value);
  if(Buffer.byteLength(payload)>3*1024*1024)throw new Error("Sound lists exceed the 3 MB metadata limit. Media must be uploaded separately.");
  const sql=await database();
  if(sql){
    const rows=expected===0 ? await sql`INSERT INTO sound_studio_records VALUES(${id},1,${payload}) ON CONFLICT(id) DO NOTHING RETURNING id` : await sql`UPDATE sound_studio_records SET revision=revision+1,payload=${payload} WHERE id=${id} AND revision=${expected} RETURNING id`;
    return rows.length===1;
  }
  const command=expected===0 ? `INSERT INTO sound_studio_records VALUES(${quote(id)},1,${quote(payload)}) ON CONFLICT(id) DO NOTHING;` : `UPDATE sound_studio_records SET revision=revision+1,payload=${quote(payload)} WHERE id=${quote(id)} AND revision=${expected};`;
  const rows=JSON.parse(local(command+' SELECT changes() AS changed;') || '[]');return rows[0]?.changed===1;
}
