-- Persistent reservations survive failed checkpoints, worker kills and retries.
CREATE TABLE cerebral.sense_transfer_budgets (
 scope text PRIMARY KEY,
 charged_bytes bigint NOT NULL DEFAULT 0 CHECK(charged_bytes>=0),
 measured_bytes bigint NOT NULL DEFAULT 0 CHECK(measured_bytes>=0),
 processing_ms bigint NOT NULL DEFAULT 0 CHECK(processing_ms>=0),
 stalled_steps integer NOT NULL DEFAULT 0,
 stop_reason text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cerebral.sense_transfer_reservations (
 token text PRIMARY KEY,
 job_key text NOT NULL,
 day_scope text NOT NULL,
 reserved_bytes bigint NOT NULL,
 measured_bytes bigint,
 elapsed_ms bigint,
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz
);
CREATE INDEX sense_transfer_reservations_job ON cerebral.sense_transfer_reservations(job_key,created_at);
ALTER TABLE cerebral.sense_transfer_budgets OWNER TO cerebral_app;
ALTER TABLE cerebral.sense_transfer_reservations OWNER TO cerebral_app;
ALTER TABLE cerebral.sense_transfer_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cerebral.sense_transfer_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cerebral.sense_transfer_budgets,cerebral.sense_transfer_reservations FROM PUBLIC,anon,authenticated,service_role;
