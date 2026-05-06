# Memphis Zoo MCP Rebuild Plan

This rebuild is staged so the deployed server stays bootable after each change. The working service is the lifeboat. We do not set the lifeboat on fire to prove we can swim.

## Current priorities

1. Keep Render startup stable.
2. Keep `/mcp`, `/sse`, dashboard, admin, scan, messaging, schedule, and events routes working.
3. Continue reducing remaining `src/index.js` runtime responsibilities after smoke coverage is strong.
4. Replace bootstrap schema patching with direct `registerTool` usage once deployed schemas are verified without the compatibility layer.
5. Keep safer GitHub reads and writes active: batch reads, repo tree, diff previews, patch-style updates, dry runs, and SHA checks.
6. Keep startup and smoke diagnostics aligned with the manifest.
7. Keep documentation for routes, env vars, and tools aligned with code.
8. Split large files after guardrails exist, starting with the lowest-risk AI/service seams.

## Current progress snapshot

- `src/mcp/tool-manifest.js` is aligned to current direct MCP tools as `mcp-tools.v2`.
- `scripts/smoke.mjs` asserts key manifest statuses and Supabase migration metadata shape.
- `docs/mcp-tools.md` distinguishes direct MCP tools from compatibility-command tool names.
- `src/supabase/migrations.js` returns structured migration and audit metadata for dry-run and apply responses.
- `src/routes/index.js` is the route factory barrel used by `src/index.js` and smoke tests.
- `src/ai/index.js` is the Memphis AI helper barrel used by `src/memphis-ai.js` and smoke tests.
- `src/services/index.js` is the service barrel used by `src/messaging-api.js` and smoke tests for Memphis responder access.
- `src/mcp/schemas.js` centralizes modular MCP input schemas for ping, server, GitHub, and Supabase tools.

## Safety rules

- Do not remove working routes until replacements are tested.
- Prefer additive commits before edits to existing runtime files.
- Avoid destructive database changes outside explicit migrations.
- Require `expected_sha` for file updates once the new GitHub tool layer is active.
- Default complex writes to `dry_run` or preview mode.
- Keep direct-to-main commits small and reversible.
- Redact secrets in logs, health output, and diagnostics.
- When in doubt, add a new module and wire it later.

## Phase 1: Guardrails and documentation

Add non-invasive support files. These should not affect runtime until imported.

- `src/utils/redact-secrets.js`
- `src/utils/diff.js`
- `src/config/env.js`
- `scripts/smoke.mjs`
- `docs/rebuild-plan.md`
- `docs/mcp-tools.md`
- `docs/env.md`
- `docs/routes.md`
- `src/mcp/tool-manifest.js`

Exit criteria:

- Files exist.
- `npm run smoke` exists.
- Existing deployed service still responds to `ping`.

## Phase 2: Modular MCP server

Target structure:

```text
src/mcp/
├── create-mcp-server.js
├── github-tools.js
├── supabase-tools.js
├── dashboard-tools.js
├── schemas.js
└── tool-manifest.js
```

Goals:

- Move MCP tool definitions out of `src/index.js`.
- Use `server.registerTool(...)` directly.
- Preserve existing `/mcp` Streamable HTTP behavior.
- Keep `/sse` legacy behavior until it is intentionally retired.
- Remove `src/mcp-schema-bootstrap.js` only after schemas expose correctly.

Exit criteria:

- MCP tool registry shows complete optional schemas.
- Existing GitHub read/list/update smoke tests still work.
- Supabase read-only smoke test still works.

## Phase 3: GitHub service upgrade

Target structure:

```text
src/github/
├── client.js
├── read.js
├── write.js
├── patch.js
└── branch.js
```

Tools to add:

- `github_batch_read`
- `github_repo_tree`
- `github_search_files`
- `github_preview_patch`
- `github_apply_patch`
- `github_replace_text`
- `github_create_branch`
- `github_open_pr`

Safety requirements:

- Allowed repo enforcement.
- Allowed branch enforcement or clear branch selection.
- `expected_sha` required for update operations.
- `dry_run` default for patch operations.
- Unified diff returned before writes.
- Large-file and binary guards.
- Commit URL returned after writes.

Exit criteria:

- Batch read works.
- Patch preview works without committing.
- Patch apply requires current SHA.
- No-op update does not create a commit.

## Phase 4: Supabase service upgrade

Target structure:

```text
src/supabase/
├── client.js
├── read.js
└── migrations.js
```

Goals:

- Centralize Supabase config.
- Keep read-only SQL restrictions.
- Keep migration RPC explicit.
- Add migration metadata and optional audit output.

Exit criteria:

- `select 1 as smoke_test_ok` works through MCP.
- Non-read SQL is rejected by read-only path.
- Migration tool requires explicit migration name and SQL.

## Phase 5: Health and diagnostics

Add:

- `/status/deep`
- `/mcp-tools.json`
- MCP tool `server_deep_health`
- MCP tool `server_tool_manifest`

Checks:

- GitHub config present.
- Supabase configured.
- Gemini configured or fallback noted.
- MCP tools registered.
- Critical route modules import cleanly.
- Secrets redacted.

Exit criteria:

- Health output is useful without leaking secrets.
- Tool manifest is visible from HTTP and MCP.

## Phase 6: Route and service split

Move route logic into services gradually:

```text
src/routes/
src/services/
```

Initial targets:

- messaging
- Memphis AI
- events
- schedule
- dashboard
- scan
- attendance

Exit criteria:

- Existing public routes return compatible payloads.
- Existing admin routes still enforce auth.
- No route disappears without a replacement.

## Phase 7: Cleanup

- Remove compatibility bootstraps.
- Restore `npm start` to `node src/index.js` if schemas are clean without bootstrap.
- Update docs.
- Run smoke tests.
- Verify Render deploy.

## Recovery

If a deploy fails:

1. Check Render logs for the first real error.
2. Revert the most recent runtime commit.
3. If needed, set `package.json` start back to the last known-good entry point.
4. Confirm MCP `ping`.
5. Confirm GitHub read/list and Supabase read-only smoke tests.
