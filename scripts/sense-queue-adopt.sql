-- Run inside BEGIN; set_config('sense.queue_adopt_key', '<exact legacy key>', true); ... COMMIT.
-- Only paused discovery/metadata checkpoints can be adopted. This never resumes either job.
DO $adopt$
DECLARE source_key text:=current_setting('sense.queue_adopt_key',true); source jsonb; source_created text; native_key text;
  filter_countries text[]; countries_json text; job_state jsonb; cursors jsonb:='{}'::jsonb; store_record record; cursor jsonb;
  requests integer; expected integer; actual integer; expiry timestamptz; stamp text; summary jsonb;
BEGIN
  IF source_key IS NULL OR source_key !~ '^sense:v1:[a-f0-9]{64}$' THEN RAISE EXCEPTION 'An exact legacy job key is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sense-queue-adopt:'||source_key,0));
  SELECT payload::jsonb,created_at,expires_at::timestamptz INTO source,source_created,expiry FROM cerebral.tech_launch_readiness_cache WHERE cache_key=source_key FOR SHARE;
  IF source IS NULL OR source->>'status'<>'running' OR expiry<=now() THEN RAISE EXCEPTION 'Source is not an unexpired running checkpoint'; END IF;
  IF NOT EXISTS(SELECT 1 FROM cerebral.tech_launch_readiness_cache WHERE cache_key=source_key||':paused' AND payload='true' AND expires_at>to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN RAISE EXCEPTION 'Source must already be paused'; END IF;
  IF EXISTS(SELECT 1 FROM cerebral.tech_launch_readiness_cache WHERE cache_key IN(source_key||':lease','sense:worker:'||source_key) AND expires_at>to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN RAISE EXCEPTION 'Source still has an active worker lease'; END IF;
  IF source ? 'result' OR EXISTS(SELECT 1 FROM jsonb_each(source->'stores') s WHERE s.value->>'phase' NOT IN ('discovery','metadata') OR coalesce((s.value->>'historyIndex')::integer,0)<>0) THEN RAISE EXCEPTION 'Only discovery/metadata checkpoints with no completed history are supported'; END IF;
  IF NOT EXISTS(SELECT 1 FROM cerebral.tech_launch_readiness_cache WHERE cache_key='sense:queue-bootstrap:v1' AND payload::jsonb->>'status'='ready') THEN RAISE EXCEPTION 'Bootstrap the shared app index first'; END IF;
  SELECT array_agg(country ORDER BY country COLLATE "C"),'['||string_agg(to_json(country)::text,',' ORDER BY country COLLATE "C")||']' INTO filter_countries,countries_json FROM jsonb_array_elements_text(source #> '{filters,countries}') c(country);
  IF cardinality(filter_countries) NOT BETWEEN 1 AND 7 OR EXISTS(SELECT 1 FROM unnest(filter_countries) c WHERE c NOT IN ('AU','CA','DE','GB','JP','RU','US')) THEN RAISE EXCEPTION 'Invalid source countries'; END IF;
  native_key:='sense:v1:'||encode(sha256(convert_to('{"engine":1,"ruleVersion":"1.4-aggregate","date":'||to_json(source #>> '{filters,date}')::text||',"countries":'||countries_json||'}','UTF8')),'hex');
  IF EXISTS(SELECT 1 FROM cerebral.sense_queue_jobs WHERE job_key=native_key) THEN RAISE EXCEPTION 'A queue job already exists for these filters; no state was overwritten'; END IF;
  requests:=greatest((source->>'requests')::integer,coalesce((SELECT (payload::jsonb->>'requests')::integer FROM cerebral.tech_launch_readiness_cache WHERE cache_key=source_key||':summary'),0));
  FOR store_record IN SELECT key,value FROM jsonb_each(source->'stores') LOOP
    cursor:=jsonb_build_object('phase',store_record.value->>'phase','rankingDate',store_record.value->>'rankingDate','watermark',store_record.value->>'watermark','offset',coalesce((store_record.value->>'offset')::integer,0),
      'datesFound',coalesce((store_record.value->>'datesFound')::integer,0),'daysChecked',coalesce((store_record.value->>'daysChecked')::integer,0),'lastDownloads',coalesce(store_record.value->'lastDownloads','9007199254740991'::jsonb),
      'candidates',jsonb_array_length(store_record.value->'candidateIds'),'metadata',0,'history',0,'reports',0);
    cursors:=cursors||jsonb_build_object(store_record.key,cursor);
  END LOOP;
  job_state:=jsonb_build_object('engine',1,'filters',source->'filters','status','running','store',source->>'store','stores',cursors,'retry',0,
    'progress','Prepared from the paused legacy scan. Review before resuming.','legacyReadBytes',coalesce((source->>'databaseReadBytes')::bigint,0),
    'legacySource',jsonb_build_object('jobKey',source_key,'snapshotCreatedAt',source_created,'requestsAtAdoption',requests));
  INSERT INTO cerebral.sense_queue_jobs(job_key,report_date,countries,rule_version,state,requests,paused,safety_reason,expires_at)
    VALUES(native_key,(source #>> '{filters,date}')::date,filter_countries,'1.4-aggregate',job_state,requests,true,'Legacy resource stop: review the queue trial before resuming',expiry);
  WITH stores AS (SELECT key AS store,value AS state FROM jsonb_each(source->'stores')),
  selected AS (SELECT store,jsonb_array_elements_text(state->'candidateIds') AS app_id FROM stores),
  apps AS (
    SELECT store,a.key AS app_id,a.value AS app FROM stores CROSS JOIN LATERAL jsonb_each(coalesce(state->'apps','{}'::jsonb)) a
    UNION ALL
    SELECT store,a.key,a.value FROM stores CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(state->'appPages','[]'::jsonb)) refs(ref)
    JOIN cerebral.tech_launch_readiness_cache p ON p.cache_key=refs.ref CROSS JOIN LATERAL jsonb_each(p.payload::jsonb) a
  )
  INSERT INTO cerebral.sense_queue_candidates(job_key,store,app_id,discovered_date,payload)
    SELECT native_key,s.store,s.app_id,(a.app->>'discoveredDate')::date,a.app FROM selected s JOIN apps a ON a.store=s.store AND a.app_id=s.app_id;
  GET DIAGNOSTICS actual=ROW_COUNT;
  expected:=jsonb_array_length(source #> '{stores,android,candidateIds}')+jsonb_array_length(source #> '{stores,ios,candidateIds}');
  IF actual<>expected THEN RAISE EXCEPTION 'Incomplete candidate import: expected %, found %',expected,actual; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(source->'receipts','[]'::jsonb)) r WHERE r->'parameters' ? 'auth_token') THEN RAISE EXCEPTION 'Unexpected token in source receipt'; END IF;
  INSERT INTO cerebral.sense_queue_attempts(request_id,job_key,endpoint,parameters,started_at)
    SELECT 'legacy:'||source_key||':'||ordinality,native_key,r.value->>'endpoint',r.value->'parameters',(r.value->>'retrievedAt')::timestamptz FROM jsonb_array_elements(coalesce(source->'receipts','[]'::jsonb)) WITH ORDINALITY r(value,ordinality);
  stamp:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  summary:=jsonb_build_object('queueEngine',1,'jobKey',native_key,'status','running','requests',requests,'progress',job_state->>'progress','paused',true,'reportPageCount',0);
  INSERT INTO cerebral.tech_launch_readiness_cache(cache_key,payload,created_at,expires_at) VALUES
    (native_key||':summary',summary::text,stamp,to_char(expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    (native_key||':paused','true',stamp,to_char(expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$adopt$;
