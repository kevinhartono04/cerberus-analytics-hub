# Ludios Sense transfer reduction

The October 27 Cerebral usage chart reports 21.206 GB of shared-pooler egress. This is the project's daily total, not a measured cost for a single scan. The saved scan's root plus pages measured 21,599,179 bytes; shared history measured 16,508,830 bytes; its summary expanded to 5,148,612 bytes. The earlier memory safeguards did not prevent repeated transfer of those pages.

## Changes

- Progress is projected in SQL before transfer: no game rows, page references, stores, or receipts. The October 27 summary projection measured 591 bytes in a read-only production query. Progress responses have a 16 KiB application ceiling. The UI polls every five seconds only while visible and running.
- Reports load through an authenticated page endpoint after completion (or explicit pause/error). Requests are pinned to the report's generated timestamp and stored summary revision. All pages of a selected version load once so global search, publisher filtering, and store grouping remain correct. Incomplete loads show a retry state rather than a misleading partial shortlist. This is bounded transport pagination, not server-side search: the browser still receives the complete selected report once.
- Viewing the allowance reads small usage/progress records only; it does not derive a country subset or expand warm histories. The former speculative call forecast is unavailable until a separate cheap forecast is provided. API request limits remain enforced.
- Metadata manifests now include sorted page ranges. History and finalization steps select pages for the current batch, preserving untouched page references and expiry. Old manifests are read with the existing bounded full-reader once and acquire ranges on checkpoint. Discovery/metadata planning still expands metadata; this release does not replace that planner with normalized tables.
- Immutable pages/blobs are cached for the current invocation, capped at 32 MiB and respecting record expiry. Mutable checkpoints, leases, pauses, and usage records are always refreshed. No process-lifetime mutable cache is introduced.
- Shared histories publish once at finalization rather than once per 25-game batch. A separate expiring shared-index lease is checked atomically at publication. The scan checkpoint and its summary retain the existing lease/transaction protection. Historical snapshots and per-country revision windows remain intact.
- Each operation logs cache payload read bytes and read count, without keys or payload contents. These are application payload estimates, not billing-grade wire-byte measurements: protocol overhead, auth/database initialization, and reads outside these adapters are excluded. Successful step reads accumulate in the job checkpoint. The provisional limits pause work after 256 MiB per invocation or 1 GiB of checkpointed reads per job; a read/batch can overshoot the threshold. Failed/stale steps can consume bytes without advancing the job counter, so these limits do not constitute a hard provider billing cap.

## Validation

- Synthetic 6,000-row report: 100 progress polls read under 200 KiB and request no report pages.
- Synthetic 6,000-game finalization: 240 resumable batches, 61,948,126 payload bytes read, unchanged latest-day values, and one shared-index read. This excludes discovery/history collection and uses synthetic metadata; it is not a forecast of full production scan usage.
- Tests cover sparse page updates across restart, untouched games, report version mismatch, immutable-page reuse, SQLite progress projection, and failed-page retry without publishing an incomplete shortlist.
- Local production build and TypeScript pass. Browser verification uses a separate temporary checkout/database with synthetic saved reports and no upstream token or production connection.

## Rollout

Keep the Sense cron entries absent. No schema migration or historical-data rewrite is required. First verify the authenticated Preview report, progress, and chart paths. Then release the reviewed build, inspect progress/report transfer logs, and perform one controlled collection batch before resuming an entire scan. Compare per-operation payload measurements with Supabase's subsequent shared-pooler usage; no production savings percentage is claimed in advance. Do not restore unattended scans until representative full-run transfer, memory, I/O, detection parity, and retry behavior have been measured.

A later normalized job/game/observation store or dedicated durable worker may further reduce discovery/planning reads. Those are follow-up architecture changes, not prerequisites hidden inside this release.

## November 13 history-window optimization

Collection now projects only the selected countries and the report's 28-day window inside Postgres before creating a run-local history snapshot. Later missing-week updates reuse that compact snapshot. Shared histories retain their existing 118-day merge retention; historical report blobs are unchanged. Finalization skips history merging when immutable references match. Changed histories are hydrated once for both evaluation and merging. The source catalogue, discovery rules, countries, detector, provider request plan, safety limits, and disabled schedules are unchanged.

The SQL projection retains exact retrieval/revision windows, zero values and explicit nulls; omitted observations remain missing. It supports legacy plain-country history blobs, guards original blob sizes before parsing, and rejects missing or expired blobs. SQLite retains its bounded local reader and applies the same window selection in the application. Projection results are never cached under the original full-blob key.

Full report replay (synthetic provider data; real Postgres semantics via PGlite, cold worker contexts, invocation-local immutable cache): 20,000 candidates across both stores, 8,000 included reports, all seven countries, 118 retained days, a seven-day revision refresh, and 28-day evaluations. Every evaluation is compared to the untrimmed reference; shared history outside the window is also checked. Both implementations use 620 provider attempts and 1,746 steps. The baseline at commit 4d1b42a reads 394,698,938 application payload bytes; the optimized build reads 232,698,708 bytes (41.0% less, approximately 221.9 MiB). Discovery is unchanged at 1,270,564 bytes. The baseline benchmark alone raises its test-only transfer stop to measure completion; the optimized test passes the unchanged 250 MiB production limit. This is not a live scan or a Supabase billed-egress measurement. The earlier uncached test harness overstated the baseline as 516,466,964 bytes; the cache-faithful comparison above supersedes it.

Run `npx vitest run tests/ludios-sense-history-transfer.test.ts` to reproduce the optimized full-report check. Tests also exercise the actual SQL projection through postgres.js, historical/legacy coverage, missing and expired data, retries, pauses, and saved-country subsets. Daily scheduling remains disabled pending controlled live validation and billing comparison.
