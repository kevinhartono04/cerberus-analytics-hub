import { randomUUID } from 'node:crypto';
/** One network exchange, still one bounded transaction and a server-side deadline. */
export function migrationBatchSql(batch,{write=true,rollback=false}={}) {
  if(!batch.length || batch.length>256 || (write && batch.reduce((n,r)=>n+Buffer.byteLength(r.payload ?? ""),0)>768*1024))throw new Error("Migration batch exceeds its bounded budget");
  const json=JSON.stringify(write ? batch : batch.map(({cache_key})=>({cache_key})));
  let tag;do{tag='$sense_'+randomUUID().replaceAll('-','')+'$';}while(json.includes(tag));
  const input=`SELECT * FROM jsonb_to_recordset(${tag}${json}${tag}::jsonb) AS r(cache_key text,payload text,created_at text,expires_at text)`;
  const checksum="encode(sha256(convert_to(payload,'UTF8')),'hex')";
  const written=write ? `, written AS (
    INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at)
    SELECT cache_key,payload,created_at,expires_at FROM input
    ON CONFLICT(cache_key) DO UPDATE SET expires_at=greatest(tech_launch_readiness_cache.expires_at,excluded.expires_at)
      WHERE tech_launch_readiness_cache.expires_at<excluded.expires_at
    RETURNING cache_key,${checksum} AS checksum,expires_at
  )` : '';
  const selection=write ? `SELECT * FROM written UNION ALL
    SELECT c.cache_key,encode(sha256(convert_to(c.payload,'UTF8')),'hex') AS checksum,c.expires_at
    FROM cerebral.tech_launch_readiness_cache c JOIN input i USING(cache_key)
    WHERE NOT EXISTS(SELECT 1 FROM written w WHERE w.cache_key=c.cache_key)` :
    `SELECT c.cache_key,encode(sha256(convert_to(c.payload,'UTF8')),'hex') AS checksum,c.expires_at FROM cerebral.tech_launch_readiness_cache c JOIN input i USING(cache_key)`;
  return `BEGIN; SET LOCAL statement_timeout=15000; WITH input AS (${input}) ${written} ${selection}; ${rollback ? 'ROLLBACK' : 'COMMIT'};`;
}
