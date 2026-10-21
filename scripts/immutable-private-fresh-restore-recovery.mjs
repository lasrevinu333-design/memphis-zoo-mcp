import { isProxy } from "node:util/types";
import { readOriginalRestoreDatabaseStatus } from "./disaster-recovery-state.mjs";
import pg from "pg";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import ConnectionParameters from "pg/lib/connection-parameters.js";

const requestKeys = Object.freeze(["restoreId", "generation", "archiveDigest", "targetProjectRef"]);
const statusKeys = Object.freeze([
  "schema", "restore_id", "authority_generation", "archive_digest", "target_project_ref",
  "state", "mutations_paused", "database_marker_status", "database_verified", "prior_unknown_recorded",
  "metadata_only", "retry_allowed", "resume_allowed", "rerun_import_allowed", "complete_restore",
]);
const states = Object.freeze([
  "READY", "PREPARING", "DATABASE_RESTORED", "STORAGE_RESTORING", "VERIFYING",
  "PAUSED_FAILURE", "PAUSED_RECONCILIATION", "COMPLETE",
]);

function invalid() {
  throw Object.assign(new Error("Immutable fresh commit recovery request is invalid."), {
    code: "IMMUTABLE_FRESH_COMMIT_RECOVERY_INVALID",
  });
}

// Copy own DATA descriptors only; never invoke a caller accessor, Proxy or
// serializer. Every accepted request/status field below is a primitive.
function closedData(value, keys) {
  if (!value || typeof value !== "object" || isProxy(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== keys.length) invalid();
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}

function captureRequest(value) {
  const request = closedData(value, requestKeys);
  if (typeof request.restoreId !== "string" || request.restoreId.length !== 36
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(request.restoreId)
      || typeof request.generation !== "string" || !/^[1-9][0-9]{0,18}(?![\s\S])/.test(request.generation)
      || BigInt(request.generation) > 9223372036854775807n
      || typeof request.archiveDigest !== "string" || request.archiveDigest.length !== 64
      || !/^[0-9a-f]{64}$/.test(request.archiveDigest)
      || typeof request.targetProjectRef !== "string" || request.targetProjectRef.length !== 20
      || !/^[a-z0-9]{20}$/.test(request.targetProjectRef)) invalid();
  return Object.freeze(request);
}

function captureStatus(value, request) {
  const status = closedData(value, statusKeys);
  if (status.schema !== "memphis-zoo-restore-original-status.v1"
      || status.restore_id !== request.restoreId || status.authority_generation !== request.generation
      || status.archive_digest !== request.archiveDigest || status.target_project_ref !== request.targetProjectRef
      || !states.includes(status.state) || typeof status.mutations_paused !== "boolean"
      || typeof status.prior_unknown_recorded !== "boolean"
      || !(status.database_verified === null || typeof status.database_verified === "boolean")
      || !["OBSERVED_DATABASE_MARKERS", "NOT_OBSERVED", "UNRESOLVED"].includes(status.database_marker_status)
      || status.metadata_only !== true || status.retry_allowed !== false || status.resume_allowed !== false
      || status.rerun_import_allowed !== false || status.complete_restore !== false) invalid();
  if (status.database_marker_status === "OBSERVED_DATABASE_MARKERS" && status.database_verified !== true) invalid();
  if (status.database_marker_status === "NOT_OBSERVED"
      && (status.database_verified !== false || status.prior_unknown_recorded !== false)) invalid();
  return Object.freeze(status);
}

// An original-status observation, not proof of rollback, complete restoration,
// or permission to retry/resume/reimport. Intent expiry never prevents this read.
export async function readVerifiedImmutableFreshDatabaseCommitOutcome(options) {
  const captured = closedData(options, ["db", "request"]);
  const requested = captureRequest(captured.request); // detached before any await
  let status = null;
  try {
    // This REAL fixed reader alone owns native-client/current-owner/read-only
    // snapshot validation. No connection, SQL or transaction is created here.
    const observed = await readOriginalRestoreDatabaseStatus(captured.db, requested);
    status = captureStatus(observed, requested);
  } catch {
    // Unavailable OR unsupported/mismatched protocol is not observed absence.
    // Retain only the validated REQUESTED tuple, with no fabricated reader DTO.
  }
  return Object.freeze({
    schema: "custodial.immutable-private-fresh-commit-outcome.v1",
    requested_original: requested,
    observation: status === null ? "UNAVAILABLE" : "CURRENT_FIXED_READ",
    outcome: status !== null && status.database_marker_status === "OBSERVED_DATABASE_MARKERS"
      ? "DATABASE_MARKERS_OBSERVED" : "UNKNOWN",
    status,
    retry_allowed: false,
    resume_allowed: false,
    rerun_import_allowed: false,
    complete_restore: false,
    metadata_only: true,
  });
}

// Historical authority completion DATA only. These captures are private native
// identities, not an injected read port, caller receipt or effect capability.
const authorityClient = pg.Client, authorityConnection = pg.Connection;
const authorityClientPrototype = authorityClient.prototype;
const authorityConnectionPrototype = authorityConnection.prototype;
const authorityQuery = authorityClientPrototype.query;
const authorityPromise = globalThis.Promise;
const authorityTypes = pg.types, authorityTypeOverrides = pg.TypeOverrides;
const authorityGetTypeParser = authorityTypes.getTypeParser;
const authorityParsers = [16, 20, 23, 25, 114, 3802].map(oid => [oid, Reflect.apply(authorityGetTypeParser, authorityTypes, [oid, "text"])]);
const authorityRequestKeys = Object.freeze([...requestKeys, "databaseOid", "effectBackendPid", "effectTransactionId", "originalTransactionId"]);
const authorityStatusKeys = Object.freeze(["state", "database_oid", "effect_backend_pid", "effect_transaction_id",
  "original_transaction_id", "restore_id", "authority_generation", "archive_digest", "revocations"]);
const authorityCountKeys = Object.freeze(["employee_credentials", "employee_enrollment", "manager_credentials",
  "manager_enrollment", "manager_push", "auth_sessions"]);

function authorityUnavailable() { throw new Error("IMMUTABLE_FRESH_AUTHORITY_STATUS_UNAVAILABLE"); }
function authorityInvalid() {
  throw Object.assign(new Error("Immutable fresh authority status request is invalid."), {
    code: "IMMUTABLE_FRESH_AUTHORITY_COMMIT_RECOVERY_INVALID",
  });
}
function authorityDecimal(value, positive, max = 9223372036854775807n) {
  if (typeof value !== "string" || value.length > 19
      || !(positive ? /^[1-9][0-9]*(?![\s\S])/ : /^(0|[1-9][0-9]*)(?![\s\S])/).test(value)
      || BigInt(value) > max) authorityUnavailable();
  return value;
}
function captureAuthorityRequest(value) {
  try {
    const copy = closedData(value, authorityRequestKeys);
    captureRequest(Object.fromEntries(requestKeys.map(key => [key, copy[key]])));
    authorityDecimal(copy.databaseOid, true, 4294967295n);
    authorityDecimal(copy.effectTransactionId, true); authorityDecimal(copy.originalTransactionId, true);
    if (!Number.isSafeInteger(copy.effectBackendPid) || copy.effectBackendPid < 1 || copy.effectBackendPid > 2147483647
        || copy.effectTransactionId === copy.originalTransactionId) authorityUnavailable();
    return Object.freeze(copy);
  } catch { authorityInvalid(); }
}
function captureAuthorityStatus(value, requested) {
  const copy = closedData(value, authorityStatusKeys);
  if (copy.state !== "OBSERVED_COMMITTED_CONSUMED" || copy.database_oid !== requested.databaseOid
      || copy.effect_backend_pid !== requested.effectBackendPid || copy.effect_transaction_id !== requested.effectTransactionId
      || copy.original_transaction_id !== requested.originalTransactionId || copy.restore_id !== requested.restoreId
      || copy.authority_generation !== requested.generation || copy.archive_digest !== requested.archiveDigest) authorityUnavailable();
  const counts = closedData(copy.revocations, authorityCountKeys);
  for (const key of authorityCountKeys) authorityDecimal(counts[key], false);
  return Object.freeze({ ...copy, revocations: Object.freeze(counts) });
}
function authorityOwn(value, key) {
  if (!value || typeof value !== "object" || isProxy(value)) authorityUnavailable();
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field || !Object.hasOwn(field, "value")) authorityUnavailable();
  return field.value;
}
function authorityPrototypeSnapshot(value) {
  return { value, parent: Object.getPrototypeOf(value), fields: Object.getOwnPropertyDescriptors(value) };
}
const authorityPrototypes = [authorityClientPrototype, authorityConnectionPrototype, Socket.prototype, TLSSocket.prototype,
  ConnectionParameters.prototype, authorityTypeOverrides.prototype]
  .map(authorityPrototypeSnapshot);
function authoritySamePrototype(captured) {
  if (Object.getPrototypeOf(captured.value) !== captured.parent) authorityUnavailable();
  const fields = Object.getOwnPropertyDescriptors(captured.value), keys = Reflect.ownKeys(captured.fields);
  if (Reflect.ownKeys(fields).length !== keys.length) authorityUnavailable();
  for (const key of keys) {
    const before = captured.fields[key], after = fields[key];
    if (!after || after.value !== before.value || after.get !== before.get || after.set !== before.set
        || after.writable !== before.writable || after.enumerable !== before.enumerable || after.configurable !== before.configurable)
      authorityUnavailable();
  }
}
function authorityStreamMember(prototype, key) {
  for (let owner = prototype; owner; owner = Object.getPrototypeOf(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) return { owner, descriptor };
  }
  authorityUnavailable();
}
const authorityStreamMembers = [Socket.prototype, TLSSocket.prototype].map(prototype => ({ prototype,
  fields: Object.fromEntries(["connect", "write", "end", "destroy", "on", "emit", "readyState", "destroyed", "readable", "writable"]
    .map(key => [key, authorityStreamMember(prototype, key)])),
}));

function authorityNative(db) {
  const exported = Object.getOwnPropertyDescriptor(pg, "Client"), connectionExport = Object.getOwnPropertyDescriptor(pg, "Connection");
  if (!db || typeof db !== "object" || isProxy(db) || !exported || exported.value !== authorityClient
      || !connectionExport || connectionExport.value !== authorityConnection
      || authorityClient.prototype !== authorityClientPrototype || authorityConnection.prototype !== authorityConnectionPrototype
      || Object.getPrototypeOf(db) !== authorityClientPrototype) authorityUnavailable();
  for (const snapshot of authorityPrototypes) authoritySamePrototype(snapshot);
  for (const key of Reflect.ownKeys(authorityPrototypes[0].fields)) if (Object.hasOwn(db, key)) authorityUnavailable();
  if (Object.hasOwn(authorityClientPrototype, "connection") || ["signal", "abortSignal", "_signal"].some(key => Object.hasOwn(db, key))) authorityUnavailable();
  if (authorityOwn(db, "_connected") !== true || authorityOwn(db, "_connecting") !== false
      || authorityOwn(db, "_ending") !== false || authorityOwn(db, "_ended") !== false
      || authorityOwn(db, "_queryable") !== true || authorityOwn(db, "_connectionError") !== false
      || authorityOwn(db, "_txStatus") !== "T" || authorityOwn(db, "_Promise") !== authorityPromise
      || (authorityOwn(db, "_activeQuery") !== null && authorityOwn(db, "_activeQuery") !== undefined)
      || authorityOwn(db, "readyForQuery") !== true || authorityOwn(db, "binary") !== false) authorityUnavailable();
  const parameters = authorityOwn(db, "connectionParameters"), decoders = authorityOwn(db, "_types");
  if (!parameters || isProxy(parameters) || Object.getPrototypeOf(parameters) !== ConnectionParameters.prototype
      || !decoders || isProxy(decoders) || Object.getPrototypeOf(decoders) !== authorityTypeOverrides.prototype
      || authorityOwn(decoders, "_types") !== authorityTypes
      || Object.getOwnPropertyDescriptor(pg, "types")?.value !== authorityTypes
      || Object.getOwnPropertyDescriptor(pg, "TypeOverrides")?.value !== authorityTypeOverrides
      || Object.getOwnPropertyDescriptor(authorityTypes, "getTypeParser")?.value !== authorityGetTypeParser) authorityUnavailable();
  for (const key of Reflect.ownKeys(authorityPrototypes[5].fields)) if (Object.hasOwn(decoders, key)) authorityUnavailable();
  for (const key of ["text", "binary"]) {
    const parsers = authorityOwn(decoders, key);
    if (!parsers || isProxy(parsers) || Object.getPrototypeOf(parsers) !== Object.prototype || Reflect.ownKeys(parsers).length) authorityUnavailable();
  }
  for (const [oid, parser] of authorityParsers)
    if (Reflect.apply(authorityGetTypeParser, authorityTypes, [oid, "text"]) !== parser) authorityUnavailable();
  const queryTimeout = authorityOwn(parameters, "query_timeout");
  if (queryTimeout !== false && (!Number.isSafeInteger(queryTimeout) || queryTimeout < 0)) authorityUnavailable();
  const queue = authorityOwn(db, "_queryQueue");
  if (!Array.isArray(queue) || isProxy(queue) || Object.getPrototypeOf(queue) !== Array.prototype
      || Reflect.ownKeys(queue).length !== 1 || authorityOwn(queue, "length") !== 0) authorityUnavailable();
  const processID = authorityOwn(db, "processID"), connection = authorityOwn(db, "connection");
  if (!Number.isSafeInteger(processID) || processID < 1 || processID > 2147483647 || !connection || isProxy(connection)
      || Object.getPrototypeOf(connection) !== authorityConnectionPrototype
      // pg 8.22 marks normal extended-query Sync with Connection._ending.
      // Actual Client ending/ended and native ready/socket/queue checks govern.
      || typeof authorityOwn(connection, "_ending") !== "boolean") authorityUnavailable();
  for (const key of Reflect.ownKeys(authorityPrototypes[1].fields)) if (Object.hasOwn(connection, key)) authorityUnavailable();
  if (["signal", "abortSignal", "_signal"].some(key => Object.hasOwn(connection, key))) authorityUnavailable();
  const stream = authorityOwn(connection, "stream");
  if (!stream || isProxy(stream)) authorityUnavailable();
  const members = authorityStreamMembers.find(entry => entry.prototype === Object.getPrototypeOf(stream));
  if (!members) authorityUnavailable();
  for (const [key, captured] of Object.entries(members.fields)) {
    if (Object.hasOwn(stream, key)) authorityUnavailable();
    const current = authorityStreamMember(members.prototype, key);
    if (current.owner !== captured.owner || current.descriptor.value !== captured.descriptor.value
        || current.descriptor.get !== captured.descriptor.get || current.descriptor.set !== captured.descriptor.set) authorityUnavailable();
  }
  for (const key of ["_readableState", "_writableState"]) {
    const state = authorityOwn(stream, key);
    if (!state || typeof state !== "object" || isProxy(state)
        || Reflect.ownKeys(Object.getOwnPropertyDescriptors(state)).some(name => !Object.hasOwn(Object.getOwnPropertyDescriptor(state, name), "value"))) authorityUnavailable();
  }
  if (["signal", "abortSignal", "_signal"].some(key => Object.hasOwn(stream, key))
      || authorityOwn(stream, "connecting") !== false
      || Reflect.apply(members.fields.destroyed.descriptor.get, stream, []) !== false
      || Reflect.apply(members.fields.readyState.descriptor.get, stream, []) !== "open") authorityUnavailable();
  return { connection, stream, processID, parameters, decoders, queryTimeout,
    readableState: authorityOwn(stream, "_readableState"), writableState: authorityOwn(stream, "_writableState") };
}

const authorityContextKeys = Object.freeze(["database_oid", "backend_pid", "virtual_transaction", "assigned_transaction_id", "snapshot",
  "actor", "session_actor", "read_only", "isolation", "replication", "search_path", "first_schema", "database_owner", "dr_owner", "control_owner"]);
const authorityContextSql = `select
 (select oid::text from pg_catalog.pg_database where datname=pg_catalog.current_database()) database_oid,
 pg_catalog.pg_backend_pid() backend_pid,
 (select l.virtualxid::text from pg_catalog.pg_locks l where l.pid=pg_catalog.pg_backend_pid()
   and l.locktype='virtualxid' and l.granted and l.mode='ExclusiveLock') virtual_transaction,
 pg_catalog.txid_current_if_assigned()::text assigned_transaction_id,
 pg_catalog.txid_current_snapshot()::text snapshot,current_user::text actor,session_user::text session_actor,
 pg_catalog.current_setting('transaction_read_only') read_only,pg_catalog.current_setting('transaction_isolation') isolation,
 pg_catalog.current_setting('session_replication_role') replication,pg_catalog.current_setting('search_path') search_path,
 (pg_catalog.current_schemas(true))[1]::text first_schema,
 (select pg_catalog.pg_get_userbyid(datdba) from pg_catalog.pg_database where datname=pg_catalog.current_database()) database_owner,
 (select pg_catalog.pg_get_userbyid(nspowner) from pg_catalog.pg_namespace where nspname='custodial_dr') dr_owner,
 (select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid=pg_catalog.to_regclass('custodial_dr.restore_control')) control_owner`;
const authorityStatusSql = "select custodial_dr.read_committed_immutable_original_authority($1::oid,$2::integer,$3::bigint,$4::uuid,$5::bigint,$6::text,$7::bigint) as authority_status";
function authoritySingleRow(result, keys) {
  if (authorityOwn(result, "command") !== "SELECT" || authorityOwn(result, "rowCount") !== 1) authorityUnavailable();
  const rows = authorityOwn(result, "rows");
  if (!Array.isArray(rows) || isProxy(rows) || Object.getPrototypeOf(rows) !== Array.prototype
      || Reflect.ownKeys(rows).length !== 2 || authorityOwn(rows, "length") !== 1) authorityUnavailable();
  return closedData(authorityOwn(rows, "0"), keys);
}

// The request is lookup DATA. No original intent expiry, mutation attempt,
// connection, transaction, setting, lease or effect is created by this adapter.
export async function readVerifiedImmutableFreshAuthorityCommitOutcome(options) {
  let captured, requested;
  try { captured = closedData(options, ["db", "request"]); requested = captureAuthorityRequest(captured.request); }
  catch { authorityInvalid(); }
  let databaseStatus = null, authorityStatus = null;
  try {
    const db = captured.db, native = authorityNative(db);
    const current = () => {
      const args = closedData(options, ["db", "request"]);
      if (args.db !== db || args.request !== captured.request) authorityUnavailable();
      const now = captureAuthorityRequest(args.request);
      for (const key of authorityRequestKeys) if (now[key] !== requested[key]) authorityUnavailable();
      const actual = authorityNative(db);
      for (const key of ["connection", "stream", "processID", "parameters", "decoders", "queryTimeout", "readableState", "writableState"])
        if (actual[key] !== native[key]) authorityUnavailable();
    };
    const guarded = async operation => {
      current(); let value, failed = false, failure;
      try { value = await operation(); } catch (error) { failed = true; failure = error; }
      try { current(); } catch (error) {
        if (failed) throw new AggregateError([failure, error], "Original authority status/read currentness refused", { cause: failure });
        throw error;
      }
      if (failed) throw failure; return value;
    };
    let originalContext;
    const context = async () => {
      const row = authoritySingleRow(await guarded(() => Reflect.apply(authorityQuery, db, [authorityContextSql])), authorityContextKeys);
      if (row.database_oid !== requested.databaseOid || row.backend_pid !== native.processID || typeof row.actor !== "string" || !row.actor.length
          || row.actor !== row.session_actor || row.control_owner !== row.actor || row.database_owner !== "postgres" || row.dr_owner !== "postgres"
          || row.read_only !== "on" || row.isolation !== "repeatable read" || row.replication !== "origin"
          || row.search_path !== "pg_catalog, pg_temp" || row.first_schema !== "pg_catalog"
          || typeof row.virtual_transaction !== "string" || !/^[1-9][0-9]*\/[1-9][0-9]*(?![\s\S])/.test(row.virtual_transaction)
          || typeof row.snapshot !== "string" || !/^[0-9]+:[0-9]+:(?:[0-9]+(?:,[0-9]+)*)?(?![\s\S])/.test(row.snapshot)) authorityUnavailable();
      if (row.assigned_transaction_id !== null) {
        authorityDecimal(row.assigned_transaction_id, true);
        if (row.assigned_transaction_id === requested.effectTransactionId) authorityUnavailable();
      }
      if (originalContext) for (const key of authorityContextKeys) if (row[key] !== originalContext[key]) authorityUnavailable();
      originalContext = row;
    };
    await context(); current();
    const lookup = Object.freeze(Object.fromEntries(requestKeys.map(key => [key, requested[key]])));
    const first = captureStatus(await guarded(() => readOriginalRestoreDatabaseStatus(db, lookup)), lookup);
    if (first.database_marker_status !== "OBSERVED_DATABASE_MARKERS" || first.database_verified !== true) authorityUnavailable();
    await context(); current();
    const row = authoritySingleRow(await guarded(() => Reflect.apply(authorityQuery, db, [authorityStatusSql,
      [requested.databaseOid, requested.effectBackendPid, requested.effectTransactionId, requested.restoreId,
        requested.generation, requested.archiveDigest, requested.originalTransactionId]])), ["authority_status"]);
    const observed = captureAuthorityStatus(row.authority_status, requested);
    await context(); current();
    const final = captureStatus(await guarded(() => readOriginalRestoreDatabaseStatus(db, lookup)), lookup);
    for (const key of statusKeys) if (final[key] !== first[key]) authorityUnavailable();
    await context(); current();
    databaseStatus = final; authorityStatus = observed;
  } catch {
    // Missing, malformed, detached, stale or unavailable is never nonexecution.
    // Do not retain a pre-await "current" status after a later refusal.
  }
  return Object.freeze({
    schema: "custodial.immutable-private-fresh-authority-commit-outcome.v1",
    requested_original: requested,
    observation: authorityStatus === null ? "UNAVAILABLE" : "CURRENT_FIXED_READ",
    outcome: authorityStatus === null ? "UNKNOWN" : "AUTHORITY_COMPLETION_OBSERVED",
    database_status: databaseStatus, authority_status: authorityStatus,
    metadata_only: true, retry_safe: false, retry_allowed: false,
    resume_allowed: false, rerun_import_allowed: false, complete_restore: false,
  });
}

// Discovery is fixed original-tuple lookup DATA, not admission or an ACK. No
// ORDER/LIMIT can choose a survivor, and contradictory/partial rows are not
// filtered away. The unchanged strict reader below owns Source/ancestry proof.
const authorityDiscoveryKeys = Object.freeze(["database_oid", "effect_backend_pid", "effect_transaction_id",
  "original_transaction_id", "restore_id", "authority_generation", "archive_digest", "phase",
  "completed_step", "active_table_oid", "scope_metadata_valid"]);
const authorityDiscoverySql = `select s.database_oid::text database_oid,s.backend_pid effect_backend_pid,
 s.transaction_id::text effect_transaction_id,s.original_transaction_id::text original_transaction_id,
 s.restore_id::text restore_id,s.authority_generation::text authority_generation,s.archive_digest,
 s.phase,s.completed_step::integer completed_step,s.active_table_oid::text active_table_oid,
 (r.relkind='r' and r.relpersistence='p' and not r.relispartition and r.relrowsecurity and r.relforcerowsecurity
  and ns.nspname='custodial_dr' and pg_catalog.pg_get_userbyid(ns.nspowner)='postgres'
  and current_user=session_user and r.relowner=(select oid from pg_catalog.pg_roles where rolname=current_user)
  and r.relowner=(select relowner from pg_catalog.pg_class where oid=pg_catalog.to_regclass('custodial_dr.restore_control'))
  and s.owner_oid=r.relowner and not exists(select 1 from pg_catalog.aclexplode(
    coalesce(r.relacl,pg_catalog.acldefault('r',r.relowner))) a where a.grantee<>r.relowner)) scope_metadata_valid
 from ONLY custodial_dr.immutable_original_authority_scopes s
 join pg_catalog.pg_class r on r.oid=pg_catalog.to_regclass('custodial_dr.immutable_original_authority_scopes')
 join pg_catalog.pg_namespace ns on ns.oid=r.relnamespace
 where s.restore_id=$1::uuid and s.authority_generation=$2::bigint`;

function captureDiscoveredAuthorityRequest(value, requested, context) {
  const row = closedData(value, authorityDiscoveryKeys);
  if (row.scope_metadata_valid !== true || row.phase !== "CONSUMED" || row.completed_step !== 6
      || row.active_table_oid !== null || row.database_oid !== context.database_oid
      || row.restore_id !== requested.restoreId || row.authority_generation !== requested.generation
      || row.archive_digest !== requested.archiveDigest) authorityUnavailable();
  const lookup = captureAuthorityRequest({ ...requested, databaseOid: row.database_oid,
    effectBackendPid: row.effect_backend_pid, effectTransactionId: row.effect_transaction_id,
    originalTransactionId: row.original_transaction_id });
  if (context.assigned_transaction_id === lookup.effectTransactionId) authorityUnavailable();
  return lookup;
}

// Restart recovery from the retained original four fields only. It neither
// opens a transaction nor reconstructs a write capability. The recorded eight
// fields are published only after the existing strict reader verifies them.
export async function readVerifiedImmutableFreshAuthorityCommitOutcomeFromOriginal(options) {
  let captured, requested;
  try { captured = closedData(options, ["db", "request"]); requested = captureRequest(captured.request); }
  catch { authorityInvalid(); }
  let recordedLookup = null, databaseStatus = null, authorityStatus = null;
  try {
    const db = captured.db, native = authorityNative(db);
    const current = () => {
      const args = closedData(options, ["db", "request"]);
      if (args.db !== db || args.request !== captured.request) authorityUnavailable();
      const now = captureRequest(args.request);
      for (const key of requestKeys) if (now[key] !== requested[key]) authorityUnavailable();
      const actual = authorityNative(db);
      for (const key of ["connection", "stream", "processID", "parameters", "decoders", "queryTimeout", "readableState", "writableState"])
        if (actual[key] !== native[key]) authorityUnavailable();
    };
    const guarded = async operation => {
      current(); let value, failed = false, failure;
      try { value = await operation(); } catch (error) { failed = true; failure = error; }
      try { current(); } catch (error) {
        if (failed) throw new AggregateError([failure, error], "Original authority discovery currentness refused", { cause: failure });
        throw error;
      }
      if (failed) throw failure;
      return value;
    };
    let originalContext;
    const context = async () => {
      const row = authoritySingleRow(await guarded(() => Reflect.apply(authorityQuery, db, [authorityContextSql])), authorityContextKeys);
      authorityDecimal(row.database_oid, true, 4294967295n);
      if (row.backend_pid !== native.processID || typeof row.actor !== "string" || !row.actor.length
          || row.actor !== row.session_actor || row.control_owner !== row.actor || row.database_owner !== "postgres" || row.dr_owner !== "postgres"
          || row.read_only !== "on" || row.isolation !== "repeatable read" || row.replication !== "origin"
          || row.search_path !== "pg_catalog, pg_temp" || row.first_schema !== "pg_catalog"
          || typeof row.virtual_transaction !== "string" || !/^[1-9][0-9]*\/[1-9][0-9]*(?![\s\S])/.test(row.virtual_transaction)
          || typeof row.snapshot !== "string" || !/^[0-9]+:[0-9]+:(?:[0-9]+(?:,[0-9]+)*)?(?![\s\S])/.test(row.snapshot)) authorityUnavailable();
      if (row.assigned_transaction_id !== null) authorityDecimal(row.assigned_transaction_id, true);
      if (originalContext) for (const key of authorityContextKeys) if (row[key] !== originalContext[key]) authorityUnavailable();
      originalContext = row;
    };
    const discover = async () => captureDiscoveredAuthorityRequest(authoritySingleRow(
      await guarded(() => Reflect.apply(authorityQuery, db, [authorityDiscoverySql, [requested.restoreId, requested.generation]])),
      authorityDiscoveryKeys), requested, originalContext);
    await context();
    const first = captureStatus(await guarded(() => readOriginalRestoreDatabaseStatus(db, requested)), requested);
    if (first.database_marker_status !== "OBSERVED_DATABASE_MARKERS" || first.database_verified !== true) authorityUnavailable();
    await context();
    const lookup = await discover();
    await context();
    // No public/injected reader and no optional fields in the strict API.
    const checked = closedData(await guarded(() => readVerifiedImmutableFreshAuthorityCommitOutcome({ db, request: lookup })),
      ["schema", "requested_original", "observation", "outcome", "database_status", "authority_status", "metadata_only",
        "retry_safe", "retry_allowed", "resume_allowed", "rerun_import_allowed", "complete_restore"]);
    if (checked.schema !== "custodial.immutable-private-fresh-authority-commit-outcome.v1"
        || checked.observation !== "CURRENT_FIXED_READ" || checked.outcome !== "AUTHORITY_COMPLETION_OBSERVED"
        || checked.metadata_only !== true || ["retry_safe", "retry_allowed", "resume_allowed", "rerun_import_allowed", "complete_restore"]
          .some(key => checked[key] !== false)) authorityUnavailable();
    const verifiedLookup = captureAuthorityRequest(checked.requested_original);
    for (const key of authorityRequestKeys) if (verifiedLookup[key] !== lookup[key]) authorityUnavailable();
    const observed = captureAuthorityStatus(checked.authority_status, lookup);
    const verifiedDatabase = captureStatus(checked.database_status, requested);
    for (const key of statusKeys) if (verifiedDatabase[key] !== first[key]) authorityUnavailable();
    await context();
    const lastLookup = await discover();
    for (const key of authorityRequestKeys) if (lastLookup[key] !== lookup[key]) authorityUnavailable();
    await context();
    const final = captureStatus(await guarded(() => readOriginalRestoreDatabaseStatus(db, requested)), requested);
    for (const key of statusKeys) if (final[key] !== first[key]) authorityUnavailable();
    await context(); current();
    recordedLookup = lookup; databaseStatus = final; authorityStatus = observed;
  } catch {
    // No match or unavailable is UNKNOWN, never proof of rollback/nonexecution.
    // No discovered partial tuple or pre-await status survives a later refusal.
  }
  return Object.freeze({
    schema: "custodial.immutable-private-fresh-authority-original-outcome.v1",
    requested_original: requested, recorded_lookup: recordedLookup,
    observation: authorityStatus === null ? "UNAVAILABLE" : "CURRENT_FIXED_READ",
    outcome: authorityStatus === null ? "UNKNOWN" : "AUTHORITY_COMPLETION_OBSERVED",
    database_status: databaseStatus, authority_status: authorityStatus,
    metadata_only: true, retry_safe: false, retry_allowed: false,
    resume_allowed: false, rerun_import_allowed: false, complete_restore: false,
  });
}
