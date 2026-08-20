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
| `MCP_CONNECTOR_TOKEN` | **Required for mutation** | Dedicated bearer/custom-header token for authenticated service clients and legacy SSE access. |
| `MCP_ALLOW_FULL_NOAUTH` | Retired | Ignored and always fail-closed. Tokenless clients never receive GitHub or Supabase mutation tools. |
| `MCP_ALLOW_READONLY_NOAUTH` | No | Optional tokenless diagnostic-only surface. Defaults to `false`; when enabled it exposes no GitHub or Supabase adapter. |

MCP access precedence is: a valid presented connector token receives the scoped authenticated tool set; a presented invalid token is rejected; a tokenless request receives only the diagnostic-only server when `MCP_ALLOW_READONLY_NOAUTH=true`, otherwise it is rejected. Legacy SSE is token-only.

The production `/mcp` URL is public. Connected clients must therefore carry the dedicated connector credential; UI provenance is not an authorization boundary.

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
| `CUSTODIAL_READONLY_DATABASE_URL` | Yes in production | Dedicated PostgreSQL login for application and MCP reads. It must inherit only `custodial_application_reader`, have no `BYPASSRLS`, and must not be an admin, `postgres`, service-role, or migration credential. Every query runs inside an explicit `READ ONLY` transaction. |

## Static weekly scheduler control plane

The scheduler authority is a separate process, not part of the ordinary API
service. Its database login must be the only provisioned identity able to
`SET ROLE static_weekly_control_plane`; the ordinary Supabase service role must
not receive that membership, a scheduler signing key, or execute rights on any
scheduler mutator.

| Name | Required | Purpose |
|---|---:|---|
| `STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL` | Yes, control-plane service only | Dedicated PostgreSQL login URL. It is not set on the ordinary API deployment. |
| `STATIC_WEEKLY_CONTROL_PLANE_PORT` | No | Listener port for `npm run start:static-weekly-control-plane`; defaults to `PORT` then `3100`. |
| `STATIC_WEEKLY_CONTROL_PLANE_ALLOWED_ORIGINS` | No | Comma-separated additional browser origins allowed to call the separated scheduler service. The Engine GitHub Pages origin and supported native origins are built in. |
| `STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL` | Yes, ordinary API deployment after the scheduler service exists | Public HTTPS origin returned by `GET /scheduler-runtime-config`; this is an address only and grants no scheduler authority. |
| `SUPABASE_URL` | Yes, control-plane service only | Required to construct the trusted-device revocation and manager-association store. The scheduler process refuses startup if it is absent. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes, control-plane service only | Required with `SUPABASE_URL` for trusted-device revocation and manager-association checks. The scheduler process refuses startup if it is absent. |

Before a first draft can be created, the release operator registers the
compiler-normalized, exception-free recurring source of record with
`static_weekly_v3_register_authority_source`. A manager requests only the
registered `source_id` and an effective date through the separate control
plane; it never posts roster, work, proximity, or compiler truth. Later
replacement drafts derive that source from the currently effective immutable
publication. The release operator provisions the first key through
`static_weekly_v3_configure_initial_authority_key`, then uses the v3 rotation,
revocation, and recovery procedures. Key values must be supplied only through
the release operator's protected session: they are never placed in app
environment variables, release evidence, command output, or database result
payloads. Rotation permits at most 24 hours of verification overlap; health
must report exactly one active key, no expired overlap, and a successful
internal sign/verify canary before release. Failed-active recovery names that
exact current active predecessor and atomically revokes it while installing one
distinct successor; it does not require an unsafe pre-revocation step.

The no-cost first canary service definition is
`deploy/static-weekly-control-plane.render.yaml`. It is intentionally set to
Render's free plan with automatic deployment disabled. Creating or syncing the
service is a separate production/account action; merging the file does not
create a resource. Before that action, production must have all repository
scheduler migrations through `20260812032055`, a dedicated login granted only
`static_weekly_control_plane`, one active authority key, and one hash-bound
verified schedule packet. The April candidate workbook is not that packet and
is never registration authority.

## Admin / Ops API

| Name | Required | Purpose |
|---|---:|---|
| `ADMIN_API_KEY` | **Yes in production** | Server-to-server/admin automation key accepted via `X-Admin-Key` / `X-API-Key`. |
| `RESTROOM_REBALANCE_SWEEP_MS` | No | Automatic 09:45 restroom scheduler interval. Defaults to `60000` only on the production Render service. Local and pull-request runtimes are hard-disabled even if given a positive override. Set `0` as an explicit production kill switch. Invalid values disable the scheduler. |
| `OPS_MANAGER_FULL_ACCESS_KEY` | **Yes in production for Ops UI writes** | Full-access Ops Manager public-link key accepted via `X-Ops-Access-Key`; mints signed bearer sessions for protected read/write routes. |
| `OPS_MANAGER_READ_ONLY_ACCESS_KEY` | Recommended | Read-only Ops Manager public-link key accepted via `X-Ops-Access-Key`; mints signed bearer sessions for protected read routes only. |
| `OPS_MANAGER_SESSION_SECRET` | Recommended | HMAC secret used to sign Ops Manager bearer sessions. If unset, the backend falls back to existing secret material; set this explicitly on Render before public use. |
| `OPS_AUTH_OPEN_MODE` | Local/dev only | Explicit local development open mode. Ignored on Render/production and must not be used for public deployments. |

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
