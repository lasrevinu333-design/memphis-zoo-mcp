#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync("src/index.js", "utf8");
const identityMigration = readFileSync("supabase/migrations/20260820153000_append_only_cleaning_identity_corrections.sql", "utf8");
const gpsMigration = readFileSync("supabase/migrations/20260820154000_late_gps_is_advisory_only.sql", "utf8");

const correctionRoute = index.match(/app\.post\("\/admin-api\/custodial\/cleaning-sessions\/:sessionId\/corrections"[\s\S]*?\n}\);/)?.[0] || "";
assert.ok(correctionRoute, "named-manager cleaning correction route must exist");
assert.match(correctionRoute, /requireOpsManagerWrite/);
assert.match(correctionRoute, /p_manager_id: offlineAuthorityManagerId\(req\)/);
assert.match(correctionRoute, /p_operation_id: requiredRequestOperationId\(req\)/);
assert.doesNotMatch(correctionRoute, /req\.body\?\.manager|req\.body\.manager/);
assert.match(index, /app\.get\("\/admin-api\/custodial\/cleaning-sessions\/:sessionId\/truth", requireOpsManagerAuth/);

const correctionFunction = identityMigration.match(/create or replace function public\.custodial_append_session_correction\([\s\S]*?\n\$function\$;/i)?.[0] || "";
assert.ok(correctionFunction);
assert.match(correctionFunction, /custodial_require_backend_execution_secret/);
assert.match(correctionFunction, /is_system_principal = false/);
assert.match(correctionFunction, /insert into public\.custodial_session_corrections/);
assert.doesNotMatch(correctionFunction, /update public\.sessions/i);
assert.match(identityMigration, /Original cleaning identity is immutable/);
assert.match(identityMigration, /Cleaning corrections are append-only/);
assert.match(identityMigration, /original_employee_id[\s\S]*current_employee_id/);
assert.match(identityMigration, /new\.employee_name_snapshot[\s\S]*is distinct from[\s\S]*old\.employee_name_snapshot/);

assert.match(gpsMigration, /v_session_state not in \('active','pending_submit'\)/);
assert.match(gpsMigration, /'evidence_scope','post_session_advisory'/);
assert.match(gpsMigration, /revoke all on function public\.custodial_evaluate_location_proximity_v2_measurement[\s\S]*service_role/);
assert.match(gpsMigration, /create or replace function public\.tool_evaluate_location_proximity_v2/);

console.log("CLEANING_IDENTITY_ROUTE_CONTRACT_PASS");
