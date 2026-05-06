import { runReadOnlySql } from "../supabase/read.js";
import { supabaseMigrationApplyInputSchema, supabaseSqlReadInputSchema } from "./schemas.js";
import { applyMigration } from "../supabase/migrations.js";
import { registerMcpTool } from "./register.js";
import { jsonResponse } from "./responses.js";

export function registerSupabaseTools(server) {
  registerMcpTool(
    server,
    "supabase_sql_read",
    {
      description: "Run read-only SQL through the configured Supabase RPC.",
      inputSchema: supabaseSqlReadInputSchema,
    },
    async ({ sql }) => {
      const result = await runReadOnlySql({ sql });
      return jsonResponse(result);
    }
  );

  registerMcpTool(
    server,
    "supabase_migration_apply",
    {
      description: "Apply an explicit SQL migration through the configured Supabase RPC. Dry-run defaults to true in the modular layer.",
      inputSchema: supabaseMigrationApplyInputSchema,
    },
    async ({ name, sql, dry_run = true }) => {
      const result = await applyMigration({ name, sql, dryRun: dry_run });
      return jsonResponse(result);
    }
  );
}
