# MCP Tools

This document describes the intended MCP tool surface. It should stay aligned with `src/mcp/tool-manifest.js` and the actual registered tools.

## Current core tools

| Tool | Class | Purpose |
|---|---|---|
| `ping` | read | Basic MCP liveness check. |
| `github_debug_config` | read | Show redacted GitHub/Supabase runtime config. |
| `github_list_directory` | read | List repository directory entries. |
| `github_read_file` | read | Read one file as JSON, text, or base64. |
| `github_write_file` | safe-write | Create a file, or overwrite only when explicitly allowed. |
| `github_update_file` | safe-write | Update an existing file. Should require SHA checks in the rebuilt tool layer. |
| `supabase_sql_read` | read | Run read-only SQL through the configured RPC. |
| `supabase_migration_apply` | migration | Apply explicit SQL migration through the configured RPC. |

## Planned GitHub tools

| Tool | Class | Purpose |
|---|---|---|
| `github_batch_read` | read | Read several files in one request. |
| `github_repo_tree` | read | Return recursive repo tree with filtering. |
| `github_search_files` | read | Search paths and optionally contents. |
| `github_preview_patch` | safe-write | Preview exact text replacement or patch with diff. |
| `github_apply_patch` | safe-write | Apply a previewed patch with `expected_sha`. |
| `github_replace_text` | safe-write | Replace one exact text block in a file. |
| `github_create_branch` | safe-write | Create a branch from a base branch or commit. |
| `github_open_pr` | safe-write | Open a pull request for branch-based changes. |

## Planned server tools

| Tool | Class | Purpose |
|---|---|---|
| `server_deep_health` | read | Run non-destructive health checks. |
| `server_tool_manifest` | read | Return machine-readable tool manifest. |

## Safety classes

| Class | Meaning |
|---|---|
| `read` | Does not mutate GitHub or Supabase. |
| `safe-write` | Mutates GitHub only after explicit inputs. Should support dry-run or SHA checks. |
| `migration` | Mutates Supabase. Requires explicit migration name and SQL. |
| `admin` | Administrative action. Should require admin authentication or equivalent protection. |

## Rebuild requirements

- Use `server.registerTool(...)` directly.
- Expose full input schemas, including optional fields.
- Use `expected_sha` for file updates.
- Use `dry_run` by default for patch tools.
- Return diff previews before writes.
- Redact secrets from diagnostics.
