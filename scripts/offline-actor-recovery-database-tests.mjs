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
function jsonSql({ session, completion, context, proof, device, location, credential = credentialA, start = startedAt, end = endedAt, response = { issues: [{ label: "Authority test faucet", category: "plumbing" }], alpha: 1 }, scans = [], correlation = "correlation-a" }) {
  return `select public.tool_commit_cleaning_workflow_authoritative(
    ${q(session)},${q(completion)},${q(device)},${q(location)},${q(start)},${q(end)},
    ${q(JSON.stringify(response))}::jsonb,${q(JSON.stringify(scans))}::jsonb,${q(correlation)},
    ${q(context)},${q(proof)},${q(credential)},${q(execSecret)}
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
assert.equal(await sql(`select count(*) from public.custodial_offline_reconciliation_outbox o join public.custodial_offline_reconciliation_records r on r.reconciliation_id=o.reconciliation_id where r.client_completion_id=${q(`oa-${stamp}-malformed-complete`)} and o.notification_kind='offline_reconciliation_quarantine';`), "1", "each new quarantine has one deduplicated manager outbox record");

for (const table of ["custodial_offline_actor_contexts", "custodial_offline_submission_proofs", "custodial_offline_reconciliation_records", "custodial_offline_reconciliation_audits", "custodial_offline_scan_event_evidence"]) {
  const denial = await sql(`set role service_role; delete from public.${table};`, { expectFailure: true });
  assert.match(denial, /permission denied|append-only|immutable/i, `${table} rejects direct service-role deletion`);
}
for (const table of ["sessions", "completion_responses", "scan_events", "maintenance_tickets"]) {
  for (const statement of [
    `insert into public.${table} default values;`,
    `update public.${table} set id=id where false;`,
    `delete from public.${table} where false;`,
    `truncate table public.${table};`,
  ]) {
    const denial = await sql(`set role service_role; ${statement}`, { expectFailure: true });
    assert.match(denial, /permission denied/i, `${table} rejects direct service-role DML and TRUNCATE`);
  }
}
assert.notEqual(await sql(`set role service_role; select count(*) from public.sessions;`), "", "service role retains operational reads");
const truncateGuard = await sql(`truncate table public.custodial_offline_reconciliation_outbox;`, { expectFailure: true });
assert.match(truncateGuard, /explicit maintenance procedure/i, "append-only evidence has a statement-level TRUNCATE guard");

// Concurrent activation has one canonical context and every exact caller gets
// a normal replay instead of a unique-constraint error.
const activationSession = `oa-${stamp}-concurrent-activation`;
const activationStartedAt = new Date(Date.now() - 90_000).toISOString();
const activationResults = await Promise.all(Array.from({ length: 8 }, () => activate({
  device: `OA-${stamp}-C`, location: codeC, session: activationSession, start: activationStartedAt, credential: credentialC,
})));
assert.equal(new Set(activationResults.map((result) => result.context_id)).size, 1, "concurrent exact activation converges on one context");
assert.equal(await sql(`select count(*) from public.custodial_offline_actor_contexts where client_session_id=${q(activationSession)};`), "1");

// A same completion key on a second occurrence must fence that occurrence and
// its proof; a new key cannot subsequently close it.
const fenceStart = new Date(Date.now() - 2 * 60_000).toISOString();
const fenceEnd = new Date(Date.now() - 70_000).toISOString();
const fenceA = await activate({ device: `OA-${stamp}-B`, location: codeB, session: `oa-${stamp}-fence-a`, start: fenceStart, credential: credentialB });
const fenceKey = `oa-${stamp}-shared-fence-key`;
assert.equal(JSON.parse(await sql(jsonSql({ session: `oa-${stamp}-fence-a`, completion: fenceKey, context: fenceA.context_id, proof: fenceA.submission_proof, device: `OA-${stamp}-B`, location: codeB, credential: credentialB, start: fenceStart, end: fenceEnd }))).status, "closed");
const fenceB = await activate({ device: `OA-${stamp}-C`, location: codeC, session: `oa-${stamp}-fence-b`, start: fenceStart, credential: credentialC });
const fenced = JSON.parse(await sql(jsonSql({ session: `oa-${stamp}-fence-b`, completion: fenceKey, context: fenceB.context_id, proof: fenceB.submission_proof, device: `OA-${stamp}-C`, location: codeC, credential: credentialC, start: fenceStart, end: fenceEnd })));
assert.equal(fenced.status, "quarantined");
assert.equal(await sql(`select status from public.custodial_offline_actor_contexts where context_id=${q(fenceB.context_id)}::uuid;`), "quarantined");
assert.equal(await sql(`select state from public.custodial_offline_submission_proofs where context_id=${q(fenceB.context_id)}::uuid;`), "quarantined");
const fencedRetry = JSON.parse(await sql(jsonSql({ session: `oa-${stamp}-fence-b`, completion: `oa-${stamp}-fence-b-new-key`, context: fenceB.context_id, proof: fenceB.submission_proof, device: `OA-${stamp}-C`, location: codeC, credential: credentialC, start: fenceStart, end: fenceEnd })));
assert.equal(fencedRetry.status, "quarantined");
assert.equal(await sql(`select count(*) from public.completion_responses where client_completion_id=${q(`oa-${stamp}-fence-b-new-key`)};`), "0", "fenced proof never mints a second completion");

const duplicate = await activate({ device: `OA-${stamp}-C`, location: codeC, session: `oa-${stamp}-duplicate-events`, start: fenceStart, credential: credentialC });
const duplicateResult = JSON.parse(await sql(jsonSql({
  session: `oa-${stamp}-duplicate-events`, completion: `oa-${stamp}-duplicate-events-complete`, context: duplicate.context_id, proof: duplicate.submission_proof,
  device: `OA-${stamp}-C`, location: codeC, credential: credentialC, start: fenceStart, end: fenceEnd,
  scans: [
    { event_type: "scan_finish", client_event_id: `oa-${stamp}-duplicate-id`, scanned_at: fenceEnd, result: "first" },
    { event_type: "scan_finish", client_event_id: `oa-${stamp}-duplicate-id`, scanned_at: fenceEnd, result: "second" },
  ],
})));
assert.equal(duplicateResult.reason, "malformed_scan_evidence", "duplicate identities inside one payload quarantine instead of splitting evidence");

const infinity = await activate({ device: `OA-${stamp}-C`, location: codeC, session: `oa-${stamp}-infinity`, start: fenceStart, credential: credentialC });
const infinityResult = JSON.parse(await sql(jsonSql({
  session: `oa-${stamp}-infinity`, completion: `oa-${stamp}-infinity-complete`, context: infinity.context_id, proof: infinity.submission_proof,
  device: `OA-${stamp}-C`, location: codeC, credential: credentialC, start: fenceStart, end: fenceEnd,
  scans: [{ event_type: "scan_finish", client_event_id: `oa-${stamp}-infinity-id`, scanned_at: "infinity" }],
})));
assert.equal(infinityResult.reason, "malformed_scan_evidence", "PostgreSQL infinity is not canonical scan evidence");

const oversized = await activate({ device: `OA-${stamp}-C`, location: codeC, session: `oa-${stamp}-oversized`, start: fenceStart, credential: credentialC });
const oversizedResult = JSON.parse(await sql(jsonSql({
  session: `oa-${stamp}-oversized`, completion: `oa-${stamp}-oversized-complete`, context: oversized.context_id, proof: oversized.submission_proof,
  device: `OA-${stamp}-C`, location: codeC, credential: credentialC, start: fenceStart, end: fenceEnd,
  scans: Array.from({ length: 101 }, (_, index) => ({ event_type: "scan_finish", client_event_id: `oa-${stamp}-oversized-${index}`, scanned_at: fenceEnd })),
})));
assert.equal(oversizedResult.reason, "invalid_payload_shape_or_bounds", "oversized payloads become durable quarantines");

// A shared scan identity is serialised by a canonical event lock. The loser is
// quarantined with its own manager outbox record rather than rolling back naked.
await sql(`update public.devices set assigned_employee_id='${employeeB}'::uuid where id='${deviceB}'::uuid;
  insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,new_employee_id,new_employee_name,change_reason,source)
  values('${deviceB}'::uuid,'OA-${stamp}-B','${employeeB}'::uuid,'Offline Authority Actor B','race fixture','test');`);
const raceStart = new Date(Date.now() - 55_000).toISOString();
const raceEnd = new Date(Date.now() - 25_000).toISOString();
const raceA = await activate({ device: `OA-${stamp}-B`, location: codeB, session: `oa-${stamp}-race-a`, start: raceStart, credential: credentialB });
const raceB = await activate({ device: `OA-${stamp}-C`, location: codeC, session: `oa-${stamp}-race-b`, start: raceStart, credential: credentialC });
const sharedEvent = `oa-${stamp}-shared-event`;
const [raceResultA, raceResultB] = await Promise.all([
  sql(jsonSql({ session: `oa-${stamp}-race-a`, completion: `oa-${stamp}-race-a-complete`, context: raceA.context_id, proof: raceA.submission_proof, device: `OA-${stamp}-B`, location: codeB, credential: credentialB, start: raceStart, end: raceEnd, scans: [{ event_type: "scan_finish", client_event_id: sharedEvent, scanned_at: raceEnd, result: "A" }] })).then(JSON.parse),
  sql(jsonSql({ session: `oa-${stamp}-race-b`, completion: `oa-${stamp}-race-b-complete`, context: raceB.context_id, proof: raceB.submission_proof, device: `OA-${stamp}-C`, location: codeC, credential: credentialC, start: raceStart, end: raceEnd, scans: [{ event_type: "scan_finish", client_event_id: sharedEvent, scanned_at: raceEnd, result: "B" }] })).then(JSON.parse),
]);
assert.equal([raceResultA, raceResultB].filter((result) => result.status === "closed").length, 1);
const raceLoser = raceResultA.status === "quarantined" ? `oa-${stamp}-race-a-complete` : `oa-${stamp}-race-b-complete`;
assert.equal(await sql(`select count(*) from public.custodial_offline_reconciliation_outbox o join public.custodial_offline_reconciliation_records r on r.reconciliation_id=o.reconciliation_id where r.client_completion_id=${q(raceLoser)};`), "1", "cross-submission event race leaves a durable manager follow-up record");

const reconciliationId = await sql(`select reconciliation_id::text from public.custodial_offline_reconciliation_records where client_completion_id=${q(`oa-${stamp}-malformed-complete`)};`);
const managerId = "00000000-0000-4000-8000-000000000001";
const dispositionRequestId = randomUUID();
const dispositionSql = `select public.custodial_manager_dispose_offline_reconciliation('${managerId}'::uuid,${q(reconciliationId)}::uuid,'reviewed','validated exactly-once recovery disposition','${dispositionRequestId}'::uuid,${q(execSecret)})::text;`;
const dispositionResults = await Promise.all([sql(dispositionSql).then(JSON.parse), sql(dispositionSql).then(JSON.parse)]);
assert.equal(new Set(dispositionResults.map((result) => result.disposition_id)).size, 1, "concurrent exact dispositions converge on one canonical outcome");
assert.equal(dispositionResults.filter((result) => result.replayed).length, 1);
const dispositionConflict = await sql(`select public.custodial_manager_dispose_offline_reconciliation('${managerId}'::uuid,${q(reconciliationId)}::uuid,'reviewed','different request payload','${dispositionRequestId}'::uuid,${q(execSecret)});`, { expectFailure: true });
assert.match(dispositionConflict, /already bound to a different recovery outcome/i);
await sql(`select public.custodial_truncate_offline_evidence_for_maintenance('public.custodial_offline_reconciliation_outbox'::regclass,'disposable rebuild restoration verification');`);
assert.equal(await sql(`select count(*) from public.custodial_offline_reconciliation_outbox;`), "0", "the explicit maintenance procedure is the only tested TRUNCATE path");
const legacyDenied = await sql(`select public.tool_complete_session('missing','{}'::jsonb,null,'OA-${stamp}-A','oa-${stamp}-legacy');`, { expectFailure: true });
assert.match(legacyDenied, /Use tool_complete_session_authoritative/i);
const messengerDenied = await sql(`select public.msg_delete_thread_permanently(gen_random_uuid());`, { expectFailure: true });
assert.match(messengerDenied, /retired/i);

console.log("OFFLINE_ACTOR_RECOVERY_DATABASE_PASS");
