# Ludios Sense queue trial

The discovery bottleneck was repeated transfer of the shared metadata catalogue and growing scan checkpoints. The queue keeps job cursors under 16 KiB, candidates in indexed rows, and shared app snapshots in Postgres. Ranking pages contain at most 200 apps; metadata, history and finalization batches contain at most 25. Discovery and candidate copying happen inside Postgres. Existing immutable history blobs, report charts, detector rules and original legacy checkpoints remain usable.

## Validation

- Real Postgres semantics via PGlite, using the exact migration and adoption SQL.
- Cold two-store scan, weekly history, detector/chart parity, country subset with zero new provider calls, partial allowance coverage, crash recovery, leases, in-flight pause and persistent safety stops.
- Warm 20,000-candidate/seven-country replay through all phases: 4,000 included reports, every evaluation checked. The fixture simulates provider responses; it does not contact Sensor Tower. Measured application payload reads were 1,269,872 bytes for discovery and 70,582,348 bytes overall (1,426 steps).
- Optional real cached discovery prefix: set `SENSE_QUEUE_REPLAY_FIXTURE` to a local exported fixture, then run `npx vitest run tests/ludios-sense-production-replay.test.ts`. Raw licensed data is excluded from the repository. The Oct 29 replay includes 72 exact cached responses and one empty Oct 28 response inferred from the saved cursor and receipt. It uses approximately 1.6 MB of application payload reads and reproduces the paused Android/iOS candidate sets (11,544 / 9,842) and cursor with zero provider calls. This is a prefix replay, not a complete live scan.
- Read counters estimate JSON payload bytes transferred to the application, not Supabase billed wire bytes. Cache expiry, database protocol overhead, future response sizes and missing history can change live usage.

Recent detections use a partial index and selected observation rows; viewing the shortlist does not retrieve every game from seven prior reports.

## Controlled activation

1. Keep the legacy production scan paused and verify both step and worker leases have expired. Do not start a second scan while preparing storage.
2. Apply `supabase/migrations/20261029092437_sense_work_queue.sql` using the Supabase migration workflow. It creates four private tables, owned by `cerebral_app`, with RLS and no public, anon, authenticated or service-role grants. No existing table is rewritten.
3. Run `scripts/sense-queue-bootstrap.sql` once. It imports metadata/history references inside Postgres, validates page/reference presence and expiry, preserves newer queue rows and creates a readiness marker. It makes no Sensor Tower calls.
4. To retain the paused discovery progress, run `scripts/sense-queue-adopt.sql` inside a transaction after setting `sense.queue_adopt_key` locally to the exact legacy job key. It copies candidate snapshots in Postgres, preserves the request counter and legacy read-byte audit, and creates a separate paused queue job. No history is re-fetched. Adoption rejects active, incomplete, already-adopted or later-phase sources.
5. Deploy this code with `SENSE_QUEUE_ENGINE` unset initially. Then set it to `true` for the intended trial environment and redeploy. Start is blocked without the readiness marker. Existing queue reports remain readable when the flag is disabled, and active queues cannot silently fall back to the legacy worker.
6. Review adoption counts, cursor and budgets before explicitly clearing the new job's safety reason. Clear only the reason for the exact reviewed job in SQL, leaving `paused=true`; then use Resume check. Never clear a resource stop as a blanket operation. The original legacy pause remains in place.
7. Monitor Vercel `queue_step_completed`, `queue_sensor_response` and `database_transfer` logs, plus Supabase load/egress. Transfer logs with `scope=operation` are nested measurements: do not add them to their parent `scope=invocation`. Queue read counters are cumulative across worker invocations. Initial hard stops are 25 MiB discovery and 250 MiB total per queue job, 1,000 upstream attempts, 4 MiB responses and 256 MiB reads per invocation. The trial should be stopped sooner if observed resource use is unexpectedly high. Budget stops persist and ordinary Run check/Resume cannot clear them.
8. Verify report completeness and compare representative game charts and signals. A country subset must use saved original snapshots without provider calls. Compare Supabase billing after its reporting delay; application counters alone do not prove billed savings.

Only an explicitly started or resumed browser session asks for the next bounded worker invocation. Opening a shared report or polling progress does not start an upstream scan. Closing the controlling tab lets the current bounded worker finish, then leaves its checkpoint waiting for Resume. No automatic scan schedule is introduced.

## Rollback and retention

Disable `SENSE_QUEUE_ENGINE` and redeploy to block queue writes. Do not resume the old scan. Keep the additive tables and original blobs/checkpoints while reviewing results; saved reports are still readable. A job can expire after 31 days; app/reference expiry is at most 93 days and never later than its history reference. An explicit rerun of an expired key removes only that key's expired candidates/attempts in a transaction before creating fresh state. Periodic maintenance should delete expired candidates and attempts before expired parent jobs, in bounded batches, and expired shared app rows. Do not delete unexpired report observations. There is no new background cleanup or scan cron in this change.
