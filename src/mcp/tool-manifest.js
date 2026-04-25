export const TOOL_SAFETY = Object.freeze({
  READ: "read",
  SAFE_WRITE: "safe-write",
  MIGRATION: "migration",
  ADMIN: "admin",
});

export const MCP_TOOL_MANIFEST_VERSION = "mcp-tools.v1";

export const MCP_TOOL_MANIFEST = Object.freeze([
  {
    name: "ping",
    safety: TOOL_SAFETY.READ,
    status: "current",
    description: "Basic MCP liveness check.",
    requires: [],
  },
  {
    name: "github_debug_config",
    safety: TOOL_SAFETY.READ,
    status: "current",
    description: "Return redacted GitHub and Supabase runtime configuration.",
    requires: ["github"],
  },
  {
    name: "github_list_directory",
    safety: TOOL_SAFETY.READ,
    status: "current",
    description: "List files and directories in an allowed GitHub repository.",
    requires: ["github"],
    inputs: ["repo", "path", "ref", "recursive", "max_entries"],
  },
  {
    name: "github_read_file",
    safety: TOOL_SAFETY.READ,
    status: "current",
    description: "Read one file from an allowed GitHub repository.",
    requires: ["github"],
    inputs: ["repo", "path", "ref", "format", "max_bytes"],
  },
  {
    name: "github_write_file",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "current",
    description: "Create a file, or overwrite only when explicitly allowed.",
    requires: ["github"],
    inputs: ["repo", "path", "content", "commit_message", "branch", "overwrite", "dry_run"],
  },
  {
    name: "github_update_file",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "current",
    description: "Update an existing file. Rebuild target requires expected_sha.",
    requires: ["github"],
    inputs: ["repo", "path", "content", "commit_message", "branch", "expected_sha", "dry_run"],
  },
  {
    name: "supabase_sql_read",
    safety: TOOL_SAFETY.READ,
    status: "current",
    description: "Run read-only SQL through the configured Supabase RPC.",
    requires: ["supabase"],
    inputs: ["sql"],
  },
  {
    name: "supabase_migration_apply",
    safety: TOOL_SAFETY.MIGRATION,
    status: "current",
    description: "Apply an explicit SQL migration through the configured Supabase RPC.",
    requires: ["supabase"],
    inputs: ["name", "sql"],
  },
  {
    name: "github_batch_read",
    safety: TOOL_SAFETY.READ,
    status: "planned",
    description: "Read several files in one request.",
    requires: ["github"],
  },
  {
    name: "github_repo_tree",
    safety: TOOL_SAFETY.READ,
    status: "planned",
    description: "Return recursive repository tree with filtering.",
    requires: ["github"],
  },
  {
    name: "github_search_files",
    safety: TOOL_SAFETY.READ,
    status: "planned",
    description: "Search file paths and optionally file contents.",
    requires: ["github"],
  },
  {
    name: "github_preview_patch",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "planned",
    description: "Preview a text replacement or patch with a unified diff.",
    requires: ["github"],
  },
  {
    name: "github_apply_patch",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "planned",
    description: "Apply a previewed patch with expected_sha protection.",
    requires: ["github"],
  },
  {
    name: "github_replace_text",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "planned",
    description: "Replace one exact text block in a file.",
    requires: ["github"],
  },
  {
    name: "github_create_branch",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "planned",
    description: "Create a branch from a base branch or commit SHA.",
    requires: ["github"],
  },
  {
    name: "github_open_pr",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "planned",
    description: "Open a pull request for branch-based changes.",
    requires: ["github"],
  },
  {
    name: "server_deep_health",
    safety: TOOL_SAFETY.READ,
    status: "planned",
    description: "Run non-destructive server health diagnostics.",
    requires: [],
  },
  {
    name: "server_tool_manifest",
    safety: TOOL_SAFETY.READ,
    status: "planned",
    description: "Return this machine-readable MCP tool manifest.",
    requires: [],
  },
]);

export function getToolManifest({ includePlanned = true } = {}) {
  const tools = includePlanned
    ? MCP_TOOL_MANIFEST
    : MCP_TOOL_MANIFEST.filter((tool) => tool.status === "current");

  return {
    ok: true,
    version: MCP_TOOL_MANIFEST_VERSION,
    generated_at: new Date().toISOString(),
    tools,
  };
}
