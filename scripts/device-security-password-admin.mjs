#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import argon2 from "argon2";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const OUT = "/home/eric/.config/memphis-zoo/device-security-app.env";
const ACTION = String(process.argv[2] || "verify-config").trim();

function strongPassword() {
  return randomBytes(24).toString("base64url");
}

async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 64 * 1024,
    timeCost: 3,
    parallelism: 1,
  });
}

async function writePrivatePasswordFile(password) {
  await mkdir(dirname(OUT), { recursive: true, mode: 0o700 });
  await chmod(dirname(OUT), 0o700);
  const content = [
    "# Memphis Zoo Device Security application password",
    "# Keep this file private. Do not commit, paste, screenshot, or upload it.",
    `DEVICE_SECURITY_APP_PASSWORD=${password}`,
    `DEVICE_SECURITY_APP_CREATED_AT=${new Date().toISOString()}`,
    "",
  ].join("\n");
  await writeFile(OUT, content, { mode: 0o600 });
  await chmod(OUT, 0o600);
}

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function upsertHash(hash, action) {
  const client = supabase();
  if (!client) {
    console.log("SUPABASE_CONFIG_MISSING");
    return false;
  }
  const { data: current, error: readError } = await client
    .from("ops_manager_device_security_config")
    .select("password_version")
    .eq("singleton", true)
    .maybeSingle();
  if (readError) throw readError;
  const nextVersion = Number(current?.password_version || 0) + 1;
  const { error } = await client
    .from("ops_manager_device_security_config")
    .upsert({
      singleton: true,
      password_hash: hash,
      password_version: nextVersion,
      rotated_at: new Date().toISOString(),
      sessions_revoked_at: new Date().toISOString(),
      metadata_json: { updated_by: "scripts/device-security-password-admin.mjs", action },
    });
  if (error) throw error;
  const { error: revokeError } = await client
    .from("ops_manager_device_security_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: "password_rotation" })
    .is("revoked_at", null);
  if (revokeError) throw revokeError;
  console.log("DEVICE_SECURITY_PASSWORD_HASH_APPLIED");
  return true;
}

async function verifyConfig() {
  let local = false;
  try {
    const content = await readFile(OUT, "utf8");
    local = /DEVICE_SECURITY_APP_PASSWORD=.+/.test(content);
  } catch {}
  const client = supabase();
  let remote = false;
  if (client) {
    const { data, error } = await client
      .from("ops_manager_device_security_config")
      .select("password_version,rotated_at")
      .eq("singleton", true)
      .maybeSingle();
    if (error) throw error;
    remote = Boolean(data?.password_version);
  }
  console.log(JSON.stringify({ ok: true, local_password_file: local, remote_config_present: remote, path: OUT }));
}

async function main() {
  if (ACTION === "init" || ACTION === "rotate") {
    const password = strongPassword();
    const hash = await hashPassword(password);
    await writePrivatePasswordFile(password);
    await upsertHash(hash, ACTION);
    console.log(`DEVICE_SECURITY_PASSWORD_${ACTION.toUpperCase()}_COMPLETE`);
    console.log(`PASSWORD_FILE=${OUT}`);
    return;
  }
  if (ACTION === "revoke-sessions") {
    const client = supabase();
    if (!client) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to revoke sessions.");
    const { error } = await client
      .from("ops_manager_device_security_sessions")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: "local_admin_revoke_all" })
      .is("revoked_at", null);
    if (error) throw error;
    console.log("DEVICE_SECURITY_SESSIONS_REVOKED");
    return;
  }
  await verifyConfig();
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
