# MCP Tools

This document describes the current MCP tool surface. It should stay aligned with `src/mcp/tool-manifest.js` and the actual registered tools.

## Current direct tools

| Tool | Class | Purpose |
|---|---|---|
| `ping` | read | Basic MCP liveness check. |
| `server_tool_manifest` | read | Return the machine-readable MCP tool manifest. Also exposed at `GET /mcp-tools.json`. |
| `server_deep_health` | read | Run non-destructive server health diagnostics. Also exposed at `GET /status/deep`. |
| `github_debug_config` | read | Show redacted GitHub runtime config and modular MCP status. |
| `github_list_directory` | read | List repository directory entries. Also supports `path=search:term` and `path=search-content:term`. |
| `github_repo_tree` | read | Return a recursive repository tree for an allowed repo. |
| `github_read_file` | read | Read one file as JSON, text, or base64. Also supports manifest and batch-read compatibility commands. |
| `github_batch_read` | read | Read several files in one request. |
| `github_write_file` | safe-write | Create a file or overwrite only when explicitly allowed. Dry-run defaults to true. |
| `github_update_file` | safe-write | Update an existing file, or replace exact text when `find` and `replace` are supplied. Dry-run defaults to true. |
| `github_replace_text` | safe-write | Replace exact text in an existing file with SHA protection and diff preview. |
| `supabase_sql_read` | read | Run read-only SQL through the configured RPC. |
| `supabase_migration_apply` | migration | Apply explicit SQL migration through the configured RPC. Dry-run defaults to true. |

## Current compatibility-command tools

These names are represented in the manifest for operator clarity, but route through existing direct tools rather than separate registered handlers.

| Tool | Class | Route |
|---|---|---|
| `github_search_files` | read | `github_list_directory` with `path=search:term` or `path=search-content:term`. |
| `github_preview_patch` | safe-write | `github_update_file` or `github_replace_text` with `dry_run:true`. |
| `github_apply_patch` | safe-write | `github_update_file` or `github_replace_text` with `dry_run:false` and `expected_sha`. |
| `github_create_branch` | safe-write | `github_write_file` with `content.op=create_branch`. |
| `github_open_pr` | safe-write | `github_write_file` with `content.op=open_pr`. |

## Safety classes

| Class | Meaning |
|---|---|
| `read` | Does not mutate GitHub or Supabase. |
| `safe-write` | Mutates GitHub only after explicit inputs. Should support dry-run or SHA checks. |
| `migration` | Mutates Supabase. Requires explicit migration name and SQL. |
| `admin` | Administrative action. Should require admin authentication or equivalent protection. |

## Rebuild requirements

- Keep `src/mcp/tool-manifest.js`, this document, and smoke assertions aligned.
- Prefer direct `server.registerTool(...)` registration for real MCP tools.
- Expose full input schemas, including optional fields.
- Use `expected_sha` for protected file updates.
- Use `dry_run` by default for patch and migration workflows.
- Return diff previews before writes.
- Redact secrets from diagnostics.
