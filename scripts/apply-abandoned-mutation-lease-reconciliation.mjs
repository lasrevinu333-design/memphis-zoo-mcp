#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import {
  abandonedMutationLeaseReconciliationBinding,
  requireSigningKey,
  stableJson,
  verifyBinding,
} from "./disaster-recovery-crypto.mjs";

const { Client } = pg;
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const databaseCaCertPath = String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim();
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const confirmedRef = String(process.env.ABANDONED_LEASE_RECONCILIATION_CONFIRM_PROJECT_REF || "").trim();
const apply = String(process.env.ABANDONED_LEASE_RECONCILIATION_APPLY || "false").toLowerCase() === "true";
const key = requireSigningKey(process.env.ABANDONED_LEASE_RECONCILIATION_VERIFY_KEY, "ABANDONED_LEASE_RECONCILIATION_VERIFY_KEY");
const keyId = String(process.env.ABANDONED_LEASE_RECONCILIATION_VERIFY_KEY_ID || "").trim();
const envelope = JSON.parse(String(process.env.ABANDONED_LEASE_RECONCILIATION_JSON || "null"));
const MAX_TERMINATION_EVIDENCE_AGE_MS = 60 * 60 * 1000;

if (!apply) throw new Error("ABANDONED_LEASE_RECONCILIATION_APPLY=true is required.");
if (!databaseUrl || !/^[a-z0-9]{20}$/.test(projectRef) || confirmedRef !== projectRef) throw new Error("Exact database and project confirmation identity is required.");
if (!envelope || envelope.format !== "memphis-zoo-abandoned-mutation-lease-reconciliation.v1"
    || envelope.algorithm !== "hmac-sha256" || envelope.key_id !== keyId
    || !verifyBinding(abandonedMutationLeaseReconciliationBinding(envelope.intent || {}), envelope.signature, key)) {
  throw new Error("Abandoned mutation lease reconciliation signature verification failed.");
}
const intent = envelope.intent || {};
if (!/^[0-9a-f-]{36}$/i.test(String(intent.reconciliation_id || ""))
    || intent.target_project_ref !== projectRef || !Number.isSafeInteger(intent.authority_generation)
    || !["READY", "PAUSED_FAILURE"].includes(intent.control_state) || !Array.isArray(intent.leases)
    || !intent.evidence || intent.evidence.format !== "memphis-zoo.abandoned-mutation-lease-evidence.v1") {
  throw new Error("Abandoned mutation lease reconciliation identity is invalid.");
}
const expiresAt = Date.parse(String(intent.expires_at || ""));
const approvedAt = Date.parse(String(intent.approved_at || ""));
if (!Number.isFinite(expiresAt) || !Number.isFinite(approvedAt) || approvedAt > Date.now()
    || expiresAt <= Date.now() || expiresAt > Date.now() + 24 * 60 * 60 * 1000) throw new Error("Abandoned lease reconciliation is expired or exceeds the 24-hour authorization window.");
const intentDigest = createHash("sha256").update(stableJson(abandonedMutationLeaseReconciliationBinding(intent))).digest("hex");

function iso(value) { return new Date(value).toISOString(); }
function normalizeLease(row) {
  return {
    request_id: String(row.request_id),
    authority_generation: Number(row.authority_generation),
    service_name: String(row.service_name),
    admitted_at: iso(row.admitted_at),
    heartbeat_at: iso(row.heartbeat_at),
    expires_at: iso(row.expires_at),
  };
}

const db = new Client({
  connectionString: databaseUrl,
  application_name: "memphis-zoo-apply-abandoned-lease-reconciliation",
  ...(databaseCaCertPath ? { ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true } } : {}),
});
await db.connect();
await db.query("select pg_advisory_lock(hashtextextended('memphis-zoo-production-restore',0))");
try {
  await db.query("begin isolation level serializable");
  await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))");
  const controlResult = await db.query("select authority_generation,mutations_paused,state,restore_id,target_project_ref from custodial_dr.restore_control where singleton=true for update");
  const control = controlResult.rows[0];
  if (!control || Number(control.authority_generation) !== intent.authority_generation
      || control.state !== intent.control_state || String(control.restore_id || "") !== String(intent.restore_id || "")
      || (control.target_project_ref && control.target_project_ref !== projectRef)) throw new Error("Restore control changed after abandoned-lease approval.");
  const prior = await db.query("select intent_sha256 from custodial_dr.application_mutation_lease_reconciliations where reconciliation_id=$1", [intent.reconciliation_id]);
  if (prior.rowCount) {
    if (prior.rows[0].intent_sha256 !== intentDigest) throw new Error("Reconciliation ID was already used by different authority.");
    const remaining = await db.query("select count(*)::int count from custodial_dr.application_mutation_leases where request_id=any($1::uuid[])", [intent.leases.map((row) => row.request_id)]);
    if (Number(remaining.rows[0].count) !== 0) throw new Error("A prior reconciliation record exists but its leases remain.");
    await db.query("commit");
    console.log(JSON.stringify({ ok: true, idempotent_replay: true, reconciliation_id: intent.reconciliation_id }));
    process.exit(0);
  }
  const leaseResult = await db.query(`
    select request_id,authority_generation,service_name,admitted_at,heartbeat_at,expires_at
    from custodial_dr.application_mutation_leases order by request_id for update
  `);
  const actual = leaseResult.rows.map(normalizeLease);
  if (stableJson(actual) !== stableJson(intent.leases)) throw new Error("Application mutation lease state changed after reconciliation approval.");
  if (!actual.length || leaseResult.rows.some((row) => Date.parse(row.expires_at) > Date.now())) throw new Error("Only the complete exact expired lease set can be reconciled.");
  const observations = intent.evidence.observations || [];
  if (stableJson(observations.map((row) => ({ request_id: row.request_id, service_name: row.service_name })))
      !== stableJson(actual.map((row) => ({ request_id: row.request_id, service_name: row.service_name })))
      || intent.evidence.evidence_sha256 !== createHash("sha256").update(stableJson(observations)).digest("hex")
      || observations.some((row) => {
        const lease = actual.find((item) => item.request_id === row.request_id);
        const observedAt = Date.parse(String(row.observed_at || ""));
        return row.owning_process_terminated !== true || String(row.observation || "").trim().length < 20
          || !lease || !Number.isFinite(observedAt) || observedAt < Date.parse(lease.expires_at)
          || observedAt > approvedAt || approvedAt - observedAt > MAX_TERMINATION_EVIDENCE_AGE_MS;
      })) {
    throw new Error("Signed process-termination evidence does not cover the exact lease set.");
  }
  const deleted = await db.query("delete from custodial_dr.application_mutation_leases where request_id=any($1::uuid[])", [actual.map((row) => row.request_id)]);
  if (deleted.rowCount !== actual.length) throw new Error("Failed to delete the exact reconciled lease set.");
  await db.query(`
    insert into custodial_dr.application_mutation_lease_reconciliations(
      reconciliation_id,authority_generation,restore_id,intent_sha256,actor,leases_json,evidence_json
    ) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
  `, [intent.reconciliation_id, intent.authority_generation, intent.restore_id, intentDigest, intent.actor, JSON.stringify(intent.leases), JSON.stringify(intent.evidence)]);
  await db.query("commit");
  console.log(JSON.stringify({ ok: true, idempotent_replay: false, reconciliation_id: intent.reconciliation_id, reconciled_leases: actual.length, control_state_unchanged: control.state }));
} catch (error) {
  await db.query("rollback").catch(() => {});
  throw error;
} finally {
  await db.query("select pg_advisory_unlock(hashtextextended('memphis-zoo-production-restore',0))").catch(() => {});
  await db.end().catch(() => {});
}
