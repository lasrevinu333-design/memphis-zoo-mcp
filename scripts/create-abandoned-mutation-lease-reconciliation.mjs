#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import {
  abandonedMutationLeaseReconciliationBinding,
  requireSigningKey,
  signBinding,
  stableJson,
} from "./disaster-recovery-crypto.mjs";

const { Client } = pg;
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const databaseCaCertPath = String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim();
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const actor = String(process.env.ABANDONED_LEASE_RECONCILIATION_NAMED_ACTOR || "").trim();
const key = requireSigningKey(process.env.ABANDONED_LEASE_RECONCILIATION_SIGNING_KEY, "ABANDONED_LEASE_RECONCILIATION_SIGNING_KEY");
const keyId = String(process.env.ABANDONED_LEASE_RECONCILIATION_SIGNING_KEY_ID || "").trim();
const ttlMinutes = Math.max(5, Math.min(60, Number(process.env.ABANDONED_LEASE_RECONCILIATION_TTL_MINUTES || 30)));
const evidence = JSON.parse(String(process.env.ABANDONED_LEASE_RECONCILIATION_EVIDENCE_JSON || "null"));
const MAX_TERMINATION_EVIDENCE_AGE_MS = 60 * 60 * 1000;

if (!databaseUrl || !/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("SUPABASE_DB_URL and SUPABASE_PROJECT_REF are required.");
if (!actor || !/^[a-zA-Z0-9 ._@:-]{2,160}$/.test(actor)) throw new Error("ABANDONED_LEASE_RECONCILIATION_NAMED_ACTOR must identify the approving operator.");
if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(keyId)) throw new Error("ABANDONED_LEASE_RECONCILIATION_SIGNING_KEY_ID is required.");

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
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
function validateEvidence(value, leases) {
  if (!value || value.format !== "memphis-zoo.abandoned-mutation-lease-evidence.v1" || !Array.isArray(value.observations)) {
    throw new Error("ABANDONED_LEASE_RECONCILIATION_EVIDENCE_JSON must be explicit v1 process-termination evidence.");
  }
  const observations = value.observations.map((row) => ({
    request_id: String(row?.request_id || "").toLowerCase(),
    service_name: String(row?.service_name || "").trim(),
    owning_process_terminated: row?.owning_process_terminated === true,
    observation: String(row?.observation || "").trim(),
    observed_at: iso(row?.observed_at),
  })).sort((a, b) => a.request_id.localeCompare(b.request_id));
  if (observations.some((row) => !/^[0-9a-f-]{36}$/.test(row.request_id)
      || !row.service_name || row.owning_process_terminated !== true
      || row.observation.length < 20 || row.observation.length > 2000
      || Date.parse(row.observed_at) > Date.now())) {
    throw new Error("Every expired lease requires exact, past-dated, named process-termination evidence.");
  }
  const expected = leases.map((row) => ({ request_id: row.request_id, service_name: row.service_name }));
  const actual = observations.map((row) => ({ request_id: row.request_id, service_name: row.service_name }));
  if (stableJson(actual) !== stableJson(expected)) throw new Error("Process-termination evidence must equal the complete exact expired lease set.");
  for (const observation of observations) {
    const lease = leases.find((row) => row.request_id === observation.request_id);
    const observedAt = Date.parse(observation.observed_at);
    if (!lease || observedAt < Date.parse(lease.expires_at) || Date.now() - observedAt > MAX_TERMINATION_EVIDENCE_AGE_MS) {
      throw new Error("Process-termination evidence must be current and observed only after the exact lease expired.");
    }
  }
  return { format: value.format, observations, evidence_sha256: sha256(stableJson(observations)) };
}

const db = new Client({
  connectionString: databaseUrl,
  application_name: "memphis-zoo-create-abandoned-lease-reconciliation",
  ...(databaseCaCertPath ? { ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true } } : {}),
});
await db.connect();
try {
  await db.query("begin isolation level repeatable read read only");
  const controlResult = await db.query("select authority_generation,mutations_paused,state,restore_id,target_project_ref from custodial_dr.restore_control where singleton=true");
  const control = controlResult.rows[0];
  if (!control || !["READY", "PAUSED_FAILURE"].includes(control.state)
      || (control.state === "READY" && control.mutations_paused !== false)
      || (control.state === "PAUSED_FAILURE" && control.mutations_paused !== true)) {
    throw new Error("Abandoned leases can be reconciled only in READY or fail-closed PAUSED_FAILURE state.");
  }
  if (control.target_project_ref && control.target_project_ref !== projectRef) throw new Error("The control plane targets a different project.");
  const leaseResult = await db.query(`
    select request_id,authority_generation,service_name,admitted_at,heartbeat_at,expires_at
    from custodial_dr.application_mutation_leases order by request_id
  `);
  if (!leaseResult.rowCount) throw new Error("No abandoned application mutation lease is present.");
  if (leaseResult.rows.some((row) => Date.parse(row.expires_at) > Date.now())) throw new Error("A live application mutation lease cannot be reconciled as abandoned.");
  const leases = leaseResult.rows.map(normalizeLease);
  const normalizedEvidence = validateEvidence(evidence, leases);
  const intent = {
    reconciliation_id: randomUUID(),
    target_project_ref: projectRef,
    authority_generation: Number(control.authority_generation),
    restore_id: control.restore_id ? String(control.restore_id) : null,
    control_state: control.state,
    leases,
    evidence: normalizedEvidence,
    actor,
    approved_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
  };
  console.log(JSON.stringify({
    format: "memphis-zoo-abandoned-mutation-lease-reconciliation.v1",
    algorithm: "hmac-sha256",
    key_id: keyId,
    intent,
    signature: signBinding(abandonedMutationLeaseReconciliationBinding(intent), key),
  }));
  await db.query("rollback");
} finally {
  await db.end();
}
