import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import postgres from 'postgres';
import { supabaseCa } from '../lib/supabase-ca.ts';

// Credentials belong in the protected one-off configuration, never in the report.
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const source = postgres(config.sourceUrl, { ssl: { rejectUnauthorized: true }, max: 1, prepare: false, connect_timeout: 20 });
const target = postgres(config.targetUrl, { ssl: { ca: supabaseCa, rejectUnauthorized: true }, max: 1, prepare: false, connect_timeout: 20 });
const canonical = (row) => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(k => [k, row[k]])));
const digest = (rows) => crypto.createHash('sha256').update(rows.map(canonical).sort().join('\n')).digest('hex');
const report = { capturedAt: new Date().toISOString(), schema: config.schema, source: {}, backup: {} };
const readTarget = (table) => target.begin('read only', async sql => {
  // Pooler sessions can default to 15 significant digits; request round-trip precision.
  await sql`SET LOCAL extra_float_digits = 3`;
  return sql`SELECT * FROM ${sql(table)}`;
});
try {
  let data;
  try { data = JSON.parse(gunzipSync(await fs.readFile(config.backupDir + '/neon-original.json.gz'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!data) data = await source.begin('isolation level repeatable read read only', async sql => {
    await sql`SET LOCAL extra_float_digits = 3`;
    const snapshot = {};
    for (const table of config.tables) {
      snapshot[table] = await sql`SELECT * FROM ${sql('public.' + table)}`;
      console.log(JSON.stringify({ action: 'exported', table, rows: snapshot[table].length }));
    }
    return snapshot;
  });
  await fs.writeFile(config.backupDir + '/neon-original.json.gz', gzipSync(JSON.stringify(data)), { mode: 0o600 });
  const backup = {};
  for (const table of config.targetTables) {
    backup[table] = await readTarget(config.schema + '.backup_' + table);
    report.backup[table] = { rows: backup[table].length, sha256: digest(backup[table]) };
  }
  await fs.writeFile(config.backupDir + '/supabase-before-merge.json.gz', gzipSync(JSON.stringify(backup)), { mode: 0o600 });
  // The temporary login can only insert into archive tables. It has no live-table grants.
  for (const table of config.tables) {
    const rows = data[table];
    const existing = await target`SELECT count(*)::int AS count FROM ${target(config.schema + '.source_' + table)}`;
    if (existing[0].count === 0) await target.begin(async sql => {
      for (let start = 0; start < rows.length; start += 20) {
        const batch = rows.slice(start, start + 20);
        await sql`INSERT INTO ${sql(config.schema + '.source_' + table)} ${sql(batch, ...Object.keys(batch[0]))}`;
      }
    });
    const staged = await readTarget(config.schema + '.source_' + table);
    const checksum = digest(rows);
    if (staged.length !== rows.length || digest(staged) !== checksum) throw new Error('Archive verification failed: ' + table);
    report.source[table] = { rows: rows.length, sha256: checksum };
    console.log(JSON.stringify({ action: 'archive_verified', table, rows: rows.length }));
  }
  await fs.writeFile(config.backupDir + '/archive-manifest.json', JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ action: 'complete', backupDir: config.backupDir, sourceTables: config.tables.length, backupTables: config.targetTables.length }));
} catch (error) {
  // Avoid echoing driver errors that could embed connection parameters or payloads.
  console.error(JSON.stringify({ action: 'failed', error: error instanceof postgres.PostgresError ? { code: error.code, message: error.message } : { name: error.name, message: error.message } }));
  process.exitCode = 1;
} finally {
  await Promise.allSettled([source.end({ timeout: 5 }), target.end({ timeout: 5 })]);
}
