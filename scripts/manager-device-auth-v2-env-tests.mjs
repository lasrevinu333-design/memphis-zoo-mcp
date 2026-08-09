#!/usr/bin/env node
import assert from "node:assert/strict";
import { getRuntimeEnv, validateRuntimeEnv } from "../src/config/env.js";

const names = [
  "DATABASE_URL",
  "GEMINI_ADMIN_SESSION_SECRET",
  "GITHUB_OWNER",
  "GITHUB_REPO",
  "GITHUB_TOKEN",
  "GOOGLE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON",
  "MANAGER_V2_ATTESTATION_POLICY_JSON",
  "MANAGER_V2_ENABLED",
  "MANAGER_V2_SERVER_SECRET",
  "MOXIE_WEB_COOKIE_SECRET",
  "OPS_MANAGER_SESSION_SECRET",
  "SUPABASE_DB_CA_CERT_PATH",
  "SUPABASE_DB_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
];
const original = new Map(names.map((name) => [name, process.env[name]]));

function restore() {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

try {
  for (const name of names) delete process.env[name];
  process.env.MANAGER_V2_ENABLED = "true";
  process.env.MANAGER_V2_SERVER_SECRET = "é".repeat(16);
  process.env.OPS_MANAGER_SESSION_SECRET = "x".repeat(32);
  process.env.SUPABASE_DB_URL = "not-a-postgres-url";
  process.env.MANAGER_V2_ATTESTATION_POLICY_JSON = JSON.stringify({
    policy_version: "manager-device-attestation.v1",
    ios_apps: [{
      app_id: "ABCDEFGHIJ.org.memphiszoo.ops",
      environment: "production",
      validation_categories: [2],
      bundle_versions: ["11"],
      max_access_level: "read_only",
    }],
  });
  let manager = getRuntimeEnv().manager_device_auth_v2;
  assert.equal(manager.server_secret_configured, true, "secret readiness must use UTF-8 bytes, matching runtime authority");
  assert.equal(manager.database_url_present, true);
  assert.equal(manager.database_url_valid, false);
  assert.equal(manager.database_ca_required, false);

  process.env.MANAGER_V2_SERVER_SECRET = "x".repeat(31);
  process.env.SUPABASE_DB_URL = "postgresql://postgres@example.supabase.co:5432/postgres";
  manager = getRuntimeEnv().manager_device_auth_v2;
  assert.equal(manager.server_secret_configured, false);
  assert.equal(manager.database_url_valid, true);
  assert.equal(manager.database_ca_required, true);

  process.env.GITHUB_OWNER = "test-owner";
  process.env.GITHUB_REPO = "test-repo";
  process.env.GITHUB_TOKEN = "test-token";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "s".repeat(32);
  const validation = validateRuntimeEnv({ strict: true });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("MANAGER_V2_SERVER_SECRET must contain at least 32 bytes."));
  assert.ok(validation.errors.includes("SUPABASE_DB_CA_CERT_PATH is required for remote manager device-auth v2 database connections."));

  process.env.SUPABASE_DB_URL = "postgresql://postgres@localhost:5432/postgres";
  manager = getRuntimeEnv().manager_device_auth_v2;
  assert.equal(manager.database_url_valid, true);
  assert.equal(manager.database_ca_required, false);
} finally {
  restore();
}

console.log("manager device-auth v2 environment validation tests passed");
