import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import {
  assertOpsManagerSessionSecret,
  installSharedAuthRoutes,
} from "../src/auth/shared-access-auth.js";

const env = {
  NODE_ENV: "production",
  RENDER: "1",
  OPS_MANAGER_SESSION_SECRET: "manager-boundary-test-secret-at-least-32-characters",
};
const allowedOrigin = "https://localhost";
const manager = {
  manager_id: "00000000-0000-4000-8000-000000000002",
  display_name: "Named Manager",
  roles: ["OPS_MANAGER"],
  active: true,
  revoked_at: null,
};

assert.throws(
  () => assertOpsManagerSessionSecret({ NODE_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: "must-not-be-reused" }),
  /OPS_MANAGER_SESSION_SECRET/,
  "a Supabase or unrelated secret must not satisfy manager session signing",
);
assert.equal(assertOpsManagerSessionSecret(env), env.OPS_MANAGER_SESSION_SECRET);
assert.throws(
  () => assertOpsManagerSessionSecret({ NODE_ENV: "production", OPS_MANAGER_SESSION_SECRET: "too-short" }),
  /at least 32 characters/i,
);
for (const reusedName of [
  "DEVICE_CREDENTIAL_SECRET",
  "CUSTODIAL_BACKEND_PROOF_SECRET",
  "CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MOXIE_WEB_COOKIE_SECRET",
]) {
  assert.throws(
    () => assertOpsManagerSessionSecret({
      ...env,
      [reusedName]: env.OPS_MANAGER_SESSION_SECRET,
    }),
    new RegExp(reusedName),
    `manager session authority must remain independent from ${reusedName}`,
  );
}

const migration = await readFile(new URL("../supabase/migrations/20260820143000_bound_ops_manager_device_trust.sql", import.meta.url), "utf8");
assert.match(migration, /expires_at = created_at \+ interval '365 days'/i);
assert.match(migration, /pre_bounded_trust_expires_at/i, "the cutover must preserve rollback evidence");
assert.match(migration, /check \(expires_at <= created_at \+ interval '365 days'\)/i);

let enrolled = null;
let revokeFailure = false;
const store = {
  async getManagerCodeRateLimit() { return null; },
  async recordManagerCodeFailure() { return { locked_until: null }; },
  async clearManagerCodeFailures() {},
  async consumeManagerEnrollmentCode(record) {
    enrolled = {
      credential_id: record.credential_id,
      device_id: record.device_id,
      device_label: record.device_label,
      token_hash: record.token_hash,
      max_access_level: "full_access",
      manager_id: manager.manager_id,
      manager,
      created_at: new Date().toISOString(),
      expires_at: record.expires_at,
      revoked_at: null,
    };
    return { ok: true, manager, trusted_device: enrolled };
  },
  async find(credentialId) { return credentialId === enrolled?.credential_id ? enrolled : null; },
  async touch() {},
  async audit() {},
  async revoke(credentialId) {
    if (revokeFailure) throw new Error("simulated revocation outage");
    if (credentialId === enrolled?.credential_id) enrolled.revoked_at = new Date().toISOString();
  },
};

const app = express();
app.use(express.json({ limit: "32kb" }));
installSharedAuthRoutes(app, { env, trustedDeviceStore: store, setCors() {} });
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function json(path, { method = "GET", origin, cookie, body, deviceId = "manager-phone" } = {}) {
  const headers = { "x-device-id": deviceId };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

try {
  const enrollmentBody = { manager_code: "24681357", device_id: "manager-phone", device_label: "Manager Phone" };
  let result = await json("/auth-api/ops/manager-codes/consume", { method: "POST", body: enrollmentBody });
  assert.equal(result.response.status, 403, "manager enrollment must reject a missing browser/app origin");

  result = await json("/auth-api/ops/manager-codes/consume", {
    method: "POST", origin: "https://attacker.example", body: enrollmentBody,
  });
  assert.equal(result.response.status, 403, "manager enrollment must reject an untrusted origin");

  result = await json("/auth-api/ops/manager-codes/consume", {
    method: "POST", origin: allowedOrigin, body: enrollmentBody,
  });
  assert.equal(result.response.status, 200);
  assert.equal(Object.hasOwn(result.payload.data, "device_credential"), false, "reusable credential must never enter JSON");
  const setCookie = result.response.headers.get("set-cookie") || "";
  assert.match(setCookie, /memphis_ops_trust=.*HttpOnly.*SameSite=None.*Secure/);
  const cookie = setCookie.split(";")[0];

  result = await json("/auth-api/session?access_level=full_access", { origin: allowedOrigin, deviceId: "manager-phone" });
  assert.equal(result.response.status, 401, "a browser device ID alone must provide no authority");

  result = await json("/auth-api/session?access_level=full_access", { cookie, deviceId: "manager-phone" });
  assert.equal(result.response.status, 403, "cookie refresh must reject a missing origin");

  result = await json("/auth-api/session?access_level=full_access", {
    origin: "https://attacker.example", cookie, deviceId: "manager-phone",
  });
  assert.equal(result.response.status, 403, "cookie refresh must reject an untrusted origin");

  result = await json("/auth-api/session?access_level=full_access", { origin: allowedOrigin, cookie, deviceId: "manager-phone" });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.session.manager_id, manager.manager_id);

  enrolled.created_at = new Date(Date.now() - 366 * 86_400_000).toISOString();
  enrolled.expires_at = new Date(Date.now() + 3650 * 86_400_000).toISOString();
  result = await json("/auth-api/session?access_level=full_access", { origin: allowedOrigin, cookie, deviceId: "manager-phone" });
  assert.equal(result.response.status, 401, "legacy ten-year trust must be capped even when its row expiry is later");
  enrolled.created_at = new Date().toISOString();
  enrolled.expires_at = new Date(Date.now() + 90 * 86_400_000).toISOString();

  revokeFailure = true;
  result = await json("/auth-api/ops/logout", { method: "POST", origin: allowedOrigin, cookie, deviceId: "manager-phone" });
  assert.equal(result.response.status, 500);
  assert.equal(result.response.headers.get("set-cookie"), null, "failed revocation must not clear the trusted cookie");
  assert.equal(enrolled.revoked_at, null, "failed revocation must not report or simulate logout");

  revokeFailure = false;
  result = await json("/auth-api/ops/logout", { method: "POST", origin: allowedOrigin, cookie, deviceId: "manager-phone" });
  assert.equal(result.response.status, 200);
  assert.match(result.response.headers.get("set-cookie") || "", /Max-Age=0/);
  assert.ok(enrolled.revoked_at, "successful logout must durably revoke before clearing the cookie");

  console.log("MANAGER_CREDENTIAL_BOUNDARY_PASS");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
