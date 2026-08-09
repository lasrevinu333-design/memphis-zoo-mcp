# Environment Variables

This document lists the environment variables used by the Memphis Zoo MCP backend.

## Runtime

| Name | Required | Purpose |
|---|---:|---|
| `NODE_ENV` | No | Runtime mode. Usually `production` on Render. |
| `PORT` | Render sets it | Express listen port. |
| `APP_NAME` | No | MCP server display name. |

## MCP connector access

| Name | Required | Purpose |
|---|---:|---|
| `MCP_CONNECTOR_TOKEN` | Recommended | Dedicated bearer/custom-header token for service clients and strict legacy SSE access. |
| `MCP_ALLOW_FULL_NOAUTH` | No | Tokenless Streamable HTTP access to the complete GitHub and Supabase MCP tool set. Defaults to `true` for the connected ChatGPT app. Set `false` to fall back to read-only access. |
| `MCP_ALLOW_READONLY_NOAUTH` | No | Tokenless diagnostic/read-only fallback when full no-auth access is disabled. Defaults to `true`. |

MCP access precedence is: a valid presented connector token receives full access; a presented invalid token is rejected; a tokenless request receives full access when `MCP_ALLOW_FULL_NOAUTH` is enabled, otherwise read-only access when `MCP_ALLOW_READONLY_NOAUTH` is enabled, otherwise it is rejected. Legacy SSE explicitly disables both tokenless modes.

The production `/mcp` URL is public. Enabling full tokenless access therefore authorizes any client that reaches that endpoint, not only the ChatGPT UI. Repository allowlists, dry-run defaults, expected-SHA checks, and migration-size limits still apply.

## GitHub

| Name | Required | Purpose |
|---|---:|---|
| `GITHUB_OWNER` | Yes | GitHub owner or organization, for example `lasrevinu333-design`. |
| `GITHUB_REPO` | Yes | Default repo name, for example `memphis-zoo-mcp`. |
| `GITHUB_ALLOWED_REPOS` | Recommended | Comma-separated repo allowlist. Defaults to `GITHUB_REPO`. |
| `GITHUB_BRANCH` | No | Default branch. Defaults to `main`. |
| `GITHUB_TOKEN` | Yes | Token used by MCP GitHub tools. |
| `GH_TOKEN` | Optional fallback | Alternate token name if supported by a tool path. |

## Supabase

| Name | Required | Purpose |
|---|---:|---|
| `SUPABASE_URL` | Yes | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key for trusted server-side RPC calls. |

## Admin / Ops API

| Name | Required | Purpose |
|---|---:|---|
| `ADMIN_API_KEY` | **Yes in production** | Server-to-server/admin automation key accepted via `X-Admin-Key` / `X-API-Key`. |
| `RESTROOM_REBALANCE_SWEEP_MS` | No | Automatic 09:45 restroom scheduler interval. Defaults to `60000` only on the production Render service. Local and pull-request runtimes are hard-disabled even if given a positive override. Set `0` as an explicit production kill switch. Invalid values disable the scheduler. |
| `OPS_MANAGER_FULL_ACCESS_KEY` | **Yes in production for Ops UI writes** | Full-access Ops Manager public-link key accepted via `X-Ops-Access-Key`; mints signed bearer sessions for protected read/write routes. |
| `OPS_MANAGER_READ_ONLY_ACCESS_KEY` | Recommended | Read-only Ops Manager public-link key accepted via `X-Ops-Access-Key`; mints signed bearer sessions for protected read routes only. |
| `OPS_MANAGER_SESSION_SECRET` | Recommended | HMAC secret used to sign Ops Manager bearer sessions. If unset, the backend falls back to existing secret material; set this explicitly on Render before public use. |
| `OPS_AUTH_OPEN_MODE` | Local/dev only | Explicit local development open mode. Ignored on Render/production and must not be used for public deployments. |

### Native Ops Manager device authority v2

The Android and iOS Ops Manager apps use hardware-backed signing/wrapping keys
and platform attestation. Keep the feature disabled until its forward-only
database migration is present and every required value below passes strict
runtime validation.

| Name | Required | Purpose |
|---|---:|---|
| `MANAGER_V2_ENABLED` | Yes to expose v2 | Feature gate for `/manager-device-auth/v2/*`; defaults closed. |
| `MANAGER_V2_SERVER_SECRET` | **Yes when enabled** | Stable, dedicated secret (at least 32 bytes) for credential verifiers, idempotency fingerprints, challenges, session-token verifiers, and privacy-preserving rate keys. Rotating it intentionally invalidates every v2 device credential and session. |
| `SUPABASE_DB_URL` or `DATABASE_URL` | **Yes when enabled** | Direct PostgreSQL connection used for serializable device-authority transactions. |
| `SUPABASE_DB_CA_CERT_PATH` | **Yes for remote PostgreSQL** | PEM CA bundle used with hostname verification. `sslmode=require` and certificate-validation downgrades are rejected. |
| `MANAGER_V2_ATTESTATION_POLICY_JSON` | **Yes when enabled** | Exact allowlist for Android package/signing certificates/builds and iOS App ID/environment/categories/bundle versions. The server derives a policy fingerprint, so a change invalidates outstanding attestation challenges and cached verdicts. |
| `GOOGLE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON` | **Yes when Android is allowed** | Google service-account JSON used only by the backend to decode Play Integrity verdicts. |
| `MANAGER_V2_SWEEP_INTERVAL_MS` | No | Expired operation/session/nonce sweep interval, bounded to 30–300 seconds. |

The iOS `app_id` must be the deployed App Attest identity in the form
`<real-10-character-TeamID>.org.memphiszoo.ops`. Test or golden-vector Team IDs
must never be copied into production. Android policy must name the exact
production package, production signing-certificate SHA-256 digest, minimum
version code, and—when used—the explicit allowed-version set. Treat the policy
and CA bundle as deployment-controlled configuration. Never commit the Google
service-account JSON, a credential-bearing database URL, the server secret, or
any private key material.

Render production must have at least one valid Ops/Admin credential before protected routes are publicly usable. If keys were missing while public routes were reachable, generate fresh keys and rotate any previously shared public-link/admin keys before enabling the deployment.

## Memphis AI / Gemini

| Name | Required | Purpose |
|---|---:|---|
| `GEMINI_API_KEY` | Recommended | Gemini API key for Memphis AI. |
| `GEMINI_CONSOLE_API_KEY` | Optional dedicated key | Dedicated key for the trusted-manager Gemini Console. Falls back to the existing approved Gemini key chain. |
| `GOOGLE_API_KEY` | Optional fallback | Alternate Gemini API key variable. |
| `MEMPHIS_GEMINI_MODEL` | No | Model override for Memphis AI. |
| `GEMINI_CONSOLE_MODEL` | No | Model override for the Gemini Console. Defaults to the approved `gemini-2.5-flash` model. |
| `GEMINI_MODEL` | No | General model fallback. |

## Moxie — Annie's Private Assistant

| Name | Required | Purpose |
|---|---:|---|
| `MOXIE_WEB_PASSWORD` | **Yes** | Sign-in password for Moxie web UI. The field is never prefilled or embedded in page source. |
| `MOXIE_WEB_COOKIE_SECRET` | **Yes** | HMAC secret for session cookies. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `MOXIE_AUTH_REQUIRED` | No | Local/test override. Production and Render always require Moxie authentication; `false` is honored only outside production. |
| `MOXIE_WEB_USER` | No | Username. Defaults to `annie`. |
| `MOXIE_PREFIX` | No | URL prefix. Defaults to `/moxie`. |
| `MOXIE_PUBLIC_URL` | No | Public base URL for Moxie (used in links). |
| `MOXIE_GEMINI_API_KEY` | No | Dedicated Gemini key for Moxie. Falls back to `GEMINI_API_KEY` / `MEMPHIS_GEMINI_API_KEY` / `GOOGLE_API_KEY`. |
| `MOXIE_GEMINI_MODEL` | No | Model override. Falls back to `MEMPHIS_GEMINI_MODEL` / `GEMINI_MODEL` / `gemini-2.5-flash`. |
| `MOXIE_GEMINI_TIMEOUT_MS` | No | Request timeout. Defaults to 30000. |
| `MOXIE_GEMINI_MAX_OUTPUT_TOKENS` | No | Max output tokens. Defaults to 4096. |

## Attendance scraping

| Name | Required | Purpose |
|---|---:|---|
| `ND_MEMZOO_ATTENDANCE_URL` | No | Attendance source URL. Defaults to `https://nd.memzoo.org`. |
| `ND_MEMZOO_ATTENDANCE_TIMEOUT_MS` | No | Fetch timeout. |
| `ND_MEMZOO_ATTENDANCE_CACHE_MS` | No | Cache time. |
| `ND_MEMZOO_CF_CLEARANCE` | No | Optional Cloudflare clearance cookie. |

## Safety notes

- Never commit actual secrets.
- Do not print tokens or service role keys in logs.
- Use `src/utils/redact-secrets.js` before returning config or error details from diagnostics.
