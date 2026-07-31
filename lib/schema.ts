import { integer, pgTable, text } from "drizzle-orm/pg-core";

export const savedSpecs = pgTable("saved_specs", {
  id: text("id").primaryKey(),
  gameTitle: text("game_title").notNull(),
  genre: text("genre").notNull(),
  status: text("status").notNull(),
  eventCount: integer("event_count").notNull(),
  payloadCount: integer("payload_count").notNull(),
  generatedAt: text("generated_at").notNull(),
  savedAt: text("saved_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ownerUserId: text("owner_user_id"),
  ownerEmail: text("owner_email"),
  ownerName: text("owner_name"),
  payload: text("payload").notNull(),
});

export const appUsers = pgTable("app_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const techLaunchReadinessCache = pgTable("tech_launch_readiness_cache", {
  cacheKey: text("cache_key").primaryKey(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const gameplayAlertSettings = pgTable("gameplay_alert_settings", {
  id: text("id").primaryKey(),
  normalThreshold: text("normal_threshold").notNull(),
  hardThreshold: text("hard_threshold").notNull(),
  minPlayers: integer("min_players").notNull(),
  alertTargets: text("alert_targets").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

export const gameplayAlertStates = pgTable("gameplay_alert_states", {
  alertKey: text("alert_key").primaryKey(),
  appName: text("app_name").notNull(),
  platform: text("platform").notNull(),
  appVersion: text("app_version").notNull(),
  level: integer("level").notNull(),
  layoutBankId: text("layout_bank_id"),
  difficultyTier: text("difficulty_tier").notNull(),
  status: text("status").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  resolvedAt: text("resolved_at"),
  supersededAt: text("superseded_at"),
  lastFailRate: text("last_fail_rate").notNull(),
  lastReachedPlayers: integer("last_reached_players").notNull(),
  threshold: text("threshold").notNull(),
  slackOpenDeliveredAt: text("slack_open_delivered_at"),
  slackPendingDeliveredAt: text("slack_pending_delivered_at"),
  slackResolvedDeliveredAt: text("slack_resolved_delivered_at"),
});

export const gameplayAlertEvaluationRuns = pgTable("gameplay_alert_evaluation_runs", {
  id: text("id").primaryKey(),
  evaluatedAt: text("evaluated_at").notNull(),
  filters: text("filters").notNull(),
  result: text("result").notNull(),
  transitionCount: integer("transition_count").notNull(),
});

export const gameplayAlertQueryJobs = pgTable("gameplay_alert_query_jobs", {
  evaluationKey: text("evaluation_key").primaryKey(),
  jobKey: text("job_key").notNull(),
  filters: text("filters").notNull(),
  status: text("status").notNull(),
  submittedAt: text("submitted_at").notNull(),
  completedAt: text("completed_at"),
  error: text("error"),
});

export const partnerAccessDomains = pgTable("partner_access_domains", {
  domain: text("domain").primaryKey(),
  enabled: text("enabled").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const partnerAccessDomainApps = pgTable("partner_access_domain_apps", {
  domain: text("domain").notNull(),
  appName: text("app_name").notNull(),
});
