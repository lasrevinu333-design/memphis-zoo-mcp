# Memphis Zoo MCP Rebuild Plan

This rebuild is staged so the deployed server stays bootable after each change.

## Goals

- Keep Render startup stable.
- Keep `/mcp`, `/sse`, dashboard, admin, scan, messaging, schedule, and events routes working.
- Move GitHub and Supabase MCP tools out of `src/index.js`.
- Replace bootstrap schema patching with direct `registerTool` usage.
- Add safer GitHub reads and writes: batch reads, diff previews, patch-style updates, dry runs, and SHA checks.
- Add startup and smoke diagnostics.
- Add documentation for routes, env vars, and tools.

## Phases

1. Add non-invasive support modules, docs, and smoke checks.
2. Add modular MCP tool implementations without changing live routing.
3. Wire the modular MCP server into `src/index.js` after smoke checks pass.
4. Remove temporary bootstrap compatibility code after schemas expose correctly.
5. Add branch/PR workflow tools if the GitHub token permissions allow them.
6. Split large service files into smaller modules.

## Safety Rules

- Do not remove working routes until replacements are tested.
- Avoid direct destructive database changes outside explicit migrations.
- Require `expected_sha` for file updates once the new GitHub tool layer is active.
- Default complex writes to `dry_run` or preview mode.
- Prefer additive commits over large rewrites.

## Recovery

If a deploy fails, revert the last commit or set `package.json` start back to the last known-good entry point.
