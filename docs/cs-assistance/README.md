# CS Assistance

Open `/cs-assistance` in Cerebral. Sign in with an internal account, enter a Stack Smash IDFV, optionally choose the ticket date, then select **Check player**. **Use the VIP Pass example** fills the supplied example and 8 September 2026 without running a query automatically.

The page queries the live Count/Snowflake connection, independent of Slack demo mode. It displays the shared refund assessment and bot wording, an evidence view with daily ads and nearby signed coin/item movements, and an explanation of the current rules. No Slack messages or refunds are sent. Inputs and results stay in page memory; refresh clears them.

## API and access

- `POST /api/cs-assistance` accepts `{ idfv, asOf? }` and returns an encrypted, user-bound polling token with a ten-minute expiry.
- `POST /api/cs-assistance/status` accepts `{ token }` and returns pending or the completed assessment, bot text sections and check timestamp.
- Both endpoints authenticate via existing Cerebral sessions and require an internal account. They reject cross-origin browser requests and send `Cache-Control: no-store`. Provider errors are redacted.
- The existing `AUTH_SECRET` encrypts query context consistently across serverless functions. There are no new database tables or migrations. Count query keys are not accepted directly from a client.
- Configuration reuses `COUNT_API_KEY`, `COUNT_CONNECTION_KEY`, `COUNT_PROJECT_KEY` (or the existing Count context settings), and `AUTH_SECRET`. Set a stable `AUTH_SECRET` for local development too; Google auth remains optional locally under the existing app rules.

## What is checked

The shared code under `lib/refund-review` maps all 22 supplied products. The fixed query window is 90 days ending now or at the selected UTC day's end. The latest day is capped at the current time. No later events enter a historical review.

VIP Pass recommendations distinguish observed ad history from inferred season expiry. The temporary-benefit inference requires a pre-purchase interstitial, subsequent activity with no recorded interstitials and rewarded ads, at least two active calendar dates and 48 elapsed hours, then returning interstitials. These thresholds do not establish the actual season length. Exact expiry remains unavailable. Nearby grants can precede purchase success by milliseconds; positive receipts and negative spending remain separate. Missing quantities or direct transaction links require manual review.

The SQL preserves the supplied query's exclusion of purchase-success events without a product ID. It uses a device semi-join and produces compact purchase, daily, resource and metadata facts with an explicit total-fact count. Truncated or incomplete output cannot support a recommendation. Purchases older than the query window, season expiry and telemetry ingestion completeness remain limitations.

## Verification

- API tests cover internal access, rejected origins, invalid inputs, query tokens, expiry, redacted failures and shared bot results.
- UI tests cover explicit submission, example inputs, result tabs, error states and external-account restrictions.
- The supplied real IDFV with cutoff 8 September 2026 was run against Count/Snowflake: **9,528 events**, **2 purchases**. VIP Pass ($14.99, product 905) receives **Recommend not eligible (inferred)**; Starter Bundle ($1.99, product 910) receives **Needs review**.
- The previous Slack queue/cron is not introduced by this release. Existing Cerebral database and alert configuration are unchanged.

Run `npm test` and `npm run build`. Browser verification should cover an empty page, example fill, real query result, evidence and logic tabs, and a narrow mobile viewport.
