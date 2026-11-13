#!/usr/bin/env node
import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import { installCustodialEmployeeAdminRoutes } from "../src/custodial-employee-admin.js";

const root = new URL("../", import.meta.url);
const env = {
  DEVICE_CREDENTIAL_SECRET: "custodial-removal-contract-secret-with-sufficient-entropy",
};
const device = {
  id: "41000000-0000-4000-8000-000000000001",
  device_id: "KIOSK_02",
  device_name: "Removal Contract Phone",
  active: true,
  assigned_employee_id: "41000000-0000-4000-8000-000000000002",
  employees: {
    id: "41000000-0000-4000-8000-000000000002",
    employee_code: "EMPREM02",
    display_name: "Removal Contract Employee",
    active: true,
    role: "staff",
  },
};
const credentialId = "41000000-0000-4000-8000-000000000003";
const credentialSecret = "removal_contract_credential_secret_1234567890";
const rawCredential = `${credentialId}.${credentialSecret}`;
const databaseCalls = [];
const db = {
  from(name) {
    databaseCalls.push({ table: name });
    throw new Error(`Protected removal must refuse before any table access: ${name}`);
  },
  async rpc(name, args = {}) {
    databaseCalls.push({ name, args: structuredClone(args) });
    throw new Error(`Protected removal must refuse before any RPC: ${name}`);
  },
};

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
const nativeHeaders = {
  "content-type": "application/json",
  origin: "https://localhost",
  "x-memphis-app-edition": "custodial",
  "x-device-id": "KIOSK_02",
};
async function request({ body, headers = {} }) {
  const response = await fetch(`${baseUrl}/custodial-device-auth/remove`, {
    method: "POST",
    headers: { ...nativeHeaders, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function assertPreservationRefusal(result) {
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    ok: false,
    code: "custodial_native_removal_inventory_admission_required",
    error: "Enrollment removal requires protected-work preservation and manager authorization. Saved work is retained.",
  });
  assert.equal(databaseCalls.length, 0, "legacy native headers and credentials cannot authorize inventory access or revocation");
  assert.equal(JSON.stringify(result.body).includes(credentialSecret), false);
}

try {
  const operationId = "41000000-0000-4000-8000-000000000010";
  const body = { operation_id: operationId, device_id: "KIOSK_02" };

  const first = await request({
    body,
    headers: { authorization: `Device ${rawCredential}`, "idempotency-key": operationId },
  });
  assertPreservationRefusal(first);

  // A repeated legacy request cannot turn a preserved refusal into revocation
  // or a fabricated successful replay. The typed removal owner is unfinished.
  const replay = await request({
    body,
    headers: { authorization: `Device ${rawCredential}`, "idempotency-key": operationId },
  });
  assertPreservationRefusal(replay);

  const wrongCredential = `${credentialId}.wrong_credential_secret_12345678901234567890`;
  const wrongProof = await request({
    body,
    headers: { authorization: `Device ${wrongCredential}`, "idempotency-key": operationId },
  });
  assertPreservationRefusal(wrongProof);

  const newOperationId = "41000000-0000-4000-8000-000000000011";
  const newOperation = await request({
    body: { operation_id: newOperationId, device_id: "KIOSK_02" },
    headers: { authorization: `Device ${rawCredential}`, "idempotency-key": newOperationId },
  });
  assertPreservationRefusal(newOperation);

  const operationOnly = await request({
    body,
    headers: { "idempotency-key": operationId },
  });
  assertPreservationRefusal(operationOnly);

  const callerDeclaredAdmission = await request({
    body: { ...body, manager_authorized: true, inventory_complete: true, protected_work_preserved: true },
    headers: { authorization: `Device ${rawCredential}`, "idempotency-key": operationId },
  });
  assertPreservationRefusal(callerDeclaredAdmission);

  const mismatchedKey = await request({
    body,
    headers: {
      authorization: `Device ${rawCredential}`,
      "idempotency-key": "41000000-0000-4000-8000-000000000012",
    },
  });
  assert.equal(mismatchedKey.status, 409);
  assert.equal(mismatchedKey.body.code, "removal_operation_conflict");

  const missingOperation = await request({
    body: { device_id: "KIOSK_02" },
    headers: { authorization: `Device ${rawCredential}` },
  });
  assert.equal(missingOperation.status, 400);
  assert.equal(missingOperation.body.code, "removal_operation_id_required");

  const malformedOperation = await request({
    body: { operation_id: "not-a-uuid", device_id: device.device_id },
    headers: { authorization: `Device ${rawCredential}` },
  });
  assert.equal(malformedOperation.status, 400);
  assert.equal(malformedOperation.body.code, "removal_operation_id_required");

  const untrustedOriginResponse = await fetch(`${baseUrl}/custodial-device-auth/remove`, {
    method: "POST",
    headers: {
      ...nativeHeaders,
      origin: "https://example.invalid",
      authorization: `Device ${rawCredential}`,
      "idempotency-key": operationId,
    },
    body: JSON.stringify(body),
  });
  const untrustedOrigin = await untrustedOriginResponse.json();
  assert.equal(untrustedOriginResponse.status, 403);
  assert.equal(untrustedOrigin.code, "native_custodial_app_required");
  assert.equal(databaseCalls.length, 0, "all refusal and operation-validation paths must leave saved work and credentials untouched");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const [migration, routeSource] = await Promise.all([
  readFile(new URL("supabase/migrations/20260801195620_custodial_device_removal_operation.sql", root), "utf8"),
  readFile(new URL("src/custodial-employee-admin.js", root), "utf8"),
]);
for (const contract of [
  "device_auth_removal_operations",
  "device_auth_remove_custodial_credential",
  "employee_push_registrations",
  "event_push_instances",
  "operational_notification_jobs",
  "device_auth_events",
]) assert.ok(migration.includes(contract), `missing removal migration contract ${contract}`);
assert.match(migration, /force row level security/i);
assert.match(migration, /revoke all on table public\.device_auth_removal_operations from public, anon, authenticated/i);
assert.match(migration, /status in \('pending', 'leased'\)/i);
assert.match(migration, /token_hash = p_token_hash/i, "terminal replay must remain bound to the original credential hash");
assert.doesNotMatch(migration, /device_credential\s+text/i, "removal history must not persist a plaintext credential");
assert.match(routeSource, /\/custodial-device-auth\/remove/);
assert.match(routeSource, /custodial_native_removal_inventory_admission_required/);
assert.doesNotMatch(routeSource, /device_auth_remove_custodial_credential/,
  "the legacy HTTP route must not call around the unfinished protected-work removal protocol");

console.log("CUSTODIAL_DEVICE_REMOVAL_CONTRACT_PASS");
