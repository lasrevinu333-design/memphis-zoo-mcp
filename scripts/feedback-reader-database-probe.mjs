#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runReadOnlySql } from "../src/supabase/read.js";

const privilegedUrl = String(process.env.FEEDBACK_PROBE_DATABASE_URL || "").trim();
const readerUrl = String(process.env.FEEDBACK_PROBE_READER_DATABASE_URL || "").trim();

if (!privilegedUrl || !readerUrl) {
  throw new Error("FEEDBACK_PROBE_DATABASE_URL and FEEDBACK_PROBE_READER_DATABASE_URL are required");
}

const privilegedPool = new Pool({ connectionString: privilegedUrl, max: 1, connectionTimeoutMillis: 10_000 });
const readerPool = new Pool({ connectionString: readerUrl, max: 1, connectionTimeoutMillis: 10_000 });
const operationId = randomUUID();
const unrelatedOperationId = randomUUID();
const feedbackId = randomUUID();
const requestFingerprint = createHash("sha256")
  .update(`feedback-reader-database-probe:${operationId}`)
  .digest("hex");
const admittedColumns = [
  "acknowledged_at", "acknowledged_by", "category", "created_at", "device_id",
  "feedback_reminder_count", "hub_context", "id", "last_feedback_reminder_at",
  "message", "metadata_json", "notification_status", "notified_ops_count",
  "operation_id", "page_url", "priority", "request_fingerprint", "status",
  "submitted_by", "summary", "updated_at",
];

try {
  const writer = await privilegedPool.connect();
  try {
    await writer.query("begin");
    await writer.query("set local role service_role");
    await writer.query(
      `select public.app_apply_operational_command('feedback_create',$1::jsonb)`,
      [JSON.stringify({
        id: feedbackId,
        operation_id: operationId,
        request_fingerprint: requestFingerprint,
        category: "other",
        priority: "normal",
        message: "Restricted feedback reader database probe",
        submitted_by: "release-rehearsal",
        hub_context: "public",
        device_id: null,
        page_url: null,
        summary: "Restricted feedback reader database probe",
        metadata_json: { source: "feedback-reader-database-probe" },
      })],
    );
    await writer.query("commit");
  } catch (error) {
    await writer.query("rollback").catch(() => {});
    throw error;
  } finally {
    writer.release();
  }

  const visible = await runReadOnlySql({
    pool: readerPool,
    sql: `
      select id,operation_id,request_fingerprint,category,priority,message,submitted_by,
             hub_context,device_id,page_url,status,summary,notification_status,
             notified_ops_count,last_feedback_reminder_at,feedback_reminder_count,
             acknowledged_at,acknowledged_by,metadata_json,created_at,updated_at
      from public.system_feedback_items
      where operation_id='${operationId}'::uuid
    `,
  });
  assert.equal(visible.rows.length, 1, "the restricted reader must observe the canonical feedback row");
  assert.equal(visible.rows[0].id, feedbackId);
  assert.equal(visible.rows[0].operation_id, operationId);
  assert.equal(visible.rows[0].request_fingerprint, requestFingerprint);

  const unrelated = await runReadOnlySql({
    pool: readerPool,
    sql: `select id from public.system_feedback_items where operation_id='${unrelatedOperationId}'::uuid`,
  });
  assert.deepEqual(unrelated.rows, [], "an unrelated operation id must return no feedback row");

  await assert.rejects(
    () => readerPool.query("insert into public.system_feedback_items(message) values ('forbidden')"),
    /read-only|permission denied/i,
    "the restricted login must not mutate feedback rows",
  );
  await assert.rejects(
    () => readerPool.query("select feedback_id from public.system_feedback_legacy_image_backups limit 1"),
    /permission denied/i,
    "the restricted login must not observe private legacy image evidence",
  );

  const authority = await privilegedPool.query(`
    with reader as (
      select oid from pg_roles where rolname='custodial_application_reader'
    ), projected_columns as (
      select array_agg(a.attname::text order by a.attname::text)::text[] as names
      from pg_attribute a
      cross join lateral aclexplode(a.attacl) acl
      where a.attrelid='public.system_feedback_items'::regclass
        and a.attnum>0 and not a.attisdropped and a.attacl is not null
        and acl.grantee=(select oid from reader)
        and acl.privilege_type='SELECT' and not acl.is_grantable
    ), policies as (
      select count(*)::integer as count
      from pg_policy p
      where p.polrelid='public.system_feedback_items'::regclass
        and (select oid from reader)=any(p.polroles)
        and p.polname='custodial_application_reader_system_feedback_runtime'
        and p.polcmd='r' and p.polpermissive
        and pg_get_expr(p.polqual,p.polrelid)='true'
    ), inventory as (
      select count(*)::integer as count,
             bool_and(definition_sha256=encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex')) as hashes_exact
      from public.custodial_release_authority_restore_inventory
      where (object_kind,object_identity) in (
        ('function',to_regprocedure('public.app_get_public_rate_limit_count(text,text)')::text),
        ('grant','public.app_get_public_rate_limit_count(text,text)'),
        ('grant','public.system_feedback_items'),
        ('policy','public.system_feedback_items:custodial_application_reader_system_feedback_runtime')
      )
    )
    select
      (select names from projected_columns) as projected_columns,
      (select count from policies) as policy_count,
      not has_table_privilege('custodial_application_reader','public.system_feedback_items','select') as no_relation_select,
      not has_table_privilege('custodial_application_reader','public.system_feedback_items','insert')
        and not has_table_privilege('custodial_application_reader','public.system_feedback_items','update')
        and not has_table_privilege('custodial_application_reader','public.system_feedback_items','delete') as no_mutation,
      not has_table_privilege('custodial_application_reader','public.system_feedback_legacy_image_backups','select') as legacy_hidden,
      (select count from inventory) as inventory_count,
      (select hashes_exact from inventory) as inventory_hashes_exact
  `);
  const facts = authority.rows[0];
  assert.deepEqual(facts.projected_columns, admittedColumns, "feedback reader column authority must be exact");
  assert.equal(facts.policy_count, 1, "the feedback reader must have exactly one admitted policy");
  assert.equal(facts.no_relation_select, true, "future feedback columns must not be implicitly admitted");
  assert.equal(facts.no_mutation, true, "feedback reader mutation authority must remain absent");
  assert.equal(facts.legacy_hidden, true, "legacy feedback image evidence must remain private");
  assert.equal(facts.inventory_count, 4, "feedback recovery inventory must cover function, grants, and policy");
  assert.equal(facts.inventory_hashes_exact, true, "feedback recovery inventory hashes must be exact");

  const persisted = await privilegedPool.query(
    "select count(*)::integer as count from public.system_feedback_items where operation_id=$1::uuid",
    [operationId],
  );
  assert.equal(persisted.rows[0].count, 1, "the bounded writer must persist exactly one probe row");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    probe: "feedback_reader_database_authority",
    operation_id: operationId,
    feedback_id: feedbackId,
    writer: "app_apply_operational_command.feedback_create",
    reader_projection_columns: admittedColumns.length,
    sole_reader_policy: true,
    unrelated_operation_rows: 0,
    reader_mutation_denied: true,
    legacy_image_backup_hidden: true,
    recovery_inventory_exact: true,
  })}\n`);
} finally {
  await Promise.allSettled([privilegedPool.end(), readerPool.end()]);
}
