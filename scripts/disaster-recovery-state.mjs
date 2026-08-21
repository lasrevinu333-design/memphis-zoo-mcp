import { createHash } from "node:crypto";
import { stableJson } from "./disaster-recovery-crypto.mjs";

function quoteIdentifier(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function qualified(schema, table) { return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`; }

const SNAPSHOT_CATEGORIES = [
  { category: "employee_device_credentials", schema: "public", table: "device_auth_credentials", fields: ["credential_id", "device_id", "confirmed_at", "expires_at", "revoked_at", "revoked_reason", "created_at", "last_used_at"] },
  { category: "employee_enrollment", schema: "public", table: "device_auth_enrollment_codes", fields: ["enrollment_id", "device_id", "created_at", "expires_at", "consumed_at", "consumed_by_credential_id", "revoked_at", "failed_attempts"] },
  { category: "device_assignments", schema: "public", table: "devices", fields: ["id", "device_id", "active", "assigned_employee_id", "assignment_epoch", "last_seen_at", "updated_at"] },
  { category: "employee_status", schema: "public", table: "employees", fields: ["id", "employee_code", "display_name", "active", "role", "employment_status", "departed_at", "updated_at"] },
  { category: "manager_trusted_devices", schema: "public", table: "ops_manager_trusted_devices", fields: ["credential_id", "manager_id", "device_id", "device_label", "max_access_level", "created_at", "last_used_at", "expires_at", "revoked_at", "revoked_reason"] },
  { category: "manager_enrollment", schema: "public", table: "ops_manager_enrollment_codes", fields: ["id", "manager_id", "status", "created_at", "expires_at", "consumed_at", "consumed_credential_id", "revoked_at", "revoked_reason"] },
  { category: "cleaning_sessions", schema: "public", table: "sessions", fields: ["id", "session_uuid", "client_session_id", "location_id", "employee_id", "device_id", "employee_name_snapshot", "location_code_snapshot", "location_name_snapshot", "device_identifier_snapshot", "device_name_snapshot", "assignment_epoch_snapshot", "identity_snapshot_provenance", "status", "started_at", "ended_at", "created_at", "updated_at"] },
  { category: "cleaning_session_corrections", schema: "public", table: "custodial_session_corrections", fields: ["correction_id", "operation_id", "request_fingerprint", "session_id", "corrected_by_manager_id", "corrected_by_manager_name_snapshot", "reason", "changed_fields", "effective_employee_id", "effective_employee_name_snapshot", "effective_location_id", "effective_location_code_snapshot", "effective_location_name_snapshot", "effective_device_id", "effective_device_identifier_snapshot", "effective_device_name_snapshot", "effective_assignment_epoch_snapshot", "effective_started_at", "effective_ended_at", "created_at"] },
  { category: "cleaning_completions", schema: "public", table: "completion_responses", fields: ["id", "session_id", "client_completion_id", "location_id", "submitted_by_employee_id", "device_id", "submitted_at", "created_at"] },
  { category: "release_identity", schema: "public", table: "release_deployment_manifest", fields: ["release_id", "backend_commit", "frontend_commit", "migration_head", "migration_manifest_sha256", "environment_contract_version", "status", "details_json", "created_at", "deployed_at"] },
];

async function existingColumns(db, schema, table) {
  const result = await db.query(`
    select column_name
    from information_schema.columns
    where table_schema=$1 and table_name=$2
  `, [schema, table]);
  return new Set(result.rows.map((row) => row.column_name));
}

async function categoryState(db, descriptor) {
  const relation = await db.query("select to_regclass($1) relation", [`${descriptor.schema}.${descriptor.table}`]);
  if (!relation.rows[0]?.relation) return { missing: true, rows: [], row_count: 0, sha256: createHash("sha256").update("[]").digest("hex") };
  const columns = await existingColumns(db, descriptor.schema, descriptor.table);
  const selected = descriptor.fields.filter((field) => columns.has(field));
  if (!selected.length) throw new Error(`No approved snapshot columns exist on ${descriptor.schema}.${descriptor.table}.`);
  const projection = selected.map(quoteIdentifier).join(",");
  const order = selected.map((field) => `${quoteIdentifier(field)}::text nulls first`).join(",");
  const result = await db.query(`select ${projection} from ${qualified(descriptor.schema, descriptor.table)} order by ${order}`);
  const rows = result.rows;
  const encoded = stableJson(rows);
  return {
    missing: false,
    fields: selected,
    rows,
    row_count: rows.length,
    sha256: createHash("sha256").update(encoded).digest("hex"),
  };
}

export async function capturePreRestoreState(db, { restoreId, generation }) {
  const evidence = {};
  for (const descriptor of SNAPSHOT_CATEGORIES) {
    const state = await categoryState(db, descriptor);
    await db.query(`
      insert into custodial_dr.pre_restore_snapshots(
        restore_id,authority_generation,category,row_count,snapshot_sha256,state_json
      ) values ($1,$2,$3,$4,$5,$6::jsonb)
      on conflict (restore_id,category) do update set
        row_count=excluded.row_count,snapshot_sha256=excluded.snapshot_sha256,
        state_json=excluded.state_json,captured_at=clock_timestamp()
    `, [restoreId, generation, descriptor.category, state.row_count, state.sha256, JSON.stringify({ fields: state.fields || [], rows: state.rows })]);
    evidence[descriptor.category] = { row_count: state.row_count, sha256: state.sha256, missing: state.missing };
  }
  return evidence;
}

export async function compareRestoredState(db, { restoreId, generation }) {
  const discrepancies = [];
  for (const descriptor of SNAPSHOT_CATEGORIES) {
    const beforeResult = await db.query(`
      select row_count,snapshot_sha256,state_json
      from custodial_dr.pre_restore_snapshots
      where restore_id=$1 and category=$2
    `, [restoreId, descriptor.category]);
    if (beforeResult.rowCount !== 1) throw new Error(`Missing pre-restore snapshot for ${descriptor.category}.`);
    const before = beforeResult.rows[0];
    const restored = await categoryState(db, descriptor);
    if (before.snapshot_sha256 === restored.sha256 && Number(before.row_count) === restored.row_count) continue;
    const details = {
      pre_restore_fields: before.state_json?.fields || [],
      restored_fields: restored.fields || [],
      pre_restore_identities: (before.state_json?.rows || []).slice(0, 500),
      restored_identities: restored.rows.slice(0, 500),
      evidence_truncated: (before.state_json?.rows || []).length > 500 || restored.rows.length > 500,
    };
    await db.query(`
      insert into custodial_dr.restore_discrepancies(
        restore_id,authority_generation,category,before_sha256,restored_sha256,
        before_count,restored_count,details_json
      ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      on conflict (restore_id,category) do update set
        status='OPEN',before_sha256=excluded.before_sha256,restored_sha256=excluded.restored_sha256,
        before_count=excluded.before_count,restored_count=excluded.restored_count,
        details_json=excluded.details_json,resolved_by=null,resolved_at=null,resolution=null
    `, [restoreId, generation, descriptor.category, before.snapshot_sha256, restored.sha256, before.row_count, restored.row_count, JSON.stringify(details)]);
    discrepancies.push({ category: descriptor.category, before_count: Number(before.row_count), restored_count: restored.row_count });
  }
  return discrepancies;
}

async function updateIfPresent(db, { schema = "public", table, assignments, predicate = "true" }) {
  const relation = await db.query("select to_regclass($1) relation", [`${schema}.${table}`]);
  if (!relation.rows[0]?.relation) return 0;
  const columns = await existingColumns(db, schema, table);
  const usable = assignments.filter(([column]) => columns.has(column));
  if (!usable.length) return 0;
  const params = [];
  const clauses = usable.map(([column, value, raw]) => {
    if (raw) return `${quoteIdentifier(column)}=${value}`;
    params.push(value);
    return `${quoteIdentifier(column)}=$${params.length}`;
  });
  const result = await db.query(`update ${qualified(schema, table)} set ${clauses.join(",")} where ${predicate}`, params);
  return result.rowCount;
}

export async function invalidateRestoredAuthority(db, { generation }) {
  const reason = `disaster_restore_generation_${generation}`;
  const employeeCredentials = await updateIfPresent(db, {
    table: "device_auth_credentials",
    assignments: [["revoked_at", "clock_timestamp()", true], ["revoked_reason", reason]],
    predicate: "revoked_at is null",
  });
  const employeeEnrollment = await updateIfPresent(db, {
    table: "device_auth_enrollment_codes",
    assignments: [["revoked_at", "clock_timestamp()", true]],
    predicate: "revoked_at is null",
  });
  const managerCredentials = await updateIfPresent(db, {
    table: "ops_manager_trusted_devices",
    assignments: [["revoked_at", "clock_timestamp()", true], ["revoked_reason", reason]],
    predicate: "revoked_at is null",
  });
  const managerEnrollment = await updateIfPresent(db, {
    table: "ops_manager_enrollment_codes",
    assignments: [["status", "revoked"], ["revoked_at", "clock_timestamp()", true], ["revoked_reason", reason]],
    predicate: "status='active'",
  });
  const managerPush = await updateIfPresent(db, {
    table: "ops_manager_push_devices",
    assignments: [["enabled", false], ["revoked_at", "clock_timestamp()", true], ["revoked_reason", reason]],
    predicate: "coalesce(enabled,true)=true or revoked_at is null",
  });
  const authSessionsRelation = await db.query("select to_regclass('auth.sessions') relation");
  let authSessions = 0;
  if (authSessionsRelation.rows[0]?.relation) {
    const deleted = await db.query("delete from auth.sessions");
    authSessions = deleted.rowCount;
  }
  return { employee_credentials: employeeCredentials, employee_enrollment: employeeEnrollment, manager_credentials: managerCredentials, manager_enrollment: managerEnrollment, manager_push: managerPush, auth_sessions: authSessions };
}

export async function preserveCurrentReleaseIdentity(db, { restoreId }) {
  const result = await db.query(`
    select state_json
    from custodial_dr.pre_restore_snapshots
    where restore_id=$1 and category='release_identity'
  `, [restoreId]);
  const rows = result.rows[0]?.state_json?.rows || [];
  for (const row of rows) {
    await db.query(`
      insert into public.release_deployment_manifest(
        release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256,
        environment_contract_version,status,details_json,created_at,deployed_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
      on conflict (release_id) do update set
        backend_commit=excluded.backend_commit,frontend_commit=excluded.frontend_commit,
        migration_head=excluded.migration_head,migration_manifest_sha256=excluded.migration_manifest_sha256,
        environment_contract_version=excluded.environment_contract_version,status=excluded.status,
        details_json=excluded.details_json,created_at=excluded.created_at,deployed_at=excluded.deployed_at
    `, [row.release_id, row.backend_commit, row.frontend_commit, row.migration_head, row.migration_manifest_sha256, row.environment_contract_version, row.status, JSON.stringify(row.details_json || {}), row.created_at, row.deployed_at]);
  }
  return rows.length;
}
