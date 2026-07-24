import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [routeSource, bootstrapSource, migrationFoundation, migrationAssignment, migrationStatus, lifecycleMigration, packageSource] = await Promise.all([
  readFile(new URL("src/custodial-employee-admin.js", root), "utf8"),
  readFile(new URL("src/mcp-schema-bootstrap.js", root), "utf8"),
  readFile(new URL("supabase/migrations/20260722210339_custodial_employee_phone_foundation.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260722210533_custodial_employee_phone_assignment.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260722210620_custodial_employee_status_management.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260724145808_lifecycle_integrity_repairs.sql", root), "utf8"),
  readFile(new URL("package.json", root), "utf8"),
]);
const migrationSource = `${migrationFoundation}\n${migrationAssignment}\n${migrationStatus}\n${lifecycleMigration}`;

for (const endpoint of [
  "/custodial-admin-api/employee-phones",
  "/custodial-admin-api/employees",
  "/custodial-admin-api/employees/:employeeId/status",
  "/custodial-admin-api/devices/:deviceId/assignment",
  "/custodial-device-auth/enroll",
]) assert.ok(routeSource.includes(endpoint), `missing ${endpoint}`);

assert.match(routeSource, /CUSTODIAL_MANAGER/);
assert.match(routeSource, /X-Memphis-App-Edition/i);
assert.match(routeSource, /device_credential/);
assert.match(routeSource, /custodial_reassign_employee_phone/);
assert.match(routeSource, /expected_current_employee_id is required/);
assert.match(routeSource, /custodial_set_employee_active/);
assert.match(routeSource, /custodial_create_employee/);
assert.match(bootstrapSource, /installCustodialEmployeeAdminRoutes/);
assert.match(migrationSource, /custodial_employee_device_assignment_history/);
assert.match(migrationSource, /custodial_employee_status_history/);
assert.match(migrationSource, /create or replace function public\.custodial_assign_employee_device/i);
assert.match(migrationSource, /create or replace function public\.custodial_set_employee_active/i);
assert.match(migrationSource, /create or replace function public\.custodial_create_employee/i);
assert.match(migrationSource, /create or replace function public\.custodial_reassign_employee_phone/i);
assert.match(migrationSource, /create or replace function public\.custodial_create_employee_idempotent/i);
assert.match(lifecycleMigration, /custodial_employee_phone_operations/i);
assert.match(lifecycleMigration, /pg_advisory_xact_lock\(hashtextextended\('custodial-phone-operation:/i);
assert.match(lifecycleMigration, /assigned_employee_id is distinct from p_expected_current_employee_id/i);
assert.match(lifecycleMigration, /update public\.device_auth_credentials/i);
assert.match(lifecycleMigration, /revoked_reason.*device_assignment_changed/is);
assert.match(routeSource, /custodial_create_employee_idempotent/);
assert.match(migrationSource, /on conflict \(device_identifier\) do update/i);
assert.doesNotMatch(migrationSource, /delete from public\.employees/i, "employee history must be preserved instead of deleting employee rows");
assert.match(packageSource, /test:custodial-employee-phones/);

console.log("CUSTODIAL_EMPLOYEE_PHONE_CONTRACT_PASS");
