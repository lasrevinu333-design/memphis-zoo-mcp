# HTTP Routes

This document tracks the currently known HTTP routes. It is a map, not a replacement for the code.

Route factories for messaging, schedule, and events are re-exported from `src/routes/index.js`. `src/index.js` imports through that barrel so future route extraction can move behind one stable seam.

## Core

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Basic server running message. |
| `GET` | `/version` | Version and contract summary. |

## MCP

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/mcp` | Streamable HTTP MCP endpoint. |
| `GET` | `/mcp` | Returns method-not-supported message. |
| `GET` | `/sse` | Legacy SSE MCP endpoint. |
| `POST` | `/messages` | Legacy SSE message post endpoint. |

## Admin API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin-api/health` | Protected admin health check. |
| `POST` | `/admin-api/bundle` | Protected admin dashboard bundle. |
| `POST` | `/admin-api/attendance-update` | Protected attendance state update. |
| `POST` | `/admin-api/close-ticket` | Protected maintenance ticket close. |
| `POST` | `/admin-api/force-close-session` | Protected forced session close. |
| Various | `/admin-api/events` | Event admin routes. |

## Dashboard API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/dashboard-api/health` | Public dashboard health. |
| `GET` | `/dashboard-api/canary` | Dashboard canary checks. |
| `GET` | `/dashboard-api/current-attendance` | Attendance payload. |
| `GET` | `/dashboard-api/summary` | Dashboard summary. |
| `POST` | `/dashboard-api/close-ticket` | Dashboard maintenance ticket close. |
| Various | `/dashboard-api/events` | Public event routes. |

## Scan API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/scan-api/health` | Scan API health and allowlist. |
| `POST` | `/scan-api/rpc` | Scan RPC gateway for allowlisted Supabase functions. |

## Messaging API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/messaging-api/health` | Messaging health and Memphis AI diagnostics. |
| `GET` | `/messaging-api/me/by-device` | Device identity lookup. |
| `GET` | `/messaging-api/users` | List messaging users. |
| `GET` | `/messaging-api/threads` | List threads. |
| `GET` | `/messaging-api/thread/:threadId/messages` | List thread messages. |
| `POST` | `/messaging-api/thread/direct` | Create/get direct thread. |
| `POST` | `/messaging-api/thread/group` | Create group thread. |
| `POST` | `/messaging-api/thread/:threadId/message` | Send message. |
| `POST` | `/messaging-api/thread/:threadId/delete` | Delete thread. |
| `POST` | `/messaging-api/thread/:threadId/read` | Mark thread read. |
| `POST` | `/messaging-api/memphis/thread` | Create/get Memphis bot thread. |
| `POST` | `/messaging-api/memphis/message` | Send user message to Memphis AI and store bot reply. |
| `POST` | `/messaging-api/broadcast` | Send broadcast. |

## Schedule API

Routes are mounted under:

```text
/schedule-api
```

See `src/schedule-api.js` for route-level details until the route split phase documents them fully.

## Diagnostic routes

These are installed by the compatibility bootstrap before Express starts listening.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/status/deep` | Deep health diagnostics. |
| `GET` | `/mcp-tools.json` | HTTP-visible MCP tool manifest. |
