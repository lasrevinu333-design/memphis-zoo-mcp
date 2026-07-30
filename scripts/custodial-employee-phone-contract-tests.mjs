import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [routeSource, indexSource, migrationFoundation, migrationAssignment, migrationStatus, migrationHardening, packageSource] = await Promise.all([
  readFile(new URL("src/custodial-employee-admin.js", root), "utf8"),
  readFile(new URL("src/index.js", root), "utf8"),
  readFile(new URL("supabase/migrations/20260722143000_custodial_employee_phone_foundation.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260722143100_custodial_employee_phone_assignment.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260722143200_custodial_employee_status_management.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260729150527_audit_defense_in_depth_hardening.sql", root), "utf8"),
  readFile(new URL("package.json", root), "utf8"),
]);
const migrationSource = `${migrationFoundation}\n${migrationAssignment}\n${migrationStatus}`;

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
assert.match(routeSource, /custodial_assign_employee_device/);
assert.match(routeSource, /custodial_set_employee_active/);
assert.match(routeSource, /custodial_create_employee/);
assert.match(indexSource, /installCustodialEmployeeAdminRoutes\(app/);
assert.match(migrationSource, /custodial_employee_device_assignment_history/);
assert.match(migrationSource, /custodial_employee_status_history/);
assert.match(migrationSource, /create or replace function public\.custodial_assign_employee_device/i);
assert.match(migrationSource, /create or replace function public\.custodial_set_employee_active/i);
assert.match(migrationSource, /create or replace function public\.custodial_create_employee/i);
assert.match(migrationSource, /on conflict \(device_identifier\) do update/i);
assert.doesNotMatch(migrationSource, /(?:update|delete from)\s+public\.device_auth_credentials/i, "phone reassignment must not rewrite or revoke device credentials");
assert.doesNotMatch(migrationSource, /delete from public\.employees/i, "employee history must be preserved instead of deleting employee rows");
for (const table of [
  "custodial_employee_device_assignment_history",
  "custodial_employee_status_history",
]) {
  assert.match(migrationHardening, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  assert.match(migrationHardening, new RegExp(`alter table public\\.${table} force row level security`, "i"));
  assert.match(migrationHardening, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i"));
  assert.match(migrationHardening, new RegExp(`${table}_service_all[\\s\\S]+to service_role[\\s\\S]+using \\(true\\)[\\s\\S]+with check \\(true\\)`, "i"));
}
assert.match(migrationHardening, /revoke all privileges on all sequences in schema public from public, anon, authenticated/i);
assert.match(migrationHardening, /alter default privileges in schema public\s+revoke all privileges on sequences from public, anon, authenticated/i);
assert.match(packageSource, /test:custodial-employee-phones/);

console.log("CUSTODIAL_EMPLOYEE_PHONE_CONTRACT_PASS");
