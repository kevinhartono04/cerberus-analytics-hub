# Cerebral database recovery — 2026-09-22

## Scope

Fresh start on Supabase because Neon returns HTTP 402 for database reads.
No historical Neon records were copied. Source production revision: `65fc3d6538695ccccfe761abdf390ba24ddaf716`.

- Supabase organization: `ultjixzywlwfpbtpvvqx` (Cerberus).
- Supabase project: `ggtymhitzxqfojnqalgy` (Cerebral), us-east-1.
- Private schema: `cerebral`; server login: `cerebral_app`.
- Neon source: `crimson-dream-70448197`, branch `br-round-cake-at9ebe7m`, database `neondb`.
- Previous production: `dpl_5PbzLDMCCdin3ZJNSdJ1pXy3CDna`.

## Runtime configuration

`CEREBRAL_DATABASE_URL` takes precedence over the existing database environment variables.
It is set only for production; existing Neon variables are preserved. NextAuth Google credentials,
AUTH_SECRET, and Google-based user IDs are unchanged. Existing ADMIN_EMAILS and EDITOR_EMAILS
bootstrap internal access; other internal users become viewers. Partner allowlists start empty.

`CEREBRAL_RECOVERY_MODE=true` pauses both cron routes before database/Count work,
blocks Slack webhook sends, and displays the recovery notice. Keep it enabled until
historical access/settings have been reconciled and alert targets/baselines reviewed.
The notice is rendered at build time on static pages: rebuild when changing this flag.

The server connects through the shared transaction pooler with prepared statements disabled,
using the published Supabase CA and strict certificate validation. `cerebral_app` owns only
the application schema/tables (required by the existing runtime CREATE/ALTER TABLE logic).
No superuser, role-creation, database-creation, replication or BYPASSRLS capability is granted.
All tables enable RLS. No browser API roles have schema/table privileges or RLS policies;
the server owner role uses the existing application authorization checks. Supabase advisor
INFO notices about missing policies are intentional for this private, server-only schema.
Reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Recovery defaults

Schema is captured in `initial-schema.sql`; it contains no user records or credentials.
Gameplay settings use source-code thresholds: dashboard normal/hard 0.4/0.7,
minimum players 100, dashboard test-country exclusion false; alert normal/hard 0.5/0.7,
minimum players 50, alert test-country exclusion true, ad metric z-score 3.
The recovery settings row explicitly sets alert_targets to [] and updated_by to
`supabase-recovery-2026-09-22`. Incent media-source settings initialize from source-code defaults.
These values are not recovered historical settings. Review before relying on verdicts or resuming alerts.

## Later Neon merge

1. Confirm Neon access is restored; export it read-only and retain an original backup.
2. Back up current Supabase data. Import Neon into an isolated staging schema, never restore
   a full Neon dump over the live Supabase schema or Supabase-managed schemas.
3. Match users by stable Google ID and normalized email. Preserve current recovery-era
   role decisions; review conflicts and revocations explicitly rather than selecting the higher role.
4. Merge historical saved_specs by ID, preserving newer Supabase edits and ownership.
   Treat re-imported specs and deletions as explicit conflicts, not automatic replacements.
5. Review historical partner domains, expirations, allowed apps, and settings before enabling them.
6. Discard expired caches. Archive historical evaluation runs if useful. Do not activate stale
   query jobs or delivery flags. Establish a current alert baseline without sending historical alerts.
7. Test role boundaries, old/new spec access, dashboards, and both scheduled evaluators.
   Re-enable reviewed targets and disable recovery mode only in a new verified deployment.

## Rollback and verification

Do not roll back to Neon while its quota is exhausted. Supabase becomes the source of new writes
after cutover; reverting would require reconciliation. Do not remove the dedicated connection
variable until its replacement is tested. Any future deployment must retain the recovery guards
and connection selection while recovery mode is active.

Verification includes production build/type checks, auth/RBAC tests, forced-cron pause tests,
Slack suppression tests, and temporary user/cache CRUD checks over verified TLS.
The isolated checkout needs an empty `data/analytics.sqlite` file for existing local RBAC tests;
the first full run failed because that ignored local file was missing, and its rerun passed.
No local test users are intended for production.
