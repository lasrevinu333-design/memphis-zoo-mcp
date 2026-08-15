import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import {
  custodialEmployeeAdminInternals,
  installCustodialEmployeeAdminRoutes,
} from "../src/custodial-employee-admin.js";

const root = new URL("../", import.meta.url);
const env = {
  DEVICE_CREDENTIAL_SECRET: "custodial-enrollment-contract-secret-with-sufficient-entropy",
};
const device = {
  id: "10000000-0000-4000-8000-000000000001",
  device_id: "KIOSK_02",
  device_name: "Contract Custodial Phone",
  active: true,
  assigned_employee_id: "10000000-0000-4000-8000-000000000002",
  employees: {
    id: "10000000-0000-4000-8000-000000000002",
    employee_code: "EMP002",
    display_name: "Contract Employee",
    active: true,
    role: "staff",
  },
};

function deviceQuery() {
  return {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: structuredClone(device), error: null }; },
  };
}

const operations = new Map();
const rpcCalls = [];
const db = {
  from(name) {
    if (name !== "devices") throw new Error(`Unexpected table in enrollment contract: ${name}`);
    return deviceQuery();
  },
  async rpc(name, args = {}) {
    rpcCalls.push({ name, args: structuredClone(args) });
    if (name === "device_auth_expire_custodial_enrollment_operations") {
      return { data: { ok: true, expired: 0 }, error: null };
    }
    if (name === "device_auth_consume_enrollment_operation") {
      // Yield so two requests can reach the operation boundary concurrently.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const existing = operations.get(args.p_operation_id);
      if (existing) {
        if (existing.requestFingerprint !== args.p_request_fingerprint || existing.flow !== args.p_flow || existing.deviceId !== args.p_device_id) {
          return { data: { ok: false, reason: "operation_conflict" }, error: null };
        }
        return { data: { ...existing.result, replayed: true }, error: null };
      }
      const result = {
        ok: true,
        replayed: false,
        status: "committed",
        operation_id: args.p_operation_id,
        flow: args.p_flow,
        credential_id: args.p_credential_id,
        credential_expires_at: args.p_expires_at,
        resume_expires_at: args.p_result_expires_at,
        encryption_version: args.p_encryption_version,
        result_ciphertext: args.p_result_ciphertext,
        result_iv: args.p_result_iv,
        result_auth_tag: args.p_result_auth_tag,
      };
      operations.set(args.p_operation_id, {
        deviceId: args.p_device_id,
        flow: args.p_flow,
        requestFingerprint: args.p_request_fingerprint,
        tokenHash: args.p_token_hash,
        result,
      });
      return { data: result, error: null };
    }
    if (name === "device_auth_confirm_enrollment_operation") {
      const operation = operations.get(args.p_operation_id);
      if (!operation || operation.tokenHash !== args.p_token_hash) {
        return { data: { ok: false, reason: "credential_mismatch" }, error: null };
      }
      operation.confirmed = true;
      return { data: {
        ok: true,
        replayed: false,
        status: "confirmed",
        operation_id: args.p_operation_id,
        credential_id: args.p_credential_id,
        credential_active: true,
      }, error: null };
    }
    if (name === "device_auth_cancel_enrollment_operation") {
      return { data: { ok: true, status: "cancelled", operation_id: args.p_operation_id }, error: null };
    }
    throw new Error(`Unexpected RPC in enrollment contract: ${name}`);
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
async function request(pathname, { body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { ...nativeHeaders, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

try {
  const operationId = "20000000-0000-4000-8000-000000000001";
  const enrollmentBody = {
    operation_id: operationId,
    flow: "enrollment",
    device_id: "KIOSK_02",
    enrollment_code: "12345678",
    device_label: "Contract Build 11",
  };
  const first = await request("/custodial-device-auth/enroll", {
    body: enrollmentBody,
    headers: { "idempotency-key": operationId },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.data.operation_id, operationId);
  assert.equal(first.body.data.flow, "enrollment");
  assert.equal(first.body.data.replayed, false);
  assert.match(first.body.data.device_credential, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{32,}$/i);
  assert.equal(first.body.data.credential_id, first.body.data.device_credential.split(".")[0]);
  assert.equal(first.body.data.device_id, "KIOSK_02");
  assert.equal(first.body.data.employee.display_name, "Contract Employee");

  const rawCredential = first.body.data.device_credential;
  const persistedOperation = operations.get(operationId);
  assert.ok(persistedOperation);
  assert.equal(JSON.stringify(persistedOperation).includes(rawCredential), false, "server operation state must not contain a plaintext device credential");
  assert.equal(rpcCalls.find((call) => call.name === "device_auth_consume_enrollment_operation").args.p_token_hash.length, 64);

  // Treat the first response as lost/native persistence as failed.  Retrying
  // the same operation and code must return the exact same credential.
  const replay = await request("/custodial-device-auth/enroll", {
    body: enrollmentBody,
    headers: { "idempotency-key": operationId },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.replayed, true);
  assert.equal(replay.body.data.device_credential, rawCredential);
  assert.equal(replay.body.data.credential_id, first.body.data.credential_id);

  const conflict = await request("/custodial-device-auth/enroll", {
    body: { ...enrollmentBody, enrollment_code: "87654321" },
    headers: { "idempotency-key": operationId },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "enrollment_operation_conflict");

  const confirm = await request(`/custodial-device-auth/enrollment-operations/${operationId}/confirm`, {
    body: { device_id: "KIOSK_02" },
    headers: { authorization: `Device ${rawCredential}` },
  });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.data.status, "confirmed");
  assert.equal(operations.get(operationId).confirmed, true);

  const recoveryId = "20000000-0000-4000-8000-000000000002";
  const recovery = await request("/custodial-device-auth/recover", {
    body: { operation_id: recoveryId, flow: "recovery", device_id: "KIOSK_02", enrollment_code: "23456789" },
    headers: { "idempotency-key": recoveryId },
  });
  assert.equal(recovery.status, 200);
  assert.equal(recovery.body.data.flow, "recovery");

  const mismatchedKey = await request("/custodial-device-auth/enroll", {
    body: { ...enrollmentBody, operation_id: "20000000-0000-4000-8000-000000000003" },
    headers: { "idempotency-key": "20000000-0000-4000-8000-000000000004" },
  });
  assert.equal(mismatchedKey.status, 409);

  const encrypted = custodialEmployeeAdminInternals.encryptEnrollmentResult(env, operationId, { secret: "authenticated" });
  assert.deepEqual(
    custodialEmployeeAdminInternals.decryptEnrollmentResult(env, operationId, {
      encryption_version: encrypted.encryptionVersion,
      result_ciphertext: encrypted.ciphertext,
      result_iv: encrypted.iv,
      result_auth_tag: encrypted.authTag,
    }),
    { secret: "authenticated" },
  );
  const tamperedCiphertext = Buffer.from(encrypted.ciphertext, "base64url");
  tamperedCiphertext[0] ^= 0x01;
  await assert.rejects(async () => custodialEmployeeAdminInternals.decryptEnrollmentResult(env, operationId, {
    encryption_version: encrypted.encryptionVersion,
    result_ciphertext: tamperedCiphertext.toString("base64url"),
    result_iv: encrypted.iv,
    result_auth_tag: encrypted.authTag,
  }), /could not be authenticated/i);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const [migration, routeSource, authSource, notificationSource, workerSource] = await Promise.all([
  readFile(new URL("supabase/migrations/20260801164407_custodial_enrollment_resume_and_push_revocation.sql", root), "utf8"),
  readFile(new URL("src/custodial-employee-admin.js", root), "utf8"),
  readFile(new URL("src/auth/device-credential-auth.js", root), "utf8"),
  readFile(new URL("src/employee-notifications.js", root), "utf8"),
  readFile(new URL("src/index.js", root), "utf8"),
]);
for (const contract of [
  "device_auth_enrollment_operations",
  "device_auth_consume_enrollment_operation",
  "device_auth_confirm_enrollment_operation",
  "device_auth_cancel_enrollment_operation",
  "device_auth_expire_custodial_enrollment_operations",
  "mz_resolve_employee_push_delivery",
  "finish_operational_notification_job_terminal",
]) assert.ok(migration.includes(contract), `missing migration contract ${contract}`);
assert.match(migration, /force row level security/i);
assert.match(migration, /revoke all on table public\.device_auth_enrollment_operations from public,anon,authenticated/i);
assert.doesNotMatch(migration, /device_credential\s+text/i, "migration must not define plaintext credential storage");
assert.match(routeSource, /aes-256-gcm/);
assert.match(routeSource, /Idempotency-Key/);
assert.match(routeSource, /\/custodial-device-auth\/recover/);
assert.match(routeSource, /enrollment-operations\/:operationId\/confirm/);
assert.match(authSource, /Device logout could not be durably recorded/);
assert.match(notificationSource, /mz_resolve_employee_push_delivery/);
assert.match(notificationSource, /beforeFinalDeliveryCheck/);
assert.match(workerSource, /finish_operational_notification_job_terminal/);

console.log("CUSTODIAL_ENROLLMENT_SECURITY_CONTRACT_PASS");
