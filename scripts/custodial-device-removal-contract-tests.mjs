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
const operations = new Map();
const rpcCalls = [];
let credentialRevoked = false;

function deviceQuery() {
  return {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: structuredClone(device), error: null }; },
  };
}

const db = {
  from(name) {
    if (name !== "devices") throw new Error(`Unexpected table in removal contract: ${name}`);
    return deviceQuery();
  },
  async rpc(name, args = {}) {
    if (name !== "device_auth_remove_custodial_credential") {
      throw new Error(`Unexpected RPC in removal contract: ${name}`);
    }
    rpcCalls.push({ name, args: structuredClone(args) });
    if (args.p_operation_id === "41000000-0000-4000-8000-000000000019") {
      return { data: null, error: new Error("injected internal database detail must not cross the HTTP boundary") };
    }
    const existing = operations.get(args.p_operation_id);
    if (existing) {
      if (existing.credentialId !== args.p_credential_id
          || existing.deviceId !== args.p_device_id
          || existing.tokenHash !== args.p_token_hash) {
        return { data: { ok: false, reason: "operation_conflict" }, error: null };
      }
      return { data: { ...existing.result, replayed: true }, error: null };
    }
    if (credentialRevoked) return { data: { ok: false, reason: "credential_revoked" }, error: null };

    const result = {
      ok: true,
      removed: true,
      replayed: false,
      status: "removed",
      operation_id: args.p_operation_id,
      credential_id: args.p_credential_id,
      device_id: device.device_id,
      removed_at: new Date().toISOString(),
      push_registrations_deactivated: 1,
      event_push_instances_cancelled: 1,
      notification_jobs_cancelled: 2,
      claimed_notification_jobs_cancelled: 1,
    };
    operations.set(args.p_operation_id, {
      credentialId: args.p_credential_id,
      deviceId: args.p_device_id,
      tokenHash: args.p_token_hash,
      result,
    });
    credentialRevoked = true;
    return { data: result, error: null };
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

try {
  const operationId = "41000000-0000-4000-8000-000000000010";
  const body = { operation_id: operationId, device_id: "KIOSK_02" };

  const first = await request({
    body,
    headers: { authorization: `Device ${rawCredential}`, "idempotency-key": operationId },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.deepEqual({
    removed: first.body.data.removed,
    replayed: first.body.data.replayed,
    status: first.body.data.status,
    operation_id: first.body.data.operation_id,
    device_id: first.body.data.device_id,
  }, {
    removed: true,
    replayed: false,
    status: "removed",
    operation_id: operationId,
    device_id: "KIOSK_02",
  });
  assert.equal(first.body.data.claimed_notification_jobs_cancelled, 1);
  const firstRpc = rpcCalls.at(-1);
  assert.equal(firstRpc.args.p_credential_id, credentialId);
  assert.equal(firstRpc.args.p_device_id, device.id);
  assert.equal(firstRpc.args.p_token_hash.length, 64);
  assert.equal(JSON.stringify(firstRpc.args).includes(credentialSecret), false, "the RPC boundary must receive only a one-way credential hash");
  assert.equal(Object.hasOwn(firstRpc.args, "p_now"), false, "the database must own the removal timestamp");

  // Treat the first HTTP response as lost. The exact operation and exact
  // credential proof must replay after revocation without repeating effects.
  const replay = await request({
    body,
    headers: { authorization: `Device ${rawCredential}`, "idempotency-key": operationId },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.replayed, true);
  assert.equal(replay.body.data.operation_id, operationId);
  assert.equal(operations.size, 1);

  const wrongCredential = `${credentialId}.wrong_credential_secret_12345678901234567890`;
  const conflict = await request({
    body,
    headers: { authorization: `Device ${wrongCredential}`, "idempotency-key": operationId },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "removal_operation_conflict");

  const revokedNewOperation = "41000000-0000-4000-8000-000000000011";
  const revoked = await request({
    body: { operation_id: revokedNewOperation, device_id: "KIOSK_02" },
    headers: { authorization: `Device ${rawCredential}`, "idempotency-key": revokedNewOperation },
  });
  assert.equal(revoked.status, 401);
  assert.equal(revoked.body.code, "credential_revoked");

  const beforeMissingCredential = rpcCalls.length;
  const operationOnly = await request({
    body,
    headers: { "idempotency-key": operationId },
  });
  assert.equal(operationOnly.status, 401);
  assert.equal(operationOnly.body.code, "credential_required");
  assert.equal(rpcCalls.length, beforeMissingCredential, "an operation UUID alone must never reach the removal RPC");

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

  const internalFailureId = "41000000-0000-4000-8000-000000000019";
  const internalFailure = await request({
    body: { operation_id: internalFailureId, device_id: "KIOSK_02" },
    headers: { authorization: `Device ${rawCredential}`, "idempotency-key": internalFailureId },
  });
  assert.equal(internalFailure.status, 503);
  assert.equal(internalFailure.body.error, "Custodial device removal failed.");
  assert.equal(JSON.stringify(internalFailure.body).includes("internal database detail"), false);

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
assert.match(routeSource, /device_auth_remove_custodial_credential/);

console.log("CUSTODIAL_DEVICE_REMOVAL_CONTRACT_PASS");
