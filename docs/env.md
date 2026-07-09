# Environment Variables

This document lists the environment variables used by the Memphis Zoo MCP backend.

## Runtime

| Name | Required | Purpose |
|---|---:|---|
| `NODE_ENV` | No | Runtime mode. Usually `production` on Render. |
| `PORT` | Render sets it | Express listen port. |
| `APP_NAME` | No | MCP server display name. |

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
| `OPS_MANAGER_FULL_ACCESS_KEY` | **Yes in production for Ops UI writes** | Full-access Ops Manager public-link key accepted via `X-Ops-Access-Key`; mints signed bearer sessions for protected read/write routes. |
| `OPS_MANAGER_READ_ONLY_ACCESS_KEY` | Recommended | Read-only Ops Manager public-link key accepted via `X-Ops-Access-Key`; mints signed bearer sessions for protected read routes only. |
| `OPS_MANAGER_SESSION_SECRET` | Recommended | HMAC secret used to sign Ops Manager bearer sessions. If unset, the backend falls back to existing secret material; set this explicitly on Render before public use. |
| `OPS_AUTH_OPEN_MODE` | Local/dev only | Explicit local development open mode. Ignored on Render/production and must not be used for public deployments. |

Render production must have at least one valid Ops/Admin credential before protected routes are publicly usable. If keys were missing while public routes were reachable, generate fresh keys and rotate any previously shared public-link/admin keys before enabling the deployment.

## Memphis AI / Gemini

| Name | Required | Purpose |
|---|---:|---|
| `GEMINI_API_KEY` | Recommended | Gemini API key for Memphis AI. |
| `GOOGLE_API_KEY` | Optional fallback | Alternate Gemini API key variable. |
| `MEMPHIS_GEMINI_MODEL` | No | Model override for Memphis AI. |
| `GEMINI_MODEL` | No | General model fallback. |

## Moxie — Annie's Private Assistant

| Name | Required | Purpose |
|---|---:|---|
| `MOXIE_WEB_PASSWORD` | **Yes** | Sign-in password for Moxie web UI. |
| `MOXIE_WEB_COOKIE_SECRET` | **Yes** | HMAC secret for session cookies. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
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
