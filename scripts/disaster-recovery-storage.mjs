import { createHash, createHmac } from "node:crypto";
import { isProxy } from "node:util/types";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import pg from "pg";
import { stableJson, verifyBinding, captureVerifiedOriginalRestoreIntent } from "./disaster-recovery-crypto.mjs";
import { readVerifiedArchiveSourceBinding, readVerifiedRestoreTableSelection, openVerifiedRestoreTableData,
  decodeRestoreTableRowLine, createRestoreRowLineBatchDecoder, postgresJsonTextLineEncoding,
  postgresTextColumnsLineEncoding, createRestoreRowUtf8Guard, readVerifiedStorageUploadInventory,
  assertVerifiedStorageUploadCurrent, readVerifiedStorageUploadBlob, assertVerifiedArchiveIndependentIntentKey } from "./disaster-recovery-archive.mjs";

const StorageTableClient = pg.Client;
const storageTableQuery = StorageTableClient.prototype.query;
const storageScalarTypeOids = Object.freeze(Object.values(pg.types.builtins)
  .filter(value => Number.isInteger(value) && value > 0).map(value => String(value)));

// Read-only SQL parameters must fit in bounded owned memory; never silently
// compare a prefix, batch against different snapshots, or substitute hashes.
const STORAGE_TABLE_PARAMETER_BYTES = 16 * 1024 * 1024;
const STORAGE_TABLE_PARAMETER_ROWS = 65536;

// Comparison DATA only. No target/import/resume/ACK authority, no transaction
// ownership, settings, writes, client factory, or public expected-row port.
export async function compareVerifiedStorageTableData(options) {
  let storageCheckPhase = "INPUT", storageContextCheck, firstFailure;
  const ownedRows = new Set();
  const remember = (nativeError, nativeInvocation = false) => {
    if (firstFailure) return firstFailure;
    const failure = Object.assign(new Error("Verified original Storage table comparison is unavailable."), {
      code: "VERIFIED_STORAGE_TABLE_COMPARISON_UNAVAILABLE", storage_check_phase: storageCheckPhase,
      outcome: "UNKNOWN", retry_safe: false,
    });
    if (storageContextCheck !== undefined) failure.storage_context_check = storageContextCheck;
    // No driver message/SQL/row/cause, accessor, inherited code or Source
    // exception can become native SQL provenance. Only the fixed native call.
    if (nativeInvocation && nativeError && typeof nativeError === "object" && !isProxy(nativeError)) {
      const field = Object.getOwnPropertyDescriptor(nativeError, "code");
      if (field && Object.hasOwn(field, "value") && typeof field.value === "string" && /^[0-9A-Z]{5}$/.test(field.value)) {
        failure.sql_state = field.value;
      }
    }
    firstFailure = Object.freeze(failure); return firstFailure;
  };
  const unavailable = () => { throw remember(); };
  // Only these fixed callsites label an actual failed context predicate;
  // native/Source errors cannot supply a context label or context values.
  const contextUnavailable = check => { storageContextCheck = check; unavailable(); };
  try {
  const own = (value, key) => {
    if (!value || typeof value !== "object" || isProxy(value)) unavailable();
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, "value")) unavailable();
    return field.value;
  };
  const closed = (value, keys) => {
    if (!value || typeof value !== "object" || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
        || stableJson(Reflect.ownKeys(value).map(key => typeof key === "string" ? key : null).sort()) !== stableJson(keys.slice().sort())) unavailable();
    return Object.fromEntries(keys.map(key => [key, own(value, key)]));
  };
  const dense = values => {
    if (isProxy(values) || !Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype
        || Reflect.ownKeys(values).length !== values.length + 1) unavailable();
    return Array.from({ length: values.length }, (_, index) => own(values, String(index)));
  };
  const { db, verifiedArchive } = closed(options, ["db", "verifiedArchive"]);
  const native = () => {
    const previous = storageCheckPhase; storageCheckPhase = "NATIVE_PORT";
    try {
    if (!db || typeof db !== "object" || isProxy(db) || Object.getPrototypeOf(db) !== StorageTableClient.prototype
        || Object.hasOwn(db, "query") || StorageTableClient.prototype.query !== storageTableQuery
        || own(db, "_connected") !== true || own(db, "_ending") !== false || own(db, "_ended") !== false
        || own(db, "_queryable") !== true || own(db, "_txStatus") !== "T") unavailable();
    } catch { throw remember(); }
    finally { storageCheckPhase = previous; }
  };
  native();
  storageCheckPhase = "SOURCE";
  const sourceBinding = readVerifiedArchiveSourceBinding(verifiedArchive);
  const selection = readVerifiedRestoreTableSelection(verifiedArchive, { databaseOnly: true });
  const current = () => {
    native();
    const previous = storageCheckPhase; storageCheckPhase = "SOURCE";
    try {
    if (readVerifiedArchiveSourceBinding(verifiedArchive) !== sourceBinding
        || readVerifiedRestoreTableSelection(verifiedArchive, { databaseOnly: true }) !== selection) unavailable();
    } catch { throw remember(); }
    finally { storageCheckPhase = previous; }
  };
  const nativeRead = async (sql, values = []) => {
    // Once any first refusal is recorded, no later own query can replace it
    // with a secondary aborted-transaction error. Archive cleanup still runs.
    if (firstFailure) throw firstFailure;
    try { return await Reflect.apply(storageTableQuery, db, [sql, values]); }
    catch (error) { throw remember(error, true); }
  };
  const rows = result => {
    const values = dense(own(result, "rows"));
    if (own(result, "command") !== "SELECT" || own(result, "rowCount") !== values.length) unavailable();
    return values;
  };
  const contextKeys = ["database_oid", "backend_pid", "transaction_id", "snapshot", "actor", "session_actor",
    "read_only", "isolation", "replication", "row_security", "search_path", "first_schema", "timezone", "date_style", "interval_style", "float_digits", "bytea_output"];
  const contextSql = `select
    (select d.oid::pg_catalog.text from pg_catalog.pg_database d where d.datname=pg_catalog.current_database()) database_oid,
    pg_catalog.pg_backend_pid()::pg_catalog.text backend_pid,pg_catalog.txid_current()::pg_catalog.text transaction_id,
    pg_catalog.txid_current_snapshot()::pg_catalog.text snapshot,current_user::pg_catalog.text actor,session_user::pg_catalog.text session_actor,
    pg_catalog.current_setting('transaction_read_only') read_only,pg_catalog.current_setting('transaction_isolation') isolation,
    pg_catalog.current_setting('session_replication_role') replication,pg_catalog.current_setting('row_security') row_security,
    pg_catalog.current_setting('search_path') search_path,(pg_catalog.current_schemas(true))[1]::pg_catalog.text first_schema,
    pg_catalog.current_setting('TimeZone') timezone,
    pg_catalog.current_setting('DateStyle') date_style,pg_catalog.current_setting('IntervalStyle') interval_style,
    pg_catalog.current_setting('extra_float_digits') float_digits,pg_catalog.current_setting('bytea_output') bytea_output`;
  let originalContext;
  const context = async (final = false) => {
    const previous = storageCheckPhase; storageCheckPhase = final ? "FINAL_CONTEXT" : "CONTEXT";
    try {
    current();
    const result = await nativeRead(contextSql);
    current();
    const values = rows(result);
    if (values.length !== 1) unavailable();
    const value = closed(values[0], contextKeys);
    if (contextKeys.some(key => typeof value[key] !== "string")) contextUnavailable("TEXT_FIELDS");
    if (value.read_only !== "on") contextUnavailable("READ_ONLY");
    if (!["repeatable read", "serializable"].includes(value.isolation)) contextUnavailable("ISOLATION");
    if (value.replication !== "origin") contextUnavailable("REPLICATION");
    if (value.first_schema !== "pg_catalog") contextUnavailable("FIRST_SCHEMA");
    if (!["1", "2", "3"].includes(value.float_digits)) contextUnavailable("FLOAT_DIGITS");
    if (!/^[1-9][0-9]{0,9}(?![\s\S])/.test(value.database_oid) || BigInt(value.database_oid) > 4294967295n) contextUnavailable("DATABASE_OID");
    if (!/^[1-9][0-9]{0,9}(?![\s\S])/.test(value.backend_pid) || BigInt(value.backend_pid) > 2147483647n) contextUnavailable("BACKEND_PID");
    if (!/^[1-9][0-9]{0,19}(?![\s\S])/.test(value.transaction_id)
        || BigInt(value.transaction_id) > 18446744073709551615n) contextUnavailable("TRANSACTION_ID");
    if (!value.snapshot) contextUnavailable("SNAPSHOT");
    if (!value.actor || !value.session_actor) contextUnavailable("PRINCIPAL");
    const encoded = stableJson(value);
    if (originalContext !== undefined && encoded !== originalContext) contextUnavailable("SAME_CONTEXT");
    originalContext = encoded;
    } catch { throw remember(); }
    finally { storageCheckPhase = previous; }
  };
  const query = async (sql, values = []) => {
    await context(); current();
    const result = await nativeRead(sql, values);
    current(); await context(); current();
    return rows(result);
  };
  const quote = name => `"${name.replaceAll('"', '""')}"`;
  const count = value => typeof value === "string" && /^(?:0|[1-9][0-9]{0,18})(?![\s\S])/.test(value)
    && BigInt(value) <= 9223372036854775807n;
  const catalogKeys = ["relation_oid", "kind", "persistence", "is_partition", "inherited", "dropped", "rls_active",
    "ordinal", "name", "generated", "identity", "data_type", "primary_key", "supported_type"];
  // Only regular, non-inherited tables with complete visible columns and no
  // active RLS are compared. Core scalar/enum IO and core-element arrays do
  // not execute a caller-defined domain/composite/range conversion callback.
  const catalogSql = `select c.oid::pg_catalog.text relation_oid,c.relkind::pg_catalog.text kind,c.relpersistence::pg_catalog.text persistence,
    c.relispartition::pg_catalog.text is_partition,
    exists(select 1 from pg_catalog.pg_inherits i where i.inhrelid=c.oid or i.inhparent=c.oid)::pg_catalog.text inherited,
    exists(select 1 from pg_catalog.pg_attribute d where d.attrelid=c.oid and d.attnum>0 and d.attisdropped)::pg_catalog.text dropped,
    pg_catalog.row_security_active(c.oid)::pg_catalog.text rls_active,a.attnum::pg_catalog.text ordinal,a.attname::pg_catalog.text name,
    a.attgenerated::pg_catalog.text generated,a.attidentity::pg_catalog.text identity,pg_catalog.format_type(a.atttypid,a.atttypmod) data_type,
    coalesce((select pg_catalog.array_agg(pa.attname::pg_catalog.text order by u.ordinality)
      from pg_catalog.pg_index ix cross join lateral pg_catalog.unnest(ix.indkey) with ordinality u(attnum,ordinality)
      join pg_catalog.pg_attribute pa on pa.attrelid=c.oid and pa.attnum=u.attnum
      where ix.indrelid=c.oid and ix.indisprimary),'{}'::pg_catalog.text[]) primary_key,
    ((t.typtype in ('b','e') and ni.nspname='pg_catalog' and no.nspname='pg_catalog'
      and ((t.typtype='e' and t.typinput='pg_catalog.enum_in(pg_catalog.cstring,pg_catalog.oid)'::pg_catalog.regprocedure::pg_catalog.oid
        and t.typoutput='pg_catalog.enum_out(pg_catalog.anyenum)'::pg_catalog.regprocedure::pg_catalog.oid)
        or (nt.nspname='pg_catalog' and t.oid=any($2::pg_catalog.oid[]))) and t.typcategory<>'A')
     or (t.typtype='b' and nt.nspname='pg_catalog' and t.typcategory='A'
       and t.typinput='pg_catalog.array_in(pg_catalog.cstring,pg_catalog.oid,pg_catalog.int4)'::pg_catalog.regprocedure::pg_catalog.oid
       and t.typoutput='pg_catalog.array_out(pg_catalog.anyarray)'::pg_catalog.regprocedure::pg_catalog.oid
       and ni.nspname='pg_catalog' and no.nspname='pg_catalog'
       and et.typtype in ('b','e') and et.typcategory<>'A'
       and ((et.typtype='e' and et.typinput='pg_catalog.enum_in(pg_catalog.cstring,pg_catalog.oid)'::pg_catalog.regprocedure::pg_catalog.oid
         and et.typoutput='pg_catalog.enum_out(pg_catalog.anyenum)'::pg_catalog.regprocedure::pg_catalog.oid)
         or (ent.nspname='pg_catalog' and et.oid=any($2::pg_catalog.oid[])))
       and eni.nspname='pg_catalog' and eno.nspname='pg_catalog'))::pg_catalog.text supported_type
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    join pg_catalog.pg_type t on t.oid=a.atttypid join pg_catalog.pg_namespace nt on nt.oid=t.typnamespace
    join pg_catalog.pg_proc pi on pi.oid=t.typinput join pg_catalog.pg_namespace ni on ni.oid=pi.pronamespace
    join pg_catalog.pg_proc po on po.oid=t.typoutput join pg_catalog.pg_namespace no on no.oid=po.pronamespace
    left join pg_catalog.pg_type et on et.oid=t.typelem left join pg_catalog.pg_namespace ent on ent.oid=et.typnamespace
    left join pg_catalog.pg_proc epi on epi.oid=et.typinput left join pg_catalog.pg_namespace eni on eni.oid=epi.pronamespace
    left join pg_catalog.pg_proc epo on epo.oid=et.typoutput left join pg_catalog.pg_namespace eno on eno.oid=epo.pronamespace
    where n.nspname='storage' and c.relname=$1::pg_catalog.text order by a.attnum`;
  const catalog = async table => {
    const previous = storageCheckPhase; storageCheckPhase = "CATALOG";
    try {
    const values = (await query(catalogSql, [table.table_name, storageScalarTypeOids])).map(value => closed(value, catalogKeys));
    const supported = values.length === table.columns.length && values.every((value, index) => {
      const column = table.columns[index];
      return typeof value.relation_oid === "string" && /^[1-9][0-9]{0,9}(?![\s\S])/.test(value.relation_oid)
        && BigInt(value.relation_oid) <= 4294967295n && value.relation_oid === values[0].relation_oid
        && value.kind === "r" && value.persistence === "p" && value.is_partition === "false"
        && value.inherited === "false" && value.dropped === "false" && value.rls_active === "false"
        && value.ordinal === String(index + 1) && value.name === column.name && value.generated === column.generated
        && value.identity === column.identity && value.data_type === column.data_type && value.supported_type === "true"
        && stableJson(dense(value.primary_key)) === stableJson(table.primary_key);
    });
    return { values, supported };
    } catch { throw remember(); }
    finally { storageCheckPhase = previous; }
  };
  // Fixed pure DATA recipes from immutable-private-owner-context.sql f0c870ea...
  // (including the initial/trailing body newlines). No context-dependent
  // decoder, caller-selected recipe, or currently observed body is an oracle.
  const textHelpers = [
    ["immutable_import_text_projection", "2283", "25", ["original_record"],
      "814c1bfe130b62bbd6ffbd278b6b7b1b23546d4942a2dccbec29083d1a65c3b8"],
    ["immutable_import_text_record", "2283 25", "2283", ["prototype", "original_row_utf8"],
      "030a130aa642d5517aa4acc154de267c16034d94a6ead01b299f7653fdff1fcb"],
  ];
  const textHelperConfig = ["search_path=pg_catalog", "extra_float_digits=3", "datestyle=ISO, YMD",
    "timezone=UTC", "intervalstyle=postgres", "bytea_output=hex"];
  const textHelperKeys = ["oid", "name", "arguments", "returns", "argument_names", "body", "definition", "config", "source_attributes"];
  const textHelperSql = `select p.oid::pg_catalog.text oid,p.proname::pg_catalog.text name,
      p.proargtypes::pg_catalog.text arguments,p.prorettype::pg_catalog.text "returns",
      p.proargnames argument_names,p.prosrc body,pg_catalog.pg_get_functiondef(p.oid) definition,p.proconfig config,
      (p.prokind='f' and l.lanname='plpgsql' and l.lanispl and l.lanpltrusted
       and not p.prosecdef and not p.proleakproof and not p.proisstrict and not p.proretset
       and p.provolatile='v' and p.proparallel='u' and p.procost=100 and p.prorows=0
       and p.provariadic=0 and p.prosupport=0 and p.pronargdefaults=0 and p.proargdefaults is null
       and p.proallargtypes is null and p.proargmodes is null and p.protrftypes is null and p.prosqlbody is null
       and p.pronargs=case p.proname when 'immutable_import_text_record' then 2 else 1 end
       and current_user=session_user
       and p.proowner=(select r.oid from pg_catalog.pg_roles r where r.rolname=current_user)
       and p.proowner=(select c.relowner from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
         where ns.nspname='custodial_dr' and c.relname='restore_control' and c.relkind='r')
       and p.proowner=(select c.relowner from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
         where ns.nspname='custodial_dr' and c.relname='immutable_private_import_context' and c.relkind='r')
       and n.nspowner=(select r.oid from pg_catalog.pg_roles r where r.rolname='postgres')
       and (select d.datdba from pg_catalog.pg_database d where d.datname=pg_catalog.current_database())=n.nspowner
       and (select pg_catalog.count(*) from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))))=1
       and not exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
         where a.grantee<>p.proowner or a.grantor<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable)
      )::pg_catalog.text source_attributes
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    join pg_catalog.pg_language l on l.oid=p.prolang
    where n.nspname='custodial_dr' and p.proname in ('immutable_import_text_projection','immutable_import_text_record')
    order by p.proname collate pg_catalog."C",p.oid`;
  let originalTextHelpers;
  const requireTextHelpers = async () => {
    const previous = storageCheckPhase; storageCheckPhase = "TEXT_HELPER_SOURCE";
    try {
      const actual = (await query(textHelperSql)).map(value => closed(value, textHelperKeys)); current();
      if (actual.length !== textHelpers.length) unavailable(); // Includes unexpected overloads.
      for (let index = 0; index < textHelpers.length; index++) {
        const value = actual[index], [name, argumentsText, returns, argumentNames, bodySha] = textHelpers[index];
        if (typeof value.oid !== "string" || !/^[1-9][0-9]{0,9}(?![\s\S])/.test(value.oid)
            || BigInt(value.oid) > 4294967295n || value.name !== name || value.arguments !== argumentsText
            || value.returns !== returns || value.source_attributes !== "true"
            || typeof value.body !== "string" || createHash("sha256").update(value.body, "utf8").digest("hex") !== bodySha
            || typeof value.definition !== "string" || !value.definition
            || stableJson(dense(value.argument_names)) !== stableJson(argumentNames)) unavailable();
        // GUC identifiers are native case-insensitive names; their values,
        // count and Source order remain exact. Do not normalize any DATA or
        // the stored descriptor used for the subsequent currentness check.
        const config = dense(value.config);
        if (config.length !== textHelperConfig.length || config.some((option, i) => {
          if (typeof option !== "string" || !/^[A-Za-z_]+=/.test(option)) return true;
          const equals = option.indexOf("=");
          return option.slice(0, equals).toLowerCase() + option.slice(equals) !== textHelperConfig[i];
        })) unavailable();
      }
      if (actual[0].oid === actual[1].oid) unavailable();
      const encoded = stableJson(actual);
      if (originalTextHelpers !== undefined && encoded !== originalTextHelpers) unavailable();
      originalTextHelpers = encoded;
    } catch { throw remember(); }
    finally { storageCheckPhase = previous; }
  };
  const parameterLimit = Object.assign(new Error("Original Storage table exceeds the bounded in-memory SQL parameter path."), { code: "STORAGE_TABLE_PARAMETER_LIMIT" });
  const consume = async table => {
    const previous = storageCheckPhase; storageCheckPhase = "ORIGINAL_DATA";
    try {
    current();
    const data = openVerifiedRestoreTableData(verifiedArchive, "storage", table.table_name);
    const decoder = createRestoreRowLineBatchDecoder(), rawRows = [];
    ownedRows.add(rawRows);
    let failed = false, first, settled, bytes = 0, wireBytes = 0, eof;
    const wireLimit = new Transform({ transform(chunk, _encoding, callback) {
      wireBytes += chunk.length;
      if (wireBytes > STORAGE_TABLE_PARAMETER_BYTES) callback(parameterLimit);
      else callback(null, chunk);
    } });
    try {
      if (stableJson(data.table) !== stableJson(table)) unavailable();
      settled = pipeline(data.stream, wireLimit, decoder); settled.catch(() => {});
      for await (const batch of decoder) {
        current(); await context(); current();
        if (!Object.isFrozen(batch)) unavailable();
        // The fixed decoder's exact string batch has no IO/callback within
        // this synchronous loop; fresh source/context still bracket yields.
        for (const line of dense(batch)) {
          if (BigInt(rawRows.length) >= BigInt(table.row_count)) unavailable();
          const raw = decodeRestoreTableRowLine(line, table);
          bytes += Buffer.byteLength(raw, "utf8");
          if (bytes > STORAGE_TABLE_PARAMETER_BYTES || rawRows.length >= STORAGE_TABLE_PARAMETER_ROWS) {
            throw parameterLimit;
          }
          rawRows.push(raw);
        }
        current();
      }
      current(); await settled; current(); await context(); current();
      eof = await data.verified; current(); await context(); current();
      if (String(rawRows.length) !== table.row_count || eof.data_file !== table.data_file
          || !Number.isSafeInteger(eof.bytes) || eof.bytes < 0 || typeof eof.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(eof.sha256)) unavailable();
    } catch (error) { failed = true; first = error === parameterLimit ? error : remember(); }
    const cleanup = [];
    try { current(); } catch (error) { cleanup.push(error); }
    data.stream.destroy(); wireLimit.destroy(); decoder.destroy();
    if (settled) await settled.catch(() => {});
    try { current(); } catch (error) { cleanup.push(error); }
    try { await data.close(); } catch (error) { cleanup.push(error); }
    try { current(); } catch (error) { cleanup.push(error); }
    if (cleanup.length || failed) { rawRows.length = 0; ownedRows.delete(rawRows); }
    if (cleanup.length) throw remember();
    if (failed) throw first;
    await context(); current();
    return rawRows;
    } catch (error) { if (error === parameterLimit) throw error; throw remember(); }
    finally { storageCheckPhase = previous; }
  };
  const tables = [];
  await context(); current();
  for (const table of selection.storageTables) {
    storageCheckPhase = "SOURCE";
    current();
    if (table.schema_name !== "storage" || !selection.databaseTables.includes(table)) unavailable();
    const unresolved = reason => Object.freeze({ schema_name: "storage", table_name: table.table_name,
      status: "UNSUPPORTED", original_count: table.row_count, current_count: null, missing_count: null, extra_count: null, reason });
    const textColumns = table.data_encoding !== postgresJsonTextLineEncoding
      && table.data_encoding === postgresTextColumnsLineEncoding;
    if (table.data_encoding !== postgresJsonTextLineEncoding && !textColumns) {
      tables.push(unresolved("ORIGINAL_POSTGRES_TEXT_ENCODING_REQUIRED")); continue;
    }
    if (BigInt(table.row_count) > BigInt(STORAGE_TABLE_PARAMETER_ROWS)) {
      tables.push(unresolved("STORAGE_TABLE_PARAMETER_LIMIT")); continue;
    }
    const before = await catalog(table); current();
    if (!before.supported) { tables.push(unresolved("TARGET_SOURCE_CATALOG_OR_FULL_VISIBILITY_UNSUPPORTED")); continue; }
    if (textColumns) { await requireTextHelpers(); current(); }
    let originals;
    try { originals = await consume(table); }
    catch (error) {
      if (error !== parameterLimit) throw error;
      tables.push(unresolved("STORAGE_TABLE_PARAMETER_LIMIT")); continue;
    }
    current();
    const target = `${quote("storage")}.${quote(table.table_name)}`;
    // v1 SQL remains byte-for-byte identical. v2 never passes through a JSON
    // value image: SQL NULL, JSON null, lexical numbers and array bounds stay
    // native column TEXT in both sides of the duplicate-preserving multiset.
    if (textColumns) { await requireTextHelpers(); current(); }
    const comparisonSql = textColumns ? `with original_rows as materialized (
        select custodial_dr.immutable_import_text_projection(r) collate pg_catalog."C" row_json
        from pg_catalog.unnest($1::pg_catalog.text[]) s(raw)
        cross join lateral custodial_dr.immutable_import_text_record(null::${target},s.raw) r
      ), current_rows as materialized (
        select custodial_dr.immutable_import_text_projection(t) collate pg_catalog."C" row_json from only ${target} t
      ) select (select pg_catalog.count(*)::pg_catalog.text from original_rows) original_count,
        (select pg_catalog.count(*)::pg_catalog.text from current_rows) current_count,
        (select pg_catalog.count(*)::pg_catalog.text from (select row_json from original_rows except all select row_json from current_rows) d) missing_count,
        (select pg_catalog.count(*)::pg_catalog.text from (select row_json from current_rows except all select row_json from original_rows) d) extra_count` : `with original_rows as materialized (
        select pg_catalog.row_to_json(r)::pg_catalog.text collate pg_catalog."C" row_json
        from pg_catalog.unnest($1::pg_catalog.text[]) s(raw)
        cross join lateral pg_catalog.json_populate_record(null::${target},s.raw::pg_catalog.json) r
      ), current_rows as materialized (
        select pg_catalog.row_to_json(t)::pg_catalog.text collate pg_catalog."C" row_json from only ${target} t
      ) select (select pg_catalog.count(*)::pg_catalog.text from original_rows) original_count,
        (select pg_catalog.count(*)::pg_catalog.text from current_rows) current_count,
        (select pg_catalog.count(*)::pg_catalog.text from (select row_json from original_rows except all select row_json from current_rows) d) missing_count,
        (select pg_catalog.count(*)::pg_catalog.text from (select row_json from current_rows except all select row_json from original_rows) d) extra_count`;
    storageCheckPhase = "COMPARE";
    const compared = await query(comparisonSql, [originals]); current();
    storageCheckPhase = "CATALOG";
    const after = await catalog(table); current();
    if (!after.supported || stableJson(before.values) !== stableJson(after.values)) unavailable();
    if (textColumns) { await requireTextHelpers(); current(); }
    storageCheckPhase = "RESULT";
    if (compared.length !== 1) unavailable();
    const counts = closed(compared[0], ["original_count", "current_count", "missing_count", "extra_count"]);
    if (!Object.values(counts).every(count) || counts.original_count !== table.row_count
        || BigInt(counts.missing_count) > BigInt(counts.original_count)
        || BigInt(counts.extra_count) > BigInt(counts.current_count)
        || BigInt(counts.original_count) - BigInt(counts.missing_count) !== BigInt(counts.current_count) - BigInt(counts.extra_count)) unavailable();
    tables.push(Object.freeze({ schema_name: "storage", table_name: table.table_name,
      status: counts.missing_count === "0" && counts.extra_count === "0" ? "MATCH" : "DIFFERENT", ...counts }));
    originals.length = 0; ownedRows.delete(originals);
  }
  if (originalTextHelpers !== undefined) { await requireTextHelpers(); current(); }
  await context(true); current();
  storageCheckPhase = "RESULT";
  return Object.freeze({ sourceBinding, status: tables.length === 0 ? "NOT_APPLICABLE_ORIGINAL_NO_MEMBERS"
    : tables.some(table => table.status === "UNSUPPORTED") ? "UNSUPPORTED"
      : tables.some(table => table.status === "DIFFERENT") ? "DIFFERENT" : "MATCH", tables: Object.freeze(tables) });
  } catch { throw remember(); }
  finally { for (const rows of ownedRows) rows.length = 0; ownedRows.clear(); } // Strings are not claimed wipeable.
}

const SYSTEM_BUCKET_FIELDS = new Set(["created_at", "updated_at"]);
const SYSTEM_OBJECT_FIELDS = new Set(["id", "owner", "owner_id", "created_at", "updated_at", "last_accessed_at", "version"]);
export const STORAGE_OPERATOR_EVIDENCE_FORMAT = "memphis-zoo.storage-operator-reconciliation.v2";
export const STORAGE_OPERATOR_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function refuseAmbiguousStorageIdentities() {
  throw new Error("Current Storage identities are malformed or ambiguous; verification remains unresolved.");
}

function requireUnambiguousStorageIdentities(bucketRows, objectRows) {
  for (const [rows, fields] of [[bucketRows, ["id"]], [objectRows, ["bucket_id", "name"]]]) {
    if (isProxy(rows) || !Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype
        || Reflect.ownKeys(rows).length !== rows.length + 1) refuseAmbiguousStorageIdentities();
    const identities = new Set();
    for (let index = 0; index < rows.length; index++) {
      const entry = Object.getOwnPropertyDescriptor(rows, String(index));
      if (!entry || !Object.hasOwn(entry, "value")) refuseAmbiguousStorageIdentities();
      const row = entry.value;
      if (!row || typeof row !== "object" || isProxy(row) || Array.isArray(row)) refuseAmbiguousStorageIdentities();
      const parts = [];
      for (const field of fields) {
        const descriptor = Object.getOwnPropertyDescriptor(row, field);
        if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string"
            || !descriptor.value.trim() || descriptor.value.includes("\0")) refuseAmbiguousStorageIdentities();
        parts.push(descriptor.value);
      }
      const identity = parts.join("\0");
      if (identities.has(identity)) refuseAmbiguousStorageIdentities();
      identities.add(identity);
    }
  }
}

function requireUnambiguousArchivedStorageIdentities(bucketRows, objects) {
  try {
    if (isProxy(objects) || !Array.isArray(objects) || Object.getPrototypeOf(objects) !== Array.prototype
        || Reflect.ownKeys(objects).length !== objects.length + 1) throw new TypeError();
    const objectRows = [];
    for (let index = 0; index < objects.length; index++) {
      const entry = Object.getOwnPropertyDescriptor(objects, String(index));
      if (!entry || !Object.hasOwn(entry, "value")) throw new TypeError();
      const object = entry.value;
      if (!object || typeof object !== "object" || isProxy(object) || Array.isArray(object)) throw new TypeError();
      const databaseRow = Object.getOwnPropertyDescriptor(object, "database_row");
      if (databaseRow && !Object.hasOwn(databaseRow, "value")) throw new TypeError();
      objectRows.push(databaseRow ? databaseRow.value : object);
    }
    requireUnambiguousStorageIdentities(bucketRows, objectRows);
    return objectRows;
  } catch {
    throw new Error("Archived Storage identities are malformed or ambiguous; verification remains unresolved.");
  }
}

function isPlainObjectOrNull(value) {
  return value === null || (typeof value === "object" && !Array.isArray(value));
}

function isTimestampString(value) {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?([+-])(\d{2}):(\d{2})$/);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, offsetSign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  const maximumDay = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  return year >= 1 && day >= 1 && day <= maximumDay
    && hour <= 23 && minute <= 59 && second <= 59
    && offsetHour <= 15 && offsetMinute <= 59
    && (fractionText === undefined || !fractionText.endsWith("0"))
    && !(offsetSign === "-" && offsetHour === 0 && offsetMinute === 0)
    && Number.isFinite(Date.parse(value));
}

function definedEntries(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

export function storageOwnerPrincipalId(row) {
  const ownerValues = [row?.owner_id, row?.owner];
  if (ownerValues.some((value) => value != null && typeof value !== "string")) {
    throw new Error("Storage owner_id and legacy owner must be null or strings.");
  }
  const principalIds = [...new Set(ownerValues
    .filter((value) => value != null && value.trim() !== "")
    .map((value) => value.trim()))];
  if (principalIds.length > 1) {
    throw new Error("Storage owner_id and legacy owner must identify one unambiguous principal before backup or reconciliation.");
  }
  return principalIds[0] || null;
}

export function storageObjectArchivePath(bucketId, name) {
  return `storage/objects/${sha256(`${bucketId}\0${name}`)}.bin`;
}

export function validateV4StorageArchiveObjects(objects) {
  if (!Array.isArray(objects)) throw new Error("The v4 Storage object inventory must be an array.");
  const identities = new Set();
  const objectIds = new Set();
  const files = new Set();
  const exactWrapperFields = [
    "id", "bucket_id", "name", "file", "size_bytes", "sha256", "metadata", "user_metadata",
    "version", "created_at", "updated_at", "database_row",
  ].sort();
  for (const object of objects) {
    if (!object || typeof object !== "object" || Array.isArray(object)
        || !object.database_row || typeof object.database_row !== "object" || Array.isArray(object.database_row)) {
      throw new Error("Every v4 Storage object must retain its complete database_row.");
    }
    const row = object.database_row;
    const requiredWrapperFields = exactWrapperFields.filter((field) => field !== "database_row");
    const requiredRowFields = ["id", "bucket_id", "name", "owner_id", "owner", "metadata", "user_metadata", "version", "created_at", "updated_at", "last_accessed_at"];
    if (stableJson(Object.keys(object).sort()) !== stableJson(exactWrapperFields)
        || requiredWrapperFields.some((field) => !Object.hasOwn(object, field))
        || requiredRowFields.some((field) => !Object.hasOwn(row, field))
        || !Number.isSafeInteger(object.size_bytes) || object.size_bytes < 0
        || typeof object.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(object.sha256)) {
      throw new Error("The v4 Storage object inventory is missing its exact row or byte identity.");
    }
    for (const field of ["id", "bucket_id", "name", "metadata", "user_metadata", "version", "created_at", "updated_at"]) {
      if (stableJson(object[field]) !== stableJson(row[field])) {
        throw new Error(`The v4 Storage object wrapper disagrees with database_row.${field}.`);
      }
    }
    if (typeof row.id !== "string" || !row.id.trim()
        || typeof row.bucket_id !== "string" || !row.bucket_id.trim() || row.bucket_id.includes("\0")
        || typeof row.name !== "string" || !row.name.trim() || row.name.includes("\0")
        || !isPlainObjectOrNull(row.metadata) || !isPlainObjectOrNull(row.user_metadata)
        || !(row.version === null || (typeof row.version === "string" && row.version.trim() !== ""))
        || !isTimestampString(row.created_at) || !isTimestampString(row.updated_at)
        || !(row.last_accessed_at === null || isTimestampString(row.last_accessed_at))) {
      throw new Error("The v4 Storage object inventory contains a non-producer-shaped row value or PostgreSQL row_to_json timestamp.");
    }
    for (const field of ["owner_id", "owner"]) {
      if (!(row[field] === null || (typeof row[field] === "string" && row[field].trim() !== ""))) {
        throw new Error("The v4 Storage owner fields must be null or nonblank strings.");
      }
    }
    storageOwnerPrincipalId(row);
    const identity = `${row.bucket_id}\0${row.name}`;
    const expectedFile = storageObjectArchivePath(row.bucket_id, row.name);
    if (typeof object.file !== "string" || object.file !== expectedFile) {
      throw new Error("The v4 Storage object file must equal the deterministic producer archive path for its bucket and name.");
    }
    if (identities.has(identity) || objectIds.has(row.id) || files.has(object.file)) {
      throw new Error("The v4 Storage object inventory contains a duplicate object, database id, or archive file identity.");
    }
    identities.add(identity);
    objectIds.add(row.id);
    files.add(object.file);
  }
  return objects;
}

// DATA/lifetime preparation only. Exact metadata is carried in the installed
// SDK's supported FormData path, NEVER through options.metadata/JS Numbers.
// No DB, target, provider, effect, ACK, retry or restore permission is created.
const originalStorageUploadFormData=globalThis.FormData,originalStorageUploadBlob=globalThis.Blob;
export async function prepareVerifiedStorageUploads(options) {
  let phase='INPUT',firstFailure,closed=false;
  const objects=[],buckets=[],pins=[];
  const NativeFormData=originalStorageUploadFormData,NativeBlob=originalStorageUploadBlob;
  const get=NativeFormData?.prototype.get,entries=NativeFormData?.prototype.entries,remove=NativeFormData?.prototype.delete;
  const append=NativeFormData?.prototype.append,has=NativeFormData?.prototype.has;
  const unavailable=()=>{firstFailure ||= Object.freeze(Object.assign(new Error('Verified original Storage uploads unavailable.'),{
    code:'VERIFIED_STORAGE_UPLOAD_UNAVAILABLE',storage_upload_phase:phase,retry_safe:false,
  }));throw firstFailure;};
  const close=()=>{if(closed)return;closed=true;
    for(const pin of pins)for(const [key]of pin.fields)Reflect.apply(remove,pin.body,[key]);pins.length=0;
  };
  try {
    if(!options||typeof options!=='object'||isProxy(options)||Object.getPrototypeOf(options)!==Object.prototype
      ||Reflect.ownKeys(options).length!==1||!Object.hasOwn(options,'verifiedArchive'))unavailable();
    const field=Object.getOwnPropertyDescriptor(options,'verifiedArchive');if(!field||!Object.hasOwn(field,'value'))unavailable();
    const verifiedArchive=field.value;
    if(typeof NativeFormData!=='function'||typeof NativeBlob!=='function')unavailable();
    phase='SOURCE';
    const inventory=readVerifiedStorageUploadInventory(verifiedArchive),sourceBinding=inventory.sourceBinding;
    const selection=readVerifiedRestoreTableSelection(verifiedArchive,{databaseOnly:true});
    const current=()=>{
      if(firstFailure)throw firstFailure;
      if(closed||globalThis.FormData!==NativeFormData||globalThis.Blob!==NativeBlob
        ||NativeFormData.prototype.get!==get||NativeFormData.prototype.entries!==entries||NativeFormData.prototype.delete!==remove
        ||NativeFormData.prototype.append!==append||NativeFormData.prototype.has!==has)unavailable();
      if(readVerifiedArchiveSourceBinding(verifiedArchive)!==sourceBinding
        ||readVerifiedRestoreTableSelection(verifiedArchive,{databaseOnly:true})!==selection)unavailable();
      assertVerifiedStorageUploadCurrent(verifiedArchive);
      for(const pin of pins){const actual=[...Reflect.apply(entries,pin.body,[])];
        if(Object.getPrototypeOf(pin.body)!==NativeFormData.prototype||actual.length!==pin.fields.length
          ||['append','has','get','entries','set','delete','getAll','keys','values','forEach'].some(key=>Object.hasOwn(pin.body,key))
          ||Object.hasOwn(pin.body,Symbol.iterator)
          ||actual.some(([key,value],i)=>key!==pin.fields[i][0]||value!==pin.fields[i][1]))unavailable();
      }
    };
    const jsonFields=raw=>{
      const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))unavailable();
      const fields=new Map();let i=0;
      const ws=()=>{while(/[\x20\t\r\n]/.test(raw[i]||'\0'))i++;};
      const endString=start=>{let end=start+1;while(end<raw.length){if(raw[end]==='\\'){end+=2;continue;}
        if(raw[end]==='"')return end+1;end++;}unavailable();};
      ws();i++;ws();while(raw[i]!=='}'){
        const end=endString(i),key=JSON.parse(raw.slice(i,end));if(fields.has(key))unavailable();i=end;ws();i++;ws();
        const start=i;let depth=0;while(i<raw.length){const c=raw[i];if(c==='"'){i=endString(i);continue;}
          if(depth===0&&(c===','||c==='}'))break;if(c==='{'||c==='[')depth++;else if(c==='}'||c===']')depth--;i++;}
        fields.set(key,raw.slice(start,i).trim());if(raw[i]===','){i++;ws();}else break;
      }return fields;
    };
    const readRows=async name=>{
      phase='ORIGINAL_ROWS';current();
      const table=selection.storageTables.find(table=>table.schema_name==='storage'&&table.table_name===name);
      if(!table||![undefined,postgresJsonTextLineEncoding,postgresTextColumnsLineEncoding].includes(table.data_encoding))unavailable();
      const data=openVerifiedRestoreTableData(verifiedArchive,'storage',name);let input,guard,settled,count=0n,failed=false,failure;
      const rows=[];let bytes=0;
      try {
        guard=createRestoreRowUtf8Guard();input=createRestoreRowLineBatchDecoder();settled=pipeline(data.stream,guard,input);settled.catch(()=>{});
        for await(const batch of input){current();for(const line of batch){
          if(count>=BigInt(table.row_count)||count>=65536n)unavailable();
          const raw=decodeRestoreTableRowLine(line,data.table);bytes+=Buffer.byteLength(raw,'utf8');if(bytes>16*1024*1024)unavailable();
          const fields=jsonFields(raw),typed=table.data_encoding===postgresTextColumnsLineEncoding;
          // V2 parsing yields only original native TEXT or SQL NULL. V1
          // numeric/JSON values stay opaque spans, not rounded JS values.
          rows.push({table,fields:typed?new Map([...fields].map(([key,value])=>[key,JSON.parse(value)])):fields,typed});count++;
        }current();}
        current();await settled;current();const eof=await data.verified;current();
        if(count.toString()!==table.row_count||eof.data_file!==table.data_file||!Number.isSafeInteger(eof.bytes)
          ||typeof eof.sha256!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(eof.sha256))unavailable();
      }catch(error){failed=true;failure=error;}
      finally {
        for(const stream of [input,guard,data.stream])try{stream?.destroy();}catch(error){if(!failed){failed=true;failure=error;}}
        try{current();}catch(error){if(!failed){failed=true;failure=error;}}
        if(settled)await settled.catch(()=>{});
        try{current();}catch(error){if(!failed){failed=true;failure=error;}}
        try{await data.close();}catch(error){if(!failed){failed=true;failure=error;}}
        try{current();}catch(error){if(!failed){failed=true;failure=error;}}
      }if(failed)throw failure;return rows;
    };
    const bucketRows=await readRows('buckets');current();const objectRows=await readRows('objects');current();
    const value=(row,name,types)=>{
      const column=row.table.columns.find(column=>column.name===name);
      if(!column||!types.includes(column.data_type)||!row.fields.has(name))unavailable();
      const raw=row.fields.get(name);return row.typed?raw:raw==='null'?null:
        ['json','jsonb','boolean','bigint','text[]'].includes(column.data_type)?raw:JSON.parse(raw);
    };
    const string=value=>{if(typeof value!=='string'||!value||value.includes('\0')||Buffer.from(value,'utf8').toString('utf8')!==value)unavailable();return value;};
    const objectJSON=(raw,label)=>{if(raw===null){phase=label+'_SQL_NULL';unavailable();}
      if(raw.trim()==='null'){phase=label+'_JSON_NULL';unavailable();}
      const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)){phase=label+'_TYPE';unavailable();}return raw;};
    const sdkPath=(bucket,name)=>{if(/[\\/%?#\x00-\x20\x7f]/.test(bucket)||!name||name.startsWith('/')||name.endsWith('/')
      ||name.includes('//')||/[\\%?#\x00-\x1f\x7f]/.test(name)||name.split('/').some(part=>part==='.'||part==='..'))unavailable();};
    const array=text=>{if(text===null)return null;if(typeof text!=='string'||text[0]!=='{'||text.at(-1)!=='}')unavailable();
      if(text==='{}')return Object.freeze([]);const values=[];let i=1;
      while(i<text.length-1){let item='',quoted=false;if(text[i]==='"'){quoted=true;i++;while(i<text.length){const c=text[i++];
        if(c==='\\'){if(i>=text.length)unavailable();item+=text[i++];}else if(c==='"')break;else item+=c;}}
        else while(i<text.length-1&&text[i]!==','){const c=text[i++];if(c==='\\'){if(i>=text.length-1)unavailable();item+=text[i++];}
          else{if(/[{}"]/.test(c))unavailable();item+=c;}}
        if(!item||!quoted&&item==='NULL'||item.includes('\0'))unavailable();values.push(item);
        if(text[i]===','){i++;if(i>=text.length-1)unavailable();}else if(i!==text.length-1)unavailable();
      }return Object.freeze(values);};
    phase='MEMBERSHIP';
    if(bucketRows.length!==inventory.bucketRecords.length
      ||objectRows.length!==inventory.objectRecords.length)unavailable();
    const bucketIds=new Set(),objectIds=new Set();
    for(const row of bucketRows){
      const id=string(value(row,'id',['text']));sdkPath(id,'UNIT');if(bucketIds.has(id))unavailable();bucketIds.add(id);
      if(inventory.bucketRecords.filter(bucket=>bucket.id===id).length!==1)unavailable();
      const publicity=value(row,'public',['boolean']),limit=value(row,'file_size_limit',['bigint']);
      const mimes=value(row,'allowed_mime_types',['text[]']);
      if(!['true','false'].includes(publicity)||limit!==null&&(!/^(?:0|[1-9][0-9]*)(?![\s\S])/.test(limit)||BigInt(limit)>9223372036854775807n))unavailable();
      if(!row.typed&&mimes!==null){phase='LEGACY_ARRAY_PROFILE';unavailable();}
      buckets.push(Object.freeze({id,options:Object.freeze({public:publicity==='true',fileSizeLimit:limit,allowedMimeTypes:array(mimes)})}));
    }
    let totalBytes=0;
    for(const row of objectRows){
      phase='OBJECT_METADATA';
      const object_id=string(value(row,'id',['uuid'])),bucket_id=string(value(row,'bucket_id',['text'])),name=string(value(row,'name',['text']));sdkPath(bucket_id,name);
      if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/.test(object_id))unavailable();
      if(objectIds.has(object_id)||!bucketIds.has(bucket_id))unavailable();objectIds.add(object_id);
      const original=inventory.objectRecords.find(item=>item.object_id===object_id);
      if(!original||original.bucket_id!==bucket_id||original.name!==name)unavailable();
      if(!row.typed&&row.table.columns.some(column=>['metadata','user_metadata'].includes(column.name)&&column.data_type!=='jsonb')){
        phase='LEGACY_JSON_PROFILE';unavailable();}
      const metadata=objectJSON(value(row,'metadata',['json','jsonb']),'OBJECT_METADATA'),fields=jsonFields(metadata);
      const contentType=JSON.parse(fields.get('mimetype')??'null');string(contentType);
      const cacheFields=['cacheControl','cache_control'].filter(key=>fields.has(key));
      if(cacheFields.length!==1)unavailable();const cacheToken=fields.get(cacheFields[0]);
      if(cacheToken[0]!=='"'&&!/^(?:0|[1-9][0-9]*)(?![\s\S])/.test(cacheToken))unavailable();
      const cacheControl=cacheToken[0]==='"'?JSON.parse(cacheToken):cacheToken;string(cacheControl);
      if(/[\r\n]/.test(contentType+cacheControl)||contentType.length>1024||cacheControl.length>4096)unavailable();
      const rawMetadata=objectJSON(value(row,'user_metadata',['json','jsonb']),'USER_METADATA');
      // Multipart text parts normalize bare CR/LF. The supported SDK has no
      // exact lexical representation for those originals: refuse, don't
      // silently rewrite JSON whitespace or send a different part type.
      if(/(?<!\r)\n|\r(?!\n)/.test(rawMetadata)){phase='USER_METADATA_MULTIPART_LINE_ENDINGS';unavailable();}
      totalBytes+=original.size_bytes;if(!Number.isSafeInteger(totalBytes)||totalBytes>64*1024*1024){phase='OBJECT_BYTE_LIMIT';unavailable();}
      phase='OBJECT_BYTES';current();const data=readVerifiedStorageUploadBlob(verifiedArchive,object_id);current();
      const blob=data.blob.slice(0,data.blob.size,contentType);if(blob.type!==contentType||blob.size!==original.size_bytes)unavailable();
      const body=new NativeFormData();body.append('metadata',rawMetadata);body.append('cacheControl',cacheControl);body.append('',blob);
      // The native File is an immutable detached Blob; prevent callers from
      // shadowing its name/type/stream on the exposed multipart value.
      Object.freeze(Reflect.apply(get,body,['']));
      pins.push({body,fields:[...Reflect.apply(entries,body,[])]});
      objects.push(Object.freeze({object_id,bucket_id,name,sha256:original.sha256,size_bytes:original.size_bytes,
        body,options:Object.freeze({upsert:true,contentType,cacheControl})}));
    }
    phase='SOURCE';current();Object.freeze(objects);Object.freeze(buckets);
    return Object.freeze({sourceBinding,buckets,objects,requireCurrent:()=>{try{current();}catch{unavailable();}},close});
  }catch {try{close();}catch{}unavailable();}
}

export function storageBucketOptions(bucket) {
  return definedEntries({
    public: Boolean(bucket.public),
    fileSizeLimit: bucket.file_size_limit == null ? undefined : Number(bucket.file_size_limit),
    allowedMimeTypes: bucket.allowed_mime_types || undefined,
  });
}

export function storageObjectUploadOptions(object) {
  const row = object.database_row || object;
  const metadata = row.metadata || object.metadata || {};
  return definedEntries({
    upsert: true,
    contentType: metadata.mimetype || "application/octet-stream",
    cacheControl: metadata.cacheControl || metadata.cache_control || "0",
    metadata: row.user_metadata ?? object.user_metadata ?? undefined,
  });
}

function difference(scope, key, field, expected, actual, support, identity = {}) {
  return { scope, key, ...identity, field, support, expected: expected ?? null, actual: actual ?? null };
}

export function compareStorageState({ archivedBuckets, archivedObjects, actualBuckets, actualObjects }) {
  requireUnambiguousStorageIdentities(actualBuckets, actualObjects);
  const archivedObjectRows = requireUnambiguousArchivedStorageIdentities(archivedBuckets, archivedObjects);
  const differences = [];
  const bucketById = new Map(actualBuckets.map((bucket) => [String(bucket.id), bucket]));
  const archivedBucketIds = new Set(archivedBuckets.map((bucket) => String(bucket.id)));
  for (const archived of archivedBuckets) {
    const key = String(archived.id);
    const actual = bucketById.get(key);
    if (!actual) {
      differences.push(difference("bucket", key, "presence", true, false, "supported", {
        expected_bucket_row: archived,
      }));
      continue;
    }
    for (const [field, expected] of Object.entries(archived)) {
      if (field === "id") continue;
      if (stableJson(expected) !== stableJson(actual[field])) {
        differences.push(difference("bucket", key, field, expected, actual[field], SYSTEM_BUCKET_FIELDS.has(field) ? "platform_managed" : "supported"));
      }
    }
  }
  for (const actual of actualBuckets) {
    if (!archivedBucketIds.has(String(actual.id))) differences.push(difference("bucket", String(actual.id), "target_only", false, true, "operator_reconciliation"));
  }

  const objectKey = (object) => `${object.bucket_id}\0${object.name}`;
  const objectIdentity = (object) => ({
    key: stableJson([String(object.bucket_id), String(object.name)]),
    bucket_id: String(object.bucket_id),
    name: String(object.name),
  });
  const actualObjectByKey = new Map(actualObjects.map((object) => [objectKey(object), object]));
  const archivedObjectKeys = new Set();
  for (let index = 0; index < archivedObjects.length; index++) {
    const object = archivedObjects[index];
    const archived = archivedObjectRows[index];
    const key = objectKey(archived);
    archivedObjectKeys.add(key);
    const actual = actualObjectByKey.get(key);
    const identity = objectIdentity(archived);
    if (!actual) {
      const { last_accessed_at: _downloadSideEffect, ...expectedObjectRow } = archived;
      differences.push(difference("object", identity.key, "presence", true, false, "supported", {
        ...identity,
        expected_object_row: expectedObjectRow,
        expected_object_sha256: String(object.sha256 || ""),
        expected_object_size_bytes: Number(object.size_bytes),
      }));
      continue;
    }
    for (const [field, expected] of Object.entries(archived)) {
      if (["bucket_id", "name"].includes(field)) continue;
      if (stableJson(expected) !== stableJson(actual[field])) {
        differences.push(difference("object", identity.key, field, expected, actual[field], SYSTEM_OBJECT_FIELDS.has(field) ? "platform_managed_or_owner" : "supported", identity));
      }
    }
    const archivedOwnerPrincipalId = storageOwnerPrincipalId(archived);
    if (archivedOwnerPrincipalId && archivedOwnerPrincipalId === storageOwnerPrincipalId(actual)) {
      differences.push(difference("object", identity.key, "owner_access_boundary", "owner-scoped access test", "not independently exercised", "operator_reconciliation", identity));
    }
  }
  for (const actual of actualObjects) {
    const key = objectKey(actual);
    const identity = objectIdentity(actual);
    if (!archivedObjectKeys.has(key)) differences.push(difference("object", identity.key, "target_only", false, true, "operator_reconciliation", identity));
  }
  return differences;
}

// Private sampler syntax check, not an alternate evidence format or public
// normalizer. The installed Node primitive context must prove that every
// numeric token survives ordinary v1 JSON serialization WITHOUT rounding.
function supportedStorageV1Json(raw, refuse) {
  if (typeof raw !== "string" || Buffer.byteLength(raw,"utf8") > 16*1024*1024
    || Buffer.from(raw,"utf8").toString("utf8") !== raw) refuse("RAW_TEXT_UNAVAILABLE");
  let i=0,nodes=0;
  const ws=()=>{while(/[\x20\t\r\n]/.test(raw[i]||"\0"))i++;};
  const string=()=>{const start=i++;while(i<raw.length){const c=raw[i++];if(c==='\\'){i++;continue;}
    if(c==='"')return JSON.parse(raw.slice(start,i));}refuse("JSON_SYNTAX");};
  const scan=depth=>{
    if(depth>64||++nodes>1000000)refuse("JSON_LIMIT");ws();const c=raw[i];
    if(c==='{'){i++;ws();const keys=new Set();if(raw[i]==='}'){i++;return;}
      for(;;){if(raw[i]!=='"')refuse("JSON_SYNTAX");const key=string();
        if(Buffer.from(key,"utf8").toString("utf8")!==key)refuse("V1_UNICODE_UNREPRESENTABLE");
        if(keys.has(key))refuse("DUPLICATE_KEY");keys.add(key);
        ws();if(raw[i++]!==':')refuse("JSON_SYNTAX");scan(depth+1);ws();if(raw[i]==='}'){i++;return;}
        if(raw[i++]!==',')refuse("JSON_SYNTAX");ws();}}
    if(c==='['){i++;ws();if(raw[i]===']'){i++;return;}for(;;){scan(depth+1);ws();if(raw[i]===']'){i++;return;}
      if(raw[i++]!==',')refuse("JSON_SYNTAX");}}
    if(c==='"'){string();return;}
    const start=i;while(i<raw.length&&!/[\x20\t\r\n,\]}]/.test(raw[i]))i++;
    if(start===i)refuse("JSON_SYNTAX");
  };
  scan(0);ws();if(i!==raw.length)refuse("JSON_SYNTAX");
  return JSON.parse(raw,(_key,value,context)=>{
    if(typeof value==='number' && (!context || typeof context.source!=='string'
      || JSON.stringify(value)!==context.source))refuse("V1_NUMBER_UNREPRESENTABLE");
    if(typeof value==='string' && Buffer.from(value,"utf8").toString("utf8")!==value)refuse("V1_UNICODE_UNREPRESENTABLE");
    return value;
  });
}

// Only the native one-dimensional, ordinary lower-bound text[] profile is
// representable by v1. SQL NULL vs text "NULL" remain distinct. No flattening.
function supportedStorageTextArray(text, refuse) {
  if(typeof text!=='string'||text[0]!=='{'||text.at(-1)!=='}')refuse("V1_ARRAY_PROFILE_UNSUPPORTED");
  if(text==='{}')return [];
  const values=[];let i=1;
  while(i<text.length-1){let value='',quoted=false,closed=false;
    if(text[i]==='"'){quoted=true;i++;while(i<text.length){const c=text[i++];
      if(c==='\\'){if(i>=text.length)refuse("V1_ARRAY_PROFILE_UNSUPPORTED");value+=text[i++];}
      else if(c==='"'){closed=true;break;}else value+=c;}
      if(!closed)refuse("V1_ARRAY_PROFILE_UNSUPPORTED");
    }else{while(i<text.length-1&&text[i]!==','){const c=text[i++];
      if(c==='\\'){if(i>=text.length-1)refuse("V1_ARRAY_PROFILE_UNSUPPORTED");value+=text[i++];}
      else{if(/[{}"\s]/.test(c))refuse("V1_ARRAY_PROFILE_UNSUPPORTED");value+=c;}}
      if(!value)refuse("V1_ARRAY_PROFILE_UNSUPPORTED");}
    values.push(!quoted&&/^NULL$/i.test(value)?null:value);
    if(text[i]===','){i++;if(i>=text.length-1)refuse("V1_ARRAY_PROFILE_UNSUPPORTED");}
    else if(i!==text.length-1)refuse("V1_ARRAY_PROFILE_UNSUPPORTED");
  }return values;
}

export async function captureStorageSupportedState({ db, downloadObject, observedAt = null }) {
  let phase="INPUT",firstFailure;
  const refuse=reason=>{firstFailure ||= Object.freeze(Object.assign(new Error("Current supported Storage state unavailable; verification remains unresolved."),{
    code:"STORAGE_SUPPORTED_STATE_UNAVAILABLE",storage_sample_phase:phase,storage_sample_reason:reason,retry_safe:false,
  }));throw firstFailure;};
  const own=(value,key)=>{if(!value||typeof value!=='object'||isProxy(value))refuse("CLOSED_DATA_REQUIRED");
    const field=Object.getOwnPropertyDescriptor(value,key);if(!field||!Object.hasOwn(field,'value'))refuse("CLOSED_DATA_REQUIRED");return field.value;};
  const dense=value=>{if(!value||isProxy(value)||!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype
    ||Reflect.ownKeys(value).length!==value.length+1)refuse("CLOSED_DATA_REQUIRED");return Array.from({length:value.length},(_,i)=>own(value,String(i)));};
  try {
    if(!db||isProxy(db)||typeof downloadObject!=="function"||isProxy(downloadObject))refuse("INPUT_UNAVAILABLE");
    const method=()=>{let object=db;for(let depth=0;object&&depth<8;depth++,object=Object.getPrototypeOf(object)){
      if(isProxy(object))refuse("QUERY_PORT_CHANGED");const field=Object.getOwnPropertyDescriptor(object,'query');
      if(field){if(!Object.hasOwn(field,'value')||typeof field.value!=='function'||isProxy(field.value))refuse("QUERY_PORT_CHANGED");return field.value;}}
      refuse("QUERY_PORT_CHANGED");};
    const query=method(),current=()=>{if(method()!==query)refuse("QUERY_PORT_CHANGED");};
    const read=async(sql,limit)=>{current();const result=await Reflect.apply(query,db,[sql]);current();
      const rows=dense(own(result,'rows'));if(own(result,'command')!=='SELECT'||own(result,'rowCount')!==rows.length||rows.length>limit)refuse("COMPLETE_ROWS_REQUIRED");return rows;};
    const parse=raw=>supportedStorageV1Json(raw,refuse);
    const names=['buckets','objects'];
    // Core scalar OIDs from installed pg-types; domains/user IO/composites and
    // unmodeled arrays are NOT silently accepted. This is observation only.
    const types=new Map([['16','bool'],['20','int8'],['21','int2'],['23','int4'],['25','text'],['1043','varchar'],['2950','uuid'],
      ['114','json'],['3802','jsonb'],['1700','numeric'],['700','float4'],['701','float8'],['1009','_text'],
      ['1082','date'],['1083','time'],['1114','timestamp'],['1184','timestamptz'],['1266','timetz']]);
    const catalogSql=`select pg_catalog.json_build_object(
      'table_name',c.relname,'relation_oid',c.oid::pg_catalog.text,'owner',c.relowner::pg_catalog.text,'namespace_owner',n.nspowner::pg_catalog.text,
      'ordinal',a.attnum::pg_catalog.text,'name',a.attname,'type_oid',t.oid::pg_catalog.text,'type_name',t.typname,
      'type_kind',t.typtype::pg_catalog.text,'type_namespace',tn.nspname,'modifier',a.atttypmod::pg_catalog.text,
      'input_oid',pi.oid::pg_catalog.text,'output_oid',po.oid::pg_catalog.text,'input_source',pi.prosrc,'output_source',po.prosrc,
      'native_io',(li.lanname='internal' and lo.lanname='internal' and ni.nspname='pg_catalog' and no.nspname='pg_catalog'
        and pi.prokind='f' and po.prokind='f' and not pi.prosecdef and not po.prosecdef)::pg_catalog.text,
      'visible',(not pg_catalog.row_security_active(c.oid))::pg_catalog.text,
      'shape',(c.relkind='r' and c.relpersistence='p' and not c.relispartition
        and not exists(select 1 from pg_catalog.pg_inherits i where i.inhrelid=c.oid or i.inhparent=c.oid)
        and not exists(select 1 from pg_catalog.pg_attribute d where d.attrelid=c.oid and d.attnum>0 and d.attisdropped))::pg_catalog.text,
      'database_oid',(select d.oid::pg_catalog.text from pg_catalog.pg_database d where d.datname=pg_catalog.current_database()),
      'backend_pid',pg_catalog.pg_backend_pid()::pg_catalog.text,'actor',current_user::pg_catalog.text,'session_actor',session_user::pg_catalog.text,
      'isolation',pg_catalog.current_setting('transaction_isolation'),'snapshot',pg_catalog.txid_current_snapshot()::pg_catalog.text,
      'date_style',pg_catalog.current_setting('DateStyle'),'timezone',pg_catalog.current_setting('TimeZone'),
      'float_digits',pg_catalog.current_setting('extra_float_digits'))::pg_catalog.text descriptor
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
      join pg_catalog.pg_type t on t.oid=a.atttypid join pg_catalog.pg_namespace tn on tn.oid=t.typnamespace
      join pg_catalog.pg_proc pi on pi.oid=t.typinput join pg_catalog.pg_namespace ni on ni.oid=pi.pronamespace
      join pg_catalog.pg_language li on li.oid=pi.prolang
      join pg_catalog.pg_proc po on po.oid=t.typoutput join pg_catalog.pg_namespace no on no.oid=po.pronamespace
      join pg_catalog.pg_language lo on lo.oid=po.prolang
      where n.nspname='storage' and c.relname in ('buckets','objects') order by c.relname collate pg_catalog."C",a.attnum limit 2049`;
    const catalog=async()=>{
      phase="CATALOG";const columns=(await read(catalogSql,2048)).map(row=>parse(own(row,'descriptor')));
      const keys=['table_name','relation_oid','owner','namespace_owner','ordinal','name','type_oid','type_name','type_kind','type_namespace','modifier',
        'input_oid','output_oid','input_source','output_source','native_io','visible','shape','database_oid','backend_pid','actor','session_actor','isolation','snapshot','date_style','timezone','float_digits'];
      const context=column=>stableJson(Object.fromEntries(['database_oid','backend_pid','actor','session_actor','isolation','snapshot','date_style','timezone','float_digits'].map(key=>[key,column[key]])));
      for(const table of names){const selected=columns.filter(column=>column.table_name===table),identities=new Set();
        if(!selected.length)refuse("CATALOG_UNAVAILABLE");
        for(let i=0;i<selected.length;i++){const column=selected[i];
          if(!column||typeof column!=='object'||Array.isArray(column)||Reflect.ownKeys(column).length!==keys.length
            ||keys.some(key=>!Object.hasOwn(column,key)||typeof column[key]!=='string')||column.ordinal!==String(i+1)
            ||!column.name||Buffer.byteLength(column.name,'utf8')>63||column.name.includes('\0')||identities.has(column.name)
            ||column.type_kind!=='b'||column.type_namespace!=='pg_catalog'||types.get(column.type_oid)!==column.type_name
            ||column.native_io!=='true'||column.visible!=='true'||column.shape!=='true'
            ||!['repeatable read','serializable'].includes(column.isolation)||!column.actor||!column.session_actor||!column.snapshot
            ||['relation_oid','owner','namespace_owner','input_oid','output_oid','database_oid','backend_pid'].some(key=>!/^[1-9][0-9]{0,9}(?![\s\S])/.test(column[key]))
            ||column.relation_oid!==selected[0].relation_oid||column.owner!==selected[0].owner||context(column)!==context(columns[0]))refuse("CATALOG_UNSUPPORTED");
          identities.add(column.name);
        }
      }
      if(columns.some(column=>!names.includes(column.table_name)))refuse("CATALOG_UNSUPPORTED");return columns;
    };
    const quote=name=>'"'+name.replaceAll('"','""')+'"',literal=name=>"E'"+name.replaceAll('\\','\\\\').replaceAll("'","''")+"'";
    const verify=(column,value,text)=>{
      const type=column.type_name;
      if(text===null){if(value!==null)refuse("NATIVE_TEXT_MISMATCH");if(['json','jsonb'].includes(type))refuse("V1_NULL_AMBIGUOUS");return;}
      if(typeof text!=='string'||value===null)refuse(['json','jsonb'].includes(type)?"V1_NULL_AMBIGUOUS":"NATIVE_TEXT_MISMATCH");
      if(['text','varchar','uuid'].includes(type)){if(typeof value!=='string'||value!==text)refuse("NATIVE_TEXT_MISMATCH");}
      else if(['bool','int8','int2','int4','numeric','float4','float8'].includes(type)){
        if((type==='bool'?typeof value!=='boolean':typeof value!=='number')||JSON.stringify(value)!==text)refuse("V1_NUMBER_UNREPRESENTABLE");
        if(['float4','float8'].includes(type)&&column.float_digits!=='3')refuse("V1_FLOAT_PROFILE_UNSUPPORTED");
      }else if(['json','jsonb'].includes(type)){
        const original=parse(text);if(stableJson(value)!==stableJson(original))refuse("NATIVE_TEXT_MISMATCH");
        if(original===null)refuse("V1_NULL_AMBIGUOUS");
        if(type==='json'&&text!==stableJson(original))refuse("V1_JSON_LEXICAL_UNREPRESENTABLE");
      }else if(type==='_text'){
        if(!Array.isArray(value)||stableJson(value)!==stableJson(supportedStorageTextArray(text,refuse)))refuse("V1_ARRAY_PROFILE_UNSUPPORTED");
      }else{
        // Native JSON datetime strings preserve microseconds; never Date/Number
        // coerce them. Only the fixed ISO native text profile is modeled here.
        if(!column.date_style.startsWith('ISO, ')||typeof value!=='string')refuse("V1_TIME_PROFILE_UNSUPPORTED");
        let expected=text;
        if(['timestamp','timestamptz'].includes(type))expected=expected.replace(' ','T');
        if(['timestamptz','timetz'].includes(type))expected=expected.replace(/([+-][0-9]{2})$/,'$1:00');
        if(value!==expected)refuse("V1_TIME_PROFILE_UNSUPPORTED");
      }
    };
    const sample=async()=>{
      const columns=await catalog(),rows={},images={};let bytes=0;
      for(const table of names){phase="RAW_ROWS";const selected=columns.filter(column=>column.table_name===table);
        const projection=`pg_catalog.json_object(ARRAY[${selected.map(column=>literal(column.name)).join(',')}]::pg_catalog.text[],ARRAY[${selected.map(column=>'r.'+quote(column.name)+'::pg_catalog.text').join(',')}]::pg_catalog.text[])::pg_catalog.text`;
        const order=table==='buckets'?'r."id"':'r."bucket_id",r."name",r."id"';
        const result=await read(`select pg_catalog.row_to_json(r)::pg_catalog.text row,${projection} native_text from "storage".${quote(table)} r order by ${order} limit 65537`,65536);
        rows[table]=[];images[table]=[];
        for(const resultRow of result){const raw=own(resultRow,'row'),native=own(resultRow,'native_text');
          if(typeof raw!=='string'||typeof native!=='string'||(bytes+=Buffer.byteLength(raw)+Buffer.byteLength(native))>16*1024*1024)refuse("ROW_LIMIT");
          const row=parse(raw),image=parse(native),keys=selected.map(column=>column.name);
          if(!row||!image||Array.isArray(row)||Array.isArray(image)||Object.keys(row).length!==keys.length||Object.keys(image).length!==keys.length
            ||keys.some(key=>!Object.hasOwn(row,key)||!Object.hasOwn(image,key)))refuse("CLOSED_DATA_REQUIRED");
          for(const column of selected)verify(column,row[column.name],image[column.name]);
          rows[table].push(row);images[table].push(image);
        }
      }
      phase="CURRENTNESS";const after=await catalog();
      phase="CURRENTNESS";
      if(stableJson(after)!==stableJson(columns))refuse("CATALOG_CHANGED");
      requireUnambiguousStorageIdentities(rows.buckets,rows.objects);
      // Validate every owner BEFORE the first download, including late rows.
      for(const row of rows.objects)storageOwnerPrincipalId(row);
      const objectIds=new Set();for(const row of rows.objects){if(typeof row.id!=='string'||!row.id||objectIds.has(row.id))refuse("CURRENT_IDENTITY_UNAVAILABLE");objectIds.add(row.id);}
      if(rows.objects.some(row=>!rows.buckets.some(bucket=>bucket.id===row.bucket_id)))refuse("CURRENT_IDENTITY_UNAVAILABLE");
      return {columns,rows,image:stableJson({buckets:images.buckets,objects:images.objects.map(({last_accessed_at:_ignored,...row})=>row)})};
    };
    const before=await sample(),bucketRows=before.rows.buckets,objectRows=before.rows.objects;
    const supportedObjectRows=objectRows.map(({last_accessed_at:_ignored,...row})=>row);
    const selectedMetadata=stableJson({buckets:bucketRows,objects:supportedObjectRows}),objectByteDigests=[];
    for(const row of objectRows){phase="DOWNLOAD";current();const downloaded=await downloadObject(row.bucket_id,row.name);current();
      if(isProxy(downloaded)||!(Buffer.isBuffer(downloaded)||downloaded instanceof Uint8Array||downloaded instanceof ArrayBuffer))refuse("BYTE_DATA_UNAVAILABLE");
      const bytes=Buffer.from(downloaded instanceof ArrayBuffer?new Uint8Array(downloaded):downloaded);
      objectByteDigests.push({bucket_id:row.bucket_id,name:row.name,owner_principal_id:storageOwnerPrincipalId(row),size_bytes:bytes.length,sha256:sha256(bytes)});
    }
    const after=await sample();phase="CURRENTNESS";current();
    if(stableJson(before.columns)!==stableJson(after.columns)||before.image!==after.image
      ||stableJson({buckets:after.rows.buckets,objects:after.rows.objects.map(({last_accessed_at:_ignored,...row})=>row)})!==selectedMetadata)refuse("METADATA_CHANGED");
    requireUnambiguousStorageIdentities([],objectByteDigests);
    const state={bucket_count:bucketRows.length,object_count:objectRows.length,bucket_rows:bucketRows,object_rows:supportedObjectRows,
      metadata_sha256:sha256(selectedMetadata),object_byte_digests:objectByteDigests,object_bytes_sha256:sha256(stableJson(objectByteDigests))};
    phase="RESULT";current();return {format:"memphis-zoo.storage-supported-state-resample.v1",
      observed_at:new Date(observedAt||Date.now()).toISOString(),state,state_sha256:sha256(stableJson(state))};
  }catch{refuse(phase==="DOWNLOAD"?"DOWNLOAD_FAILED":"READ_OR_PROFILE_UNAVAILABLE");}
}

export function validateStorageOperatorEvidence({
  evidence,
  discrepancy,
  manifestUpdatedAt,
  finalManifestSha256,
  discrepancySnapshotSha256,
  supportedStateResample,
  reconciliationDisposition = "RESOLVED",
  requireBindings = false,
  now = Date.now(),
}) {
  const exactRecheckRequired = () => {
    throw Object.assign(new Error("Storage reconciliation is held pending a same-original current native exact-table recheck."), {
      code: "STORAGE_EXACT_RECONCILIATION_HELD", retry_safe: false,
    });
  };
  const dataRecord = value => {
    if (!value || typeof value !== "object" || isProxy(value)
        || Object.getPrototypeOf(value) !== Object.prototype) exactRecheckRequired();
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).some(key => typeof key !== "string" || !Object.hasOwn(fields[key], "value"))) exactRecheckRequired();
    return fields;
  };
  const discrepancyFields = dataRecord(discrepancy);
  const detailFields = dataRecord(discrepancyFields.details_json?.value);
  // Only the retained, nonempty, parsed-only legacy platform/access obligation
  // can use the old operator route. Modern restore evidence also contains
  // exact_table_data and/or final_quiescent_resample: neither historical MATCH
  // nor an asserted replacement status is a CURRENT native exact recheck.
  // Unknown/omitted/malformed envelope fields must not erase that obligation.
  // In particular, do not adopt nested final differences over original ones.
  if (Reflect.ownKeys(detailFields).length !== 1 || !Object.hasOwn(detailFields, "discrepancies")) exactRecheckRequired();
  const differences = detailFields.discrepancies.value;
  if (isProxy(differences) || !Array.isArray(differences) || Object.getPrototypeOf(differences) !== Array.prototype
      || differences.length === 0 || Reflect.ownKeys(differences).length !== differences.length + 1) exactRecheckRequired();
  for (let index = 0; index < differences.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(differences, String(index));
    if (!entry || !Object.hasOwn(entry, "value")) exactRecheckRequired();
    const fields = dataRecord(entry.value);
    const scope = fields.scope?.value, field = fields.field?.value, support = fields.support?.value;
    const platform = (scope === "bucket" && SYSTEM_BUCKET_FIELDS.has(field) && support === "platform_managed")
      || (scope === "object" && SYSTEM_OBJECT_FIELDS.has(field) && !["owner", "owner_id"].includes(field)
        && support === "platform_managed_or_owner");
    const owner = scope === "object" && ["owner", "owner_id", "owner_access_boundary"].includes(field);
    // Original supported DATA, presence/bytes and membership cannot be waived
    // or established by matching rounded resample values. Owner/access checks
    // below remain independent and still cannot waive a missing/changed owner.
    if (!platform && !owner) exactRecheckRequired();
  }
  const verifiedAt = Date.parse(String(evidence?.verified_at || ""));
  const manifestAt = Date.parse(String(manifestUpdatedAt || ""));
  if (!evidence || evidence.format !== STORAGE_OPERATOR_EVIDENCE_FORMAT
      || String(evidence.verification_method || "").trim().length < 20
      || !Number.isFinite(verifiedAt) || !Number.isFinite(manifestAt)
      || verifiedAt < manifestAt || verifiedAt > now || now - verifiedAt > STORAGE_OPERATOR_EVIDENCE_MAX_AGE_MS
      || !["PRESERVED", "ACCEPTED_LOSS", "NOT_APPLICABLE"].includes(evidence.platform_managed_disposition)
      || !supportedStateResample || !/^[0-9a-f]{64}$/.test(String(supportedStateResample.state_sha256 || ""))
      || !Array.isArray(supportedStateResample.state?.bucket_rows)
      || !Array.isArray(supportedStateResample.state?.object_rows)
      || sha256(stableJson(supportedStateResample.state)) !== supportedStateResample.state_sha256) {
    throw new Error("Storage operator evidence must be current v2 proof newer than the exact final manifest.");
  }
  requireUnambiguousStorageIdentities(supportedStateResample.state.bucket_rows, supportedStateResample.state.object_rows);
  requireUnambiguousStorageIdentities([], supportedStateResample.state.object_byte_digests);
  const currentBuckets = new Map(supportedStateResample.state.bucket_rows.map((row) => [String(row.id), row]));
  const currentObjects = new Map(supportedStateResample.state.object_rows.map((row) => [`${row.bucket_id}\0${row.name}`, row]));
  const currentObjectDigests = new Map(supportedStateResample.state.object_byte_digests.map((row) => [`${row.bucket_id}\0${row.name}`, row]));
  function currentRecord(row) {
    return row?.scope === "bucket"
      ? currentBuckets.get(String(row.key || ""))
      : currentObjects.get(`${String(row.bucket_id || "")}\0${String(row.name || "")}`);
  }
  function presenceIdentityIsComplete(row) {
    if (row?.scope === "bucket") {
      return row.expected_bucket_row && typeof row.expected_bucket_row === "object"
        && !Array.isArray(row.expected_bucket_row) && String(row.expected_bucket_row.id) === String(row.key || "");
    }
    return row?.scope === "object"
      && row.expected_object_row && typeof row.expected_object_row === "object" && !Array.isArray(row.expected_object_row)
      && String(row.expected_object_row.bucket_id) === String(row.bucket_id || "")
      && String(row.expected_object_row.name) === String(row.name || "")
      && /^[0-9a-f]{64}$/.test(String(row.expected_object_sha256 || ""))
      && Number.isSafeInteger(row.expected_object_size_bytes) && row.expected_object_size_bytes >= 0;
  }
  function differenceIsResolved(row) {
    const current = currentRecord(row);
    if (row?.field === "presence" && row?.expected === true) {
      if (!current || !presenceIdentityIsComplete(row)) return false;
      if (row.scope === "bucket") return stableJson(current) === stableJson(row.expected_bucket_row);
      const digest = currentObjectDigests.get(`${String(row.bucket_id)}\0${String(row.name)}`);
      return Boolean(digest)
        && stableJson(current) === stableJson(row.expected_object_row)
        && digest.sha256 === row.expected_object_sha256
        && Number(digest.size_bytes) === row.expected_object_size_bytes;
    }
    if (row?.field === "target_only") return !current;
    if (!current || !Object.hasOwn(current, row?.field)) return false;
    return stableJson(current[row.field] ?? null) === stableJson(row?.expected ?? null);
  }
  const valueDifferences = differences.filter((row) => row?.field !== "owner_access_boundary");
  const presenceDifferences = valueDifferences.filter((row) => row?.field === "presence" && row?.expected === true);
  if (presenceDifferences.some((row) => !presenceIdentityIsComplete(row))) {
    throw new Error("A missing archived Storage entry must retain its exact signed row and object byte identity before reconciliation.");
  }
  for (const row of presenceDifferences.filter((item) => item.scope === "object")) {
    storageOwnerPrincipalId(row.expected_object_row);
  }
  const unresolvedDifferences = valueDifferences.filter((row) => !differenceIsResolved(row));
  const replacementOwnerDrift = presenceDifferences.filter((row) => row.scope === "object" && currentRecord(row)).some((row) => {
    const current = currentRecord(row);
    return ["owner_id", "owner"].some((field) => {
      const expectedHasField = Object.hasOwn(row.expected_object_row, field);
      const currentHasField = Object.hasOwn(current, field);
      return expectedHasField !== currentHasField
        || (expectedHasField && stableJson(current[field]) !== stableJson(row.expected_object_row[field]));
    });
  });
  if (unresolvedDifferences.some((row) => row?.scope === "object" && ["owner", "owner_id"].includes(row?.field))) {
    throw new Error("Storage ownership must be restored to the signed archived principal before operator reconciliation can resume admission.");
  }
  if (replacementOwnerDrift) {
    throw new Error("A replacement Storage object must restore the signed archived owner before operator reconciliation can resume admission.");
  }
  if (unresolvedDifferences.length > 0
      && (reconciliationDisposition !== "ACCEPTED_LOSS" || evidence.platform_managed_disposition !== "ACCEPTED_LOSS")) {
    throw new Error("Remaining missing or changed Storage state requires an explicit signed ACCEPTED_LOSS reconciliation and evidence disposition.");
  }
  if (unresolvedDifferences.length === 0
      && (reconciliationDisposition === "ACCEPTED_LOSS" || evidence.platform_managed_disposition === "ACCEPTED_LOSS")) {
    throw new Error("Storage state repaired in the current resample cannot be mislabeled as ACCEPTED_LOSS.");
  }
  const requiredOwnerObjects = differences
    .filter((row) => row?.field === "owner_access_boundary" && row?.scope === "object")
    .map((row) => ({ bucket_id: String(row.bucket_id || ""), name: String(row.name || "") }))
    .concat(valueDifferences
      .filter((row) => row?.scope === "object" && ["owner", "owner_id"].includes(row?.field)
        && !unresolvedDifferences.includes(row))
      .map((row) => ({ bucket_id: String(row.bucket_id || ""), name: String(row.name || "") })))
    .concat(valueDifferences
      .filter((row) => row?.scope === "object" && row?.field === "presence" && row?.expected === true
        && Boolean(storageOwnerPrincipalId(currentObjects.get(`${String(row.bucket_id || "")}\0${String(row.name || "")}`))))
      .map((row) => ({ bucket_id: String(row.bucket_id || ""), name: String(row.name || "") })))
    .filter((row, index, rows) => rows.findIndex((item) => item.bucket_id === row.bucket_id && item.name === row.name) === index)
    .sort((a, b) => `${a.bucket_id}\0${a.name}`.localeCompare(`${b.bucket_id}\0${b.name}`));
  if (requiredOwnerObjects.some((row) => !row.bucket_id || !row.name)) {
    throw new Error("Storage owner-boundary discrepancies must persist an exact bucket and object name.");
  }
  const ownerAccessResults = (Array.isArray(evidence.owner_access_results) ? evidence.owner_access_results : []).map((row) => ({
    bucket_id: String(row?.bucket_id || ""),
    name: String(row?.name || ""),
    owner_principal_id: String(row?.owner_principal_id || ""),
    non_owner_principal_id: String(row?.non_owner_principal_id || ""),
    owner_read_succeeded: row?.owner_read_succeeded === true,
    non_owner_read_denied: row?.non_owner_read_denied === true,
    tested_at: new Date(row?.tested_at).toISOString(),
    evidence_reference: String(row?.evidence_reference || "").trim(),
  })).sort((a, b) => `${a.bucket_id}\0${a.name}`.localeCompare(`${b.bucket_id}\0${b.name}`));
  if (stableJson(ownerAccessResults.map(({ bucket_id, name }) => ({ bucket_id, name }))) !== stableJson(requiredOwnerObjects)) {
    throw new Error("Storage owner-access results must name the exact object discrepancy set.");
  }
  for (const result of ownerAccessResults) {
    const testedAt = Date.parse(result.tested_at);
    const currentObject = supportedStateResample.state.object_byte_digests.find((row) => row.bucket_id === result.bucket_id && row.name === result.name);
    const currentObjectRow = currentObjects.get(`${result.bucket_id}\0${result.name}`);
    const currentOwnerPrincipalId = storageOwnerPrincipalId(currentObjectRow);
    if (!currentObject || currentObject.owner_principal_id !== currentOwnerPrincipalId
        || currentOwnerPrincipalId !== result.owner_principal_id
        || !/^[a-zA-Z0-9._@:-]{2,160}$/.test(result.owner_principal_id)
        || !/^[a-zA-Z0-9._@:-]{2,160}$/.test(result.non_owner_principal_id)
        || result.non_owner_principal_id === result.owner_principal_id
        || result.owner_read_succeeded !== true || result.non_owner_read_denied !== true
        || testedAt < manifestAt || testedAt > now || now - testedAt > STORAGE_OPERATOR_EVIDENCE_MAX_AGE_MS
        || result.evidence_reference.length < 20 || result.evidence_reference.length > 2000) {
      throw new Error("A current named owner/non-owner access result is required for every owner-boundary object.");
    }
  }
  const bindings = {
    final_manifest_sha256: finalManifestSha256,
    discrepancy_snapshot_sha256: discrepancySnapshotSha256,
    supported_state_resample_sha256: supportedStateResample.state_sha256,
  };
  if (requireBindings && Object.entries(bindings).some(([key, value]) => evidence[key] !== value)) {
    throw new Error("Storage operator evidence is not bound to the exact manifest, discrepancy snapshot, and supported-state resample.");
  }
  const boundAt = requireBindings ? Date.parse(String(evidence.bound_at || "")) : now;
  if (!Number.isFinite(boundAt) || boundAt < Date.parse(supportedStateResample.observed_at)
      || boundAt < verifiedAt || boundAt > now || now - boundAt > STORAGE_OPERATOR_EVIDENCE_MAX_AGE_MS) {
    throw new Error("Storage operator evidence must be bound after the exact supported-state resample and remain current.");
  }
  return {
    format: STORAGE_OPERATOR_EVIDENCE_FORMAT,
    verification_method: String(evidence.verification_method).trim(),
    verified_at: new Date(verifiedAt).toISOString(),
    platform_managed_disposition: evidence.platform_managed_disposition,
    owner_access_results: ownerAccessResults,
    bound_at: new Date(boundAt).toISOString(),
    ...bindings,
  };
}
// Narrow selector for the existing isolated Storage-byte fixture only.
// This proves no lease, database identity, recovery or signing authority.
// URI query overrides must not turn a localhost label into a remote pg target.
export function isExplicitLocalRestoreFixtureTarget(databaseUrl) {
  if(typeof databaseUrl!=="string"||databaseUrl.length>65536||databaseUrl!==databaseUrl.trim()
    ||/[?#]/.test(databaseUrl))return false;
  let target;try{target=new URL(databaseUrl);}catch{return false;}
  return ["postgres:","postgresql:"].includes(target.protocol)
    && target.search===""&&target.hash===""
    && /^(127\.0\.0\.1|localhost)$/.test(target.hostname)
    && /^\/mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(target.pathname);
}


// Explicit disposable same-original provider. This is not a production target,
// import, ACK, role override or metadata-repair authority. The official FILE
// backend is populated at archived versions before its server starts; this
// consumer only reads through the genuine official HTTP API.
const freshLocalStorageTokens = new WeakMap();
const freshLocalStorageFetch = globalThis.fetch;
const freshLocalStorageImage = "sha256:528ec49c3c32561908b07ee91bced7f8456f3b688164e341eaa422441767a0bd";
const freshStorageHash = value => createHash("sha256").update(value).digest("hex");
function freshStorageRefuse() { throw Object.assign(new Error("Fresh local Storage provider binding is unavailable."), {code:"FRESH_LOCAL_STORAGE_PROVIDER_UNAVAILABLE",outcome:"UNKNOWN",retry_safe:false}); }
function freshStorageData(value, depth=0) {
  if(depth>12)freshStorageRefuse();
  if(value===null || typeof value==="boolean" || typeof value==="string" && value.length<=1048576 || typeof value==="number" && Number.isSafeInteger(value))return value;
  if(!value || typeof value!=="object" || isProxy(value))freshStorageRefuse();
  const array=Array.isArray(value), proto=Object.getPrototypeOf(value);
  if(proto!==(array?Array.prototype:Object.prototype))freshStorageRefuse();
  const keys=Reflect.ownKeys(value);
  if(keys.length>4096 || keys.some(k=>typeof k!=="string"))freshStorageRefuse();
  const out=array?[]:{};
  if(array && keys.length!==value.length+1)freshStorageRefuse();
  for(const key of keys){
    if(array && key==="length")continue;
    if(array && !/^(0|[1-9][0-9]*)$/.test(key))freshStorageRefuse();
    if(["__proto__","constructor","prototype","toJSON"].includes(key))freshStorageRefuse();
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d || !Object.hasOwn(d,"value") || !d.enumerable)freshStorageRefuse();
    out[key]=freshStorageData(d.value,depth+1);
  }
  return out;
}
function freshStorageClosed(value,keys){
  if(!value || Array.isArray(value) || Object.keys(value).sort().join("|")!==keys.slice().sort().join("|"))freshStorageRefuse();
  return value;
}
export function freshLocalStorageArchiveBinding(verifiedArchive){
  const sourceBinding=readVerifiedArchiveSourceBinding(verifiedArchive);
  const selection=readVerifiedRestoreTableSelection(verifiedArchive,{databaseOnly:true});
  const source_profile=selection.privateTables.length ? "immutable-private-fresh-supabase-admin"
    : selection.databaseTables.length && selection.databaseTables.every(t=>t.data_encoding===postgresTextColumnsLineEncoding)
      ? "native-text-v4-existing-postgres" : null;
  if(!source_profile)freshStorageRefuse();
  const inventory=readVerifiedStorageUploadInventory(verifiedArchive);
  return Object.freeze({source_profile,expected_session_user:source_profile==="native-text-v4-existing-postgres"?"postgres":"supabase_admin",
    expected_database_owner:"postgres",sourceBinding,
    archived_storage_inventory_sha256:freshStorageHash(stableJson({buckets:inventory.bucketRecords,objects:inventory.objectRecords})),
    bucket_count:inventory.bucketRecords.length,object_count:inventory.objectRecords.length});
}
// DATA validator, also used by the actual branded capture below. A returned
// object alone never opens a connection or creates a usable provider token.
export function validateFreshLocalStorageProviderData(options){
  try {
  const o=freshStorageData(options);
  freshStorageClosed(o,["providerEnvelope","originalIntentEnvelope","intentVerifyKey","intentVerifyKeyId","serviceKey","jwtSecret","databaseUrl","expected"]);
  const e=freshStorageClosed(o.expected,["source_profile","expected_session_user","expected_database_owner","archive_digest","source_project_ref","source_identity_sha256","archived_storage_inventory_sha256"]);
  const profiles={"native-text-v4-existing-postgres":"postgres","immutable-private-fresh-supabase-admin":"supabase_admin"};
  if(!Object.hasOwn(profiles,e.source_profile) || e.expected_session_user!==profiles[e.source_profile] || e.expected_database_owner!=="postgres")freshStorageRefuse();
  const intent=captureVerifiedOriginalRestoreIntent(o.originalIntentEnvelope,o.intentVerifyKey,o.intentVerifyKeyId);
  freshStorageClosed(intent,["restore_id","authority_generation","retry_of_restore_id","archive_digest","source_project_ref","target_project_ref","source_identity_sha256","target_migration_head","target_release_identity","actor","approved_at","expires_at","resume_after_verification"]);
  if(intent.archive_digest!==e.archive_digest || intent.source_project_ref!==e.source_project_ref || intent.source_identity_sha256!==e.source_identity_sha256
    || intent.authority_generation!==1 || intent.retry_of_restore_id!==null || intent.resume_after_verification!==false)freshStorageRefuse();
  const envelope=freshStorageClosed(o.providerEnvelope,["format","algorithm","key_id","binding","signature"]);
  if(envelope.format!=="custodial.immutable-fresh-local-storage-provider.v1" || envelope.algorithm!=="hmac-sha256" || envelope.key_id!==o.intentVerifyKeyId
    || !/^[a-f0-9]{64}$/.test(envelope.signature) || !verifyBinding(envelope.binding,envelope.signature,o.intentVerifyKey))freshStorageRefuse();
  const b=freshStorageClosed(envelope.binding,["purpose","source_profile","original_intent_sha256","restore_id","authority_generation","archive_digest","source_identity_sha256","source_project_ref","target_project_ref","approved_at","expires_at","host_target","provider"]);
  if(b.purpose!=="custodial-immutable-fresh-local-storage-provider" || b.source_profile!==e.source_profile || b.original_intent_sha256!==freshStorageHash(stableJson(o.originalIntentEnvelope)))freshStorageRefuse();
  for(const key of ["restore_id","authority_generation","archive_digest","source_identity_sha256","source_project_ref","target_project_ref"])if(b[key]!==intent[key])freshStorageRefuse();
  const approved=Date.parse(b.approved_at),expires=Date.parse(b.expires_at),originalApproved=Date.parse(intent.approved_at),originalExpires=Date.parse(intent.expires_at);
  if(![approved,expires,originalApproved,originalExpires].every(Number.isFinite) || approved<originalApproved || approved>Date.now() || expires>originalExpires
    || expires<=Date.now() || expires-approved>86400000)freshStorageRefuse();
  const h=freshStorageClosed(b.host_target,["hostname","port","database_name","database_oid","session_user","database_owner"]);
  const u=new URL(o.databaseUrl);
  if(!["postgres:","postgresql:"].includes(u.protocol) || u.hostname!=="127.0.0.1" || u.search || u.hash || u.username!==e.expected_session_user
    || h.hostname!==u.hostname || h.port!==Number(u.port||5432) || h.database_name!==decodeURIComponent(u.pathname.slice(1))
    || !/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(h.database_name) || !/^[1-9][0-9]{0,9}$/.test(h.database_oid)
    || h.session_user!==e.expected_session_user || h.database_owner!==e.expected_database_owner)freshStorageRefuse();
  const p=freshStorageClosed(b.provider,["origin","container_id","image_digest","namespace","config_sha256","service_key_sha256","jwt_secret_sha256","database","backend","restore_method","archived_storage_inventory_sha256","archived_migrations_74_full_tuple_sha256","file_backend_namespace_sha256"]);
  const origin=new URL(p.origin);
  if(origin.protocol!=="http:" || origin.hostname!=="127.0.0.1" || !origin.port || Number(origin.port)<1024 || origin.username || origin.password || origin.pathname!=="/" || origin.search || origin.hash
    || p.origin!==origin.origin || !/^[a-f0-9]{64}$/.test(p.container_id) || p.image_digest!==freshLocalStorageImage
    || !/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(p.namespace) || p.backend!=="file" || p.restore_method!=="official-file-backend-archived-version-v1"
    || p.archived_storage_inventory_sha256!==e.archived_storage_inventory_sha256 || typeof o.serviceKey!=="string" || o.serviceKey.length<32 || o.serviceKey.length>16384
    || p.service_key_sha256!==freshStorageHash(o.serviceKey) || typeof o.jwtSecret!=="string" || Buffer.byteLength(o.jwtSecret)<32 || Buffer.byteLength(o.jwtSecret)>16384 || o.jwtSecret===o.intentVerifyKey || p.jwt_secret_sha256!==freshStorageHash(o.jwtSecret))freshStorageRefuse();
  for(const k of ["config_sha256","archived_migrations_74_full_tuple_sha256","file_backend_namespace_sha256"])if(!/^[a-f0-9]{64}$/.test(p[k]))freshStorageRefuse();
  const d=freshStorageClosed(p.database,["network_alias","port","database_name","database_oid","role"]);
  if(!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(d.network_alias) || d.port!==5432 || d.database_name!==h.database_name || d.database_oid!==h.database_oid || d.role!=="supabase_storage_admin")freshStorageRefuse();
  return Object.freeze({binding:b,intent});
  } catch { freshStorageRefuse(); }
}
export function captureVerifiedFreshLocalStorageProvider(options){
  if(!options || typeof options!=='object' || isProxy(options) || Object.getPrototypeOf(options)!==Object.prototype)freshStorageRefuse();
  const keys=['verifiedArchive','originalIntentEnvelope','intentVerifyKey','intentVerifyKeyId','providerEnvelope','serviceKey','jwtSecret','databaseUrl'];
  if(Reflect.ownKeys(options).length!==keys.length)freshStorageRefuse();
  const values=keys.map(k=>{const d=Object.getOwnPropertyDescriptor(options,k);if(!d || !Object.hasOwn(d,'value'))freshStorageRefuse();return d.value;});
  const [verifiedArchive,originalIntentEnvelope,intentVerifyKey,intentVerifyKeyId,providerEnvelope,serviceKey,jwtSecret,databaseUrl]=values;
  assertVerifiedArchiveIndependentIntentKey(verifiedArchive,intentVerifyKey);
  assertVerifiedArchiveIndependentIntentKey(verifiedArchive,jwtSecret);
  const archive=freshLocalStorageArchiveBinding(verifiedArchive),s=archive.sourceBinding;
  const captured=validateFreshLocalStorageProviderData({providerEnvelope,originalIntentEnvelope,intentVerifyKey,intentVerifyKeyId,serviceKey,jwtSecret,databaseUrl,
    expected:{source_profile:archive.source_profile,expected_session_user:archive.expected_session_user,expected_database_owner:archive.expected_database_owner,
      archive_digest:s.archive_digest,source_project_ref:s.project_ref,source_identity_sha256:s.source_identity_sha256,archived_storage_inventory_sha256:archive.archived_storage_inventory_sha256}});
  const token=Object.freeze({});
  freshLocalStorageTokens.set(token,{...captured,verifiedArchive,sourceBinding:s,serviceKey,jwtSecret,databaseUrl,db:null,connection:null,stream:null});
  return token;
}
export async function verifyFreshLocalStorageProvider({token,db,state}){
  const c=freshLocalStorageTokens.get(token);
  if(!c || !["STORAGE_RESTORING","VERIFYING"].includes(state))freshStorageRefuse();
  const b=c.binding;
  const native=()=>{
    if(Date.parse(b.expires_at)<=Date.now() || readVerifiedArchiveSourceBinding(c.verifiedArchive)!==c.sourceBinding
      || !db || isProxy(db) || Object.getPrototypeOf(db)!==StorageTableClient.prototype || Object.hasOwn(db,"query")
      || StorageTableClient.prototype.query!==storageTableQuery || db._connected!==true || db._ending!==false || db._ended!==false || db._queryable!==true
      || db._txStatus!=="I" || db.readyForQuery!==true || db._activeQuery || db._queryQueue.length || globalThis.fetch!==freshLocalStorageFetch)freshStorageRefuse();
    const connection=db.connection,stream=connection?.stream;
    if(!connection || isProxy(connection) || !stream || isProxy(stream) || stream.destroyed || stream.remoteAddress!=="127.0.0.1"
      || stream.remotePort!==b.host_target.port || db.connectionParameters?.database!==b.host_target.database_name || db.connectionParameters?.user!==b.host_target.session_user)freshStorageRefuse();
    if(c.db!==null && (c.db!==db || c.connection!==connection || c.stream!==stream))freshStorageRefuse();
    c.db=db;c.connection=connection;c.stream=stream;
  };
  const context=async()=>{
    native();
    const r=await Reflect.apply(storageTableQuery,db,[`select current_database() database_name,(select oid::text from pg_catalog.pg_database where datname=current_database()) database_oid,
      session_user::text session_user,current_user::text current_user,(select pg_catalog.pg_get_userbyid(datdba) from pg_catalog.pg_database where datname=current_database()) database_owner,
      restore_id::text,authority_generation::text,archive_digest,source_project_ref,target_project_ref,mutations_paused,state
      from custodial_dr.restore_control where singleton=true`]);
    native();const r0=r.rows?.[0];
    if(r.command!=="SELECT" || r.rowCount!==1 || !r0 || r0.database_name!==b.host_target.database_name || r0.database_oid!==b.host_target.database_oid
      || r0.session_user!==b.host_target.session_user || r0.current_user!==b.host_target.session_user || r0.database_owner!==b.host_target.database_owner
      || r0.restore_id!==b.restore_id || r0.authority_generation!==String(b.authority_generation) || r0.archive_digest!==b.archive_digest
      || r0.source_project_ref!==b.source_project_ref || r0.target_project_ref!==b.target_project_ref || r0.mutations_paused!==true || r0.state!==state)freshStorageRefuse();
  };
  const request=async(path,limit,bearer=c.serviceKey,deny=false)=>{
    await context();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await freshLocalStorageFetch(b.provider.origin+path,{method:"GET",headers:{authorization:`Bearer ${bearer}`,apikey:c.serviceKey},redirect:"error",signal:controller.signal});
      await context();
      if(response.url!==b.provider.origin+path)freshStorageRefuse();
      if(deny){if(![401,403,404].includes(response.status))freshStorageRefuse();await response.body?.cancel();await context();return response.status;}
      if(!response.ok || !response.body)freshStorageRefuse();
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.byteLength;if(size>limit){controller.abort();freshStorageRefuse();}chunks.push(Buffer.from(chunk));}
      await context();return Buffer.concat(chunks);
    }finally{clearTimeout(timer);}
  };
  // Readiness is allowed only after the original data/fence reached this exact
  // storage boundary, never as an excuse to start/migrate an empty database.
  const deadline=Date.now()+120000;
  for(;;){try{await request('/status',65536);break;}catch(error){await context();if(Date.now()>=deadline)throw error;await new Promise(r=>setTimeout(r,250));}}
  const inventory=readVerifiedStorageUploadInventory(c.verifiedArchive);
  if(inventory.sourceBinding!==c.sourceBinding)freshStorageRefuse();
  let totalBytes=0;
  for(const object of inventory.objectRecords){totalBytes+=object.size_bytes;if(!Number.isSafeInteger(totalBytes) || totalBytes>64*1024*1024)freshStorageRefuse();}
  const current=()=>assertVerifiedStorageUploadCurrent(c.verifiedArchive);
  const jwt=(role,sub)=>{
    const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
    const body=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role,...(sub?{sub}:{}),aud:'authenticated',iat:Math.floor(Date.now()/1000),exp:Math.min(Math.floor(Date.parse(b.expires_at)/1000),Math.floor(Date.now()/1000)+300)});
    return body+'.'+createHmac('sha256',c.jwtSecret).update(body).digest('base64url');
  };
  const roleProbes=[];
    for(const object of inventory.objectRecords){
      if(typeof object.bucket_id!=="string" || /[\\/%?#\x00-\x20\x7f]/.test(object.bucket_id) || typeof object.name!=="string" || !object.name || object.name.startsWith('/') || object.name.endsWith('/')
        || object.name.includes('//') || /[\\%?#\x00-\x1f\x7f]/.test(object.name) || object.name.split('/').some(part=>part==='.'||part==='..'))freshStorageRefuse();
      current();
      // Independently reopen the signed archived blob; no upload/multipart
      // encoding restrictions are imposed on this read-only provider path.
      const original=readVerifiedStorageUploadBlob(c.verifiedArchive,object.object_id);
      if(original.blob.size!==object.size_bytes)freshStorageRefuse();
      const path='/object/authenticated/'+encodeURIComponent(object.bucket_id)+'/'+object.name.split('/').map(encodeURIComponent).join('/');
      const bytes=await request(path,object.size_bytes);
      current();
      if(bytes.length!==object.size_bytes || freshStorageHash(bytes)!==object.sha256)freshStorageRefuse();
      await context();
      const metadata=await Reflect.apply(storageTableQuery,db,[`select to_jsonb(o) object_row,b.public
        from storage.objects o join storage.buckets b on b.id=o.bucket_id where o.id=$1::uuid and o.bucket_id=$2 and o.name=$3`,[object.object_id,object.bucket_id,object.name]]);
      await context();
      if(metadata.rowCount!==1 || typeof metadata.rows[0].public!=='boolean')freshStorageRefuse();
      const owner=storageOwnerPrincipalId(metadata.rows[0].object_row),publicBucket=metadata.rows[0].public;
      if(owner!==null && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(owner))freshStorageRefuse();
      const rolePath=publicBucket?'/object/public/'+encodeURIComponent(object.bucket_id)+'/'+object.name.split('/').map(encodeURIComponent).join('/'):path;
      const verify=async bearer=>{const actual=await request(rolePath,object.size_bytes,bearer);if(actual.length!==object.size_bytes || freshStorageHash(actual)!==object.sha256)freshStorageRefuse();};
      if(owner!==null)await verify(jwt('authenticated',owner));
      else if(!publicBucket)freshStorageRefuse(); // No invented owner for an ownerless private object.
      const foreign=owner==='00000000-0000-4000-8000-000000000001'?'00000000-0000-4000-8000-000000000002':'00000000-0000-4000-8000-000000000001';
      let foreignStatus,anonStatus;
      if(publicBucket){await verify(jwt('authenticated',foreign));await verify(jwt('anon'));foreignStatus=anonStatus='PUBLIC_EXACT_BYTES';}
      else{foreignStatus=await request(path,65536,jwt('authenticated',foreign),true);anonStatus=await request(path,65536,jwt('anon'),true);}
      const invalidStatus=await request(path,65536,'invalid-signature.'+freshStorageHash(object.object_id),true);
      roleProbes.push(Object.freeze({bucket_id:object.bucket_id,name:object.name,owner_principal:owner,public:publicBucket,
        intended:owner!==null?'OWNER_EXACT_BYTES':'PUBLIC_EXACT_BYTES',foreign:foreignStatus,anon:anonStatus,invalid_signature:invalidStatus,status:'VERIFIED_CURRENT_RESTORED_ROLE_BOUNDARY'}));
    }
    await context();
    return Object.freeze({provider_verified:true,object_bytes_verified:true,verified_object_bytes:inventory.objectRecords.length,
      archived_buckets:inventory.bucketRecords.length,scope:"OFFICIAL_LOCAL_FILE_BACKEND_SAME_ORIGINAL",source_profile:b.source_profile,
      provider_image_digest:b.provider.image_digest,provider_container_id:b.provider.container_id,
      archived_storage_inventory_sha256:b.provider.archived_storage_inventory_sha256,database_oid:b.host_target.database_oid,
      production_provider_verified:false,owner_access_probes:Object.freeze(roleProbes)});
}
