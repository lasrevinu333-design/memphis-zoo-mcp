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

## Admin API

| Name | Required | Purpose |
|---|---:|---|
| `ADMIN_API_KEY` | Recommended | Required for protected admin API routes. |

## Memphis AI / Gemini

| Name | Required | Purpose |
|---|---:|---|
| `GEMINI_API_KEY` | Recommended | Gemini API key for Memphis AI. |
| `GOOGLE_API_KEY` | Optional fallback | Alternate Gemini API key variable. |
| `MEMPHIS_GEMINI_MODEL` | No | Model override for Memphis AI. |
| `GEMINI_MODEL` | No | General model fallback. |

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
