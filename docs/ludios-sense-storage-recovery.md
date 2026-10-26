# Ludios Sense storage recovery

The October 23 incident involved successful Sensor Tower responses followed by process termination and database failures. The old worker repeatedly read and serialized entire scan histories; the largest checkpoint was 111 MB of JSON. All 26 existing production checkpoints exceed the new 4 MiB read limit. The exact allocation that triggered the original termination was not profiled.

## Changes

- Immutable, content-addressed observation and exact revision-window blobs, capped at 256 KiB per game. Checkpoints retain metadata, coverage windows, and references, not observations. Unchanged blobs are not rewritten.
- Checkpoint, summary, and queue changes commit together only while the scan lease is still owned; stale workers cannot publish over a newer checkpoint.
- Immutable app metadata pages are capped at 256 KiB each, with a 24 MiB total decode budget. Coverage in the index merges overlapping ranges; exact revision windows remain in each game blob. Reused pages retain their actual expiry.
- Small manifests and summary reads capped at 4 MiB in SQL before payload transfer, with a second application check before parsing. Oversized active checkpoints are explicitly paused for migration.
- Saved charts stored separately by scan, report timestamp, store, and app. Old snapshots retain their original observations. A missing shard fails explicitly instead of returning invented empty history.
- Discovery pages contain 200 apps; metadata and history requests contain at most 25 apps after an existing legacy batch finishes. Transport rejects responses above 4 MiB.
- Report finalization and large saved-country subsets process at most 25 charts per checkpoint. Subsets make no upstream requests. Warm histories merge only the completed batch, retaining the existing revision and missing-observation rules.
- Continuation selects one job per invocation. Queue discovery uses LIKE rather than punctuation ranges, which did not work under production's en_US.UTF-8 collation. It reads queue metadata only. At larger table sizes, consider a partial queue index after measuring the query plan.
- Sensor Tower response timing and size are logged before database usage accounting; step logs include RSS and heap usage. Tokens and observation bodies are excluded.
- Candidate counts and compact output sizes have explicit limits. Exceeding them stops the scan; it does not silently truncate the report. Smaller batches can require more upstream calls, so existing allowance limits still apply.

Both Sense cron entries remain removed from vercel.json.

## Deployment gates

Do not restore the schedules just because the tests pass. First validate this build in Preview, obtain database I/O and memory headroom, and migrate the legacy data. The production connection variable is sensitive and cannot be read back from Vercel. Run the migration from an authorized operator environment where CEREBRAL_DATABASE_URL is already configured. Never paste credentials into a chat, command argument, or committed file.

Inventory keys using metadata only:

```sql
SELECT cache_key, octet_length(payload) AS bytes, expires_at
FROM cerebral.tech_launch_readiness_cache
WHERE (cache_key LIKE 'sense:history:%'
  OR (cache_key LIKE 'sense:v1:%' AND length(cache_key)=73)
  OR cache_key LIKE 'sense:result:sense:v1:%')
ORDER BY octet_length(payload);
```

Convert one exact key at a time, initially dry-run. Run outside Vercel with local memory available:

```sh
node --max-old-space-size=2048 scripts/migrate-sense-storage.mjs --key '<key from inventory>'
node --max-old-space-size=2048 scripts/migrate-sense-storage.mjs --key '<same key>' --apply --stage --backup-dir '<private local backup directory>'
node --max-old-space-size=2048 scripts/migrate-sense-storage.mjs --key '<same key>' --verify --backup-dir '<private local backup directory>'
# Only after the compatible storage reader has been deployed:
node --max-old-space-size=2048 scripts/migrate-sense-storage.mjs --key '<same key>' --apply --publish --backup-dir '<private local backup directory>'
```

The dry-run reads one legacy row and reports shard and manifest sizes without writes. Stage acquires the upstream lease, saves exact JSON plus its checksum in private local files, writes shards in batches of at most 64 rows (flushed after 512 KiB), verifies every stored shard's SHA-256 and expiry, then saves a separate staging record. The live source remains unchanged. Verified backups can be reused on retries. For sequential bulk staging, an optional private --verified-cache file reuses previously checksum-verified immutable chunks with sufficient expiry. Verify and publish ignore this cache and check the database afresh. Each timed-out batch gets one retry split into smaller batches; another failure stops the migration.

Verify regenerates the conversion from the backup and checks the staged manifest and every shard without changing the source. Publish performs the same verification, then replaces the source only if its timestamp, checksum, and owned lease still match. Migrated running jobs remain explicitly paused. Deploy the compatible reader before publishing; never let the old worker read converted manifests. A failed conversion leaves only expiring orphan shards. Keep backups until application verification is complete.

Start with the shared history index and the selected trial job; then migrate remaining history indexes, job checkpoints, and saved report snapshots. Migrating jobs creates charts for their current reports; older timestamped report snapshots need their own migration to retain historical chart access. Do not delete legacy data to make a test pass. If a converted manifest exceeds 4 MiB, stop and extend metadata pagination before rollout.

After migration, verify the compact record size, read several charts (both platforms and missing-country cases), and compare downloads/evaluations to the backup. Confirm no legacy job will be discovered before it is migrated or explicitly paused. Run the corrected backfill-sense-queue.sql only after that audit.

## Controlled restart

1. Confirm Supabase I/O balance, throughput, memory, and connections have recovered; no fixed recovery time is assumed.
2. Use one migrated job with concurrency one. Execute one step and inspect Sensor Tower response timing, checkpoint size, RSS, heap, database query duration, and I/O.
3. Verify an interrupted/retried step preserves progress and that saved charts are retrievable.
4. Complete a representative full scan with stable memory and I/O. Restore continuation conservatively only after that succeeds; restore the daily schedule last.

If the trial breaches the memory or I/O budget, pause it. Keep the deployed queue/schedule mitigation. Do not roll back to an inline-history worker while allowing migrated scans to run: old code does not understand the sharded format.

## Validation recorded on October 23

- Full Vitest suite: 442 tests passed in 64 files; TypeScript passed.
- Synthetic 100+ MiB observation collection produces a manifest below 1 MiB, with each shard below 256 KiB. This is a storage-shape regression test, not a production peak-RSS measurement.
- Tests cover immutable observations across restart/revision, missing shards, SQL UTF-8 byte limits, 25-chart resumable finalization, large subset continuation without upstream calls, and migration failure before manifest publication.
- Live production SQL fixture: LIKE matches the pending marker; the old punctuation range does not. No production scan was restarted for this validation.
- Production migration, Preview browser verification, and a representative production scan remain rollout gates.


## Additional validation on October 26

- The real shared index contained 70 MB of revision windows, so observation-only sharding was insufficient. Offline conversion of its verified 108,663,001-byte backup now produces a 1,043,267-byte root and 58 metadata pages; the largest shard is 262,141 bytes.
- 444 tests across 65 files and TypeScript pass, including exact revision preservation, metadata pagination, and reused-page expiry.
- Supabase still reported 0% I/O burst balance during staging. Keep full scans and both Sense schedules paused until measured headroom and the controlled trial gates pass.
