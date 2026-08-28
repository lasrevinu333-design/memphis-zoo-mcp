#!/usr/bin/env node

import assert from "node:assert/strict";
import { compareCronJobs, normalizedCronJobs } from "./disaster-recovery-cron.mjs";

const jobs = [{
  jobid: 7,
  schedule: "5 * * * *",
  command: "select public.expire_stale_open_sessions();",
  nodename: "localhost",
  nodeport: 5432,
  database: "postgres",
  username: "postgres",
  active: true,
  jobname: "mz-stale-sessions-hourly",
}];
assert.deepEqual(normalizedCronJobs(jobs), jobs);
assert.equal(normalizedCronJobs(jobs, { sourceDatabase: "postgres", targetDatabase: "mz_schema_rebuild_1" })[0].database, "mz_schema_rebuild_1");
assert.deepEqual(compareCronJobs(jobs, jobs), []);
assert.equal(compareCronJobs(jobs, [{ ...jobs[0], active: false }]).length, 1);
assert.throws(() => normalizedCronJobs([{ ...jobs[0], leaked: true }]), /supported pg_cron job catalog/);
assert.throws(() => normalizedCronJobs([...jobs, { ...jobs[0] }]), /duplicated/);
console.log("DISASTER_RECOVERY_CRON_TESTS_PASS");
