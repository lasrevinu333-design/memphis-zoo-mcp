#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/migrations/20260724173912_shared_scan_and_recovery_integrity.sql", import.meta.url),
  "utf8",
);
const backup = readFileSync(new URL("./production-backup.mjs", import.meta.url), "utf8");
const restore = readFileSync(new URL("./restore-production-backup.mjs", import.meta.url), "utf8");

assert.match(index, /tool_start_shared_session_v1/);
assert.match(index, /tool_commit_shared_cleaning_workflow_v1/);
assert.match(index, /opsSession\.access_level !== "full_access"/);
assert.match(index, /p_actor_manager_id:\s*opsSession\.manager_id/);
assert.match(index, /Shared employee selection is allowed only on KIOSK_01/);
assert.doesNotMatch(index, /p_actor_manager_id:\s*nextArgs/);

assert.match(migration, /insert into public\.devices[\s\S]*'KIOSK_01'[\s\S]*assigned_employee_id = null/i);
assert.match(migration, /tool_list_active_employees\(\)[\s\S]*'employee_id', e\.id/i);
assert.match(migration, /manager_authorized_employee_id/);
assert.match(migration, /m\.active is true[\s\S]*m\.revoked_at is null/i);
assert.match(migration, /p_selected_employee_id[\s\S]*public\.employees[\s\S]*e\.active is true/i);
assert.match(migration, /perform public\.tool_finish_session_exact[\s\S]*public\.tool_complete_session/i);
assert.match(migration, /revoke all on function public\.tool_start_shared_session_v1[\s\S]*from public, anon, authenticated/i);
assert.match(migration, /grant execute on function public\.tool_start_shared_session_v1[\s\S]*to service_role/i);
assert.match(migration, /revoke all on function public\.tool_commit_shared_cleaning_workflow_v1[\s\S]*from public, anon, authenticated/i);

assert.match(backup, /pg_dump/i, "data backup must use a transactionally consistent pg_dump snapshot");
assert.match(backup, /serializable-deferrable/i, "pg_dump must request a serializable deferrable snapshot");
assert.match(backup, /storage\/v1\/object\/authenticated/i, "backup must download private Storage object bytes");
assert.match(backup, /storage-object-manifest\.json/i, "backup must inventory Storage hashes and metadata");
assert.match(backup, /storage_metadata_changed_during_backup/i, "backup must fail if Storage changes during capture");
assert.match(restore, /RESTORE_TARGET_ASSERTION/);
assert.match(restore, /pg_restore/);
assert.match(restore, /Refusing to restore the database snapshot over the source Supabase project/);
assert.match(restore, /Refusing to restore Storage over the source Supabase project/);
assert.match(restore, /\^\[0-9a-f\]\{64\}\\\.object\$/);
assert.match(restore, /hash mismatch/i);

console.log("THIRD_AUDIT_REPAIR_CONTRACT_TESTS_PASS");
