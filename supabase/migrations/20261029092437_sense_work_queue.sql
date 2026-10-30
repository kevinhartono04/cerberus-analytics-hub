-- Additive private storage. No legacy cache/checkpoint/report is modified.
CREATE TABLE cerebral.sense_queue_jobs (
  job_key text PRIMARY KEY,
  report_date date NOT NULL,
  countries text[] NOT NULL,
  rule_version text NOT NULL,
  state jsonb NOT NULL CHECK (octet_length(state::text) <= 16384),
  revision bigint NOT NULL DEFAULT 0,
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  read_bytes bigint NOT NULL DEFAULT 0 CHECK (read_bytes >= 0),
  discovery_read_bytes bigint NOT NULL DEFAULT 0 CHECK (discovery_read_bytes >= 0),
  paused boolean NOT NULL DEFAULT false,
  safety_reason text,
  lease_token text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (job_key ~ '^sense:v1:[a-f0-9]{64}$')
);
CREATE INDEX sense_queue_jobs_reports ON cerebral.sense_queue_jobs(report_date,rule_version);
CREATE TABLE cerebral.sense_queue_apps (
  store text NOT NULL CHECK (store IN ('android','ios')),
  app_id text NOT NULL,
  discovered_date date NOT NULL,
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 65536),
  version bigint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (store,app_id)
);
CREATE INDEX sense_queue_apps_recent ON cerebral.sense_queue_apps(discovered_date,store);
CREATE TABLE cerebral.sense_queue_candidates (
  job_key text NOT NULL REFERENCES cerebral.sense_queue_jobs(job_key),
  store text NOT NULL CHECK (store IN ('android','ios')),
  app_id text NOT NULL,
  discovered_date date NOT NULL,
  stage text NOT NULL DEFAULT 'metadata' CHECK (stage IN ('metadata','history','finalize','reported','excluded')),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 65536),
  weeks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_array_length(weeks)<=4),
  week_index integer NOT NULL DEFAULT 0,
  result jsonb CHECK (octet_length(result::text) <= 262144),
  sort_rank integer,
  sort_added double precision,
  sort_growth double precision,
  PRIMARY KEY (job_key,store,app_id)
);
CREATE INDEX sense_queue_candidates_work ON cerebral.sense_queue_candidates(job_key,store,stage,app_id COLLATE "C");
CREATE INDEX sense_queue_candidates_history ON cerebral.sense_queue_candidates(job_key,store,stage,week_index,(jsonb_array_length(weeks)),(weeks::text),app_id COLLATE "C") WHERE stage='history';
CREATE INDEX sense_queue_candidates_reports ON cerebral.sense_queue_candidates(job_key,sort_rank,sort_added DESC,sort_growth DESC,app_id COLLATE "C",store) WHERE result IS NOT NULL;
CREATE INDEX sense_queue_candidates_detections ON cerebral.sense_queue_candidates(job_key,store,app_id)
  WHERE result->>'classification'='included' AND result #>> '{evaluation,signal}' IN ('confirmed_momentum','early_warning');
CREATE TABLE cerebral.sense_queue_attempts (
  request_id text PRIMARY KEY,
  job_key text NOT NULL REFERENCES cerebral.sense_queue_jobs(job_key),
  endpoint text NOT NULL,
  parameters jsonb NOT NULL CHECK (octet_length(parameters::text)<=8192),
  started_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sense_queue_attempts_job ON cerebral.sense_queue_attempts(job_key,started_at);
ALTER TABLE cerebral.sense_queue_jobs OWNER TO cerebral_app;
ALTER TABLE cerebral.sense_queue_apps OWNER TO cerebral_app;
ALTER TABLE cerebral.sense_queue_candidates OWNER TO cerebral_app;
ALTER TABLE cerebral.sense_queue_attempts OWNER TO cerebral_app;
ALTER TABLE cerebral.sense_queue_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cerebral.sense_queue_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE cerebral.sense_queue_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cerebral.sense_queue_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cerebral.sense_queue_jobs,cerebral.sense_queue_apps,cerebral.sense_queue_candidates,cerebral.sense_queue_attempts FROM PUBLIC,anon,authenticated,service_role;
