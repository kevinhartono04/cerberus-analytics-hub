import {historyWindows,type StoredSenseHistory} from "./ludios-sense-history";
import {shiftDate} from "./ludios-sense-detection";
import type {SenseCountry} from "./ludios-sense-types";

/** A run-local copy; never replaces the shared/archive snapshot. Missing stays missing. */
export function selectSenseHistoryWindow(app:StoredSenseHistory,countries:SenseCountry[],end:string):StoredSenseHistory {
  const start=shiftDate(end,-27);
  return {
    histories:Object.fromEntries(countries.map(country=>[country,Object.fromEntries(Object.entries(app.histories[country] ?? {}).filter(([date])=>date>=start&&date<=end))])),
    historyWindows:Object.fromEntries(countries.map(country=>[country,historyWindows(app,country).filter(w=>w.end>=start&&w.start<=end).map(w=>({...w,start:w.start<start?start:w.start,end:w.end>end?end:w.end}))])),
  };
}

// Fixed SQL with bound parameters: key, byte limit, countries, start, end.
// Keep the original size guard before JSON parsing. Projection happens in Postgres,
// not after transporting the whole blob. Old plain-country blobs remain readable.
export const senseHistoryWindowSql=`SELECT cache_key,
 CASE WHEN octet_length(payload)<=$2 THEN (
  SELECT jsonb_build_object('format',4,'histories',coalesce((
   SELECT jsonb_object_agg(c.key,coalesce((SELECT jsonb_object_agg(d.key,d.value)
     FROM jsonb_each(c.value) d WHERE d.key BETWEEN $4 AND $5),'{}'::jsonb))
   FROM jsonb_each(CASE WHEN doc->>'format'='4' THEN doc->'histories' ELSE doc END) c
   WHERE c.key=ANY($3::text[])),'{}'::jsonb),
   'historyWindows',CASE WHEN doc ? 'historyWindows' THEN coalesce((
    SELECT jsonb_object_agg(c.key,coalesce((SELECT jsonb_agg(w.value || jsonb_build_object('start',greatest(w.value->>'start',$4),'end',least(w.value->>'end',$5)) ORDER BY w.ordinality)
     FROM jsonb_array_elements(c.value) WITH ORDINALITY w(value,ordinality)
     WHERE w.value->>'end'>=$4 AND w.value->>'start'<=$5),'[]'::jsonb))
    FROM jsonb_each(doc->'historyWindows') c WHERE c.key=ANY($3::text[])),'{}'::jsonb) ELSE NULL END,
   'countryHistory',doc->'countryHistory')::text
  FROM (SELECT payload::jsonb AS doc) source
 ) ELSE NULL END AS payload,octet_length(payload) AS payload_bytes,created_at,expires_at
 FROM tech_launch_readiness_cache WHERE cache_key=$1 LIMIT 1`;
