# StackSmash Refund Review

A mention-driven CS assistant inside Cerberus Analytics Hub. It accepts one IDFV, checks purchase evidence through either the demo or Count/Snowflake provider, and posts recommendations for human review. It does not issue refunds.

## Try the demo

Mention the bot with `@Refund Review IDFV: 00000000000000000000000000000001`.
The `IDFV:` label and UUID hyphens are optional. An IDFV-only mention prompts for dispute details; optional structured fields are supported (see below). The bot reads no thread history or attachments. Responses stay in the mention's thread (or start a thread on a top-level mention).

Demo-mode output is marked **DEMO**. Live mode is explicitly configured and uses the supplied event query and product catalog. Unknown IDs, including real customer IDs, return **No demo fixture available**. Synthetic dates are relative to the check's creation time. The default window is 90 days, matching the supplied query. Only purchases inside that window are returned; older entitlements remain an explicit limitation. Add `asof:2026-09-08` to inspect an earlier ticket through the end of that UTC date. Events after the cutoff are excluded.

| Synthetic IDFV | Scenario | Expected outcome |
| --- | --- | --- |
| `00000000000000000000000000000001` | All expected coins delivered | Recommend not eligible |
| `00000000000000000000000000000002` | Permanent no-ads; rewarded ads only | Recommend not eligible |
| `00000000000000000000000000000003` | Season benefit expired before interstitial | Recommend not eligible |
| `00000000000000000000000000000004` | Interstitial during permanent benefit | Recommend eligible |
| `00000000000000000000000000000005` | Confirmed payment, no grants after grace period | Recommend eligible |
| `00000000000000000000000000000006` | Partial grants | Needs review |
| `00000000000000000000000000000007` | Missing telemetry | Needs review |
| `00000000000000000000000000000008` | Expired benefit with another overlapping entitlement | Needs review |
| `00000000000000000000000000000009` | Unknown product | Needs review |
| `00000000000000000000000000000010` | Two purchases, only one delivered | Select the disputed purchase, then receive its recommendation |
| `00000000000000000000000000000011` | Query throws repeatedly | Operational error, Retry button |
| `00000000000000000000000000000012` | Query remains pending | Ten-minute timeout, Retry button |
| `00000000000000000000000000000013` | Truncated result | Needs review |
| `00000000000000000000000000000014` | Uncertain transaction matching | Needs review |
| `00000000000000000000000000000015` | No purchases | Needs review |

**View evidence** sends a private, paginated message to the requesting CS agent in the same channel. Each page contains up to five entries. Full purchase assessments precede the normalized event timeline. The main assessment covers the selected purchase; the evidence history retains other purchases for context.

## Install and configure

1. Copy settings from `environment.example` into your existing environment configuration. Set `REFUND_REVIEW_MODE=demo`. Use separate demo Slack credentials and a test channel initially. Existing production database settings and `CRON_SECRET` are required on Vercel.
2. Create a Slack app from `slack-app-manifest.json`, replacing `https://YOUR_HOST` with the deployed host. Set the signing secret and installed bot token in the server environment. Never commit their values.
3. Set `SLACK_REFUND_TEAM_ID` and `SLACK_REFUND_CHANNEL_IDS` to Slack IDs, not display names. Install the app and invite it to the configured channel. The intended production channel is `#stacksmash-cs`, but its ID must be configured explicitly.
4. Slack URL verification uses the signed Events endpoint. Enable the `app_mention` subscription and the interactions URL specified in the manifest. Bot scopes are `app_mentions:read` and `chat:write`; channel-history scopes are not needed.
5. Deploy on a Vercel plan supporting a once-per-minute cron. The added `/api/cron/refund-review` route uses the existing `CRON_SECRET`. The first worker call creates the queue table and index; invoke it once before Slack testing to validate database connectivity.
6. Run the live acceptance checklist below in the test channel. Switch channel configuration to the CS channel only after the demo is accepted.

Vercel Cron invokes production deployments. For local or preview testing, call the protected worker route manually with the configured bearer secret. The worker does not run automatically in `next dev`. Local persistence uses the existing SQLite file, or `REFUND_REVIEW_SQLITE_PATH` for a separate test database. The `sqlite3` executable must be installed.

Configuration and installation are not performed by the source implementation. Live mode is implemented but is not enabled by these source changes. To enable it after validation, set `REFUND_REVIEW_MODE=live` and configure the existing Count connection settings. Demo and live jobs retain their original mode; a changed mode requires a new mention.

## Lifecycle and operations

- Signed request → validate workspace/channel → insert deduplicated job → acknowledge Slack. No query or Slack Web API call blocks the event acknowledgement.
- Every-minute worker → claim a 90-second lease → post progress → persist message ID → submit/poll provider → persist assessment → update the same message.
- The progress message normally appears on the next worker tick; the HTTP acknowledgement is separate and immediate after persistence. Database stalls can exceed Slack's three-second budget; Slack retries are deduplicated by event ID.
- Workers claim one job at a time, use guarded lease-token updates, and work for up to 25 seconds or 20 jobs per invocation. Each Slack call has an eight-second timeout. Provider implementations must use bounded network calls compatible with the lease and function duration.
- Pending queries are revisited every minute. Checks time out after ten minutes, reported at the next worker tick. Transient failures back off, respecting Slack `Retry-After` even when that postpones the timeout notification. Four failures produce an operational error; delivery retries stop after eight failures or a permanent Slack error.
- Retry creates one new attempt per failed job; repeated clicks reuse it. A retry does not overwrite the original result. The query adapter receives a stable request key. Count submission is read-only and uses its default cache policy; a crash before saving the query key can submit a duplicate query. Count does not provide an idempotency-key contract here.
- The protected cron response returns `processed`, `pending`, and `deliveryFailed` counts, without customer data. A nonzero delivery-failure count means an operator must inspect credentials/channel access or Slack availability. After fixing access, CS can issue a fresh mention. A completely unavailable Slack service cannot display a failure or Retry button.
- A deterministic `client_msg_id` is reused for initial message delivery. The persisted timestamp prevents normal retry duplication. A crash after Slack accepts a message but before its timestamp is saved remains an ambiguous external-delivery window; exactly-once posting across Slack and the database is not guaranteed.
- Ephemeral pages are asynchronous, can take one worker tick, and may be duplicated after an ambiguous delivery failure. They are not durable Slack records.
- Queue records, normalized evidence, and retry state expire after 30 days and are removed by the worker. Expired interactions are rejected. This retention applies to app storage; Slack channel messages follow the workspace's own retention settings.
- Routes and worker responses never log request bodies, full IDFVs, normalized traces, tokens, SQL, or provider exception messages. Keep infrastructure request-body capture disabled for these endpoints.

## Live query and product catalog

`REFUND_REVIEW_MODE=live` selects the Count/Snowflake provider. Required existing app settings are `COUNT_API_KEY`, `COUNT_CONNECTION_KEY`, and either `COUNT_CONTEXT_KEY` plus `COUNT_CONTEXT_TYPE`, or `COUNT_PROJECT_KEY`. `COUNT_API_BASE_URL` retains the app's existing default. Each request has an eight-second timeout so it can be retried within the worker lease.

The production query is `data/refund-review/event-trace.sql`, adapted from the supplied **Users Events Trace.sql**. The fixed app ID is 3011. The builder validates a normalized IDFV and fixed UTC timestamps before substitution. The original supplied SQL and CSV files are left intact.

The device lookup uses `UNION` and `EXISTS` to avoid multiplying events when the same external ID appears in both device mapping tables. The query examines all five supplied event types inside a 90-day window, then returns compact facts: purchase/ad boundaries, daily activity and ad counts, and resource movements within two minutes of a purchase in the same session. It preserves signed receipt/spend amounts rather than calling every `source=purchase` event a grant.

The Count client has a 1,000-row preview cap. The query therefore summarizes in Snowflake before retrieval. An explicit `TOTAL_FACTS` count is repeated on each output row; the parser checks it against received rows and reconciles daily counts against total events. A missing count, truncation, malformed record, or unexplained mismatch blocks recommendations. A response of 1,000 or more facts also requires review rather than silently assuming completeness.

The catalog is a checked-in copy of **Stack Smash Game Product.csv**, with all 22 IDs. Only known benefit descriptions are interpreted. Notes are data, never executable instructions. Products 905 and 904 have temporary no-ads; 903 does not. Bundles labeled No Ads are treated as intended ongoing benefits, but activation/restoration/revocation are not established by this trace.

### Evidence-based rules

- **VIP temporary no-ads:** recommend against the interstitial-ad complaint when there is a pre-purchase interstitial, subsequent observed play with rewarded ads and no interstitials, and later resumed interstitials. Require at least two active calendar days and 48 elapsed hours to avoid interpreting a short gap as a season. These are evidence thresholds, not a season duration. Label the conclusion **inferred**, never an exact expiry. Conflicting no-ads or unknown-product purchases, ambiguous ownership, missing transaction IDs, offline purchase records, and incomplete output require review.
- **Permanent no-ads:** rewarded-only post-purchase activity supports a recommendation against that ad-format complaint. Interstitials after purchase are flagged as a potential entitlement failure needing activation/restoration checks.
- **Coin/item delivery:** display positive receipts separately from negative spending. A nearby credit can appear milliseconds before purchase success, so inspect both sides of the timestamp. The ±2-minute same-session association is explicitly tentative. Without exact bundle quantities and direct transaction linkage, return **Needs review** instead of claiming complete delivery or approving a refund from missing events.
- Purchase-success telemetry records what the game logged; it is not independent payment-provider verification. An absence of ad events describes the retrieved trace, not guaranteed telemetry completeness.
- The live query has no entitlement-expiry field or ingestion watermark. Report **last observed activity**, not “data complete through.” Never fabricate a fixed 14-day season from this one example.

The original generic demo rules remain available for explicit-entitlement fixtures. Live observations use a separate assessment path, so missing entitlement rows cannot be mistaken for confirmed expiry.

See [the supplied case review](sample-review.md) and its [Slack Block Kit payload](sample-response.json). The regression fixture keeps compact facts and anonymized transaction IDs rather than copying customer payloads into the repository.

## Remaining live validation

Before deployment, compile/run the adapted SQL against the configured Count/Snowflake connection, compare its facts with the supplied CSV for the same cutoff, and exercise the Slack test channel. These changes do not run a production query or install/deploy the app. Exact season dates, bundle quantities, transaction-to-grant links, and a telemetry watermark are still needed for confirmed entitlement/delivery determinations.

## Verification

Run:

```sh
npx vitest run tests/refund-review.test.ts tests/refund-review-trace.test.ts tests/slack-delivery.test.ts
npm run build
```

Tests use temporary real SQLite databases and mocked Slack HTTP responses. They cover signing/replay protection, input validation, rule outcomes, boundaries, incomplete evidence, queue leases/recovery, deduplication, retries, timeouts, thread placement, evidence authorization, and retention. Tests also reconcile the supplied CSV through 8 September when that local file is available; the anonymized fact fixture runs in all environments. Production Snowflake/Postgres execution and real Slack delivery require environment testing.

### Live test-channel acceptance

- Mention each synthetic ID and check the expected recommendation, timestamps, evidence references, and DEMO label.
- Test a top-level mention and a mention inside an existing thread. Check that updates stay in that thread.
- Try invalid and multiple IDs. Confirm no query result is produced.
- Open evidence, move forward/back, and confirm only the requesting agent sees the page.
- Run timeout/error fixtures and click Retry twice; confirm a single new attempt.
- Mention from a channel outside the allowlist; confirm no customer data is posted.
- Check the protected worker counters and confirm no delivery failures.

References: [Slack Events API](https://docs.slack.dev/apis/events-api/), [Slack app mentions](https://docs.slack.dev/reference/events/app_mention/), [Vercel cron frequency requirements](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Dispute details and transaction selection

An IDFV-only mention now returns **Add dispute details**. Click to open a form requiring dispute type, with optional purchase date (UTC), purchase amount (USD) and ticket date (UTC). Submitting queues the check in the original authorized channel/thread. No surrounding messages are read.

Alternatively supply fields directly:

`@Refund Review 38645146fe0ea5644f7853ee3d88f77e dispute:no_ads purchase:2026-08-19 usd:14.99 asof:2026-09-08`

Use `dispute:items` for **Items / coins not received**, or `dispute:no_ads` for **No ads not working**. Date and amount are exact candidate filters, not evidence of entitlement expiry. No match or multiple matches produces **Review this purchase** buttons, with mismatches labeled for CS confirmation. The first 20 candidates are shown in Slack; use CS Assistance for the full list. Retries retain the original dispute and filters.

Reinstall-generated user IDs no longer prevent assessment. Demo fixtures with no recorded USD price cannot match an amount automatically; select the candidate explicitly. Existing Slack signing, channel authorization, deduplication, and queue persistence also apply to form submissions and candidate selection.

## Response hierarchy

Main messages show recommendation, finding and next step first, then purchase/dispute context. **View evidence** retains paginated private evidence. **View check details** sends coverage, freshness and limitations privately in the same thread, authorized against the original workspace/channel. Inference and important uncertainty remain visible in the main message. Neither button starts a new warehouse query.
