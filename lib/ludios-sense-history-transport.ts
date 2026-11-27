import {shiftDate} from "./ludios-sense-detection";

/** Lossless wire representation only. Stored immutable blobs and coverage stay unchanged. */
export const senseHistoryTransportSql=`SELECT cache_key,
 CASE WHEN octet_length(payload)<=$2 THEN (
  SELECT CASE WHEN doc->>'format'='4' THEN
   ((doc-'histories') || jsonb_build_object('historyTransport',1,'histories',coalesce((
    SELECT jsonb_object_agg(c.key,jsonb_build_object('start',dates.first,'days',coalesce((
     SELECT jsonb_agg(jsonb_build_array(d.key::date-dates.first::date,d.value) ORDER BY d.key)
     FROM jsonb_each(c.value) d),'[]'::jsonb)))
    FROM jsonb_each(doc->'histories') c
    CROSS JOIN LATERAL (SELECT min(key) AS first FROM jsonb_each(c.value)) dates
   ),'{}'::jsonb)))::text ELSE payload END
  FROM (SELECT payload::jsonb AS doc) source
 ) ELSE NULL END AS payload,octet_length(payload) AS payload_bytes,created_at,expires_at
 FROM tech_launch_readiness_cache WHERE cache_key=$1 LIMIT 1`;

export function decodeSenseHistoryTransport(payload:string):string {
 const doc=JSON.parse(payload);
 if(doc.historyTransport!==1)return payload;
 doc.histories=Object.fromEntries(Object.entries(doc.histories).map(([country,value])=>{
  const series=value as {start:string|null;days:[number,number|null][]};
  return [country,Object.fromEntries(series.days.map(([offset,value])=>[shiftDate(series.start!,offset),value]))];
 }));
 delete doc.historyTransport;
 return JSON.stringify(doc);
}
