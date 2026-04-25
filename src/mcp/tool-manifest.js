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
    description: "List files and directories in an allowed GitHub repository. Supports recursive repo-tree behavior with recursive:true.",
    requires: ["github"],
    inputs: ["repo", "path", "ref", "recursive", "max_entries"],
    aliases: ["github_repo_tree via recursive:true"],
  },
  {
    name: "github_read_file",
    safety: TOOL_SAFETY.READ,
    status: "current",
    description: "Read one file from an allowed GitHub repository. Supports tool manifest and batch reads through compatibility path commands.",
    requires: ["github"],
    inputs: ["repo", "path", "ref", "format", "max_bytes", "path=__manifest__", "path=batch:file1,file2"],
    aliases: ["github_batch_read via path=batch:file1,file2", "server_tool_manifest via path=__manifest__"],
  },
  {
    name: "github_write_file",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "current",
    description: "Create a file, overwrite when explicitly allowed, or run branch/PR JSON commands through content.",
    requires: ["github"],
    inputs: ["repo", "path", "content", "commit_message", "branch", "overwrite", "dry_run", "content.op=create_branch", "content.op=open_pr"],
    aliases: ["github_create_branch via content.op=create_branch", "github_open_pr via content.op=open_pr"],
  },
  {
    name: "github_update_file",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "current",
    description: "Update an existing file. Supports SHA-protected exact text replacement through a JSON command in content.",
    requires: ["github"],
    inputs: ["repo", "path", "content", "commit_message", "branch", "expected_sha", "dry_run", "content.op=replace_text"],
    aliases: ["github_replace_text via content.op=replace_text", "github_preview_patch via dry_run:true"],
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
    status: "current-via-alias",
    description: "Read several files in one request through github_read_file path=batch:file1,file2.",
    requires: ["github"],
    alias_tool: "github_read_file",
  },
  {
    name: "github_repo_tree",
    safety: TOOL_SAFETY.READ,
    status: "current-via-alias",
    description: "Return recursive repository tree through github_list_directory recursive:true.",
    requires: ["github"],
    alias_tool: "github_list_directory",
  },
  {
    name: "github_search_files",
    safety: TOOL_SAFETY.READ,
    status: "current-via-alias",
    description: "Search repository file paths with path=search:term, or text contents with path=search-content:term.",
    requires: ["github"],
    alias_tool: "github_list_directory",
    inputs: ["path=search:term", "path=search-content:term", "max_entries"],
  },
  {
    name: "github_preview_patch",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "current-via-alias",
    description: "Preview a text replacement with unified diff through github_update_file content.op=replace_text and dry_run:true.",
    requires: ["github"],
    alias_tool: "github_update_file",
  },
  {
    name: "github_apply_patch",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "current-via-alias",
    description: "Apply SHA-protected exact text replacement through github_update_file content.op=replace_text and dry_run:false.",
    requires: ["github"],
    alias_tool: "github_update_file",
  },
  {
    name: "github_replace_text",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "current-via-alias",
    description: "Replace one exact text block in a file through github_update_file content.op=replace_text.",
    requires: ["github"],
    alias_tool: "github_update_file",
  },
  {
    name: "github_create_branch",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "current-via-alias",
    description: "Create or preview a branch through github_write_file content.op=create_branch.",
    requires: ["github"],
    alias_tool: "github_write_file",
  },
  {
    name: "github_open_pr",
    safety: TOOL_SAFETY.SAFE_WRITE,
    status: "current-via-alias",
    description: "Open or preview a pull request through github_write_file content.op=open_pr.",
    requires: ["github"],
    alias_tool: "github_write_file",
  },
  {
    name: "server_deep_health",
    safety: TOOL_SAFETY.READ,
    status: "current-via-http",
    description: "Run non-destructive server health diagnostics through GET /status/deep.",
    requires: [],
    http_path: "/status/deep",
  },
  {
    name: "server_tool_manifest",
    safety: TOOL_SAFETY.READ,
    status: "current-via-http-and-alias",
    description: "Return this machine-readable MCP tool manifest through GET /mcp-tools.json or github_read_file path=__manifest__.",
    requires: [],
    http_path: "/mcp-tools.json",
    alias_tool: "github_read_file",
  },
]);

export function getToolManifest({ includePlanned = true } = {}) {
  const tools = includePlanned
    ? MCP_TOOL_MANIFEST
    : MCP_TOOL_MANIFEST.filter((tool) => tool.status === "current" || String(tool.status).startsWith("current-"));

  return {
    ok: true,
    version: MCP_TOOL_MANIFEST_VERSION,
    generated_at: new Date().toISOString(),
    tools,
  };
}
