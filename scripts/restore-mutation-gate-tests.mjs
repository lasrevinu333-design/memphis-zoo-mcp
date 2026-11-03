#!/usr/bin/env node

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import { makeRestoreMutationGate, withApplicationMutationLease } from "../src/restore-mutation-gate.js";
import pg from "pg";
import { isProxy } from "node:util/types";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { invalidateRestoredAuthority } from "./disaster-recovery-state.mjs";
import { Socket } from "node:net";

// NEW typed TEXT snapshot/release DATA path only. These query recordings are
// inert, not native SQL, authenticated principals, target admission or restore
// proof. No connection, server, signer, capture archive or old group is run.
if (process.argv.includes("--typed-text-pre-restore-snapshots-only")) {
  const { readFileSync } = await import("node:fs"), { createHash } = await import("node:crypto");
  const { stableJson } = await import("./disaster-recovery-crypto.mjs");
  const actual = await import("./disaster-recovery-state.mjs");
  const source = readFileSync(new URL("./disaster-recovery-state.mjs", import.meta.url), "utf8");
  const start = source.indexOf("const SNAPSHOT_CATEGORIES = ["), end = source.indexOf("\nasync function existingColumns", start);
  const categories = new Function(source.slice(start, end) + "\nreturn SNAPSHOT_CATEGORIES;")();
  const release = categories.find(row => row.category === "release_identity");
  const schema = readFileSync(new URL("../supabase/migrations/00000000000000_production_baseline.sql", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(schema).digest("hex"), "decf8dcdceb1f722ec966d16addd8c47d7ceaca9a21f1464a26bf8cbfee7d7fb");
  const declaration = schema.slice(schema.indexOf('create table "public"."release_deployment_manifest" ('), schema.indexOf('create table "public"."release_validation_runs"'));
  for (const field of release.fields) assert.ok(declaration.includes('"' + field + '" ' +
    (field === "details_json" ? "jsonb" : ["created_at", "deployed_at"].includes(field) ? "timestamp with time zone" : "text")));
  const v1 = "postgres-json-text-line.v1", v2 = "postgres-text-columns-line.v2", id = "11111111-1111-4111-8111-111111111111";
  const generation = "9007199254740993", sha = rows => createHash("sha256").update(stableJson(rows)).digest("hex");
  const clone = value => structuredClone(value), result = rows => ({ command: "SELECT", rowCount: rows.length, rows });
  const detailsText = '{"big": 9007199254740993, "precise": 0.123456789012345678901}';
  const profile = { float_digits: "3", date_style: "ISO, YMD", timezone: "UTC", interval_style: "postgres", bytea_output: "hex" };
  const rowText = (descriptor, encoding, state) => {
    const values = descriptor.fields.map(field => {
      if (field === "release_id") return JSON.stringify("UNIT-only.invalid/release");
      if (field === "backend_commit") return JSON.stringify("a".repeat(40));
      if (field === "frontend_commit") return JSON.stringify("b".repeat(40));
      if (field === "migration_manifest_sha256") return JSON.stringify("c".repeat(64));
      if (field === "status") return JSON.stringify("retired");
      if (field === "details_json") return encoding === v2 ? JSON.stringify(detailsText) : detailsText;
      if (field === "changed_fields") return state.jsonNull && encoding === v2 ? '"null"' : "null";
      if (field === "deployed_at") return "null";
      if (["created_at", "updated_at", "started_at", "ended_at", "effective_started_at", "effective_ended_at"].includes(field)) {
        return JSON.stringify(encoding === v2 ? "2026-10-18 00:00:00." + (state.changed ? "123457" : "123456") + "+00"
          : "2026-10-18T00:00:00." + (state.changed ? "123457" : "123456") + "+00:00");
      }
      if (field === "id" || field === "assignment_epoch") return encoding === v2 ? '"9007199254740993"' : "9007199254740993";
      return JSON.stringify("UNIT " + field);
    });
    return "{" + descriptor.fields.map((field, i) => JSON.stringify(field) + ":" + values[i]).join(",") + "}";
  };
  function recording() {
    const saved = new Map(), trace = { queries: [], data: [], inserts: 0, updates: 0, discrepancies: [], profiles: 0 };
    const state = { changed: false, jsonNull: false, duplicate: false, missing: false, empty: false,
      malformed: null, badProfile: null, profileAfterData: false, readFailure: null, badStored: null };
    const db = { async query(sql, args = []) {
      trace.queries.push({ sql, args: clone(args) });
      if (sql.includes("pg_catalog.current_setting('extra_float_digits')")) {
        trace.profiles++;
        return result([{ ...profile, ...(state.badProfile && (!state.profileAfterData || trace.data.length) ? state.badProfile : {}) }]);
      }
      if (sql.startsWith("select to_regclass")) return result([{ relation: state.missing ? null : args[0] }]);
      if (sql.includes("from information_schema.columns")) return result(categories.find(c => c.table === args[1]).fields.map(column_name => ({ column_name })));
      if (sql.includes("insert into custodial_dr.pre_restore_snapshots(")) {
        const [restoreId, authority, category, count, digest, json] = args, key = restoreId + "/" + category;
        const existing = saved.has(key);
        if (!existing) { trace.inserts++; saved.set(key, { restore_id: restoreId, authority_generation: authority, category,
          row_count: String(count), snapshot_sha256: digest, state_json: JSON.parse(json) }); }
        if (/do update set/i.test(sql)) trace.updates++;
        return { command: "INSERT", rowCount: existing ? 0 : 1, rows: [] };
      }
      if (sql.includes("from custodial_dr.pre_restore_snapshots")) {
        if (state.readFailure) throw state.readFailure;
        const row = saved.get(args[0] + "/" + args[1]);
        if (!row || args.length === 3 && row.authority_generation !== args[2]) return result([]);
        const reply = result([clone(row)]); state.badStored?.(reply); return reply;
      }
      if (sql.includes("insert into custodial_dr.restore_discrepancies(")) { trace.discrepancies.push(clone(args)); return { command: "INSERT", rowCount: 1, rows: [] }; }
      const table = sql.match(/from "public"\."([a-z_]+)"/);
      assert.ok(table, "Unexpected recording query: no fallback port");
      const descriptor = categories.find(c => c.table === table[1]), encoding = sql.includes("pg_catalog.json_object(") ? v2 : v1;
      trace.data.push({ sql, encoding });
      let original_row = rowText(descriptor, encoding, state);
      if (state.malformed) original_row = state.malformed(original_row, descriptor);
      const rows = state.empty ? [] : [{ original_row }, ...(state.duplicate ? [{ original_row }] : [])];
      return result(rows);
    } };
    return { db, state, saved, trace };
  }
  const options = { restoreId: id, generation }, bind = rows => ({ restore_id: id, authority_generation: generation,
    category: "release_identity", row_count: String(rows.length), snapshot_sha256: sha(rows),
    state_json: { missing: false, fields: [...release.fields], data_encoding: v2, rows } });
  let cases = 0;
  const check = async work => { await work(); cases++; };
  const fresh = recording();
  await actual.capturePreRestoreState(fresh.db, options);
  assert.equal(fresh.trace.inserts, 10); assert.equal(fresh.trace.updates, 0);
  assert.ok([...fresh.saved.values()].every(row => row.state_json.data_encoding === v2));
  for (const { sql } of fresh.trace.data) {
    assert.match(sql, /pg_catalog\.json_object\(ARRAY\[/); assert.match(sql, /::pg_catalog\.text\[\]/);
    assert.match(sql, /collate pg_catalog\."C" nulls first/); assert.doesNotMatch(sql, /row_to_json|json_populate_record|SET |BEGIN|COMMIT/);
  }
  const captured = JSON.stringify([...fresh.saved]);
  assert.deepEqual(await actual.compareRestoredState(fresh.db, options), []);
  assert.equal(JSON.stringify([...fresh.saved]), captured); cases++;
  await check(async () => {
    const raw = fresh.saved.get(id + "/release_identity").state_json.rows[0];
    assert.equal(JSON.parse(raw).details_json, detailsText); assert.ok(raw.includes(".123456+00"));
    assert.equal(fresh.saved.get(id + "/device_assignments").state_json.rows[0].includes('"id":"9007199254740993"'), true);
    assert.equal(sha([raw]), fresh.saved.get(id + "/release_identity").snapshot_sha256);
  });
  await check(async () => {
    fresh.state.jsonNull = true;
    const changed = await actual.compareRestoredState(fresh.db, options);
    assert.deepEqual(changed.map(row => row.category), ["cleaning_session_corrections"]);
    const d = JSON.parse(fresh.trace.discrepancies.at(-1)[7]);
    assert.ok(d.pre_restore_identities[0].includes('"changed_fields":null'));
    assert.ok(d.restored_identities[0].includes('"changed_fields":"null"')); assert.equal(d.data_encoding, v2);
    assert.equal(JSON.stringify([...fresh.saved]), captured); fresh.state.jsonNull = false;
  });
  await check(async () => {
    const r = recording(); r.state.duplicate = true; await actual.capturePreRestoreState(r.db, options);
    for (const row of r.saved.values()) { assert.equal(row.row_count, "2"); assert.equal(row.state_json.rows[0], row.state_json.rows[1]); }
    assert.deepEqual(await actual.compareRestoredState(r.db, options), []);
  });
  for (const state of [{ missing: true }, { empty: true }]) await check(async () => {
    const r = recording(); Object.assign(r.state, state); await actual.capturePreRestoreState(r.db, options);
    assert.deepEqual(await actual.compareRestoredState(r.db, options), []);
    const first = JSON.stringify([...r.saved]); r.state.missing = false; r.state.empty = true;
    assert.equal((await actual.compareRestoredState(r.db, options)).length, state.missing ? 10 : 0);
    assert.equal(JSON.stringify([...r.saved]), first);
  });
  for (const change of [state => state.changed = true, state => state.jsonNull = true]) await check(async () => {
    const r = recording(); await actual.capturePreRestoreState(r.db, options); const first = JSON.stringify([...r.saved]);
    change(r.state); await assert.rejects(actual.capturePreRestoreState(r.db, options));
    assert.equal(JSON.stringify([...r.saved]), first); assert.equal(r.trace.updates, 0);
  });
  await check(async () => { const r = recording(); await actual.capturePreRestoreState(r.db, options); const first = JSON.stringify([...r.saved]);
    await assert.rejects(actual.capturePreRestoreState(r.db, { restoreId: id, generation: "9007199254740992" }));
    await assert.rejects(actual.compareRestoredState(r.db, { restoreId: id, generation: "9007199254740992" })); assert.equal(JSON.stringify([...r.saved]), first); });
  for (const patch of [{ float_digits: "1" }, { date_style: "ISO, MDY" }, { timezone: "localtime" }, { interval_style: "iso_8601" }, { bytea_output: "escape" }]) {
    for (const after of [false, true]) await check(async () => {
      const r = recording(); r.state.badProfile = patch; r.state.profileAfterData = after;
      await assert.rejects(actual.capturePreRestoreState(r.db, options), e => e.code === "RESTORE_SNAPSHOT_TEXT_OUTPUT_UNAVAILABLE");
      assert.equal(r.trace.inserts, 0); assert.equal(r.trace.data.length, after ? 1 : 0);
    });
  }
  for (const mutate of [raw => raw.replace(/:\"UNIT credential_id\"/, ':123'),
    raw => raw.replace('"credential_id":', '"credential_id":null,"\\u0063redential_id":'),
    raw => raw.replace('"credential_id":', '"unknown":'), raw => raw.replace('"credential_id":', '"extra":null,"credential_id":'),
    () => "[]", () => "{", raw => raw.replace('UNIT credential_id', '\\ud800')]) await check(async () => {
    const r = recording(); r.state.malformed = mutate; await assert.rejects(actual.capturePreRestoreState(r.db, options)); assert.equal(r.trace.inserts, 0);
  });
  for (const mutation of [row => delete row.state_json.data_encoding, row => row.state_json.data_encoding = "unknown.v2",
    row => row.state_json.data_encoding = v1, row => row.state_json.fields.push(row.state_json.fields[0]),
    row => row.authority_generation = "1", row => row.restore_id = "22222222-2222-4222-8222-222222222222",
    row => row.snapshot_sha256 = "f".repeat(64), row => row.row_count = "01", row => row.state_json.rows[0] = {},
    row => row.state_json.rows[0] = row.state_json.rows[0].replace('"credential_id":', '"credential_id":null,"credential_id":')]) await check(async () => {
    const r = recording(); await actual.capturePreRestoreState(r.db, options);
    const original = r.saved.values().next().value; mutation(original);
    if (original.state_json.data_encoding === v1) original.state_json.data_encoding = "postgres-text-columns-line.v2\n";
    const first = JSON.stringify([...r.saved]); const reads = r.trace.data.length;
    await assert.rejects(actual.compareRestoredState(r.db, options)); assert.equal(r.trace.data.length, reads);
    assert.equal(r.trace.discrepancies.length, 0); assert.equal(JSON.stringify([...r.saved]), first);
  });
  await check(async () => { const r = recording(); await actual.capturePreRestoreState(r.db, options);
    r.state.badStored = reply => { reply.rowCount = 2; reply.rows.push(reply.rows[0]); };
    await assert.rejects(actual.compareRestoredState(r.db, options)); assert.equal(r.trace.discrepancies.length, 0); });
  await check(async () => { const r = recording(), first = Error("UNIT fixed first read failure"); r.state.readFailure = first;
    await assert.rejects(actual.compareRestoredState(r.db, options), e => e === first); assert.equal(r.trace.queries.length, 1); });

  // Real exported release helper, inert fixed native TEXT/column recordings.
  async function preserve(snapshot, option = {}, module = actual) {
    const trace = { queries: [], writes: [], profiles: 0, catalogs: 0 };
    const columns = release.fields.map(name => ({ relation_oid: "42", kind: "r", persistence: "p", is_partition: false, inherited: false,
      name, type_oid: name === "details_json" ? "3802" : ["created_at", "deployed_at"].includes(name) ? "1184" : "25",
      type_modifier: -1, generated: "", identity: "", not_null: name !== "deployed_at" }));
    let value, error;
    const db = { async query(sql, args = []) {
      trace.queries.push({ sql, args: clone(args) });
      if (sql.includes("from custodial_dr.pre_restore_snapshots")) { if (option.readError) throw option.readError; return result([snapshot]); }
      if (sql.includes("pg_catalog.current_setting('extra_float_digits')")) { trace.profiles++; return result([{ ...profile, ...(option.badProfile ?? {}) }]); }
      if (sql.includes("from pg_catalog.pg_class c")) { trace.catalogs++; let rows = clone(columns); rows = option.columns?.(rows, trace.catalogs) ?? rows; return result(rows); }
      assert.ok(sql.includes("insert into public.release_deployment_manifest(")); trace.writes.push({ sql, args: clone(args) });
      if (option.writeError) throw option.writeError;
      return { command: "INSERT", rowCount: option.rowCount ?? 1, rows: [] };
    } };
    try { value = await module.preserveCurrentReleaseIdentity(db, options); } catch (caught) { error = caught; }
    return { value, error, trace };
  }
  const nativeRaw = rowText(release, v2, { changed: false });
  await check(async () => {
    const original = bind([nativeRaw]), before = JSON.stringify(original), p = await preserve(original);
    assert.equal(p.error, undefined); assert.equal(p.value, 1); assert.deepEqual(p.trace.writes[0].args, [nativeRaw]);
    const sql = p.trace.writes[0].sql; assert.match(sql, /::pg_catalog\.jsonb/); assert.match(sql, /::pg_catalog\.timestamptz/);
    assert.match(sql, /is not distinct from o\.image::pg_catalog\.jsonb/); assert.match(sql, /from checked r/);
    assert.doesNotMatch(sql, /json_populate_record|immutable_import|SET |BEGIN|COMMIT|9007199254740993/);
    assert.equal(JSON.stringify(original), before);
  });
  for (const mutate of [row => row.authority_generation = "2", row => row.snapshot_sha256 = "f".repeat(64), row => row.row_count = "01",
    row => row.state_json.data_encoding = undefined, row => row.state_json.data_encoding = "unknown", row => row.state_json.fields.push(row.state_json.fields[0]),
    row => { row.state_json.rows.push(nativeRaw); row.row_count = "2"; row.snapshot_sha256 = sha(row.state_json.rows); },
    row => { row.state_json.rows = [nativeRaw.replace('"details_json":', '"details_json":null,"details_json":')]; row.snapshot_sha256 = sha(row.state_json.rows); },
    row => { row.state_json.rows = [nativeRaw.replace(JSON.stringify(detailsText), "null")]; row.snapshot_sha256 = sha(row.state_json.rows); }]) await check(async () => {
    const original = bind([nativeRaw]); mutate(original); const p = await preserve(original);
    assert.equal(p.error?.code, "RESTORE_ORIGINAL_RELEASE_SNAPSHOT_INVALID"); assert.equal(p.trace.writes.length, 0);
  });
  for (const columns of [() => [], rows => rows.slice(1), rows => [...rows, rows[0]], rows => rows.reverse(),
    rows => { rows[7].type_oid = "114"; return rows; }, rows => { rows[0].generated = "s"; return rows; },
    rows => { rows[8].type_modifier = 3; return rows; }, rows => { rows[0].relation_oid = "43"; return rows; }]) await check(async () => {
    const p = await preserve(bind([nativeRaw]), { columns }); assert.equal(p.error?.code, "RESTORE_ORIGINAL_RELEASE_SNAPSHOT_INVALID"); assert.equal(p.trace.writes.length, 0);
  });
  await check(async () => { const p = await preserve(bind([nativeRaw]), { columns(rows, n) { if (n === 2) rows[0].relation_oid = "43"; return rows; } });
    assert.equal(p.error?.code, "RESTORE_ORIGINAL_RELEASE_SNAPSHOT_INVALID"); assert.equal(p.trace.writes.length, 1); });
  await check(async () => { const p = await preserve(bind([nativeRaw]), { rowCount: 0 }); assert.equal(p.error?.code, "RESTORE_ORIGINAL_RELEASE_SNAPSHOT_INVALID"); assert.equal(p.trace.writes.length, 1); });
  for (const operation of ["readError", "writeError"]) await check(async () => {
    const first = Error("UNIT first " + operation), p = await preserve(bind([nativeRaw]), { [operation]: first });
    assert.equal(p.error, first); assert.equal(p.trace.writes.length, operation === "readError" ? 0 : 1);
  });
  await check(async () => { const p = await preserve(bind([nativeRaw]), { badProfile: { timezone: "localtime" } }); assert.equal(p.error?.code, "RESTORE_SNAPSHOT_TEXT_OUTPUT_UNAVAILABLE"); assert.equal(p.trace.writes.length, 0); });
  const predecessor = process.env.TYPED_SNAPSHOT_PREDECESSOR;
  let v1TraceUnchanged = "NOT_RUN", predecessorNullCollapse = "NOT_RUN";
  if (predecessor) {
    const beforeSource = readFileSync(predecessor, "utf8"); assert.equal(createHash("sha256").update(beforeSource).digest("hex"), "1daf3b670ed3c23d9f9f4295b84768ee002359f2bd55f5b3ac27d7220763ea11");
    const before = await import(pathToFileURL(resolve(predecessor)).href);
    await check(async () => {
      const a = recording(), b = recording(); b.state.jsonNull = true;
      await before.capturePreRestoreState(a.db, options); await before.capturePreRestoreState(b.db, options);
      assert.equal(a.saved.get(id + "/cleaning_session_corrections").snapshot_sha256, b.saved.get(id + "/cleaning_session_corrections").snapshot_sha256);
      predecessorNullCollapse = "V1_COMPONENT_NULL_COLLAPSE_NATIVE_V120_RETAINED_NOT_REPLAYED";
      const original = JSON.stringify([...a.saved]); const oldQueries = a.trace.queries.length;
      assert.deepEqual(await before.compareRestoredState(a.db, options), []); const expected = a.trace.queries.slice(oldQueries);
      a.trace.queries.length = 0; assert.deepEqual(await actual.compareRestoredState(a.db, options), []);
      assert.deepEqual(a.trace.queries, expected); assert.equal(a.trace.profiles, 0); assert.equal(JSON.stringify([...a.saved]), original); v1TraceUnchanged = true;
      await assert.rejects(actual.capturePreRestoreState(a.db, options)); assert.equal(JSON.stringify([...a.saved]), original); assert.equal(a.trace.updates, 0);
    });
    await check(async () => {
      const original = bind([rowText(release, v1, { changed: false })]); original.state_json.data_encoding = v1;
      const old = await preserve(clone(original), {}, before), now = await preserve(clone(original));
      assert.equal(old.error, undefined); assert.equal(now.error, undefined); assert.equal(now.value, old.value); assert.deepEqual(now.trace, old.trace);
      assert.match(now.trace.writes[0].sql, /json_populate_record\(null::public\.release_deployment_manifest,\$1::json\)/);
    });
    const unchanged = (begin, finish) => { const a = beforeSource.indexOf(begin), b = beforeSource.indexOf(finish, a);
      assert.ok(a >= 0 && b > a); assert.ok(source.includes(beforeSource.slice(a, b))); };
    unchanged("// Private original native port, not an effect issuer", "export async function preserveCurrentReleaseIdentity");
    assert.equal(source.slice(source.indexOf("// Additional denial only:")), beforeSource.slice(beforeSource.indexOf("// Additional denial only:"))); cases++;
  }
  console.log(JSON.stringify({ selector: "typed-text-pre-restore-snapshots-only", cases, v1TraceUnchanged, predecessorNullCollapse,
    source_component_only: true, native_SQL: "NOT_RUN", actual_auth_or_transaction_or_restore_proof: false,
    connections: 0, signatures: 0, old_groups_replayed: 0, resources0: true }));
  process.exit(0);
}

const unadmittedClient = pg.Client;
const unadmittedPrototype = unadmittedClient.prototype;
const unadmittedQuery = unadmittedPrototype.query;
const unadmittedDatabaseError = pg.DatabaseError;

// Main supplies its actual current schema and native RW RR transaction under
// both fences. This member owns ONLY its savepoint, never a client/transaction,
// fixture, role, trigger, setting, grant, effect issuer or connection lifetime.
export async function runRestoredAuthorityUnadmittedSqlCase(db, options) {
  const fail = message => { throw new Error(message); };
  const own = (object, key) => {
    if (!object || typeof object !== "object" || isProxy(object)) fail("Original own DATA required");
    const field = Object.getOwnPropertyDescriptor(object, key);
    if (!field || !Object.hasOwn(field, "value")) fail("Original own DATA required");
    return field.value;
  };
  if (!options || typeof options !== "object" || isProxy(options) || Object.getPrototypeOf(options) !== Object.prototype
      || Reflect.ownKeys(options).length !== 1) fail("Exact original generation options required");
  const generation = own(options, "generation");
  if (typeof generation !== "string" || !/^[1-9][0-9]{0,18}(?![\s\S])/.test(generation)
      || BigInt(generation) > 9223372036854775807n) fail("Canonical original generation TEXT required");
  const native = (aborted = false) => {
    const exported = Object.getOwnPropertyDescriptor(pg, "Client"), query = Object.getOwnPropertyDescriptor(unadmittedPrototype, "query");
    if (!db || typeof db !== "object" || isProxy(db) || !exported || exported.value !== unadmittedClient
        || !query || query.value !== unadmittedQuery || unadmittedClient.prototype !== unadmittedPrototype
        || Object.getPrototypeOf(db) !== unadmittedPrototype || Object.hasOwn(db, "query")
        || own(db, "_connected") !== true || own(db, "_ending") !== false || own(db, "_ended") !== false
        || own(db, "_queryable") !== true || !["T", ...(aborted ? ["E"] : [])].includes(own(db, "_txStatus")))
      fail("Actual original started native transaction required");
  };
  native();
  const originalConnection = own(db, "connection");
  const raw = async (sql, params = [], aborted = false) => {
    native(aborted);
    if (own(db, "connection") !== originalConnection) fail("Original native connection changed");
    let result, failed = false, failure;
    try { result = await Reflect.apply(unadmittedQuery, db, [sql, params]); }
    catch (error) { failed = true; failure = error; }
    try {
      native(true);
      if (own(db, "connection") !== originalConnection) fail("Original native connection changed");
    } catch (error) {
      if (failed) throw new AggregateError([failure, error], "Native operation and identity failed", { cause: failure });
      throw error;
    }
    if (failed) throw failure;
    return result;
  };
  const dense = values => {
    if (!Array.isArray(values) || isProxy(values) || Object.getPrototypeOf(values) !== Array.prototype
        || Reflect.ownKeys(values).length !== values.length + 1) fail("Complete native rows required");
    return Array.from({ length: values.length }, (_, i) => own(values, String(i)));
  };
  const rows = result => {
    const resultRows = dense(own(result, "rows"));
    if (own(result, "command") !== "SELECT" || own(result, "rowCount") !== resultRows.length) fail("Exact native SELECT required");
    return resultRows;
  };
  const contextSql = `select pg_catalog.row_to_json(c)::text context_utf8 from (select
    (select oid::text from pg_catalog.pg_database where datname=pg_catalog.current_database()) database_oid,
    pg_catalog.pg_backend_pid() backend_pid,pg_catalog.txid_current()::text transaction_id,
    current_user actor,session_user session_actor,
    (select pg_catalog.pg_get_userbyid(datdba) from pg_catalog.pg_database where datname=pg_catalog.current_database()) database_owner,
    (select pg_catalog.pg_get_userbyid(nspowner) from pg_catalog.pg_namespace where nspname='custodial_dr') dr_owner,
    (select oid::text from pg_catalog.pg_class where oid=pg_catalog.to_regclass('custodial_dr.restore_control') and relkind='r') control_oid,
    (select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid=pg_catalog.to_regclass('custodial_dr.restore_control')) control_owner,
    pg_catalog.current_setting('transaction_read_only') read_only,pg_catalog.current_setting('transaction_isolation') isolation,
    pg_catalog.current_setting('session_replication_role') replication,pg_catalog.current_setting('row_security') row_security,
    pg_catalog.current_setting('search_path') search_path,(pg_catalog.current_schemas(true))[1] first_schema,
    (select count(*)::int from unnest(array['memphis-zoo-application-mutation-admission','memphis-zoo-application-mutation-fence']) f(name)
      where exists(select 1 from pg_catalog.pg_locks l where l.locktype='advisory' and l.pid=pg_catalog.pg_backend_pid()
        and l.database=(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database())
        and l.granted and l.mode='ExclusiveLock'
        and l.classid=((pg_catalog.hashtextextended(f.name,0)>>32)&4294967295)::oid
        and l.objid=(pg_catalog.hashtextextended(f.name,0)&4294967295)::oid and l.objsubid=1)) held_fences,
    (select count(*)::int from custodial_dr.restore_control) control_count,
    (select pg_catalog.row_to_json(control)::text from custodial_dr.restore_control control where singleton) control_utf8,
    (select authority_generation::text from custodial_dr.restore_control where singleton) generation
  ) c`;
  let originalContext;
  const context = async () => {
    const found = rows(await raw(contextSql));
    if (found.length !== 1) fail("Exactly one original context required");
    const text = own(found[0], "context_utf8");
    if (typeof text !== "string") fail("Original context TEXT required");
    const c = JSON.parse(text);
    if (!c || typeof c !== "object" || Array.isArray(c)) fail("Original context required");
    const oid = value => typeof value === "string" && /^[1-9][0-9]{0,9}(?![\s\S])/.test(value) && BigInt(value) <= 4294967295n;
    if (!oid(c.database_oid) || !oid(c.control_oid) || !Number.isSafeInteger(c.backend_pid) || c.backend_pid <= 0
        || typeof c.transaction_id !== "string" || !/^[1-9][0-9]{0,18}(?![\s\S])/.test(c.transaction_id)
        || BigInt(c.transaction_id) > 9223372036854775807n
        || c.actor !== "supabase_admin" || c.session_actor !== c.actor || c.database_owner !== "postgres"
        || c.dr_owner !== "postgres" || c.control_owner !== c.actor || c.read_only !== "off" || c.isolation !== "repeatable read"
        || c.replication !== "origin" || c.row_security !== "off" || c.search_path !== "pg_catalog, pg_temp"
        || c.first_schema !== "pg_catalog" || c.held_fences !== 2 || c.control_count !== 1 || c.generation !== generation
        || typeof c.control_utf8 !== "string") fail("Required original paused native context unavailable");
    const control = JSON.parse(c.control_utf8);
    if (!control || control.singleton !== true || control.state !== "DATABASE_RESTORED" || control.mutations_paused !== true
        || typeof control.restore_id !== "string" || control.restore_id.length !== 36
        || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(control.restore_id)
        || typeof control.archive_digest !== "string" || control.archive_digest.length !== 64
        || !/^[0-9a-f]{64}$/.test(control.archive_digest)) fail("Exact original paused control required");
    if (originalContext !== undefined && text !== originalContext) fail("Original context/control changed");
    return text;
  };
  originalContext = await context();
  await context(); // Different actual reads must retain the original xid.
  const read = async (sql, params = []) => {
    await context();
    const found = rows(await raw(sql, params));
    await context();
    return found;
  };
  const tables = ["public.device_auth_credentials", "public.device_auth_enrollment_codes", "public.ops_manager_trusted_devices",
    "public.ops_manager_enrollment_codes", "public.ops_manager_push_devices", "auth.sessions"];
  const availability = async () => {
    const oids = [];
    for (const table of tables) {
      const found = await read("select pg_catalog.to_regclass($1)::pg_catalog.oid::pg_catalog.text relation_oid", [table]);
      if (found.length !== 1) fail("Exactly one required-target availability result required");
      const oid = own(found[0], "relation_oid");
      if (oid !== null && (typeof oid !== "string" || !/^[1-9][0-9]{0,9}(?![\s\S])/.test(oid)
          || BigInt(oid) > 4294967295n)) fail("Original target availability is unsupported");
      oids.push(oid);
    }
    return oids;
  };
  const snapshot = async () => {
    // Preflight ALL six before any raw-table SELECT. Absence is null, never
    // an empty rowset/count, and never repaired by this owning case.
    const available = await availability();
    const sets = [];
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i], relation_oid = available[i];
      if (relation_oid === null) {
        sets.push({ identity: table, relation_oid: null, rows: null });
        continue;
      }
      // Fixed test-owned selection only; full raw JSON TEXT, duplicate rows
      // retained, deterministic C ordering, no JS DATA reserialization.
      const found = await read(`select pg_catalog.row_to_json(r)::text original_row from ONLY ${table} r
        order by pg_catalog.row_to_json(r)::text collate "C"`);
      sets.push({ identity: table, relation_oid, rows: found.map(row => {
        const text = own(row, "original_row");
        if (typeof text !== "string") fail("Complete original target row TEXT required");
        return text;
      }) });
    }
    const after = await availability();
    if (after.some((oid, i) => oid !== available[i])) fail("Original target availability changed across snapshot");
    return sets;
  };
  const same = (a, b) => a.length === b.length && a.every((set, i) => set.identity === b[i].identity
    && set.relation_oid === b[i].relation_oid && (set.rows === null || b[i].rows === null
      ? set.rows === null && b[i].rows === null
      : set.rows.length === b[i].rows.length && set.rows.every((text, j) => text === b[i].rows[j])));
  const missingTargets = sets => sets.filter(set => set.rows === null).map(set => set.identity);
  const firstNativeSqlError = error => {
    const visited = new Set();
    const visit = value => {
      if (!value || typeof value !== "object" || isProxy(value) || visited.has(value)) return null;
      visited.add(value);
      if (value instanceof unadmittedDatabaseError) return value;
      const cause = Object.getOwnPropertyDescriptor(value, "cause");
      if (cause && Object.hasOwn(cause, "value")) { const found = visit(cause.value); if (found) return found; }
      const errors = Object.getOwnPropertyDescriptor(value, "errors");
      if (errors && Object.hasOwn(errors, "value") && Array.isArray(errors.value) && !isProxy(errors.value))
        for (const item of dense(errors.value)) { const found = visit(item); if (found) return found; }
      return null;
    };
    return visit(error);
  };
  let attemptedSavepoint = false, before, calls = 0, refused = false, refusal, failed = false, failure;
  let restored = false, released = false, after;
  let missing = [], beforeRollback = "NOT_REACHED";
  const cleanup = [];
  try {
    attemptedSavepoint = true;
    await raw("SAVEPOINT restored_authority_unadmitted_case");
    before = await snapshot();
    missing = missingTargets(before);
    if (missing.length === 0) {
      const guard = await read(`select count(*)::int guards from pg_catalog.pg_trigger t
      where t.tgrelid='public.device_auth_credentials'::pg_catalog.regclass and not t.tgisinternal
        and t.tgname='custodial_disaster_restore_mutation_fence' and t.tgenabled='O' and t.tgtype=62
        and t.tgfoid='custodial_dr.guard_application_mutation()'::pg_catalog.regprocedure
        and t.tgqual is null and t.tgnargs=0`);
      if (guard.length !== 1 || own(guard[0], "guards") !== 1) fail("Original first-UPDATE ORIGIN application guard required");
    }
    calls++;
    try { await invalidateRestoredAuthority(db, { generation }); }
    catch (error) { refused = true; refusal = error; }
    if (!refused) fail("Unadmitted invalidation unexpectedly succeeded");
    if (missing.length !== 0) {
      // The actual helper's fixed ALL-target preflight precedes every write.
      // This is a different negative outcome, not first-UPDATE guard evidence.
      if (firstNativeSqlError(refusal) !== null || own(refusal, "code") !== "RESTORE_AUTHORITY_TARGET_UNAVAILABLE"
          || own(refusal, "message") !== "RESTORE_AUTHORITY_TARGET_UNAVAILABLE")
        fail("Expected original missing-required-target preflight refusal unavailable");
      native(); // Missing-target refusal must leave the actual transaction T.
      const unchanged = await snapshot();
      if (!same(before, unchanged)) fail("Missing-target refusal changed original availability/raw rowsets");
      beforeRollback = "RAW_AVAILABLE_ROWS_CONTROL_AND_ABSENCE_IDENTICAL";
    } else {
      const first = firstNativeSqlError(refusal);
      if (!first || own(first, "code") !== "55000"
        || own(first, "message") !== "disaster recovery is in progress; application mutations are paused"
        || typeof own(first, "where") !== "string"
        || !/\b(?:custodial_dr\.)?acquire_application_mutation_fence\(\)/.test(own(first, "where")))
        fail("Expected original paused first-UPDATE SQL guard refusal unavailable");
      if (own(db, "_txStatus") !== "E") fail("Expected native SQL abort unavailable");
      // SQL abort makes a pre-rollback no-effects observation unavailable.
      beforeRollback = "UNAVAILABLE_SQL_TRANSACTION_ABORTED";
    }
  } catch (error) { failed = true; failure = error; }
  finally {
    if (attemptedSavepoint) {
      try { await raw("ROLLBACK TO SAVEPOINT restored_authority_unadmitted_case", [], true); restored = true; }
      catch (error) { cleanup.push(error); }
      try { await raw("RELEASE SAVEPOINT restored_authority_unadmitted_case", [], true); released = true; }
      catch (error) { cleanup.push(error); }
      if (restored && released && before) try {
        after = await snapshot();
        if (!same(before, after)) fail("Original authority availability/raw rowsets differ after own rollback");
        await context();
      } catch (error) { cleanup.push(error); }
    }
  }
  if (failed || cleanup.length) {
    const errors = [...(refused ? [refusal] : []), ...(failed && failure !== refusal ? [failure] : []), ...cleanup];
    throw new AggregateError(errors, "Restored authority unadmitted case failed; original cause retained", {
      cause: refused ? refusal : failed ? failure : cleanup[0],
    });
  }
  if (calls !== 1 || !restored || !released || !after) fail("Own refusal/rollback verification incomplete");
  return Object.freeze({ case: "RESTORED_AUTHORITY_UNADMITTED", helper_calls: calls,
    outcome: missing.length ? "MISSING_REQUIRED_TARGET_REFUSED" : "FIRST_UPDATE_GUARD_REFUSED",
    sqlstate: missing.length ? null : "55000", missing_identifiers: Object.freeze(missing.slice()),
    first_update_guard_test: missing.length ? "NOT_RUN" : "EXPECTED_REFUSAL", first_update_guard_refused: missing.length === 0,
    original_target_sets: 6, available_target_sets: 6 - missing.length,
    after_own_rollback: missing.length ? "RAW_AVAILABLE_ROWS_CONTROL_AND_ABSENCE_IDENTICAL" : "RAW_ROWS_AND_CONTROL_IDENTICAL",
    before_rollback: beforeRollback, caller_transaction_owned: false, effect_authority: false, full_platform_or_effect_proof: false });
}

// Populated authority qualification is fixture DATA only. Main supplies the
// existing native transaction/principals, captures a NEW archive, and separately
// runs the real import/effect/COMMIT. These members cannot admit those effects.
// Main explicitly rebound the cumulative fixture after reviewing b1a's six
// unchanged transforms, dependent manager order and immutable native time.
const sixTargetSqlSha256 = "94dba7d35b977e4b8ccd936b8c676eebc6d1ed7cc8fbad434c1348f9de780656";
const sixTargetConnection = pg.Connection;
const sixTargetConnectionPrototype = sixTargetConnection.prototype;
const sixTargetConnect = unadmittedPrototype.connect;
const sixTargetSocketWrite = Socket.prototype.write;
const sixTargetDefinitions = Object.freeze([
  ["public.device_auth_credentials", "credential_id", ["revoked_at", "revoked_reason"], "t.revoked_at is not null and pg_catalog.isfinite(t.revoked_at) and t.revoked_reason=$2", "o.revoked_at is null and o.revoked_reason is null"],
  ["public.device_auth_enrollment_codes", "enrollment_id", ["revoked_at"], "t.revoked_at is not null and pg_catalog.isfinite(t.revoked_at)", "o.revoked_at is null"],
  ["public.ops_manager_trusted_devices", "credential_id", ["revoked_at", "revoked_reason"], "t.revoked_at is not null and pg_catalog.isfinite(t.revoked_at) and t.revoked_reason=$2", "o.revoked_at is null and o.revoked_reason is null"],
  ["public.ops_manager_enrollment_codes", "id", ["status", "revoked_at", "revoked_reason"], "t.status='revoked' and t.revoked_at is not null and pg_catalog.isfinite(t.revoked_at) and t.revoked_reason=$2", "o.status='active' and o.revoked_at is null and o.revoked_reason is null"],
  ["public.ops_manager_push_devices", "push_device_id", ["enabled", "revoked_at"], "t.enabled=false and t.revoked_at is not null and pg_catalog.isfinite(t.revoked_at)", "o.enabled=true and o.revoked_at is null"],
  ["auth.sessions", "id", [], "false", "false"],
].map(([table, key, changed, predicate, originalPredicate]) => Object.freeze({ table, key, changed: Object.freeze(changed), predicate, originalPredicate })));
const sixTargetPreserved = Object.freeze([
  "custodial_release_identity.group_original_creations",
  "custodial_release_identity.employee_message_original_outcomes", "public.msg_messages",
]);
const sixTargetFail = message => { throw new Error(message); };
const sixTargetOwn = (value, key) => {
  if (!value || typeof value !== "object" || isProxy(value)) sixTargetFail("Original fixture own DATA required");
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) sixTargetFail("Original fixture own DATA required");
  return descriptor.value;
};
const sixTargetClosed = (value, keys) => {
  if (!value || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== keys.length) sixTargetFail("Closed original fixture DATA required");
  return keys.map(key => sixTargetOwn(value, key));
};
const sixTargetArray = value => {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype
      || Reflect.ownKeys(value).length !== value.length + 1) sixTargetFail("Dense original fixture DATA required");
  return Array.from({ length: value.length }, (_, i) => sixTargetOwn(value, String(i)));
};
const sixTargetFreeze = value => {
  if (value && typeof value === "object") { for (const child of Object.values(value)) sixTargetFreeze(child); Object.freeze(value); }
  return value;
};
const sixTargetUuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/.test(value);
const sixTargetGeneration = value => typeof value === "string" && /^[1-9][0-9]{0,18}(?![\s\S])/.test(value) && BigInt(value) <= 9223372036854775807n;

async function sixTargetFixturePort(db, mode) {
  let connection, stream;
  const native = (aborted = false) => {
    if (!db || isProxy(db) || pg.Client !== unadmittedClient || pg.Connection !== sixTargetConnection
        || Object.getPrototypeOf(db) !== unadmittedPrototype || unadmittedPrototype.query !== unadmittedQuery
        || unadmittedPrototype.connect !== sixTargetConnect || Object.hasOwn(db, "query") || Object.hasOwn(db, "connect")
        || sixTargetOwn(db, "_connected") !== true || sixTargetOwn(db, "_ending") !== false
        || sixTargetOwn(db, "_ended") !== false || sixTargetOwn(db, "_queryable") !== true
        || !["T", ...(aborted ? ["E"] : [])].includes(sixTargetOwn(db, "_txStatus"))
        || sixTargetOwn(db, "readyForQuery") !== true || sixTargetArray(sixTargetOwn(db, "_queryQueue")).length
        || ![null, undefined].includes(sixTargetOwn(db, "_activeQuery"))) sixTargetFail("Original started native fixture transaction required");
    const c = sixTargetOwn(db, "connection"), s = sixTargetOwn(c, "stream");
    if (isProxy(c) || Object.getPrototypeOf(c) !== sixTargetConnectionPrototype
        || isProxy(s) || Object.getPrototypeOf(s) !== Socket.prototype || Object.hasOwn(s, "write")
        || Socket.prototype.write !== sixTargetSocketWrite || s.destroyed || !s.readable || !s.writable
        || (connection && (connection !== c || stream !== s))) sixTargetFail("Original native fixture transport changed");
    connection = c; stream = s;
  };
  native();
  const raw = async (sql, params = [], aborted = false) => {
    native(aborted);
    let failed = false, failure, result;
    try { result = await Reflect.apply(unadmittedQuery, db, [sql, params]); }
    catch (error) { failed = true; failure = error; }
    try { native(true); } catch (error) {
      if (failed) throw new AggregateError([failure, error], "Fixture query/native identity failed", { cause: failure });
      throw error;
    }
    if (failed) throw failure;
    return result;
  };
  const rows = result => {
    const values = sixTargetArray(sixTargetOwn(result, "rows"));
    if (sixTargetOwn(result, "command") !== "SELECT" || sixTargetOwn(result, "rowCount") !== values.length)
      sixTargetFail("Complete actual fixture SELECT required");
    return values;
  };
  let originalContext;
  const context = async () => {
    const found = rows(await raw(`select pg_catalog.row_to_json(c)::text context_utf8 from (select
      (select oid::text from pg_catalog.pg_database where datname=pg_catalog.current_database()) database_oid,
      pg_catalog.pg_backend_pid() pid,pg_catalog.txid_current()::text xid,current_user actor,session_user session_actor,
      (select pg_catalog.pg_get_userbyid(datdba) from pg_catalog.pg_database where datname=pg_catalog.current_database()) db_owner,
      pg_catalog.current_setting('transaction_read_only') read_only,pg_catalog.current_setting('transaction_isolation') isolation,
      pg_catalog.current_setting('session_replication_role') replication,pg_catalog.current_setting('row_security') row_security,
      pg_catalog.current_setting('search_path') search_path,(pg_catalog.current_schemas(true))[1] first_schema,
      pg_catalog.current_setting('TimeZone') timezone,pg_catalog.current_setting('DateStyle') datestyle,
      (select count(*)::int from pg_catalog.unnest(array['memphis-zoo-application-mutation-admission','memphis-zoo-application-mutation-fence']) f(name)
        where exists(select 1 from pg_catalog.pg_locks l where l.locktype='advisory' and l.pid=pg_catalog.pg_backend_pid()
          and l.database=(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database()) and l.granted
          and l.mode='ExclusiveLock' and l.classid=((pg_catalog.hashtextextended(f.name,0)>>32)&4294967295)::oid
          and l.objid=(pg_catalog.hashtextextended(f.name,0)&4294967295)::oid and l.objsubid=1)) fences,
      (select count(*)::int from custodial_dr.restore_control) control_count,
      (select pg_catalog.row_to_json(r)::text from custodial_dr.restore_control r where singleton) control_utf8
    ) c`));
    if (found.length !== 1) sixTargetFail("Single original fixture context required");
    const text = sixTargetOwn(found[0], "context_utf8");
    if (typeof text !== "string") sixTargetFail("Raw original fixture context required");
    const c = JSON.parse(text), control = typeof c.control_utf8 === "string" ? JSON.parse(c.control_utf8) : null;
    if (c.actor !== "supabase_admin" || c.session_actor !== c.actor || c.db_owner !== "postgres"
        || c.isolation !== "repeatable read" || (mode === "populate" ? c.read_only !== "off" : !["on", "off"].includes(c.read_only))
        || c.replication !== "origin" || c.row_security !== "off" || c.search_path !== "pg_catalog, pg_temp"
        || c.first_schema !== "pg_catalog" || c.fences !== 2 || c.control_count !== 1 || !control
        || (mode === "populate" && (control.state !== "READY" || control.mutations_paused !== false
          || String(control.authority_generation) !== "0" || control.restore_id !== null || control.archive_digest !== null))
        || (mode !== "populate" && (control.state !== "DATABASE_RESTORED" || control.mutations_paused !== true)))
      sixTargetFail("Caller-owned original fixture phase/principal/RR/two fences required");
    if (originalContext !== undefined && originalContext !== text) sixTargetFail("Original fixture transaction/control changed");
    originalContext = text;
    return { c, control };
  };
  const query = async (sql, params = []) => {
    await context();
    const result = await raw(sql, params);
    await context();
    return rows(result);
  };
  await context(); await context(); // Autocommit/new xid cannot imitate a transaction.
  return { raw, rows, query, context };
}

async function sixTargetRawImage(port, table) {
  // table is selected ONLY from the two private fixed lists above.
  const data = await port.query(`select pg_catalog.row_to_json(t)::text row_utf8 from only ${table} t order by pg_catalog.row_to_json(t)::text collate "C"`);
  return data.map(row => {
    const text = sixTargetOwn(row, "row_utf8");
    if (typeof text !== "string") sixTargetFail("Exact original row TEXT required");
    return text;
  });
}
async function sixTargetColumnImage(port, table) {
  const result = await port.query(`select pg_catalog.json_agg(pg_catalog.json_build_array(a.attname,
      pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated,a.attidentity) order by a.attnum)::text columns_utf8
    from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
    where c.oid=pg_catalog.to_regclass($1) and c.relkind='r' and not c.relispartition
      and a.attnum>0 and not a.attisdropped`, [table]);
  if (result.length !== 1 || typeof sixTargetOwn(result[0], "columns_utf8") !== "string")
    sixTargetFail("Complete actual fixture relation/columns required");
  return sixTargetOwn(result[0], "columns_utf8");
}

export async function populateRestoredAuthoritySixTargetOriginal(db, options) {
  const [employeeDeviceId, managerId, employeeUserId, groupThreadId] = sixTargetClosed(options,
    ["employeeDeviceId", "managerId", "employeeUserId", "groupThreadId"]);
  if (![employeeDeviceId, managerId, employeeUserId, groupThreadId].every(sixTargetUuid)) sixTargetFail("Original synthetic principal UUIDs required");
  const port = await sixTargetFixturePort(db, "populate");
  const counts = await port.query(`select (select count(*)::text from custodial_dr.restore_manifests) manifests,
    (select count(*)::text from custodial_dr.restore_events) events,
    (select count(*)::text from public.devices where id=$1::uuid and active=true and pg_catalog.left(device_id,23)='UNIT_AUTHORITY_FIXTURE_') devices,
    (select count(*)::text from public.ops_manager_managers where manager_id=$2::uuid and active=true and revoked_at is null
      and not is_system_principal and pg_catalog.left(display_name,23)='UNIT_AUTHORITY_FIXTURE_' and contact_label like '%@%.invalid'
      and 'OPS_MANAGER'=any(roles)) managers,
    (select count(*)::text from auth.sessions) sessions,
    (select count(*)::text from auth.sessions s join auth.users u on u.id=s.user_id where u.email like '%@%.invalid') synthetic_sessions,
    (select count(*)::text from public.devices d join public.employees e on e.id=d.assigned_employee_id
      join public.msg_users u on u.employee_id=e.id join public.msg_device_assignments a on a.device_identifier=d.device_id and a.msg_user_id=u.id
      where d.id=$1::uuid and e.active and e.role='staff' and u.id=$3::uuid and u.is_active and u.role='employee' and a.is_active) assigned_users,
    (select count(*)::text from public.msg_threads t join custodial_release_identity.group_original_creations g on g.group_uuid=t.id
      join public.msg_thread_participants p on p.thread_id=t.id and p.user_id=$3::uuid and p.left_at is null
      where t.id=$4::uuid and t.thread_type='group' and t.is_active and t.original_group_creation=g.original_tuple) original_groups`,
    [employeeDeviceId, managerId, employeeUserId, groupThreadId]);
  assert.equal(counts.length, 1);
  assert.deepEqual(counts[0], { manifests: "0", events: "0", devices: "1", managers: "1", sessions: "1", synthetic_sessions: "1", assigned_users: "1", original_groups: "1" },
    "Source-created synthetic principals/current assignment/original group and one vendor Auth session required");
  for (const { table } of sixTargetDefinitions.slice(0, 5)) assert.deepEqual(await sixTargetRawImage(port, table), [], "Original five target sets must be empty, never adopted/replaced");
  const privateRows = {};
  for (const table of sixTargetPreserved) privateRows[table] = await sixTargetRawImage(port, table);
  assert.ok(privateRows[sixTargetPreserved[0]].length > 0, "Existing Source-created group original required");
  const authRows = await sixTargetRawImage(port, "auth.sessions");
  let savepoint = false;
  try {
    await port.raw("savepoint authority_populated_fixture"); savepoint = true;
    const ids = await port.query(`select pg_catalog.gen_random_uuid()::text employee_credential,pg_catalog.gen_random_uuid()::text manager_credential,
      pg_catalog.gen_random_uuid()::text enrollment_operation,pg_catalog.gen_random_uuid()::text message_identity,
      (pg_catalog.clock_timestamp()+interval '1 day')::text credential_expires_at,
      (pg_catalog.clock_timestamp()+interval '25 minutes')::text resume_expires_at`);
    assert.equal(ids.length, 1);
    const { employee_credential: employeeCredential, manager_credential: managerCredential } = ids[0];
    const operationId = ids[0].enrollment_operation, clientMessageId = `UNIT_authority_fixture:${ids[0].message_identity}`;
    assert.ok([employeeCredential, managerCredential, operationId, ids[0].message_identity].every(sixTargetUuid));
    const actorRows = await port.query(`select d.device_id device_identifier,d.device_name,d.assignment_epoch::text assignment_epoch,
      e.id::text employee_id,e.employee_code,e.display_name from public.devices d join public.employees e on e.id=d.assigned_employee_id where d.id=$1::uuid`, [employeeDeviceId]);
    assert.equal(actorRows.length, 1);
    const actor = actorRows[0]; assert.ok(sixTargetUuid(actor.employee_id) && sixTargetGeneration(actor.assignment_epoch));
    const { custodialEmployeeAdminInternals: enrollment } = await import("../src/custodial-employee-admin.js");
    const { deviceCredentialInternals: credentials } = await import("../src/auth/device-credential-auth.js");
    // Public, deliberately non-secret UNIT hashes/tokens. No issuer, real key,
    // login, provider request or signature participates in this fixture setup.
    const unitEnv = Object.freeze({ DEVICE_CREDENTIAL_SECRET: "UNIT-only-public-six-target-enrollment-HMAC-20261017-not-production" });
    const unitCredentialSecret = "UNIT_only_public_employee_fixture_credential_20261017_not_real";
    const employeeHash = credentials.enrollmentCodeHash(employeeDeviceId, "12345678", unitEnv), managerHash = "2".repeat(64);
    const tokenHash = credentials.tokenHash(unitCredentialSecret, unitEnv);
    const issue = hash => port.query(`select enrollment_id::text from public.device_auth_issue_enrollment_code(
      $1::uuid,$2::text,'UNIT_AUTHORITY_FIXTURE@local.invalid',pg_catalog.now()+interval '1 day',
      '{"purpose":"employee_device_enrollment","fixture":"UNIT_AUTHORITY_FIXTURE.invalid"}'::jsonb)`, [employeeDeviceId, hash]);
    const firstCode = await issue(employeeHash); assert.equal(firstCode.length, 1);
    const candidate = { device_credential: `${employeeCredential}.${unitCredentialSecret}`, credential_id: employeeCredential,
      credential_expires_at: ids[0].credential_expires_at, device_id: actor.device_identifier, device_name: actor.device_name,
      employee: { id: actor.employee_id, employee_code: actor.employee_code, display_name: actor.display_name, role: "staff" } };
    const encrypted = enrollment.encryptEnrollmentResult(unitEnv, operationId, candidate);
    const { createHmac } = await import("node:crypto");
    const requestFingerprint = createHmac("sha256", unitEnv.DEVICE_CREDENTIAL_SECRET)
      .update(`custodial-enrollment-operation-request:enrollment:${employeeDeviceId}:legacy_manager_code:12345678`).digest("hex");
    const consumed = await port.query(`select public.device_auth_consume_enrollment_operation(
      $1::uuid,'enrollment',$2::uuid,$3::text,$4::text,$5::uuid,$6::text,'UNIT_AUTHORITY_FIXTURE employee',
      $7::timestamptz,$8::text,$9::text,$10::text,$11::timestamptz,$12::text,null::text,null::text,
      '{"fixture":"UNIT_AUTHORITY_FIXTURE.invalid","enrollment_flow":"enrollment"}'::jsonb)::text result_utf8`,
      [operationId, employeeDeviceId, employeeHash, requestFingerprint, employeeCredential, tokenHash, ids[0].credential_expires_at,
        encrypted.ciphertext, encrypted.iv, encrypted.authTag, ids[0].resume_expires_at, encrypted.encryptionVersion]);
    assert.equal(consumed.length, 1);
    const receipt = JSON.parse(sixTargetOwn(consumed[0], "result_utf8"));
    assert.equal(receipt.ok, true); assert.equal(receipt.credential_id, employeeCredential);
    assert.equal(receipt.operation_id, operationId); assert.equal(receipt.replayed, false); assert.equal(receipt.status, "committed");
    assert.deepEqual(enrollment.decryptEnrollmentResult(unitEnv, operationId, receipt), candidate);
    const confirmed = await port.query(`select public.device_auth_confirm_enrollment_operation($1::uuid,$2::uuid,$3::uuid,$4::text)::text result_utf8`,
      [operationId, employeeDeviceId, employeeCredential, tokenHash]);
    assert.equal(confirmed.length, 1);
    const confirmation = JSON.parse(confirmed[0].result_utf8);
    assert.equal(confirmation.ok, true); assert.equal(confirmation.status, "confirmed"); assert.equal(confirmation.replayed, false);
    assert.equal(confirmation.operation_id, operationId); assert.equal(confirmation.credential_id, employeeCredential); assert.equal(confirmation.credential_active, true);
    const currentActor = await port.query(`select count(*)::text n from public.devices d join public.device_auth_credentials c on c.device_id=d.id
      join public.employees e on e.id=d.assigned_employee_id join public.msg_users u on u.employee_id=e.id
      join public.msg_device_assignments a on a.device_identifier=d.device_id and a.msg_user_id=u.id
      where d.id=$1::uuid and d.active and e.active and u.is_active and u.role='employee' and a.is_active
        and u.id=$2::uuid and c.credential_id=$3::uuid and c.token_hash=$4 and c.confirmed_at is not null
        and c.revoked_at is null and c.expires_at>pg_catalog.clock_timestamp()`, [employeeDeviceId, employeeUserId, employeeCredential, tokenHash]);
    assert.deepEqual(currentActor, [{ n: "1" }]);
    const send = { device_id: actor.device_identifier, expected_employee_id: actor.employee_id, expected_credential_id: employeeCredential,
      expected_assignment_epoch: actor.assignment_epoch, user_id: employeeUserId, thread_id: groupThreadId, credential_token_hash: tokenHash,
      body: "UNIT authority restore fixture only", message_type: "text", metadata_json: {}, client_message_id: clientMessageId };
    const sent = await port.query("select public.app_apply_operational_command('employee_message_original_send',$1::jsonb)::text result_utf8", [JSON.stringify(send)]);
    assert.equal(sent.length, 1);
    const originalMessage = JSON.parse(sent[0].result_utf8);
    assert.equal(originalMessage.state, "ORIGINAL_TRANSACTION_OUTCOME_RECORDED"); assert.equal(originalMessage.original_outcome_recorded, true);
    assert.equal(originalMessage.original_actor.credential_id, employeeCredential); assert.equal(originalMessage.original_actor.employee_id, actor.employee_id);
    assert.equal(originalMessage.original_actor.assignment_epoch, actor.assignment_epoch); assert.equal(originalMessage.original_actor.user_id, employeeUserId);
    assert.equal(originalMessage.original_actor.device_pk, employeeDeviceId); assert.equal(originalMessage.original_actor.device_id, actor.device_identifier);
    const { credential_token_hash: omittedToken, ...publicSend } = send;
    assert.equal(omittedToken, tokenHash); assert.deepEqual(originalMessage.original_request, publicSend);
    assert.equal(originalMessage.result.body, send.body); assert.ok(sixTargetUuid(originalMessage.result.id));
    const recorded = await port.query(`select count(*)::text n from custodial_release_identity.employee_message_original_outcomes
      where original_command='employee_message_original_send' and original_request=$1::jsonb and outcome_json=$2::jsonb`,
      [JSON.stringify(send), sent[0].result_utf8]);
    assert.deepEqual(recorded, [{ n: "1" }]);
    const secondCode = await issue("4".repeat(64)); assert.equal(secondCode.length, 1);
    // Exact normal shared-access-auth store.enroll guarded INSERT shape.
    assert.equal((await port.query(`with inserted as (insert into public.ops_manager_trusted_devices
      (credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at,metadata_json)
      values($1::uuid,'UNIT_AUTHORITY_FIXTURE.invalid','UNIT_AUTHORITY_FIXTURE manager',$2,'full_access',$3::uuid,
        pg_catalog.now()+interval '1 day','{"fixture":"UNIT_AUTHORITY_FIXTURE.invalid"}'::jsonb)
      returning credential_id) select credential_id::text from inserted`, [managerCredential, managerHash, managerId])).length, 1);
    // Exact normal shared-access-auth store.createManagerEnrollmentCode shape.
    assert.equal((await port.query(`with inserted as (insert into public.ops_manager_enrollment_codes
      (manager_id,code_hash,role_snapshot,created_by_manager_id,created_by_credential_id,expires_at,max_attempts,metadata_json)
      values($1::uuid,$2,'OPS_MANAGER',$1::uuid,$3::uuid,pg_catalog.now()+interval '30 minutes',5,
        '{"fixture":"UNIT_AUTHORITY_FIXTURE.invalid"}'::jsonb) returning id) select id::text from inserted`, [managerId, "5".repeat(64), managerCredential])).length, 1);
    // Normal registration fields; the real owner/update triggers still run.
    assert.equal((await port.query(`with inserted as (insert into public.ops_manager_push_devices
      (credential_id,manager_id,device_id,provider,platform,fcm_token,enabled,app_version,app_build,
        last_registered_at,last_seen_at,revoked_at,last_error,metadata_json)
      values($1::uuid,$2::uuid,'UNIT_AUTHORITY_FIXTURE.invalid','fcm','android',
        'UNIT-only-not-a-real-fcm-token.invalid',true,'UNIT','UNIT',pg_catalog.now(),pg_catalog.now(),null,null,
        '{"registered_by":"manager_app","notification_defaults":"messages_on_events_locations_off","fixture":"UNIT_AUTHORITY_FIXTURE.invalid"}'::jsonb)
      returning push_device_id) select push_device_id::text from inserted`, [managerCredential, managerId])).length, 1);
    const tables = {};
    for (const { table } of sixTargetDefinitions) tables[table] = { columns_utf8: await sixTargetColumnImage(port, table), rows: await sixTargetRawImage(port, table) };
    assert.deepEqual(Object.values(tables).map(image => image.rows.length), [1, 2, 1, 1, 1, 1]);
    assert.deepEqual(tables["auth.sessions"].rows, authRows, "Original vendor session changed during application setup");
    for (let i = 0; i < sixTargetPreserved.length; i++) {
      const table = sixTargetPreserved[i], finalRows = await sixTargetRawImage(port, table);
      for (const oldRow of privateRows[table]) assert.ok(finalRows.includes(oldRow), "Preexisting protected row changed during intended fixture setup");
      assert.equal(finalRows.length, privateRows[table].length + (i === 0 ? 0 : 1), "Exactly one intended new employee outcome/message required");
      privateRows[table] = finalRows;
    }
    assert.ok(privateRows[sixTargetPreserved[0]].length > 0 && privateRows[sixTargetPreserved[1]].length > 0);
    await port.context();
    await port.raw("release savepoint authority_populated_fixture"); savepoint = false;
    await port.context();
    return sixTargetFreeze({ source_sql_sha256: sixTargetSqlSha256, tables, preserved_rows: privateRows,
      principals: { employee_device_id: employeeDeviceId, employee_credential_id: employeeCredential,
        manager_id: managerId, manager_credential_id: managerCredential, employee_user_id: employeeUserId,
        group_thread_id: groupThreadId, enrollment_operation_id: operationId, message_id: originalMessage.result.id },
      expected_effect_counts: ["1", "2", "1", "1", "1", "1"], metadata_only: true });
  } catch (failure) {
    const cleanup = [];
    if (savepoint) {
      try { await port.raw("rollback to savepoint authority_populated_fixture", [], true); } catch (error) { cleanup.push(error); }
      try { await port.raw("release savepoint authority_populated_fixture", [], true); } catch (error) { cleanup.push(error); }
      try { await port.context(); } catch (error) { cleanup.push(error); }
    }
    if (cleanup.length) throw new AggregateError([failure, ...cleanup], "Fixture setup failed; caller transaction retained", { cause: failure });
    throw failure;
  }
}

function sixTargetExpectedImageSql(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 5) sixTargetFail("Fixed revocation image index required");
  const { table, key, changed, predicate, originalPredicate } = sixTargetDefinitions[index];
  // The pinned normal push trigger also sets updated_at=now(). The effect
  // timestamp now exists in the pinned Source scope, but this fixture does
  // not own the shipping private ancestry/readback. Explicitly leave ONE field
  // unresolved, and never turn a current row/caller timestamp into its oracle.
  const observedFields = index === 4 ? [...changed, "updated_at"] : changed;
  const reset = observedFields.flatMap(name => [`'${name}'`, `o.${name}`]).join(",");
  return `with originals as (select (pg_catalog.json_populate_record(null::${table},raw::json)).*
    from pg_catalog.unnest($1::text[]) x(raw))
    select (select count(*)::text from only ${table}) actual_count,
      (select count(*)::text from originals) original_count,count(*)::text paired_count,
      count(distinct o.${key})::text original_keys,count(distinct t.${key})::text actual_keys,
      pg_catalog.bool_and(${originalPredicate} and ${predicate} and pg_catalog.row_to_json(o)::text =
        pg_catalog.row_to_json(pg_catalog.json_populate_record(t,pg_catalog.json_build_object(${reset})))::text) ${index === 4 ? "non_timestamp_image" : "exact_image"}
    from originals o join only ${table} t on t.${key}=o.${key}`;
}

export async function assertRestoredAuthoritySixTargetImages(db, original, options) {
  const [generation] = sixTargetClosed(options, ["generation"]);
  if (!sixTargetGeneration(generation)) sixTargetFail("Canonical original authority generation TEXT required");
  const [sourceHash, tables, privateRows, principals, expectedCounts, metadataOnly] = sixTargetClosed(original,
    ["source_sql_sha256", "tables", "preserved_rows", "principals", "expected_effect_counts", "metadata_only"]);
  assert.equal(sourceHash, sixTargetSqlSha256); assert.equal(metadataOnly, true);
  const images = sixTargetClosed(tables, sixTargetDefinitions.map(d => d.table));
  const preserved = sixTargetClosed(privateRows, sixTargetPreserved);
  sixTargetClosed(principals, ["employee_device_id", "employee_credential_id", "manager_id", "manager_credential_id", "employee_user_id",
    "group_thread_id", "enrollment_operation_id", "message_id"]).forEach(id => assert.ok(sixTargetUuid(id)));
  const counts = sixTargetArray(expectedCounts);
  assert.deepEqual(counts, ["1", "2", "1", "1", "1", "1"]);
  const copy = images.map((image, i) => {
    const [columns, rawRows] = sixTargetClosed(image, ["columns_utf8", "rows"]);
    const rows = sixTargetArray(rawRows);
    assert.ok(typeof columns === "string" && rows.every(row => typeof row === "string"));
    assert.equal(String(rows.length), counts[i]);
    return { columns, rows };
  });
  const privateCopy = preserved.map(value => { const rows = sixTargetArray(value); assert.ok(rows.every(row => typeof row === "string")); return rows; });
  const port = await sixTargetFixturePort(db, "images");
  const { control } = await port.context();
  // Read raw control generation as TEXT in PostgreSQL, not through JSON Number.
  const current = await port.query("select authority_generation::text generation from custodial_dr.restore_control where singleton");
  assert.equal(current.length, 1); assert.equal(current[0].generation, generation);
  assert.ok(sixTargetUuid(control.restore_id) && typeof control.archive_digest === "string" && control.archive_digest.length === 64);
  for (let i = 0; i < sixTargetDefinitions.length; i++) {
    const { table } = sixTargetDefinitions[i], image = copy[i];
    assert.equal(await sixTargetColumnImage(port, table), image.columns, "Original complete column/type membership changed");
    if (i === 5) { assert.deepEqual(await sixTargetRawImage(port, table), [], "Exactly one original Auth session must be removed"); continue; }
    // Restore only the specified original revocation fields INTO the actual row
    // before comparing PostgreSQL row JSON TEXT. No JS DATA/Date/Number
    // roundtrip, no JSONB Set/dedup. Push updated_at is EXPLICITLY unresolved,
    // never a silently waived or falsely unchanged timestamp requirement.
    const found = await port.query(sixTargetExpectedImageSql(i), [image.rows, `disaster_restore_generation_${generation}`]);
    assert.equal(found.length, 1);
    assert.deepEqual(found[0], { actual_count: counts[i], original_count: counts[i], paired_count: counts[i],
      original_keys: counts[i], actual_keys: counts[i], [i === 4 ? "non_timestamp_image" : "exact_image"]: true },
      `Fixed revocation/membership/unchanged full row differs for ${table}`);
  }
  for (let i = 0; i < sixTargetPreserved.length; i++) assert.deepEqual(await sixTargetRawImage(port, sixTargetPreserved[i]), privateCopy[i], "Protected original/message rows changed during authority effects");
  await port.context();
  return sixTargetFreeze({ outcome: "PUSH_EFFECT_TRANSACTION_TIMESTAMP_UNRESOLVED", effect_counts: counts,
    all_six_exact_images: false, unresolved_fields: ["public.ops_manager_push_devices.updated_at"],
    required_prerequisite: "DURABLE_SOURCE_BOUND_ACTUAL_EFFECT_TRANSACTION_TIMESTAMP",
    metadata_only: true, resume: false, retry: false, reimport: false, complete_restore: false });
}

// Imports never run selected or default historical tests, or process.exit.
const mutationGateDirect = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (mutationGateDirect) {
if (process.argv.includes("--authority-populated-fixture-only")) {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const source = readFileSync(new URL("../proposals/immutable-original-authority-reconciliation.sql", import.meta.url), "utf8");
  const notifications = readFileSync(new URL("../supabase/migrations/20260721203000_manager_mobile_notifications.sql", import.meta.url), "utf8");
  const ownerOnly = process.argv.includes("--owner-boundary-only"), inputsOnly = process.argv.includes("--input-refusals-only"),
    imagesOnly = process.argv.includes("--image-query-only"), setupOnly = process.argv.includes("--enrollment-message-only"),
    timestampOnly = process.argv.includes("--push-timestamp-only");
  assert.ok([ownerOnly, inputsOnly, imagesOnly, setupOnly, timestampOnly].filter(Boolean).length <= 1);
  let sourceCases = 0, refusalCases = 0;
  if (!ownerOnly && !inputsOnly && !imagesOnly && !setupOnly && !timestampOnly) {
  assert.equal(createHash("sha256").update(source).digest("hex"), sixTargetSqlSha256); sourceCases++;
  assert.deepEqual(sixTargetDefinitions.map(({ table }) => table), ["public.device_auth_credentials", "public.device_auth_enrollment_codes",
    "public.ops_manager_trusted_devices", "public.ops_manager_enrollment_codes", "public.ops_manager_push_devices", "auth.sessions"]);
  sourceCases++;
  for (const { table, changed } of sixTargetDefinitions.slice(0, 5)) {
    const statement = source.match(new RegExp(`UPDATE ${table.replaceAll(".", "\\.")} SET ([^;]+);`));
    assert.ok(statement, "Pinned actual fixed UPDATE required");
    assert.deepEqual([...statement[1].matchAll(/(?:^|,)\s*([a-z_]+)=/g)].map(match => match[1]), changed);
    sourceCases++;
  }
  assert.ok(source.includes("DELETE FROM auth.sessions;")); sourceCases++;
  }
  // A real pending native dependency, never a reason to edit/disable the owner
  // trigger. The pinned successor now revokes push BEFORE its credential;
  // this fixture does not claim that populated native order has been proved.
  if (!inputsOnly && !imagesOnly && !setupOnly && !timestampOnly) {
  const ownerBody = notifications.slice(notifications.indexOf("create or replace function public.ops_manager_notification_validate_owner()"),
    notifications.indexOf("drop trigger if exists trg_ops_manager_notification_preferences_owner"));
  assert.ok(ownerBody.includes("revoked_at is null") && ownerBody.includes("expires_at>now()"));
  assert.ok(ownerBody.includes("errcode='23514'") || ownerBody.includes("errcode = '23514'")); sourceCases++;
  }
  if (!ownerOnly && !imagesOnly && !setupOnly && !timestampOnly) {
  const options = Object.freeze({ employeeDeviceId: "00000000-0000-4000-8000-000000000001", managerId: "00000000-0000-4000-8000-000000000002",
    employeeUserId: "00000000-0000-4000-8000-000000000003", groupThreadId: "00000000-0000-4000-8000-000000000004" });
  let queries = 0;
  const facade = { query() { queries++; throw new Error("must not query a facade"); } };
  await assert.rejects(populateRestoredAuthoritySixTargetOriginal(facade, options), /Original started native fixture transaction required/); refusalCases++;
  await assert.rejects(populateRestoredAuthoritySixTargetOriginal(new Proxy({}, {}), options), /Original started native fixture transaction required/); refusalCases++;
  const unstarted = new pg.Client({ host: "127.0.0.1", port: 1, database: "UNIT_never_connected" });
  try {
    await assert.rejects(populateRestoredAuthoritySixTargetOriginal(unstarted, options), /Original started native fixture transaction required/); refusalCases++;
  } finally { await unstarted.end(); }
  let reads = 0;
  const accessor = { ...options, get employeeDeviceId() { reads++; return options.employeeDeviceId; } };
  await assert.rejects(populateRestoredAuthoritySixTargetOriginal(facade, accessor), /Original fixture own DATA required/); refusalCases++;
  for (const bad of [null, {}, { ...options, override: true }, { ...options, employeeDeviceId: "real-device" },
    { ...options, managerId: new String(options.managerId) }]) {
    await assert.rejects(populateRestoredAuthoritySixTargetOriginal(facade, bad)); refusalCases++;
  }
  for (const generation of ["0", "01", 1, "1\n", "9223372036854775808", new String("1")]) {
    await assert.rejects(assertRestoredAuthoritySixTargetImages(facade, {}, { generation }), /Canonical original authority generation TEXT required/); refusalCases++;
  }
  await assert.rejects(assertRestoredAuthoritySixTargetImages(facade, {}, { generation: "1" }), /Closed original fixture DATA required/); refusalCases++;
  assert.equal(queries, 0); assert.equal(reads, 0);
  }
  if (imagesOnly || (!ownerOnly && !inputsOnly && !setupOnly && !timestampOnly)) {
    for (let i = 0; i < 5; i++) {
      const sql = sixTargetExpectedImageSql(i), d = sixTargetDefinitions[i];
      assert.ok(sql.includes(`from only ${d.table}`) && sql.includes(`on t.${d.key}=o.${d.key}`));
      assert.ok(sql.includes(`count(distinct o.${d.key})::text original_keys`) && sql.includes(`count(distinct t.${d.key})::text actual_keys`));
      assert.ok(sql.includes(d.originalPredicate) && sql.includes(d.predicate));
      const reset = sql.slice(sql.lastIndexOf("pg_catalog.json_build_object("));
      assert.deepEqual([...reset.matchAll(/'([a-z_]+)'/g)].map(match => match[1]), i === 4 ? [...d.changed, "updated_at"] : d.changed);
      assert.ok(!reset.includes("metadata_json") && !reset.includes("last_error"));
      sourceCases++;
    }
    for (const bad of [-1, 5, "0", null]) { assert.throws(() => sixTargetExpectedImageSql(bad), /Fixed revocation image index required/); refusalCases++; }
  }
  if (timestampOnly || (!ownerOnly && !inputsOnly && !imagesOnly && !setupOnly)) {
    const sql = sixTargetExpectedImageSql(4), reset = sql.slice(sql.lastIndexOf("pg_catalog.json_build_object("));
    assert.deepEqual([...reset.matchAll(/'([a-z_]+)'/g)].map(match => match[1]), ["enabled", "revoked_at", "updated_at"]); sourceCases++;
    assert.ok(sql.includes("non_timestamp_image") && !sql.includes(") exact_image")); sourceCases++;
    assert.ok(notifications.includes("new.updated_at:=now();")); sourceCases++;
    assert.ok(source.includes("'effect_transaction_started_at',pg_catalog.transaction_timestamp()")); sourceCases++;
    const checker = assertRestoredAuthoritySixTargetImages.toString();
    assert.ok(checker.includes('outcome: "PUSH_EFFECT_TRANSACTION_TIMESTAMP_UNRESOLVED"') && checker.includes("all_six_exact_images: false")); sourceCases++;
    await assert.rejects(assertRestoredAuthoritySixTargetImages(null, {}, { generation: "1", effectTimestamp: "2026-10-17T00:00:00Z" }), /Closed original fixture DATA required/); refusalCases++;
  }
  if (setupOnly || (!ownerOnly && !inputsOnly && !imagesOnly && !timestampOnly)) {
    const { custodialEmployeeAdminInternals: normal } = await import("../src/custodial-employee-admin.js");
    const { deviceCredentialInternals: credential } = await import("../src/auth/device-credential-auth.js");
    const env = Object.freeze({ DEVICE_CREDENTIAL_SECRET: "UNIT-only-public-six-target-enrollment-HMAC-20261017-not-production" });
    const operation = "00000000-0000-4000-8000-000000000010", candidate = { credential_id: operation, body: "UNIT authority restore fixture only" };
    const encrypted = normal.encryptEnrollmentResult(env, operation, candidate);
    assert.equal(encrypted.encryptionVersion, "aes-256-gcm.v1");
    assert.deepEqual(normal.decryptEnrollmentResult(env, operation, { encryption_version: encrypted.encryptionVersion,
      result_ciphertext: encrypted.ciphertext, result_iv: encrypted.iv, result_auth_tag: encrypted.authTag }), candidate); sourceCases++;
    assert.match(credential.enrollmentCodeHash(operation, "12345678", env), /^[a-f0-9]{64}$/);
    assert.match(credential.tokenHash("UNIT_only_public_employee_fixture_credential_20261017_not_real", env), /^[a-f0-9]{64}$/); sourceCases++;
    const body = populateRestoredAuthoritySixTargetOriginal.toString();
    assert.ok(body.indexOf("device_auth_consume_enrollment_operation(") < body.indexOf("device_auth_confirm_enrollment_operation("));
    assert.ok(body.indexOf("device_auth_confirm_enrollment_operation(") < body.indexOf("app_apply_operational_command('employee_message_original_send'"));
    assert.ok(!body.includes("set confirmed_at") && !body.includes("device_auth_consume_enrollment_code(")); sourceCases++;
    assert.ok(body.includes('privateRows[sixTargetPreserved[0]].length > 0, "Existing Source-created group original required"'));
    assert.ok(body.includes("privateRows[sixTargetPreserved[1]].length > 0")); sourceCases++;
    const valid = { employeeDeviceId: operation, managerId: operation, employeeUserId: operation, groupThreadId: operation };
    const real = new pg.Client({ host: "127.0.0.1", port: 1, database: "UNIT_never_connected" });
    try { await assert.rejects(populateRestoredAuthoritySixTargetOriginal(real, valid), /Original started native fixture transaction required/); refusalCases++; }
    finally { await real.end(); }
    for (const input of [{ employeeDeviceId: operation, managerId: operation }, { ...valid, employeeUserId: new String(operation) },
      { ...valid, groupThreadId: "foreign-thread" }]) {
      await assert.rejects(populateRestoredAuthoritySixTargetOriginal(null, input)); refusalCases++;
    }
  }
  console.log(JSON.stringify({ selected: "authority-populated-fixture-only", source_contract_cases: sourceCases,
    new_input_native_refusals: refusalCases, connections: 0, sql_execution: "NOT_RUN", populated_effect_proof: "NOT_RUN",
    retained_dependency: "ACTIVE_MANAGER_CREDENTIAL_PUSH_OWNER_TRIGGER", resources: 0 }));
  process.exit(0);
}
if (process.argv.includes("--authority-push-schema-only")) {
  const { readFileSync } = await import("node:fs");
  const state = readFileSync(new URL("./disaster-recovery-state.mjs", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../proposals/immutable-original-authority-reconciliation.sql", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260721203000_manager_mobile_notifications.sql", import.meta.url), "utf8");
  const start = migration.indexOf("create table if not exists public.ops_manager_push_devices (");
  const table = migration.slice(start, migration.indexOf("\n);", start));
  assert.ok(start > 0);
  const columns = new Map([...table.matchAll(/^  ([a-z_]+) (uuid|text|boolean|timestamptz|jsonb)\b/gm)].map(match => [match[1], match[2]]));
  assert.equal(columns.get("enabled"), "boolean"); assert.equal(columns.get("revoked_at"), "timestamptz");
  assert.equal(columns.get("last_error"), "text"); assert.equal(columns.get("metadata_json"), "jsonb");
  assert.equal(columns.has("revoked_reason"), false);
  const fixedStart = sql.indexOf("IF (SELECT count(*) FROM (VALUES", sql.indexOf("CREATE FUNCTION custodial_dr.immutable_original_authority_snapshot("));
  const fixedEnd = sql.indexOf("MESSAGE='Original authority fixed columns unavailable'; END IF;", fixedStart);
  assert.ok(fixedStart > 0 && fixedEnd > fixedStart);
  const fixed = sql.slice(fixedStart, fixedEnd);
  const entries = [...fixed.matchAll(/\('([^']+)','([^']+)','([^']+)'\)/g)].map(match => match.slice(1));
  const push = entries.filter(([name]) => name === "public.ops_manager_push_devices");
  // Same actual old contract fails HERE against canonical migration, before
  // any SQL/native execution. A signature/fixture does not invent columns.
  assert.deepEqual(push.filter(([, name]) => !columns.has(name)), [], "Private SQL requires nonexistent canonical push column");
  let cases = 1;
  assert.deepEqual(push, [["public.ops_manager_push_devices", "enabled", "pg_catalog.bool"],
    ["public.ops_manager_push_devices", "revoked_at", "pg_catalog.timestamptz"]]); cases++;
  assert.equal(entries.length, 11); assert.match(fixed, /\)<>11\s/); assert.doesNotMatch(fixed, />=11/); cases++;
  assert.ok(fixed.includes("a.atttypid=to_regtype(fixed.type) AND a.atttypmod=-1 AND NOT a.attisdropped"));
  assert.ok(fixed.includes("a.attnum>0 AND a.attgenerated='' AND a.attidentity=''")); cases++;
  const requiredStart = state.indexOf("  const required = [", state.indexOf("export async function invalidateRestoredAuthority("));
  const requiredEnd = state.indexOf("\n  ];", requiredStart) + "\n  ];".length;
  const required = new Function(state.slice(requiredStart, requiredEnd) + "\nreturn required;")();
  assert.equal(required.length, 6); assert.deepEqual(required.find(([, name]) => name === "ops_manager_push_devices"),
    ["public", "ops_manager_push_devices", ["enabled", "revoked_at"]]); cases++;
  const fields = required.find(([, name]) => name === "ops_manager_push_devices")[2];
  // Use the actual preflight field predicate; missing actual columns still
  // refuse, while diagnostic/history fields are not substituted for reason.
  const fieldCheck = state.slice(state.indexOf("if (fields.some(field => !columns.has(field)))", requiredEnd),
    state.indexOf("\n  const reason = ", requiredEnd));
  assert.ok(fieldCheck.includes('code: "RESTORE_AUTHORITY_TARGET_UNAVAILABLE"'));
  const accepts = actual => !fields.some(field => !actual.has(field));
  assert.equal(accepts(new Set(columns.keys())), true); cases++;
  for (const missing of ["enabled", "revoked_at"]) {
    const reduced = new Set(columns.keys()); reduced.delete(missing); assert.equal(accepts(reduced), false); cases++;
  }
  const callStart = state.indexOf("  const managerPush = await updateRequiredAuthorityTarget(query, {");
  const callEnd = state.indexOf("\n  const deleted = ", callStart);
  const pushCall = state.slice(callStart, callEnd);
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  let descriptor;
  const count = await new AsyncFunction("query", "updateRequiredAuthorityTarget", pushCall + "\nreturn managerPush;")(
    null, async (query, value) => { assert.equal(query, null); descriptor = value; return 3; });
  assert.equal(count, 3); assert.deepEqual(descriptor, { table: "ops_manager_push_devices",
    assignments: [["enabled", false], ["revoked_at", "clock_timestamp()", true]],
    predicate: "coalesce(enabled,true)=true or revoked_at is null" }); cases++;
  // Execute the exact existing SQL serializer/receipt checker with an inert
  // recording port, NOT a forged native Client or permitted SQL context.
  const helpers = new Function("isProxy", state.slice(state.indexOf("function quoteIdentifier("), state.indexOf("// Existing backup DATA encoding")) +
    state.slice(state.indexOf("function restoreAuthorityUnavailable("), state.indexOf("// Raw TEXT avoids driver")) +
    state.slice(state.indexOf("async function updateRequiredAuthorityTarget("), state.indexOf("export async function invalidateRestoredAuthority(")) +
    "\nreturn updateRequiredAuthorityTarget;")(isProxy);
  const statements = [];
  const actualCount = await helpers(async (text, params) => { statements.push({ text, params });
    return { command: "UPDATE", rowCount: 3, rows: [] }; }, descriptor);
  assert.equal(actualCount, 3); assert.deepEqual(statements, [{
    text: 'update "public"."ops_manager_push_devices" set "enabled"=$1,"revoked_at"=clock_timestamp() where coalesce(enabled,true)=true or revoked_at is null',
    params: [false] }]); cases++;
  const caseStart = sql.indexOf("   WHEN 5 THEN\n    SELECT count(*) INTO expected FROM public.ops_manager_push_devices");
  const effect = sql.slice(caseStart, sql.indexOf("   WHEN 6 THEN", caseStart));
  assert.ok(caseStart > 0); assert.match(effect, /UPDATE public\.ops_manager_push_devices SET enabled=false,revoked_at=clock_timestamp\(\)\s+WHERE coalesce\(enabled,true\)=true OR revoked_at IS NULL;/);
  assert.doesNotMatch(effect, /revoked_reason|last_error|metadata_json/); cases++;
  assert.ok(effect.includes("GET DIAGNOSTICS affected=ROW_COUNT;")); cases++;
  assert.ok(sql.includes("IF affected IS DISTINCT FROM expected THEN"));
  assert.ok(sql.includes("reason:='disaster_restore_generation_'||p_authority_generation::text;"));
  assert.match(sql, /'authority_generation',p_authority_generation::text,\s*'archive_digest',p_archive_digest,'state','CONSUMED_PAUSED','revocations',effect_counts\)/);
  assert.ok(sql.includes("(original->>'owner_oid')::oid,original,'RUNNING',0,NULL,effect_counts")); cases++;
  console.log(JSON.stringify({ selector: "authority-push-schema", cases, schema: "CANONICAL_TWO_COLUMN_PUSH_REVOCATION",
    checks: "SOURCE_CONTRACT_AND_ACTUAL_SERIALIZER_RECORDING_ONLY", SQL: "NOT_RUN", native_effects: "NOT_RUN", connections: 0, old_groups: 0 }));
  process.exit(0);
}
if (process.argv.includes("--authority-original-recovery-only")) {
  const { readFileSync } = await import("node:fs");
  const recovery = readFileSync(new URL("./immutable-private-fresh-restore-recovery.mjs", import.meta.url), "utf8");
  const cli = readFileSync(new URL("./create-production-restore-reconciliation.mjs", import.meta.url), "utf8");
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const selected = process.argv.find(arg => arg.startsWith("--authority-original-group="))?.split("=")[1];
  assert.ok(selected === undefined || ["config", "parser", "reader-flow", "cli-flow", "native-refusal"].includes(selected));
  const want = name => selected === undefined || selected === name;
  let cases = 0, groups = 0;
  const original = Object.freeze({ restoreId: "11111111-1111-4111-8111-111111111111", generation: pg.types.getTypeParser(20)("7"),
    archiveDigest: "a".repeat(64), targetProjectRef: "abcdefghijklmnopqrst" });
  const recorded = Object.freeze({ ...original, databaseOid: "16384", effectBackendPid: 4321,
    effectTransactionId: "9007199254740993", originalTransactionId: "9007199254740992" });
  const prefix = "RESTORE_RECONCILIATION_STATUS_", flag = prefix + "AUTHORITY_FROM_ORIGINAL";
  const base = { SUPABASE_PROJECT_REF: original.targetProjectRef, [prefix + "ID"]: original.restoreId,
    [prefix + "GENERATION"]: original.generation, [prefix + "ARCHIVE_DIGEST"]: original.archiveDigest, [flag]: "true" };
  const configStart = cli.indexOf("const databaseUrl = "), configEnd = cli.indexOf("const actor = ", configStart);
  assert.ok(configStart > 0 && configEnd > configStart);
  const readConfig = new Function("process", cli.slice(configStart, configEnd) +
    "\nreturn {statusMode,statusRequest,statusCommitOutcome,statusAuthorityOutcome,statusAuthorityOriginalOutcome};");
  if (want("config")) {
    const good = readConfig({ env: base });
    assert.equal(good.statusMode, true); assert.equal(good.statusAuthorityOriginalOutcome, true);
    assert.equal(good.statusAuthorityOutcome, false); assert.equal(good.statusCommitOutcome, false);
    assert.deepEqual(good.statusRequest, original); assert.ok(Object.isFrozen(good.statusRequest)); cases++;
    const refuse = env => { assert.throws(() => readConfig({ env })); cases++; };
    for (const name of [prefix + "ID", prefix + "GENERATION", prefix + "ARCHIVE_DIGEST", "SUPABASE_PROJECT_REF"]) {
      const env = { ...base }; delete env[name]; refuse(env);
    }
    for (const value of [undefined, "", "TRUE", "true\n", " true", true, null, new String("true")]) refuse({ ...base, [flag]: value });
    for (const name of [prefix + "AUTHORITY_OUTCOME", prefix + "COMMIT_OUTCOME"]) refuse({ ...base, [name]: "true" });
    for (const name of ["DATABASE_OID", "EFFECT_BACKEND_PID", "EFFECT_TRANSACTION_ID", "ORIGINAL_TRANSACTION_ID"])
      refuse({ ...base, [prefix + name]: "1" });
    for (const value of ["0", "01", "+7", "7\n", "9223372036854775808", 7, new String("7")]) refuse({ ...base, [prefix + "GENERATION"]: value });
    for (const [name, value] of [[prefix + "ID", original.restoreId + "\n"], [prefix + "ID", "foreign"],
      [prefix + "ARCHIVE_DIGEST", "A".repeat(64)], [prefix + "ARCHIVE_DIGEST", original.archiveDigest + "\n"],
      ["SUPABASE_PROJECT_REF", " " + original.targetProjectRef], ["SUPABASE_PROJECT_REF", original.targetProjectRef + "\n"]]) refuse({ ...base, [name]: value });
    refuse({ [flag]: "false" }); refuse({ ...base, [prefix + "AUTHORITY_FROM_ORIGINAL_TYPO"]: "true" });
    assert.equal(readConfig({ env: { ...base, [prefix + "GENERATION"]: "9223372036854775807" } }).statusRequest.generation, "9223372036854775807"); cases++;
    // Both old status modes still select their original dispatch, not discovery.
    const exact = readConfig({ env: { ...base, [flag]: "false", [prefix + "AUTHORITY_OUTCOME"]: "true",
      [prefix + "DATABASE_OID"]: recorded.databaseOid, [prefix + "EFFECT_BACKEND_PID"]: String(recorded.effectBackendPid),
      [prefix + "EFFECT_TRANSACTION_ID"]: recorded.effectTransactionId, [prefix + "ORIGINAL_TRANSACTION_ID"]: recorded.originalTransactionId } });
    assert.equal(exact.statusAuthorityOutcome, true); assert.equal(exact.statusAuthorityOriginalOutcome, false); assert.deepEqual(exact.statusRequest, recorded); cases++;
    const database = readConfig({ env: { ...base, [flag]: "false", [prefix + "COMMIT_OUTCOME"]: "true" } });
    assert.equal(database.statusCommitOutcome, true); assert.equal(database.statusAuthorityOriginalOutcome, false); cases++; groups++;
  }
  // Actual private descriptor parsers, extracted without changing their bodies.
  // These are DATA tests, not a native client/SQL acceptance substitute.
  const helpers = new Function("isProxy", recovery.slice(recovery.indexOf("const requestKeys = "), recovery.indexOf("// An original-status observation")) +
    recovery.slice(recovery.indexOf("const authorityRequestKeys = "), recovery.indexOf("function authorityOwn(")) +
    recovery.slice(recovery.indexOf("const authorityDiscoveryKeys = "), recovery.indexOf("// Restart recovery from")) +
    "\nreturn {captureRequest,captureStatus,captureAuthorityRequest,captureAuthorityStatus,captureDiscoveredAuthorityRequest,authorityDiscoveryKeys,authorityDiscoverySql,authorityStatusKeys,statusKeys,authorityRequestKeys,requestKeys,closedData,authorityUnavailable,authorityDecimal};")(isProxy);
  const context = { database_oid: recorded.databaseOid, backend_pid: 9876, virtual_transaction: "3/9", assigned_transaction_id: null,
    snapshot: "1:2:", actor: "supabase_admin", session_actor: "supabase_admin", read_only: "on", isolation: "repeatable read",
    replication: "origin", search_path: "pg_catalog, pg_temp", first_schema: "pg_catalog", database_owner: "postgres", dr_owner: "postgres", control_owner: "supabase_admin" };
  const discovered = { database_oid: recorded.databaseOid, effect_backend_pid: recorded.effectBackendPid, effect_transaction_id: recorded.effectTransactionId,
    original_transaction_id: recorded.originalTransactionId, restore_id: original.restoreId, authority_generation: original.generation, archive_digest: original.archiveDigest,
    phase: "CONSUMED", completed_step: 6, active_table_oid: null, scope_metadata_valid: true };
  if (want("parser")) {
    const good = helpers.captureDiscoveredAuthorityRequest(discovered, original, context);
    assert.deepEqual(good, recorded); assert.ok(Object.isFrozen(good)); cases++;
    for (const [key, value] of [["database_oid", "16385"], ["database_oid", 16384], ["effect_backend_pid", "4321"],
      ["effect_backend_pid", 0], ["effect_backend_pid", 2147483648], ["effect_transaction_id", "01"],
      ["effect_transaction_id", "9223372036854775808"], ["original_transaction_id", recorded.effectTransactionId],
      ["original_transaction_id", null], ["restore_id", "22222222-2222-4222-8222-222222222222"],
      ["authority_generation", "8"], ["authority_generation", 7], ["archive_digest", "b".repeat(64)],
      ["phase", "RUNNING"], ["phase", "ACTIVE"], ["completed_step", 5], ["completed_step", "6"],
      ["active_table_oid", "1"], ["scope_metadata_valid", false], ["scope_metadata_valid", null]]) {
      assert.throws(() => helpers.captureDiscoveredAuthorityRequest({ ...discovered, [key]: value }, original, context)); cases++;
    }
    for (const key of Object.keys(discovered)) { const row = { ...discovered }; delete row[key];
      assert.throws(() => helpers.captureDiscoveredAuthorityRequest(row, original, context)); cases++; }
    let touched = 0;
    const accessor = { ...discovered }; Object.defineProperty(accessor, "effect_transaction_id", { enumerable: true, get() { touched++; return recorded.effectTransactionId; } });
    for (const row of [accessor, new Proxy(discovered, {}), { ...discovered, extra: true }]) {
      assert.throws(() => helpers.captureDiscoveredAuthorityRequest(row, original, context)); cases++;
    }
    assert.equal(touched, 0);
    assert.throws(() => helpers.captureDiscoveredAuthorityRequest(discovered, original, { ...context, assigned_transaction_id: recorded.effectTransactionId })); cases++;
    // Cardinality uses the actual native-result parser, not a Set or LIMIT.
    const parseRow = new Function("authorityOwn", "authorityUnavailable", "closedData", "isProxy",
      recovery.slice(recovery.indexOf("function authoritySingleRow("), recovery.indexOf("// The request is lookup DATA.")) + "return authoritySingleRow;")(
        (object, key) => { const d = Object.getOwnPropertyDescriptor(object, key); if (!d || !Object.hasOwn(d, "value")) throw Error("DATA only"); return d.value; },
        helpers.authorityUnavailable, helpers.closedData, isProxy);
    for (const rows of [[], [discovered, { ...discovered }]]) {
      assert.throws(() => parseRow({ command: "SELECT", rowCount: rows.length, rows }, helpers.authorityDiscoveryKeys)); cases++;
    }
    assert.deepEqual(parseRow({ command: "SELECT", rowCount: 1, rows: [discovered] }, helpers.authorityDiscoveryKeys), discovered); cases++;
    assert.doesNotMatch(helpers.authorityDiscoverySql, /\b(?:order\s+by|limit|insert|update|delete|set|begin|commit)\b/i);
    assert.match(helpers.authorityDiscoverySql, /from ONLY custodial_dr\.immutable_original_authority_scopes/);
    assert.match(helpers.authorityDiscoverySql, /where s\.restore_id=\$1::uuid and s\.authority_generation=\$2::bigint/);
    for (const text of ["r.relrowsecurity and r.relforcerowsecurity", "s.owner_oid=r.relowner", "current_user=session_user", "a.grantee<>r.relowner"])
      assert.ok(helpers.authorityDiscoverySql.includes(text)); cases++; groups++;
  }
  if (want("reader-flow")) {
    // Exact new adapter control-flow with inert recording dependencies only.
    // No fabricated native Client is accepted by a shipping reader here.
    const start = recovery.indexOf("export async function readVerifiedImmutableFreshAuthorityCommitOutcomeFromOriginal(");
    assert.ok(start > 0);
    const make = new Function("closedData", "captureRequest", "authorityInvalid", "authorityNative", "authorityUnavailable", "requestKeys",
      "authorityContextKeys", "authoritySingleRow", "authorityContextSql", "authorityDiscoverySql", "authorityDiscoveryKeys", "captureDiscoveredAuthorityRequest",
      "authorityQuery", "authorityDecimal", "readOriginalRestoreDatabaseStatus", "captureStatus", "readVerifiedImmutableFreshAuthorityCommitOutcome",
      "captureAuthorityRequest", "authorityRequestKeys", "captureAuthorityStatus", "statusKeys",
      recovery.slice(start).replace(/^export /, "") + "\nreturn readVerifiedImmutableFreshAuthorityCommitOutcomeFromOriginal;");
    const database = Object.freeze({ schema: "memphis-zoo-restore-original-status.v1", restore_id: original.restoreId, authority_generation: original.generation,
      archive_digest: original.archiveDigest, target_project_ref: original.targetProjectRef, state: "COMPLETE", mutations_paused: false,
      database_marker_status: "OBSERVED_DATABASE_MARKERS", database_verified: true, prior_unknown_recorded: false,
      metadata_only: true, retry_allowed: false, resume_allowed: false, rerun_import_allowed: false, complete_restore: false });
    const status = { state: "OBSERVED_COMMITTED_CONSUMED", database_oid: recorded.databaseOid, effect_backend_pid: recorded.effectBackendPid,
      effect_transaction_id: recorded.effectTransactionId, original_transaction_id: recorded.originalTransactionId, restore_id: original.restoreId,
      authority_generation: original.generation, archive_digest: original.archiveDigest,
      revocations: Object.fromEntries(["employee_credentials", "employee_enrollment", "manager_credentials", "manager_enrollment", "manager_push", "auth_sessions"].map(key => [key, "0"])) };
    const journey = async (fault = "") => {
      const events = [], db = {}, request = { ...original }, options = { db, request }, native = { processID: context.backend_pid };
      let stale = false, reads = 0, contexts = 0, databases = 0;
      const strict = { schema: "custodial.immutable-private-fresh-authority-commit-outcome.v1", requested_original: recorded,
        observation: "CURRENT_FIXED_READ", outcome: "AUTHORITY_COMPLETION_OBSERVED", database_status: database, authority_status: status,
        metadata_only: true, retry_safe: false, retry_allowed: false, resume_allowed: false, rerun_import_allowed: false, complete_restore: false };
      const query = async function(sql, params) {
        assert.equal(this, db);
        if (sql === "CONTEXT") {
          events.push("context"); contexts++;
          return { ...context, ...(fault === "context-change" && contexts > 2 ? { snapshot: "1:3:" } : {}) };
        }
        assert.equal(sql, helpers.authorityDiscoverySql); assert.deepEqual(params, [original.restoreId, original.generation]);
        events.push("discover"); reads++;
        if (fault === "read-error") throw undefined;
        if (fault === "request-change") request.archiveDigest = "b".repeat(64);
        if (fault === "native-change") stale = true;
        return fault === "missing" ? null : fault === "duplicate" ? [discovered, discovered]
          : { ...discovered, ...(fault === "running" ? { phase: "RUNNING" } : {}),
            ...(fault === "late-change" && reads > 1 ? { effect_backend_pid: 4322 } : {}) };
      };
      const fn = make(helpers.closedData, helpers.captureRequest, () => { throw Error("Invalid"); },
        port => { assert.equal(port, db); if (stale) throw Error("Detached"); return native; }, helpers.authorityUnavailable, helpers.requestKeys,
        Object.keys(context), row => { if (!row || Array.isArray(row)) throw Error("Cardinality"); return row; }, "CONTEXT", helpers.authorityDiscoverySql,
        helpers.authorityDiscoveryKeys, helpers.captureDiscoveredAuthorityRequest, query, helpers.authorityDecimal,
        async (port, lookup) => { assert.equal(port, db); assert.deepEqual(lookup, original); events.push("database"); databases++;
          return fault === "late-database" && databases > 1 ? { ...database, state: "VERIFYING" } : database; }, helpers.captureStatus,
        async args => { assert.equal(args.db, db); assert.deepEqual(args.request, recorded); events.push("strict");
          if (fault === "strict-error") throw false;
          return fault === "strict-unknown" ? { ...strict, outcome: "UNKNOWN", authority_status: null } : strict; },
        helpers.captureAuthorityRequest, helpers.authorityRequestKeys, helpers.captureAuthorityStatus, helpers.statusKeys);
      return { value: await fn(options), events };
    };
    const good = await journey(); assert.equal(good.value.outcome, "AUTHORITY_COMPLETION_OBSERVED");
    assert.deepEqual(good.value.requested_original, original); assert.deepEqual(good.value.recorded_lookup, recorded);
    assert.ok(Object.isFrozen(good.value)); assert.ok(Object.isFrozen(good.value.recorded_lookup));
    assert.deepEqual(good.events, ["context", "database", "context", "discover", "context", "strict", "context", "discover", "context", "database", "context"]); cases++;
    for (const fault of ["missing", "duplicate", "running", "read-error", "request-change", "native-change", "context-change",
      "strict-error", "strict-unknown", "late-change", "late-database"]) {
      const { value, events } = await journey(fault);
      assert.equal(value.outcome, "UNKNOWN", fault); assert.equal(value.observation, "UNAVAILABLE");
      for (const key of ["recorded_lookup", "database_status", "authority_status"]) assert.equal(value[key], null);
      assert.equal(value.metadata_only, true);
      for (const key of ["retry_safe", "retry_allowed", "resume_allowed", "rerun_import_allowed", "complete_restore"]) assert.equal(value[key], false);
      if (["missing", "duplicate", "running", "read-error", "request-change", "native-change", "context-change"].includes(fault)) assert.equal(events.includes("strict"), false); cases++;
    } groups++;
  }
  if (want("cli-flow")) {
    const start = cli.indexOf("if (statusMode) {\n  let status, firstFailure;"), end = cli.indexOf("} else {\nlet pendingEnvelope, firstFailure;", start);
    assert.ok(start > 0 && end > start);
    const execute = new AsyncFunction("db", "Client", "statusMode", "statusRequest", "statusAuthorityOriginalOutcome", "statusAuthorityOutcome", "statusCommitOutcome",
      "readVerifiedImmutableFreshAuthorityCommitOutcomeFromOriginal", "readVerifiedImmutableFreshAuthorityCommitOutcome", "readVerifiedImmutableFreshDatabaseCommitOutcome",
      "readOriginalRestoreDatabaseStatus", "console", cli.slice(start, end) + "}\n");
    const begin = "begin isolation level repeatable read read only", path = "set local search_path = pg_catalog, pg_temp";
    const journey = async (failAt, failure) => {
      const events = [], output = [], unknown = { outcome: "UNKNOWN", metadata_only: true, retry_safe: false,
        retry_allowed: false, resume_allowed: false, rerun_import_allowed: false, complete_restore: false };
      const at = label => { events.push(label); if (label === failAt) throw failure; };
      function Client() {} Client.prototype.end = async function() { assert.equal(this, db); at("end"); };
      const db = { async connect() { at("connect"); }, async query(sql) { assert.ok([begin, path, "rollback"].includes(sql)); at(sql); } };
      let failed = false, error;
      try { await execute(db, Client, true, original, true, false, false,
        async args => { assert.equal(args.db, db); assert.equal(args.request, original); at("discovery-reader"); return unknown; },
        () => assert.fail("No strict-eight direct dispatch"), () => assert.fail("No database dispatch"), () => assert.fail("No legacy dispatch"),
        { log(value) { at("print"); output.push(value); } }); } catch (value) { failed = true; error = value; }
      return { events, output, unknown, failed, error };
    };
    const good = await journey(); assert.equal(good.failed, false);
    assert.deepEqual(good.events, ["connect", begin, path, "discovery-reader", "rollback", "end", "print"]);
    assert.deepEqual(good.output, [JSON.stringify(good.unknown)]); cases++;
    for (const phase of ["connect", begin, path, "discovery-reader", "rollback", "end"]) {
      const failure = Error("UNIT phase refusal"), result = await journey(phase, failure);
      assert.equal(result.failed, true); assert.equal(result.error, failure); assert.deepEqual(result.output, []);
      assert.equal(result.events.at(-1), "end");
      if (phase === "connect") assert.deepEqual(result.events, ["connect", "end"]); cases++;
    }
    for (const failure of [undefined, null, false, 0, ""]) {
      const result = await journey("discovery-reader", failure); assert.equal(result.failed, true); assert.equal(result.error, failure);
      assert.deepEqual(result.output, []); assert.deepEqual(result.events, ["connect", begin, path, "discovery-reader", "rollback", "end"]); cases++;
    } groups++;
  }
  if (want("native-refusal")) {
    const { readVerifiedImmutableFreshAuthorityCommitOutcomeFromOriginal: actual } = await import("./immutable-private-fresh-restore-recovery.mjs");
    let queries = 0, getters = 0;
    const facade = { query() { queries++; assert.fail("No foreign query"); } };
    const unstarted = new pg.Client({ connectionString: "postgresql://localhost/mz_schema_rebuild_original_status_unit" });
    try {
      for (const db of [null, facade, new Proxy(unstarted, {}), unstarted]) {
        const value = await actual({ db, request: original }); assert.equal(value.outcome, "UNKNOWN"); assert.equal(value.recorded_lookup, null);
        assert.equal(value.authority_status, null); assert.equal(value.metadata_only, true);
        for (const key of ["retry_safe", "retry_allowed", "resume_allowed", "rerun_import_allowed", "complete_restore"]) assert.equal(value[key], false); cases++;
      }
      const accessor = { ...original }; Object.defineProperty(accessor, "generation", { enumerable: true, get() { getters++; return "7"; } });
      for (const request of [recorded, accessor, new Proxy(original, {}), { ...original, generation: 7 }, { ...original, generation: "01" }]) {
        await assert.rejects(actual({ db: unstarted, request }), { code: "IMMUTABLE_FRESH_AUTHORITY_COMMIT_RECOVERY_INVALID" }); cases++;
      }
    } finally { await unstarted.end(); }
    assert.equal(queries, 0); assert.equal(getters, 0); groups++;
  }
  console.log(JSON.stringify({ selector: "authority-original-recovery", groups, cases, scope: "SOURCE_COMPONENTS_AND_NATIVE_REFUSALS_ONLY",
    sql: "NOT_RUN", connections: 0, signing: "NOT_RUN", old_groups: 0 }));
  process.exit(0);
}
if (process.argv.includes("--authority-refusal-diagnostic-only")) {
  const { readFileSync } = await import('node:fs');
  const { types } = await import('node:util');
  const source=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  const unavailable=cause=>{',source.indexOf('export async function reconcileCommittedImmutableFreshAuthority'));
  const end=source.indexOf('\n  if(!state||',start);
  assert.ok(start>0&&end>start);
  const failures=new WeakMap();
  const refuse=new Function('types','privateFailures',source.slice(start,end)+'\nreturn unavailable;')(types,failures);
  const invoke=cause=>{try{refuse(cause);}catch(error){return error;}throw Error('Expected refusal');};
  const names=[...source.slice(start,end).matchAll(/'((?:Original authority |Immutable import original global fence )[^']+)'/g)].map(m=>m[1]);
  assert.equal(new Set(names).size,26);
  for(const name of names){
    const cause=Object.assign(new Error(name),{code:'55000',detail:'PRIVATE ROW MUST NOT ESCAPE'}),error=invoke(cause);
    assert.equal(error.authority_refusal,name);assert.equal(error.sql_state,'55000');
    assert.equal(failures.get(error),cause);assert.equal(error.complete_restore,false);
    assert.equal(error.retry_allowed,false);assert.equal(error.rerun_import_allowed,false);assert.equal(error.resume_allowed,false);
    assert.equal(JSON.stringify(error).includes('PRIVATE ROW'),false);assert.equal(Object.hasOwn(error,'cause'),false);
  }
  assert.equal(invoke(Object.assign(new Error('arbitrary private row'),{code:'55000'})).authority_refusal,undefined);
  assert.equal(invoke(Object.assign(new Error(names[0]),{code:'42501'})).authority_refusal,undefined);
  let accessed=0;const getter={code:'55000'};Object.defineProperty(getter,'message',{get(){accessed++;return names[0];}});
  assert.equal(invoke(getter).authority_refusal,undefined);assert.equal(accessed,0);
  assert.equal(invoke(new Proxy({}, {get(){throw Error('must not inspect');}})).authority_refusal,undefined);
  const cli=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
  for(const name of names)assert.ok(cli.includes(JSON.stringify(name)));
  console.log(JSON.stringify({new_cases:31,scope:'CLOSED_REFUSAL_DIAGNOSTIC_ONLY',SQL:'NOT_RUN',effects:false,old_groups_run:0}));
  process.exit(0);
}

if (process.argv.includes("--authority-commit-status-cli-only")) {
  const {readFileSync}=await import("node:fs");
  const text=readFileSync(new URL("./create-production-restore-reconciliation.mjs",import.meta.url),"utf8");
  const configStart=text.indexOf("const databaseUrl = "),configEnd=text.indexOf("const actor = ",configStart);
  assert.ok(configStart>=0&&configEnd>configStart);
  const config=new Function("process",text.slice(configStart,configEnd)+
    "\nreturn {statusMode,statusRequest,statusCommitOutcome,statusAuthorityOutcome};");
  const prefix="RESTORE_RECONCILIATION_STATUS_",flag=prefix+"AUTHORITY_OUTCOME",databaseFlag=prefix+"COMMIT_OUTCOME";
  const original=Object.freeze({restoreId:"11111111-1111-4111-8111-111111111111",generation:pg.types.getTypeParser(20)("7"),
    archiveDigest:"a".repeat(64),targetProjectRef:"abcdefghijklmnopqrst",databaseOid:"16384",effectBackendPid:4321,
    effectTransactionId:"9007199254740993",originalTransactionId:"9007199254740992"});
  const base={SUPABASE_PROJECT_REF:original.targetProjectRef,[prefix+"ID"]:original.restoreId,
    [prefix+"GENERATION"]:original.generation,[prefix+"ARCHIVE_DIGEST"]:original.archiveDigest};
  const fields={[prefix+"DATABASE_OID"]:original.databaseOid,[prefix+"EFFECT_BACKEND_PID"]:String(original.effectBackendPid),
    [prefix+"EFFECT_TRANSACTION_ID"]:original.effectTransactionId,[prefix+"ORIGINAL_TRANSACTION_ID"]:original.originalTransactionId};
  const good={...base,...fields,[flag]:"true"};
  const read=env=>config({env});
  let groups=0,cases=0,coercions=0;
  const captured=read(good);
  assert.equal(captured.statusMode,true);assert.equal(captured.statusAuthorityOutcome,true);assert.equal(captured.statusCommitOutcome,false);
  assert.deepEqual(captured.statusRequest,original);assert.ok(Object.isFrozen(captured.statusRequest));cases++;
  const max=read({...good,[prefix+"DATABASE_OID"]:"4294967295",[prefix+"EFFECT_BACKEND_PID"]:"2147483647",
    [prefix+"EFFECT_TRANSACTION_ID"]:"9223372036854775807",[prefix+"ORIGINAL_TRANSACTION_ID"]:"1",[prefix+"GENERATION"]:"9223372036854775807"});
  assert.equal(max.statusRequest.databaseOid,"4294967295");assert.equal(max.statusRequest.effectBackendPid,2147483647);
  assert.equal(max.statusRequest.effectTransactionId,"9223372036854775807");cases++;groups++;
  const invalid=env=>{assert.throws(()=>read(env));cases++;};
  for(const name of [...Object.keys(fields),prefix+"ID",prefix+"GENERATION",prefix+"ARCHIVE_DIGEST","SUPABASE_PROJECT_REF"]){
    const env={...good};delete env[name];invalid(env);
  }
  for(const value of ["",undefined,"TRUE","False","1"," true","true ","true\n",true,null,new String("true")])invalid({...good,[flag]:value});
  invalid({...good,[databaseFlag]:"true"});
  assert.equal(read({...good,[databaseFlag]:"false"}).statusAuthorityOutcome,true);cases++;
  for(const value of [undefined,"false"]){
    const env={...base,...fields};if(value!==undefined)env[flag]=value;invalid(env);
  }
  for(const env of [{[flag]:"true"},{[flag]:"false"},{[prefix+"DATABASE_OID"]:"16384"},
    {...good,[prefix+"UNRECOGNIZED"]:"READ_ONLY_IS_NOT_AUTHORITY"},{[prefix+"EFFECT_TRANSACTION_ID_TYPO"]:"1"}])invalid(env);
  groups++;
  const decimalFields=[prefix+"DATABASE_OID",prefix+"EFFECT_BACKEND_PID",prefix+"EFFECT_TRANSACTION_ID",prefix+"ORIGINAL_TRANSACTION_ID",prefix+"GENERATION"];
  const coercible={toString(){coercions++;throw Error("No coercion");},valueOf(){coercions++;throw Error("No coercion");}};
  for(const name of decimalFields)for(const value of ["0","00","01","+1","-1","1.0","1e0"," 1","1 ","1\n","1\r\n","9".repeat(20),1,new String("1"),coercible])
    invalid({...good,[name]:value});
  for(const [name,value]of [[prefix+"DATABASE_OID","4294967296"],[prefix+"EFFECT_BACKEND_PID","2147483648"],
    [prefix+"EFFECT_TRANSACTION_ID","9223372036854775808"],[prefix+"ORIGINAL_TRANSACTION_ID","9223372036854775808"],
    [prefix+"GENERATION","9223372036854775808"]])invalid({...good,[name]:value});
  invalid({...good,[prefix+"ORIGINAL_TRANSACTION_ID"]:original.effectTransactionId});
  for(const [name,value]of [[prefix+"ID","foreign"],[prefix+"ID",original.restoreId+"\n"],[prefix+"ID",new String(original.restoreId)],
    [prefix+"ARCHIVE_DIGEST","A".repeat(64)],[prefix+"ARCHIVE_DIGEST",original.archiveDigest+"\n"],
    ["SUPABASE_PROJECT_REF"," "+original.targetProjectRef],["SUPABASE_PROJECT_REF",original.targetProjectRef+" "],
    ["SUPABASE_PROJECT_REF","A".repeat(20)]])invalid({...good,[name]:value});
  assert.equal(coercions,0);groups++;
  const start=text.indexOf("if (statusMode) {\n  let status, firstFailure;");
  const end=text.indexOf("} else {\nlet pendingEnvelope, firstFailure;",start);assert.ok(start>0&&end>start);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const execute=new AsyncFunction("db","Client","statusMode","statusRequest","statusCommitOutcome","statusAuthorityOutcome",
    "readOriginalRestoreDatabaseStatus","readVerifiedImmutableFreshDatabaseCommitOutcome","readVerifiedImmutableFreshAuthorityCommitOutcome","console",
    text.slice(start,end)+"}\n");
  const begin="begin isolation level repeatable read read only",path="set local search_path = pg_catalog, pg_temp";
  // Inert ports exercise the exact CLI control flow ONLY. No recording DTO or
  // fake client is ever passed into an actual shipping native status reader.
  const journey=async(options={})=>{
    const events=[],prints=[],request=options.request||captured.statusRequest;
    const failure=Object.hasOwn(options,"failure")?options.failure:Error("UNIT status phase failure");
    const at=phase=>{events.push(phase);if(options.failAt===phase)throw failure;};
    function Client(){}
    Client.prototype.end=async function(){assert.equal(this,db);at("native-end");};
    const db={async connect(){at("connect");},async query(sql){assert.ok([begin,path,"rollback"].includes(sql));at(sql);}};
    const unknown=Object.freeze({schema:"custodial.immutable-private-fresh-authority-commit-outcome.v1",requested_original:request,
      observation:"UNAVAILABLE",outcome:"UNKNOWN",database_status:null,authority_status:null,metadata_only:true,retry_safe:false,
      retry_allowed:false,resume_allowed:false,rerun_import_allowed:false,complete_restore:false});
    const authority=async args=>{assert.deepEqual(Reflect.ownKeys(args),["db","request"]);assert.equal(args.db,db);assert.equal(args.request,request);
      at("authority-reader");if(options.replaceEnd)Client.prototype.end=async()=>{throw Error("Replacement must not run");};return unknown;};
    const legacy=async(client,lookup)=>{assert.equal(client,db);assert.equal(lookup,request);at("legacy-reader");return {fixture:"legacy"};};
    const database=async args=>{assert.equal(args.db,db);assert.equal(args.request,request);at("database-reader");return {fixture:"database"};};
    let failed=false,error;
    try{await execute(db,Client,true,request,options.database===true,options.authority!==false,legacy,database,authority,
      {log(value){at("print");prints.push(value);}});}catch(value){failed=true;error=value;}
    return {events,prints,failed,error,failure,unknown};
  };
  const result=await journey({replaceEnd:true});
  assert.equal(result.failed,false);assert.deepEqual(result.events,["connect",begin,path,"authority-reader","rollback","native-end","print"]);
  assert.deepEqual(result.prints,[JSON.stringify(result.unknown)]);cases++;
  const printed=JSON.parse(result.prints[0]);assert.equal(printed.outcome,"UNKNOWN");assert.equal(printed.metadata_only,true);
  for(const field of ["retry_safe","retry_allowed","resume_allowed","rerun_import_allowed","complete_restore"])assert.equal(printed[field],false);cases++;
  const requestFields=Object.keys(original);assert.deepEqual(Object.keys(printed.requested_original),requestFields);cases++;groups++;
  for(const failAt of ["connect",begin,path,"authority-reader","rollback","native-end"]){
    const failed=await journey({failAt});assert.equal(failed.failed,true);assert.equal(failed.error,failed.failure);assert.deepEqual(failed.prints,[]);
    assert.equal(failed.events.at(-1),"native-end");
    if(failAt==="connect")assert.deepEqual(failed.events,["connect","native-end"]);
    if([begin,path].includes(failAt))assert.equal(failed.events.includes("authority-reader"),false);
    assert.equal(failed.events.includes("database-reader"),false);assert.equal(failed.events.includes("legacy-reader"),false);cases++;
  }
  for(const failure of [undefined,null,false,0,""]){
    const failed=await journey({failAt:"authority-reader",failure});assert.equal(failed.failed,true);assert.equal(failed.error,failure);
    assert.deepEqual(failed.prints,[]);assert.deepEqual(failed.events,["connect",begin,path,"authority-reader","rollback","native-end"]);cases++;
  }groups++;
  // Necessary mode compatibility only, not historical DATABASE/crypto groups.
  const legacyRequest={restoreId:original.restoreId,generation:original.generation,archiveDigest:original.archiveDigest,targetProjectRef:original.targetProjectRef};
  for(const database of [false,true]){
    const env={...base,[databaseFlag]:String(database),[flag]:"false"};const mode=read(env);
    assert.equal(mode.statusAuthorityOutcome,false);assert.deepEqual(mode.statusRequest,legacyRequest);
    const prior=await journey({authority:false,database,request:mode.statusRequest});assert.equal(prior.failed,false);
    assert.deepEqual(prior.events,["connect",begin,database?"database-reader":"legacy-reader","rollback","native-end","print"]);cases++;
  }
  assert.equal(read({}).statusMode,false);assert.equal(read({[databaseFlag]:"false"}).statusMode,false);cases++;
  // Frozen pre-integration region digests retain the same compatibility check
  // without depending on an isolated helper's non-shipping ../../before tree.
  const {createHash}=await import('node:crypto');
  const digest=value=>createHash('sha256').update(value).digest('hex');
  assert.equal(digest(text.slice(text.indexOf("} else {\nlet pendingEnvelope, firstFailure;"))),
    'd59e7b0c14c842ea3a02e05a4772f888a71452628a10f555355201b4f31d4d15');cases++;
  const clientText=s=>s.slice(s.indexOf("const db = new Client({"),s.indexOf("if (statusMode) {\n  let status, firstFailure;"));
  assert.equal(digest(clientText(text)),'25d9c422206899e0abbacbabfa688a8f4c34826db2800b0a1b0f42ce517cb0be');cases++;
  assert.ok(text.includes('readVerifiedImmutableFreshAuthorityCommitOutcome } from "./immutable-private-fresh-restore-recovery.mjs"'));cases++;
  assert.ok(configEnd<text.indexOf("const db = new Client({"));
  assert.doesNotMatch(text.slice(configStart,configEnd),/randomUUID|Date\.|signBinding|requireSigningKey|createClient|\.connect\(/);cases++;groups++;
  console.log(JSON.stringify({scope:"NEW authority status CLI config/dispatch/cleanup Source only",groups,cases,coercions,
    SQL:"NOT_RUN",native_reader_positive:"NOT_RUN",signing:"NOT_RUN",child_processes:0,old_groups:0,resources0:true}));
  process.exit(0);
}
if (process.argv.includes("--restored-authority-missing-target-source-only")) {
  const { readFileSync } = await import("node:fs");
  const { compileFunction } = await import("node:vm");
  const source = readFileSync(new URL("./restore-mutation-gate-tests.mjs", import.meta.url), "utf8");
  const start = source.indexOf("  const same = (a, b) =>"), end = source.indexOf("  const firstNativeSqlError =", start);
  assert.ok(start > 0 && end > start);
  // Exact local DATA comparison/classification functions; no native port or
  // owning SQL path is mocked or declared successful by these source cases.
  const { same, missingTargets } = compileFunction(source.slice(start, end) + "return {same,missingTargets};")();
  const absent = [{ identity: "auth.sessions", relation_oid: null, rows: null }];
  assert.equal(same(absent, [{ identity: "auth.sessions", relation_oid: null, rows: null }]), true);
  assert.deepEqual(missingTargets(absent), ["auth.sessions"]);
  let checks = 2;
  for (const changed of [
    [{ identity: "auth.sessions", relation_oid: null, rows: [] }],
    [{ identity: "auth.sessions", relation_oid: "7", rows: [] }],
    [{ identity: "auth.users", relation_oid: null, rows: null }], [],
  ]) { assert.equal(same(absent, changed), false); checks++; }
  const present = [{ identity: "public.device_auth_credentials", relation_oid: "9", rows: ['{"n":9007199254740993}'] }];
  assert.deepEqual(missingTargets(present), []); checks++;
  for (const changed of [
    [{ ...present[0], relation_oid: "10" }], [{ ...present[0], rows: [] }],
    [{ ...present[0], rows: ['{"n":9007199254740992}'] }], [{ ...present[0], rows: [present[0].rows[0], present[0].rows[0]] }],
  ]) { assert.equal(same(present, changed), false); checks++; }
  assert.ok(source.includes('sets.push({ identity: table, relation_oid: null, rows: null });'));
  assert.ok(source.includes('own(refusal, "code") !== "RESTORE_AUTHORITY_TARGET_UNAVAILABLE"'));
  assert.ok(source.includes('native(); // Missing-target refusal must leave the actual transaction T.'));
  assert.ok(source.includes('first_update_guard_test: missing.length ? "NOT_RUN" : "EXPECTED_REFUSAL"'));
  console.log(JSON.stringify({ scope: "NEW_MISSING_TARGET_SOURCE_DATA_CONTROLS_ONLY", checks,
    native_SQL: false, helper_executed: false, old_groups_replayed: 0 }));
  process.exit(0);
}
if (process.argv.includes("--restored-authority-unadmitted-early-only")) {
  let calls = 0, traps = 0, checks = 0;
  const db = new pg.Client({ host: "/UNIT-NOT-CONNECTED", database: "UNIT", user: "UNIT" });
  const foreign = { query() { calls++; throw new Error("Foreign query must not run"); } };
  const proxy = new Proxy({}, { get() { traps++; throw new Error("Proxy must not run"); }, getPrototypeOf() { traps++; throw new Error("Proxy must not run"); } });
  for (const port of [null, undefined, {}, foreign, proxy, db]) {
    await assert.rejects(runRestoredAuthorityUnadmittedSqlCase(port, { generation: "1" })); checks++;
  }
  const accessor = Object.defineProperty({}, "generation", { get() { traps++; return "1"; } });
  for (const options of [undefined, {}, accessor, { generation: "01" }, { generation: "1\n" }, { generation: 1 }]) {
    await assert.rejects(runRestoredAuthorityUnadmittedSqlCase(db, options)); checks++;
  }
  assert.equal(calls, 0); assert.equal(traps, 0);
  assert.equal(db._connecting, false); assert.equal(db._connected, false);
  console.log(JSON.stringify({ scope: "NEW_UNADMITTED_SQL_CASE_EARLY_CONTROLS_ONLY", checks,
    actual_SQL: false, calls, traps, old_groups_replayed: 0 }));
  process.exit(0);
}

// Source-predicate qualification only, not SQL or a positive native context.
// No native client/query replacement and no historical selector is run.
if (process.argv.includes("--restored-authority-explicit-temp-last-only")) {
  const { readFileSync } = await import("node:fs");
  const { compileFunction } = await import("node:vm");
  const source = readFileSync(new URL("./disaster-recovery-state.mjs", import.meta.url), "utf8");
  const start = source.indexOf('|| current.search_path !==', source.indexOf('export async function invalidateRestoredAuthority('));
  const end = source.indexOf('|| current.held_fences', start);
  assert.ok(start > 0 && end > start, "Exact current path predicate must exist");
  const expression = source.slice(start + 2, end).trim();
  const acceptsPath = compileFunction(`return !(${expression});`, ["current"]);
  // This fails against the predecessor's raw pg_catalog-only predicate.
  assert.equal(acceptsPath({ search_path: "pg_catalog, pg_temp", first_schema: "pg_catalog" }), true);
  let checks = 1;
  for (const [search_path, first_schema] of [
    ["pg_catalog", "pg_catalog"], ["pg_catalog", "pg_temp_1"],
    ["pg_temp, pg_catalog", "pg_temp_1"], ["pg_catalog, pg_temp", "pg_temp_1"],
    ["pg_catalog, pg_temp", "public"], ["pg_catalog, pg_temp", null],
    ["pg_catalog, pg_temp", undefined], ["pg_catalog, pg_temp", Object("pg_catalog")],
    ["pg_catalog,pg_temp", "pg_catalog"], ["pg_catalog, pg_temp, public", "pg_catalog"],
    ["public, pg_catalog, pg_temp", "pg_catalog"], ["PG_CATALOG, pg_temp", "pg_catalog"],
    ["pg_catalog, pg_temp\n", "pg_catalog"], [Object("pg_catalog, pg_temp"), "pg_catalog"],
    [null, "pg_catalog"], [undefined, "pg_catalog"],
  ]) {
    assert.equal(acceptsPath({ search_path, first_schema }), false); checks++;
  }
  const current = { search_path: "pg_catalog, pg_temp", first_schema: "pg_catalog" };
  assert.equal(acceptsPath(current), true);
  current.first_schema = "pg_temp_1";
  assert.equal(acceptsPath(current), false);
  current.first_schema = "pg_catalog"; current.search_path = "pg_catalog";
  assert.equal(acceptsPath(current), false); checks += 3;
  const contextStart = source.indexOf('const restoreAuthorityContextSql =');
  const contextEnd = source.indexOf('async function updateRequiredAuthorityTarget(', contextStart);
  assert.ok(source.slice(contextStart, contextEnd).includes('(pg_catalog.current_schemas(true))[1] first_schema'));
  const keysStart = source.indexOf('const keys = [', source.indexOf('export async function invalidateRestoredAuthority('));
  assert.ok(source.slice(keysStart, source.indexOf(';', keysStart)).includes('"first_schema"'));
  assert.ok(source.includes('if (originalContext !== undefined && text !== originalContext) restoreAuthorityUnavailable();'));
  console.log(JSON.stringify({ scope: "NEW_AUTHORITY_EXPLICIT_TEMP_LAST_SOURCE_PREDICATE_ONLY", checks,
    actual_SQL: false, positive_native_context: false, settings_changed: false, old_groups_replayed: 0 }));
  process.exit(0);
}

// Newly affected replacement-descriptor negatives, never a fake positive
// native port. Restore exact descriptors in finally in this isolated process.
if (process.argv.includes("--restored-authority-query-descriptor-only")) {
  const { invalidateRestoredAuthority } = await import("./disaster-recovery-state.mjs");
  const { default: pg } = await import("pg");
  const Client = pg.Client, db = new Client({ host: "/UNIT-NOT-CONNECTED", database: "UNIT", user: "UNIT" });
  let invoked = 0, checks = 0;
  for (const [object, key, replacement] of [
    [Client.prototype, "query", { configurable: true, get() { invoked++; throw new Error("prototype query getter"); } }],
    [Client.prototype, "query", { configurable: true, value() { invoked++; throw new Error("replacement query"); } }],
    [pg, "Client", { configurable: true, get() { invoked++; throw new Error("constructor getter"); } }],
  ]) {
    const original = Object.getOwnPropertyDescriptor(object, key);
    try {
      Object.defineProperty(object, key, replacement);
      await assert.rejects(invalidateRestoredAuthority(db, { generation: "7" }),
        { code: "RESTORE_AUTHORITY_CONTEXT_UNAVAILABLE" });
      assert.equal(invoked, 0); checks++;
    } finally { Object.defineProperty(object, key, original); }
    assert.deepEqual(Object.getOwnPropertyDescriptor(object, key), original);
  }
  assert.equal(db._connecting, false); assert.equal(db._connected, false);
  console.log(JSON.stringify({ scope: "NEW_NATIVE_REPLACEMENT_DESCRIPTOR_REFUSALS_ONLY", checks,
    replacement_calls: invoked, actual_SQL: false, old_groups_replayed: 0 }));
  process.exit(0);
}

// Newly affected original native transaction boundary only; no SQL connection,
// fabricated positive native context, signing or historical selector replay.
if (process.argv.includes("--restored-authority-original-context-only")
    || process.argv.includes("--restored-authority-original-context-before-only")) {
  const before = process.argv.includes("--restored-authority-original-context-before-only");
  const { invalidateRestoredAuthority } = await import(before
    ? "../baseline/scripts/disaster-recovery-state.mjs" : "./disaster-recovery-state.mjs");
  const { default: pg } = await import("pg");
  let queryCalls = 0, writes = 0, traps = 0;
  const fields = {
    device_auth_credentials: ["revoked_at", "revoked_reason"], device_auth_enrollment_codes: ["revoked_at"],
    ops_manager_trusted_devices: ["revoked_at", "revoked_reason"],
    ops_manager_enrollment_codes: ["status", "revoked_at", "revoked_reason"],
    ops_manager_push_devices: ["enabled", "revoked_at", "revoked_reason"], sessions: ["id"],
  };
  const foreign = { async query(sql, args = []) {
    queryCalls++;
    if (sql.startsWith("select to_regclass")) return { rowCount: 1, rows: [{ relation: args[0] }] };
    if (sql.includes("from information_schema.columns"))
      return { rows: fields[args[1]].map(column_name => ({ column_name })) };
    if (/^(update|delete)/.test(sql)) {
      writes++;
      if (args.some(value => typeof value === "string" && value.startsWith("disaster_restore_generation_")))
        assert.ok(args.includes("disaster_restore_generation_7"));
      return { command: sql.startsWith("delete") ? "DELETE" : "UPDATE", rowCount: 2, rows: [] };
    }
    // A hypothetical foreign control is NOT adopted as native authority.
    return { rowCount: 1, rows: [{ authority_generation: "8", state: "DATABASE_RESTORED" }] };
  } };
  if (before) {
    assert.deepEqual(await invalidateRestoredAuthority(foreign, { generation: "7" }), {
      employee_credentials: 2, employee_enrollment: 2, manager_credentials: 2,
      manager_enrollment: 2, manager_push: 2, auth_sessions: 2,
    });
    assert.equal(queryCalls, 18); assert.equal(writes, 6);
    console.log(JSON.stringify({ scope: "PREDECESSOR_FOREIGN_QUERY_ACCEPTANCE_COUNTEREXAMPLE",
      query_calls: queryCalls, mutation_recordings: writes, actual_SQL: false, control_reads: 0 }));
    process.exit(0);
  }
  const native = new pg.Client({ host: "/UNIT-NOT-CONNECTED", database: "UNIT", user: "UNIT" });
  const ownQuery = new pg.Client({ host: "/UNIT-NOT-CONNECTED", database: "UNIT", user: "UNIT" });
  Object.defineProperty(ownQuery, "query", { get() { traps++; throw new Error("own query getter"); } });
  class ForeignSubclass extends pg.Client {}
  const subclass = new ForeignSubclass({ host: "/UNIT-NOT-CONNECTED", database: "UNIT", user: "UNIT" });
  let checks = 0;
  for (const db of [foreign, null, {}, native, ownQuery, subclass, Object.create(pg.Client.prototype),
    new Proxy(native, { get() { traps++; throw new Error("proxy get"); }, getPrototypeOf() { traps++; throw new Error("proxy prototype"); } })]) {
    await assert.rejects(invalidateRestoredAuthority(db, { generation: "7" }),
      { code: "RESTORE_AUTHORITY_CONTEXT_UNAVAILABLE" }); checks++;
  }
  const accessor = Object.defineProperty({}, "generation", { get() { traps++; return "7"; } });
  const proxy = new Proxy({}, { get() { traps++; return "7"; }, getOwnPropertyDescriptor() { traps++; throw new Error("options trap"); } });
  for (const options of [accessor, proxy, { generation: "07" }, { generation: "7\n" },
    { generation: "9223372036854775808" }, { generation: Object("7") }]) {
    await assert.rejects(invalidateRestoredAuthority(foreign, options),
      { code: "RESTORE_AUTHORITY_GENERATION_INVALID" }); checks++;
  }
  assert.equal(queryCalls, 0); assert.equal(writes, 0); assert.equal(traps, 0);
  for (const db of [native, ownQuery, subclass]) {
    assert.equal(db._connecting, false); assert.equal(db._connected, false);
  }
  console.log(JSON.stringify({ scope: "NEW_RESTORED_AUTHORITY_NATIVE_REFUSALS_ONLY", checks,
    query_calls: queryCalls, mutation_recordings: writes, getter_proxy_calls: traps,
    actual_SQL: false, positive_original_context: "NOT_RUN_MAIN_OWNED", old_groups_replayed: 0 }));
  process.exit(0);
}

if (process.argv.includes("--post-database-private-owner-refusals-only")) {
  const { inspectCommittedImmutableFreshData } = await import("./immutable-private-data-import.mjs");
  const { default: pg } = await import("pg");
  // Real but unconnected native client. No connect/query replacement, signed
  // input, fake positive native context, transaction or fixture is introduced.
  const db = new pg.Client({ host: "/UNIT-NOT-CONNECTED", database: "UNIT", user: "UNIT" });
  const archive = {}, forged = { commit_status: "ACKNOWLEDGED", complete_restore: false };
  let invoked = 0, checks = 0;
  for (const options of [
    { db, verifiedArchive: archive },
    { db: {}, verifiedArchive: archive },
    { db: null, verifiedArchive: archive },
    { db, verifiedArchive: forged },
    { db, verifiedArchive: archive, finished: forged },
    { db, verifiedArchive: archive, commit: forged },
    Object.defineProperty({ verifiedArchive: archive }, "db", { enumerable: true, get() { invoked++; return db; } }),
    new Proxy({}, { get() { invoked++; throw new Error("caller trap"); }, ownKeys() { invoked++; return []; } }),
  ]) {
    await assert.rejects(inspectCommittedImmutableFreshData(options)); checks++;
  }
  assert.equal(invoked, 0);
  assert.equal(db._connecting, false); assert.equal(db._connected, false);
  console.log(JSON.stringify({ scope: "NEW_POST_DATABASE_PRIVATE_OWNER_REFUSALS_ONLY", checks,
    actual_SQL: false, positive_current_original_read: false, complete_restore: false, old_groups_replayed: 0 }));
  process.exit(0);
}

// Changed authority invalidation prerequisite only. Inert query recordings,
// not native SQL, current owner admission, or complete restore evidence.
if (process.argv.includes("--authority-target-presence-only")) {
  const { invalidateRestoredAuthority } = await import("./disaster-recovery-state.mjs");
  const targets = {
    device_auth_credentials: ["revoked_at", "revoked_reason"],
    device_auth_enrollment_codes: ["revoked_at"],
    ops_manager_trusted_devices: ["revoked_at", "revoked_reason"],
    ops_manager_enrollment_codes: ["status", "revoked_at", "revoked_reason"],
    ops_manager_push_devices: ["enabled", "revoked_at", "revoked_reason"],
    sessions: ["id"],
  };
  function fixture({ missing = null, missingColumn = null } = {}) {
    const queries = [], writes = [];
    return { queries, writes, db: { async query(sql, args = []) {
      queries.push({ sql, args });
      if (sql.startsWith("select to_regclass")) {
        const identity = args[0] || "auth.sessions";
        return { rowCount: 1, rows: [{ relation: identity === missing ? null : identity }] };
      }
      if (sql.includes("from information_schema.columns")) {
        const names = targets[args[1]].filter(name => args[1] + "." + name !== missingColumn);
        return { rowCount: names.length, rows: names.map(column_name => ({ column_name })) };
      }
      if (/^(update|delete)/.test(sql)) {
        writes.push({ sql, args });
        return { rowCount: 2, rows: [] };
      }
      throw new Error("Unexpected recording query: " + sql);
    } } };
  }
  let checks = 0;
  for (const [table, columns] of Object.entries(targets)) {
    const identity = (table === "sessions" ? "auth." : "public.") + table;
    const absent = fixture({ missing: identity });
    await assert.rejects(invalidateRestoredAuthority(absent.db, { generation: "7" }),
      /RESTORE_AUTHORITY_TARGET_UNAVAILABLE/);
    assert.equal(absent.writes.length, 0); checks++;
    for (const column of columns) {
      const absentColumn = fixture({ missingColumn: table + "." + column });
      await assert.rejects(invalidateRestoredAuthority(absentColumn.db, { generation: "7" }),
        /RESTORE_AUTHORITY_TARGET_UNAVAILABLE/);
      assert.equal(absentColumn.writes.length, 0); checks++;
    }
  }
  for (const generation of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, "01", "9223372036854775808", "7\n", null]) {
    const invalid = fixture();
    await assert.rejects(invalidateRestoredAuthority(invalid.db, { generation }), /RESTORE_AUTHORITY_GENERATION_INVALID/);
    assert.equal(invalid.queries.length, 0); checks++;
  }
  const current = fixture();
  const result = await invalidateRestoredAuthority(current.db, { generation: "9223372036854775807" });
  assert.deepEqual(result, { employee_credentials: 2, employee_enrollment: 2, manager_credentials: 2,
    manager_enrollment: 2, manager_push: 2, auth_sessions: 2 });
  assert.equal(current.writes.length, 6);
  const firstWrite = current.queries.findIndex(({ sql }) => /^(update|delete)/.test(sql));
  assert.equal(current.queries.slice(0, firstWrite).filter(({ sql }) => sql.startsWith("select to_regclass")).length, 6);
  assert.equal(current.queries.slice(0, firstWrite).filter(({ sql }) => sql.includes("from information_schema.columns")).length, 6);
  for (const write of current.writes.filter(({ args }) => args.length)) {
    assert.ok(write.args.some(value => value === "disaster_restore_generation_9223372036854775807")
      || write.args.every(value => value === false));
  }
  checks++;
  console.log(JSON.stringify({ scope: "NEW_REQUIRED_AUTHORITY_TARGET_PREFLIGHT_RECORDING_ONLY", checks,
    actual_SQL: false, effect_admission: false, whole_restore: false, old_groups_replayed: 0 }));
  process.exit(0);
}

// Newly affected exported snapshot helpers, with inert native-row recordings.
// No copied function body, SQL execution, transaction, credentials or signing.
if(process.argv.includes("--first-original-snapshot-raw-only")){
 const {capturePreRestoreState,compareRestoredState}=await import(process.argv.includes("--first-original-snapshot-before-raw-join")
  ?new URL("../baseline-v2/scripts/disaster-recovery-state.mjs",import.meta.url):new URL("./disaster-recovery-state.mjs",import.meta.url));
 const restoreId="11111111-1111-4111-8111-111111111111",max="9223372036854775807";
 const clone=value=>JSON.parse(JSON.stringify(value));
 const fields={device_auth_credentials:["credential_id","device_id","created_at"],device_auth_enrollment_codes:["enrollment_id","device_id"],
  devices:["id","device_id"],employees:["id","employee_code"],ops_manager_trusted_devices:["credential_id","device_id"],
  ops_manager_enrollment_codes:["id","status"],sessions:["id","client_session_id"],custodial_session_corrections:["correction_id","operation_id"],
  completion_responses:["id","session_id"],release_deployment_manifest:["release_id","backend_commit","details_json"]};
 function recording(){
  const saved=new Map(),trace={queries:[],updates:0,inserts:0,reads:0,categoryReads:0,discrepancies:[]};
  const state={changed:false,malform:null,missing:false,empty:false,columns:null,rawChange:false};
  const db={async query(sql,args=[]){
   trace.queries.push({sql,args:clone(args)});
   if(sql.startsWith("select to_regclass"))return{rowCount:1,rows:[{relation:state.missing?null:args[0]}]};
   if(sql.includes("from information_schema.columns")){const selected=state.columns?.[args[1]]??fields[args[1]];return{rowCount:selected.length,rows:selected.map(column_name=>({column_name}))};}
   const table=sql.match(/from "public"\."([a-z_]+)"/);
   if(table){trace.categoryReads++;assert.match(sql,/select row_to_json\(r\)::text original_row/);
    const selected=state.columns?.[table[1]]??fields[table[1]],original_row="{"+selected.map((key,i)=>JSON.stringify(key)+":"+
     (key==="id"?max:key==="created_at"?'"2026-10-17T00:00:00.'+(state.rawChange?'123457':'123456')+'+00:00"':
      key==="details_json"?'{"beyond":9007199254740993,"precise":0.123456789012345678901,"lexical":1.000}':
      JSON.stringify(i===0?"synthetic-"+table[1]:state.changed?"changed-value":"original-value"))).join(",")+"}";
    return{rowCount:state.empty?0:1,rows:state.empty?[]:[{original_row}]};}
   if(sql.includes("insert into custodial_dr.pre_restore_snapshots(")){
    const [id,generation,category,count,sha,json]=args,key=id+"/"+category,prior=saved.get(key);
    if(prior&&/do update set/i.test(sql)){trace.updates++;Object.assign(prior,{row_count:String(count),snapshot_sha256:sha,state_json:JSON.parse(json),captured_at:"changed-"+trace.updates});}
    if(!prior){trace.inserts++;saved.set(key,{restore_id:id,authority_generation:String(generation),category,row_count:String(count),snapshot_sha256:sha,state_json:JSON.parse(json),captured_at:"first-"+trace.inserts});}
    return{command:"INSERT",rowCount:prior?0:1,rows:[]};
   }
   if(sql.includes("from custodial_dr.pre_restore_snapshots")){
    trace.reads++;let row=saved.get(args[0]+"/"+args[1]);
    if(args.length===3&&row?.authority_generation!==args[2])row=null;
    if(!row)return{rowCount:0,rows:[]};
    const returned=/select row_count,snapshot_sha256,state_json/.test(sql)
     ?{row_count:row.row_count,snapshot_sha256:row.snapshot_sha256,state_json:row.state_json}
     :Object.fromEntries(Object.entries(row).filter(([key])=>key!=="captured_at"));
    const result={rowCount:1,rows:[clone(returned)]};state.malform?.(result);return result;
   }
   if(sql.includes("insert into custodial_dr.restore_discrepancies(")){trace.discrepancies.push(clone(args));return{rowCount:1,rows:[]};}
   throw Error("Unexpected snapshot recording query");
  }};
  return{db,saved,trace,state};
 }
 const selected=process.argv.find(arg=>arg.startsWith("--first-original-snapshot-case="))?.slice("--first-original-snapshot-case=".length);
 const cases=[];const run=async(name,work)=>{name="raw-"+name;if(selected&&selected!==name)return;await work();cases.push(name);console.log("FIRST_ORIGINAL_RAW_SNAPSHOT_NEW "+name+" PASS");};
 await run("changed-original",async()=>{
  const r=recording();await capturePreRestoreState(r.db,{restoreId,generation:"1"});const first=JSON.stringify([...r.saved]);
  r.state.changed=true;let error;try{await capturePreRestoreState(r.db,{restoreId,generation:"1"});}catch(value){error=value;}
  console.log(JSON.stringify({case:"changed-original",rejected:!!error,original_unchanged:JSON.stringify([...r.saved])===first,updates:r.trace.updates}));
  assert.ok(error,"Changed pre-state must reject instead of replacing the first original snapshot");assert.equal(JSON.stringify([...r.saved]),first);assert.equal(r.trace.updates,0);
 });
 await run("compare-generation",async()=>{
  const r=recording();await capturePreRestoreState(r.db,{restoreId,generation:"9007199254740993"});const first=JSON.stringify([...r.saved]);
  const reads=r.trace.categoryReads;let error;try{await compareRestoredState(r.db,{restoreId,generation:"9007199254740992"});}catch(value){error=value;}
  console.log(JSON.stringify({case:"compare-generation",rejected:!!error,discrepancy_writes:r.trace.discrepancies.length}));
  assert.ok(error,"A different original generation must not be compared as the current original");assert.equal(r.trace.categoryReads,reads);
  assert.equal(r.trace.discrepancies.length,0);assert.equal(JSON.stringify([...r.saved]),first);
 });
 await run("idempotent-first-original",async()=>{
  for(const missing of [false,true]){
   const r=recording();r.state.missing=missing;const first=await capturePreRestoreState(r.db,{restoreId,generation:7});const saved=JSON.stringify([...r.saved]);
   const original=r.saved.values().next().value.state_json;assert.equal(original.missing,missing);assert.equal(original.data_encoding,"postgres-json-text-line.v1");
   assert.deepEqual(await capturePreRestoreState(r.db,{restoreId,generation:"7"}),first);assert.equal(JSON.stringify([...r.saved]),saved);
   assert.equal(r.trace.updates,0);assert.equal(r.trace.inserts,10);assert.deepEqual(await compareRestoredState(r.db,{restoreId,generation:"7"}),[]);
   if(!missing){const row=r.saved.get(restoreId+"/employee_device_credentials");assert.ok(row.state_json.rows[0].includes('"created_at":"2026-10-17T00:00:00.123456+00:00"'));}
  }
 });
 await run("capture-generation-conflict",async()=>{
  const r=recording();await capturePreRestoreState(r.db,{restoreId,generation:max});const first=JSON.stringify([...r.saved]);
  await assert.rejects(capturePreRestoreState(r.db,{restoreId,generation:"9223372036854775806"}));assert.equal(JSON.stringify([...r.saved]),first);assert.equal(r.trace.updates,0);
 });
 await run("int64-identities-and-real-discrepancy",async()=>{
  const r=recording();await capturePreRestoreState(r.db,{restoreId,generation:max});const first=JSON.stringify([...r.saved]);
  assert.ok(r.saved.get(restoreId+"/device_assignments").state_json.rows[0].includes('"id":'+max));
  const raw=r.saved.get(restoreId+"/release_identity").state_json.rows[0];assert.ok(raw.includes('"beyond":9007199254740993,"precise":0.123456789012345678901,"lexical":1.000'));
  assert.notEqual(JSON.stringify(JSON.parse(raw)),raw,'The test DATA actually loses precision/lexical identity if reserialized');
  assert.deepEqual(await compareRestoredState(r.db,{restoreId,generation:max}),[]);r.state.changed=true;
  const differences=await compareRestoredState(r.db,{restoreId,generation:max});assert.equal(differences.length,10);
  for(const args of r.trace.discrepancies){assert.equal(args[1],max);assert.equal(args[5],"1");assert.equal(args[6],1);}
  assert.equal(JSON.stringify([...r.saved]),first);
 });
 await run("malformed-or-conflicting-stored-original",async()=>{
  const bad=[row=>row.restore_id="22222222-2222-4222-8222-222222222222",row=>row.authority_generation=1,
   row=>row.authority_generation="01",row=>row.authority_generation="2",row=>row.category="foreign",
   row=>row.row_count="01",row=>row.row_count=1,row=>row.row_count="9007199254740993",row=>row.snapshot_sha256="b".repeat(64),
   row=>row.state_json={},row=>row.state_json.rows=[],row=>row.state_json.fields="credential_id",
   row=>row.state_json.fields.push("unexpected"),row=>row.state_json.fields.reverse(),row=>row.state_json.extra=true,
   row=>delete row.state_json.data_encoding,row=>row.state_json.data_encoding="parsed-json.v0",row=>delete row.state_json.missing,
   row=>row.state_json.missing=true,row=>row.state_json.missing="false",row=>row.state_json.rows=[JSON.parse(row.state_json.rows[0])]];
  for(const change of bad)for(const mode of ["capture","compare"]){
   const r=recording();await capturePreRestoreState(r.db,{restoreId,generation:"1"});change(r.saved.values().next().value);
   const prior=JSON.stringify([...r.saved]),before=r.trace.categoryReads;
   await assert.rejects((mode==="capture"?capturePreRestoreState:compareRestoredState)(r.db,{restoreId,generation:"1"}));
   assert.equal(JSON.stringify([...r.saved]),prior);assert.equal(r.trace.updates,0);assert.equal(r.trace.discrepancies.length,0);
   if(mode==="compare")assert.equal(r.trace.categoryReads,before);
  }
 });
 await run("unavailable-or-duplicate-readback",async()=>{
  for(const malform of [result=>{result.rowCount=0;result.rows=[];},result=>{result.rowCount=2;result.rows.push(result.rows[0]);},
   result=>{result.rows=[];},result=>{result.rows[0].row_count="2";}]){
   const r=recording();await capturePreRestoreState(r.db,{restoreId,generation:"1"});const first=JSON.stringify([...r.saved]);r.state.malform=malform;
   await assert.rejects(capturePreRestoreState(r.db,{restoreId,generation:"1"}));await assert.rejects(compareRestoredState(r.db,{restoreId,generation:"1"}));
   assert.equal(JSON.stringify([...r.saved]),first);assert.equal(r.trace.updates,0);assert.equal(r.trace.discrepancies.length,0);
  }
 });
 await run("missing-versus-empty-and-schema",async()=>{
  const r=recording();r.state.missing=true;await capturePreRestoreState(r.db,{restoreId,generation:"1"});const saved=JSON.stringify([...r.saved]);
  r.state.missing=false;r.state.empty=true;const differences=await compareRestoredState(r.db,{restoreId,generation:"1"});assert.equal(differences.length,10);
  for(const args of r.trace.discrepancies){assert.equal(args[3],args[4]);assert.equal(args[5],"0");assert.equal(args[6],0);
   const details=JSON.parse(args[7]);assert.equal(details.pre_restore_missing,true);assert.equal(details.restored_missing,false);}
  await assert.rejects(capturePreRestoreState(r.db,{restoreId,generation:"1"}));assert.equal(JSON.stringify([...r.saved]),saved);
  const x=recording();x.state.empty=true;await capturePreRestoreState(x.db,{restoreId,generation:"1"});const original=JSON.stringify([...x.saved]);
  x.state.columns={device_auth_credentials:["credential_id"]};
  const schema=await compareRestoredState(x.db,{restoreId,generation:"1"});assert.equal(schema.length,1);
  await assert.rejects(capturePreRestoreState(x.db,{restoreId,generation:"1"}));assert.equal(JSON.stringify([...x.saved]),original);
 });
 await run("microsecond-byte-change",async()=>{
  const r=recording();await capturePreRestoreState(r.db,{restoreId,generation:"1"});const saved=JSON.stringify([...r.saved]);r.state.rawChange=true;
  await assert.rejects(capturePreRestoreState(r.db,{restoreId,generation:"1"}));assert.equal(JSON.stringify([...r.saved]),saved);
  const differences=await compareRestoredState(r.db,{restoreId,generation:"1"});assert.equal(differences.length,1);
  const details=JSON.parse(r.trace.discrepancies[0][7]);assert.ok(details.pre_restore_identities[0].includes(".123456+00:00"));
  assert.ok(details.restored_identities[0].includes(".123457+00:00"));assert.equal(JSON.stringify([...r.saved]),saved);
 });
 await run("invalid-original-binding-before-query",async()=>{
  let coercions=0;const invalid=["", "0","01","1\n"," 1","1 ","-1","1e3","9223372036854775808",0,-1,NaN,Infinity,
   9007199254740992,1n,null,undefined,{toString(){coercions++;return"1";}}];
  for(const generation of invalid)for(const operation of [capturePreRestoreState,compareRestoredState]){
   const r=recording();await assert.rejects(operation(r.db,{restoreId,generation}));assert.equal(r.trace.queries.length,0);}
  for(const bad of [null,"",restoreId+"\n",{},"not-a-uuid"])for(const operation of [capturePreRestoreState,compareRestoredState]){
   const r=recording();await assert.rejects(operation(r.db,{restoreId:bad,generation:"1"}));assert.equal(r.trace.queries.length,0);}
  assert.equal(coercions,0);
 });
 assert.ok(cases.length>0,"Unknown first-original snapshot case");
 console.log(JSON.stringify({scope:"NEW raw-original snapshot join; actual exported helpers with inert PostgreSQL TEXT-row recording",cases,count:cases.length,
  SQL:"NOT_RUN",connections:0,transactions:0,signatures:0,old_groups:0,resources0:true}));process.exit(0);
}

if (process.argv.includes("--normal-fresh-private-database-caller-only")) {
  const {readFileSync} = await import("node:fs");
  const text = readFileSync(new URL("./production-restore.mjs",import.meta.url),"utf8");
  const start = text.indexOf("const endRestoreClient = Client.prototype.end;");
  const legacyStart = text.indexOf('  restorePhase = "preflight";',start);
  const legacyEnd = text.indexOf('\n  }\n} catch (error) {\n  const outcomeUnknown',legacyStart);
  const end = text.indexOf("return restoreSuccessOutput;",legacyEnd)+"return restoreSuccessOutput;".length;
  assert.ok(start>=0&&legacyStart>start&&legacyEnd>legacyStart&&end>legacyEnd);
  // EXACT changed shipping lifecycle/branch/error/recovery code, excluding
  // ONLY the unchanged legacy body. Ports below are inert Source recordings,
  // not actual pg clients, verified archives, valid intents or SQL evidence.
  const shell = 'let restorePhase="connect",restoreTable=null;\n'+text.slice(start,legacyStart)
    +'throw new Error("Legacy flow must not run in the fresh caller recording");'+text.slice(legacyEnd,end);
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const execute = new AsyncFunction("db","Client","mutationFenceHeld","freshPrivateDatabase","restoreClientOptions",
    "restoreId","generation","archiveDigest","projectRef","verifiedArchive","intentEnvelope","intentVerifyKey","intentVerifyKeyId",
    "requireOriginalArchiveSource","stageVerifiedImmutableFreshData","commitVerifiedImmutableFreshData",
    "readVerifiedImmutableFreshDatabaseCommitOutcome","prepared","setControl","recordEvent","console",shell);
  const original = Object.freeze({restoreId:"11111111-1111-4111-8111-111111111111",generation:"1",
    archiveDigest:"a".repeat(64),targetProjectRef:"abcdefghijklmnopqrst"});
  const journey = async (options={}) => {
    const events=[],errors=[],prints=[],clients=[];
    const bodyError=options.error || Object.assign(Error("INERT Source stage refusal"),
      {code:"PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED",outcome:"UNKNOWN",retry_safe:false});
    const cleanupError=Error("INERT Source cleanup refusal");
    const config=Object.freeze({connectionString:"INERT_NO_CONNECTION"});
    const archive=Object.freeze({label:"INERT_NOT_A_VERIFIED_ARCHIVE"});
    const envelope=Object.freeze({label:"INERT_NOT_A_SIGNED_INTENT"});
    const key="INERT_NO_KEY_AUTHORITY",keyId="INERT_NO_KEY_ID_AUTHORITY";
    let sourceChecks=0,stages=0,commits=0,reads=0;
    const fails=stage=>options.failAt===stage||options.failAlso===stage;
    function Client(value) {assert.equal(value,config);this.name=clients.length?"reader":"original";clients.push(this);}
    Client.prototype.connect=async function(){events.push(this.name+":connect");
      if(fails(this.name+":connect"))throw bodyError;};
    Client.prototype.end=async function(){events.push(this.name+":native-end");
      if(fails(this.name+":end"))throw cleanupError;};
    Client.prototype.query=async function(sql){events.push(this.name+":"+sql);
      if(fails(this.name+":"+sql))throw cleanupError;
      assert.ok(!/truncate|replication_role|update |insert |delete |set role/i.test(sql),"No legacy/effect SQL in caller shell");
      if(sql.startsWith("select pg_advisory_unlock"))return {rowCount:1,rows:[{pg_advisory_unlock:true}]};
      return {rowCount:null,rows:[]};};
    const db=new Client(config);
    db.end=async()=>{throw Error("Instance end override must never execute");};
    const source=()=>{events.push("source");sourceChecks++;
      if(options.sourceFailureAt===sourceChecks)throw bodyError;};
    const stage=async args=>{stages++;events.push("stage");
      assert.deepEqual(Object.keys(args).sort(),["db","verifiedArchive","originalIntentEnvelope","intentVerifyKey","intentVerifyKeyId"].sort());
      assert.equal(args.db,db);assert.equal(args.verifiedArchive,archive);assert.equal(args.originalIntentEnvelope,envelope);
      assert.equal(args.intentVerifyKey,key);assert.equal(args.intentVerifyKeyId,keyId);
      if(fails("stage"))throw bodyError;
      return new Proxy({}, {get(_target,key){if(key==="then")return undefined;throw Error("Returned stage DATA must not be used as a capability");}});};
    const commit=async args=>{commits++;events.push("commit-api");
      assert.deepEqual(Object.keys(args).sort(),["db","verifiedArchive"]);assert.equal(args.db,db);assert.equal(args.verifiedArchive,archive);
      if(fails("commit"))throw bodyError;
      return Object.freeze({schema:"custodial.immutable-private-fresh-database-commit.v1",requested_original:original,
        commit_status:"ACKNOWLEDGED",database_phase_recorded:true,complete_restore:false,
        retry_allowed:false,rerun_import_allowed:false,resume_allowed:false});};
    const observe=async args=>{reads++;events.push("fixed-readonly-classifier");
      assert.equal(args.db,clients[1]);assert.notEqual(args.db,db);assert.equal(Object.isFrozen(args.request),true);
      assert.deepEqual(args.request,original);assert.deepEqual(Object.keys(args).sort(),["db","request"]);
      if(fails("observe"))throw cleanupError;
      return Object.freeze({schema:"custodial.immutable-private-fresh-commit-outcome.v1",requested_original:original,
        observation:"CURRENT_FIXED_READ",outcome:options.observedOutcome||"UNKNOWN",status:null,
        retry_allowed:false,resume_allowed:false,rerun_import_allowed:false,complete_restore:false,metadata_only:true});};
    let output,failure,failed=false;
    try {output=await execute(db,Client,false,true,config,original.restoreId,1,original.archiveDigest,original.targetProjectRef,
      archive,envelope,key,keyId,source,stage,commit,observe,false,
      async()=>{throw Error("No caller control mutation on fresh branch");},async()=>{throw Error("No caller event mutation on fresh branch");},
      {error(value){events.push("error-output");errors.push(JSON.parse(value));},log(value){prints.push(value);}});}
    catch(error){failed=true;failure=error;}
    return {events,errors,prints,clients,stages,commits,reads,sourceChecks,failed,failure,bodyError,cleanupError,
      output:output===undefined?undefined:JSON.parse(output)};
  };
  let passed=0;
  const run=async(name,test)=>{await test();passed++;console.log(`NORMAL_FRESH_PRIVATE_CALLER_NEW ${name} PASS`);};
  await run("local-only-selection-exact-uri-and-production-preconnect-hold",()=>{
    const declaration=text.slice(text.indexOf("const freshPrivateDatabase ="),text.indexOf("const freshPrivateDatabase =")+text.slice(text.indexOf("const freshPrivateDatabase =")).indexOf(";")+1);
    const select=new Function("databaseOnly","privateImportBlocker",declaration+"return freshPrivateDatabase;");
    for(const local of [false,true])for(const blocker of [null,"PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED"])
      assert.equal(select(local,blocker),local&&blocker!==null);
    const holdStart=text.indexOf("if (privateImportBlocker !== null && !freshPrivateDatabase) {");
    const holdEnd=text.indexOf("const databaseTables =",holdStart);
    const hold=new Function("privateImportBlocker","freshPrivateDatabase",text.slice(holdStart,holdEnd));
    assert.throws(()=>hold("PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED",false),error=>error.code==="PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED");
    assert.doesNotThrow(()=>hold("PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED",true));
    const uriStart=text.indexOf('if (!databaseUrl) throw new Error(');
    const uriEnd=text.indexOf('const intentVerifyKey =',uriStart);
    const guard=new Function("databaseUrl","databaseOnly","projectRef","confirmedRef","summary","secret",text.slice(uriStart,uriEnd));
    const check=url=>guard(url,true,original.targetProjectRef,original.targetProjectRef,{project_ref:original.targetProjectRef},"");
    for(const url of ["postgresql://localhost/mz_schema_rebuild_new","postgres://127.0.0.1/mz_schema_rebuild_new"])assert.doesNotThrow(()=>check(url));
    for(const url of ["postgres://remote/mz_schema_rebuild_new","postgres://localhost/postgres",
      "postgres://localhost/mz_schema_rebuild_new?host=remote","postgres://localhost/mz_schema_rebuild_new#x","http://localhost/mz_schema_rebuild_new"])
      assert.throws(()=>check(url),/restricted to a loopback/);
    assert.match(text,/import \{stageVerifiedImmutablePrivateData,stageVerifiedImmutableFreshData,commitVerifiedImmutableFreshData\} from '\.\/immutable-private-data-import.mjs'/);
    assert.match(text,/import \{readVerifiedImmutableFreshDatabaseCommitOutcome\} from '\.\/immutable-private-fresh-restore-recovery.mjs'/);
  });
  await run("one-original-transaction-two-fences-stage-then-private-one-shot-commit",async()=>{
    const result=await journey();assert.equal(result.failed,false);assert.equal(result.stages,1);assert.equal(result.commits,1);
    assert.equal(result.clients.length,1);assert.equal(result.reads,0);assert.deepEqual(result.errors,[]);assert.deepEqual(result.prints,[]);
    const actions=result.events.filter(value=>value!=="source");
    assert.deepEqual(actions,["original:connect","original:select pg_advisory_lock(hashtextextended('memphis-zoo-production-restore',0))",
      "original:begin","original:set local search_path = pg_catalog","original:set local row_security = off",
      "original:select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))",
      "original:select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))",
      "stage","commit-api","original:select pg_advisory_unlock(hashtextextended('memphis-zoo-production-restore',0))","original:native-end"]);
    assert.equal(result.sourceChecks,7);assert.equal(result.output.complete_restore,false);assert.equal(result.output.mutations_paused,true);
    for(const key of ["resume_allowed","retry_allowed","rerun_import_allowed"])assert.equal(result.output[key],false);
    assert.equal(result.output.database_phase.commit_status,"ACKNOWLEDGED");assert.equal(result.output.state,"DATABASE_RESTORED");
    assert.deepEqual(result.output.remaining_phases,["STORAGE","AUTHORITY_RECONCILIATION","POST_RESTORE_VERIFICATION","SIGNED_RECONCILIATION"]);
    assert.equal(result.output.normal_production_private_apply,"PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED");
  });
  await run("source-withdrawal-or-stage-refusal-rolls-back-without-commit-or-recovery",async()=>{
    for(const options of [{sourceFailureAt:7},{failAt:"stage"}]){
      const result=await journey(options);assert.equal(result.failure,result.bodyError);assert.equal(result.commits,0);assert.equal(result.reads,0);
      assert.equal(result.events.filter(value=>value==="original:rollback").length,1);assert.equal(result.clients.length,1);
      assert.equal(result.events.at(-2),"original:native-end");assert.equal(result.events.at(-1),"error-output");
      assert.equal(result.errors[0].outcome,"UNKNOWN");assert.equal(result.errors[0].complete_restore,false);
    }
  });
  await run("explicit-precommit-denial-cleans-up-with-original-status-request-no-replay",async()=>{
    const error=Object.assign(Error("INERT not admitted"),{code:"IMMUTABLE_PRIVATE_DATA_COMMIT_NOT_ADMITTED",outcome:"UNKNOWN",retry_safe:false,commit_attempted:false});
    const result=await journey({failAt:"commit",error});assert.equal(result.failure,error);assert.equal(result.commits,1);assert.equal(result.reads,0);
    assert.equal(result.events.filter(value=>value==="original:rollback").length,1);
    assert.deepEqual(result.errors[0].original_status_request,original);assert.equal(result.errors[0].code,error.code);
  });
  await run("ambiguous-commit-no-rollback-no-failure-mutation-distinct-readonly-recovery",async()=>{
    for(const observedOutcome of ["UNKNOWN","DATABASE_MARKERS_OBSERVED"]){
      const error=Object.assign(Error("INERT ambiguous commit"),{code:"IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN",outcome:"UNKNOWN",retry_safe:false,commit_attempted:true});
      const result=await journey({failAt:"commit",error,observedOutcome});assert.equal(result.failure,error);assert.equal(result.commits,1);assert.equal(result.reads,1);
      assert.equal(result.events.includes("original:rollback"),false);assert.equal(result.clients.length,2);
      assert.ok(result.events.indexOf("original:native-end")<result.events.indexOf("reader:connect"));
      assert.ok(result.events.indexOf("reader:begin isolation level repeatable read read only")<result.events.indexOf("fixed-readonly-classifier"));
      assert.deepEqual(result.events.slice(-3),["reader:rollback","reader:native-end","error-output"]);
      const out=result.errors[0];assert.equal(out.ok,false);assert.equal(out.outcome,"UNKNOWN");assert.equal(out.retry_safe,false);
      assert.deepEqual(out.original_status_request,original);assert.equal(out.original_commit_observation.outcome,observedOutcome);
      assert.equal(out.complete_restore,false);assert.equal(out.resume_allowed,false);assert.equal(result.output,undefined);
    }
  });
  await run("unclassified-commit-error-conservatively-unknown-without-write-retry",async()=>{
    const result=await journey({failAt:"commit",error:Error("INERT protocol exception")});assert.equal(result.failed,true);assert.equal(result.reads,1);
    assert.equal(result.failure.code,"IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN");assert.equal(result.failure.retry_safe,false);
    assert.equal(result.events.includes("original:rollback"),false);assert.equal(result.commits,1);
  });
  await run("cleanup-failures-no-success-no-reader-before-original-drain",async()=>{
    const ended=await journey({failAt:"original:end"});assert.equal(ended.failed,true);assert.equal(ended.output,undefined);assert.equal(ended.reads,0);
    const lock=await journey({failAt:"original:select pg_advisory_lock(hashtextextended('memphis-zoo-production-restore',0))"});
    assert.equal(lock.failed,true);assert.equal(lock.stages,0);assert.equal(lock.commits,0);assert.equal(lock.events.at(-1),"original:native-end");
    const connect=await journey({failAt:"original:connect"});assert.equal(connect.failed,true);assert.deepEqual(connect.events,["original:connect","original:native-end"]);
  });
  await run("observation-cleanup-failure-preserves-unknown-first-no-completion",async()=>{
    const error=Object.assign(Error("INERT unknown"),{code:"IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN",outcome:"UNKNOWN",retry_safe:false,commit_attempted:true});
    for(const failAlso of ["reader:rollback","reader:end","reader:connect","observe","original:end"]){
      const result=await journey({failAt:"commit",failAlso,error});assert.equal(result.failed,true);
      assert.ok(result.failure instanceof AggregateError);assert.equal(result.failure.cause,error);
      assert.equal(result.failure.errors[0],error);assert.equal(result.errors[0].outcome,"UNKNOWN");
      assert.equal(result.errors[0].original_commit_observation,undefined);assert.equal(result.output,undefined);
      assert.equal(result.events.includes("original:rollback"),false);
      if(failAlso==="original:end")assert.equal(result.clients.length,1);
      else assert.ok(result.events.includes("reader:native-end"));
    }
    const stageRollback=await journey({failAt:"stage",failAlso:"original:rollback"});
    assert.ok(stageRollback.failure instanceof AggregateError);assert.equal(stageRollback.failure.cause,stageRollback.bodyError);
    assert.deepEqual(stageRollback.failure.errors,[stageRollback.bodyError,stageRollback.cleanupError]);
    assert.equal(stageRollback.errors[0].outcome,"UNKNOWN");assert.equal(stageRollback.commits,0);
  });
  console.log(`NORMAL_FRESH_PRIVATE_CALLER_NEW ${passed} groups PASS; inert Source ports only; SQL/auth/COMMIT/native recovery NOT_RUN`);
  process.exit(0);
}

if (process.argv.includes("--restore-cli-lifecycle-only")) {
  const {readFileSync}=await import("node:fs");
  const text=readFileSync(new URL("./production-restore.mjs",import.meta.url),"utf8");
  const lifecycleStart=text.indexOf("const endRestoreClient = Client.prototype.end;");
  const bodyStart=text.indexOf('try {\n  restorePhase = "preflight";',lifecycleStart);
  const bodyEnd=text.indexOf("\n} catch (error) {\n  restoreLifecycleFailed = true;",bodyStart);
  assert.ok(lifecycleStart>=0&&bodyStart>lifecycleStart&&bodyEnd>bodyStart);
  // Execute the EXACT shipping lifecycle shell, replacing ONLY its existing
  // restore body/error handler with an inert awaited body. No pg connection,
  // SQL, Source/archive verification, signature or authority is simulated.
  const shell=text.slice(lifecycleStart,bodyStart)+
    "restoreSuccessOutput = await body(() => { mutationFenceHeld = true; });"+text.slice(bodyEnd);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const execute=new AsyncFunction("db","Client","mutationFenceHeld","body","console",shell);
  const lock="select pg_advisory_lock(hashtextextended('memphis-zoo-production-restore',0))";
  const unlock="select pg_advisory_unlock(hashtextextended('memphis-zoo-production-restore',0))";
  const mutationUnlock="select pg_advisory_unlock(hashtextextended('memphis-zoo-application-mutation-fence',0))";
  const success=JSON.stringify({ok:true,state:"PAUSED_RECONCILIATION",mutations_paused:true});
  const journey=async(options={})=>{
    const events=[],prints=[];
    const errors={connect:Error("RECORDING connect"),lock:Error("RECORDING lock"),
      body:Error("RECORDING body"),unlock:Error("RECORDING unlock"),mutation:Error("RECORDING mutation unlock"),end:Error("RECORDING end")};
    const shouldFail=(stage)=>options.fail?.includes(stage);
    function Client(){}
    Client.prototype.end=async function(){assert.equal(this,db);events.push("native-end");if(shouldFail("end"))throw errors.end;};
    const db={async connect(){events.push("connect");if(shouldFail("connect"))throw errors.connect;},
      async query(sql){
        events.push(sql);
        if(sql===lock){if(shouldFail("lock"))throw errors.lock;return {rowCount:1,rows:[{pg_advisory_lock:""}]};}
        assert.ok(sql===unlock||sql===mutationUnlock,"No other SQL may execute in inert lifecycle check");
        const stage=sql===unlock?"unlock":"mutation";
        if(shouldFail(stage))throw errors[stage];
        if(options.badResult?.[stage])return options.badResult[stage];
        return {rowCount:1,rows:[{pg_advisory_unlock:true}]};
      },end(){events.push("instance-end-override");throw Error("Must use captured native end");}};
    let error,failed=false;
    try{await execute(db,Client,false,async(markMutationHeld)=>{
      events.push("body");if(options.mutationHeld)markMutationHeld();
      if(options.replacePrototypeEnd)Client.prototype.end=async()=>{events.push("replacement-end");throw Error("late replacement");};
      if(Object.hasOwn(options,"bodyFailure"))throw options.bodyFailure;
      if(shouldFail("body"))throw errors.body;
      return success;
    },{log(value){events.push("print");prints.push(value);}});}catch(caught){failed=true;error=caught;}
    return {events,prints,error,failed,errors};
  };
  let passed=0;
  const run=async(name,test)=>{await test();passed++;console.log(`RESTORE_CLI_LIFECYCLE_NEW ${name} PASS`);};
  await run("connect-failure-always-native-end-no-unconfirmed-unlock",async()=>{
    const result=await journey({fail:["connect"]});assert.equal(result.error,result.errors.connect);
    assert.deepEqual(result.events,["connect","native-end"]);assert.deepEqual(result.prints,[]);
  });
  await run("initial-lock-error-always-native-end-no-unconfirmed-unlock",async()=>{
    const result=await journey({fail:["lock"]});assert.equal(result.error,result.errors.lock);
    assert.deepEqual(result.events,["connect",lock,"native-end"]);assert.deepEqual(result.prints,[]);
  });
  await run("success-output-after-confirmed-unlocks-and-captured-native-end",async()=>{
    for(const mutationHeld of [false,true]){
      const result=await journey({mutationHeld,replacePrototypeEnd:true});assert.equal(result.failed,false);
      assert.deepEqual(result.events,["connect",lock,"body",unlock,...(mutationHeld?[mutationUnlock]:[]),"native-end","print"]);
      assert.deepEqual(result.prints,[success]);
    }
  });
  await run("body-error-identity-unknown-and-primitive-failures-retained",async()=>{
    const unknown=Object.freeze(Object.assign(Error("RECORDING unknown"),{outcome:"UNKNOWN",retry_safe:false,
      code:"IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN"}));
    for(const bodyFailure of [unknown,undefined,null,"primitive failure"]){
      const result=await journey({bodyFailure,mutationHeld:true});assert.equal(result.failed,true);
      assert.equal(result.error,bodyFailure);assert.deepEqual(result.prints,[]);
      assert.deepEqual(result.events,["connect",lock,"body",unlock,mutationUnlock,"native-end"]);
    }
  });
  await run("each-cleanup-error-fails-success-and-still-drains-native-end",async()=>{
    for(const stage of ["unlock","mutation","end"]){
      const result=await journey({fail:[stage],mutationHeld:true});assert.equal(result.error,result.errors[stage]);
      assert.deepEqual(result.events,["connect",lock,"body",unlock,mutationUnlock,"native-end"]);
      assert.deepEqual(result.prints,[]);
    }
  });
  await run("false-or-malformed-unlock-is-failure-not-success",async()=>{
    for(const stage of ["unlock","mutation"])for(const value of [
      {rowCount:1,rows:[{pg_advisory_unlock:false}]},{rowCount:0,rows:[]},
      {rowCount:2,rows:[{pg_advisory_unlock:true}]},{rowCount:1,rows:[{pg_advisory_unlock:"true"}]},
    ]){
      const result=await journey({mutationHeld:true,badResult:{[stage]:value}});
      assert.equal(result.failed,true);assert.match(result.error.message,/lock release was not confirmed/);
      assert.equal(result.events.at(-1),"native-end");assert.deepEqual(result.prints,[]);
    }
  });
  await run("body-first-and-every-cleanup-error-preserved-in-order",async()=>{
    const result=await journey({mutationHeld:true,fail:["body","unlock","mutation","end"]});
    assert.ok(result.error instanceof AggregateError);assert.equal(result.error.cause,result.errors.body);
    assert.deepEqual(result.error.errors,[result.errors.body,result.errors.unlock,result.errors.mutation,result.errors.end]);
    assert.deepEqual(result.events,["connect",lock,"body",unlock,mutationUnlock,"native-end"]);assert.deepEqual(result.prints,[]);
    for(const early of ["connect","lock"]){
      const failed=await journey({fail:[early,"end"]});assert.ok(failed.error instanceof AggregateError);
      assert.equal(failed.error.cause,failed.errors[early]);assert.deepEqual(failed.error.errors,[failed.errors[early],failed.errors.end]);
      assert.deepEqual(failed.prints,[]);
    }
  });
  await run("multiple-cleanup-errors-retain-first-cause-no-success",async()=>{
    const result=await journey({mutationHeld:true,fail:["unlock","mutation","end"]});
    assert.ok(result.error instanceof AggregateError);assert.equal(result.error.cause,result.errors.unlock);
    assert.deepEqual(result.error.errors,[result.errors.unlock,result.errors.mutation,result.errors.end]);assert.deepEqual(result.prints,[]);
  });
  console.log(`RESTORE_CLI_LIFECYCLE_NEW ${passed} groups PASS; inert Source only; native SQL/restore/signing NOT_RUN`);
  process.exit(0);
}

if (process.argv.includes("--fresh-commit-status-cli-only")) {
  const {readFileSync}=await import("node:fs"),{spawnSync}=await import("node:child_process");
  const cliUrl=new URL("./create-production-restore-reconciliation.mjs",import.meta.url);
  const text=readFileSync(cliUrl,"utf8");
  const configStart=text.indexOf("const databaseUrl = ");
  const configEnd=text.indexOf("const actor = ",configStart);
  const config=text.slice(configStart,configEnd);
  const readConfig=new Function("process",config+"\nreturn {statusMode,statusRequest,statusCommitOutcome};");
  const request={restoreId:"11111111-1111-4111-8111-111111111111",generation:"1",
    archiveDigest:"a".repeat(64),targetProjectRef:"abcdefghijklmnopqrst"};
  const statusEnv={SUPABASE_PROJECT_REF:request.targetProjectRef,
    RESTORE_RECONCILIATION_STATUS_ID:request.restoreId,
    RESTORE_RECONCILIATION_STATUS_GENERATION:request.generation,
    RESTORE_RECONCILIATION_STATUS_ARCHIVE_DIGEST:request.archiveDigest};
  const flag="RESTORE_RECONCILIATION_STATUS_COMMIT_OUTCOME";
  const statusStart=text.indexOf("if (statusMode) {\n  let status, firstFailure;");
  const statusEnd=text.indexOf("} else {\nawait db.connect();",statusStart);
  assert.ok(configStart>=0&&configEnd>configStart&&statusStart>=0&&statusEnd>statusStart);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const executeStatus=new AsyncFunction("db","Client","statusMode","statusRequest","statusCommitOutcome",
    "readOriginalRestoreDatabaseStatus","readVerifiedImmutableFreshDatabaseCommitOutcome","console",
    text.slice(statusStart,statusEnd)+"}\n");
  // Explicit Source/caller recordings ONLY: these objects are NOT native pg
  // clients, authenticated owners, snapshots or SQL/COMMIT evidence. The real
  // shipping import is inspected below; no production reader is substituted.
  const legacy={schema:"memphis-zoo-restore-original-status.v1",restore_id:request.restoreId,
    authority_generation:request.generation,archive_digest:request.archiveDigest,target_project_ref:request.targetProjectRef,
    state:"PAUSED_RECONCILIATION",mutations_paused:true,database_marker_status:"UNRESOLVED",database_verified:null,
    prior_unknown_recorded:true,metadata_only:true,retry_allowed:false,resume_allowed:false,rerun_import_allowed:false,complete_restore:false};
  const outcome={schema:"custodial.immutable-private-fresh-commit-outcome.v1",requested_original:{...request},
    observation:"UNAVAILABLE",outcome:"UNKNOWN",status:null,retry_allowed:false,resume_allowed:false,
    rerun_import_allowed:false,complete_restore:false,metadata_only:true};
  const journey=async(commitOutcome,failAt=null)=>{
    const events=[],prints=[],originalError=new Error(`RECORDING first failure ${failAt}`);
    function Client(){}
    Client.prototype.end=async function(){assert.equal(this,db);events.push("end");if(failAt==="end")throw originalError;};
    const db={async connect(){events.push("connect");if(failAt==="connect")throw originalError;},
      async query(sql){events.push(sql);if(failAt===sql)throw originalError;}};
    const read=async(client,captured)=>{assert.equal(client,db);assert.equal(captured,request);events.push("legacy-reader");
      if(failAt==="reader")throw originalError;return legacy;};
    const classifier=async(options)=>{assert.deepEqual(Object.keys(options).sort(),["db","request"]);
      assert.equal(options.db,db);assert.equal(options.request,request);events.push("commit-outcome-reader");
      if(failAt==="reader")throw originalError;return outcome;};
    let error;
    try{await executeStatus(db,Client,true,request,commitOutcome,read,classifier,
      {log(value){events.push("print");prints.push(value);}});}catch(caught){error=caught;}
    return {events,prints,error,originalError};
  };
  let passed=0;
  const run=async(name,test)=>{await test();passed++;console.log(`FRESH_COMMIT_STATUS_CLI_NEW ${name} PASS`);};
  await run("explicit-flag-configuration-and-original-request",()=>{
    for(const value of [undefined,"false","true"]){
      const env={...statusEnv};if(value!==undefined)env[flag]=value;
      const captured=readConfig({env});assert.equal(captured.statusMode,true);
      assert.equal(captured.statusCommitOutcome,value==="true");assert.deepEqual(captured.statusRequest,request);
    }
    for(const value of [undefined,"false"]){
      const env={};if(value!==undefined)env[flag]=value;
      assert.deepEqual(readConfig({env}),{statusMode:false,statusRequest:null,statusCommitOutcome:false});
    }
    for(const value of ["","TRUE","False","1"," true","true ","yes",true,null])
      assert.throws(()=>readConfig({env:{...statusEnv,[flag]:value}}),/must be exactly true or false/);
    assert.throws(()=>readConfig({env:{[flag]:"true"}}),/requires complete original status configuration/);
    assert.throws(()=>readConfig({env:{[flag]:"true",RESTORE_RECONCILIATION_STATUS_ID:request.restoreId}}),/Original status requires/);
    for(const project of [undefined,"", "a".repeat(19),"A".repeat(20)])
      assert.throws(()=>readConfig({env:{...statusEnv,SUPABASE_PROJECT_REF:project,[flag]:"true"}}),/requires complete original status configuration/);
  });
  await run("absent-and-false-preserve-exact-legacy-output-one-read",async()=>{
    for(const value of [undefined,"false"]){
      const env={...statusEnv};if(value!==undefined)env[flag]=value;
      const result=await journey(readConfig({env}).statusCommitOutcome);
      assert.equal(result.error,undefined);assert.deepEqual(result.events,["connect","begin isolation level repeatable read read only",
        "legacy-reader","rollback","end","print"]);
      assert.deepEqual(result.prints,[JSON.stringify(legacy)]);assert.equal(Object.keys(JSON.parse(result.prints[0])).length,15);
    }
  });
  await run("opt-in-replaces-direct-reader-with-one-real-named-classifier-call",async()=>{
    assert.ok(text.includes('import { readVerifiedImmutableFreshDatabaseCommitOutcome } from "./immutable-private-fresh-restore-recovery.mjs";'));
    const result=await journey(readConfig({env:{...statusEnv,[flag]:"true"}}).statusCommitOutcome);
    assert.equal(result.error,undefined);assert.deepEqual(result.events,["connect","begin isolation level repeatable read read only",
      "commit-outcome-reader","rollback","end","print"]);
    assert.deepEqual(result.prints,[JSON.stringify(outcome)]);
    assert.equal(result.events.includes("legacy-reader"),false);
    assert.equal(JSON.parse(result.prints[0]).outcome,"UNKNOWN");
  });
  await run("cleanup-failure-never-emits-classifier-success",async()=>{
    for(const failAt of ["rollback","end"]){
      const result=await journey(true,failAt);assert.equal(result.error,result.originalError);assert.deepEqual(result.prints,[]);
      assert.deepEqual(result.events,["connect","begin isolation level repeatable read read only","commit-outcome-reader","rollback","end"]);
    }
  });
  await run("first-reader-failure-and-early-failures-drain-existing-cleanup",async()=>{
    for(const failAt of ["reader","connect","begin isolation level repeatable read read only"]){
      const result=await journey(true,failAt);assert.equal(result.error,result.originalError);assert.deepEqual(result.prints,[]);
      assert.equal(result.events.at(-1),"end");
      if(failAt==="connect")assert.deepEqual(result.events,["connect","end"]);
      else assert.equal(result.events.at(-2),"rollback");
      if(failAt!=="reader")assert.equal(result.events.includes("commit-outcome-reader"),false);
    }
  });
  await run("actual-cli-invalid-opt-in-refuses-preconnect-without-signing-config",()=>{
    // No database URL, credential, key, storage/provider configuration or
    // inherited environment. Expected refusal precedes Client construction.
    const cases=[
      [{[flag]:"TRUE"},"must be exactly true or false"],
      [{[flag]:""},"must be exactly true or false"],
      [{[flag]:"true"},"requires complete original status configuration"],
      [{[flag]:"true",RESTORE_RECONCILIATION_STATUS_ID:request.restoreId},"Original status requires"],
      [{...statusEnv,SUPABASE_PROJECT_REF:"bad",[flag]:"true"},"requires complete original status configuration"],
    ];
    for(const [env,message]of cases){
      const result=spawnSync(process.execPath,["--max-old-space-size=128",cliUrl.pathname],
        {env,encoding:"utf8",timeout:5000,maxBuffer:65536});
      if(result.error)throw result.error; // Preserve denial; no alternate route/retry.
      assert.equal(result.status,1);assert.equal(result.signal,null);assert.equal(result.stdout,"");
      assert.ok(result.stderr.includes(message),result.stderr);
      assert.ok(!result.stderr.includes("RESTORE_RECONCILIATION_SIGNING_KEY must"));
      assert.ok(!result.stderr.includes("ECONN")&&!result.stderr.includes("ENOTFOUND"));
    }
  });
  console.log(`FRESH_COMMIT_STATUS_CLI_NEW ${passed} groups PASS; caller recordings/config refusals only; SQL/signing NOT_RUN`);
  process.exit(0);
}

if (process.argv.includes("--immutable-fresh-commit-recovery-only")) {
  const {readFileSync}=await import("node:fs"),{isProxy}=await import("node:util/types");
  const text=readFileSync(new URL("./immutable-private-fresh-restore-recovery.mjs",import.meta.url),"utf8");
  const body=text.replace(/^import .*;\n/gm,"").replace("export async function ","async function ");
  // Recorded reader DTOs are DATA ONLY, not an actual owner/client, SQL
  // snapshot, COMMIT, signed intent, archive or restore admission. Shipping
  // imports the real fixed reader; there is no injected production port.
  const recording=(reader)=>new Function("isProxy","readOriginalRestoreDatabaseStatus",body+
    "\nreturn readVerifiedImmutableFreshDatabaseCommitOutcome;")(isProxy,reader);
  const request=()=>({restoreId:"11111111-1111-4111-8111-111111111111",generation:"1",
    archiveDigest:"a".repeat(64),targetProjectRef:"abcdefghijklmnopqrst"});
  const dto=(original=request(),changes={})=>({schema:"memphis-zoo-restore-original-status.v1",
    restore_id:original.restoreId,authority_generation:original.generation,archive_digest:original.archiveDigest,
    target_project_ref:original.targetProjectRef,state:"DATABASE_RESTORED",mutations_paused:true,
    database_marker_status:"OBSERVED_DATABASE_MARKERS",database_verified:true,prior_unknown_recorded:false,
    metadata_only:true,retry_allowed:false,resume_allowed:false,rerun_import_allowed:false,complete_restore:false,...changes});
  const outputKeys=["schema","requested_original","observation","outcome","status","retry_allowed",
    "resume_allowed","rerun_import_allowed","complete_restore","metadata_only"].sort();
  const checkLimits=(value)=>{
    assert.deepEqual(Object.keys(value).sort(),outputKeys);
    assert.equal(value.schema,"custodial.immutable-private-fresh-commit-outcome.v1");
    assert.equal(value.metadata_only,true);
    for(const key of ["retry_allowed","resume_allowed","rerun_import_allowed","complete_restore"])
      assert.equal(value[key],false);
    assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.requested_original));
  };
  const invalid=(error)=>error.code==="IMMUTABLE_FRESH_COMMIT_RECOVERY_INVALID";
  let passed=0;
  const run=async(name,test)=>{await test();passed++;console.log(`IMMUTABLE_FRESH_COMMIT_RECOVERY_NEW ${name} PASS`);};
  await run("invalid-options-request-refuse-before-recorded-reader",async()=>{
    let calls=0,traps=0;
    const read=recording(async()=>{calls++;throw Error("must not be called");});
    const proxy=new Proxy({}, {ownKeys(){traps++;throw Error("proxy trap");},get(){traps++;throw Error("proxy trap");},
      getPrototypeOf(){traps++;throw Error("proxy trap");}});
    const getter=Object.defineProperty({db:{}},"request",{enumerable:true,get(){traps++;return request();}});
    for(const options of [undefined,null,[],proxy,getter,{db:{},request:request(),extra:true},
      {db:{},request:proxy},{db:{},request:{...request(),toJSON(){traps++;return request();}}},
      {db:{},request:Object.create(request())},
      {db:{},request:Object.defineProperty(request(),"generation",{enumerable:true,get(){traps++;return "1";}})},
      {db:{},request:{...request(),[Symbol("extra")]:1}}]) await assert.rejects(()=>read(options),invalid);
    for(const [key,values]of [
      ["restoreId",[null,"11111111-1111-4111-8111-11111111111A",request().restoreId+"\n",1]],
      ["generation",[1,1n,"0","01","-1","1.0","1\n","9223372036854775808"]],
      ["archiveDigest",[null,"A".repeat(64),"a".repeat(63),"a".repeat(64)+"\n"]],
      ["targetProjectRef",[null,"A".repeat(20),"a".repeat(19),request().targetProjectRef+"\n"]],
    ]) for(const value of values) await assert.rejects(()=>read({db:{},request:{...request(),[key]:value}}),invalid);
    assert.equal(calls,0);assert.equal(traps,0);
  });
  await run("detached-before-await-one-reader-and-frozen-original-status",async()=>{
    let calls=0,resolve,recorded;
    const db={},original=request(),before={...original};
    const read=recording((client,copy)=>{calls++;assert.equal(client,db);recorded=copy;
      return new Promise(done=>{resolve=done;});});
    const options={db,request:original};
    const pending=read(options);
    assert.equal(calls,1);assert.notEqual(recorded,original);assert.ok(Object.isFrozen(recorded));
    original.restoreId="22222222-2222-4222-8222-222222222222";original.generation="2";
    original.archiveDigest="b".repeat(64);original.targetProjectRef="b".repeat(20);
    options.request=request();options.db={};
    const status=dto(before,{prior_unknown_recorded:true});resolve(status);
    const value=await pending;checkLimits(value);
    assert.deepEqual(value.requested_original,before);assert.deepEqual(recorded,before);
    assert.equal(value.observation,"CURRENT_FIXED_READ");assert.equal(value.outcome,"DATABASE_MARKERS_OBSERVED");
    assert.deepEqual(value.status,status);assert.notEqual(value.status,status);assert.ok(Object.isFrozen(value.status));
    assert.equal(value.status.prior_unknown_recorded,true);
    const serialized=JSON.stringify(value);
    for(const object of [value,value.requested_original,value.status]) for(const key of Object.keys(object)){
      assert.equal(Reflect.set(object,key,null),false);assert.equal(Reflect.deleteProperty(object,key),false);
      assert.equal(Reflect.defineProperty(object,key,{value:null}),false);
    }
    status.restore_id=original.restoreId;status.prior_unknown_recorded=false;status.state="COMPLETE";
    assert.equal(JSON.stringify(value),serialized);assert.equal(calls,1);
  });
  await run("marker-absence-and-unresolved-never-mean-rollback",async()=>{
    for(const changes of [
      {database_marker_status:"NOT_OBSERVED",database_verified:false},
      {database_marker_status:"UNRESOLVED",database_verified:null,prior_unknown_recorded:true},
      {database_marker_status:"UNRESOLVED",database_verified:true},
    ]){
      let calls=0;const status=dto(request(),changes);
      const result=await recording(async()=>{calls++;return status;})({db:{},request:request()});
      checkLimits(result);assert.equal(calls,1);assert.equal(result.observation,"CURRENT_FIXED_READ");
      assert.equal(result.outcome,"UNKNOWN");assert.deepEqual(result.status,status);
    }
  });
  await run("unavailable-retains-only-requested-not-observed-facts",async()=>{
    let calls=0;
    const value=await recording(async()=>{calls++;throw Error("recorded fixed reader unavailable");})({db:{},request:request()});
    checkLimits(value);assert.equal(calls,1);assert.deepEqual(value.requested_original,request());
    assert.equal(value.observation,"UNAVAILABLE");assert.equal(value.outcome,"UNKNOWN");assert.equal(value.status,null);
    assert.equal(Object.hasOwn(value,"prior_unknown_recorded"),false);
  });
  await run("unsupported-mismatched-or-effectful-reader-data-never-positive",async()=>{
    let traps=0;
    const absent=dto();delete absent.state;
    const getter=Object.defineProperty(dto(),"state",{enumerable:true,get(){traps++;return "COMPLETE";}});
    const proxy=new Proxy(dto(),{ownKeys(){traps++;throw Error("proxy trap");},getPrototypeOf(){traps++;throw Error("proxy trap");}});
    const bad=[null,{},[],absent,getter,proxy,dto(request(),{extra:false}),dto(request(),{[Symbol("extra")]:1})];
    for(const [key,value]of [["schema","other"],["restore_id","22222222-2222-4222-8222-222222222222"],
      ["authority_generation",1],["archive_digest","b".repeat(64)],["target_project_ref","b".repeat(20)],
      ["state","UNSUPPORTED"],["mutations_paused",null],["prior_unknown_recorded",0],["database_verified","true"],
      ["metadata_only",false],["retry_allowed",true],["resume_allowed",true],["rerun_import_allowed",true],
      ["complete_restore",true],["database_marker_status","ROLLED_BACK"]]) bad.push(dto(request(),{[key]:value}));
    bad.push(dto(request(),{database_verified:false}));
    bad.push(dto(request(),{database_marker_status:"NOT_OBSERVED",database_verified:true}));
    bad.push(dto(request(),{database_marker_status:"NOT_OBSERVED",database_verified:false,prior_unknown_recorded:true}));
    for(const status of bad){
      let calls=0;const value=await recording(async()=>{calls++;return status;})({db:{},request:request()});
      checkLimits(value);assert.equal(calls,1);assert.equal(value.observation,"UNAVAILABLE");
      assert.equal(value.outcome,"UNKNOWN");assert.equal(value.status,null);
    }
    assert.equal(traps,0);
  });
  await run("exact-reader-states-and-int64-generation-metadata-only",async()=>{
    for(const state of ["READY","PREPARING","DATABASE_RESTORED","STORAGE_RESTORING","VERIFYING", "PAUSED_FAILURE","PAUSED_RECONCILIATION","COMPLETE"]){
      const original={...request(),generation:"9223372036854775807"};
      const status=dto(original,{state,mutations_paused:false});
      const result=await recording(async()=>status)({db:{},request:original});
      checkLimits(result);assert.equal(result.observation,"CURRENT_FIXED_READ");assert.deepEqual(result.status,status);
    }
    // No expiry/token/clock input or renewal: this API is a fixed metadata read.
    assert.ok(!text.includes("Date.now")&&!text.includes("expires_at"));
    assert.equal((text.match(/await readOriginalRestoreDatabaseStatus\(/g)||[]).length,1);
  });
  await run("real-module-malformed-native-refuses-without-query",async()=>{
    const actual=await import("./immutable-private-fresh-restore-recovery.mjs");
    assert.deepEqual(Object.keys(actual),["readVerifiedImmutableFreshDatabaseCommitOutcome"]);
    let queries=0,traps=0;
    const proxy=new Proxy({}, {get(){traps++;throw Error("native proxy trap");},
      getPrototypeOf(){traps++;throw Error("native proxy trap");}});
    for(const db of [null,{}, {query(){queries++;throw Error("not native");}},proxy]){
      const value=await actual.readVerifiedImmutableFreshDatabaseCommitOutcome({db,request:request()});
      checkLimits(value);assert.equal(value.observation,"UNAVAILABLE");assert.equal(value.outcome,"UNKNOWN");
      assert.equal(value.status,null);assert.deepEqual(value.requested_original,request());
    }
    assert.equal(queries,0);assert.equal(traps,0);
  });
  console.log(`IMMUTABLE_FRESH_COMMIT_RECOVERY_NEW ${passed} groups PASS; Source recording/refusal only; SQL/COMMIT NOT_RUN`);
  process.exit(0);
}

if (process.argv.includes("--immutable-fresh-original-intent-only")) {
  const {readFileSync}=await import("node:fs"),{types,isDeepStrictEqual}=await import("node:util");
  const {captureVerifiedOriginalRestoreIntent}=await import("./disaster-recovery-crypto.mjs");
  const text=readFileSync(new URL("./immutable-private-fresh-restore-intent.mjs",import.meta.url),"utf8");
  // Pending T7 archive export is NOT replaced with a working authority stub.
  // Recording archive ports here ONLY throw; no successful capture/token is
  // produced. Crypto is the actual unchanged helper, never a fake PASS.
  const body=text.replace(/^import .*;\n/gm,"").replaceAll("export function ","function ");
  let archiveAssertions=0,sourceReads=0,cryptoCalls=0;
  const api=new Function("types","isDeepStrictEqual","captureVerifiedOriginalRestoreIntent",
    "assertVerifiedArchiveIndependentIntentKey","readVerifiedPrivateImportSource",body+
    "\nreturn {captureVerifiedImmutableFreshRestoreIntent,readVerifiedImmutableFreshRestoreIntent,closed,captureEnvelopeData,freezeVerifiedIntentData,requireProducerEnvelope,requireFreshIntent};")(
    types,isDeepStrictEqual,(...args)=>{cryptoCalls++;return captureVerifiedOriginalRestoreIntent(...args);},
    ()=>{archiveAssertions++;throw Error("RECORDING: no actual verified archive/key supplied");},
    ()=>{sourceReads++;throw Error("RECORDING: no actual verified source supplied");});
  const failure=/immutable_fresh_original_intent_invalid/;
  const instant=Date.UTC(2026,9,17,8,0,0);
  // Representation/refusal DATA only. This is NOT an envelope signature,
  // archive, approval, source authenticity or successful opaque-token case.
  const release={release_id:"DATA_ONLY_RELEASE",backend_commit:"a".repeat(40),frontend_commit:"b".repeat(40),
    migration_head:"20261017000000",migration_manifest_sha256:"c".repeat(64)};
  const intent={restore_id:"11111111-1111-4111-8111-111111111111",authority_generation:1,retry_of_restore_id:null,
    archive_digest:"d".repeat(64),source_project_ref:"abcdefghijklmnopqrst",target_project_ref:"abcdefghijklmnopqrst",
    source_identity_sha256:"e".repeat(64),target_migration_head:"20261017000000",target_release_identity:{...release},
    actor:"Data Only Operator",approved_at:new Date(instant-60000).toISOString(),expires_at:new Date(instant+60000).toISOString(),resume_after_verification:false};
  const binding={archive_digest:intent.archive_digest,project_ref:intent.source_project_ref,source_identity_sha256:intent.source_identity_sha256,
    source_identity:{migration_head:intent.target_migration_head,release:{...release,archived_extra:"not copied to target release"}}};
  const unsigned=()=>({format:"memphis-zoo-production-restore-intent.v1",algorithm:"hmac-sha256",key_id:"UNSIGNED_DATA_ONLY",
    intent:{...intent,target_release_identity:{...release}},signature:"NOT_A_SIGNATURE"});
  let passed=0;
  const headerOnly=process.argv.includes("--fresh-intent-header-only");
  const immutableOnly=process.argv.includes("--fresh-intent-immutable-reader-only");
  const realImportOnly=process.argv.includes("--fresh-intent-real-import-only");
  const run=async(name,test)=>{if(headerOnly&&name!=="strict-producer-header-refusal-data-only")return;
    if(immutableOnly&&name!=="immutable-verified-intent-reader-data-graph")return;
    if(realImportOnly&&name!=="released-real-module-import-and-public-refusals")return;
    await test();passed++;console.log(`IMMUTABLE_FRESH_INTENT_NEW ${name} PASS`);};
  await run("released-real-module-import-and-public-refusals",async()=>{
    const actual=await import("./immutable-private-fresh-restore-intent.mjs");
    assert.deepEqual(Object.keys(actual).sort(),["captureVerifiedImmutableFreshRestoreIntent","readVerifiedImmutableFreshRestoreIntent"]);
    assert.throws(()=>actual.captureVerifiedImmutableFreshRestoreIntent({verifiedArchive:{},originalIntentEnvelope:null,
      intentVerifyKey:"",intentVerifyKeyId:"UNSIGNED_DATA_ONLY"}),failure);
    for(const token of [{},Object.freeze(Object.create(null)),{intent,envelope:unsigned(),sourceBinding:binding}])
      assert.throws(()=>actual.readVerifiedImmutableFreshRestoreIntent(token,{}),failure);
    assert.equal(cryptoCalls,0);assert.equal(sourceReads,0);
    // No materialization, verification key, signed envelope, or valid token.
  });
  await run("immutable-verified-intent-reader-data-graph",()=>{
    // Exercise the SAME shipping fixed-graph freeze on MUTABLE detached DATA,
    // not a mock successful crypto return or fabricated valid opaque token.
    const mutable={...intent,target_release_identity:{...release}};
    const frozen=api.freezeVerifiedIntentData(mutable);
    const envelope=Object.freeze({...unsigned(),intent:frozen});
    const view=Object.freeze({intent:frozen,envelope,sourceBinding:binding});
    const original=JSON.stringify(frozen);
    assert.equal(view.envelope.intent,view.intent);
    assert.ok(Object.isFrozen(view.intent)&&Object.isFrozen(view.intent.target_release_identity));
    for(const [key,value]of [["restore_id","22222222-2222-4222-8222-222222222222"],["actor","Changed Operator"],
      ["approved_at","2026-10-17T08:00:00.000Z"],["expires_at","2026-10-17T09:00:00.000Z"]]){
      assert.equal(Reflect.set(view.intent,key,value),false);
      assert.equal(Reflect.defineProperty(view.intent,key,{value}),false);
      assert.equal(Reflect.deleteProperty(view.intent,key),false);
      assert.throws(()=>{view.intent[key]=value;},TypeError);
    }
    for(const key of Object.keys(release)){
      assert.equal(Reflect.set(view.intent.target_release_identity,key,"changed"),false);
      assert.equal(Reflect.defineProperty(view.intent.target_release_identity,key,{value:"changed"}),false);
      assert.equal(Reflect.deleteProperty(view.intent.target_release_identity,key),false);
    }
    assert.equal(Reflect.set(view.intent,"target_release_identity",{}),false);
    assert.equal(Reflect.set(view.envelope,"intent",mutable),false);
    mutable.actor="Late mutable helper/caller change";mutable.restore_id="22222222-2222-4222-8222-222222222222";
    mutable.expires_at="2026-10-17T09:00:00.000Z";mutable.target_release_identity.release_id="late replacement";
    assert.equal(JSON.stringify(view.intent),original);
    assert.equal(view.intent.actor,intent.actor);assert.equal(view.intent.restore_id,intent.restore_id);
    assert.equal(view.intent.expires_at,intent.expires_at);assert.deepEqual(view.intent.target_release_identity,release);
    assert.equal(cryptoCalls,0);assert.equal(sourceReads,0);
    assert.ok(text.includes("const intent = freezeVerifiedIntentData(verifiedIntent);"));
    assert.ok(text.includes("envelope:Object.freeze({...envelope,intent})"));
  });
  await run("strict-producer-header-refusal-data-only",()=>{
    for(const override of [{},{format:"override"},{algorithm:"none"},{key_id:"different"},
      {signature:null},{signature:"NOT_A_SIGNATURE\n"},{signature:""}])
      assert.throws(()=>api.requireProducerEnvelope({...unsigned(),...override},"UNSIGNED_DATA_ONLY"),failure);
    assert.equal(cryptoCalls,0);assert.equal(sourceReads,0);
  });
  await run("public-options-extra-accessor-proxy-and-primitive-refuse-without-effects",()=>{
    let traps=0;
    const inputs=[null,[],{verifiedArchive:{},originalIntentEnvelope:null,intentVerifyKey:null,intentVerifyKeyId:"none",extra:false},
      Object.defineProperty({},"verifiedArchive",{enumerable:true,get(){traps++;throw Error("must not read");}}),
      new Proxy({},{getPrototypeOf(){traps++;throw Error("must not probe proxy");},ownKeys(){traps++;throw Error("must not probe proxy");}})];
    for(const value of inputs)assert.throws(()=>api.captureVerifiedImmutableFreshRestoreIntent(value),failure);
    assert.equal(traps,0);assert.equal(archiveAssertions,0);assert.equal(sourceReads,0);assert.equal(cryptoCalls,0);
  });
  await run("independent-key-refusal-precedes-source-and-crypto",()=>{
    assert.throws(()=>api.captureVerifiedImmutableFreshRestoreIntent({verifiedArchive:{},originalIntentEnvelope:unsigned(),
      intentVerifyKey:"",intentVerifyKeyId:"UNSIGNED_DATA_ONLY"}),failure);
    assert.equal(archiveAssertions,1);assert.equal(sourceReads,0);assert.equal(cryptoCalls,0);
  });
  await run("forged-public-tokens-and-proxies-cannot-read",()=>{
    let traps=0;
    for(const token of [null,{},Object.freeze(Object.create(null)),{intent,envelope:unsigned(),sourceBinding:binding},
      new Proxy({},{getPrototypeOf(){traps++;throw Error("must not probe");}})])
      assert.throws(()=>api.readVerifiedImmutableFreshRestoreIntent(token,{}),failure);
    assert.equal(traps,0);assert.equal(sourceReads,0);
  });
  await run("unsigned-data-detachment-freeze-and-exact-producer-keys",()=>{
    const raw=unsigned(),captured=api.captureEnvelopeData(raw);
    assert.equal(captured.signature,"NOT_A_SIGNATURE");
    assert.ok(Object.isFrozen(captured)&&Object.isFrozen(captured.intent)&&Object.isFrozen(captured.intent.target_release_identity));
    raw.intent.actor="Changed Caller";raw.intent.target_release_identity.release_id="Changed Caller";
    assert.equal(captured.intent.actor,intent.actor);assert.equal(captured.intent.target_release_identity.release_id,release.release_id);
    for(const mutate of [value=>{value.extra=false;},value=>{value.intent.purpose="override";},
      value=>{value.intent.format="override";},value=>{value.intent.target_release_identity.extra="not the fixed five";}]){
      const value=unsigned();mutate(value);assert.throws(()=>api.captureEnvelopeData(value),failure);
    }
    let getters=0;const value=unsigned();Object.defineProperty(value.intent,"actor",{enumerable:true,get(){getters++;return "other";}});
    assert.throws(()=>api.captureEnvelopeData(value),failure);assert.equal(getters,0);
    assert.equal(cryptoCalls,0); // No signature verification/success assertion.
  });
  await run("data-only-fresh-generation-retry-resume-and-identity-refusals",()=>{
    const invalid=[{authority_generation:"1"},{authority_generation:2},{authority_generation:true},
      {retry_of_restore_id:intent.restore_id},{resume_after_verification:true},
      {restore_id:"11111111-1111-4111-8111-11111111111A"},{restore_id:intent.restore_id+"\n"},
      {archive_digest:"f".repeat(64)},{source_identity_sha256:"f".repeat(64)},
      {source_project_ref:"differentprojectxxxxxx"},{target_project_ref:"differentprojectxxxxxx"},
      {target_migration_head:"20261016000000"},{actor:"  "},{actor:"Data Only Operator\n"}];
    for(const override of invalid)assert.throws(()=>api.requireFreshIntent({...intent,...override},binding,instant),failure);
  });
  await run("data-only-exact-five-original-release-no-selected-successor",()=>{
    for(const key of Object.keys(release)){
      const changed={...intent,target_release_identity:{...release,[key]:key==="release_id"?"different":key==="migration_head"?"20261016000000":"f".repeat(key.endsWith("sha256")?64:40)}};
      assert.throws(()=>api.requireFreshIntent(changed,binding,instant),failure);
    }
    assert.throws(()=>api.requireFreshIntent({...intent,target_release_identity:{...release,release_id:1}},binding,instant),failure);
  });
  await run("data-only-expiry-24h-calendar-and-approved-before-expiry",()=>{
    for(const override of [{expires_at:new Date(instant).toISOString()},
      {expires_at:new Date(instant+24*60*60*1000+1).toISOString()},
      {approved_at:intent.expires_at},{approved_at:"2026-02-30T08:00:00.000Z"},
      {expires_at:"2026-10-17T08:01:00Z"},{expires_at:"2026-10-17T08:01:00.000+00:00"},
      {expires_at:{toString(){throw Error("must not coerce");}}}])
      assert.throws(()=>api.requireFreshIntent({...intent,...override},binding,instant),failure);
  });
  assert.equal(cryptoCalls,0);assert.equal(sourceReads,0);
  console.log(JSON.stringify({selector:"--immutable-fresh-original-intent-only",passed,source_only:true,
    actual_independent_archive_API:"SEALED_6ff861f5; public refusal/linking only",actual_verified_token_capture_read:"NOT_RUN",
    signatures_created:0,keys_created_or_retrieved:0,SQL:"NOT_RUN",old_groups_run:0,
    limits:"Negative recording public paths and pure DATA-only copy/validator refusals. No fake successful crypto/archive authority or token was produced."}));
  process.exit(0);
}

if (process.argv.includes("--relation-acl-batch-only")) {
  const {readFileSync}=await import("node:fs"),{createRequire}=await import("node:module");
  const sourceUrl=new URL("./immutable-private-source-acl.mjs",import.meta.url).href;
  const text=readFileSync(new URL(sourceUrl),"utf8"),start=text.indexOf("   async function captureOriginalRelationAcls(");
  assert.ok(start>0,"Actual fixed relation capture/reconcile Source required");
  // Same actual private functions; only lexical import.meta.url is supplied
  // to normal createRequire. No exported/private-authority factory is added.
  const reconcile=new Function("assert","createRequire","sourceUrl",
    text.slice(start).replaceAll("import.meta.url","sourceUrl")+"\nreturn reconcileOriginalRelationAcls;")(assert,createRequire,sourceUrl);
  const actor="supabase_admin",clone=value=>JSON.parse(JSON.stringify(value));
  const quote=value=>'"'+value.replaceAll('"','""')+'"';
  const grant=(grantee,privilege_type,is_grantable=false,grantor=actor)=>({grantee,grantor,privilege_type,is_grantable});
  const row=(object_name,grants=[],kind="TABLE",owner_name=actor)=>({kind,schema_name:"public",object_name,
    identity:'"public".'+quote(object_name),owner_name,column_name:null,grants});
  const freeze=value=>{if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
  const canonical=values=>clone(values).sort((a,b)=>Buffer.compare(Buffer.from(JSON.stringify([a.schema_name,a.object_name])),Buffer.from(JSON.stringify([b.schema_name,b.object_name]))))
    .map(item=>({...item,grants:item.grants.sort((a,b)=>Buffer.compare(Buffer.from(JSON.stringify([a.grantee,a.grantor,a.privilege_type])),Buffer.from(JSON.stringify([b.grantee,b.grantor,b.privilege_type]))))}));
  const invoke=async({original,current=original,final=original,actorAt,receipt,batchFailure,noBatch=false}={})=>{
    const expected=freeze(canonical(original)),unchanged=JSON.stringify(expected);
    const trace={actors:0,captures:0,batches:0,raw:0,commands:[],queries:[],error:null,result:null};
    const target={query:async sql=>{
      trace.queries.push(sql);
      if(sql==='select current_user::text actor,session_user::text session_actor'){
        trace.actors++;return{rows:[actorAt?.(trace.actors)||{actor,session_actor:actor}]};
      }
      if(/^REVOKE\b/i.test(sql)){trace.raw++;throw Error("Original ACL writes require the guarded batch port");}
      assert.ok(sql.startsWith("select jsonb_build_object(")&&sql.includes("pg_catalog.aclexplode"));
      trace.captures++;return{rows:clone(trace.batches?final:current).map(descriptor=>({descriptor}))};
    }};
    if(!noBatch)target.revokeBatch=async commands=>{
      trace.batches++;assert.equal(trace.batches,1,"No batch replay");
      assert.ok(Object.isFrozen(commands));assert.equal(Object.getPrototypeOf(commands),Array.prototype);
      assert.deepEqual(Reflect.ownKeys(commands),[...commands.map((_,i)=>String(i)),"length"]);
      trace.commands=[...commands];
      if(batchFailure)throw batchFailure;
      return receipt?receipt(commands):Object.freeze({revocation_count:commands.length});
    };
    try{trace.result=await reconcile(target,expected);}catch(error){trace.error=error;}
    assert.equal(JSON.stringify(expected),unchanged,"Original frozen ACLs must remain unchanged");
    assert.equal(trace.raw,0,"No raw REVOKE fallback");return trace;
  };
  let passed=0;
  const run=async(name,test)=>{await test();passed++;console.log(`RELATION_ACL_BATCH_NEW ${name} PASS`);};
  const original=[row("a_table",[grant("reader","SELECT")]),row("b_sequence",[grant("reader","USAGE")],"SEQUENCE")];
  const current=[row("a_table",[grant("reader","SELECT",true),grant("PUBLIC","DELETE"),grant('role"quoted',"UPDATE")]),
    row("b_sequence",[grant("reader","USAGE"),grant("service_role","UPDATE")],"SEQUENCE")];
  await run("complete-plan-one-batch-table-sequence-and-options",async()=>{
    const trace=await invoke({original,current});assert.equal(trace.error,null);
    assert.deepEqual(trace.commands,[
      'REVOKE DELETE ON TABLE "public"."a_table" FROM PUBLIC RESTRICT',
      'REVOKE GRANT OPTION FOR SELECT ON TABLE "public"."a_table" FROM "reader" RESTRICT',
      'REVOKE UPDATE ON TABLE "public"."a_table" FROM "role""quoted" RESTRICT',
      'REVOKE UPDATE ON SEQUENCE "public"."b_sequence" FROM "service_role" RESTRICT']);
    assert.equal(trace.batches,1);assert.equal(trace.captures,2);assert.equal(trace.actors,3);
    assert.deepEqual(trace.result,{revoked_privileges:3,revoked_grant_options:1});assert.ok(Object.isFrozen(trace.result));
  });
  await run("no-effect-plan-no-empty-batch-and-exact-readback",async()=>{
    const trace=await invoke({original,noBatch:true});assert.equal(trace.error,null);
    assert.equal(trace.batches,0);assert.equal(trace.captures,2);assert.equal(trace.actors,2);
    assert.deepEqual(trace.result,{revoked_privileges:0,revoked_grant_options:0});
  });
  await run("late-missing-original-right-refuses-entire-plan",async()=>{
    for(const grants of [[],[grant("reader","USAGE",false,"foreign_grantor")]]){
      const altered=clone(current);altered[1].grants=grants;
      const trace=await invoke({original,current:altered});assert.match(trace.error?.message||"",/privilege\/grantor\/option missing/);
      assert.equal(trace.batches,0);assert.deepEqual(trace.commands,[]);
    }
    const required=[row("a_table",[grant("reader","SELECT",true)])];
    const trace=await invoke({original:required,current:[row("a_table",[grant("reader","SELECT")])]});
    assert.ok(trace.error);assert.equal(trace.batches,0);
  });
  await run("late-foreign-owner-or-grantor-refuses-before-batch",async()=>{
    for(const altered of [row("b_sequence",[grant("reader","USAGE"),grant("service_role","UPDATE",false,"other_owner")],"SEQUENCE"),
      row("b_sequence",[grant("reader","USAGE"),grant("service_role","UPDATE")],"SEQUENCE","other_owner")]){
      const trace=await invoke({original,current:[current[0],altered]});assert.ok(trace.error);assert.equal(trace.batches,0);
    }
  });
  await run("immediate-prebatch-actor-withdrawal-zero-batches",async()=>{
    const trace=await invoke({original,current,actorAt:n=>n===2?{actor:"other_actor",session_actor:"other_actor"}:undefined});
    assert.ok(trace.error);assert.equal(trace.batches,0);assert.equal(trace.captures,1);
  });
  await run("missing-private-port-no-query-fallback",async()=>{
    const trace=await invoke({original,current,noBatch:true});assert.match(trace.error?.message||"",/Guarded relation ACL batch port required/);
    assert.equal(trace.batches,0);assert.equal(trace.raw,0);
  });
  await run("closed-exact-batch-count-refuses-missing-wrong-and-getter",async()=>{
    let getters=0;
    const bad=[()=>null,()=>({}),()=>({revocation_count:3}),()=>({revocation_count:"4"}),
      ()=>({revocation_count:4,extra:false}),()=>Object.defineProperty({},"revocation_count",{enumerable:true,get(){getters++;return 4;}}),
      ()=>new Proxy({revocation_count:4},{getPrototypeOf(){throw Error("Proxy trap must not run");}})];
    for(const receipt of bad){const trace=await invoke({original,current,receipt});assert.ok(trace.error);assert.equal(trace.batches,1);assert.equal(trace.captures,1);}
    assert.equal(getters,0);
  });
  await run("batch-original-failure-preserved-no-replay",async()=>{
    const failure=Object.assign(Error("Synthetic guarded batch refusal"),{code:"55000"});
    const trace=await invoke({original,current,batchFailure:failure});assert.equal(trace.error,failure);
    assert.equal(trace.batches,1);assert.equal(trace.captures,1);assert.equal(trace.result,null);
  });
  await run("final-catalog-identity-grants-and-options-still-exact",async()=>{
    for(const final of [current,[original[0],row("b_sequence",[grant("reader","USAGE",true)],"SEQUENCE")],
      [original[0],row("b_sequence",[grant("reader","USAGE")],"SEQUENCE","other_owner")]]){
      const trace=await invoke({original,current,final});assert.match(trace.error?.message||"",/Final relation ACLs/);
      assert.equal(trace.batches,1);assert.equal(trace.captures,2);assert.equal(trace.result,null);
    }
  });
  await run("final-actor-check-retained-after-batch",async()=>{
    const trace=await invoke({original,current,actorAt:n=>n===3?{actor:"other_actor",session_actor:"other_actor"}:undefined});
    assert.ok(trace.error);assert.equal(trace.batches,1);assert.equal(trace.captures,2);assert.equal(trace.result,null);
  });
  console.log(JSON.stringify({selector:"--relation-acl-batch-only",passed,SQL:"NOT_RUN",old_groups_run:0,
    scope:"Actual relation reconciler/capture Source with synthetic private recording ports; no native/fence/empty-target/batch SQL authority qualification."}));
  process.exit(0);
}

// Newly affected v1 abandoned-lease generation boundaries only. Execute
// actual helpers/transaction Source with recording ports; no DB or signatures.
if (process.argv.includes("--abandoned-lease-generation-only")) {
  const {readFileSync}=await import("node:fs"),{createHash}=await import("node:crypto");
  const {stableJson,abandonedMutationLeaseReconciliationBinding}=await import("./disaster-recovery-crypto.mjs");
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,cases=[];
  const selected=new Set(process.argv.filter(arg=>arg.startsWith("--abandoned-lease-generation-case="))
    .map(arg=>arg.slice("--abandoned-lease-generation-case=".length)));
  const projectRef="abcdefghijklmnopqrst",requestId="11111111-1111-4111-8111-111111111111";
  const programs={};
  for(const kind of ["create","apply"]){
    const text=readFileSync(new URL("./"+kind+"-abandoned-mutation-lease-reconciliation.mjs",import.meta.url),"utf8");
    const helperStart=text.indexOf(kind==="create"?"function sha256(":"function iso("),helperEnd=text.indexOf("const db =",helperStart);
    const start=text.indexOf('try {\n  await db.query("begin ',helperEnd);
    assert.ok(helperStart>0&&helperEnd>helperStart&&start>helperEnd,"Actual lease program Source required");
    const names=kind==="create"?"projectRef,evidence,actor,ttlMinutes,key,keyId,MAX_TERMINATION_EVIDENCE_AGE_MS":
      "projectRef,intent,intentDigest,approvedAt,MAX_TERMINATION_EVIDENCE_AGE_MS";
    programs[kind]=new AsyncFunction("db","fixture","createHash","stableJson","abandonedMutationLeaseReconciliationBinding",
      "randomUUID","signBinding","console","process",
      "const {"+names+"}=fixture;\n"+text.slice(helperStart,helperEnd)+"\n"+text.slice(start));
  }
  const invoke=async(kind,options={})=>{
    const {expectedGeneration=1,expectedLeaseGeneration=1,prior=false}=options;
    const controlGeneration=Object.hasOwn(options,"controlGeneration")?options.controlGeneration:"1";
    const leaseGeneration=Object.hasOwn(options,"leaseGeneration")?options.leaseGeneration:"1";
    const now=Date.now(),iso=offset=>new Date(now-offset).toISOString();
    const row={request_id:requestId,authority_generation:leaseGeneration,service_name:"synthetic-lease-owner",
      admitted_at:iso(10000),heartbeat_at:iso(9000),expires_at:iso(8000)};
    const expected={...row,authority_generation:expectedLeaseGeneration};
    const observations=[{request_id:requestId,service_name:row.service_name,owning_process_terminated:true,
      observation:"Synthetic fixture observation only; no actual process was terminated.",observed_at:iso(5000)}];
    const evidence={format:"memphis-zoo.abandoned-mutation-lease-evidence.v1",observations,
      evidence_sha256:createHash("sha256").update(stableJson(observations)).digest("hex")};
    const intent={reconciliation_id:"22222222-2222-4222-8222-222222222222",target_project_ref:projectRef,
      authority_generation:expectedGeneration,restore_id:null,control_state:"READY",leases:[expected],evidence,actor:"Synthetic Actor"};
    const fixture={projectRef,evidence,actor:"Synthetic Actor",ttlMinutes:5,key:null,keyId:"recording-only",
      MAX_TERMINATION_EVIDENCE_AGE_MS:3600000,intent,intentDigest:"d".repeat(64),approvedAt:now-1000};
    const trace={uuid:0,sign:0,prior:0,lease_reads:0,deletes:0,inserts:0,commits:0,rollbacks:0,ends:0,exits:0,outputs:[]};
    const db={async query(sql,args){
      if(sql.includes("from custodial_dr.restore_control"))return{rowCount:1,rows:[{authority_generation:controlGeneration,
        mutations_paused:false,state:"READY",restore_id:null,target_project_ref:projectRef}]};
      if(sql.includes("select intent_sha256 from custodial_dr.application_mutation_lease_reconciliations")){
        trace.prior++;return{rowCount:prior?1:0,rows:prior?[{intent_sha256:fixture.intentDigest}]:[]};
      }
      if(sql.includes("select count(*)::int count from custodial_dr.application_mutation_leases"))return{rowCount:1,rows:[{count:0}]};
      if(sql.includes("from custodial_dr.application_mutation_leases order by request_id")){
        trace.lease_reads++;return{rowCount:1,rows:[row]};
      }
      if(sql.startsWith("delete from custodial_dr.application_mutation_leases")){
        trace.deletes++;assert.deepEqual(args,[[requestId]]);return{rowCount:1};
      }
      if(sql.includes("insert into custodial_dr.application_mutation_lease_reconciliations(")){trace.inserts++;return{rowCount:1};}
      if(sql==="commit"){trace.commits++;return{command:"COMMIT"};}
      if(sql==="rollback"){trace.rollbacks++;return{command:"ROLLBACK"};}
      if(sql.startsWith("begin ")||sql.startsWith("select pg_advisory_"))return{rowCount:1,rows:[]};
      throw Error("Unexpected recording SQL");
    },async end(){trace.ends++;}};
    let error;
    try{await programs[kind](db,fixture,createHash,stableJson,abandonedMutationLeaseReconciliationBinding,
      ()=>{trace.uuid++;return intent.reconciliation_id;},()=>{trace.sign++;return "RECORDING_NO_SIGNATURE";},
      {log:value=>trace.outputs.push(JSON.parse(value))},{exit(){trace.exits++;throw Error("Recording replay exit");}});
    }catch(value){error=value;}
    return{trace,error,expected};
  };
  const run=async(name,body)=>{if(selected.size&&!selected.has(name))return;await body();cases.push(name);console.log(JSON.stringify({case:name,status:"PASS_NEW_RECORDING_SOURCE_ONLY"}));};
  const invalid=["", "00","01"," 1","1 ","1\n","1\r\n","+1","-1","-0","1.0","1e3","１",
    "9007199254740992","9007199254740993","9223372036854775807","9223372036854775808","100000000000000000000",
    0,1,Number.MAX_SAFE_INTEGER,9007199254740992,Infinity,NaN,1n,null,undefined,{},[]];
  await run("ABANDONED_GENERATION_NEW issuer zero and safe generations preserve exact numeric leases",async()=>{
    for(const value of ["0","1","42","9007199254740991"]){
      const result=await invoke("create",{controlGeneration:value,leaseGeneration:value,
        expectedGeneration:Number(BigInt(value)),expectedLeaseGeneration:Number(BigInt(value))});
      assert.equal(result.error,undefined);assert.equal(result.trace.uuid,1);assert.equal(result.trace.sign,1);
      const intent=result.trace.outputs[0].intent;assert.equal(intent.authority_generation,Number(BigInt(value)));
      assert.deepEqual(intent.leases,[result.expected]);assert.equal(stableJson(intent.leases),stableJson([result.expected]));
      assert.equal(result.trace.rollbacks,1);assert.equal(result.trace.ends,1);
    }
  });
  await run("ABANDONED_GENERATION_NEW issuer malformed control or lease refuses before UUID and signing",async()=>{
    for(const value of invalid)for(const field of ["controlGeneration","leaseGeneration"]){
      const {trace,error}=await invoke("create",{[field]:value});assert.ok(error instanceof Error);
      assert.equal(trace.uuid,0);assert.equal(trace.sign,0);assert.deepEqual(trace.outputs,[]);
      assert.equal(trace.deletes,0);assert.equal(trace.inserts,0);assert.equal(trace.commits,0);assert.equal(trace.ends,1);
      if(field==="controlGeneration")assert.equal(trace.lease_reads,0);
    }
  });
  await run("ABANDONED_GENERATION_NEW applier safe original zero and positive exact readback",async()=>{
    for(const value of ["0","1","42","9007199254740991"]){
      const {trace,error}=await invoke("apply",{controlGeneration:value,leaseGeneration:value,
        expectedGeneration:Number(BigInt(value)),expectedLeaseGeneration:Number(BigInt(value))});
      assert.equal(error,undefined);assert.equal(trace.prior,1);assert.equal(trace.deletes,1);assert.equal(trace.inserts,1);
      assert.equal(trace.commits,1);assert.equal(trace.ends,1);assert.equal(trace.outputs[0].idempotent_replay,false);
    }
  });
  await run("ABANDONED_GENERATION_NEW applier invalid control blocks prior replay and invalid lease blocks mutation",async()=>{
    for(const value of invalid){
      let result=await invoke("apply",{controlGeneration:value,prior:true});
      assert.ok(result.error instanceof Error);assert.equal(result.trace.prior,0);assert.equal(result.trace.exits,0);
      assert.equal(result.trace.lease_reads,0);assert.deepEqual(result.trace.outputs,[]);
      for(const key of ["deletes","inserts","commits"])assert.equal(result.trace[key],0);
      assert.equal(result.trace.rollbacks,1);assert.equal(result.trace.ends,1);
      result=await invoke("apply",{leaseGeneration:value});
      assert.ok(result.error instanceof Error);assert.equal(result.trace.prior,1);assert.equal(result.trace.lease_reads,1);
      assert.deepEqual(result.trace.outputs,[]);
      for(const key of ["deletes","inserts","commits"])assert.equal(result.trace[key],0);
      assert.equal(result.trace.rollbacks,1);assert.equal(result.trace.ends,1);
    }
    let coercions=0;const value={toString(){coercions++;return "1";}};
    for(const kind of ["create","apply"])for(const field of ["controlGeneration","leaseGeneration"])
      assert.ok((await invoke(kind,{[field]:value})).error instanceof Error);
    assert.equal(coercions,0);
  });
  assert.ok(cases.length>0,"Unknown or empty abandoned-generation selector");
  console.log(JSON.stringify({scope:"NEW_ABANDONED_LEASE_GENERATION_SOURCE_ONLY",cases,count:cases.length,
    SQL:"NOT_RUN",connections:0,keys_retrieved:0,signatures:"RECORDING_ONLY",process_termination:"NOT_RUN",
    limits:"Actual helper/transaction Source with synthetic recording SQL ports; no actual actor/fence/signature/DB/termination or replay authority proof."}));
  process.exit(0);
}

function response() {
  return Object.assign(new EventEmitter(), {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.writableFinished = true; this.emit("finish"); },
  });
}

async function invoke(gate, method = "POST") {
  const res = response();
  let passed = false;
  await gate({ method }, res, () => { passed = true; });
  return { res, passed };
}

const rpcCalls = [];
let requestCounter = 0;
const openGate = makeRestoreMutationGate({
  supabase: { async rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === "custodial_release_application_mutation_lease") return { data: true, error: null };
    if (name === "custodial_heartbeat_application_mutation_lease") return { data: true, error: null };
    assert.equal(name, "custodial_begin_application_mutation_lease");
    return { data: { mutations_paused: false, authority_generation: 4, request_id: args.p_request_id }, error: null };
  } },
  serviceName: "fixture-service",
  requestId: () => `00000000-0000-4000-8000-${String(++requestCounter).padStart(12, "0")}`,
});
assert.equal((await invoke(openGate, "GET")).passed, true);
assert.equal(rpcCalls.length, 0, "read requests do not need the mutation gate");
const first = await invoke(openGate);
assert.equal(first.passed, true);
first.res.emit("finish");
await new Promise((resolve) => setImmediate(resolve));
const second = await invoke(openGate);
assert.equal(second.passed, true);
second.res.emit("finish");
await new Promise((resolve) => setImmediate(resolve));
const aborted = await invoke(openGate);
assert.equal(aborted.passed, true);
aborted.res.emit("close");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(rpcCalls.at(-1).name, "custodial_begin_application_mutation_lease", "disconnect aborts work but cannot release a lease before the handler finishes");
assert.equal(aborted.res.writableFinished, undefined);
aborted.res.end();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(rpcCalls.map((call) => call.name), [
  "custodial_begin_application_mutation_lease",
  "custodial_release_application_mutation_lease",
  "custodial_begin_application_mutation_lease",
  "custodial_release_application_mutation_lease",
  "custodial_begin_application_mutation_lease",
  "custodial_release_application_mutation_lease",
]);
assert.equal(rpcCalls[0].args.p_service_name, "fixture-service");

const disconnectCalls = [];
const disconnectGate = makeRestoreMutationGate({
  supabase: { async rpc(name) {
    disconnectCalls.push(name);
    if (name === "custodial_begin_application_mutation_lease") return { data: { mutations_paused: false, authority_generation: 6 }, error: null };
    if (name === "custodial_heartbeat_application_mutation_lease") return { data: true, error: null };
    if (name === "custodial_release_application_mutation_lease") return { data: true, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  } },
  serviceName: "fixture-disconnect-server",
  requestId: () => "00000000-0000-4000-8000-000000000101",
  heartbeatMilliseconds: 5,
});
const server = http.createServer(async (req, res) => {
  await disconnectGate(req, res, () => {
    setTimeout(() => res.end("settled after disconnect"), 30);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  await new Promise((resolve, reject) => {
    const clientRequest = http.request({ host: "127.0.0.1", port: server.address().port, path: "/", method: "POST" });
    clientRequest.on("error", (error) => error.code === "ECONNRESET" ? resolve() : reject(error));
    clientRequest.on("socket", () => setTimeout(() => { clientRequest.destroy(); resolve(); }, 5));
    clientRequest.end("work");
  });
  await new Promise((resolve) => setTimeout(resolve, 55));
  assert.equal(disconnectCalls.filter((name) => name === "custodial_release_application_mutation_lease").length, 1,
    "a real Node response releases exactly once when its handler settles after the client disconnects");
  const heartbeatsAtSettlement = disconnectCalls.filter((name) => name === "custodial_heartbeat_application_mutation_lease").length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(disconnectCalls.filter((name) => name === "custodial_heartbeat_application_mutation_lease").length, heartbeatsAtSettlement,
    "heartbeats stop after disconnected handler settlement");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const backgroundCalls = [];
const backgroundResult = await withApplicationMutationLease({
  supabase: { async rpc(name, args) {
    backgroundCalls.push({ name, args });
    if (name === "custodial_begin_application_mutation_lease") return { data: { mutations_paused: false, authority_generation: 4 }, error: null };
    if (name === "custodial_heartbeat_application_mutation_lease") return { data: true, error: null };
    if (name === "custodial_release_application_mutation_lease") return { data: true, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  } },
  serviceName: "fixture-background-worker",
  requestId: () => "00000000-0000-4000-8000-000000000099",
  heartbeatMilliseconds: 5,
  operation: async () => {
    await new Promise((resolve) => setTimeout(resolve, 12));
    return "saved";
  },
});
assert.equal(backgroundResult, "saved");
assert.equal(backgroundCalls[0].name, "custodial_begin_application_mutation_lease");
assert.ok(backgroundCalls.some((call) => call.name === "custodial_heartbeat_application_mutation_lease"));
assert.equal(backgroundCalls.at(-1).name, "custodial_release_application_mutation_lease");

const lossCalls = [];
let lateStorageMutation = false;
await assert.rejects(withApplicationMutationLease({
  supabase: { async rpc(name, args) {
    lossCalls.push({ name, args });
    if (name === "custodial_begin_application_mutation_lease") return { data: { mutations_paused: false, authority_generation: 5 }, error: null };
    if (name === "custodial_heartbeat_application_mutation_lease") return { data: false, error: null };
    if (name === "custodial_release_application_mutation_lease") return { data: false, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  } },
  serviceName: "fixture-storage-worker",
  requestId: () => "00000000-0000-4000-8000-000000000100",
  heartbeatMilliseconds: 5,
  operation: async ({ assertActive }) => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    assertActive();
    lateStorageMutation = true;
  },
}), (error) => error?.code === "mutation_lease_lost");
assert.equal(lateStorageMutation, false, "lease loss aborts cooperative external work before its delayed side effect");
assert.ok(lossCalls.some((call) => call.name === "custodial_heartbeat_application_mutation_lease"));

const paused = await invoke(makeRestoreMutationGate({
  supabase: { async rpc() { return { data: null, error: new Error("disaster recovery is in progress; application mutations are paused") }; } },
}));
assert.equal(paused.passed, false);
assert.equal(paused.res.statusCode, 503);
assert.equal(paused.res.body.code, "disaster_restore_in_progress");
assert.equal(paused.res.body.work_saved, true);

const failed = await invoke(makeRestoreMutationGate({ supabase: { async rpc() { return { data: null, error: new Error("unavailable") }; } } }));
assert.equal(failed.passed, false);
assert.equal(failed.res.statusCode, 503);
assert.equal(failed.res.body.code, "restore_gate_unavailable");

const missing = await invoke(makeRestoreMutationGate({ supabase: null }));
assert.equal(missing.passed, false);
assert.equal(missing.res.body.code, "restore_gate_unavailable");

assert.equal((await invoke(makeRestoreMutationGate({ supabase: null, required: false }))).passed, true);

{
  const controller = new AbortController(),calls=[];
  let finishBegin;
  const lateBegin = new Promise(resolve=>{finishBegin=resolve;});
  const gate=makeRestoreMutationGate({supabase:{async rpc(name,args){calls.push({name,args});
    if(name==='custodial_begin_application_mutation_lease')return lateBegin;
    if(name==='custodial_release_application_mutation_lease')return{data:true,error:null};
    throw Error(`unexpected ${name}`);}},requestId:()=>"00000000-0000-4000-8000-000000000201"});
  const req={method:'POST',staticWeeklyManagerOperation:{signal:controller.signal}},res=response();let passed=false;
  const pending=gate(req,res,()=>{passed=true;});
  await Promise.resolve();controller.abort(new Error('synthetic deadline'));
  await pending;
  assert.equal(passed,false,'expired lease admission never reaches manager auth or product handler');
  assert.equal(res.statusCode,503,'expired pending lease is not a successful mutation');
  finishBegin({data:{mutations_paused:false,authority_generation:1},error:null});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls.map(row=>row.name),['custodial_begin_application_mutation_lease','custodial_release_application_mutation_lease'],
    'late successful begin releases only its original request ID');
  assert.equal(calls[1].args.p_request_id,calls[0].args.p_request_id);
}
{
  const controller=new AbortController(),calls=[];
  const gate=makeRestoreMutationGate({supabase:{async rpc(name,args){calls.push({name,args});
    if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
    if(name==='custodial_release_application_mutation_lease')return{data:true,error:null};
    if(name==='custodial_heartbeat_application_mutation_lease')return{data:true,error:null};
    throw Error(`unexpected ${name}`);}},requestId:()=>"00000000-0000-4000-8000-000000000202"});
  const req={method:'POST',staticWeeklyManagerOperation:{signal:controller.signal}},res=response();let passed=false;
  await gate(req,res,()=>{passed=true;});assert.equal(passed,true);
  controller.abort(new Error('synthetic expired auth'));assert.equal(req.restoreMutationLease.signal.aborted,true,
    'the same ingress deadline aborts the acquired restore lease');
  res.end();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.filter(row=>row.name==='custodial_release_application_mutation_lease').length,1,
    'settled response releases only its exact lease once');
}

{
  // A deadline abort alone does not prove the handler or its SQL has settled.
  // This captures the current boundary, not a successful one-minute cleanup.
  const controller=new AbortController(),calls=[],terminated=[];
  const gate=makeRestoreMutationGate({supabase:{async rpc(name,args){calls.push({name,args});
    if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
    if(name==='custodial_heartbeat_application_mutation_lease')return{data:true,error:null};
    if(name==='custodial_release_application_mutation_lease')return{data:true,error:null};
    throw Error(`unexpected ${name}`);}},requestId:()=>"00000000-0000-4000-8000-000000000203",
    heartbeatMilliseconds:5,disconnectTerminationMilliseconds:2,
    terminateUnsettledProcess:fact=>terminated.push(fact)});
  const req={method:'POST',staticWeeklyManagerOperation:{signal:controller.signal}},res=response();let passed=false;
  await gate(req,res,()=>{passed=true;});assert.equal(passed,true);
  controller.abort(new Error('synthetic ingress expiry'));
  await new Promise(resolve=>setTimeout(resolve,18));
  assert.equal(req.restoreMutationLease.signal.aborted,true,'ingress expiry aborts the acquired lease signal');
  assert.equal(res.writableFinished,undefined,'an uncooperative still-connected handler has not finished its response');
  assert.equal(terminated.length,0,'historical disconnected-only terminator does not run for a connected stall');
  assert.ok(calls.some(row=>row.name==='custodial_heartbeat_application_mutation_lease'),
    'the retained lease keeps heartbeating while the handler outcome is unsettled');
  assert.equal(calls.some(row=>row.name==='custodial_release_application_mutation_lease'),false,
    'the unsettled handler cannot release its protected lease');
  res.emit('close');
  await new Promise(resolve=>setTimeout(resolve,8));
  assert.deepEqual(terminated,[{requestId:'00000000-0000-4000-8000-000000000203',
    serviceName:'memphis-zoo-backend',exitCode:70}],
    'only a disconnected response arms the old process-wide termination hook');
  res.end();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.filter(row=>row.name==='custodial_release_application_mutation_lease').length,1,
    'the synthetic test settles and releases its exact lease after observing the gap');
}

{
  let finishRelease;
  const releasePending=new Promise(resolve=>{finishRelease=resolve;});
  const calls=[];
  const gate=makeRestoreMutationGate({supabase:{async rpc(name,args){calls.push({name,args});
    if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
    if(name==='custodial_heartbeat_application_mutation_lease')return{data:true,error:null};
    if(name==='custodial_release_application_mutation_lease')return releasePending;
    throw Error(`unexpected ${name}`);}},requestId:()=>"00000000-0000-4000-8000-000000000204"});
  const res=response();await gate({method:'POST'},res,()=>{});
  res.end();
  assert.equal(res.writableFinished,true,'the HTTP response can finish before its release RPC settles');
  await Promise.resolve();
  assert.equal(calls.filter(row=>row.name==='custodial_release_application_mutation_lease').length,1,
    'release is invoked but not yet known successful');
  finishRelease({data:true,error:null});
  await new Promise(resolve=>setImmediate(resolve));
}
{
  const controller=new AbortController(),calls=[];
  const gate=makeRestoreMutationGate({supabase:{async rpc(name,args){calls.push({name,args});
    if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
    if(name==='custodial_release_application_mutation_lease')return{data:true,error:null};
    throw Error(`unexpected ${name}`);}},requestId:()=>"00000000-0000-4000-8000-000000000205"});
  const req={method:'POST',staticWeeklyManagerOperation:{signal:controller.signal}},res=response();
  await gate(req,res,()=>{});
  await req.restoreMutationLease.settleBeforeSuccess();
  res.end();res.end();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.filter(row=>row.name==='custodial_release_application_mutation_lease').length,1,
    'pre-success settlement and repeated response end share exactly one release RPC');
  assert.equal(calls.at(-1).args.p_request_id,calls[0].args.p_request_id,
    'the release remains bound to the original admitted lease ID');
}

{
  const controller = new AbortController(), calls = [], terminated = [];
  const gate = makeRestoreMutationGate({ supabase: { async rpc(name, args) {
    calls.push({ name, args });
    if (name === "custodial_begin_application_mutation_lease") return { data: { mutations_paused: false, authority_generation: 1 }, error: null };
    if (name === "custodial_heartbeat_application_mutation_lease") return { data: true, error: null };
    if (name === "custodial_release_application_mutation_lease") return { data: true, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  } }, requestId: () => "00000000-0000-4000-8000-000000000206",
  heartbeatMilliseconds: 5, disconnectTerminationMilliseconds: 2,
  terminateUnsettledProcess: fact => terminated.push(fact) });
  const req = { method: "POST", staticWeeklyManagerOperation: { signal: controller.signal } }, res = response();
  let passed = false;
  await gate(req, res, () => { passed = true; });
  assert.equal(passed, true);
  req.restoreMutationLease.retainUnprovenRecurringCustody();
  assert.equal(req.restoreMutationLease.signal.aborted, true, "unproven child custody aborts local mutation work");
  await assert.rejects(req.restoreMutationLease.settleBeforeSuccess(), error =>
    error?.code === "static_weekly_recurring_operation_custody_unknown", "late receipt cannot upgrade an unproven group");
  res.emit("close");
  res.end(); res.end();
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 18));
  assert.equal(calls.filter(row => row.name === "custodial_release_application_mutation_lease").length, 0,
    "response finish and stale operation results cannot erase the exact unknown lease row");
  assert.equal(calls.filter(row => row.name === "custodial_heartbeat_application_mutation_lease").length, 0,
    "unproven custody stops heartbeat instead of extending the lease indefinitely");
  assert.deepEqual(terminated, [], "the recurring unknown row replaces only the legacy process-wide disconnected terminator");
}

console.log("RESTORE_MUTATION_GATE_TESTS_PASS");
}
