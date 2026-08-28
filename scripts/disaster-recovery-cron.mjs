import { stableJson } from "./disaster-recovery-crypto.mjs";

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

function exactJob(job, label) {
  if (!job || typeof job !== "object" || Array.isArray(job)) throw new Error(`${label} must be an object.`);
  const keys = Object.keys(job).sort();
  const expected = [...CRON_JOB_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} does not match the supported pg_cron job catalog.`);
  }
  if (!Number.isSafeInteger(Number(job.jobid)) || Number(job.jobid) < 1
      || !String(job.schedule || "").trim() || !String(job.command || "").trim()
      || !String(job.nodename || "").trim() || !Number.isSafeInteger(Number(job.nodeport))
      || !String(job.database || "").trim() || !String(job.username || "").trim()
      || typeof job.active !== "boolean" || (job.jobname != null && !String(job.jobname).trim())) {
    throw new Error(`${label} contains invalid pg_cron job state.`);
  }
  return {
    jobid: Number(job.jobid),
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
  }).sort((left, right) => left.jobid - right.jobid);
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
  const result = await client.query("select row_to_json(j) row from cron.job j order by j.jobid");
  return normalizedCronJobs(result.rows.map((item) => item.row));
}

export async function restoreCronJobs(client, archivedJobs, { sourceDatabase = null } = {}) {
  const target = await client.query("select current_database() database_name");
  const targetDatabase = String(target.rows[0]?.database_name || "");
  if (!targetDatabase) throw new Error("Restore target database identity is unavailable for pg_cron reconciliation.");
  const expected = normalizedCronJobs(archivedJobs, { sourceDatabase, targetDatabase });
  const before = await readCronJobs(client);
  await client.query("truncate cron.job restart identity");
  for (const job of expected) {
    await client.query(`
      insert into cron.job(jobid,schedule,command,nodename,nodeport,database,username,active,jobname)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, CRON_JOB_FIELDS.map((field) => job[field]));
  }
  const sequence = await client.query("select pg_get_serial_sequence('cron.job','jobid') sequence_name");
  if (sequence.rows[0]?.sequence_name) {
    await client.query("select setval($1::regclass,$2,$3)", [
      sequence.rows[0].sequence_name,
      expected.length ? Math.max(...expected.map((job) => job.jobid)) : 1,
      expected.length > 0,
    ]);
  }
  const actual = await readCronJobs(client);
  const differences = compareCronJobs(expected, actual);
  return { before, expected, actual, differences, target_database: targetDatabase };
}
