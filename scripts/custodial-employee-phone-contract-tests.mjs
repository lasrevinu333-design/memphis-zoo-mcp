import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [routeSource, bootstrapSource, migrationSource, packageSource] = await Promise.all([
  readFile(new URL("src/custodial-employee-admin.js", root), "utf8"),
  readFile(new URL("src/mcp-schema-bootstrap.js", root), "utf8"),
  readFile(new URL("supabase/migrations/20260722143000_custodial_employee_phone_management.sql", root), "utf8"),
  readFile(new URL("package.json", root), "utf8"),
]);

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
assert.match(bootstrapSource, /installCustodialEmployeeAdminRoutes/);
assert.match(migrationSource, /custodial_employee_device_assignment_history/);
assert.match(migrationSource, /custodial_employee_status_history/);
assert.match(migrationSource, /create or replace function public\.custodial_assign_employee_device/i);
assert.match(migrationSource, /create or replace function public\.custodial_set_employee_active/i);
assert.match(migrationSource, /create or replace function public\.custodial_create_employee/i);
assert.match(migrationSource, /on conflict \(device_identifier\) do update/i);
assert.doesNotMatch(migrationSource, /(?:update|delete from)\s+public\.device_auth_credentials/i, "phone reassignment must not rewrite or revoke device credentials");
assert.doesNotMatch(migrationSource, /delete from public\.employees/i, "employee history must be preserved instead of deleting employee rows");
assert.match(packageSource, /test:custodial-employee-phones/);

console.log("CUSTODIAL_EMPLOYEE_PHONE_CONTRACT_PASS");
