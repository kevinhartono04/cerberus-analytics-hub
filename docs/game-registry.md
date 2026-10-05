# Game setup

Internal editors and admins can use `/games` to add a lowercase game key, telemetry app ID, bundle ID, and optional Android/iOS Adjust app tokens. Adding a game persists it immediately; subsequent dashboard loads use the registry without rebuilding or changing Vercel environment variables.

New registrations are insert-only. Duplicate game keys, app IDs and bundle IDs are rejected. Existing games keep their source catalog IDs and environment-based integration mappings. The shared Adjust API credential and Google Play service account stay in server environment configuration.

The private `game_registry` table uses the application database connection and owner role. It stores platform app tokens server-side; list and create responses return only configuration flags. Records include creator and creation time. Local development uses SQLite. Production uses the existing private `cerebral` schema with RLS enabled and no client API grants.

Technical Readiness, Level Funnel, Game Monitoring, Incent Config Validator, Adjust Events Check, Signal QA, and partner app-grant controls use registered games. Runtime query builders resolve new IDs from storage and validate them before interpolating SQL. The Ludios source filter in readiness also includes newly registered IDs.

Game registration does not grant partner access or enable automated alert delivery. An administrator must configure incentivized media sources before running Incent Config Validator for a newly added game. Data collection, store API permissions and SDK setup remain upstream responsibilities.
