import { stableJson } from "./disaster-recovery-crypto.mjs";
import { isDeepStrictEqual, types } from "node:util";

// Fixed catalog discovery, not sequence-name guessing or OWNED BY inference.
// No SQL is evaluated from the returned expression. A supported default must
// deparse exactly as the built-in nextval call of its ONE regclass dependency.
const CRON_JOB_DEFAULT_SEQUENCE_SQL = `
  with job as (
    select c.oid job_oid,c.relowner job_owner_oid,c.relkind::text job_kind,
      c.relpersistence::text job_persistence,a.attnum,a.atttypid,a.attidentity::text job_identity,
      a.attgenerated::text job_generated,d.oid default_oid,d.adbin::text default_node,
      pg_catalog.pg_get_expr(d.adbin,d.adrelid) default_expression
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attname='jobid'
      and a.attnum>0 and not a.attisdropped
    left join pg_catalog.pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname='cron' and c.relname='job'
  ), dependencies as (
    select d.* from job j join pg_catalog.pg_depend d
      on d.classid='pg_catalog.pg_attrdef'::pg_catalog.regclass
      and d.objid=j.default_oid and d.objsubid=0
  ), sequences as (
    select c.* from dependencies d join pg_catalog.pg_class c on c.oid=d.refobjid
    where d.refclassid='pg_catalog.pg_class'::pg_catalog.regclass
      and d.refobjsubid=0 and d.deptype='n' and c.relkind='S'
  )
  select j.job_oid::text,j.attnum::integer job_attribute_number,
    pg_catalog.pg_get_userbyid(j.job_owner_oid) job_owner,j.job_kind,j.job_persistence,
    j.atttypid::text job_type_oid,j.job_identity,j.job_generated,
    j.default_oid::text,j.default_node,j.default_expression,
    (select count(*)::integer from sequences) sequence_dependency_count,
    (select count(*)::integer from dependencies d where not (
      (d.refclassid='pg_catalog.pg_class'::pg_catalog.regclass and (
        (d.refobjid=j.job_oid and d.refobjsubid=j.attnum and d.deptype='a') or
        (d.refobjid=s.oid and d.refobjsubid=0 and d.deptype='n'))) or
      (d.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass
        and d.refobjid='pg_catalog.nextval(pg_catalog.regclass)'::pg_catalog.regprocedure
        and d.refobjsubid=0 and d.deptype='n') or
      (d.refclassid='pg_catalog.pg_type'::pg_catalog.regclass
        and d.refobjid in ('pg_catalog.int8'::pg_catalog.regtype,'pg_catalog.regclass'::pg_catalog.regtype)
        and d.refobjsubid=0 and d.deptype='n')
    )) unsupported_dependency_count,
    s.oid::text sequence_oid,n.nspname schema_name,s.relname sequence_name,
    pg_catalog.pg_get_userbyid(s.relowner) owner_name,s.relkind::text sequence_kind,
    s.relpersistence::text sequence_persistence,
    (case when pg_catalog.pg_function_is_visible('pg_catalog.nextval(pg_catalog.regclass)'::pg_catalog.regprocedure)
      then 'nextval' else 'pg_catalog.nextval' end)||'('||
      pg_catalog.quote_literal(s.oid::pg_catalog.regclass::text)||'::'||
      pg_catalog.format_type('pg_catalog.regclass'::pg_catalog.regtype,null)||')' expected_expression,
    (select oid::text from pg_catalog.pg_database where datname=current_database()) database_oid,
    pg_catalog.pg_backend_pid() backend_pid,current_user actor,session_user session_actor,
    pg_catalog.transaction_timestamp()::text transaction_started_at,
    (select l.virtualtransaction::text from pg_catalog.pg_locks l
      where l.pid=pg_catalog.pg_backend_pid() and l.locktype='virtualxid' and l.granted) virtual_transaction
  from job j left join sequences s on true
  left join pg_catalog.pg_namespace n on n.oid=s.relnamespace
`;

const sequenceFields = Object.freeze([
  "job_oid", "job_attribute_number", "job_owner", "job_kind", "job_persistence", "job_type_oid", "job_identity", "job_generated",
  "default_oid", "default_node", "default_expression", "sequence_dependency_count", "unsupported_dependency_count",
  "sequence_oid", "schema_name", "sequence_name", "owner_name", "sequence_kind", "sequence_persistence", "expected_expression",
  "database_oid", "backend_pid", "actor", "session_actor", "transaction_started_at", "virtual_transaction",
]);

// Detached catalog DATA only. Caller still owns the real transaction, original
// actor, application fences and rollback. This creates no admission/capability.
export async function resolveCronJobDefaultSequence(client) {
  const result = await client.query(CRON_JOB_DEFAULT_SEQUENCE_SQL);
  const fail = () => { throw new Error("Original pg_cron jobid default sequence is unsupported or changed."); };
  if (!result || result.rowCount !== 1 || !Array.isArray(result.rows) || result.rows.length !== 1) fail();
  const row = result.rows[0];
  if (!row || typeof row !== "object" || types.isProxy(row) || Object.getPrototypeOf(row) !== Object.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(row);
  if (!isDeepStrictEqual(Reflect.ownKeys(descriptors).sort(), [...sequenceFields].sort())) fail();
  const value = {};
  for (const key of sequenceFields) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) fail();
    value[key] = descriptor.value;
  }
  const oid = text => typeof text === "string" && /^[1-9][0-9]{0,9}$/.test(text)
    && text.trim() === text && BigInt(text) <= 4294967295n;
  const name = text => typeof text === "string" && text.length > 0 && !text.includes("\0")
    && Buffer.byteLength(text, "utf8") <= 63 && Buffer.from(text, "utf8").toString("utf8") === text;
  // PostgreSQL 17 can assign backend slot zero; the local transaction
  // component remains positive and the complete identity stays pinned below.
  if (![value.job_oid, value.default_oid, value.sequence_oid, value.database_oid].every(oid)
    || ![value.job_owner, value.schema_name, value.sequence_name, value.owner_name, value.actor, value.session_actor].every(name)
    || !Number.isInteger(value.job_attribute_number) || value.job_attribute_number < 1
    || value.job_kind !== "r" || value.job_persistence !== "p" || value.job_type_oid !== "20"
    || value.job_identity !== "" || value.job_generated !== ""
    || value.sequence_dependency_count !== 1 || value.unsupported_dependency_count !== 0
    || value.sequence_kind !== "S" || value.sequence_persistence !== "p"
    || typeof value.default_node !== "string" || !value.default_node.length || value.default_node.length > 16384
    || typeof value.default_expression !== "string" || !value.default_expression.length || value.default_expression.length > 1024
    || value.default_expression !== value.expected_expression
    || !Number.isInteger(value.backend_pid) || value.backend_pid < 1 || value.backend_pid > 2147483647
    || typeof value.transaction_started_at !== "string" || !value.transaction_started_at.length
    || typeof value.virtual_transaction !== "string" || !/^(?:0|[1-9][0-9]*)\/[1-9][0-9]*$/.test(value.virtual_transaction)
    || value.virtual_transaction.trim() !== value.virtual_transaction) fail();
  return Object.freeze(value);
}

export const CRON_JOB_FIELDS = [
  "jobid",
  "schedule",
  "command",
  "nodename",
  "nodeport",
  "database",
  "username",
  "active",
  "jobname",
];

function canonicalJobId(value, label) {
  // Old archives may contain exactly representable JSON integers. Never guess
  // lost bits from an unsafe Number; new captures use PostgreSQL BIGINT text.
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) value = String(value);
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value) || value.trim() !== value
      || BigInt(value) > 9223372036854775807n) {
    throw new Error(`${label} contains an invalid pg_cron BIGINT jobid.`);
  }
  return value;
}

function exactJob(job, label) {
  if (!job || typeof job !== "object" || Array.isArray(job)) throw new Error(`${label} must be an object.`);
  const keys = Object.keys(job).sort();
  const expected = [...CRON_JOB_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} does not match the supported pg_cron job catalog.`);
  }
  const jobid = canonicalJobId(job.jobid, label);
  if (!String(job.schedule || "").trim() || !String(job.command || "").trim()
      || !String(job.nodename || "").trim() || !Number.isSafeInteger(Number(job.nodeport))
      || Number(job.nodeport) < 1 || Number(job.nodeport) > 65535
      || !String(job.database || "").trim() || !String(job.username || "").trim()
      || typeof job.active !== "boolean" || (job.jobname != null && !String(job.jobname).trim())) {
    throw new Error(`${label} contains invalid pg_cron job state.`);
  }
  return {
    jobid,
    schedule: String(job.schedule),
    command: String(job.command),
    nodename: String(job.nodename),
    nodeport: Number(job.nodeport),
    database: String(job.database),
    username: String(job.username),
    active: job.active,
    jobname: job.jobname == null ? null : String(job.jobname),
  };
}

export function normalizedCronJobs(jobs, { sourceDatabase = null, targetDatabase = null } = {}) {
  if (!Array.isArray(jobs)) throw new Error("Signed cron inventory must be an array.");
  const seenIds = new Set();
  const seenNames = new Set();
  return jobs.map((job, index) => {
    const normalized = exactJob(job, `Signed cron job ${index + 1}`);
    if (seenIds.has(normalized.jobid)) throw new Error(`Signed cron job id ${normalized.jobid} is duplicated.`);
    seenIds.add(normalized.jobid);
    if (normalized.jobname != null) {
      if (seenNames.has(normalized.jobname)) throw new Error(`Signed cron job name ${normalized.jobname} is duplicated.`);
      seenNames.add(normalized.jobname);
    }
    if (sourceDatabase && targetDatabase && normalized.database === sourceDatabase) normalized.database = targetDatabase;
    return normalized;
  }).sort((left, right) => BigInt(left.jobid) < BigInt(right.jobid) ? -1 : BigInt(left.jobid) > BigInt(right.jobid) ? 1 : 0);
}

export function compareCronJobs(expected, actual) {
  const expectedJson = stableJson(normalizedCronJobs(expected));
  const actualJson = stableJson(normalizedCronJobs(actual));
  return expectedJson === actualJson ? [] : [{
    category: "cron_state",
    expected_sha256_input: expectedJson,
    actual_sha256_input: actualJson,
  }];
}

export async function readCronJobs(client) {
  const result = await client.query(`
    select json_build_object(
      'jobid', j.jobid::text, 'schedule', j.schedule, 'command', j.command,
      'nodename', j.nodename, 'nodeport', j.nodeport, 'database', j.database,
      'username', j.username, 'active', j.active, 'jobname', j.jobname
    ) row from cron.job j order by j.jobid
  `);
  return normalizedCronJobs(result.rows.map((item) => item.row));
}

export async function restoreCronJobs(client, archivedJobs, { sourceDatabase = null } = {}) {
  const target = await client.query("select current_database() database_name");
  const targetDatabase = String(target.rows[0]?.database_name || "");
  if (!targetDatabase) throw new Error("Restore target database identity is unavailable for pg_cron reconciliation.");
  const expected = normalizedCronJobs(archivedJobs, { sourceDatabase, targetDatabase });
  const originalSequence = await resolveCronJobDefaultSequence(client);
  const requireOriginalSequence = async () => {
    if (!isDeepStrictEqual(await resolveCronJobDefaultSequence(client), originalSequence)) {
      throw new Error("Original pg_cron jobid default sequence is unsupported or changed.");
    }
  };
  const before = await readCronJobs(client);
  await requireOriginalSequence();
  // RESTART (unlike setval alone) creates a transactional counter lifecycle
  // even for extension sequences without OWNED BY. No WITH value: PostgreSQL
  // uses its existing stored start; definition/owner/bounds remain untouched.
  // Catalog names are validated detached strings, never caller SQL.
  const quoteIdentifier = value => '"' + value.replaceAll('"', '""') + '"';
  await client.query(`alter sequence ${quoteIdentifier(originalSequence.schema_name)}.${quoteIdentifier(originalSequence.sequence_name)} restart`);
  await requireOriginalSequence();
  await client.query("truncate cron.job restart identity");
  await requireOriginalSequence();
  for (const job of expected) {
    await client.query(`
      insert into cron.job(jobid,schedule,command,nodename,nodeport,database,username,active,jobname)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, CRON_JOB_FIELDS.map((field) => job[field]));
    await requireOriginalSequence();
  }
  const maximumId = expected.reduce((maximum, job) => {
    const id = BigInt(job.jobid);
    return id > maximum ? id : maximum;
  }, 1n).toString();
  await requireOriginalSequence();
  await client.query("select setval($1::regclass,$2,$3)", [originalSequence.sequence_oid, maximumId, expected.length > 0]);
  await requireOriginalSequence();
  const actual = await readCronJobs(client);
  await requireOriginalSequence();
  const differences = compareCronJobs(expected, actual);
  return { before, expected, actual, differences, target_database: targetDatabase };
}

// Read-only comparison DATA for the already-restored fresh target. Caller
// owns the original snapshot, Source/current native client and fences. A
// MATCH here neither admits effects nor repairs/advances a sequence.
export async function verifyRestoredCronJobs(client, archivedJobs, { sourceDatabase = null } = {}) {
  const unavailable = () => { throw new Error("Restored pg_cron verification is unavailable or changed."); };
  if (!client || types.isProxy(client) || typeof client.query !== "function") unavailable();
  const originalQuery = client.query;
  const own = (value, key) => {
    if (!value || typeof value !== "object" || types.isProxy(value)) unavailable();
    const field = Object.getOwnPropertyDescriptor(value,key);
    if (!field || !Object.hasOwn(field,"value")) unavailable();
    return field.value;
  };
  const rows = result => {
    const values = own(result,"rows");
    if (types.isProxy(values) || !Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype
        || Reflect.ownKeys(values).length !== values.length + 1 || own(result,"command") !== "SELECT"
        || own(result,"rowCount") !== values.length) unavailable();
    for (let index=0;index<values.length;index++) own(values,String(index));
    return values;
  };
  const record = (result,keys) => {
    const values=rows(result);if(values.length!==1) unavailable();
    const value=values[0];
    if (!value || types.isProxy(value) || Object.getPrototypeOf(value)!==Object.prototype
        || !isDeepStrictEqual(Reflect.ownKeys(value).sort(),keys.slice().sort())) unavailable();
    return Object.fromEntries(keys.map(key=>[key,own(value,key)]));
  };
  // This closed local port forwards only this function's fixed read calls to
  // the SAME original method. It is not a synthetic native Client or receipt.
  const reads = Object.freeze({query:async(sql,params=[])=>{
    if (client.query!==originalQuery) unavailable();
    const result=await Reflect.apply(originalQuery,client,[sql,params]);
    if (client.query!==originalQuery) unavailable();
    rows(result);return result;
  }});
  const targetName = async () => {
    const value=record(await reads.query("select current_database() database_name"),["database_name"]).database_name;
    if (typeof value!=="string" || !value.length || value.includes("\0") || Buffer.byteLength(value,"utf8")>63
        || Buffer.from(value,"utf8").toString("utf8")!==value) unavailable();
    return value;
  };
  const targetDatabase=await targetName();
  const expected=normalizedCronJobs(archivedJobs,{sourceDatabase,targetDatabase});
  const originalSequence=await resolveCronJobDefaultSequence(reads);
  const requireOriginalSequence=async()=>{
    if(!isDeepStrictEqual(await resolveCronJobDefaultSequence(reads),originalSequence)) unavailable();
  };
  const quote=value=>'"'+value.replaceAll('"','""')+'"';
  const counter=async()=>{
    const value=record(await reads.query(`select last_value::text last_value,is_called from ${quote(originalSequence.schema_name)}.${quote(originalSequence.sequence_name)}`),
      ["last_value","is_called"]);
    if(typeof value.last_value!=="string" || !/^[1-9][0-9]{0,18}(?![\s\S])/.test(value.last_value)
        || BigInt(value.last_value)>9223372036854775807n || typeof value.is_called!=="boolean") unavailable();
    return value;
  };
  const before=await readCronJobs(reads);await requireOriginalSequence();
  const beforeCounter=await counter();await requireOriginalSequence();
  const actual=await readCronJobs(reads);await requireOriginalSequence();
  if(await targetName()!==targetDatabase) unavailable();await requireOriginalSequence();
  const actualCounter=await counter();await requireOriginalSequence();
  if(!isDeepStrictEqual(before,actual) || !isDeepStrictEqual(beforeCounter,actualCounter)) unavailable();
  const differences=compareCronJobs(expected,actual);
  const expectedCounter={last_value:expected.reduce((maximum,job)=>BigInt(job.jobid)>maximum?BigInt(job.jobid):maximum,1n).toString(),
    is_called:expected.length>0};
  if(!isDeepStrictEqual(expectedCounter,actualCounter)) differences.push({category:"cron_state",field:"jobid_sequence",
    expected:expectedCounter,actual:actualCounter});
  return {before,expected,actual,differences,target_database:targetDatabase};
}
