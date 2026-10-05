-- One-time additive merge after archive-neon-recovery.mjs checksum verification.
-- Existing Supabase users/specs win by ID AND normalized email/game title.
-- Archived alerts, caches, and settings stay outside runtime tables.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE cerebral.app_users, cerebral.saved_specs, cerebral.partner_access_domains,
  cerebral.partner_access_domain_apps IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE before_users ON COMMIT DROP AS SELECT * FROM cerebral.app_users;
CREATE TEMP TABLE before_specs ON COMMIT DROP AS SELECT * FROM cerebral.saved_specs;
CREATE TEMP TABLE before_domains ON COMMIT DROP AS SELECT * FROM cerebral.partner_access_domains;
CREATE TEMP TABLE before_apps ON COMMIT DROP AS SELECT * FROM cerebral.partner_access_domain_apps;

-- Restore only user-approved unexpired domain grants. Existing domain scope wins.
CREATE TEMP TABLE imported_domains ON COMMIT DROP AS
WITH added AS (
  INSERT INTO cerebral.partner_access_domains(domain,enabled,expires_at,created_by,updated_by,created_at,updated_at)
  SELECT s.domain,s.enabled,s.expires_at,s.created_by,s.updated_by,s.created_at,s.updated_at
  FROM cerebral_neon_archive_20261001.source_partner_access_domains s
  WHERE s.expires_at::timestamptz > now()
    AND NOT EXISTS (SELECT 1 FROM cerebral.partner_access_domains t
      WHERE lower(trim(t.domain))=lower(trim(s.domain)))
  ON CONFLICT DO NOTHING
  RETURNING domain,enabled,expires_at
) SELECT * FROM added;

CREATE TEMP TABLE imported_apps ON COMMIT DROP AS
WITH added AS (
  INSERT INTO cerebral.partner_access_domain_apps(domain,app_name)
  SELECT s.domain,s.app_name
  FROM cerebral_neon_archive_20261001.source_partner_access_domain_apps s
  JOIN imported_domains d USING(domain)
  ON CONFLICT DO NOTHING
  RETURNING domain,app_name
) SELECT * FROM added;

CREATE TEMP TABLE imported_users ON COMMIT DROP AS
WITH added AS (
  INSERT INTO cerebral.app_users(id,email,name,role,created_at,updated_at)
  SELECT s.id,s.email,s.name,s.role,s.created_at,s.updated_at
  FROM cerebral_neon_archive_20261001.source_app_users s
  WHERE s.role IN ('admin','editor','viewer')
    AND NOT EXISTS (SELECT 1 FROM cerebral.app_users t
      WHERE t.id=s.id OR lower(trim(t.email))=lower(trim(s.email)))
    AND NOT EXISTS (SELECT 1 FROM cerebral_neon_archive_20261001.source_app_users d
      WHERE lower(trim(d.email))=lower(trim(s.email)) AND d.id<s.id)
  ON CONFLICT DO NOTHING
  RETURNING id,email,role
) SELECT * FROM added;

CREATE TEMP TABLE imported_specs ON COMMIT DROP AS
WITH added AS (
  INSERT INTO cerebral.saved_specs(
    id,game_title,genre,status,event_count,payload_count,generated_at,saved_at,
    updated_at,payload,owner_user_id,owner_email,owner_name,app_icon_data_url)
  SELECT s.id,s.game_title,s.genre,s.status,s.event_count,s.payload_count,
    s.generated_at,s.saved_at,s.updated_at,s.payload,
    CASE WHEN owner.matches=1 THEN owner.user_id ELSE s.owner_user_id END,
    s.owner_email,s.owner_name,s.app_icon_data_url
  FROM cerebral_neon_archive_20261001.source_saved_specs s
  LEFT JOIN LATERAL (
    SELECT count(*) AS matches,min(u.id) AS user_id FROM cerebral.app_users u
    WHERE lower(trim(u.email))=lower(trim(s.owner_email))
  ) owner ON true
  WHERE NOT EXISTS (SELECT 1 FROM cerebral.saved_specs t
    WHERE t.id=s.id OR lower(trim(t.game_title))=lower(trim(s.game_title)))
  ON CONFLICT DO NOTHING
  RETURNING id,game_title,owner_user_id
) SELECT * FROM added;

DO $checks$
BEGIN
  IF EXISTS (SELECT * FROM before_users EXCEPT SELECT * FROM cerebral.app_users)
    OR EXISTS (SELECT * FROM before_specs EXCEPT SELECT * FROM cerebral.saved_specs)
    OR EXISTS (SELECT * FROM before_domains EXCEPT SELECT * FROM cerebral.partner_access_domains)
    OR EXISTS (SELECT * FROM before_apps EXCEPT SELECT * FROM cerebral.partner_access_domain_apps) THEN
    RAISE EXCEPTION 'Existing Supabase records changed; rolling back entire merge';
  END IF;
  IF EXISTS (SELECT 1 FROM cerebral.saved_specs s JOIN imported_specs i USING(id)
    WHERE s.payload::jsonb->>'id' IS DISTINCT FROM s.id) THEN
    RAISE EXCEPTION 'Imported spec payload ID mismatch';
  END IF;
END
$checks$;

CREATE TABLE cerebral_neon_archive_20261001.merge_audit AS
SELECT now() AS merged_at,jsonb_build_object(
  'existing_users_preserved',(SELECT count(*) FROM before_users),
  'existing_specs_preserved',(SELECT count(*) FROM before_specs),
  'inserted_users',coalesce((SELECT jsonb_agg(to_jsonb(u)) FROM imported_users u),'[]'::jsonb),
  'inserted_specs',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM imported_specs s),'[]'::jsonb),
  'inserted_partner_domains',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM imported_domains s),'[]'::jsonb),
  'inserted_partner_apps',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM imported_apps s),'[]'::jsonb),
  'archived_spec_conflicts',coalesce((
    SELECT jsonb_agg(jsonb_build_object('source_id',s.id,'game_title',s.game_title,'retained_id',t.id))
    FROM cerebral_neon_archive_20261001.source_saved_specs s JOIN before_specs t
    ON t.id=s.id OR lower(trim(t.game_title))=lower(trim(s.game_title))),'[]'::jsonb),
  'untouched_runtime_tables',jsonb_build_array('gameplay_alert_settings','incent_config_validator_settings',
    'gameplay_alert_states','ad_metric_alert_states','gameplay_alert_query_jobs',
    'gameplay_alert_evaluation_runs','tech_launch_readiness_cache','refund_review_jobs')
) AS report;
COMMIT;
SELECT * FROM cerebral_neon_archive_20261001.merge_audit;
