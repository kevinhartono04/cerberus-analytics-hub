# Alert reactivation — 2026-09-23

User-approved target: Stacksmash, Android + iOS, all versions. Local SQLite and
production Supabase settings saved with normal 40%, hard 70%, minimum 50 players,
test countries excluded, and ad-metric Z-score 3. Dashboard settings remain
40% / 70% / 100 players with test-country exclusion off.

Stacksmash incentivized sources: freecash_int, puzzleplay_int, adjoe_int,
scrambly_int, kashkick_int. Existing production Slack destinations are retained.

`CEREBRAL_ALERTS_PAUSED=false` explicitly resumes both cron routes and Slack
delivery independently of `CEREBRAL_RECOVERY_MODE=true`. An unset pause flag
inherits recovery mode; any supplied value except exactly `false` pauses alerts.
Environment changes require a production deployment. To stop delivery, set the
pause flag to `true` and redeploy (or roll back to the previous paused deployment).

No Neon alert history was imported. Initial currently breached conditions may
be announced again. Do not overwrite new Supabase delivery state when merging
Neon history later. No delivery timestamps have been fabricated or pre-seeded.
