#!/usr/bin/env node

import pg from "pg";

const { Client } = pg;
const databaseUrl = String(process.env.SUPABASE_DB_URL || "").trim();
const expectedArchiveDigest = String(process.env.RESTORE_REHEARSAL_EXPECTED_ARCHIVE_DIGEST || "").trim();
if (String(process.env.RESTORE_REHEARSAL_ACCEPT_EMPTY_TARGET || "").toLowerCase() !== "true") {
  throw new Error("RESTORE_REHEARSAL_ACCEPT_EMPTY_TARGET=true is required.");
}
const target = new URL(databaseUrl);
if (!/^(127\.0\.0\.1|localhost)$/.test(target.hostname)
    || !/^\/mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(target.pathname)
    || !/^[0-9a-f]{64}$/.test(expectedArchiveDigest)) {
  throw new Error("Isolated reconciliation is restricted to a loopback mz_schema_rebuild_* target and one exact archive digest.");
}

const allowedCategories = new Set([
  "employee_device_credentials",
  "employee_enrollment",
  "device_assignments",
  "employee_status",
  "manager_trusted_devices",
  "manager_enrollment",
  "cleaning_sessions",
  "cleaning_session_corrections",
  "cleaning_completions",
  "release_identity",
]);
const db = new Client({ connectionString: databaseUrl, application_name: "memphis-zoo-isolated-restore-rehearsal-reconciliation" });
await db.connect();
try {
  await db.query("begin");
  const control = await db.query("select * from custodial_dr.restore_control where singleton=true for update");
  if (control.rowCount !== 1 || control.rows[0].archive_digest !== expectedArchiveDigest) throw new Error("Isolated reconciliation does not match the exact restored archive.");
  if (control.rows[0].state === "COMPLETE" && control.rows[0].mutations_paused === false) {
    await db.query("commit");
    console.log(JSON.stringify({ ok: true, stage: "isolated_restore_already_resumed", restore_id: control.rows[0].restore_id }));
  } else {
  if (control.rows[0].state !== "PAUSED_RECONCILIATION" || control.rows[0].mutations_paused !== true) {
    throw new Error("Only a verified isolated restore held for explicit reconciliation can be resumed.");
  }
  const manifest = await db.query("select * from custodial_dr.restore_manifests where restore_id=$1 for update", [control.rows[0].restore_id]);
  const record = manifest.rows[0];
  if (!record || record.database_verified !== true || record.storage_verified !== true
      || record.authority_invalidated !== true || record.post_restore_verified !== true
      || record.storage_evidence?.database_only_metadata_verified !== true) {
    throw new Error("Isolated restore verification is incomplete; reconciliation cannot resume it.");
  }
  const discrepancies = await db.query("select category,before_count,restored_count from custodial_dr.restore_discrepancies where restore_id=$1 and status='OPEN' order by category", [control.rows[0].restore_id]);
  const unexpected = discrepancies.rows.filter((row) => !allowedCategories.has(row.category));
  if (unexpected.length) throw new Error(`Isolated restore has unexpected discrepancies: ${unexpected.map((row) => row.category).join(",")}.`);
  await db.query(`
    update custodial_dr.restore_discrepancies set
      status='RESOLVED',resolved_by='GitHub isolated restore rehearsal',resolved_at=clock_timestamp(),
      resolution='Disposable target was created from the signed schema with no operational continuity claim; restored archive becomes the rehearsal authority.'
    where restore_id=$1 and status='OPEN'
  `, [control.rows[0].restore_id]);
  await db.query(`
    update custodial_dr.restore_control set state='COMPLETE',mutations_paused=false,completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where singleton=true and restore_id=$1
  `, [control.rows[0].restore_id]);
  await db.query(`
    insert into custodial_dr.restore_events(restore_id,authority_generation,phase,outcome,actor,evidence_json)
    values ($1,$2,'ISOLATED_REHEARSAL_RECONCILIATION','RESOLVED','GitHub isolated restore rehearsal',$3::jsonb)
  `, [control.rows[0].restore_id, control.rows[0].authority_generation, JSON.stringify({ archive_digest: expectedArchiveDigest, resolved_categories: discrepancies.rows })]);
  await db.query("commit");
  console.log(JSON.stringify({ ok: true, stage: "isolated_restore_explicitly_reconciled", restore_id: control.rows[0].restore_id, resolved_discrepancies: discrepancies.rowCount }));
  }
} catch (error) {
  await db.query("rollback").catch(() => {});
  throw error;
} finally {
  await db.end();
}
