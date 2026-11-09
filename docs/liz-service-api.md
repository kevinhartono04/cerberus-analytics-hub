# Liz service API

Status: implemented; disabled unless the server token hash is configured. Merging this code does not generate a credential or configure the server hash.

Liz has a dedicated service identity (`service:liz`) and access to all games and
all saved specs through `/api/service`. This includes editing specs owned by
humans. It has no delete, game-management, user-administration, code-editing, or
deployment capability. These explicit bot permissions are separate from human
editor ownership rules; Google sign-in and human routes remain unchanged.
The service uses the existing spec schema and storage functions.

## Activate

1. Run `node scripts/create-liz-token.mjs` in a private terminal.
2. Put the printed `CEREBRAL_LIZ_TOKEN_SHA256` value in Cerebral's server environment
   for the intended deployment. Never use a `NEXT_PUBLIC_` variable.
3. Store the raw `liz_...` token in Liz's secret manager. Configure its HTTP tool to
   send `Authorization: Bearer <token>` to your Cerebral HTTPS domain. Keep secrets
   out of prompts, URLs, source code, and logs.
4. Deploy this code with that environment variable. No database migration is needed.
5. Verify `GET /api/service/games` succeeds with the token and returns 401 without
   it. Verify `DELETE /api/service/specs/example` returns 403 with a valid token.
   Test writes against a disposable spec in a staging environment before production.

Missing, malformed, or incorrect token configuration fails closed, including in
development. Human cookies and test-user headers cannot authenticate these routes.
The bot token does not authenticate the existing human `/api/specs` endpoints.

## HTTP contract

All calls require the bearer token. Responses have `Cache-Control: no-store` and
an `X-Request-Id`. There are no additional allowed service operations.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/service/games` | `{ games, canManage: false }` |
| GET | `/api/service/specs` | Array of spec summaries; `canEdit: true`, `canDelete: false` |
| GET | `/api/service/specs/{id}` | Full saved spec |
| POST | `/api/service/specs` | Create a spec; returns summary with HTTP 201 |
| PUT | `/api/service/specs/{id}` | Replace an existing spec; returns summary |

POST and PUT accept the full `GeneratedSpec` JSON described by
`generatedSpecSchema` in `lib/types.ts`, not partial patches or natural-language
instructions. POST assigns a new ID, ignoring any submitted ID. PUT requires its
body ID to match the URL and returns 404 when the spec does not exist. Use GET to
retrieve a spec, modify the desired fields, and PUT the entire object back.
Writes follow existing last-write-wins behavior: coordinate concurrent edits.
POST is not idempotent; reconcile the returned ID/list before retrying after an
ambiguous network failure to avoid duplicates.

Invalid credentials return 401, unsupported operations 403, missing specs 404,
invalid JSON/specs 400, and storage failures 500.

## Attribution, rotation, and revocation

New specs record Liz as owner. Editing existing specs preserves their owner.
Every handled request emits a structured `cerebral.service_access` server log
with actor, action, spec ID when available, timestamp, request ID, and outcome.
It excludes tokens and spec contents. These are operational audit logs, not an
atomic database audit trail: retention depends on deployment logging, and a
process crash can interrupt logging. Configure retained logs before production
if long-term edit attribution is required.

Rotate by generating a new token, replacing the server hash, redeploying/restarting
the server, and updating Liz's secret. Only one token is accepted at a time.
Revoke by removing the hash and redeploying/restarting all serving instances.
Ensure obsolete deployments are no longer reachable when revoking a token.
