import pg from "pg";
import { isProxy } from "node:util/types";
import { createHash } from "node:crypto";
import { stableJson } from "./disaster-recovery-crypto.mjs";
import { productionBackupDataEncoding, productionBackupTextColumnsDataEncoding } from "./production-backup-pg-dump-command.mjs";
import { readVerifiedArchiveSourceBinding, readVerifiedImmutableBootstrapInventory, readVerifiedRestoreTableSelection, postgresTextColumnsLineEncoding, decodeRestoreTableRowLine } from "./disaster-recovery-archive.mjs";

function quoteIdentifier(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function qualified(schema, table) { return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`; }
// New native TEXT-column originals distinguish SQL NULL from JSON null.
// Historical v1 stays v1; raw rows never roundtrip through driver values or
// JS numeric/Date/parsed JSON DATA. Shape is never restoration DATA.
const PRE_RESTORE_SNAPSHOT_DATA_ENCODING = productionBackupTextColumnsDataEncoding;

// Private representation checks only; never transaction/effect authority.
function snapshotInvalid() { throw new Error("Original snapshot representation is unavailable or invalid."); }
function snapshotOwn(value, key, invalid = snapshotInvalid) {
  if (!value || typeof value !== "object" || isProxy(value)) invalid();
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field || !Object.hasOwn(field, "value")) invalid();
  return field.value;
}
function snapshotArray(value, invalid = snapshotInvalid) {
  if (!value || isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, i) => snapshotOwn(value, String(i), invalid));
}
function snapshotData(value, keys, invalid = snapshotInvalid) {
  if (!value || typeof value !== "object" || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== keys.length) invalid();
  return Object.fromEntries(keys.map(key => [key, snapshotOwn(value, key, invalid)]));
}
function snapshotRows(result, invalid = snapshotInvalid) {
  const rows = snapshotArray(snapshotOwn(result, "rows", invalid), invalid);
  if (snapshotOwn(result, "rowCount", invalid) !== rows.length) invalid();
  return rows;
}
function snapshotRowShape(raw, fields, encoding) {
  if (typeof raw !== "string" || ![productionBackupDataEncoding, PRE_RESTORE_SNAPSHOT_DATA_ENCODING].includes(encoding)) snapshotInvalid();
  // Reuse the existing lossless decoder/duplicate/Unicode checks. This is a
  // STRING envelope, not reserialization of parsed numeric/date/JSON DATA.
  const original = decodeRestoreTableRowLine(JSON.stringify(raw), {
    data_encoding: encoding, columns: fields.map(name => ({ name })),
  });
  const shape = JSON.parse(original); // Shape/identity only; never SQL DATA.
  if (stableJson(Object.keys(shape)) !== stableJson(fields)) snapshotInvalid();
  return shape;
}
function snapshotKeyLiteral(value) {
  return "E'" + value.replaceAll("\\", "\\\\").replaceAll("'", "''") + "'";
}
function snapshotTextProjection(fields, alias) {
  return `pg_catalog.json_object(ARRAY[${fields.map(snapshotKeyLiteral).join(",")}]::pg_catalog.text[],`
    + `ARRAY[${fields.map(field => `${alias}.${quoteIdentifier(field)}::pg_catalog.text`).join(",")}]::pg_catalog.text[])::pg_catalog.text`;
}
async function requireSnapshotTextOutput(db) {
  const invalid = () => { throw Object.assign(new Error("Native snapshot TEXT output profile is unavailable."), {
    code: "RESTORE_SNAPSHOT_TEXT_OUTPUT_UNAVAILABLE",
  }); };
  const rows = snapshotRows(await db.query(`select pg_catalog.current_setting('extra_float_digits') float_digits,
    pg_catalog.current_setting('DateStyle') date_style,pg_catalog.current_setting('TimeZone') timezone,
    pg_catalog.current_setting('IntervalStyle') interval_style,pg_catalog.current_setting('bytea_output') bytea_output`), invalid);
  if (rows.length !== 1) invalid();
  const value = snapshotData(rows[0], ["float_digits", "date_style", "timezone", "interval_style", "bytea_output"], invalid);
  if (value.float_digits !== "3" || value.date_style !== "ISO, YMD" || value.timezone !== "UTC"
      || value.interval_style !== "postgres" || value.bytea_output !== "hex") invalid();
}

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

async function categoryState(db, descriptor, encoding = PRE_RESTORE_SNAPSHOT_DATA_ENCODING) {
  if (![productionBackupDataEncoding, PRE_RESTORE_SNAPSHOT_DATA_ENCODING].includes(encoding)) snapshotInvalid();
  const relation = await db.query("select to_regclass($1) relation", [`${descriptor.schema}.${descriptor.table}`]);
  const relations = snapshotRows(relation);
  if (relations.length !== 1) snapshotInvalid();
  const actualRelation = snapshotData(relations[0], ["relation"]).relation;
  if (actualRelation !== null && (typeof actualRelation !== "string" || !actualRelation)) snapshotInvalid();
  if (actualRelation === null) return { missing: true, fields: [], data_encoding: encoding,
    rows: [], row_count: 0, sha256: createHash("sha256").update("[]").digest("hex") };
  const columns = await existingColumns(db, descriptor.schema, descriptor.table);
  const selected = descriptor.fields.filter((field) => columns.has(field));
  if (!selected.length) throw new Error(`No approved snapshot columns exist on ${descriptor.schema}.${descriptor.table}.`);
  const projection = selected.map(quoteIdentifier).join(",");
  const order = selected.map((field) => `r.${quoteIdentifier(field)}::text nulls first`).join(",");
  const textColumns = encoding === PRE_RESTORE_SNAPSHOT_DATA_ENCODING;
  if (textColumns) await requireSnapshotTextOutput(db);
  const result = await db.query(textColumns
    ? `select ${snapshotTextProjection(selected, "r")} original_row from (select ${projection} from ${qualified(descriptor.schema, descriptor.table)}) r order by ${selected.map(field => `r.${quoteIdentifier(field)}::pg_catalog.text collate pg_catalog."C" nulls first`).join(",")}`
    : `select row_to_json(r)::text original_row from (select ${projection} from ${qualified(descriptor.schema, descriptor.table)}) r order by ${order}`);
  if (textColumns) await requireSnapshotTextOutput(db);
  const rows = snapshotRows(result).map((row) => {
    const { original_row } = snapshotData(row, ["original_row"]);
    snapshotRowShape(original_row, selected, encoding);
    return original_row; // Original native UTF8 only, never parsed DATA.
  });
  const encoded = stableJson(rows);
  return {
    missing: false,
    fields: selected,
    data_encoding: encoding,
    rows,
    row_count: rows.length,
    sha256: createHash("sha256").update(encoded).digest("hex"),
  };
}

function preRestoreGeneration(restoreId, generation) {
  if (typeof restoreId !== "string" || restoreId.length !== 36
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(restoreId)) {
    throw new Error("Original pre-restore snapshot identity is invalid.");
  }
  const text = typeof generation === "string" ? generation
    : Number.isSafeInteger(generation) && generation > 0 ? String(generation) : "";
  if (!/^[1-9][0-9]{0,18}(?![\s\S])/.test(text) || BigInt(text) > 9223372036854775807n) {
    throw new Error("Original pre-restore snapshot generation is invalid.");
  }
  return text;
}

// Exact native readback DATA only. The caller still owns its transaction,
// original control, actor and fences; this does not create restore authority.
function requireOriginalPreRestoreSnapshot(result, descriptor, restoreId, generation) {
  const refuse = () => { throw new Error(`Original pre-restore snapshot differs or is unavailable for ${descriptor.category}.`); };
  const keys = ["restore_id", "authority_generation", "category", "row_count", "snapshot_sha256", "state_json"];
  const originals = snapshotRows(result, refuse);
  if (originals.length !== 1) refuse();
  const row = snapshotData(originals[0], keys, refuse);
  if (row.restore_id !== restoreId || row.authority_generation !== generation || row.category !== descriptor.category
      || typeof row.snapshot_sha256 !== "string" || row.snapshot_sha256.length !== 64
      || !/^[0-9a-f]{64}$/.test(row.snapshot_sha256)) refuse();
  const state = snapshotData(row.state_json, ["missing", "fields", "data_encoding", "rows"], refuse);
  const fields = snapshotArray(state.fields, refuse), rows = snapshotArray(state.rows, refuse);
  if (typeof state.missing !== "boolean" || ![productionBackupDataEncoding, PRE_RESTORE_SNAPSHOT_DATA_ENCODING].includes(state.data_encoding)
      || row.row_count !== String(rows.length) || new Set(fields).size !== fields.length
      || fields.some(field => typeof field !== "string" || !descriptor.fields.includes(field))
      || stableJson(fields) !== stableJson(descriptor.fields.filter(field => fields.includes(field)))
      || state.missing && (fields.length !== 0 || rows.length !== 0)
      || !state.missing && fields.length === 0
      || rows.some(raw => { try { snapshotRowShape(raw, fields, state.data_encoding); return false; } catch { return true; } })
      || createHash("sha256").update(stableJson(rows)).digest("hex") !== row.snapshot_sha256) refuse();
  // Detach the original JSONB payload before another actual database await.
  return { ...row, state_json: { missing: state.missing, fields, data_encoding: state.data_encoding, rows } };
}

export async function capturePreRestoreState(db, { restoreId, generation }) {
  const originalGeneration = preRestoreGeneration(restoreId, generation);
  const evidence = {};
  for (const descriptor of SNAPSHOT_CATEGORIES) {
    const state = await categoryState(db, descriptor);
    const stateJson = JSON.stringify({ missing: state.missing, fields: state.fields, data_encoding: state.data_encoding, rows: state.rows });
    await db.query(`
      insert into custodial_dr.pre_restore_snapshots(
        restore_id,authority_generation,category,row_count,snapshot_sha256,state_json
      ) values ($1,$2,$3,$4,$5,$6::jsonb)
      on conflict (restore_id,category) do nothing
    `, [restoreId, originalGeneration, descriptor.category, state.row_count, state.sha256, stateJson]);
    const original = requireOriginalPreRestoreSnapshot(await db.query(`
      select restore_id::text,authority_generation::text,category,row_count::text,snapshot_sha256,state_json
      from custodial_dr.pre_restore_snapshots
      where restore_id=$1 and category=$2
    `, [restoreId, descriptor.category]), descriptor, restoreId, originalGeneration);
    if (original.row_count !== String(state.row_count) || original.snapshot_sha256 !== state.sha256
        || stableJson(original.state_json) !== stableJson(JSON.parse(stateJson))) {
      throw new Error(`Original pre-restore snapshot differs for ${descriptor.category}.`);
    }
    evidence[descriptor.category] = { row_count: state.row_count, sha256: state.sha256, missing: state.missing };
  }
  return evidence;
}

export async function compareRestoredState(db, { restoreId, generation }) {
  const originalGeneration = preRestoreGeneration(restoreId, generation);
  const discrepancies = [];
  for (const descriptor of SNAPSHOT_CATEGORIES) {
    const beforeResult = await db.query(`
      select restore_id::text,authority_generation::text,category,row_count::text,snapshot_sha256,state_json
      from custodial_dr.pre_restore_snapshots
      where restore_id=$1 and category=$2 and authority_generation=$3::bigint
    `, [restoreId, descriptor.category, originalGeneration]);
    const before = requireOriginalPreRestoreSnapshot(beforeResult, descriptor, restoreId, originalGeneration);
    const restored = await categoryState(db, descriptor, before.state_json.data_encoding);
    if (before.snapshot_sha256 === restored.sha256 && before.row_count === String(restored.row_count)
        && stableJson(before.state_json) === stableJson({ missing: restored.missing, fields: restored.fields,
          data_encoding: restored.data_encoding, rows: restored.rows })) continue;
    const details = {
      pre_restore_missing: before.state_json.missing,
      restored_missing: restored.missing,
      data_encoding: before.state_json.data_encoding,
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
    `, [restoreId, originalGeneration, descriptor.category, before.snapshot_sha256, restored.sha256, before.row_count, restored.row_count, JSON.stringify(details)]);
    discrepancies.push({ category: descriptor.category, before_count: before.state_json.rows.length, restored_count: restored.row_count });
  }
  return discrepancies;
}

// Private original native port, not an effect issuer or caller-selectable port.
const restoreAuthorityClient = pg.Client;
const restoreAuthorityPrototype = restoreAuthorityClient.prototype;
const restoreAuthorityQuery = restoreAuthorityPrototype.query;

function restoreAuthorityUnavailable() {
  throw Object.assign(new Error("RESTORE_AUTHORITY_CONTEXT_UNAVAILABLE"), { code: "RESTORE_AUTHORITY_CONTEXT_UNAVAILABLE" });
}

function restoreAuthorityOwn(value, key) {
  if (!value || typeof value !== "object" || isProxy(value)) restoreAuthorityUnavailable();
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field || !Object.hasOwn(field, "value")) restoreAuthorityUnavailable();
  return field.value;
}

function restoreAuthorityRows(result, command) {
  if (restoreAuthorityOwn(result, "command") !== command) restoreAuthorityUnavailable();
  const rows = restoreAuthorityOwn(result, "rows");
  if (!Array.isArray(rows) || isProxy(rows) || Object.getPrototypeOf(rows) !== Array.prototype
      || Reflect.ownKeys(rows).length !== rows.length + 1) restoreAuthorityUnavailable();
  const count = restoreAuthorityOwn(result, "rowCount");
  if (!Number.isSafeInteger(count) || count < 0 || (command === "SELECT" ? count !== rows.length : rows.length !== 0))
    restoreAuthorityUnavailable();
  return Array.from({ length: rows.length }, (_, index) => restoreAuthorityOwn(rows, String(index)));
}

// Raw TEXT avoids driver JSON/Date/bigint decoding. The entire original
// control row (including updated_at/release data) is retained byte-exact.
// This observes existing admission; it acquires no fences or effect authority.
const restoreAuthorityContextSql = `select pg_catalog.row_to_json(context)::text context_utf8 from (select
  (select oid::text from pg_catalog.pg_database where datname=pg_catalog.current_database()) database_oid,
  pg_catalog.current_database() database_name,pg_catalog.pg_backend_pid() backend_pid,
  pg_catalog.txid_current()::text transaction_id,current_user actor,session_user session_actor,
  (select pg_catalog.pg_get_userbyid(datdba) from pg_catalog.pg_database where datname=pg_catalog.current_database()) database_owner,
  (select oid::text from pg_catalog.pg_namespace where nspname='custodial_dr') dr_oid,
  (select pg_catalog.pg_get_userbyid(nspowner) from pg_catalog.pg_namespace where nspname='custodial_dr') dr_owner,
  (select oid::text from pg_catalog.pg_class where oid=pg_catalog.to_regclass('custodial_dr.restore_control')
    and relkind='r' and relpersistence='p' and not relispartition) control_oid,
  (select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid=pg_catalog.to_regclass('custodial_dr.restore_control')) control_owner,
  pg_catalog.current_setting('transaction_read_only') read_only,
  pg_catalog.current_setting('session_replication_role') replication,
  pg_catalog.current_setting('row_security') row_security,pg_catalog.current_setting('search_path') search_path,
  (pg_catalog.current_schemas(true))[1] first_schema,
  (select count(*)::int from unnest(array['memphis-zoo-application-mutation-admission','memphis-zoo-application-mutation-fence']) f(name)
    where exists(select 1 from pg_catalog.pg_locks l where l.locktype='advisory' and l.pid=pg_catalog.pg_backend_pid()
      and l.database=(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database())
      and l.granted and l.mode='ExclusiveLock'
      and l.classid=((pg_catalog.hashtextextended(f.name,0)>>32)&4294967295)::oid
      and l.objid=(pg_catalog.hashtextextended(f.name,0)&4294967295)::oid and l.objsubid=1)) held_fences,
  (select count(*)::int from custodial_dr.restore_control) control_count,
  (select pg_catalog.row_to_json(c)::text from custodial_dr.restore_control c where singleton=true) control_utf8,
  exists(select 1 from custodial_dr.restore_control where singleton=true and authority_generation::text=$1::text
    and state='DATABASE_RESTORED' and mutations_paused=true and restore_id is not null
    and archive_digest is not null and length(archive_digest)=64 and archive_digest ~ '^[0-9a-f]{64}$') control_valid
) context`;

async function updateRequiredAuthorityTarget(query, { schema = "public", table, assignments, predicate = "true" }) {
  const params = [];
  const clauses = assignments.map(([column, value, raw]) => {
    if (raw) return `${quoteIdentifier(column)}=${value}`;
    params.push(value);
    return `${quoteIdentifier(column)}=$${params.length}`;
  });
  const result = await query(`update ${qualified(schema, table)} set ${clauses.join(",")} where ${predicate}`, params);
  restoreAuthorityRows(result, "UPDATE");
  return result.rowCount;
}

export async function invalidateRestoredAuthority(db, options) {
  return invalidateRestoredOwnedAuthority(db,options,null);
}

// Ordinary replica import never borrows the private original-origin contract.
// This entry binds the real verified archive's no-private/all-native selection
// to the actual control row. Source DATA is not permission: the same native
// principal, transaction, generation and BOTH real exclusive fences below
// remain mandatory before and after every read/effect.
export async function invalidateRestoredOrdinaryNativeAuthority(db,{generation,verifiedArchive}) {
  const binding=readVerifiedArchiveSourceBinding(verifiedArchive);
  const selection=readVerifiedRestoreTableSelection(verifiedArchive,{databaseOnly:true});
  if(selection.privateTables.length || !selection.databaseTables.length
    || selection.databaseTables.some(table=>table.data_encoding!==postgresTextColumnsLineEncoding))restoreAuthorityUnavailable();
  // The mandatory original mutation guard is already hash-bound in the
  // signed archive. Its owner/definition are original DATA, not a supplied
  // owner verdict. Never change the restored owner to fit the invoking actor.
  const metadata=readVerifiedImmutableBootstrapInventory(verifiedArchive);
  if(metadata.sourceBinding!==binding)restoreAuthorityUnavailable();
  const guards=JSON.parse(metadata.inventory['inventory/original-guards.json']);
  const guard=Array.isArray(guards)&&guards.length===2?guards[1]:null;
  if(!guard || Object.keys(guard).sort().join('|')!=='definition|owner|prosrc'
    || guard.owner!=='postgres' || typeof guard.definition!=='string' || !guard.definition.length
    || typeof guard.prosrc!=='string' || !guard.prosrc.length)restoreAuthorityUnavailable();
  const originalGuard=Object.freeze({owner:guard.owner,definition:guard.definition,prosrc:guard.prosrc});
  const source=()=>{
    if(readVerifiedArchiveSourceBinding(verifiedArchive)!==binding
      || readVerifiedRestoreTableSelection(verifiedArchive,{databaseOnly:true})!==selection
      || readVerifiedImmutableBootstrapInventory(verifiedArchive)!==metadata)restoreAuthorityUnavailable();
  };
  source();
  const result=await invalidateRestoredOwnedAuthority(db,{generation},{binding,source,originalGuard});
  source();return result;
}
const ordinaryRestoreAuthorityContextSql=restoreAuthorityContextSql.replace(') control_valid',
  `) and exists(select 1 from pg_catalog.pg_namespace n where n.nspname='custodial_release_identity'
      and pg_catalog.has_schema_privilege(current_user,n.oid,'USAGE'))
    and not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='custodial_release_identity')
    and exists(select 1 from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure('custodial_dr.guard_application_mutation()')
        and p.prokind='f' and p.prorettype='pg_catalog.trigger'::pg_catalog.regtype and p.prosecdef
        and pg_catalog.pg_get_userbyid(p.proowner)=$2::pg_catalog.text
        and pg_catalog.pg_get_functiondef(p.oid)=$3::pg_catalog.text and p.prosrc=$4::pg_catalog.text) control_valid`);
async function invalidateRestoredOwnedAuthority(db, options, ordinaryOriginal) {
  const field = options && typeof options === "object" && !isProxy(options)
    ? Object.getOwnPropertyDescriptor(options, "generation") : null;
  const generation = field && Object.hasOwn(field, "value") ? field.value : undefined;
  const originalGeneration = typeof generation === "string" ? generation
    : Number.isSafeInteger(generation) && generation > 0 ? String(generation) : "";
  if (!/^[1-9][0-9]{0,18}(?![\s\S])/.test(originalGeneration)
      || BigInt(originalGeneration) > 9223372036854775807n) {
    throw Object.assign(new Error("RESTORE_AUTHORITY_GENERATION_INVALID"), { code: "RESTORE_AUTHORITY_GENERATION_INVALID" });
  }
  const native = () => {
    ordinaryOriginal?.source();
    const exportedClient = Object.getOwnPropertyDescriptor(pg, "Client");
    const queryMethod = Object.getOwnPropertyDescriptor(restoreAuthorityPrototype, "query");
    if (!db || typeof db !== "object" || isProxy(db) || !exportedClient || !Object.hasOwn(exportedClient, "value")
        || exportedClient.value !== restoreAuthorityClient || !queryMethod || !Object.hasOwn(queryMethod, "value")
        || restoreAuthorityClient.prototype !== restoreAuthorityPrototype || Object.getPrototypeOf(db) !== restoreAuthorityPrototype
        || Object.hasOwn(db, "query") || queryMethod.value !== restoreAuthorityQuery
        || restoreAuthorityOwn(db, "_connected") !== true || restoreAuthorityOwn(db, "_ending") !== false
        || restoreAuthorityOwn(db, "_ended") !== false || restoreAuthorityOwn(db, "_queryable") !== true
        || restoreAuthorityOwn(db, "_txStatus") !== "T") restoreAuthorityUnavailable();
  };
  native();
  if(ordinaryOriginal && !["127.0.0.1","localhost"].includes(
    restoreAuthorityOwn(restoreAuthorityOwn(db,"connectionParameters"),"host")))restoreAuthorityUnavailable();
  const originalConnection = restoreAuthorityOwn(db, "connection");
  const raw = async (sql, params = []) => {
    native();
    if (restoreAuthorityOwn(db, "connection") !== originalConnection) restoreAuthorityUnavailable();
    let result, failed = false, failure;
    try { result = await Reflect.apply(restoreAuthorityQuery, db, [sql, params]); }
    catch (error) { failed = true; failure = error; }
    try {
      native();
      if (restoreAuthorityOwn(db, "connection") !== originalConnection) restoreAuthorityUnavailable();
    } catch (error) {
      if (failed) throw new AggregateError([failure, error], "Original authority operation/native context refused", { cause: failure });
      throw error;
    }
    if (failed) throw failure;
    return result;
  };
  if(ordinaryOriginal)await raw("lock table pg_catalog.pg_proc,pg_catalog.pg_namespace,pg_catalog.pg_class in share mode");
  let originalContext;
  const context = async () => {
    const args=ordinaryOriginal ? [originalGeneration,ordinaryOriginal.originalGuard.owner,
      ordinaryOriginal.originalGuard.definition,ordinaryOriginal.originalGuard.prosrc] : [originalGeneration];
    const rows = restoreAuthorityRows(await raw(ordinaryOriginal ? ordinaryRestoreAuthorityContextSql : restoreAuthorityContextSql,args), "SELECT");
    if (rows.length !== 1 || !rows[0] || isProxy(rows[0]) || Object.getPrototypeOf(rows[0]) !== Object.prototype
        || Reflect.ownKeys(rows[0]).length !== 1) restoreAuthorityUnavailable();
    const text = restoreAuthorityOwn(rows[0], "context_utf8");
    if (typeof text !== "string") restoreAuthorityUnavailable();
    const current = JSON.parse(text);
    const keys = ["database_oid", "database_name", "backend_pid", "transaction_id", "actor", "session_actor", "database_owner",
      "dr_oid", "dr_owner", "control_oid", "control_owner", "read_only", "replication", "row_security", "search_path", "first_schema",
      "held_fences", "control_count", "control_utf8", "control_valid"];
    if (!current || Object.getPrototypeOf(current) !== Object.prototype || Reflect.ownKeys(current).length !== keys.length
        || keys.some(key => !Object.hasOwn(current, key))) restoreAuthorityUnavailable();
    const oid = value => typeof value === "string" && /^[1-9][0-9]{0,9}(?![\s\S])/.test(value) && BigInt(value) <= 4294967295n;
    if (!oid(current.database_oid) || !oid(current.dr_oid) || !oid(current.control_oid)
        || typeof current.database_name !== "string" || current.database_name.length === 0
        || !Number.isSafeInteger(current.backend_pid) || current.backend_pid <= 0 || current.backend_pid > 2147483647
        || typeof current.transaction_id !== "string" || !/^[1-9][0-9]{0,18}(?![\s\S])/.test(current.transaction_id)
        || BigInt(current.transaction_id) > 9223372036854775807n
        || current.actor !== "supabase_admin" || current.session_actor !== current.actor
        || current.database_owner !== "postgres" || current.dr_owner !== "postgres"
        || current.control_owner !== (ordinaryOriginal ? ordinaryOriginal.originalGuard.owner : current.actor)
        || current.read_only !== "off" || current.replication !== (ordinaryOriginal ? "replica" : "origin") || current.row_security !== "off"
        || current.search_path !== "pg_catalog, pg_temp" || current.first_schema !== "pg_catalog"
        || current.held_fences !== 2 || current.control_count !== 1
        || current.control_valid !== true || typeof current.control_utf8 !== "string") restoreAuthorityUnavailable();
    const control = JSON.parse(current.control_utf8);
    if (!control || typeof control !== "object" || Array.isArray(control) || control.singleton !== true
        || control.state !== "DATABASE_RESTORED" || control.mutations_paused !== true
        || typeof control.restore_id !== "string" || control.restore_id.length !== 36
        || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(control.restore_id)
        || typeof control.archive_digest !== "string" || control.archive_digest.length !== 64
        || !/^[0-9a-f]{64}$/.test(control.archive_digest)) restoreAuthorityUnavailable();
    if(ordinaryOriginal && (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(current.database_name)
      || control.archive_digest!==ordinaryOriginal.binding.archive_digest
      || control.source_project_ref!==ordinaryOriginal.binding.summary.project_ref
      || control.target_project_ref!==ordinaryOriginal.binding.summary.project_ref))restoreAuthorityUnavailable();
    // Equality includes raw control/revision, principal, catalog owners/OIDs,
    // native DB/PID/xid, settings and both actual granted fence observations.
    if (originalContext !== undefined && text !== originalContext) restoreAuthorityUnavailable();
    return text;
  };
  // Distinct real queries must remain in the same original caller transaction.
  originalContext = await context();
  await context();
  const query = async (sql, params = []) => {
    await context();
    let result, failed = false, failure;
    try { result = await raw(sql, params); } catch (error) { failed = true; failure = error; }
    try { await context(); } catch (error) {
      if (failed) throw new AggregateError([failure, error], "Original authority operation/current context refused", { cause: failure });
      throw error;
    }
    if (failed) throw failure;
    return result;
  };
  // Missing/invisible authority is not an empty authority set. Validate ALL
  // fixed targets before the first mutation; otherwise a later missing table
  // could leave partial invalidation falsely reported as six zero counts.
  // Caller still owns the current original transaction/fences and rollback;
  // this preflight supplies no owner, restore, retry or resume authority.
  const required = [
    ["public", "device_auth_credentials", ["revoked_at", "revoked_reason"]],
    ["public", "device_auth_enrollment_codes", ["revoked_at"]],
    ["public", "ops_manager_trusted_devices", ["revoked_at", "revoked_reason"]],
    ["public", "ops_manager_enrollment_codes", ["status", "revoked_at", "revoked_reason"]],
    ["public", "ops_manager_push_devices", ["enabled", "revoked_at"]],
    ["auth", "sessions", ["id"]],
  ];
  for (const [schema, table, fields] of required) {
    const relation = restoreAuthorityRows(await query("select to_regclass($1) relation", [`${schema}.${table}`]), "SELECT");
    if (relation.length !== 1 || !restoreAuthorityOwn(relation[0], "relation")) {
      throw Object.assign(new Error("RESTORE_AUTHORITY_TARGET_UNAVAILABLE"), { code: "RESTORE_AUTHORITY_TARGET_UNAVAILABLE" });
    }
    const columns = new Set(restoreAuthorityRows(await query(`
    select column_name
    from information_schema.columns
    where table_schema=$1 and table_name=$2
  `, [schema, table]), "SELECT").map(row => restoreAuthorityOwn(row, "column_name")));
    if (fields.some(field => !columns.has(field))) {
      throw Object.assign(new Error("RESTORE_AUTHORITY_TARGET_UNAVAILABLE"), { code: "RESTORE_AUTHORITY_TARGET_UNAVAILABLE" });
    }
  }
  const reason = `disaster_restore_generation_${originalGeneration}`;
  const employeeCredentials = await updateRequiredAuthorityTarget(query, {
    table: "device_auth_credentials",
    assignments: [["revoked_at", "clock_timestamp()", true], ["revoked_reason", reason]],
    predicate: "revoked_at is null",
  });
  const employeeEnrollment = await updateRequiredAuthorityTarget(query, {
    table: "device_auth_enrollment_codes",
    assignments: [["revoked_at", "clock_timestamp()", true]],
    predicate: "revoked_at is null",
  });
  // Keep the real push ownership guard satisfied while retiring its child.
  // Revoking the trusted credential first would make that guarded UPDATE
  // fail even for the same original, fully locked restore transaction.
  const managerPush = await updateRequiredAuthorityTarget(query, {
    table: "ops_manager_push_devices",
    assignments: [["enabled", false], ["revoked_at", "clock_timestamp()", true]],
    predicate: "coalesce(enabled,true)=true or revoked_at is null",
  });
  const managerEnrollment = await updateRequiredAuthorityTarget(query, {
    table: "ops_manager_enrollment_codes",
    assignments: [["status", "revoked"], ["revoked_at", "clock_timestamp()", true], ["revoked_reason", reason]],
    predicate: "status='active'",
  });
  const managerCredentials = await updateRequiredAuthorityTarget(query, {
    table: "ops_manager_trusted_devices",
    assignments: [["revoked_at", "clock_timestamp()", true], ["revoked_reason", reason]],
    predicate: "revoked_at is null",
  });
  const deleted = await query("delete from auth.sessions");
  restoreAuthorityRows(deleted, "DELETE");
  const authSessions = deleted.rowCount;
  return { employee_credentials: employeeCredentials, employee_enrollment: employeeEnrollment, manager_credentials: managerCredentials, manager_enrollment: managerEnrollment, manager_push: managerPush, auth_sessions: authSessions };
}

export async function preserveCurrentReleaseIdentity(db, { restoreId, generation }) {
  const invalid = () => { throw Object.assign(new Error("Original release snapshot is unavailable, invalid or bound to another generation."), {
    code: "RESTORE_ORIGINAL_RELEASE_SNAPSHOT_INVALID",
  }); };
  const data = (value, keys) => {
    if (!value || typeof value !== "object" || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
        || Reflect.ownKeys(value).length !== keys.length) invalid();
    const copy = {};
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (!field || !Object.hasOwn(field, "value") || !field.enumerable) invalid();
      Object.defineProperty(copy, key, { value: field.value, enumerable: true });
    }
    return copy;
  };
  const array = value => {
    if (isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
    const fields = Object.getOwnPropertyDescriptors(value), length = fields.length.value;
    if (Reflect.ownKeys(fields).length !== length + 1) invalid();
    return Array.from({ length }, (_, index) => {
      const field = fields[index];
      if (!field || !Object.hasOwn(field, "value") || !field.enumerable) invalid();
      return field.value;
    });
  };
  if (typeof restoreId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?![\s\S])/.test(restoreId)) invalid();
  const generationText = typeof generation === "string" ? generation
    : Number.isSafeInteger(generation) && generation > 0 ? String(generation) : "";
  if (!/^[1-9][0-9]{0,18}(?![\s\S])/.test(generationText) || BigInt(generationText) > 9223372036854775807n) invalid();
  const result = await db.query(`
    select restore_id::text,authority_generation::text,category,row_count::text,snapshot_sha256,state_json
    from custodial_dr.pre_restore_snapshots
    where restore_id=$1::uuid and authority_generation=$2::bigint and category='release_identity'
  `, [restoreId, generationText]);
  if (!result || typeof result !== "object" || isProxy(result)) invalid();
  const count = Object.getOwnPropertyDescriptor(result, "rowCount"), entries = Object.getOwnPropertyDescriptor(result, "rows");
  if (!count || !Object.hasOwn(count, "value") || count.value !== 1 || !entries || !Object.hasOwn(entries, "value")) invalid();
  const snapshots = array(entries.value);
  if (snapshots.length !== 1) invalid();
  const snapshot = data(snapshots[0], ["restore_id", "authority_generation", "category", "row_count", "snapshot_sha256", "state_json"]);
  if (snapshot.restore_id !== restoreId || snapshot.authority_generation !== generationText || snapshot.category !== "release_identity"
      || typeof snapshot.row_count !== "string" || !/^(0|[1-9][0-9]*)(?![\s\S])/.test(snapshot.row_count)
      || typeof snapshot.snapshot_sha256 !== "string" || !/^[0-9a-f]{64}(?![\s\S])/.test(snapshot.snapshot_sha256)) invalid();
  const state = data(snapshot.state_json, ["missing", "fields", "data_encoding", "rows"]);
  if (state.missing !== false || ![productionBackupDataEncoding, PRE_RESTORE_SNAPSHOT_DATA_ENCODING].includes(state.data_encoding)) invalid();
  const textColumns = state.data_encoding === PRE_RESTORE_SNAPSHOT_DATA_ENCODING;
  const fields = SNAPSHOT_CATEGORIES.find(descriptor => descriptor.category === "release_identity").fields;
  const capturedFields = array(state.fields);
  if (capturedFields.length !== fields.length || new Set(capturedFields).size !== fields.length
      || capturedFields.some(field => typeof field !== "string" || !fields.includes(field))) invalid();
  // Own only immutable raw strings before the first write. Parse exclusively
  // for shape/identity validation: parsed numeric/details/time values NEVER
  // become restoration parameters or a reconstructed signed original.
  const rows = array(state.rows);
  if (rows.some(raw => typeof raw !== "string") || snapshot.row_count !== String(rows.length)
      || createHash("sha256").update(stableJson(rows)).digest("hex") !== snapshot.snapshot_sha256) invalid();
  const identities = new Set();
  for (const raw of rows) {
    let row, details;
    try {
      // v1 keeps its original DATA interpretation/query. Both paths reuse the
      // exact decoder for duplicate/Unicode/closed column agreement only.
      const original = decodeRestoreTableRowLine(JSON.stringify(raw), {
        data_encoding: state.data_encoding, columns: fields.map(name => ({ name })),
      });
      row = data(JSON.parse(original), fields);
      if (textColumns && typeof row.details_json !== "string") invalid();
      details = textColumns ? JSON.parse(row.details_json) : row.details_json;
    } catch { invalid(); }
    for (const field of fields.filter(field => !["details_json", "deployed_at"].includes(field))) {
      if (typeof row[field] !== "string") invalid();
    }
    if (identities.has(row.release_id) || !/^[0-9a-f]{40}(?![\s\S])/.test(row.backend_commit)
        || !/^[0-9a-f]{40}(?![\s\S])/.test(row.frontend_commit)
        || !/^[0-9a-f]{64}(?![\s\S])/.test(row.migration_manifest_sha256)
        || !["candidate", "validated", "deployed", "retired", "rolled_back"].includes(row.status)
        || !details || Array.isArray(details) || typeof details !== "object"
        || !(row.deployed_at === null || typeof row.deployed_at === "string")) invalid();
    identities.add(row.release_id);
  }
  // Fixed canonical Source, NOT caller/catalog-selected cast recipes:
  // 00000000000000_production_baseline.sql:1001-1012 (decf8dcd...).
  const releaseTypes = fields.map(field => [field, field === "details_json" ? "jsonb"
    : ["created_at", "deployed_at"].includes(field) ? "timestamptz" : "text"]);
  let originalColumns;
  const releaseColumnsCurrent = async () => {
    const actual = snapshotRows(await db.query(`select c.oid::pg_catalog.text relation_oid,
      c.relkind::pg_catalog.text kind,c.relpersistence::pg_catalog.text persistence,c.relispartition is_partition,
      exists(select 1 from pg_catalog.pg_inherits i where i.inhrelid=c.oid or i.inhparent=c.oid) inherited,
      a.attname::pg_catalog.text name,a.atttypid::pg_catalog.text type_oid,a.atttypmod type_modifier,
      a.attgenerated::pg_catalog.text generated,a.attidentity::pg_catalog.text identity,a.attnotnull not_null
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
      where n.nspname='public' and c.relname='release_deployment_manifest'
        and a.attname=any(ARRAY[${fields.map(snapshotKeyLiteral).join(",")}]::pg_catalog.text[])
      order by pg_catalog.array_position(ARRAY[${fields.map(snapshotKeyLiteral).join(",")}]::pg_catalog.text[],a.attname::pg_catalog.text)`), invalid)
      .map(value => snapshotData(value, ["relation_oid", "kind", "persistence", "is_partition", "inherited", "name", "type_oid",
        "type_modifier", "generated", "identity", "not_null"], invalid));
    if (actual.length !== fields.length || actual.some((value, i) => {
      const [field, type] = releaseTypes[i];
      return typeof value.relation_oid !== "string" || !/^[1-9][0-9]{0,9}(?![\s\S])/.test(value.relation_oid)
        || BigInt(value.relation_oid) > 4294967295n || value.relation_oid !== actual[0].relation_oid
        || value.kind !== "r" || value.persistence !== "p" || value.is_partition !== false || value.inherited !== false
        || value.name !== field || value.type_oid !== ({ text: "25", jsonb: "3802", timestamptz: "1184" })[type]
        || value.type_modifier !== -1 || value.generated !== "" || value.identity !== "" || value.not_null !== (field !== "deployed_at");
    }) || originalColumns && stableJson(actual) !== originalColumns) invalid();
    originalColumns = stableJson(actual);
  };
  for (const raw of rows) {
    if (textColumns) { await requireSnapshotTextOutput(db); await releaseColumnsCurrent(); await requireSnapshotTextOutput(db); }
    const written = await db.query(textColumns ? `
      with original as materialized (select $1::pg_catalog.json image), decoded as materialized (
        select ${releaseTypes.map(([field, type]) => `(o.image->>${snapshotKeyLiteral(field)})::pg_catalog.${type} ${quoteIdentifier(field)}`).join(",")}
          from original o
      ), checked as materialized (
        select r.* from decoded r cross join original o
        where (${snapshotTextProjection(fields, "r")})::pg_catalog.jsonb is not distinct from o.image::pg_catalog.jsonb
      ) insert into public.release_deployment_manifest(
        release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256,
        environment_contract_version,status,details_json,created_at,deployed_at
      ) select r.release_id,r.backend_commit,r.frontend_commit,r.migration_head,r.migration_manifest_sha256,
          r.environment_contract_version,r.status,r.details_json,r.created_at,r.deployed_at from checked r
      on conflict (release_id) do update set
        backend_commit=excluded.backend_commit,frontend_commit=excluded.frontend_commit,
        migration_head=excluded.migration_head,migration_manifest_sha256=excluded.migration_manifest_sha256,
        environment_contract_version=excluded.environment_contract_version,status=excluded.status,
        details_json=excluded.details_json,created_at=excluded.created_at,deployed_at=excluded.deployed_at
    ` : `
      insert into public.release_deployment_manifest(
        release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256,
        environment_contract_version,status,details_json,created_at,deployed_at
      ) select r.release_id,r.backend_commit,r.frontend_commit,r.migration_head,r.migration_manifest_sha256,
          r.environment_contract_version,r.status,r.details_json,r.created_at,r.deployed_at
        from json_populate_record(null::public.release_deployment_manifest,$1::json) r
      on conflict (release_id) do update set
        backend_commit=excluded.backend_commit,frontend_commit=excluded.frontend_commit,
        migration_head=excluded.migration_head,migration_manifest_sha256=excluded.migration_manifest_sha256,
        environment_contract_version=excluded.environment_contract_version,status=excluded.status,
        details_json=excluded.details_json,created_at=excluded.created_at,deployed_at=excluded.deployed_at
    `, [raw]);
    const affected = written && typeof written === "object" && !isProxy(written)
      ? Object.getOwnPropertyDescriptor(written, "rowCount") : null;
    if (!affected || !Object.hasOwn(affected, "value") || affected.value !== 1) invalid();
    if (textColumns) { await releaseColumnsCurrent(); await requireSnapshotTextOutput(db); }
  }
  return rows.length;
}

// Additional denial only: passing this read does not admit a retry or reconcile
// an uncertain commit. Existing signed-intent, generation and lease guards stay
// authoritative. Never erase an earlier UNKNOWN because of a later event.
export async function refuseUnreconciledImmutableRetry(db, { restoreId, generation }) {
  let requestedOriginalRestore;
  function refuse(reason) {
    throw Object.assign(new Error(`Restore retry ${reason}; named reconciliation is required, not a fresh import retry.`), {
      code: "RESTORE_RETRY_RECONCILIATION_REQUIRED",
      outcome: "UNKNOWN",
      retry_safe: false,
      ...(requestedOriginalRestore === undefined ? {} : { requested_original_restore: requestedOriginalRestore }),
    });
  }
  if (typeof restoreId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(restoreId)) {
    refuse("original identity is invalid");
  }
  const generationText = typeof generation === "string" ? generation
    : Number.isSafeInteger(generation) && generation > 0 ? String(generation) : "";
  if (!/^[1-9][0-9]{0,18}$/.test(generationText) || BigInt(generationText) > 9223372036854775807n) {
    refuse("original generation is invalid");
  }
  // Validated requested prior-record DATA only, never an observed-read claim.
  requestedOriginalRestore = Object.freeze({ restore_id: restoreId, authority_generation: generationText });
  let result;
  try {
    // One statement/snapshot; no locks, writes, caller SQL, or evidence defaults.
    // Events have no archive column: bind them by original ID/generation, and
    // bind the manifest's archive to the actual current control row.
    result = await db.query(`
      with original_control as (
        select restore_id,authority_generation,archive_digest,mutations_paused,state
        from custodial_dr.restore_control where singleton=true
      ), original_manifest as (
        select restore_id,authority_generation,archive_digest,database_verified,database_evidence
        from custodial_dr.restore_manifests where restore_id=$1::uuid
      ), original_events as (
        select authority_generation,outcome,evidence_json
        from custodial_dr.restore_events where restore_id=$1::uuid
      )
      select
        (select count(*)::int from original_control) control_count,
        (select count(*)::int from original_control
          where restore_id=$1::uuid and authority_generation=$2::bigint
            and mutations_paused=true and state='PAUSED_FAILURE'
            and archive_digest ~ '^[0-9a-f]{64}$') matching_control_count,
        (select count(*)::int from original_manifest) manifest_count,
        (select count(*)::int from original_manifest m join original_control c
          on m.restore_id=c.restore_id and m.authority_generation=c.authority_generation
            and m.archive_digest=c.archive_digest
          where m.restore_id=$1::uuid and m.authority_generation=$2::bigint) matching_manifest_count,
        (select count(*)::int from original_events) event_count,
        exists(select 1 from original_events where outcome='FAILED') failure_recorded,
        exists(select 1 from original_events
          where authority_generation is distinct from $2::bigint
            or (evidence_json ? 'archive_digest'
              and evidence_json->>'archive_digest' is distinct from
                (select archive_digest from original_control))) conflicting_events,
        exists(select 1 from original_events
          where outcome='UNKNOWN' or evidence_json->>'outcome'='UNKNOWN'
            or evidence_json->'retry_safe'='false'::jsonb) unresolved_events,
        exists(select 1 from original_manifest
          where database_verified=true and database_evidence ? 'original_data_import') private_data_verified,
        (exists(select 1 from original_events
          where jsonb_typeof(evidence_json) is distinct from 'object'
            or (evidence_json ? 'outcome' and jsonb_typeof(evidence_json->'outcome') is distinct from 'string')
            or (evidence_json ? 'retry_safe' and jsonb_typeof(evidence_json->'retry_safe') is distinct from 'boolean'))
        or exists(select 1 from original_manifest
          where database_verified is null or jsonb_typeof(database_evidence) is distinct from 'object'
            or (database_evidence ? 'original_data_import'
              and (database_verified is distinct from true
                or jsonb_typeof(database_evidence->'original_data_import') is distinct from 'object')))) contradictory_evidence
    `, [restoreId, generationText]);
  } catch {
    refuse("original history is unavailable");
  }
  const keys = ["control_count", "matching_control_count", "manifest_count", "matching_manifest_count", "event_count", "failure_recorded",
    "conflicting_events", "unresolved_events", "private_data_verified", "contradictory_evidence"];
  const row = result?.rows?.[0];
  if (result?.rowCount !== 1 || !Array.isArray(result.rows) || result.rows.length !== 1
      || !row || Object.keys(row).length !== keys.length
      || !keys.every((key) => Object.hasOwn(row, key))) refuse("history readback is incomplete");
  if (row.control_count !== 1 || row.matching_control_count !== 1
      || row.manifest_count !== 1 || row.matching_manifest_count !== 1
      || !Number.isSafeInteger(row.event_count) || row.event_count < 1
      || row.failure_recorded !== true) refuse("original history binding is incomplete or contradictory");
  if (row.conflicting_events !== false || row.unresolved_events !== false
      || row.private_data_verified !== false || row.contradictory_evidence !== false) {
    refuse("original history contains uncertain, committed private DATA, or contradictory evidence");
  }
  // Intentionally no admission value, mutation, reconciliation, or retry token.
}

// Metadata observation only: no retry, COMMIT, resume or import authority.
// Capture the actual driver method; a recording/injected query port is refused.
const originalStatusClient = pg.Client;
const originalStatusQuery = originalStatusClient.prototype.query;

export async function readOriginalRestoreDatabaseStatus(db, { restoreId, generation, archiveDigest, targetProjectRef } = {}) {
  const unavailable = () => { throw Object.assign(new Error("Original restore database status is unavailable."), {
    code: "RESTORE_ORIGINAL_STATUS_UNAVAILABLE",
  }); };
  const nativeClient = () => db && typeof db === "object" && !isProxy(db)
    && Object.getPrototypeOf(db) === originalStatusClient.prototype && !Object.hasOwn(db, "query")
    && originalStatusClient.prototype.query === originalStatusQuery;
  if (!nativeClient() || typeof restoreId !== "string" || restoreId.length !== 36
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(restoreId)
      || typeof generation !== "string" || !/^[1-9][0-9]{0,18}(?![\s\S])/.test(generation)
      || BigInt(generation) > 9223372036854775807n
      || typeof archiveDigest !== "string" || archiveDigest.length !== 64 || !/^[0-9a-f]{64}$/.test(archiveDigest)
      || typeof targetProjectRef !== "string" || targetProjectRef.length !== 20 || !/^[a-z0-9]{20}$/.test(targetProjectRef)) unavailable();
  let result;
  try {
    result = await Reflect.apply(originalStatusQuery, db, [`
      with original_control as materialized (
        select restore_id,authority_generation,archive_digest,target_project_ref,state,mutations_paused
        from custodial_dr.restore_control where singleton=true
      ), matching_control as materialized (
        select * from original_control where restore_id=$1::uuid and authority_generation=$2::bigint
          and archive_digest=$3::text and target_project_ref=$4::text
      ), original_manifest as materialized (
        select authority_generation,archive_digest,database_verified,database_evidence
        from custodial_dr.restore_manifests where restore_id=$1::uuid
      ), matching_manifest as materialized (
        select *,database_evidence->'original_data_import' as original_import from original_manifest
        where authority_generation=$2::bigint and archive_digest=$3::text
      ), original_events as materialized (
        select authority_generation,phase,outcome,evidence_json
        from custodial_dr.restore_events where restore_id=$1::uuid
      ), valid_import as materialized (
        select original_import from matching_manifest where case
          when pg_catalog.jsonb_typeof(original_import)='object' then coalesce(
            original_import ?& array['database_oid','backend_pid','transaction_id','restore_id',
              'authority_generation','archive_digest','private_rows','transaction_authority','admission_resumed']
            and original_import-array['database_oid','backend_pid','transaction_id','restore_id',
              'authority_generation','archive_digest','private_rows','transaction_authority','admission_resumed']='{}'::jsonb
            and original_import->'restore_id'=pg_catalog.to_jsonb($1::text)
            and original_import->'authority_generation'=pg_catalog.to_jsonb($2::text)
            and original_import->'archive_digest'=pg_catalog.to_jsonb($3::text)
            and pg_catalog.jsonb_typeof(original_import->'database_oid')='string'
            and original_import->>'database_oid' ~ '^[1-9][0-9]{0,9}$'
            and (pg_catalog.length(original_import->>'database_oid')<10 or (original_import->>'database_oid') collate "C"<='4294967295' collate "C")
            and pg_catalog.jsonb_typeof(original_import->'backend_pid')='number'
            and original_import->>'backend_pid' ~ '^[1-9][0-9]{0,9}$'
            and (pg_catalog.length(original_import->>'backend_pid')<10 or (original_import->>'backend_pid') collate "C"<='2147483647' collate "C")
            and pg_catalog.jsonb_typeof(original_import->'transaction_id')='string'
            and original_import->>'transaction_id' ~ '^[1-9][0-9]{0,18}$'
            and (pg_catalog.length(original_import->>'transaction_id')<19 or (original_import->>'transaction_id') collate "C"<='9223372036854775807' collate "C")
            and pg_catalog.jsonb_typeof(original_import->'private_rows')='string'
            and original_import->>'private_rows' ~ '^(0|[1-9][0-9]{0,18})$'
            and (pg_catalog.length(original_import->>'private_rows')<19 or (original_import->>'private_rows') collate "C"<='9223372036854775807' collate "C")
            and original_import->'transaction_authority'='false'::jsonb
            and original_import->'admission_resumed'='false'::jsonb,false) else false end
      )
      select
        (current_user=session_user and pg_catalog.current_setting('transaction_read_only')='on'
          and pg_catalog.current_setting('transaction_isolation')='repeatable read'
          and exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
            join pg_catalog.pg_roles r on r.oid=c.relowner
            where n.nspname='custodial_dr' and c.relname='restore_control' and c.relkind='r' and r.rolname=current_user)) context_valid,
        (select count(*)::int from original_control) control_count,
        (select count(*)::int from matching_control) matching_control_count,
        (select restore_id::text from matching_control) restore_id,
        (select authority_generation::text from matching_control) authority_generation,
        (select archive_digest from matching_control) archive_digest,
        (select target_project_ref from matching_control) target_project_ref,
        (select state from matching_control) state,
        (select mutations_paused from matching_control) mutations_paused,
        (select count(*)::int from original_manifest) manifest_count,
        (select count(*)::int from matching_manifest) matching_manifest_count,
        (select database_verified from matching_manifest) database_verified,
        exists(select 1 from matching_manifest where pg_catalog.jsonb_typeof(database_evidence)='object') manifest_valid,
        exists(select 1 from matching_manifest where database_evidence='{}'::jsonb) manifest_empty,
        exists(select 1 from valid_import) import_valid,
        (select count(*)::int from original_events where phase='DATABASE' and outcome='PASSED') database_passed_count,
        (select count(*)::int from original_events e where e.phase='DATABASE' and e.outcome='PASSED'
          and e.authority_generation=$2::bigint
          and exists(select 1 from valid_import v where e.evidence_json->'original_data_import'=v.original_import)) matching_marker_count,
        exists(select 1 from original_events e where e.authority_generation is distinct from $2::bigint
          or pg_catalog.jsonb_typeof(e.evidence_json) is distinct from 'object'
          or (e.evidence_json ? 'archive_digest' and e.evidence_json->'archive_digest' is distinct from pg_catalog.to_jsonb($3::text))
          or (e.evidence_json ? 'outcome' and pg_catalog.jsonb_typeof(e.evidence_json->'outcome') is distinct from 'string')
          or (e.evidence_json ? 'retry_safe' and pg_catalog.jsonb_typeof(e.evidence_json->'retry_safe') is distinct from 'boolean')
          or (e.evidence_json ? 'original_data_import' and (e.phase<>'DATABASE' or e.outcome<>'PASSED'
            or not exists(select 1 from valid_import v where e.evidence_json->'original_data_import'=v.original_import)))) conflicting_events,
        exists(select 1 from original_events where outcome='UNKNOWN' or evidence_json->>'outcome'='UNKNOWN'
          or evidence_json->'retry_safe'='false'::jsonb) prior_unknown_recorded
    `, [restoreId, generation, archiveDigest, targetProjectRef]]);
  } catch { unavailable(); }
  if (!nativeClient() || !result || isProxy(result)) unavailable();
  const rows = Object.getOwnPropertyDescriptor(result, "rows");
  const count = Object.getOwnPropertyDescriptor(result, "rowCount");
  if (!rows || !Object.hasOwn(rows, "value") || !count || !Object.hasOwn(count, "value") || count.value !== 1
      || !Array.isArray(rows.value) || isProxy(rows.value) || rows.value.length !== 1
      || Reflect.ownKeys(rows.value).length !== 2) unavailable();
  const entry = Object.getOwnPropertyDescriptor(rows.value, "0");
  const row = entry && Object.hasOwn(entry, "value") ? entry.value : null;
  const keys = ["context_valid","control_count","matching_control_count","restore_id","authority_generation","archive_digest",
    "target_project_ref","state","mutations_paused","manifest_count","matching_manifest_count","database_verified",
    "manifest_valid","manifest_empty","import_valid","database_passed_count","matching_marker_count","conflicting_events","prior_unknown_recorded"];
  if (!row || typeof row !== "object" || isProxy(row) || Object.getPrototypeOf(row) !== Object.prototype
      || Reflect.ownKeys(row).length !== keys.length) unavailable();
  const values = {};
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(row, key);
    if (!field || !Object.hasOwn(field, "value")) unavailable();
    values[key] = field.value;
  }
  for (const key of ["context_valid","mutations_paused","manifest_valid","manifest_empty","import_valid","conflicting_events","prior_unknown_recorded"])
    if (typeof values[key] !== "boolean") unavailable();
  for (const key of ["control_count","matching_control_count","manifest_count","matching_manifest_count","database_passed_count","matching_marker_count"])
    if (!Number.isSafeInteger(values[key]) || values[key] < 0) unavailable();
  if (values.context_valid !== true || values.control_count !== 1 || values.matching_control_count !== 1
      || values.restore_id !== restoreId || values.authority_generation !== generation || values.archive_digest !== archiveDigest
      || values.target_project_ref !== targetProjectRef
      || !["READY","PREPARING","DATABASE_RESTORED","STORAGE_RESTORING","VERIFYING","PAUSED_FAILURE","PAUSED_RECONCILIATION","COMPLETE"].includes(values.state)
      || !(values.database_verified === null || typeof values.database_verified === "boolean")) unavailable();
  // Marker absence in this snapshot is never proof of rollback or retry safety.
  let markerStatus = "UNRESOLVED";
  if (values.manifest_count === 1 && values.matching_manifest_count === 1 && values.manifest_valid && !values.conflicting_events) {
    if (values.database_verified === true && values.import_valid
        && values.database_passed_count === 1 && values.matching_marker_count === 1) markerStatus = "OBSERVED_DATABASE_MARKERS";
    else if (values.database_verified === false && values.manifest_empty && values.database_passed_count === 0
        && values.matching_marker_count === 0 && !values.prior_unknown_recorded) markerStatus = "NOT_OBSERVED";
  }
  return Object.freeze({
    schema: "memphis-zoo-restore-original-status.v1",
    restore_id: values.restore_id, authority_generation: values.authority_generation,
    archive_digest: values.archive_digest, target_project_ref: values.target_project_ref,
    state: values.state, mutations_paused: values.mutations_paused,
    database_marker_status: markerStatus, database_verified: values.database_verified,
    prior_unknown_recorded: values.prior_unknown_recorded, metadata_only: true,
    retry_allowed: false, resume_allowed: false, rerun_import_allowed: false, complete_restore: false,
  });
}
