#!/usr/bin/env node
import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import { createOpsManagerSession } from "../src/auth/shared-access-auth.js";
import { installCustodialEmployeeAdminRoutes } from "../src/custodial-employee-admin.js";

const root = new URL("../", import.meta.url);
const env = {
  NODE_ENV: "production",
  OPS_MANAGER_AUTH_REQUIRED: "true",
  OPS_MANAGER_SESSION_SECRET: "custodial-admin-authorization-contract-session-secret",
  DEVICE_CREDENTIAL_SECRET: "custodial-admin-authorization-contract-device-secret",
};
const managerId = "51000000-0000-4000-8000-000000000001";
const employeeId = "51000000-0000-4000-8000-000000000002";
const devicePk = "51000000-0000-4000-8000-000000000003";
const employee = {
  id: employeeId,
  employee_code: "EMP002",
  display_name: "Authorization Contract Employee",
  active: true,
  role: "staff",
  notes: null,
  updated_at: new Date().toISOString(),
};
const device = {
  id: devicePk,
  device_id: "KIOSK_02",
  device_name: "Authorization Contract Phone",
  active: true,
  assigned_employee_id: employeeId,
  last_seen_at: null,
  updated_at: new Date().toISOString(),
  employees: employee,
};
const databaseCalls = [];

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
  }

  select() { return this; }
  in(column, value) { this.filters.push(["in", column, value]); return this; }
  eq(column, value) { this.filters.push(["eq", column, value]); return this; }
  like(column, value) { this.filters.push(["like", column, value]); return this; }
  is(column, value) { this.filters.push(["is", column, value]); return this; }
  gt(column, value) { this.filters.push(["gt", column, value]); return this; }
  order() { return this; }
  limit() { return this; }

  result() {
    if (this.table === "devices") return { data: [structuredClone(device)], error: null };
    if (this.table === "employees") return { data: [structuredClone(employee)], error: null };
    if (this.table === "device_auth_credentials") {
      return { data: [{
        credential_id: "51000000-0000-4000-8000-000000000004",
        device_id: devicePk,
        device_label: "Authorization Contract",
        confirmed_at: new Date().toISOString(),
        last_used_at: null,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        revoked_at: null,
      }], error: null };
    }
    if (this.table === "custodial_employee_device_assignment_history") return { data: [], error: null };
    throw new Error(`Unexpected table in authorization contract: ${this.table}`);
  }

  async maybeSingle() {
    databaseCalls.push({ kind: "query", table: this.table, terminal: "maybeSingle", filters: structuredClone(this.filters) });
    if (this.table === "devices") return { data: structuredClone(device), error: null };
    if (this.table === "employees") return { data: structuredClone(employee), error: null };
    throw new Error(`Unexpected maybeSingle table in authorization contract: ${this.table}`);
  }

  then(resolve, reject) {
    databaseCalls.push({ kind: "query", table: this.table, terminal: "result", filters: structuredClone(this.filters) });
    return Promise.resolve(this.result()).then(resolve, reject);
  }
}

const db = {
  from(table) { return new Query(table); },
  async rpc(name, args = {}) {
    databaseCalls.push({ kind: "rpc", name, args: structuredClone(args) });
    if (name === "custodial_create_employee") return { data: { employee: structuredClone(employee) }, error: null };
    if (name === "custodial_set_employee_active") return { data: { employee: { ...structuredClone(employee), active: args.p_active } }, error: null };
    if (name === "custodial_assign_employee_device") return { data: { device: structuredClone(device) }, error: null };
    if (name === "device_auth_issue_enrollment_code") {
      return { data: {
        enrollment_id: "51000000-0000-4000-8000-000000000005",
        expires_at: new Date(Date.now() + 1_800_000).toISOString(),
      }, error: null };
    }
    throw new Error(`Unexpected RPC in authorization contract: ${name}`);
  },
};

function managerToken(accessLevel, roles = ["CUSTODIAL_MANAGER"]) {
  return createOpsManagerSession({
    deviceId: `authorization-contract-${accessLevel}`,
    manager: { manager_id: managerId, display_name: "Authorization Contract Manager", roles },
    authMode: "operations_first",
    accessLevel,
    maximumAccessLevel: "full_access",
    env,
  }).token;
}

const app = express();
app.use(express.json());
installCustodialEmployeeAdminRoutes(app, { env, supabase: db });
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const managerReads = [
  { method: "GET", path: "/custodial-admin-api/employee-phones" },
  { method: "GET", path: "/leadership-api/phone-assignments" },
];
const managerMutations = [
  {
    family: "device assignment",
    method: "PUT",
    path: "/custodial-admin-api/devices/KIOSK_02/assignment",
    body: { employee_id: employeeId, reason: "Authorization contract" },
    rpc: "custodial_assign_employee_device",
  },
  {
    family: "enrollment-code issuance",
    method: "POST",
    path: "/custodial-admin-api/devices/KIOSK_02/enrollment-code",
    body: {},
    rpc: "device_auth_issue_enrollment_code",
  },
  {
    family: "legacy device assignment",
    method: "POST",
    path: "/leadership-api/phone-assignments/KIOSK_02",
    body: { employee_id: employeeId, expected_current_employee_id: employeeId },
    rpc: "custodial_assign_employee_device",
  },
  {
    family: "legacy enrollment-code issuance",
    method: "POST",
    path: "/leadership-api/phone-assignments/KIOSK_02/enrollment-code",
    body: {},
    rpc: "device_auth_issue_enrollment_code",
  },
];
const rosterOnlyMutations = [
  { family: "employee creation", method: "POST", path: "/custodial-admin-api/employees", body: { display_name: "Replacement Employee" } },
  { family: "employee status", method: "PATCH", path: `/custodial-admin-api/employees/${employeeId}/status`, body: { active: false, reason: "Authorization contract" } },
  { family: "legacy employee creation", method: "POST", path: "/leadership-api/phone-assignments/unassigned", body: { new_employee_name: "Legacy Replacement Employee" } },
  { family: "embedded employee creation", method: "POST", path: "/leadership-api/phone-assignments/KIOSK_02", body: { new_employee_name: "Legacy Replacement Employee" } },
  { family: "departure during phone assignment", method: "PUT", path: "/custodial-admin-api/devices/KIOSK_02/assignment", body: { employee_id: null, deactivate_previous: true } },
];

try {
  const readOnlyToken = managerToken("read_only");
  for (const route of managerReads) {
    const result = await request(route.path, { method: route.method, token: readOnlyToken });
    assert.equal(result.status, 200, `read-only Custodial Manager should retain ${route.method} ${route.path}`);
    assert.equal(result.body.ok, true);
  }

  for (const route of [...managerMutations, ...rosterOnlyMutations]) {
    const callsBefore = databaseCalls.length;
    const result = await request(route.path, {
      method: route.method,
      token: readOnlyToken,
      body: route.body,
    });
    assert.equal(result.status, 403, `read-only Custodial Manager reached ${route.family}`);
    assert.match(result.body.error, /read-only ops manager session cannot make changes/i);
    assert.equal(databaseCalls.length, callsBefore, `${route.family} touched the database before write authorization`);
  }

  const fullAccessToken = managerToken("full_access");
  for (const route of managerMutations) {
    const callsBefore = databaseCalls.length;
    const result = await request(route.path, {
      method: route.method,
      token: fullAccessToken,
      body: route.body,
    });
    assert.ok(result.status >= 200 && result.status < 300, `full-access Custodial Manager was denied ${route.family}: ${result.status}`);
    assert.equal(result.body.ok, true);
    assert.ok(
      databaseCalls.slice(callsBefore).some((call) => call.kind === "rpc" && call.name === route.rpc),
      `${route.family} did not reach its expected authorized RPC`,
    );
  }

  for (const route of rosterOnlyMutations) {
    const callsBefore = databaseCalls.length;
    const result = await request(route.path, { method: route.method, token: fullAccessToken, body: route.body });
    assert.equal(result.status, 409, `full-access Custodial Manager bypassed the roster authority through ${route.family}`);
    assert.match(result.body.error, /weekly schedule/i);
    assert.equal(databaseCalls.length, callsBefore, `${route.family} touched the database outside the roster transaction`);
  }

  const ordinaryManagerToken = managerToken("full_access", ["OPS_MANAGER"]);
  for (const route of [managerReads[0], managerMutations[0]]) {
    const callsBefore = databaseCalls.length;
    const result = await request(route.path, {
      method: route.method,
      token: ordinaryManagerToken,
      body: route.body,
    });
    assert.equal(result.status, 403, `ordinary Ops Manager bypassed the Custodial Manager role on ${route.path}`);
    assert.match(result.body.error, /custodial manager access is required/i);
    assert.equal(databaseCalls.length, callsBefore, `role-denied ${route.path} touched the database`);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const routeSource = await readFile(new URL("src/custodial-employee-admin.js", root), "utf8");
const discoveredRoutes = Array.from(routeSource.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g), (match) => ({
  method: match[1].toUpperCase(),
  path: match[2],
}));
assert.deepEqual(discoveredRoutes, [
  { method: "GET", path: "/custodial-admin-api/employee-phones" },
  { method: "POST", path: "/custodial-admin-api/employees" },
  { method: "PATCH", path: "/custodial-admin-api/employees/:employeeId/status" },
  { method: "PUT", path: "/custodial-admin-api/devices/:deviceId/assignment" },
  { method: "POST", path: "/custodial-admin-api/devices/:deviceId/enrollment-code" },
  { method: "GET", path: "/leadership-api/phone-assignments" },
  { method: "POST", path: "/leadership-api/phone-assignments/:deviceId" },
  { method: "POST", path: "/leadership-api/phone-assignments/:deviceId/enrollment-code" },
  { method: "POST", path: "/custodial-device-auth/enroll" },
  { method: "POST", path: "/custodial-device-auth/recover" },
  { method: "POST", path: "/custodial-device-auth/enrollment-operations/:operationId/confirm" },
  { method: "POST", path: "/custodial-device-auth/enrollment-operations/:operationId/cancel" },
  { method: "POST", path: "/custodial-device-auth/remove" },
], "every route in the module must be deliberately classified when the surface changes");

for (const route of managerReads) {
  assert.match(
    routeSource,
    new RegExp(`app\\.${route.method.toLowerCase()}\\(\\"${route.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\", configured, requireCustodialRead`),
    `${route.method} ${route.path} must retain read authorization`,
  );
}
for (const route of [
  { method: "POST", path: "/custodial-admin-api/employees" },
  { method: "PATCH", path: "/custodial-admin-api/employees/:employeeId/status" },
  { method: "PUT", path: "/custodial-admin-api/devices/:deviceId/assignment" },
  { method: "POST", path: "/custodial-admin-api/devices/:deviceId/enrollment-code" },
  { method: "POST", path: "/leadership-api/phone-assignments/:deviceId" },
  { method: "POST", path: "/leadership-api/phone-assignments/:deviceId/enrollment-code" },
]) {
  assert.match(
    routeSource,
    new RegExp(`app\\.${route.method.toLowerCase()}\\(\\"${route.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\", configured, requireCustodialWrite`),
    `${route.method} ${route.path} must require write authorization`,
  );
}
assert.match(routeSource, /makeOpsAccessMiddleware\(\{ env, supabase: db, requireWrite: true \}\)/);

// Native lifecycle routes act as the employee phone, not as an Ops Manager.
// Their enrollment-code or device-credential proofs remain purpose-specific;
// the route inventory above prevents them from being mistaken for admin APIs.
assert.match(routeSource, /app\.post\("\/custodial-device-auth\/enroll", configured, nativeEnrollment\("enrollment"\)\)/);
assert.match(routeSource, /app\.post\("\/custodial-device-auth\/recover", configured, nativeEnrollment\("recovery"\)\)/);
assert.match(routeSource, /nativeCredentialParts\(req\)/);

console.log("CUSTODIAL_EMPLOYEE_ADMIN_AUTHORIZATION_PASS");
