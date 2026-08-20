import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL(
  "../supabase/migrations/20260820120831_contain_release_recovery_ddl_authority.sql",
  import.meta.url,
), "utf8");
const auth = await readFile(new URL("../src/auth/mcp-connector-auth.js", import.meta.url), "utf8");
const residualMigration = await readFile(new URL(
  "../supabase/migrations/20260820121025_revoke_residual_public_security_definer_execute.sql",
  import.meta.url,
), "utf8");
const triggerMigration = await readFile(new URL(
  "../supabase/migrations/20260820121117_revoke_public_trigger_function_rpc_execute.sql",
  import.meta.url,
), "utf8");

for (const identity of [
  "custodial_release_authority_reset_grants\\(text\\)",
  "custodial_release_authority_restore_column\\(text,text,text,text,text,text,text,boolean\\)",
  "custodial_release_authority_restore_column_set\\(text,text\\[\\]\\)",
  "custodial_release_authority_restore_constraint\\(text,text,text\\)",
]) {
  assert.match(
    migration,
    new RegExp(`revoke all privileges on function public\\.${identity}\\s+from public, anon, authenticated, service_role;`, "i"),
    `${identity} must deny every ordinary API role`,
  );
}

assert.match(auth, /isMcpFullNoAuthEnabled\([^)]*\)\s*\{[\s\S]*?return false;/);
assert.match(auth, /MCP_ALLOW_READONLY_NOAUTH \?\? "false"/);
assert.doesNotMatch(auth, /authMode:\s*"noauth_full"/);

for (const identity of [
  "custodial_claim_offline_reconciliation_notification_recipients",
  "custodial_close_maintenance_ticket_authoritative",
  "custodial_finish_offline_reconciliation_notification_recipient",
  "custodial_manager_dispose_offline_reconciliation",
  "custodial_record_offline_authority_activation_boundary",
]) {
  assert.match(residualMigration, new RegExp(`revoke all privileges on function public\\.${identity}\\(`, "i"));
}
assert.match(residualMigration, /alter default privileges for role postgres in schema public\s+revoke execute on functions from public, anon, authenticated;/i);
assert.match(triggerMigration, /p\.prorettype = 'pg_catalog\.trigger'::regtype/);
assert.match(triggerMigration, /revoke all privileges on function %s from public, anon, authenticated, service_role/);

console.log("Foundation security containment contracts passed.");
