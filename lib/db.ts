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
  SavedSpecSummary,
  UserRole,
} from "@/lib/types";
import { generatedSpecSchema, userRoleSchema } from "@/lib/types";

const seedPath = path.join(process.cwd(), "data", "analytics_reference_library.json");
const localSqlitePath = path.join(process.cwd(), "data", "analytics.sqlite");

let cachedLibraryData: LibraryData | null = null;
let cachedSnapshot: LibrarySnapshot | null = null;
let sqlClient: postgres.Sql | null = null;
let savedSpecsTableReady: Promise<void> | null = null;
let appUsersTableReady: Promise<void> | null = null;
let techLaunchCacheTableReady: Promise<void> | null = null;

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
    const existing = sqliteJsonRows<Record<string, unknown>>(`
      SELECT id, email, name, role, created_at, updated_at
      FROM app_users
      WHERE id = ${sqliteLiteral(identity.id)}
      LIMIT 1
    `)[0];
    if (existing) {
      const role = syncedRole(userRoleSchema.catch("viewer").parse(asString(existing.role)), initialRole);
      sqliteExec(`
        UPDATE app_users
        SET email = ${sqliteLiteral(identity.email)},
          name = ${sqliteLiteral(identity.name)},
          role = ${sqliteLiteral(role)},
          updated_at = ${sqliteLiteral(now)}
        WHERE id = ${sqliteLiteral(identity.id)}
      `);
      return { ...rowToAppUser(existing), email: identity.email, name: identity.name, role, updatedAt: now };
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
  const [existing] = await sql<Record<string, unknown>[]>`
    SELECT id, email, name, role, created_at, updated_at
    FROM app_users
    WHERE id = ${identity.id}
    LIMIT 1
  `;
  if (existing) {
    const role = syncedRole(userRoleSchema.catch("viewer").parse(asString(existing.role)), initialRole);
    await sql`
      UPDATE app_users
      SET email = ${identity.email},
        name = ${identity.name},
        role = ${role},
        updated_at = ${now}
      WHERE id = ${identity.id}
    `;
    return { ...rowToAppUser(existing), email: identity.email, name: identity.name, role, updatedAt: now };
  }

  await sql`
    INSERT INTO app_users (id, email, name, role, created_at, updated_at)
    VALUES (${identity.id}, ${identity.email}, ${identity.name}, ${initialRole}, ${now}, ${now})
  `;
  return { ...identity, role: initialRole, createdAt: now, updatedAt: now };
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
