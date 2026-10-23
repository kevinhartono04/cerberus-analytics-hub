# Ludios Sense storage recovery

The October 23 incident involved successful Sensor Tower responses followed by process termination and database failures. The old worker repeatedly read and serialized entire scan histories; the largest checkpoint was 111 MB of JSON. All 26 existing production checkpoints exceed the new 4 MiB read limit. The exact allocation that triggered the original termination was not profiled.

## Changes

- Immutable, content-addressed observation blobs, capped at 256 KiB per game. Checkpoints retain metadata, coverage windows, and references, not observations. Unchanged blobs are not rewritten.
- Checkpoint, summary, and queue changes commit together only while the scan lease is still owned; stale workers cannot publish over a newer checkpoint.
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
node --max-old-space-size=2048 scripts/migrate-sense-storage.mjs --key '<same key>' --apply --backup-dir '<private local backup directory>'
```

The dry-run reads one legacy row and reports shard and manifest sizes without writes. Apply acquires the upstream lease, backs up the exact original JSON and its checksum to private local files, writes shards sequentially, then publishes the compact manifest in a transaction only if the source timestamp and lease still match. A failure never replaces the source with an incomplete manifest. Expiring orphan shards can remain after an interrupted attempt. Use a fresh backup directory on a retry. Keep the backup until verification is complete. Migrated running jobs remain explicitly paused.

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
