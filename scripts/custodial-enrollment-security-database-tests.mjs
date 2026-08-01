#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.CUSTODIAL_ENROLLMENT_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.CUSTODIAL_ENROLLMENT_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("A disposable schema-rebuild database is required.");
}
const psqlArgs = ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database];
async function sql(statement) {
  const { stdout } = await execFileAsync("docker", [...psqlArgs, "-c", statement], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}
async function json(statement) {
  const output = await sql(`select (${statement})::text;`);
  return JSON.parse(output.split("\n").at(-1));
}
function concurrentSql(statement) {
  return new Promise((resolve) => {
    const child = spawn("docker", [...psqlArgs, "-c", statement], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

const employeeId = "30000000-0000-4000-8000-000000000001";
const employeeTwoId = "30000000-0000-4000-8000-000000000002";
const deviceId = "30000000-0000-4000-8000-000000000003";
await sql(`
  delete from public.operational_notification_jobs where job_key like 'security-revoked-%';
  delete from public.device_auth_enrollment_operations where device_id='${deviceId}'::uuid;
  delete from public.devices where id='${deviceId}'::uuid;
  delete from public.employees where id in ('${employeeId}'::uuid,'${employeeTwoId}'::uuid);
  insert into public.employees(id,employee_code,display_name,active,role)
  values
    ('${employeeId}'::uuid,'EMPSEC01','Enrollment Security Employee',true,'staff'),
    ('${employeeTwoId}'::uuid,'EMPSEC02','Enrollment Security Replacement',true,'staff');
  insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch)
  values ('${deviceId}'::uuid,'ENROLLMENT-SECURITY-DEVICE','Enrollment Security Device',true,'${employeeId}'::uuid,1);
`);

function consumeSql({
  operationId,
  flow = "enrollment",
  codeHash,
  requestFingerprint,
  credentialId,
  tokenHash,
  cipherCharacter,
}) {
  return `select public.device_auth_consume_enrollment_operation(
    '${operationId}'::uuid,'${flow}','${deviceId}'::uuid,
    '${codeHash}','${requestFingerprint}','${credentialId}'::uuid,'${tokenHash}',
    'Database Security Phone',now()+interval '10 years',repeat('${cipherCharacter}',96),
    repeat('i',24),repeat('t',24),now()+interval '30 minutes','aes-256-gcm.v1',
    repeat('u',64),null,'{"database_acceptance":true}'::jsonb
  )::text;`;
}

const operationId = "30000000-0000-4000-8000-000000000010";
const codeHash = "a".repeat(64);
const requestFingerprint = "b".repeat(64);
const credentialA = "30000000-0000-4000-8000-000000000011";
const credentialB = "30000000-0000-4000-8000-000000000012";
const tokenA = "c".repeat(64);
const tokenB = "d".repeat(64);
await sql(`insert into public.device_auth_enrollment_codes(device_id,code_hash,created_by,expires_at,metadata_json)
  values ('${deviceId}'::uuid,'${codeHash}','database security test',now()+interval '30 minutes','{}'::jsonb);`);

const duplicateCalls = await Promise.all([
  concurrentSql(consumeSql({ operationId, codeHash, requestFingerprint, credentialId: credentialA, tokenHash: tokenA, cipherCharacter: "x" })),
  concurrentSql(consumeSql({ operationId, codeHash, requestFingerprint, credentialId: credentialB, tokenHash: tokenB, cipherCharacter: "y" })),
]);
assert.ok(duplicateCalls.every((result) => result.status === 0), duplicateCalls.map((result) => result.stderr).join("\n"));
const duplicateResults = duplicateCalls.map((result) => JSON.parse(result.stdout.split("\n").filter(Boolean).at(-1)));
assert.equal(new Set(duplicateResults.map((result) => result.credential_id)).size, 1, "concurrent duplicate operations must return one credential");
const winningCredential = duplicateResults[0].credential_id;
const winningTokenHash = await sql(`select token_hash from public.device_auth_credentials where credential_id='${winningCredential}'::uuid;`);
assert.equal(await sql(`select count(*) from public.device_auth_enrollment_operations where operation_id='${operationId}'::uuid;`), "1");
assert.equal(await sql(`select count(*) from public.device_auth_credentials where device_id='${deviceId}'::uuid and revoked_at is null;`), "1");
assert.equal(await sql(`select count(*) from public.device_auth_enrollment_codes where device_id='${deviceId}'::uuid and consumed_at is not null;`), "1");

// A response-loss/local-write retry can send a fresh candidate, but the same
// operation must replay the original encrypted result and credential.
const replayCredential = "30000000-0000-4000-8000-000000000013";
const replay = JSON.parse(await sql(consumeSql({
  operationId,
  codeHash,
  requestFingerprint,
  credentialId: replayCredential,
  tokenHash: "e".repeat(64),
  cipherCharacter: "z",
})));
assert.equal(replay.ok, true);
assert.equal(replay.replayed, true);
assert.equal(replay.credential_id, winningCredential);
assert.equal(await sql(`select count(*) from public.device_auth_credentials where credential_id='${replayCredential}'::uuid;`), "0");
assert.equal(
  await sql(`select (confirmed_at is null)::text||'|'||(metadata_json->>'enrollment_operation_id') from public.device_auth_credentials where credential_id='${winningCredential}'::uuid;`),
  `true|${operationId}`,
  "an operation credential must remain explicitly unconfirmed after the resumable server commit",
);
const pushBeforeConfirm = await concurrentSql(`select public.mz_register_employee_push(
  '${winningCredential}'::uuid,'fcm-unconfirmed-${"x".repeat(40)}','${"9".repeat(64)}',
  'android','build-11-test','11'
);`);
assert.notEqual(pushBeforeConfirm.status, 0, "an unconfirmed operation credential must not register for push delivery");
assert.match(pushBeforeConfirm.stderr, /Credential is not assigned to an active employee device/i);

const conflict = await json(`public.device_auth_consume_enrollment_operation(
  '${operationId}'::uuid,'enrollment','${deviceId}'::uuid,
  '${codeHash}','${"f".repeat(64)}','${replayCredential}'::uuid,'${"e".repeat(64)}',
  'Conflict',now()+interval '10 years',repeat('z',96),repeat('i',24),repeat('t',24),
  now()+interval '30 minutes','aes-256-gcm.v1',null,null,'{}'::jsonb
)`);
assert.equal(conflict.ok, false);
assert.equal(conflict.reason, "operation_conflict");

const confirmed = await json(`public.device_auth_confirm_enrollment_operation(
  '${operationId}'::uuid,'${deviceId}'::uuid,'${winningCredential}'::uuid,'${winningTokenHash}'
)`);
assert.equal(confirmed.ok, true);
assert.equal(confirmed.status, "confirmed");
assert.equal(await sql(`select status||'|'||(result_ciphertext is null)::text from public.device_auth_enrollment_operations where operation_id='${operationId}'::uuid;`), "confirmed|true");
assert.match(
  await sql(`select (public.mz_register_employee_push(
    '${winningCredential}'::uuid,'fcm-confirmed-${"x".repeat(40)}','${"8".repeat(64)}',
    'android','build-11-test','11'
  )).registration_id::text;`),
  /^[0-9a-f-]{36}$/i,
  "explicit confirmation must activate push registration for the same credential",
);
const confirmReplay = await json(`public.device_auth_confirm_enrollment_operation(
  '${operationId}'::uuid,'${deviceId}'::uuid,'${winningCredential}'::uuid,'${winningTokenHash}'
)`);
assert.equal(confirmReplay.ok, true);
assert.equal(confirmReplay.replayed, true);

// A deliberately abandoned, unconfirmed recovery revokes only its own
// credential and destroys the resumable ciphertext.
const recoveryOperation = "30000000-0000-4000-8000-000000000020";
const recoveryCredential = "30000000-0000-4000-8000-000000000021";
const recoveryToken = "1".repeat(64);
const recoveryCodeHash = "2".repeat(64);
await sql(`insert into public.device_auth_enrollment_codes(device_id,code_hash,created_by,expires_at,metadata_json)
  values ('${deviceId}'::uuid,'${recoveryCodeHash}','database recovery test',now()+interval '30 minutes','{}'::jsonb);`);
const recovery = JSON.parse(await sql(consumeSql({
  operationId: recoveryOperation,
  flow: "recovery",
  codeHash: recoveryCodeHash,
  requestFingerprint: "3".repeat(64),
  credentialId: recoveryCredential,
  tokenHash: recoveryToken,
  cipherCharacter: "r",
})));
assert.equal(recovery.ok, true);
const cancelled = await json(`public.device_auth_cancel_enrollment_operation(
  '${recoveryOperation}'::uuid,'${deviceId}'::uuid,'${recoveryCredential}'::uuid,'${recoveryToken}'
)`);
assert.equal(cancelled.ok, true);
assert.equal(await sql(`select status||'|'||(result_ciphertext is null)::text from public.device_auth_enrollment_operations where operation_id='${recoveryOperation}'::uuid;`), "cancelled|true");
assert.equal(await sql(`select revoked_reason from public.device_auth_credentials where credential_id='${recoveryCredential}'::uuid;`), "enrollment_operation_cancelled");

const expiryOperation = "30000000-0000-4000-8000-000000000030";
const expiryCredential = "30000000-0000-4000-8000-000000000031";
const expiryToken = "4".repeat(64);
const expiryCodeHash = "5".repeat(64);
await sql(`insert into public.device_auth_enrollment_codes(device_id,code_hash,created_by,expires_at,metadata_json)
  values ('${deviceId}'::uuid,'${expiryCodeHash}','database expiry test',now()+interval '30 minutes','{}'::jsonb);`);
assert.equal(JSON.parse(await sql(consumeSql({
  operationId: expiryOperation,
  codeHash: expiryCodeHash,
  requestFingerprint: "6".repeat(64),
  credentialId: expiryCredential,
  tokenHash: expiryToken,
  cipherCharacter: "q",
}))).ok, true);
await sql(`update public.device_auth_enrollment_operations set resume_expires_at=now()-interval '1 second' where operation_id='${expiryOperation}'::uuid;`);
const expired = await json("public.device_auth_expire_custodial_enrollment_operations(now(),100)");
assert.ok(Number(expired.expired) >= 1);
assert.equal(await sql(`select status||'|'||(result_ciphertext is null)::text from public.device_auth_enrollment_operations where operation_id='${expiryOperation}'::uuid;`), "expired|true");
assert.equal(await sql(`select revoked_reason from public.device_auth_credentials where credential_id='${expiryCredential}'::uuid;`), "enrollment_operation_unconfirmed_timeout");

async function createPushFixture({ suffix, jobKey }) {
  const credentialId = `30000000-0000-4000-8000-0000000000${suffix}`;
  const registrationId = `31000000-0000-4000-8000-0000000000${suffix}`;
  const sourceId = `32000000-0000-4000-8000-0000000000${suffix}`;
  await sql(`
    insert into public.device_auth_credentials(
      credential_id,device_id,token_hash,device_label,metadata_json,created_at,confirmed_at,last_used_at,expires_at
    ) values (
      '${credentialId}'::uuid,'${deviceId}'::uuid,'${suffix.padStart(64, "7")}',
      'Push Security ${suffix}','{}'::jsonb,now(),now(),now(),now()+interval '1 day'
    );
    insert into public.employee_push_registrations(
      registration_id,device_id,credential_id,employee_id,assignment_epoch,platform,fcm_token,token_hash,active
    ) values (
      '${registrationId}'::uuid,'${deviceId}'::uuid,'${credentialId}'::uuid,'${employeeId}'::uuid,1,
      'android','fcm-security-${suffix}-${"x".repeat(40)}','${suffix.padStart(64, "8")}',true
    );
    insert into public.operational_notification_jobs(job_key,job_type,source_id,payload_json)
    values (
      '${jobKey}','employee_native_push','${sourceId}'::uuid,
      jsonb_build_object('credential_id','${credentialId}','employee_id','${employeeId}',
        'device_id','${deviceId}','assignment_epoch',1)
    );
  `);
  return { credentialId, registrationId, sourceId };
}

const beforeClaim = await createPushFixture({ suffix: "41", jobKey: "security-revoked-before-claim" });
await sql(`update public.device_auth_credentials set revoked_at=now(),revoked_reason='database_test_revoke' where credential_id='${beforeClaim.credentialId}'::uuid;`);
assert.equal(await sql(`select active::text||'|'||revoked_reason from public.employee_push_registrations where registration_id='${beforeClaim.registrationId}'::uuid;`), "false|device_credential_revoked");
assert.equal(await sql("select status from public.operational_notification_jobs where job_key='security-revoked-before-claim';"), "dead");
assert.equal(await sql("select coalesce((public.claim_operational_notification_job_by_key('security-revoked-before-claim','must-not-claim',90)).job_id::text,'');"), "");

const afterClaim = await createPushFixture({ suffix: "42", jobKey: "security-revoked-after-claim" });
const afterClaimLease = await json("row_to_json(public.claim_operational_notification_job_by_key('security-revoked-after-claim','after-claim-worker',90))");
await sql(`update public.device_auth_credentials set revoked_at=now(),revoked_reason='database_test_revoke' where credential_id='${afterClaim.credentialId}'::uuid;`);
assert.equal(await sql("select status from public.operational_notification_jobs where job_key='security-revoked-after-claim';"), "leased");
const afterClaimAuthority = await json(`public.mz_resolve_employee_push_delivery('${afterClaim.credentialId}'::uuid,1,now())`);
assert.equal(afterClaimAuthority.ok, false);
assert.equal(afterClaimAuthority.terminal, true);
assert.equal(afterClaimAuthority.reason, "device_credential_revoked");
await sql(`select public.finish_operational_notification_job_terminal('${afterClaimLease.job_id}'::uuid,'${afterClaimLease.lease_token}'::uuid,'${afterClaimAuthority.reason}');`);
assert.equal(await sql("select status from public.operational_notification_jobs where job_key='security-revoked-after-claim';"), "dead");

const restart = await createPushFixture({ suffix: "43", jobKey: "security-revoked-after-restart" });
const staleLease = await json("row_to_json(public.claim_operational_notification_job_by_key('security-revoked-after-restart','restart-worker-a',15))");
await sql("update public.operational_notification_jobs set leased_until=now()-interval '1 second' where job_key='security-revoked-after-restart';");
const recoveredLease = await json("row_to_json(public.claim_operational_notification_job_by_key('security-revoked-after-restart','restart-worker-b',90))");
assert.notEqual(staleLease.lease_token, recoveredLease.lease_token);
assert.equal(Number(recoveredLease.attempts), 2);
await sql(`update public.device_auth_credentials set revoked_at=now(),revoked_reason='database_test_revoke' where credential_id='${restart.credentialId}'::uuid;`);
const restartAuthority = await json(`public.mz_resolve_employee_push_delivery('${restart.credentialId}'::uuid,1,now())`);
assert.equal(restartAuthority.ok, false);
const staleFinish = await concurrentSql(`select public.finish_operational_notification_job_terminal('${staleLease.job_id}'::uuid,'${staleLease.lease_token}'::uuid,'stale');`);
assert.notEqual(staleFinish.status, 0);
assert.match(staleFinish.stderr, /lease is no longer authoritative/i);
await sql(`select public.finish_operational_notification_job_terminal('${recoveredLease.job_id}'::uuid,'${recoveredLease.lease_token}'::uuid,'${restartAuthority.reason}');`);
assert.equal(await sql("select status||'|'||attempts::text from public.operational_notification_jobs where job_key='security-revoked-after-restart';"), "dead|2");

assert.equal(await sql(`select count(*) from information_schema.columns where table_schema='public' and table_name='device_auth_enrollment_operations' and column_name ilike '%device_credential%';`), "0");
assert.equal(await sql(`select count(*) from pg_policies where schemaname='public' and tablename='device_auth_enrollment_operations' and roles && array['anon'::name,'authenticated'::name];`), "0");
assert.equal(await sql(`select relrowsecurity::text||'|'||relforcerowsecurity::text from pg_class where oid='public.device_auth_enrollment_operations'::regclass;`), "true|true");

console.log("CUSTODIAL_ENROLLMENT_SECURITY_DATABASE_PASS");
