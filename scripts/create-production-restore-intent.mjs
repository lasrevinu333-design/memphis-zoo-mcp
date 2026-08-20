#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import {
  requireSigningKey,
  restoreIntentBinding,
  signBinding,
  stableJson,
} from "./disaster-recovery-crypto.mjs";

const { Client } = pg;
const sourceDir = resolve(String(process.env.RESTORE_SOURCE_DIR || ""));
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const actor = String(process.env.RESTORE_NAMED_ACTOR || "").trim();
const key = requireSigningKey(process.env.RESTORE_INTENT_SIGNING_KEY, "RESTORE_INTENT_SIGNING_KEY");
const keyId = String(process.env.RESTORE_INTENT_SIGNING_KEY_ID || "").trim();
const ttlMinutes = Math.max(5, Math.min(60, Number(process.env.RESTORE_INTENT_TTL_MINUTES || 30)));

if (!sourceDir || !databaseUrl || !/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("RESTORE_SOURCE_DIR, SUPABASE_DB_URL and SUPABASE_PROJECT_REF are required.");
if (!actor || !/^[a-zA-Z0-9 ._@:-]{2,160}$/.test(actor)) throw new Error("RESTORE_NAMED_ACTOR must identify the approving operator.");
if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(keyId)) throw new Error("RESTORE_INTENT_SIGNING_KEY_ID is required.");

const summary = JSON.parse(readFileSync(join(sourceDir, "backup-summary.json"), "utf8"));
const checksumBytes = readFileSync(join(sourceDir, "SHA256SUMS"));
const archiveDigest = createHash("sha256").update(checksumBytes).digest("hex");
if (summary.format !== "memphis-zoo-disaster-recovery.v3" || summary.project_ref !== projectRef) {
  throw new Error("The archive is not a v3 archive for the exact target project.");
}

const db = new Client({ connectionString: databaseUrl, application_name: "memphis-zoo-restore-intent" });
await db.connect();
try {
  await db.query("begin read only");
  const control = await db.query("select authority_generation,mutations_paused from custodial_dr.restore_control where singleton=true");
  if (control.rowCount !== 1 || control.rows[0].mutations_paused) throw new Error("The restore control plane is already paused or unavailable.");
  const migration = await db.query("select max(version)::text migration_head from supabase_migrations.schema_migrations");
  const release = await db.query(`
    select release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256
    from public.release_deployment_manifest
    where status in ('deployed','validated','candidate')
    order by (status='deployed') desc,deployed_at desc nulls last,created_at desc limit 1
  `);
  if (release.rowCount !== 1) throw new Error("The target release identity is unavailable.");
  const intent = {
    restore_id: randomUUID(),
    authority_generation: Number(control.rows[0].authority_generation) + 1,
    archive_digest: archiveDigest,
    source_project_ref: summary.project_ref,
    target_project_ref: projectRef,
    source_identity_sha256: createHash("sha256").update(stableJson(summary.source_identity)).digest("hex"),
    target_migration_head: String(migration.rows[0]?.migration_head || ""),
    target_release_identity: release.rows[0],
    actor,
    approved_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
    resume_after_verification: false,
  };
  const envelope = {
    format: "memphis-zoo-production-restore-intent.v1",
    algorithm: "hmac-sha256",
    key_id: keyId,
    intent,
    signature: signBinding(restoreIntentBinding(intent), key),
  };
  console.log(JSON.stringify(envelope));
  await db.query("rollback");
} finally {
  await db.end();
}
