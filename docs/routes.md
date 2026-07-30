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
| `GET` | `/dashboard-api/guest-cleanliness-issues` | List Marketing-approved guest reports for authenticated Operations display. |
| `POST` | `/dashboard-api/guest-cleanliness-issues/:reportId/resolve` | Resolve an approved guest report and redact guest contact data. |
| `GET` | `/dashboard-api/system-feedback` | List submitted program feedback for authenticated manager triage. |
| `POST` | `/dashboard-api/system-feedback/:feedbackId/status` | Acknowledge or resolve program feedback from manager triage. |
| `POST` | `/dashboard-api/close-ticket` | Dashboard maintenance ticket close. |
| Various | `/dashboard-api/events` | Public event routes. |

## Feedback API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/feedback-api/health` | Program feedback API health. |
| `POST` | `/feedback-api/submit` | Submit bounded JSON implementation feedback, with an optional JSON image attachment, from manager or employee hubs. |
| `GET` | `/feedback-api/image/:feedbackId` | Retrieve a private feedback attachment through manager authentication or an expiring signed link. |
| `GET` | `/feedback-api/acknowledge/:feedbackId` | Show a non-mutating acknowledgement confirmation page through manager authentication or an expiring signed link. |
| `POST` | `/feedback-api/acknowledge/:feedbackId` | Confirm feedback acknowledgement; signed-link actors are server-assigned. |

## Guest API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/guest-api/health` | Guest-report API health. |
| `GET` | `/guest-api/status` | Public approval state; disabled by default until Memphis Zoo approval and QR rollout. |
| `GET` | `/guest-api/locations/:locationCode` | Resolve a guest-report location by code only when the feature is approved. |
| `POST` | `/guest-api/report-cleanliness` | Submit a bounded guest cleanliness issue into the Marketing-first queue only when approved. |
| `GET` | `/guest-api/locations/:locationCode/issues` | List approved open reports for one guest-report location. |

## Marketing API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/marketing-api/guest-cleanliness-issues` | Read the pending guest-report queue with guest details after feature approval and Marketing integration setup. |
| `POST` | `/marketing-api/guest-cleanliness-issues/:reportId/review` | Approve or reject a guest report; approval queues dispatch to Ops Managers and the currently assigned custodian. |

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

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/schedule-api/current-owner` | Resolve the active owner for a location code. |
| `POST` | `/schedule-api/generate-daily` | Generate one day of schedule data. |
| `POST` | `/schedule-api/sch2/preview` | Generate an SCH2 preview run without changing staff-facing schedule rows. |
| `POST` | `/schedule-api/sch2/publish` | Dry-run or confirmed SCH2 publish; confirmed publish is additionally guarded by service-role backend execution in SQL. |
| `POST` | `/schedule-api/sch2/rollback` | Roll back a confirmed SCH2 publish from the audited previous-row snapshot. |
| `GET` | `/schedule-api/sch2/runs` | List recent SCH2 preview/publish runs. |
| `GET` | `/schedule-api/sch2/explain` | Explain one SCH2 work-item assignment for a run. |
| `GET` | `/schedule-api/generation-window` | Show readiness for a forward schedule window. |
| `POST` | `/schedule-api/generate-range` | Ensure a forward schedule window exists, defaulting to 7 days. |
| `POST` | `/schedule-api/restroom-rebalance/run` | Ops-only manual trigger for the 9:45am restroom rebalance; records a persistent daily completion marker after success and reapplies lunch coverage to fill any lunch-window gaps caused by restroom moves. |
| `GET` | `/schedule-api/restroom-rebalance/status` | Ops-only status for the automatic 9:45am Memphis-time restroom rebalance, including in-memory state and persistent daily completion marker. |
| `POST` | `/schedule-api/absence-preview` | Preview absence impact against the stored day schedule. |
| `POST` | `/schedule-api/absence-publish` | Publish absence changes against the stored day schedule. |
| `GET` | `/schedule-api/locations/workload-settings` | List workload settings used by balancing. |
| `POST` | `/schedule-api/locations/:locationId/workload-settings` | Update workload settings for a location. |

See `src/schedule-api.js` for remaining route-level details.

## Moxie — Annie's Private Assistant

Routes are mounted under:

```text
/moxie
```

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/moxie/health` | Moxie health check. |
| `GET` | `/moxie/login` | Login page. |
| `POST` | `/moxie/login` | Submit password. |
| `GET` | `/moxie/logout` | Clear session. |
| `GET` | `/moxie/` | Chat UI (main page). |
| `POST` | `/moxie/chat` | Send chat message to Gemini. |
| `GET` | `/moxie/chat/state` | Get saved chat history. |
| `PUT` | `/moxie/chat/state` | Save chat history. |
| `GET` | `/moxie/log` | Annie's Log page (notes + reminders). |
| `POST` | `/moxie/log/note` | Add a note. |
| `DELETE` | `/moxie/log/note/:id` | Delete a note. |
| `POST` | `/moxie/log/reminder` | Add a reminder. |
| `POST` | `/moxie/log/reminder/:id/complete` | Mark reminder done. |
| `DELETE` | `/moxie/log/reminder/:id` | Delete a reminder. |
| `POST` | `/moxie/log/suggested/:id/confirm` | Confirm suggested reminder. |
| `POST` | `/moxie/log/suggested/:id/dismiss` | Dismiss suggested reminder. |
| `GET` | `/moxie/reminders` | Reminders page. |
| `GET` | `/moxie/contacts` | Contacts page. |
| `POST` | `/moxie/contacts` | Add a contact. |
| `PUT` | `/moxie/contacts/:id` | Update a contact. |
| `DELETE` | `/moxie/contacts/:id` | Delete a contact. |
| `POST` | `/moxie/contacts/suggested/:id/confirm` | Confirm suggested contact. |
| `POST` | `/moxie/contacts/suggested/:id/dismiss` | Dismiss suggested contact. |
| `GET` | `/moxie/password` | Settings page. |
| `POST` | `/moxie/password` | Change password. |

## Diagnostic routes

These are installed by the compatibility bootstrap before Express starts listening.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/status/deep` | Deep health diagnostics. |
| `GET` | `/mcp-tools.json` | HTTP-visible MCP tool manifest. |
