-- Fresh recovery schema from production revision 65fc3d6. No Neon data imported.
CREATE SCHEMA cerebral;
REVOKE ALL ON SCHEMA cerebral FROM PUBLIC, anon, authenticated;
SET search_path TO cerebral;

CREATE TABLE IF NOT EXISTS saved_specs (
          id TEXT PRIMARY KEY NOT NULL,
          game_title TEXT NOT NULL,
          genre TEXT NOT NULL,
          status TEXT NOT NULL,
          event_count INTEGER NOT NULL,
          payload_count INTEGER NOT NULL,
          generated_at TEXT NOT NULL,
          saved_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload TEXT NOT NULL
        );

ALTER TABLE saved_specs ADD COLUMN IF NOT EXISTS owner_user_id TEXT;

ALTER TABLE saved_specs ADD COLUMN IF NOT EXISTS owner_email TEXT;

ALTER TABLE saved_specs ADD COLUMN IF NOT EXISTS owner_name TEXT;

ALTER TABLE saved_specs ADD COLUMN IF NOT EXISTS app_icon_data_url TEXT;

CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS tech_launch_readiness_cache (
        cache_key TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS incent_config_validator_settings (
          app_name TEXT PRIMARY KEY NOT NULL,
          media_sources TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT NOT NULL
        );

CREATE TABLE IF NOT EXISTS gameplay_alert_settings (
          id TEXT PRIMARY KEY NOT NULL,
          dashboard_normal_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.4,
          dashboard_hard_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.7,
          dashboard_min_players INTEGER NOT NULL DEFAULT 100,
          dashboard_exclude_test_countries BOOLEAN NOT NULL DEFAULT FALSE,
          normal_threshold DOUBLE PRECISION NOT NULL,
          hard_threshold DOUBLE PRECISION NOT NULL,
          min_players INTEGER NOT NULL,
          exclude_test_countries BOOLEAN NOT NULL DEFAULT TRUE,
          ad_metric_z_score_threshold DOUBLE PRECISION NOT NULL DEFAULT 3,
          alert_targets TEXT NOT NULL DEFAULT '[{"appName":"stacksmash","platforms":["android","ios"],"appVersion":""}]',
          updated_at TEXT NOT NULL,
          updated_by TEXT NOT NULL
        );

ALTER TABLE gameplay_alert_settings ADD COLUMN IF NOT EXISTS dashboard_normal_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.4;

ALTER TABLE gameplay_alert_settings ADD COLUMN IF NOT EXISTS dashboard_hard_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.7;

ALTER TABLE gameplay_alert_settings ADD COLUMN IF NOT EXISTS dashboard_min_players INTEGER NOT NULL DEFAULT 100;

ALTER TABLE gameplay_alert_settings ADD COLUMN IF NOT EXISTS dashboard_exclude_test_countries BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE gameplay_alert_settings ADD COLUMN IF NOT EXISTS alert_targets TEXT;

ALTER TABLE gameplay_alert_settings ADD COLUMN IF NOT EXISTS exclude_test_countries BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE gameplay_alert_settings ALTER COLUMN exclude_test_countries SET DEFAULT TRUE;

ALTER TABLE gameplay_alert_settings ADD COLUMN IF NOT EXISTS ad_metric_z_score_threshold DOUBLE PRECISION NOT NULL DEFAULT 3;

ALTER TABLE gameplay_alert_settings ALTER COLUMN ad_metric_z_score_threshold SET DEFAULT 3;

CREATE TABLE IF NOT EXISTS ad_metric_alert_states (
          alert_key TEXT PRIMARY KEY NOT NULL,
          metric TEXT NOT NULL,
          app_name TEXT NOT NULL,
          platform TEXT NOT NULL,
          app_version TEXT NOT NULL,
          cohort_group TEXT NOT NULL DEFAULT 'all',
          status TEXT NOT NULL,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          resolved_at TEXT,
          current_value DOUBLE PRECISION NOT NULL,
          baseline_mean DOUBLE PRECISION NOT NULL,
          baseline_stddev DOUBLE PRECISION NOT NULL,
          z_score DOUBLE PRECISION NOT NULL,
          threshold DOUBLE PRECISION NOT NULL,
          slack_open_delivered_at TEXT
        );

ALTER TABLE ad_metric_alert_states ADD COLUMN IF NOT EXISTS cohort_group TEXT NOT NULL DEFAULT 'all';

CREATE TABLE IF NOT EXISTS gameplay_alert_states (
          alert_key TEXT PRIMARY KEY NOT NULL,
          alert_kind TEXT NOT NULL DEFAULT 'daily',
          app_name TEXT NOT NULL,
          platform TEXT NOT NULL,
          app_version TEXT NOT NULL,
          level INTEGER NOT NULL,
          level_id TEXT,
          layout_bank_id TEXT,
          layout_hash TEXT,
          difficulty_tier TEXT NOT NULL,
          status TEXT NOT NULL,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          resolved_at TEXT,
          superseded_at TEXT,
          last_fail_rate DOUBLE PRECISION NOT NULL,
          last_reached_players INTEGER NOT NULL,
          threshold DOUBLE PRECISION NOT NULL,
          slack_open_delivered_at TEXT,
          slack_pending_delivered_at TEXT,
          slack_resolved_delivered_at TEXT
        );

ALTER TABLE gameplay_alert_states ADD COLUMN IF NOT EXISTS layout_bank_id TEXT;

ALTER TABLE gameplay_alert_states ADD COLUMN IF NOT EXISTS level_id TEXT;

ALTER TABLE gameplay_alert_states ADD COLUMN IF NOT EXISTS alert_kind TEXT NOT NULL DEFAULT 'daily';

ALTER TABLE gameplay_alert_states ADD COLUMN IF NOT EXISTS layout_hash TEXT;

ALTER TABLE gameplay_alert_states ADD COLUMN IF NOT EXISTS superseded_at TEXT;

ALTER TABLE gameplay_alert_states ADD COLUMN IF NOT EXISTS slack_pending_delivered_at TEXT;

CREATE TABLE IF NOT EXISTS gameplay_alert_evaluation_runs (
          id TEXT PRIMARY KEY NOT NULL,
          evaluated_at TEXT NOT NULL,
          filters TEXT NOT NULL,
          result TEXT NOT NULL,
          transition_count INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'cron'
        );

CREATE TABLE IF NOT EXISTS gameplay_alert_query_jobs (
          evaluation_key TEXT PRIMARY KEY NOT NULL,
          job_key TEXT NOT NULL,
          filters TEXT NOT NULL,
          status TEXT NOT NULL,
          submitted_at TEXT NOT NULL,
          completed_at TEXT,
          slack_status_delivered_at TEXT,
          error TEXT
        );

ALTER TABLE gameplay_alert_evaluation_runs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'cron';

ALTER TABLE gameplay_alert_query_jobs ADD COLUMN IF NOT EXISTS slack_status_delivered_at TEXT;

CREATE TABLE IF NOT EXISTS partner_access_domains (
          domain TEXT PRIMARY KEY NOT NULL,
          enabled TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

CREATE TABLE IF NOT EXISTS partner_access_domain_apps (
          domain TEXT NOT NULL,
          app_name TEXT NOT NULL,
          PRIMARY KEY (domain, app_name)
        );

ALTER TABLE saved_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_launch_readiness_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE incent_config_validator_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gameplay_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_metric_alert_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE gameplay_alert_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE gameplay_alert_evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gameplay_alert_query_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_access_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_access_domain_apps ENABLE ROW LEVEL SECURITY;
