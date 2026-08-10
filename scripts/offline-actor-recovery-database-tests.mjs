#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.CUSTODIAL_ATOMIC_COMMIT_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.CUSTODIAL_ATOMIC_COMMIT_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("An owned disposable schema-rebuild database is required.");
}

const execSecret = "offline-authority-test-secret-01234567890123456789";
const employeeA = randomUUID(), employeeB = randomUUID();
const deviceA = randomUUID(), deviceB = randomUUID(), deviceC = randomUUID();
const locationA = randomUUID(), locationB = randomUUID(), locationC = randomUUID();
const credentialA = randomUUID(), credentialB = randomUUID(), credentialC = randomUUID();
const stamp = Date.now().toString(36);
const codeA = `OA${stamp}A`.toUpperCase(), codeB = `OA${stamp}B`.toUpperCase(), codeC = `OA${stamp}C`.toUpperCase();
const tokenHashA = createHash("sha256").update(`offline-authority-a:${stamp}`).digest("hex");
const tokenHashB = createHash("sha256").update(`offline-authority-b:${stamp}`).digest("hex");
const tokenHashC = createHash("sha256").update(`offline-authority-c:${stamp}`).digest("hex");
const startedAt = new Date(Date.now() - 8 * 60_000).toISOString();
const endedAt = new Date(Date.now() - 3 * 60_000).toISOString();

function q(value) { return `'${String(value ?? "").replaceAll("'", "''")}'`; }
async function sql(statement, { expectFailure = false } = {}) {
  try {
    const result = await execFileAsync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", statement], { maxBuffer: 16 * 1024 * 1024 });
    if (expectFailure) assert.fail(`Expected SQL failure: ${statement}`);
    assert.equal(result.stderr.trim(), "");
    return result.stdout.trim().split("\n").at(-1);
  } catch (error) {
    if (!expectFailure) throw error;
    return String(error.stderr || error.message);
  }
}
function jsonSql({ session, completion, context, proof, device, location, start = startedAt, end = endedAt, response = { issues: [{ label: "Authority test faucet", category: "plumbing" }], alpha: 1 }, scans = [], correlation = "correlation-a" }) {
  return `select public.tool_commit_cleaning_workflow_authoritative(
    ${q(session)},${q(completion)},${q(device)},${q(location)},${q(start)},${q(end)},
    ${q(JSON.stringify(response))}::jsonb,${q(JSON.stringify(scans))}::jsonb,${q(correlation)},
    ${q(context)},${q(proof)},${q(credentialA)},${q(execSecret)}
  )::text;`;
}
async function activate({ device, location, session, start = startedAt, credential = credentialA }) {
  return JSON.parse(await sql(`select public.tool_start_offline_occurrence(${q(device)},${q(location)},${q(session)},${q(start)},${q(credential)},${q(execSecret)})::text;`));
}

const setup = `
select public.custodial_configure_backend_execution_key(encode(extensions.digest(convert_to(${q(execSecret)},'UTF8'),'sha256'),'hex'),'offline-authority-db-test');
insert into public.employees(id,employee_code,display_name,active,role,notes) values
  ('${employeeA}'::uuid,'OA${stamp}A','Offline Authority Actor A',true,'staff','disposable authority test'),
  ('${employeeB}'::uuid,'OA${stamp}B','Offline Authority Actor B',true,'staff','disposable authority test');
insert into public.locations(id,location_code,location_name,location_type,active,form_type,notes) values
  ('${locationA}'::uuid,'${codeA}','Offline Authority Location A','restroom',true,'restroom','disposable authority test'),
  ('${locationB}'::uuid,'${codeB}','Offline Authority Location B','restroom',true,'restroom','disposable authority test'),
  ('${locationC}'::uuid,'${codeC}','Offline Authority Location C','restroom',true,'restroom','disposable authority test');
insert into public.devices(id,device_id,device_name,active,assigned_employee_id,notes) values
  ('${deviceA}'::uuid,'OA-${stamp}-A','Offline Authority Device A',true,'${employeeA}'::uuid,'disposable authority test'),
  ('${deviceB}'::uuid,'OA-${stamp}-B','Offline Authority Device B',true,'${employeeA}'::uuid,'disposable authority test'),
  ('${deviceC}'::uuid,'OA-${stamp}-C','Offline Authority Device C',true,'${employeeA}'::uuid,'disposable authority test');
insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at,metadata_json) values
  ('${credentialA}'::uuid,'${deviceA}'::uuid,'${tokenHashA}','authority A',now(),now()+interval '30 days','{}'::jsonb),
  ('${credentialB}'::uuid,'${deviceB}'::uuid,'${tokenHashB}','authority B',now(),now()+interval '30 days','{}'::jsonb),
  ('${credentialC}'::uuid,'${deviceC}'::uuid,'${tokenHashC}','authority C',now(),now()+interval '30 days','{}'::jsonb);
insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,new_employee_id,new_employee_name,change_reason,source) values
  ('${deviceA}'::uuid,'OA-${stamp}-A','${employeeA}'::uuid,'Offline Authority Actor A','fixture','test'),
  ('${deviceB}'::uuid,'OA-${stamp}-B','${employeeA}'::uuid,'Offline Authority Actor A','fixture','test'),
  ('${deviceC}'::uuid,'OA-${stamp}-C','${employeeA}'::uuid,'Offline Authority Actor A','fixture','test');`;

await sql(setup);
assert.equal(await sql(`select count(*) from public.custodial_offline_actor_contexts where client_session_id like 'oa-${stamp}%';`), "0", "state reads must create no proof/context");

const sessionA = `oa-${stamp}-accepted`;
const contextA = await activate({ device: `OA-${stamp}-A`, location: codeA, session: sessionA });
assert.equal(contextA.committable, true);
assert.match(contextA.occurrence_id, /^[0-9a-f-]{36}$/);
const startReplay = await activate({ device: `OA-${stamp}-A`, location: codeA, session: sessionA });
assert.equal(startReplay.proof_replay_requires_durable_local_copy, true, "start replay may not mint a second proof");
assert.equal(await sql(`select count(*) from public.custodial_offline_submission_proofs p join public.custodial_offline_actor_contexts c on c.context_id=p.context_id where c.client_session_id=${q(sessionA)};`), "1");

const genericDenied = await sql(`set role service_role; select public.tool_start_offline_occurrence('OA-${stamp}-A','${codeA}','oa-${stamp}-forged',${q(startedAt)},'${credentialA}','not-the-backend-secret');`, { expectFailure: true });
assert.match(genericDenied, /not authorized/i, "generic service_role cannot forge the backend execution proof");

// Reassignment after an activated occurrence retains A only for that exact proof.
await sql(`update public.devices set assigned_employee_id='${employeeB}'::uuid where id='${deviceA}'::uuid;`);
const scanId = `oa-${stamp}-scan-1`;
const acceptedSql = jsonSql({ session: sessionA, completion: `oa-${stamp}-complete-1`, context: contextA.context_id, proof: contextA.submission_proof, device: `OA-${stamp}-A`, location: codeA, scans: [{ event_type: "scan_finish", client_event_id: scanId, scanned_at: endedAt, result: "ok", payload_json: { z: 2, a: 1 } }] });
const accepted = JSON.parse(await sql(acceptedSql));
assert.equal(accepted.status, "closed");
assert.equal(await sql(`select employee_id::text from public.sessions where client_session_id=${q(sessionA)};`), employeeA);
const replays = await Promise.all(Array.from({ length: 8 }, () => sql(acceptedSql).then(JSON.parse)));
assert.equal(replays.filter((result) => result.replayed === true).length, 8, "concurrent exact retries converge");
const reorderedReplay = JSON.parse(await sql(jsonSql({ session: sessionA, completion: `oa-${stamp}-complete-1`, context: contextA.context_id, proof: contextA.submission_proof, device: `OA-${stamp}-A`, location: codeA, response: { alpha: 1, issues: [{ category: "plumbing", label: "Authority test faucet" }] }, scans: [{ payload_json: { a: 1, z: 2 }, result: "ok", scanned_at: endedAt, client_event_id: scanId, event_type: "scan_finish" }] })));
assert.equal(reorderedReplay.replayed, true, "JSON object order is canonical replay");
const correlationMismatch = JSON.parse(await sql(jsonSql({ session: sessionA, completion: `oa-${stamp}-complete-1`, context: contextA.context_id, proof: contextA.submission_proof, device: `OA-${stamp}-A`, location: codeA, correlation: "correlation-b" })));
assert.equal(correlationMismatch.reason, "payload_fingerprint_conflict");

// A second device/actor proof at the same interval is durably quarantined by
// exclusion constraints, including after the first interval is closed.
const overlap = await activate({ device: `OA-${stamp}-B`, location: codeB, session: `oa-${stamp}-overlap`, credential: credentialB });
const overlapResult = JSON.parse(await sql(`select public.tool_commit_cleaning_workflow_authoritative(${q(`oa-${stamp}-overlap`)},${q(`oa-${stamp}-overlap-complete`)},${q(`OA-${stamp}-B`)},${q(codeB)},${q(startedAt)},${q(endedAt)},'{}'::jsonb,'[]'::jsonb,'overlap',${q(overlap.context_id)},${q(overlap.submission_proof)},${q(credentialB)},${q(execSecret)})::text;`));
assert.equal(overlapResult.reason, "overlapping_employee_or_device_occurrence");

// Malformed evidence reaches the durable quarantine boundary before any
// completion/ticket/outbox effect, rather than aborting and leaving retryable work.
const malformed = await activate({ device: `OA-${stamp}-C`, location: codeC, session: `oa-${stamp}-malformed`, start: new Date(Date.now() - 2 * 60_000).toISOString(), credential: credentialC });
const malformedStart = malformed.started_at;
const malformedResult = JSON.parse(await sql(`select public.tool_commit_cleaning_workflow_authoritative(${q(`oa-${stamp}-malformed`)},${q(`oa-${stamp}-malformed-complete`)},${q(`OA-${stamp}-C`)},${q(codeC)},${q(malformedStart)},${q(new Date().toISOString())},'{}'::jsonb,${q(JSON.stringify([{ event_type: "scan_finish", client_event_id: `oa-${stamp}-bad`, scanned_at: "not-a-time" }]))}::jsonb,'malformed',${q(malformed.context_id)},${q(malformed.submission_proof)},${q(credentialC)},${q(execSecret)})::text;`));
assert.equal(malformedResult.reason, "malformed_scan_evidence");
assert.equal(await sql(`select count(*) from public.completion_responses where client_completion_id=${q(`oa-${stamp}-malformed-complete`)};`), "0");
assert.equal(await sql(`select to_regclass('public.custodial_offline_reconciliation_outbox') is null;`), "t", "quarantine has no operational outbox");

for (const table of ["custodial_offline_actor_contexts", "custodial_offline_submission_proofs", "custodial_offline_reconciliation_records", "custodial_offline_reconciliation_audits", "custodial_offline_scan_event_evidence"]) {
  const denial = await sql(`set role service_role; delete from public.${table};`, { expectFailure: true });
  assert.match(denial, /permission denied|append-only|immutable/i, `${table} rejects direct service-role deletion`);
}
const legacyDenied = await sql(`select public.tool_complete_session('missing','{}'::jsonb,null,'OA-${stamp}-A','oa-${stamp}-legacy');`, { expectFailure: true });
assert.match(legacyDenied, /Use tool_complete_session_authoritative/i);
const messengerDenied = await sql(`select public.msg_delete_thread_permanently(gen_random_uuid());`, { expectFailure: true });
assert.match(messengerDenied, /retired/i);

console.log("OFFLINE_ACTOR_RECOVERY_DATABASE_PASS");
