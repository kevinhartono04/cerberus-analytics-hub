import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import postgres from "postgres";

import type {
  AppUser,
  GeneratedSpec,
  GenerationPack,
  LibraryData,
  LibraryEvent,
  LibraryPayload,
  LibrarySnapshot,
  PlatformAdPayload,
  PartnerDomainAccess,
  SavedSpecSummary,
  UserRole,
} from "@/lib/types";
import type { GameplayAlertSettings, GameplayAlertState, GameplayAlertTarget } from "@/lib/gameplay-alerts";
import type { AdMetricAlertState } from "@/lib/ad-metric-alerts";
import { generatedSpecSchema, userRoleSchema } from "@/lib/types";

const seedPath = path.join(process.cwd(), "data", "analytics_reference_library.json");
const localSqlitePath = path.join(process.cwd(), "data", "analytics.sqlite");

let cachedLibraryData: LibraryData | null = null;
let cachedSnapshot: LibrarySnapshot | null = null;
let sqlClient: postgres.Sql | null = null;
let savedSpecsTableReady: Promise<void> | null = null;
let appUsersTableReady: Promise<void> | null = null;
let techLaunchCacheTableReady: Promise<void> | null = null;
let partnerAccessTablesReady: Promise<void> | null = null;
let gameplayAlertTablesReady: Promise<void> | null = null;

function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING
  );
}

function shouldUseLocalSqlite() {
  return !getDatabaseUrl() && fs.existsSync(localSqlitePath);
}

function sqliteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqliteJsonRows<T>(sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", localSqlitePath, sql], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
  }).trim();
  return output ? (JSON.parse(output) as T[]) : [];
}

function sqliteExec(sql: string) {
  execFileSync("sqlite3", [localSqlitePath, sql], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
  });
}

function sqliteColumnExists(table: string, column: string) {
  return sqliteJsonRows<{ name: string }>(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

function asString(value: unknown) {
  return value == null ? "" : String(value);
}

function getLibraryData() {
  if (!cachedLibraryData) {
    cachedLibraryData = JSON.parse(fs.readFileSync(seedPath, "utf8")) as LibraryData;
  }
  return cachedLibraryData;
}

function getSection(section: string) {
  const rows = getLibraryData()[section as keyof LibraryData];
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

function getSql() {
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    throw new Error(
      "A Postgres connection string is required for saved spec storage. Set DATABASE_URL, POSTGRES_URL, POSTGRES_PRISMA_URL, or POSTGRES_URL_NON_POOLING in Vercel.",
    );
  }

  if (!sqlClient) {
    sqlClient = postgres(databaseUrl, { max: 1, prepare: false });
  }

  return sqlClient;
}

async function ensureSavedSpecsTable() {
  if (!savedSpecsTableReady) {
    const sql = getSql();
    savedSpecsTableReady = sql.begin(async (transaction) => {
      await transaction`
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
        )
      `;
      await transaction`ALTER TABLE saved_specs ADD COLUMN IF NOT EXISTS owner_user_id TEXT`;
      await transaction`ALTER TABLE saved_specs ADD COLUMN IF NOT EXISTS owner_email TEXT`;
      await transaction`ALTER TABLE saved_specs ADD COLUMN IF NOT EXISTS owner_name TEXT`;
    })
      .then(() => undefined)
      .catch((error) => {
        savedSpecsTableReady = null;
        throw error;
      });
  }

  await savedSpecsTableReady;
  return getSql();
}

function ensureSqliteSavedSpecsTable() {
  sqliteExec(`
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
    )
  `);
  if (!sqliteColumnExists("saved_specs", "owner_user_id")) {
    sqliteExec("ALTER TABLE saved_specs ADD COLUMN owner_user_id TEXT");
  }
  if (!sqliteColumnExists("saved_specs", "owner_email")) {
    sqliteExec("ALTER TABLE saved_specs ADD COLUMN owner_email TEXT");
  }
  if (!sqliteColumnExists("saved_specs", "owner_name")) {
    sqliteExec("ALTER TABLE saved_specs ADD COLUMN owner_name TEXT");
  }
}

async function ensureAppUsersTable() {
  if (!appUsersTableReady) {
    const sql = getSql();
    appUsersTableReady = sql`
      CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
      .then(() => undefined)
      .catch((error) => {
        appUsersTableReady = null;
        throw error;
      });
  }

  await appUsersTableReady;
  return getSql();
}

function ensureSqliteAppUsersTable() {
  sqliteExec(`
    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

async function ensureTechLaunchCacheTable() {
  if (!techLaunchCacheTableReady) {
    const sql = getSql();
    techLaunchCacheTableReady = sql`
      CREATE TABLE IF NOT EXISTS tech_launch_readiness_cache (
        cache_key TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `
      .then(() => undefined)
      .catch((error) => {
        techLaunchCacheTableReady = null;
        throw error;
      });
  }

  await techLaunchCacheTableReady;
  return getSql();
}

function ensureSqliteTechLaunchCacheTable() {
  sqliteExec(`
    CREATE TABLE IF NOT EXISTS tech_launch_readiness_cache (
      cache_key TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);
}

async function ensureGameplayAlertTables() {
  if (!gameplayAlertTablesReady) {
    const sql = getSql();
    gameplayAlertTablesReady = sql.begin(async (transaction) => {
      await transaction`
        CREATE TABLE IF NOT EXISTS gameplay_alert_settings (
          id TEXT PRIMARY KEY NOT NULL,
          normal_threshold DOUBLE PRECISION NOT NULL,
          hard_threshold DOUBLE PRECISION NOT NULL,
          min_players INTEGER NOT NULL,
          ad_metric_z_score_threshold DOUBLE PRECISION NOT NULL DEFAULT 3,
          alert_targets TEXT NOT NULL DEFAULT '[{"appName":"stacksmash","platforms":["android","ios"],"appVersion":""}]',
          updated_at TEXT NOT NULL,
          updated_by TEXT NOT NULL
        )
      `;
      await transaction`ALTER TABLE gameplay_alert_settings ADD COLUMN IF NOT EXISTS alert_targets TEXT`;
      await transaction`ALTER TABLE gameplay_alert_settings ADD COLUMN IF NOT EXISTS ad_metric_z_score_threshold DOUBLE PRECISION NOT NULL DEFAULT 3`;
      await transaction`ALTER TABLE gameplay_alert_settings ALTER COLUMN ad_metric_z_score_threshold SET DEFAULT 3`;
      await transaction`UPDATE gameplay_alert_settings SET ad_metric_z_score_threshold = 3 WHERE ad_metric_z_score_threshold = 2`;
      await transaction`UPDATE gameplay_alert_settings SET alert_targets = '[{"appName":"stacksmash","platforms":["android","ios"],"appVersion":""}]' WHERE alert_targets IS NULL`;
      // Upgrade only the historical seeded target. Admin-configured target
      // lists remain untouched, while the default now evaluates all versions.
      await transaction`UPDATE gameplay_alert_settings SET alert_targets = '[{"appName":"stacksmash","platforms":["android","ios"],"appVersion":""}]' WHERE id = 'global' AND alert_targets = '[{"appName":"stacksmash","platforms":["android","ios"],"appVersion":"0.2.0"}]'`;
      await transaction`
        CREATE TABLE IF NOT EXISTS ad_metric_alert_states (
          alert_key TEXT PRIMARY KEY NOT NULL,
          metric TEXT NOT NULL,
          app_name TEXT NOT NULL,
          platform TEXT NOT NULL,
          app_version TEXT NOT NULL,
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
        )
      `;
      await transaction`
        CREATE TABLE IF NOT EXISTS gameplay_alert_states (
          alert_key TEXT PRIMARY KEY NOT NULL,
          alert_kind TEXT NOT NULL DEFAULT 'daily',
          app_name TEXT NOT NULL,
          platform TEXT NOT NULL,
          app_version TEXT NOT NULL,
          level INTEGER NOT NULL,
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
        )
      `;
      await transaction`ALTER TABLE gameplay_alert_states ADD COLUMN IF NOT EXISTS layout_bank_id TEXT`;
      await transaction`ALTER TABLE gameplay_alert_states ADD COLUMN IF NOT EXISTS alert_kind TEXT NOT NULL DEFAULT 'daily'`;
      await transaction`ALTER TABLE gameplay_alert_states ADD COLUMN IF NOT EXISTS layout_hash TEXT`;
      await transaction`ALTER TABLE gameplay_alert_states ADD COLUMN IF NOT EXISTS superseded_at TEXT`;
      await transaction`ALTER TABLE gameplay_alert_states ADD COLUMN IF NOT EXISTS slack_pending_delivered_at TEXT`;
      await transaction`
        CREATE TABLE IF NOT EXISTS gameplay_alert_evaluation_runs (
          id TEXT PRIMARY KEY NOT NULL,
          evaluated_at TEXT NOT NULL,
          filters TEXT NOT NULL,
          result TEXT NOT NULL,
          transition_count INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'cron'
        )
      `;
      await transaction`
        CREATE TABLE IF NOT EXISTS gameplay_alert_query_jobs (
          evaluation_key TEXT PRIMARY KEY NOT NULL,
          job_key TEXT NOT NULL,
          filters TEXT NOT NULL,
          status TEXT NOT NULL,
          submitted_at TEXT NOT NULL,
          completed_at TEXT,
          slack_status_delivered_at TEXT,
          error TEXT
        )
      `;
      await transaction`ALTER TABLE gameplay_alert_evaluation_runs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'cron'`;
      await transaction`ALTER TABLE gameplay_alert_query_jobs ADD COLUMN IF NOT EXISTS slack_status_delivered_at TEXT`;
    }).then(() => undefined).catch((error) => { gameplayAlertTablesReady = null; throw error; });
  }
  await gameplayAlertTablesReady;
  return getSql();
}

function ensureSqliteGameplayAlertTables() {
  sqliteExec(`
    CREATE TABLE IF NOT EXISTS gameplay_alert_settings (
      id TEXT PRIMARY KEY NOT NULL, normal_threshold REAL NOT NULL, hard_threshold REAL NOT NULL,
      min_players INTEGER NOT NULL,
      ad_metric_z_score_threshold REAL NOT NULL DEFAULT 3,
      alert_targets TEXT NOT NULL DEFAULT '[{"appName":"stacksmash","platforms":["android","ios"],"appVersion":""}]',
      updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gameplay_alert_states (
      alert_key TEXT PRIMARY KEY NOT NULL, alert_kind TEXT NOT NULL DEFAULT 'daily', app_name TEXT NOT NULL, platform TEXT NOT NULL, app_version TEXT NOT NULL,
      level INTEGER NOT NULL, layout_bank_id TEXT, layout_hash TEXT, difficulty_tier TEXT NOT NULL, status TEXT NOT NULL, first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL, resolved_at TEXT, superseded_at TEXT, last_fail_rate REAL NOT NULL, last_reached_players INTEGER NOT NULL,
      threshold REAL NOT NULL, slack_open_delivered_at TEXT, slack_pending_delivered_at TEXT, slack_resolved_delivered_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ad_metric_alert_states (
      alert_key TEXT PRIMARY KEY NOT NULL, metric TEXT NOT NULL, app_name TEXT NOT NULL, platform TEXT NOT NULL, app_version TEXT NOT NULL,
      status TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, resolved_at TEXT,
      current_value REAL NOT NULL, baseline_mean REAL NOT NULL, baseline_stddev REAL NOT NULL, z_score REAL NOT NULL, threshold REAL NOT NULL,
      slack_open_delivered_at TEXT
    );
    CREATE TABLE IF NOT EXISTS gameplay_alert_evaluation_runs (
      id TEXT PRIMARY KEY NOT NULL, evaluated_at TEXT NOT NULL, filters TEXT NOT NULL, result TEXT NOT NULL,
      transition_count INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'cron'
    );
    CREATE TABLE IF NOT EXISTS gameplay_alert_query_jobs (
      evaluation_key TEXT PRIMARY KEY NOT NULL, job_key TEXT NOT NULL, filters TEXT NOT NULL, status TEXT NOT NULL,
      submitted_at TEXT NOT NULL, completed_at TEXT, slack_status_delivered_at TEXT, error TEXT
    );
  `);
  if (!sqliteColumnExists("gameplay_alert_settings", "alert_targets")) {
    sqliteExec("ALTER TABLE gameplay_alert_settings ADD COLUMN alert_targets TEXT");
    sqliteExec("UPDATE gameplay_alert_settings SET alert_targets = '[{\"appName\":\"stacksmash\",\"platforms\":[\"android\",\"ios\"],\"appVersion\":\"\"}]' WHERE alert_targets IS NULL");
  }
  if (!sqliteColumnExists("gameplay_alert_settings", "ad_metric_z_score_threshold")) sqliteExec("ALTER TABLE gameplay_alert_settings ADD COLUMN ad_metric_z_score_threshold REAL NOT NULL DEFAULT 3");
  sqliteExec("UPDATE gameplay_alert_settings SET ad_metric_z_score_threshold = 3 WHERE ad_metric_z_score_threshold = 2");
  sqliteExec("UPDATE gameplay_alert_settings SET alert_targets = '[{\"appName\":\"stacksmash\",\"platforms\":[\"android\",\"ios\"],\"appVersion\":\"\"}]' WHERE id = 'global' AND alert_targets = '[{\"appName\":\"stacksmash\",\"platforms\":[\"android\",\"ios\"],\"appVersion\":\"0.2.0\"}]'");
  if (!sqliteColumnExists("gameplay_alert_states", "layout_bank_id")) sqliteExec("ALTER TABLE gameplay_alert_states ADD COLUMN layout_bank_id TEXT");
  if (!sqliteColumnExists("gameplay_alert_states", "alert_kind")) sqliteExec("ALTER TABLE gameplay_alert_states ADD COLUMN alert_kind TEXT NOT NULL DEFAULT 'daily'");
  if (!sqliteColumnExists("gameplay_alert_states", "layout_hash")) sqliteExec("ALTER TABLE gameplay_alert_states ADD COLUMN layout_hash TEXT");
  if (!sqliteColumnExists("gameplay_alert_states", "superseded_at")) sqliteExec("ALTER TABLE gameplay_alert_states ADD COLUMN superseded_at TEXT");
  if (!sqliteColumnExists("gameplay_alert_states", "slack_pending_delivered_at")) sqliteExec("ALTER TABLE gameplay_alert_states ADD COLUMN slack_pending_delivered_at TEXT");
  if (!sqliteColumnExists("gameplay_alert_evaluation_runs", "source")) sqliteExec("ALTER TABLE gameplay_alert_evaluation_runs ADD COLUMN source TEXT NOT NULL DEFAULT 'cron'");
  if (!sqliteColumnExists("gameplay_alert_query_jobs", "slack_status_delivered_at")) sqliteExec("ALTER TABLE gameplay_alert_query_jobs ADD COLUMN slack_status_delivered_at TEXT");
}

async function ensurePartnerAccessTables() {
  if (!partnerAccessTablesReady) {
    const sql = getSql();
    partnerAccessTablesReady = sql.begin(async (transaction) => {
      await transaction`
        CREATE TABLE IF NOT EXISTS partner_access_domains (
          domain TEXT PRIMARY KEY NOT NULL,
          enabled TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `;
      await transaction`
        CREATE TABLE IF NOT EXISTS partner_access_domain_apps (
          domain TEXT NOT NULL,
          app_name TEXT NOT NULL,
          PRIMARY KEY (domain, app_name)
        )
      `;
    })
      .then(() => undefined)
      .catch((error) => {
        partnerAccessTablesReady = null;
        throw error;
      });
  }

  await partnerAccessTablesReady;
  return getSql();
}

function ensureSqlitePartnerAccessTables() {
  sqliteExec(`
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
  `);
}

export function getLibrarySnapshot(): LibrarySnapshot {
  if (cachedSnapshot) return cachedSnapshot;

  const events = getSection("event_catalog").map(
    (row): LibraryEvent => ({
      eventName: asString(row.event_name),
      featurePack: asString(row.feature_pack),
      category: asString(row.category),
      standardStatus: asString(row.standard_status),
      triggerDescription: asString(row.trigger_description),
      argumentType: asString(row.argument_type),
      argumentDescription: asString(row.argument_description),
      argumentExamples: asString(row.argument_examples),
      sourceCoverage: asString(row.source_coverage),
      canonicalPayloadFields: asString(row.canonical_payload_fields),
      generatorGuidance: asString(row.generator_guidance),
    }),
  );

  const payloads = getSection("payload_fields").map(
    (row): LibraryPayload => ({
      eventName: asString(row.event_name),
      featurePack: asString(row.feature_pack),
      category: asString(row.category),
      fieldName: asString(row.field_name),
      canonicalFieldName: asString(row.canonical_field_name),
      fieldDescription: asString(row.field_description),
      example: asString(row.example),
      dataType: asString(row.data_type),
      requiredness: asString(row.requiredness),
      note: asString(row.note),
      sourceLabel: asString(row.source_label),
      sourceGame: asString(row.source_game),
    }),
  );

  const generationPacks = getSection("generation_packs").map(
    (row): GenerationPack => ({
      featurePack: asString(row.feature_pack),
      applicableWhen: asString(row.applicable_when),
      recommendedEventsOrPlatformEvents: asString(row.recommended_events_or_platform_events),
      launchPriority: asString(row.launch_priority),
      notes: asString(row.notes),
    }),
  );

  const platformAdPayloads = getSection("platform_ad_payloads").map(
    (row): PlatformAdPayload => ({
      platformEventName: asString(row.platform_event_name),
      adFamily: asString(row.ad_family),
      description: asString(row.description),
      fieldName: asString(row.field_name),
      canonicalFieldName: asString(row.canonical_field_name),
      fieldDescription: asString(row.field_description),
      example: asString(row.example),
      dataType: asString(row.data_type),
      requiredness: asString(row.requiredness),
      featurePack: asString(row.feature_pack),
      sourceLabel: asString(row.source_label),
      sourceGame: asString(row.source_game),
    }),
  );

  cachedSnapshot = {
    events,
    payloads,
    generationPacks,
    governanceDecisions: getSection("governance_decisions") as Array<Record<string, string>>,
    platformAdPayloads,
    scenarios: getSection("scenario_library") as Array<Record<string, string>>,
  };
  return cachedSnapshot;
}

function specStatus(spec: GeneratedSpec) {
  if (!spec.generatedEvents.length) return "Draft";
  if (spec.generatedEvents.some((event) => event.status === "Needs changes")) return "Needs changes";
  if (spec.generatedEvents.every((event) => event.status === "Reviewed")) return "Reviewed";
  return "Draft";
}

function specPayloadCount(spec: GeneratedSpec) {
  return spec.generatedEvents.reduce((total, event) => total + event.payloadFields.length, 0) + spec.platformAdPayloads.length;
}

function rowToSavedSpecSummary(row: Record<string, unknown>): SavedSpecSummary {
  const ownerUserId = asString(row.owner_user_id);
  const ownerEmail = asString(row.owner_email);
  const ownerName = asString(row.owner_name);
  return {
    id: asString(row.id),
    gameTitle: asString(row.game_title),
    genre: asString(row.genre),
    status: asString(row.status),
    eventCount: Number(row.event_count ?? 0),
    payloadCount: Number(row.payload_count ?? 0),
    generatedAt: asString(row.generated_at),
    savedAt: asString(row.saved_at),
    updatedAt: asString(row.updated_at),
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(ownerEmail ? { ownerEmail } : {}),
    ...(ownerName ? { ownerName } : {}),
  };
}

function rowToAppUser(row: Record<string, unknown>): AppUser {
  return {
    id: asString(row.id),
    email: asString(row.email),
    name: asString(row.name),
    role: userRoleSchema.catch("viewer").parse(asString(row.role)),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function roleRank(role: UserRole) {
  return role === "admin" ? 3 : role === "editor" ? 2 : 1;
}

function syncedRole(existingRole: UserRole, configuredRole: UserRole) {
  return roleRank(configuredRole) > roleRank(existingRole) ? configuredRole : existingRole;
}

export async function listSavedSpecs(): Promise<SavedSpecSummary[]> {
  if (shouldUseLocalSqlite()) {
    ensureSqliteSavedSpecsTable();
    const rows = sqliteJsonRows<Record<string, unknown>>(`
      SELECT id, game_title, genre, status, event_count, payload_count, generated_at, saved_at, updated_at,
        owner_user_id, owner_email, owner_name
      FROM saved_specs
      ORDER BY updated_at DESC
    `);
    return rows.map((row) => rowToSavedSpecSummary(row));
  }

  const sql = await ensureSavedSpecsTable();
  const rows = await sql`
    SELECT id, game_title, genre, status, event_count, payload_count, generated_at, saved_at, updated_at,
      owner_user_id, owner_email, owner_name
    FROM saved_specs
    ORDER BY updated_at DESC
  `;
  return rows.map((row) => rowToSavedSpecSummary(row));
}

export async function getSavedSpecSummary(id: string): Promise<SavedSpecSummary | null> {
  if (shouldUseLocalSqlite()) {
    ensureSqliteSavedSpecsTable();
    const [row] = sqliteJsonRows<Record<string, unknown>>(`
      SELECT id, game_title, genre, status, event_count, payload_count, generated_at, saved_at, updated_at,
        owner_user_id, owner_email, owner_name
      FROM saved_specs
      WHERE id = ${sqliteLiteral(id)}
      LIMIT 1
    `);
    return row ? rowToSavedSpecSummary(row) : null;
  }

  const sql = await ensureSavedSpecsTable();
  const [row] = await sql`
    SELECT id, game_title, genre, status, event_count, payload_count, generated_at, saved_at, updated_at,
      owner_user_id, owner_email, owner_name
    FROM saved_specs
    WHERE id = ${id}
    LIMIT 1
  `;
  return row ? rowToSavedSpecSummary(row) : null;
}

export async function getSavedSpec(id: string): Promise<GeneratedSpec | null> {
  if (shouldUseLocalSqlite()) {
    ensureSqliteSavedSpecsTable();
    const [row] = sqliteJsonRows<{ payload: string }>(`
      SELECT payload
      FROM saved_specs
      WHERE id = ${sqliteLiteral(id)}
      LIMIT 1
    `);
    if (!row) return null;
    return generatedSpecSchema.parse(JSON.parse(row.payload));
  }

  const sql = await ensureSavedSpecsTable();
  const [row] = await sql<{ payload: string }[]>`
    SELECT payload
    FROM saved_specs
    WHERE id = ${id}
    LIMIT 1
  `;
  if (!row) return null;
  return generatedSpecSchema.parse(JSON.parse(row.payload));
}

export async function saveSpec(specInput: unknown, owner: AppUser): Promise<SavedSpecSummary> {
  const spec = generatedSpecSchema.parse(specInput);
  const existing = shouldUseLocalSqlite()
    ? (ensureSqliteSavedSpecsTable(),
      sqliteJsonRows<{ saved_at: string; owner_user_id: string | null; owner_email: string | null; owner_name: string | null }>(`
        SELECT saved_at, owner_user_id, owner_email, owner_name
        FROM saved_specs
        WHERE id = ${sqliteLiteral(spec.id)}
        LIMIT 1
      `)[0])
    : undefined;
  const now = new Date().toISOString();
  const savedAt = existing?.saved_at ?? now;
  const ownerUserId = existing ? asString(existing.owner_user_id) : owner.id;
  const ownerEmail = existing ? asString(existing.owner_email) : owner.email;
  const ownerName = existing ? asString(existing.owner_name) : owner.name;
  const status = specStatus(spec);
  const eventCount = spec.generatedEvents.length;
  const payloadCount = specPayloadCount(spec);

  if (shouldUseLocalSqlite()) {
    sqliteExec(`
      INSERT INTO saved_specs (
        id, game_title, genre, status, event_count, payload_count, generated_at, saved_at, updated_at,
        owner_user_id, owner_email, owner_name, payload
      )
      VALUES (
        ${sqliteLiteral(spec.id)},
        ${sqliteLiteral(spec.intake.gameTitle)},
        ${sqliteLiteral(spec.intake.genre)},
        ${sqliteLiteral(status)},
        ${eventCount},
        ${payloadCount},
        ${sqliteLiteral(spec.generatedAt)},
        ${sqliteLiteral(savedAt)},
        ${sqliteLiteral(now)},
        ${sqliteLiteral(ownerUserId)},
        ${sqliteLiteral(ownerEmail)},
        ${sqliteLiteral(ownerName)},
        ${sqliteLiteral(JSON.stringify(spec))}
      )
      ON CONFLICT(id) DO UPDATE SET
        game_title = excluded.game_title,
        genre = excluded.genre,
        status = excluded.status,
        event_count = excluded.event_count,
        payload_count = excluded.payload_count,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at,
        payload = excluded.payload
    `);

    return {
      id: spec.id,
      gameTitle: spec.intake.gameTitle,
      genre: spec.intake.genre,
      status,
      eventCount,
      payloadCount,
      generatedAt: spec.generatedAt,
      savedAt,
      updatedAt: now,
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(ownerEmail ? { ownerEmail } : {}),
      ...(ownerName ? { ownerName } : {}),
    };
  }

  const sql = await ensureSavedSpecsTable();
  const [postgresExisting] = await sql<
    { saved_at: string; owner_user_id: string | null; owner_email: string | null; owner_name: string | null }[]
  >`
    SELECT saved_at, owner_user_id, owner_email, owner_name
    FROM saved_specs
    WHERE id = ${spec.id}
    LIMIT 1
  `;
  const postgresSavedAt = postgresExisting?.saved_at ?? savedAt;
  const postgresOwnerUserId = postgresExisting ? asString(postgresExisting.owner_user_id) : owner.id;
  const postgresOwnerEmail = postgresExisting ? asString(postgresExisting.owner_email) : owner.email;
  const postgresOwnerName = postgresExisting ? asString(postgresExisting.owner_name) : owner.name;

  await sql`
    INSERT INTO saved_specs (
      id, game_title, genre, status, event_count, payload_count, generated_at, saved_at, updated_at,
      owner_user_id, owner_email, owner_name, payload
    )
    VALUES (
      ${spec.id},
      ${spec.intake.gameTitle},
      ${spec.intake.genre},
      ${status},
      ${eventCount},
      ${payloadCount},
      ${spec.generatedAt},
      ${postgresSavedAt},
      ${now},
      ${postgresOwnerUserId},
      ${postgresOwnerEmail},
      ${postgresOwnerName},
      ${JSON.stringify(spec)}
    )
    ON CONFLICT(id) DO UPDATE SET
      game_title = excluded.game_title,
      genre = excluded.genre,
      status = excluded.status,
      event_count = excluded.event_count,
      payload_count = excluded.payload_count,
      generated_at = excluded.generated_at,
      updated_at = excluded.updated_at,
      payload = excluded.payload
  `;

  return {
    id: spec.id,
    gameTitle: spec.intake.gameTitle,
    genre: spec.intake.genre,
    status,
    eventCount,
    payloadCount,
    generatedAt: spec.generatedAt,
    savedAt: postgresSavedAt,
    updatedAt: now,
    ...(postgresOwnerUserId ? { ownerUserId: postgresOwnerUserId } : {}),
    ...(postgresOwnerEmail ? { ownerEmail: postgresOwnerEmail } : {}),
    ...(postgresOwnerName ? { ownerName: postgresOwnerName } : {}),
  };
}

export async function syncAppUser(identity: { id: string; email: string; name: string }, initialRole: UserRole): Promise<AppUser> {
  const now = new Date().toISOString();

  if (shouldUseLocalSqlite()) {
    ensureSqliteAppUsersTable();
    let existing = sqliteJsonRows<Record<string, unknown>>(`
      SELECT id, email, name, role, created_at, updated_at
      FROM app_users
      WHERE id = ${sqliteLiteral(identity.id)}
      LIMIT 1
    `)[0];
    if (!existing) {
      existing = sqliteJsonRows<Record<string, unknown>>(`
        SELECT id, email, name, role, created_at, updated_at
        FROM app_users
        WHERE lower(email) = lower(${sqliteLiteral(identity.email)})
        LIMIT 1
      `)[0];
    }
    if (existing) {
      const role = syncedRole(userRoleSchema.catch("viewer").parse(asString(existing.role)), initialRole);
      sqliteExec(`
        UPDATE app_users
        SET id = ${sqliteLiteral(identity.id)},
          email = ${sqliteLiteral(identity.email)},
          name = ${sqliteLiteral(identity.name)},
          role = ${sqliteLiteral(role)},
          updated_at = ${sqliteLiteral(now)}
        WHERE id = ${sqliteLiteral(asString(existing.id))}
      `);
      return { ...rowToAppUser(existing), id: identity.id, email: identity.email, name: identity.name, role, updatedAt: now };
    }

    sqliteExec(`
      INSERT INTO app_users (id, email, name, role, created_at, updated_at)
      VALUES (
        ${sqliteLiteral(identity.id)},
        ${sqliteLiteral(identity.email)},
        ${sqliteLiteral(identity.name)},
        ${sqliteLiteral(initialRole)},
        ${sqliteLiteral(now)},
        ${sqliteLiteral(now)}
      )
    `);
    return { ...identity, role: initialRole, createdAt: now, updatedAt: now };
  }

  const sql = await ensureAppUsersTable();
  let [existing] = await sql<Record<string, unknown>[]>`
    SELECT id, email, name, role, created_at, updated_at
    FROM app_users
    WHERE id = ${identity.id}
    LIMIT 1
  `;
  if (!existing) {
    [existing] = await sql<Record<string, unknown>[]>`
      SELECT id, email, name, role, created_at, updated_at
      FROM app_users
      WHERE lower(email) = lower(${identity.email})
      LIMIT 1
    `;
  }
  if (existing) {
    const role = syncedRole(userRoleSchema.catch("viewer").parse(asString(existing.role)), initialRole);
    await sql`
      UPDATE app_users
      SET id = ${identity.id},
        email = ${identity.email},
        name = ${identity.name},
        role = ${role},
        updated_at = ${now}
      WHERE id = ${asString(existing.id)}
    `;
    return { ...rowToAppUser(existing), id: identity.id, email: identity.email, name: identity.name, role, updatedAt: now };
  }

  await sql`
    INSERT INTO app_users (id, email, name, role, created_at, updated_at)
    VALUES (${identity.id}, ${identity.email}, ${identity.name}, ${initialRole}, ${now}, ${now})
  `;
  return { ...identity, role: initialRole, createdAt: now, updatedAt: now };
}

export async function createInternalAppUser(input: { email: string; name: string; role: UserRole }): Promise<AppUser> {
  const email = input.email.trim().toLowerCase();
  const now = new Date().toISOString();
  const id = `pending:${email}`;

  if (shouldUseLocalSqlite()) {
    ensureSqliteAppUsersTable();
    const [existing] = sqliteJsonRows<Record<string, unknown>>(`
      SELECT id FROM app_users WHERE lower(email) = lower(${sqliteLiteral(email)}) LIMIT 1
    `);
    if (existing) throw new Error("A user with this email already exists");
    sqliteExec(`
      INSERT INTO app_users (id, email, name, role, created_at, updated_at)
      VALUES (${sqliteLiteral(id)}, ${sqliteLiteral(email)}, ${sqliteLiteral(input.name || email)}, ${sqliteLiteral(input.role)}, ${sqliteLiteral(now)}, ${sqliteLiteral(now)})
    `);
    return { id, email, name: input.name || email, role: input.role, createdAt: now, updatedAt: now };
  }

  const sql = await ensureAppUsersTable();
  const [existing] = await sql<Record<string, unknown>[]>`
    SELECT id FROM app_users WHERE lower(email) = lower(${email}) LIMIT 1
  `;
  if (existing) throw new Error("A user with this email already exists");
  await sql`
    INSERT INTO app_users (id, email, name, role, created_at, updated_at)
    VALUES (${id}, ${email}, ${input.name || email}, ${input.role}, ${now}, ${now})
  `;
  return { id, email, name: input.name || email, role: input.role, createdAt: now, updatedAt: now };
}

export async function listAppUsers(): Promise<AppUser[]> {
  if (shouldUseLocalSqlite()) {
    ensureSqliteAppUsersTable();
    const rows = sqliteJsonRows<Record<string, unknown>>(`
      SELECT id, email, name, role, created_at, updated_at
      FROM app_users
      ORDER BY email ASC
    `);
    return rows.map((row) => rowToAppUser(row));
  }

  const sql = await ensureAppUsersTable();
  const rows = await sql`
    SELECT id, email, name, role, created_at, updated_at
    FROM app_users
    ORDER BY email ASC
  `;
  return rows.map((row) => rowToAppUser(row));
}

export async function updateAppUserRole(id: string, role: UserRole): Promise<AppUser | null> {
  const now = new Date().toISOString();

  if (shouldUseLocalSqlite()) {
    ensureSqliteAppUsersTable();
    sqliteExec(`
      UPDATE app_users
      SET role = ${sqliteLiteral(role)}, updated_at = ${sqliteLiteral(now)}
      WHERE id = ${sqliteLiteral(id)}
    `);
    const row = sqliteJsonRows<Record<string, unknown>>(`
      SELECT id, email, name, role, created_at, updated_at
      FROM app_users
      WHERE id = ${sqliteLiteral(id)}
      LIMIT 1
    `)[0];
    return row ? rowToAppUser(row) : null;
  }

  const sql = await ensureAppUsersTable();
  const [row] = await sql<Record<string, unknown>[]>`
    UPDATE app_users
    SET role = ${role}, updated_at = ${now}
    WHERE id = ${id}
    RETURNING id, email, name, role, created_at, updated_at
  `;
  return row ? rowToAppUser(row) : null;
}

type PartnerDomainInput = {
  domain: string;
  enabled: boolean;
  expiresAt: string;
  allowedApps: string[];
  actorId: string;
};

function rowToPartnerDomainAccess(row: Record<string, unknown>, allowedApps: string[]): PartnerDomainAccess {
  return {
    domain: asString(row.domain),
    enabled: asString(row.enabled) === "true" || asString(row.enabled) === "1",
    expiresAt: asString(row.expires_at),
    createdBy: asString(row.created_by),
    updatedBy: asString(row.updated_by),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    allowedApps,
  };
}

async function getPartnerDomainApps(domain: string): Promise<string[]> {
  if (shouldUseLocalSqlite()) {
    ensureSqlitePartnerAccessTables();
    return sqliteJsonRows<{ app_name: string }>(`
      SELECT app_name FROM partner_access_domain_apps
      WHERE domain = ${sqliteLiteral(domain)}
      ORDER BY app_name ASC
    `).map((row) => asString(row.app_name));
  }

  const sql = await ensurePartnerAccessTables();
  const rows = await sql<{ app_name: string }[]>`
    SELECT app_name FROM partner_access_domain_apps
    WHERE domain = ${domain}
    ORDER BY app_name ASC
  `;
  return rows.map((row) => asString(row.app_name));
}

export async function getPartnerDomainAccess(domain: string): Promise<PartnerDomainAccess | null> {
  if (shouldUseLocalSqlite()) {
    ensureSqlitePartnerAccessTables();
    const [row] = sqliteJsonRows<Record<string, unknown>>(`
      SELECT domain, enabled, expires_at, created_by, updated_by, created_at, updated_at
      FROM partner_access_domains
      WHERE domain = ${sqliteLiteral(domain)}
      LIMIT 1
    `);
    return row ? rowToPartnerDomainAccess(row, await getPartnerDomainApps(domain)) : null;
  }

  const sql = await ensurePartnerAccessTables();
  const [row] = await sql<Record<string, unknown>[]>`
    SELECT domain, enabled, expires_at, created_by, updated_by, created_at, updated_at
    FROM partner_access_domains
    WHERE domain = ${domain}
    LIMIT 1
  `;
  return row ? rowToPartnerDomainAccess(row, await getPartnerDomainApps(domain)) : null;
}

export async function listPartnerDomainAccess(): Promise<PartnerDomainAccess[]> {
  if (shouldUseLocalSqlite()) {
    ensureSqlitePartnerAccessTables();
    const rows = sqliteJsonRows<Record<string, unknown>>(`
      SELECT domain, enabled, expires_at, created_by, updated_by, created_at, updated_at
      FROM partner_access_domains
      ORDER BY domain ASC
    `);
    return Promise.all(rows.map(async (row) => rowToPartnerDomainAccess(row, await getPartnerDomainApps(asString(row.domain)))));
  }

  const sql = await ensurePartnerAccessTables();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT domain, enabled, expires_at, created_by, updated_by, created_at, updated_at
    FROM partner_access_domains
    ORDER BY domain ASC
  `;
  return Promise.all(rows.map(async (row) => rowToPartnerDomainAccess(row, await getPartnerDomainApps(asString(row.domain)))));
}

export async function savePartnerDomainAccess(input: PartnerDomainInput): Promise<PartnerDomainAccess> {
  const now = new Date().toISOString();
  const allowedApps = [...new Set(input.allowedApps)].sort();

  if (shouldUseLocalSqlite()) {
    ensureSqlitePartnerAccessTables();
    const existing = getPartnerDomainAccess(input.domain);
    const existingRecord = await existing;
    sqliteExec(`
      INSERT INTO partner_access_domains (domain, enabled, expires_at, created_by, updated_by, created_at, updated_at)
      VALUES (
        ${sqliteLiteral(input.domain)},
        ${sqliteLiteral(input.enabled ? "true" : "false")},
        ${sqliteLiteral(input.expiresAt)},
        ${sqliteLiteral(existingRecord?.createdBy ?? input.actorId)},
        ${sqliteLiteral(input.actorId)},
        ${sqliteLiteral(existingRecord?.createdAt ?? now)},
        ${sqliteLiteral(now)}
      )
      ON CONFLICT(domain) DO UPDATE SET
        enabled = excluded.enabled,
        expires_at = excluded.expires_at,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `);
    sqliteExec(`DELETE FROM partner_access_domain_apps WHERE domain = ${sqliteLiteral(input.domain)}`);
    for (const appName of allowedApps) {
      sqliteExec(`
        INSERT INTO partner_access_domain_apps (domain, app_name)
        VALUES (${sqliteLiteral(input.domain)}, ${sqliteLiteral(appName)})
      `);
    }
    return (await getPartnerDomainAccess(input.domain))!;
  }

  const sql = await ensurePartnerAccessTables();
  await sql.begin(async (transaction) => {
    const [existing] = await transaction<Record<string, unknown>[]>`
      SELECT created_by, created_at FROM partner_access_domains WHERE domain = ${input.domain} LIMIT 1
    `;
    await transaction`
      INSERT INTO partner_access_domains (domain, enabled, expires_at, created_by, updated_by, created_at, updated_at)
      VALUES (
        ${input.domain},
        ${input.enabled ? "true" : "false"},
        ${input.expiresAt},
        ${existing ? asString(existing.created_by) : input.actorId},
        ${input.actorId},
        ${existing ? asString(existing.created_at) : now},
        ${now}
      )
      ON CONFLICT(domain) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        expires_at = EXCLUDED.expires_at,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at
    `;
    await transaction`DELETE FROM partner_access_domain_apps WHERE domain = ${input.domain}`;
    for (const appName of allowedApps) {
      await transaction`
        INSERT INTO partner_access_domain_apps (domain, app_name)
        VALUES (${input.domain}, ${appName})
      `;
    }
  });
  return (await getPartnerDomainAccess(input.domain))!;
}

export async function deletePartnerDomainAccess(domain: string) {
  if (shouldUseLocalSqlite()) {
    ensureSqlitePartnerAccessTables();
    const existing = await getPartnerDomainAccess(domain);
    if (!existing) return false;
    sqliteExec(`
      DELETE FROM partner_access_domain_apps WHERE domain = ${sqliteLiteral(domain)};
      DELETE FROM partner_access_domains WHERE domain = ${sqliteLiteral(domain)};
    `);
    return true;
  }

  const sql = await ensurePartnerAccessTables();
  return sql.begin(async (transaction) => {
    await transaction`DELETE FROM partner_access_domain_apps WHERE domain = ${domain}`;
    const result = await transaction`DELETE FROM partner_access_domains WHERE domain = ${domain}`;
    return result.count > 0;
  });
}

export async function deleteSavedSpec(id: string) {
  if (shouldUseLocalSqlite()) {
    ensureSqliteSavedSpecsTable();
    const [result] = sqliteJsonRows<{ count: number }>(`
      DELETE FROM saved_specs
      WHERE id = ${sqliteLiteral(id)};
      SELECT changes() AS count;
    `);
    return Number(result?.count ?? 0) > 0;
  }

  const sql = await ensureSavedSpecsTable();
  const result = await sql`
    DELETE FROM saved_specs
    WHERE id = ${id}
  `;
  return result.count > 0;
}

export type TechLaunchReadinessCacheRecord = {
  cacheKey: string;
  payload: string;
  createdAt: string;
  expiresAt: string;
};

function rowToTechLaunchCacheRecord(row: Record<string, unknown>): TechLaunchReadinessCacheRecord {
  return {
    cacheKey: asString(row.cache_key),
    payload: asString(row.payload),
    createdAt: asString(row.created_at),
    expiresAt: asString(row.expires_at),
  };
}

export async function getTechLaunchReadinessCache(cacheKey: string): Promise<TechLaunchReadinessCacheRecord | null> {
  if (shouldUseLocalSqlite()) {
    ensureSqliteTechLaunchCacheTable();
    const [row] = sqliteJsonRows<Record<string, unknown>>(`
      SELECT cache_key, payload, created_at, expires_at
      FROM tech_launch_readiness_cache
      WHERE cache_key = ${sqliteLiteral(cacheKey)}
      LIMIT 1
    `);
    return row ? rowToTechLaunchCacheRecord(row) : null;
  }

  const sql = await ensureTechLaunchCacheTable();
  const [row] = await sql<Record<string, unknown>[]>`
    SELECT cache_key, payload, created_at, expires_at
    FROM tech_launch_readiness_cache
    WHERE cache_key = ${cacheKey}
    LIMIT 1
  `;
  return row ? rowToTechLaunchCacheRecord(row) : null;
}

export async function saveTechLaunchReadinessCache(record: TechLaunchReadinessCacheRecord) {
  if (shouldUseLocalSqlite()) {
    ensureSqliteTechLaunchCacheTable();
    sqliteExec(`
      INSERT INTO tech_launch_readiness_cache (cache_key, payload, created_at, expires_at)
      VALUES (
        ${sqliteLiteral(record.cacheKey)},
        ${sqliteLiteral(record.payload)},
        ${sqliteLiteral(record.createdAt)},
        ${sqliteLiteral(record.expiresAt)}
      )
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `);
    return;
  }

  const sql = await ensureTechLaunchCacheTable();
  await sql`
    INSERT INTO tech_launch_readiness_cache (cache_key, payload, created_at, expires_at)
    VALUES (${record.cacheKey}, ${record.payload}, ${record.createdAt}, ${record.expiresAt})
    ON CONFLICT(cache_key) DO UPDATE SET
      payload = excluded.payload,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `;
}

export type GameplayAlertSettingsRecord = GameplayAlertSettings & { updatedAt: string; updatedBy: string };

export type GameplayAlertStateRecord = GameplayAlertState;
export type AdMetricAlertStateRecord = AdMetricAlertState;

export type GameplayAlertQueryJobRecord = {
  evaluationKey: string;
  jobKey: string;
  filters: string;
  status: "running" | "completed" | "error";
  submittedAt: string;
  completedAt?: string;
  /** The daily current-open Slack status has been delivered for this evaluation. */
  slackStatusDeliveredAt?: string;
  error?: string;
};

function rowToGameplayAlertSettings(row: Record<string, unknown>): GameplayAlertSettingsRecord {
  let alertTargets: GameplayAlertTarget[] = [];
  try {
    const parsed = JSON.parse(asString(row.alert_targets));
    if (Array.isArray(parsed)) alertTargets = parsed as GameplayAlertTarget[];
  } catch {
    // Invalid historical configuration should not make the dashboard unavailable.
  }
  return {
    normalThreshold: Number(row.normal_threshold), hardThreshold: Number(row.hard_threshold), minPlayers: Number(row.min_players),
    adMetricZScoreThreshold: Number(row.ad_metric_z_score_threshold ?? 3),
    alertTargets,
    updatedAt: asString(row.updated_at), updatedBy: asString(row.updated_by),
  };
}

function rowToGameplayAlertState(row: Record<string, unknown>): GameplayAlertStateRecord {
  return {
    alertKey: asString(row.alert_key), alertKind: asString(row.alert_kind) === "critical" ? "critical" : "daily", appName: asString(row.app_name), platform: asString(row.platform), appVersion: asString(row.app_version),
    level: Number(row.level), ...(asString(row.layout_bank_id) ? { layoutBankId: asString(row.layout_bank_id) } : {}), ...(asString(row.layout_hash) ? { layoutHash: asString(row.layout_hash) } : {}), difficultyTier: asString(row.difficulty_tier) === "hard" ? "hard" : "normal",
    status: asString(row.status) === "pending" || asString(row.status) === "resolved" || asString(row.status) === "superseded" ? asString(row.status) as "pending" | "resolved" | "superseded" : "open", firstSeenAt: asString(row.first_seen_at),
    lastSeenAt: asString(row.last_seen_at), ...(asString(row.resolved_at) ? { resolvedAt: asString(row.resolved_at) } : {}),
    ...(asString(row.superseded_at) ? { supersededAt: asString(row.superseded_at) } : {}),
    lastFailRate: Number(row.last_fail_rate), lastReachedPlayers: Number(row.last_reached_players), threshold: Number(row.threshold),
    ...(asString(row.slack_open_delivered_at) ? { slackOpenDeliveredAt: asString(row.slack_open_delivered_at) } : {}),
    ...(asString(row.slack_pending_delivered_at) ? { slackPendingDeliveredAt: asString(row.slack_pending_delivered_at) } : {}),
    ...(asString(row.slack_resolved_delivered_at) ? { slackResolvedDeliveredAt: asString(row.slack_resolved_delivered_at) } : {}),
  };
}

function rowToAdMetricAlertState(row: Record<string, unknown>): AdMetricAlertStateRecord {
  return {
    alertKey: asString(row.alert_key), metric: asString(row.metric) === "ripg" ? "ripg" : "fipg",
    appName: asString(row.app_name), platform: asString(row.platform), appVersion: asString(row.app_version),
    status: asString(row.status) === "resolved" ? "resolved" : "open", firstSeenAt: asString(row.first_seen_at), lastSeenAt: asString(row.last_seen_at),
    ...(asString(row.resolved_at) ? { resolvedAt: asString(row.resolved_at) } : {}), currentValue: Number(row.current_value), baselineMean: Number(row.baseline_mean), baselineStddev: Number(row.baseline_stddev), zScore: Number(row.z_score), threshold: Number(row.threshold),
    ...(asString(row.slack_open_delivered_at) ? { slackOpenDeliveredAt: asString(row.slack_open_delivered_at) } : {}),
  };
}

function rowToGameplayAlertQueryJob(row: Record<string, unknown>): GameplayAlertQueryJobRecord {
  const status = asString(row.status);
  return {
    evaluationKey: asString(row.evaluation_key), jobKey: asString(row.job_key), filters: asString(row.filters),
    status: status === "completed" || status === "error" ? status : "running",
    submittedAt: asString(row.submitted_at), ...(asString(row.completed_at) ? { completedAt: asString(row.completed_at) } : {}),
    ...(asString(row.slack_status_delivered_at) ? { slackStatusDeliveredAt: asString(row.slack_status_delivered_at) } : {}),
    ...(asString(row.error) ? { error: asString(row.error) } : {}),
  };
}

export async function getGameplayAlertSettingsRecord(): Promise<GameplayAlertSettingsRecord | null> {
  if (shouldUseLocalSqlite()) {
    ensureSqliteGameplayAlertTables();
    const [row] = sqliteJsonRows<Record<string, unknown>>(`SELECT normal_threshold, hard_threshold, min_players, ad_metric_z_score_threshold, alert_targets, updated_at, updated_by FROM gameplay_alert_settings WHERE id = 'global' LIMIT 1`);
    return row ? rowToGameplayAlertSettings(row) : null;
  }
  const sql = await ensureGameplayAlertTables();
  const [row] = await sql<Record<string, unknown>[]>`SELECT normal_threshold, hard_threshold, min_players, ad_metric_z_score_threshold, alert_targets, updated_at, updated_by FROM gameplay_alert_settings WHERE id = 'global' LIMIT 1`;
  return row ? rowToGameplayAlertSettings(row) : null;
}

export async function saveGameplayAlertSettingsRecord(record: GameplayAlertSettingsRecord) {
  if (shouldUseLocalSqlite()) {
    ensureSqliteGameplayAlertTables();
    sqliteExec(`INSERT INTO gameplay_alert_settings (id, normal_threshold, hard_threshold, min_players, ad_metric_z_score_threshold, alert_targets, updated_at, updated_by) VALUES ('global', ${record.normalThreshold}, ${record.hardThreshold}, ${record.minPlayers}, ${record.adMetricZScoreThreshold}, ${sqliteLiteral(JSON.stringify(record.alertTargets))}, ${sqliteLiteral(record.updatedAt)}, ${sqliteLiteral(record.updatedBy)}) ON CONFLICT(id) DO UPDATE SET normal_threshold = excluded.normal_threshold, hard_threshold = excluded.hard_threshold, min_players = excluded.min_players, ad_metric_z_score_threshold = excluded.ad_metric_z_score_threshold, alert_targets = excluded.alert_targets, updated_at = excluded.updated_at, updated_by = excluded.updated_by`);
    return;
  }
  const sql = await ensureGameplayAlertTables();
  await sql`INSERT INTO gameplay_alert_settings (id, normal_threshold, hard_threshold, min_players, ad_metric_z_score_threshold, alert_targets, updated_at, updated_by) VALUES ('global', ${record.normalThreshold}, ${record.hardThreshold}, ${record.minPlayers}, ${record.adMetricZScoreThreshold}, ${JSON.stringify(record.alertTargets)}, ${record.updatedAt}, ${record.updatedBy}) ON CONFLICT(id) DO UPDATE SET normal_threshold = excluded.normal_threshold, hard_threshold = excluded.hard_threshold, min_players = excluded.min_players, ad_metric_z_score_threshold = excluded.ad_metric_z_score_threshold, alert_targets = excluded.alert_targets, updated_at = excluded.updated_at, updated_by = excluded.updated_by`;
}

export async function listGameplayAlertQueryJobs(evaluationKeys: string[]): Promise<GameplayAlertQueryJobRecord[]> {
  if (!evaluationKeys.length) return [];
  if (shouldUseLocalSqlite()) {
    ensureSqliteGameplayAlertTables();
    return sqliteJsonRows<Record<string, unknown>>(`SELECT * FROM gameplay_alert_query_jobs WHERE evaluation_key IN (${evaluationKeys.map(sqliteLiteral).join(", ")})`).map(rowToGameplayAlertQueryJob);
  }
  const sql = await ensureGameplayAlertTables();
  const rows = await sql<Record<string, unknown>[]>`SELECT * FROM gameplay_alert_query_jobs WHERE evaluation_key IN ${sql(evaluationKeys)}`;
  return rows.map(rowToGameplayAlertQueryJob);
}

export async function saveGameplayAlertQueryJobRecords(records: GameplayAlertQueryJobRecord[]) {
  if (!records.length) return;
  if (shouldUseLocalSqlite()) {
    ensureSqliteGameplayAlertTables();
    for (const record of records) {
      sqliteExec(`INSERT INTO gameplay_alert_query_jobs (evaluation_key, job_key, filters, status, submitted_at, completed_at, slack_status_delivered_at, error) VALUES (${sqliteLiteral(record.evaluationKey)}, ${sqliteLiteral(record.jobKey)}, ${sqliteLiteral(record.filters)}, ${sqliteLiteral(record.status)}, ${sqliteLiteral(record.submittedAt)}, ${record.completedAt ? sqliteLiteral(record.completedAt) : "NULL"}, ${record.slackStatusDeliveredAt ? sqliteLiteral(record.slackStatusDeliveredAt) : "NULL"}, ${record.error ? sqliteLiteral(record.error) : "NULL"}) ON CONFLICT(evaluation_key) DO UPDATE SET job_key = excluded.job_key, filters = excluded.filters, status = excluded.status, submitted_at = excluded.submitted_at, completed_at = excluded.completed_at, slack_status_delivered_at = excluded.slack_status_delivered_at, error = excluded.error`);
    }
    return;
  }
  const sql = await ensureGameplayAlertTables();
  for (const record of records) {
    await sql`INSERT INTO gameplay_alert_query_jobs (evaluation_key, job_key, filters, status, submitted_at, completed_at, slack_status_delivered_at, error) VALUES (${record.evaluationKey}, ${record.jobKey}, ${record.filters}, ${record.status}, ${record.submittedAt}, ${record.completedAt ?? null}, ${record.slackStatusDeliveredAt ?? null}, ${record.error ?? null}) ON CONFLICT(evaluation_key) DO UPDATE SET job_key = excluded.job_key, filters = excluded.filters, status = excluded.status, submitted_at = excluded.submitted_at, completed_at = excluded.completed_at, slack_status_delivered_at = excluded.slack_status_delivered_at, error = excluded.error`;
  }
}

export async function markGameplayAlertQueryJobsSlackStatusDelivered(evaluationKeys: string[], deliveredAt: string) {
  if (!evaluationKeys.length) return;
  if (shouldUseLocalSqlite()) {
    ensureSqliteGameplayAlertTables();
    for (const key of evaluationKeys) sqliteExec(`UPDATE gameplay_alert_query_jobs SET slack_status_delivered_at = ${sqliteLiteral(deliveredAt)} WHERE evaluation_key = ${sqliteLiteral(key)}`);
    return;
  }
  const sql = await ensureGameplayAlertTables();
  for (const key of evaluationKeys) {
    await sql`UPDATE gameplay_alert_query_jobs SET slack_status_delivered_at = ${deliveredAt} WHERE evaluation_key = ${key}`;
  }
}

export async function listGameplayAlertStates(filters: { appName: string; platform: string; appVersion: string; alertKind?: "daily" | "critical" }): Promise<GameplayAlertStateRecord[]> {
  const alertKind = filters.alertKind ?? "daily";
  if (shouldUseLocalSqlite()) {
    ensureSqliteGameplayAlertTables();
    return sqliteJsonRows<Record<string, unknown>>(`SELECT * FROM gameplay_alert_states WHERE app_name = ${sqliteLiteral(filters.appName)} AND platform = ${sqliteLiteral(filters.platform)} AND app_version = ${sqliteLiteral(filters.appVersion)} AND alert_kind = ${sqliteLiteral(alertKind)}`).map(rowToGameplayAlertState);
  }
  const sql = await ensureGameplayAlertTables();
  const rows = await sql<Record<string, unknown>[]>`SELECT * FROM gameplay_alert_states WHERE app_name = ${filters.appName} AND platform = ${filters.platform} AND app_version = ${filters.appVersion} AND alert_kind = ${alertKind}`;
  return rows.map(rowToGameplayAlertState);
}

export async function saveGameplayAlertStateRecords(records: GameplayAlertStateRecord[]) {
  if (!records.length) return;
  if (shouldUseLocalSqlite()) {
    ensureSqliteGameplayAlertTables();
    for (const record of records) {
      sqliteExec(`INSERT INTO gameplay_alert_states (alert_key, alert_kind, app_name, platform, app_version, level, layout_bank_id, layout_hash, difficulty_tier, status, first_seen_at, last_seen_at, resolved_at, superseded_at, last_fail_rate, last_reached_players, threshold, slack_open_delivered_at, slack_pending_delivered_at, slack_resolved_delivered_at) VALUES (${sqliteLiteral(record.alertKey)}, ${sqliteLiteral(record.alertKind)}, ${sqliteLiteral(record.appName)}, ${sqliteLiteral(record.platform)}, ${sqliteLiteral(record.appVersion)}, ${record.level}, ${record.layoutBankId ? sqliteLiteral(record.layoutBankId) : "NULL"}, ${record.layoutHash ? sqliteLiteral(record.layoutHash) : "NULL"}, ${sqliteLiteral(record.difficultyTier)}, ${sqliteLiteral(record.status)}, ${sqliteLiteral(record.firstSeenAt)}, ${sqliteLiteral(record.lastSeenAt)}, ${record.resolvedAt ? sqliteLiteral(record.resolvedAt) : "NULL"}, ${record.supersededAt ? sqliteLiteral(record.supersededAt) : "NULL"}, ${record.lastFailRate}, ${record.lastReachedPlayers}, ${record.threshold}, ${record.slackOpenDeliveredAt ? sqliteLiteral(record.slackOpenDeliveredAt) : "NULL"}, ${record.slackPendingDeliveredAt ? sqliteLiteral(record.slackPendingDeliveredAt) : "NULL"}, ${record.slackResolvedDeliveredAt ? sqliteLiteral(record.slackResolvedDeliveredAt) : "NULL"}) ON CONFLICT(alert_key) DO UPDATE SET alert_kind = excluded.alert_kind, layout_bank_id = excluded.layout_bank_id, layout_hash = excluded.layout_hash, status = excluded.status, last_seen_at = excluded.last_seen_at, resolved_at = excluded.resolved_at, superseded_at = excluded.superseded_at, last_fail_rate = excluded.last_fail_rate, last_reached_players = excluded.last_reached_players, threshold = excluded.threshold, slack_open_delivered_at = excluded.slack_open_delivered_at, slack_pending_delivered_at = excluded.slack_pending_delivered_at, slack_resolved_delivered_at = excluded.slack_resolved_delivered_at`);
    }
    return;
  }
  const sql = await ensureGameplayAlertTables();
  for (const record of records) {
    await sql`INSERT INTO gameplay_alert_states (alert_key, alert_kind, app_name, platform, app_version, level, layout_bank_id, layout_hash, difficulty_tier, status, first_seen_at, last_seen_at, resolved_at, superseded_at, last_fail_rate, last_reached_players, threshold, slack_open_delivered_at, slack_pending_delivered_at, slack_resolved_delivered_at) VALUES (${record.alertKey}, ${record.alertKind}, ${record.appName}, ${record.platform}, ${record.appVersion}, ${record.level}, ${record.layoutBankId ?? null}, ${record.layoutHash ?? null}, ${record.difficultyTier}, ${record.status}, ${record.firstSeenAt}, ${record.lastSeenAt}, ${record.resolvedAt ?? null}, ${record.supersededAt ?? null}, ${record.lastFailRate}, ${record.lastReachedPlayers}, ${record.threshold}, ${record.slackOpenDeliveredAt ?? null}, ${record.slackPendingDeliveredAt ?? null}, ${record.slackResolvedDeliveredAt ?? null}) ON CONFLICT(alert_key) DO UPDATE SET alert_kind = excluded.alert_kind, layout_bank_id = excluded.layout_bank_id, layout_hash = excluded.layout_hash, status = excluded.status, last_seen_at = excluded.last_seen_at, resolved_at = excluded.resolved_at, superseded_at = excluded.superseded_at, last_fail_rate = excluded.last_fail_rate, last_reached_players = excluded.last_reached_players, threshold = excluded.threshold, slack_open_delivered_at = excluded.slack_open_delivered_at, slack_pending_delivered_at = excluded.slack_pending_delivered_at, slack_resolved_delivered_at = excluded.slack_resolved_delivered_at`;
  }
}

export async function saveGameplayAlertEvaluationRun(input: { id: string; evaluatedAt: string; filters: string; result: string; transitionCount: number; source?: "cron" | "dashboard" | "critical" }) {
  if (shouldUseLocalSqlite()) {
    ensureSqliteGameplayAlertTables();
    sqliteExec(`INSERT INTO gameplay_alert_evaluation_runs (id, evaluated_at, filters, result, transition_count, source) VALUES (${sqliteLiteral(input.id)}, ${sqliteLiteral(input.evaluatedAt)}, ${sqliteLiteral(input.filters)}, ${sqliteLiteral(input.result)}, ${input.transitionCount}, ${sqliteLiteral(input.source ?? "cron")})`);
    return;
  }
  const sql = await ensureGameplayAlertTables();
  await sql`INSERT INTO gameplay_alert_evaluation_runs (id, evaluated_at, filters, result, transition_count, source) VALUES (${input.id}, ${input.evaluatedAt}, ${input.filters}, ${input.result}, ${input.transitionCount}, ${input.source ?? "cron"})`;
}

export async function markGameplayAlertSlackDelivered(alertKeys: string[], type: "opened" | "pending" | "resolved", deliveredAt: string) {
  if (!alertKeys.length) return;
  const column = type === "opened" ? "slack_open_delivered_at" : type === "pending" ? "slack_pending_delivered_at" : "slack_resolved_delivered_at";
  if (shouldUseLocalSqlite()) {
    ensureSqliteGameplayAlertTables();
    for (const key of alertKeys) sqliteExec(`UPDATE gameplay_alert_states SET ${column} = ${sqliteLiteral(deliveredAt)} WHERE alert_key = ${sqliteLiteral(key)}`);
    return;
  }
  const sql = await ensureGameplayAlertTables();
  for (const key of alertKeys) {
    if (type === "opened") await sql`UPDATE gameplay_alert_states SET slack_open_delivered_at = ${deliveredAt} WHERE alert_key = ${key}`;
    else if (type === "pending") await sql`UPDATE gameplay_alert_states SET slack_pending_delivered_at = ${deliveredAt} WHERE alert_key = ${key}`;
    else await sql`UPDATE gameplay_alert_states SET slack_resolved_delivered_at = ${deliveredAt} WHERE alert_key = ${key}`;
  }
}

export async function listAdMetricAlertStates(filters: { appName: string; platform: string; appVersion: string }): Promise<AdMetricAlertStateRecord[]> {
  if (shouldUseLocalSqlite()) {
    ensureSqliteGameplayAlertTables();
    return sqliteJsonRows<Record<string, unknown>>(`SELECT * FROM ad_metric_alert_states WHERE app_name = ${sqliteLiteral(filters.appName)} AND platform = ${sqliteLiteral(filters.platform)} AND app_version = ${sqliteLiteral(filters.appVersion)}`).map(rowToAdMetricAlertState);
  }
  const sql = await ensureGameplayAlertTables();
  const rows = await sql<Record<string, unknown>[]>`SELECT * FROM ad_metric_alert_states WHERE app_name = ${filters.appName} AND platform = ${filters.platform} AND app_version = ${filters.appVersion}`;
  return rows.map(rowToAdMetricAlertState);
}

export async function saveAdMetricAlertStates(records: AdMetricAlertStateRecord[]) {
  if (!records.length) return;
  if (shouldUseLocalSqlite()) {
    ensureSqliteGameplayAlertTables();
    for (const record of records) {
      sqliteExec(`INSERT INTO ad_metric_alert_states (alert_key, metric, app_name, platform, app_version, status, first_seen_at, last_seen_at, resolved_at, current_value, baseline_mean, baseline_stddev, z_score, threshold, slack_open_delivered_at) VALUES (${sqliteLiteral(record.alertKey)}, ${sqliteLiteral(record.metric)}, ${sqliteLiteral(record.appName)}, ${sqliteLiteral(record.platform)}, ${sqliteLiteral(record.appVersion)}, ${sqliteLiteral(record.status)}, ${sqliteLiteral(record.firstSeenAt)}, ${sqliteLiteral(record.lastSeenAt)}, ${record.resolvedAt ? sqliteLiteral(record.resolvedAt) : "NULL"}, ${record.currentValue}, ${record.baselineMean}, ${record.baselineStddev}, ${record.zScore}, ${record.threshold}, ${record.slackOpenDeliveredAt ? sqliteLiteral(record.slackOpenDeliveredAt) : "NULL"}) ON CONFLICT(alert_key) DO UPDATE SET status = excluded.status, last_seen_at = excluded.last_seen_at, resolved_at = excluded.resolved_at, current_value = excluded.current_value, baseline_mean = excluded.baseline_mean, baseline_stddev = excluded.baseline_stddev, z_score = excluded.z_score, threshold = excluded.threshold, slack_open_delivered_at = excluded.slack_open_delivered_at`);
    }
    return;
  }
  const sql = await ensureGameplayAlertTables();
  for (const record of records) {
    await sql`INSERT INTO ad_metric_alert_states (alert_key, metric, app_name, platform, app_version, status, first_seen_at, last_seen_at, resolved_at, current_value, baseline_mean, baseline_stddev, z_score, threshold, slack_open_delivered_at) VALUES (${record.alertKey}, ${record.metric}, ${record.appName}, ${record.platform}, ${record.appVersion}, ${record.status}, ${record.firstSeenAt}, ${record.lastSeenAt}, ${record.resolvedAt ?? null}, ${record.currentValue}, ${record.baselineMean}, ${record.baselineStddev}, ${record.zScore}, ${record.threshold}, ${record.slackOpenDeliveredAt ?? null}) ON CONFLICT(alert_key) DO UPDATE SET status = excluded.status, last_seen_at = excluded.last_seen_at, resolved_at = excluded.resolved_at, current_value = excluded.current_value, baseline_mean = excluded.baseline_mean, baseline_stddev = excluded.baseline_stddev, z_score = excluded.z_score, threshold = excluded.threshold, slack_open_delivered_at = excluded.slack_open_delivered_at`;
  }
}

export async function markAdMetricAlertSlackDelivered(alertKeys: string[], deliveredAt: string) {
  if (!alertKeys.length) return;
  if (shouldUseLocalSqlite()) {
    ensureSqliteGameplayAlertTables();
    for (const key of alertKeys) sqliteExec(`UPDATE ad_metric_alert_states SET slack_open_delivered_at = ${sqliteLiteral(deliveredAt)} WHERE alert_key = ${sqliteLiteral(key)}`);
    return;
  }
  const sql = await ensureGameplayAlertTables();
  for (const key of alertKeys) await sql`UPDATE ad_metric_alert_states SET slack_open_delivered_at = ${deliveredAt} WHERE alert_key = ${key}`;
}
