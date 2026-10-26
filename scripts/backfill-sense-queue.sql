-- Run once after deploying queue metadata, while Sense schedules are paused.
-- Only reads the prefix of compact summaries; never reads historical checkpoints.
BEGIN;
SET LOCAL statement_timeout = '5s';
INSERT INTO cerebral.tech_launch_readiness_cache (cache_key,payload,created_at,expires_at)
SELECT 'sense:pending:' || left(cache_key,73), '', created_at, expires_at
FROM cerebral.tech_launch_readiness_cache
WHERE cache_key >= 'sense:v' AND cache_key < 'sense:w'
  AND cache_key LIKE 'sense:v1:%'
  AND length(cache_key)=81 AND right(cache_key,8)=':summary'
  AND expires_at > to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  AND left(payload,256) ~ '^\{"jobKey":"sense:v1:[a-f0-9]{64}","status":"running",'
ON CONFLICT(cache_key) DO NOTHING;
COMMIT;
