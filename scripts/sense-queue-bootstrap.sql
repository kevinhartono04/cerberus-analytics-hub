-- Execute once before enabling SENSE_QUEUE_ENGINE. The DO block is atomic.
-- Copies metadata/reference rows inside Postgres; original blobs and reports remain unchanged.
DO $bootstrap$
DECLARE source jsonb; source_created text; imported integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('sense-queue-bootstrap-v1',0));
  SELECT payload::jsonb,created_at INTO source,source_created FROM cerebral.tech_launch_readiness_cache
    WHERE cache_key='sense:history:shared:v2' AND expires_at>to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FOR SHARE;
  IF source IS NULL THEN RAISE EXCEPTION 'Shared history source is missing or expired'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(source) s CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(s.value->'appPages','[]'::jsonb)) refs(ref)
    LEFT JOIN cerebral.tech_launch_readiness_cache p ON p.cache_key=refs.ref
    WHERE s.key IN ('android','ios') AND (p.cache_key IS NULL OR octet_length(p.payload)>262144 OR p.expires_at<=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  ) THEN RAISE EXCEPTION 'A shared metadata page is missing, expired, or oversized'; END IF;
  WITH stores AS (SELECT key AS store,value AS state FROM jsonb_each(source) WHERE key IN ('android','ios')),
  apps AS (
    SELECT s.store,a.key AS app_id,a.value AS app FROM stores s CROSS JOIN LATERAL jsonb_each(coalesce(s.state->'apps','{}'::jsonb)) a
    UNION ALL
    SELECT s.store,a.key,a.value FROM stores s CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(s.state->'appPages','[]'::jsonb)) refs(ref)
    JOIN cerebral.tech_launch_readiness_cache p ON p.cache_key=refs.ref CROSS JOIN LATERAL jsonb_each(p.payload::jsonb) a
  )
  INSERT INTO cerebral.sense_queue_apps(store,app_id,discovered_date,payload,expires_at)
    SELECT store,app_id,(app->>'discoveredDate')::date,app,
      least(now()+interval '93 days',coalesce((app->>'historyRefExpiresAt')::timestamptz,now()+interval '93 days')) FROM apps
    ON CONFLICT(store,app_id) DO NOTHING;
  GET DIAGNOSTICS imported=ROW_COUNT;
  IF EXISTS (
    SELECT 1 FROM cerebral.sense_queue_apps a LEFT JOIN cerebral.tech_launch_readiness_cache b ON b.cache_key=a.payload->>'historyRef'
    WHERE a.payload ? 'historyRef' AND (b.cache_key IS NULL OR octet_length(b.payload)>262144 OR b.expires_at<=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  ) THEN RAISE EXCEPTION 'A shared history reference is missing, expired, or oversized'; END IF;
  INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at)
    VALUES('sense:queue-bootstrap:v1',jsonb_build_object('status','ready','version',1,'source','sense:history:shared:v2','sourceCreatedAt',source_created,'importedRows',imported)::text,
      to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),to_char((now()+interval '93 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at,expires_at=excluded.expires_at;
END;
$bootstrap$;
