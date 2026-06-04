# Memphis Gemini Handoff Notes

Purpose: prepare Memphis AI/Gemini behavior for eventual transfer to Zoo IT without depending on Eric's personal session context.

## Current Gemini surfaces

1. `src/memphis-ai.js`
   - Memphis chat replies
   - prefers `MEMPHIS_GEMINI_API_KEY`
2. `src/events-ai-parser.js`
   - Event Input Console AI parsing/fill
   - prefers `EVENTS_GEMINI_API_KEY`
3. `src/schedule-api.js`
   - schedule/PTO parsing and recommendation helpers
   - prefers `SCHEDULE_GEMINI_API_KEY`
4. `src/config/env.js`
   - runtime env/deep-health reporting
5. `src/messaging-api.js`
   - `/health` diagnostics and fallback error diagnostics
   - `/memphis/admin/run` protected no-side-effect admin reply route
   - `/memphis/admin/runtime` protected runtime/auth/deploy summary for the Gemini Console UI
6. `Engine/gemini-admin.html`
   - built-in manager/IT Gemini Console surface
   - supports quick prompts, runtime/deploy summary, local run history, and manual device/user/thread overrides

## Shared key resolution

Shared helper:
- `src/utils/gemini-config.js`

Default fallback order after any surface-specific override:
1. surface-specific key, if supplied (`MEMPHIS_GEMINI_API_KEY`, `EVENTS_GEMINI_API_KEY`, or `SCHEDULE_GEMINI_API_KEY`)
2. `GEMINI_API_KEY`
3. `MEMPHIS_GEMINI_API_KEY`
4. `GOOGLE_API_KEY`
5. `GOOGLE_GENAI_API_KEY`
6. `EVENTS_GEMINI_API_KEY`
7. `SCHEDULE_GEMINI_API_KEY`

This keeps each subsystem free to use a dedicated key while still allowing a single shared Gemini key during transition.

## Recommended Zoo IT env layout

Minimum practical setup for handoff:

```env
MEMPHIS_GEMINI_API_KEY=...
MEMPHIS_GEMINI_MODEL=gemini-2.5-flash

# Optional split keys if IT wants isolation / quota separation
EVENTS_GEMINI_API_KEY=...
EVENTS_GEMINI_MODEL=gemini-2.5-flash

SCHEDULE_GEMINI_API_KEY=...
SCHEDULE_GEMINI_MODEL=gemini-2.5-flash
```

If IT wants one shared key only, `GEMINI_API_KEY` is acceptable, but dedicated per-surface keys are cleaner for ownership, quota tracking, and future rotation.

## Verification points

### Runtime/deep health
- `/status/deep`
- MCP server deep health tool

Expected fields:
- `ai.gemini_configured: true`
- `ai.gemini_key_source: <expected env var>`
- `ai.model: <expected model>`

### Messaging health
- messaging API `/health`

Expected fields under `memphis`:
- `gemini_configured: true`
- `gemini_key_source: MEMPHIS_GEMINI_API_KEY` or expected fallback
- `memphis_model: gemini-2.5-flash` (or chosen model)

### Event parser verification
- run parser import/parse flow with one intentionally ambiguous row
- verify `provider_used` can show:
  - `local-parser`
  - `local-parser+gemini-fill`
  - `gemini`

### Schedule verification
- run PTO/schedule AI tests and confirm schedule-specific Gemini path still works

## Fast regression commands

From `memphis-zoo-mcp/`:

```bash
npm run test:events-parser
npm run test:schedule-ai
npm run test:messaging
npm run test:auth
```

## Cutover checklist for Zoo IT

1. Put Gemini keys in the production secret store / host env.
2. Decide whether Memphis chat, Events, and Schedule share one key or use separate keys.
3. Confirm the chosen model names are available to the account.
4. Run deep health and messaging health checks.
5. Run the regression commands above.
6. Test one live Memphis chat prompt.
7. Test one Event Input Console import row.
8. Test one schedule/PTO AI route.
9. Record who owns key rotation and quota monitoring.
10. Remove any personal-only connector assumptions before final disconnect.

## Operational note

If ownership transfers to Zoo IT, prefer service-owned Gemini credentials rather than user-owned personal keys. The code now supports that transition cleanly with surface-specific env vars.
