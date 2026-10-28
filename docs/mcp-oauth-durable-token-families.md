# Durable self-contained MCP OAuth token families — source-only recovery proposal

**Not activated. No SQL has been run. Do not publish or deploy this proposal until the owning local PostgreSQL tests and rollout review pass.**

## Session preservation and the explicit compatibility break

The previous self-contained OAuth service tracked consumed authorization decisions, codes and refresh tokens in each process's private Map. That history cannot be recovered truthfully after a restart or across instances. No existing record can prove which old refresh tokens have already been consumed.

This proposal adds `durable_version: 2` to authorization requests, authorization codes, access tokens and refresh tokens. On activation, **all previously issued self-contained MCP OAuth access and refresh tokens, and old in-flight authorization/consent/code flows, will be rejected. Those clients must complete normal operator authorization again.** Existing sealed client registrations retain their format and signing keys and can start a fresh flow. There is no backfill, invented consumption ledger, silent token upgrade, or insecure grace fallback.

The ordinary manager enrollment/trust/session machinery, browser cookies, employee device credentials, signing keys and legacy `MCP_CONNECTOR_TOKEN` request paths are untouched. They are not revoked or rotated by this migration. This does not promise preservation of old self-contained OAuth sessions. The owner's preserve-sessions requirement therefore blocks activation until a concrete rollout plan explicitly admits that narrower reauthorization consequence and retires every old process that can still issue or validate the vulnerable format. A mixed old/new rolling deployment is not a completed security cutover.

## Durable operations

Two RLS-enabled tables hold only domain-separated digests, generation numbers, expiry and revocation metadata. Raw authorization codes, access tokens, refresh tokens and root keys are not stored in those tables.

- A consent decision is consumed once by its authenticated artifact digest.
- Initial exchange inserts the one-use code digest and its token family in one transaction. A failed family insertion rolls back code consumption.
- Refresh locks the family row. Exact current digest and generation advance once. A valid cryptographic refresh artifact from an older generation commits `refresh_reuse` revocation of the whole family, then returns refusal. This path returns `false`; it does not raise an exception that would roll back the revocation.
- Every OAuth bearer request and the SDK verifier check that the authenticated token's exact issuer/client/resource/operator-bound family remains active in the shared authority. The exported standalone `verifyMcpOAuthAccessToken` remains a cryptographic parser used by inert fixtures; it is not a complete revocation verifier. Production service callers use the asynchronous `verifyAccessToken` or middleware.

All five RPCs are `SECURITY INVOKER` with a fixed search path, bounded lock/statement timeouts, and explicit `REVOKE` of default `PUBLIC`, `anon` and `authenticated` execution. Only `service_role` receives RPC execution and the required table permissions. Public browser roles have no direct table access. The existing backend service-role environment remains server-side. A missing/unavailable store fails closed; there is no process-local fallback.

## Failure and delivery semantics

Signing and sealing happen before the durable transaction. A signing/serialization failure therefore cannot consume a code or rotate a refresh artifact. SQL failures roll back their transaction. The server returns token bodies only after a strict boolean success acknowledgement from the RPC.

If sealing a new login flow fails, the server returns503 without an artifact. If code sealing fails after a durable consent decision was consumed, it returns503 without a code; that nonce stays consumed and the operator starts a fresh normal authorization flow. There is no silent reissue.

An acknowledgement timeout or transport error may occur after the database commits. The server withholds tokens and returns `temporarily_unavailable`, directing the client to start normal authorization again. It does not retry, remint, or infer rollback. If a client maliciously or accidentally repeats a possibly consumed refresh token, normal reuse handling may revoke that family; unrelated families remain valid. A response lost after commit is intentionally not recoverable by returning a stored raw token. Consumed-artifact rows must not be pruned while their signed artifacts could still be accepted. Family expiry and reuse checks use database time, including after row-lock acquisition.

## Restored data cannot rewind OAuth authority

Authorization requests/consent, codes, access tokens, refresh tokens and family rows bind the exact non-restored `custodial_dr.restore_control.authority_generation`. The generation is carried as a decimal string so JavaScript cannot round a PostgreSQL bigint. Each atomic consume, exchange, refresh and access-validation RPC obtains the existing service-authorized `public.custodial_begin_application_mutation()` shared transaction fence and compares that exact current generation. The normal restore takes the exclusive side before advancing authority and importing application data, so the generation cannot change between a successful check and that RPC's commit. The small generation accessor reuses this same existing function and returns `bigint::text`. No direct `custodial_dr` schema/table grant or new SECURITY DEFINER is introduced.

The protected schema is excluded from the normal restore source table selection. Rolling public token-family/artifact rows back to an earlier backup therefore does not let an old refresh, old access token, old unconsumed authorization code or old unconsumed consent authorize against the new authority. Source-only model tests restore the old family current-refresh state while retaining an incremented non-restored generation, reject every old artifact, then authorize a normal new-generation family. The owning SQL test source includes that exact boundary, but has not run. No independently owned restore source is changed.

## Verification and bounded next step

Completed source-only qualification:

- Actual mounted HTTP authorization/PKCE/consent/rotation tests using a shared recording atomic authority: 54 checks, including two independent service instances, reconstruction, concurrent refresh, family-wide reuse rejection, rollback/unknown acknowledgement and application-data rollback across a new non-restored generation. This model is not a PostgreSQL persistence claim.
- Newly asynchronous login-flow/code sealing failures: 11 actual HTTP checks, no SQL.
- Actual Supabase client RPC adapter with intercepted synthetic fetch: 10 checks, no network or SQL.
- Maintained OAuth wire owner passed, including PKCE, CSRF, rate limiting, scopes, SDK request propagation and unchanged legacy connector behavior. Its synthetic authority is explicitly injected.
- Retained Outlook/client-identity owner passed 64 cases; only its actual private-helper fixture import/family argument changed.

`scripts/mcp-oauth-durable-family-database-tests.mjs` exports a deliberately non-standalone owning test. The admitted caller must apply this exact migration to its existing owned unpublished current-schema PostgreSQL fixture, pass its real Pool and fixture custody assertion, and run it once. It tests service-role-only ACLs/RLS, code/decision replay across connections, atomic concurrent refresh plus committed family revocation, transaction rollback, uniqueness-failure rollback and expiry after waiting for a row lock. It deletes only its own generated digest rows. It must not be pointed at production or a generic database URL. Those SQL tests have not run.

Only after those results and the compatibility/old-instance retirement plan are reviewed can a normal candidate/source review and separately authorized activation be considered. Existing source/provenance and runtime receipts retain their original source scope.
