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
const nativeRouteSecret = "offline-native-route-test-secret-0123456789012345";
const nativeStartSignature = "a".repeat(64);
const nativeCompletionSignature = "b".repeat(64);
const employeeA = randomUUID(), employeeB = randomUUID();
const deviceA = randomUUID(), deviceB = randomUUID(), deviceC = randomUUID();
const locationA = randomUUID(), locationB = randomUUID(), locationC = randomUUID();
const credentialA = randomUUID(), credentialB = randomUUID(), credentialC = randomUUID();
const stamp = Date.now().toString(36);
const codeA = `OA${stamp}A`.toUpperCase(), codeB = `OA${stamp}B`.toUpperCase(), codeC = `OA${stamp}C`.toUpperCase();
const tokenHashA = createHash("sha256").update(`offline-authority-a:${stamp}`).digest("hex");
const tokenHashB = createHash("sha256").update(`offline-authority-b:${stamp}`).digest("hex");
const tokenHashC = createHash("sha256").update(`offline-authority-c:${stamp}`).digest("hex");
let startedAt;
let endedAt;
const entryEvidence = { entry_source: "native-nfc" };

function q(value) { return `'${String(value ?? "").replaceAll("'", "''")}'`; }
function completionUuid(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw)) return raw;
  const hex = createHash("sha256").update(`offline-completion:${raw}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function assertCanonicalUtcMillis(value, label) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `${label} must be canonical UTC milliseconds`);
  assert.equal(value, new Date(value).toISOString(), `${label} bytes must equal native canonical UTC text`);
}
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
  const canonicalScans = scans.map((event) => ({
    client_event_id: event.client_event_id,
    event_type: event.event_type,
    result: event.result ?? null,
    notes: event.notes ?? null,
    scanned_at: event.scanned_at,
    payload_json: event.payload_json ?? entryEvidence,
  }));
  return `select public.tool_commit_cleaning_workflow_authoritative(
    ${q(session)},${q(completionUuid(completion))},${q(device)},${q(location)},${q(start)},${q(end)},
    ${q(JSON.stringify(response))}::jsonb,${q(JSON.stringify(canonicalScans))}::jsonb,${q(correlation)},
    ${q(context)},${q(proof)},${q(credential)},'custodial-native-completion.v1',
    ${q(nativeCompletionSignature)},${q(nativeRouteSecret)},${q(execSecret)}
  )::text;`;
}
let snapshot;
const snapshotsByDevice = new Map();
const nativeScanEntries = new Map();
async function activate({ device, location, session, start = startedAt, credential = credentialA, authoritySnapshot = snapshotsByDevice.get(device) || snapshot, nativeScanEntry = null }) {
  const entry = nativeScanEntry || nativeScanEntries.get(session) || randomUUID();
  if (!nativeScanEntries.has(session)) nativeScanEntries.set(session, entry);
  return JSON.parse(await sql(`select public.tool_start_offline_occurrence(${q(device)},${q(location)},${q(session)},${q(start)},${q(authoritySnapshot.snapshot_id)},${q(authoritySnapshot.employee_id)},${authoritySnapshot.assignment_epoch},${q(credential)},${q(credential)},${q(entry)},'custodial-native-start.v1',${q(nativeStartSignature)},${q(nativeRouteSecret)},${q(execSecret)})::text;`));
}
async function claimNotifications(workerId, limit = 50) {
  return JSON.parse(await sql(`select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb)::text from public.custodial_claim_offline_reconciliation_notifications(${q(workerId)},${limit},15,${q(execSecret)}) n;`));
}
async function finishNotification(notification, { workerId, succeeded, terminal = false, error = null, retrySeconds = 15, delivery = {} }) {
  return JSON.parse(await sql(`select public.custodial_finish_offline_reconciliation_notification(${q(notification.outbox_id)}::uuid,${q(workerId)},${q(notification.lease_token)}::uuid,${succeeded},${q(error)},${retrySeconds},${terminal},${q(JSON.stringify(delivery))}::jsonb,${q(execSecret)})::text;`));
}

const setup = `
select public.custodial_configure_backend_execution_key(encode(extensions.digest(convert_to(${q(execSecret)},'UTF8'),'sha256'),'hex'),'offline-authority-db-test');
select public.custodial_configure_native_route_proof_key(encode(extensions.digest(convert_to(${q(nativeRouteSecret)},'UTF8'),'sha256'),'hex'),'offline-authority-db-test');
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
  ('${deviceC}'::uuid,'OA-${stamp}-C','Offline Authority Device C',true,'${employeeB}'::uuid,'disposable authority test');
insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at,metadata_json) values
  ('${credentialA}'::uuid,'${deviceA}'::uuid,'${tokenHashA}','authority A',now(),now()+interval '30 days','{}'::jsonb),
  ('${credentialB}'::uuid,'${deviceB}'::uuid,'${tokenHashB}','authority B',now(),now()+interval '30 days','{}'::jsonb),
  ('${credentialC}'::uuid,'${deviceC}'::uuid,'${tokenHashC}','authority C',now(),now()+interval '30 days','{}'::jsonb);
insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,new_employee_id,new_employee_name,change_reason,source) values
  ('${deviceA}'::uuid,'OA-${stamp}-A','${employeeA}'::uuid,'Offline Authority Actor A','fixture','test'),
  ('${deviceB}'::uuid,'OA-${stamp}-B','${employeeA}'::uuid,'Offline Authority Actor A','fixture','test'),
  ('${deviceC}'::uuid,'OA-${stamp}-C','${employeeB}'::uuid,'Offline Authority Actor B','fixture','test');`;

await sql(setup);
assert.equal(await sql(`select count(*) from public.custodial_offline_actor_contexts where client_session_id like 'oa-${stamp}%';`), "0", "state reads must create no proof/context");
snapshot = JSON.parse(await sql(`select public.tool_get_offline_scan_authority_snapshot(${q(`OA-${stamp}-A`)},${q(credentialA)},${q(execSecret)})::text;`));
snapshotsByDevice.set(`OA-${stamp}-A`, snapshot);
snapshotsByDevice.set(`OA-${stamp}-B`, JSON.parse(await sql(`select public.tool_get_offline_scan_authority_snapshot(${q(`OA-${stamp}-B`)},${q(credentialB)},${q(execSecret)})::text;`)));
snapshotsByDevice.set(`OA-${stamp}-C`, JSON.parse(await sql(`select public.tool_get_offline_scan_authority_snapshot(${q(`OA-${stamp}-C`)},${q(credentialC)},${q(execSecret)})::text;`)));
const latestSnapshotGeneratedAt = Math.max(...Array.from(snapshotsByDevice.values(), (value) => Date.parse(value.generated_at)));
startedAt = new Date(latestSnapshotGeneratedAt + 1).toISOString();
endedAt = new Date(latestSnapshotGeneratedAt + 2).toISOString();
assert.equal(snapshot.schema_version, "offline-scan-snapshot.v2");
assert.equal(snapshot.contract_version, "scan.v4.snapshot-bound-authority");
assert.equal(snapshot.canonical_device_id, `OA-${stamp}-A`);
assert.equal(snapshot.employee_id, employeeA);
assert.equal(snapshot.employee_name, "Offline Authority Actor A");
assert.equal(snapshot.assignment_epoch, 1);
assert.equal(snapshot.locations.some((row) => row.location_code === codeA), true);
assert.equal(Date.parse(snapshot.expires_at) - Date.parse(snapshot.generated_at) <= 24 * 60 * 60 * 1000, true);
assertCanonicalUtcMillis(snapshot.generated_at, "snapshot.generated_at");
assertCanonicalUtcMillis(snapshot.expires_at, "snapshot.expires_at");
const foreignSnapshotDenied = await sql(`select public.tool_get_offline_scan_authority_snapshot(${q(`OA-${stamp}-A`)},${q(credentialB)},${q(execSecret)});`, { expectFailure: true });
assert.match(foreignSnapshotDenied, /active authenticated employee-device assignment is required/i);
const invalidCompletionIdDenied = await sql(`select public.tool_commit_cleaning_workflow_authoritative(
  'invalid-uuid-session','not-a-uuid',${q(`OA-${stamp}-A`)},${q(codeA)},${q(startedAt)},${q(endedAt)},
  '{}'::jsonb,'[]'::jsonb,null,${q(randomUUID())},${q("a".repeat(64))},${q(credentialA)},
  'custodial-native-completion.v1',${q(nativeCompletionSignature)},${q(nativeRouteSecret)},${q(execSecret)});`, { expectFailure: true });
assert.match(invalidCompletionIdDenied, /p_client_completion_id must be a UUID/i,
  "SQL rejects non-UUID completion identity before any reconciliation storage write");
assert.equal(await sql("select count(*) from pg_constraint where conname in ('custodial_offline_reconciliation_client_completion_id_uuid','completion_responses_client_completion_id_uuid') and convalidated is false;"), "2",
  "new completion storage checks protect future writes while retaining historical rows");

await sql(`update public.devices set active=false where id='${deviceC}'::uuid;
  update public.locations set active=false where id='${locationC}'::uuid;`);
const inactiveNewSnapshotDenied = await sql(
  `select public.tool_get_offline_scan_authority_snapshot(${q(`OA-${stamp}-C`)},${q(credentialC)},${q(execSecret)});`,
  { expectFailure: true },
);
assert.match(inactiveNewSnapshotDenied, /active authenticated employee-device assignment is required/i,
  "inactive devices cannot obtain new offline authority");
const deactivatedDelayedSession = `oa-${stamp}-deactivated-delayed`;
const deactivatedDelayed = await activate({
  device: `OA-${stamp}-C`, location: codeC, session: deactivatedDelayedSession,
  credential: credentialC, authoritySnapshot: snapshotsByDevice.get(`OA-${stamp}-C`),
});
assert.equal(deactivatedDelayed.employee_id, employeeB,
  "work validly started under the issued snapshot survives later device and location deactivation");
const deactivatedDelayedCompletion = JSON.parse(await sql(jsonSql({
  session: deactivatedDelayedSession,
  completion: `${deactivatedDelayedSession}-complete`,
  context: deactivatedDelayed.context_id,
  proof: deactivatedDelayed.submission_proof,
  device: `OA-${stamp}-C`,
  location: codeC,
  credential: credentialC,
  start: startedAt,
  end: endedAt,
  response: {},
  correlation: `${deactivatedDelayedSession}-correlation`,
})));
assert.equal(deactivatedDelayedCompletion.status, "closed",
  "snapshot-bound work also completes after later device and location deactivation");
const postDeactivationNewStartDenied = await sql(`select public.tool_start_offline_occurrence(
  ${q(`OA-${stamp}-C`)},${q(codeC)},${q(`oa-${stamp}-deactivated-new`)},
  ${q(new Date(Date.now() + 5_000).toISOString())},${q(snapshotsByDevice.get(`OA-${stamp}-C`).snapshot_id)},
  ${q(snapshotsByDevice.get(`OA-${stamp}-C`).employee_id)},${snapshotsByDevice.get(`OA-${stamp}-C`).assignment_epoch},
  ${q(credentialC)},${q(credentialC)},${q(randomUUID())},'custodial-native-start.v1',${q(nativeStartSignature)},${q(nativeRouteSecret)},${q(execSecret)});`, { expectFailure: true });
assert.match(postDeactivationNewStartDenied, /device or location was not active when the offline occurrence began/i,
  "an old snapshot cannot authorize a new physical start after deactivation");

const sessionA = `oa-${stamp}-accepted`;
const contextA = await activate({ device: `OA-${stamp}-A`, location: codeA, session: sessionA });
assert.equal(contextA.committable, true);
assert.match(contextA.occurrence_id, /^[0-9a-f-]{36}$/);
assert.match(contextA.submission_proof, /^[0-9a-f]{64}$/);
// Every sql() call opens a fresh psql process, so this is both an exact replay
// after a lost response and a transport/service-restart recovery check.
const startReplay = await activate({ device: `OA-${stamp}-A`, location: codeA, session: sessionA });
assert.equal(startReplay.committable, true, "exact start replay remains completion-capable");
assert.equal(startReplay.replayed, true, "exact start replay is explicitly classified");
assert.equal(startReplay.submission_proof, contextA.submission_proof, "lost start response recovers the stable durable proof");
assert.equal(await sql(`select count(*) from public.custodial_offline_submission_proofs p join public.custodial_offline_actor_contexts c on c.context_id=p.context_id where c.client_session_id=${q(sessionA)};`), "1");
const changedStartDenied = await sql(`select public.tool_start_offline_occurrence(${q(`OA-${stamp}-A`)},${q(codeA)},${q(sessionA)},${q(new Date(Date.parse(startedAt) + 1000).toISOString())},${q(snapshot.snapshot_id)},${q(snapshot.employee_id)},${snapshot.assignment_epoch},${q(credentialA)},${q(credentialA)},${q(nativeScanEntries.get(sessionA))},'custodial-native-start.v1',${q(nativeStartSignature)},${q(nativeRouteSecret)},${q(execSecret)});`, { expectFailure: true });
assert.match(changedStartDenied, /does not match the original frozen snapshot/i, "different start content remains fenced");
const changedScanEntryDenied = await activate({
  device: `OA-${stamp}-A`, location: codeA, session: sessionA, nativeScanEntry: randomUUID(),
}).then(() => "", (error) => String(error.stderr || error.message));
assert.match(changedScanEntryDenied, /native start attestation replay does not match/i,
  "an NFC handoff cannot be replayed onto an existing frozen occurrence");

const genericDenied = await sql(`set role service_role; select public.tool_start_offline_occurrence('OA-${stamp}-A','${codeA}','oa-${stamp}-forged',${q(startedAt)},${q(snapshot.snapshot_id)},${q(snapshot.employee_id)},${snapshot.assignment_epoch},'${credentialA}','${credentialA}','${randomUUID()}','custodial-native-start.v1',${q(nativeStartSignature)},${q(execSecret)},${q(execSecret)});`, { expectFailure: true });
assert.match(genericDenied, /native phone route proof is not authorized|permission denied/i,
  "generic service_role plus the general backend secret cannot forge native-route authority");
assert.equal(await sql(`select has_function_privilege('service_role','public.run_sql_write(text)'::regprocedure,'EXECUTE')::text;`), "false", "the legacy one-argument SQL writer is not application-callable");
for (const [label, statement] of [
  ["application SQL executor", `select public.run_application_write('forged','select 1');`],
  ["legacy SQL write executor", `select public.run_sql_write('select 1'::text,'forged'::text);`],
  ["migration SQL executor", `select public.run_sql_migration('forged','select 1');`],
  ["force-close terminal writer", `select public.force_close_session(gen_random_uuid()::text,'forged','forged');`],
  ["force-close tool writer", `select public.tool_force_close_session(gen_random_uuid()::text,'forged','forged');`],
  ["demo mutation start writer", `select public.demo_scan_mock_start(1,false);`],
  ["demo dynamic completion writer", `select public.demo_scan_mock_complete_open_dynamic(gen_random_uuid(),true);`],
  ["demo cleanup writer", `select * from public.demo_scan_mock_cleanup(null);`],
  ["purge terminal writer", `select public.purge_closed_scan_history_before(now(),'forged');`],
  ["purge terminal wrapper", `select public.tool_purge_closed_scan_history_before(now(),'forged');`],
  ["ticket close writer", `select public.close_maintenance_ticket(gen_random_uuid(),'forged',null);`],
  ["ticket close wrapper", `select public.tool_close_maintenance_ticket(gen_random_uuid()::text,'forged',null);`],
]) {
  const denial = await sql(`set role service_role; ${statement}`, { expectFailure: true });
  assert.match(denial, /permission denied/i, `${label} is not application-callable`);
}
assert.equal(await sql(`select count(*) from public.custodial_terminal_writer_inventory
  where application_callable and (mutates_terminal_truth or delegates_alternate_terminal_authority)
    and oid is distinct from to_regprocedure('public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text)')
    and oid is distinct from to_regprocedure('public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text)')
    and oid is distinct from to_regprocedure('public.tool_complete_session_authoritative(text,jsonb,text,text,text,text)')
    and oid is distinct from to_regprocedure('public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)')
    and oid is distinct from to_regprocedure('public.custodial_finish_historical_session_authoritative(text,text,uuid,timestamptz,text)');`),
"0", "capability/grant inventory leaves no application-callable alternate terminal writer or same-name overload");

// A start genuinely begun offline under A may first reach the server after the
// phone is assigned to B. The unexpired issued snapshot preserves A as actor.
await sql(`update public.devices set assigned_employee_id='${employeeB}'::uuid where id='${deviceA}'::uuid;
  insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,new_employee_id,new_employee_name,change_reason,source)
  values('${deviceA}'::uuid,'OA-${stamp}-A','${employeeB}'::uuid,'Offline Authority Actor B','proof replay reassignment fixture','test');`);
const reassignedReplay = await activate({ device: `OA-${stamp}-A`, location: codeA, session: sessionA });
assert.equal(reassignedReplay.replayed, true, "reassignment preserves exact frozen start replay");
assert.equal(reassignedReplay.submission_proof, contextA.submission_proof, "exact frozen replay returns the original proof");
const delayedSession = `oa-${stamp}-reassigned-first-sync`;
const delayedStart = new Date(Date.parse(snapshot.generated_at) + 3).toISOString();
const delayedEnd = new Date(Date.parse(snapshot.generated_at) + 4).toISOString();
const delayedActivation = await activate({ device: `OA-${stamp}-A`, location: codeA, session: delayedSession, start: delayedStart });
assert.equal(delayedActivation.employee_id, employeeA, "first sync after reassignment freezes snapshot employee A");
assert.notEqual(delayedActivation.employee_id, employeeB, "replacement employee B is never credited for A's offline start");
const delayedCompletion = JSON.parse(await sql(jsonSql({
  session: delayedSession,
  completion: `${delayedSession}-complete`,
  context: delayedActivation.context_id,
  proof: delayedActivation.submission_proof,
  device: `OA-${stamp}-A`,
  location: codeA,
  start: delayedStart,
  end: delayedEnd,
  correlation: `${delayedSession}-correlation`,
})));
assert.equal(delayedCompletion.status, "closed", "delayed first-sync work remains committable");
assert.equal(await sql(`select employee_id::text from public.sessions where client_session_id=${q(delayedSession)};`), employeeA,
  "durable session preserves A after the phone is reassigned to B");

// The phone may remain fully offline through both start and completion. A
// subsequently revoked credential still proves work that began first, but it
// cannot authorize work beginning at or after revocation or reassignment.
const recoveryDevice = randomUUID();
const recoveryCredential = randomUUID();
const recoveryCode = `OA${stamp}R`.toUpperCase();
const recoveryLocation = randomUUID();
await sql(`insert into public.locations(id,location_code,location_name,location_type,active,form_type,notes)
  values('${recoveryLocation}'::uuid,${q(recoveryCode)},'Offline Recovery Location','restroom',true,'restroom','disposable recovery test');
  insert into public.devices(id,device_id,device_name,active,assigned_employee_id,notes)
  values('${recoveryDevice}'::uuid,'OA-${stamp}-R','Offline Recovery Device',true,'${employeeA}'::uuid,'disposable recovery test');
  insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at,metadata_json)
  values('${recoveryCredential}'::uuid,'${recoveryDevice}'::uuid,${q(createHash("sha256").update(`offline-recovery:${stamp}`).digest("hex"))},'recovery',now(),now()+interval '30 days','{}'::jsonb);
  insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,new_employee_id,new_employee_name,change_reason,source)
  values('${recoveryDevice}'::uuid,'OA-${stamp}-R','${employeeA}'::uuid,'Offline Authority Actor A','recovery fixture','test');`);
const recoverySnapshot = JSON.parse(await sql(`select public.tool_get_offline_scan_authority_snapshot('OA-${stamp}-R','${recoveryCredential}'::text,${q(execSecret)})::text;`));
const recoveryStartedAt = new Date(Date.parse(recoverySnapshot.generated_at) + 1).toISOString();
const recoveryRevokedAt = new Date(Date.parse(recoverySnapshot.generated_at) + 2000).toISOString();
await sql(`update public.device_auth_credentials set revoked_at=${q(recoveryRevokedAt)},revoked_reason='offline activation recovery test' where credential_id='${recoveryCredential}'::uuid;
  update public.custodial_offline_scan_authority_snapshots set expires_at=generated_at+interval '2 seconds' where snapshot_id=${q(recoverySnapshot.snapshot_id)};`);
const recoveredActivation = await activate({
  device: `OA-${stamp}-R`, location: recoveryCode, session: `oa-${stamp}-revoked-recovery`,
  start: recoveryStartedAt, credential: recoveryCredential, authoritySnapshot: recoverySnapshot,
});
assert.equal(recoveredActivation.employee_id, employeeA,
  "work started before credential revocation and snapshot expiry retains the issued snapshot actor");
const recoveredEndedAt = new Date(Date.parse(recoverySnapshot.generated_at) + 1000).toISOString();
const recoveredCompletion = JSON.parse(await sql(jsonSql({
  session: `oa-${stamp}-revoked-recovery`, completion: `oa-${stamp}-revoked-recovery-complete`,
  context: recoveredActivation.context_id, proof: recoveredActivation.submission_proof,
  device: `OA-${stamp}-R`, location: recoveryCode, credential: recoveryCredential,
  start: recoveryStartedAt, end: recoveredEndedAt, correlation: `oa-${stamp}-revoked-recovery`,
})));
assert.equal(recoveredCompletion.status, "closed",
  "work signed as complete before revocation remains committable when delivered after revocation");
assert.equal(await sql(`select employee_id::text from public.sessions where client_session_id='oa-${stamp}-revoked-recovery';`), employeeA,
  "post-revocation delivery preserves the original employee actor");
const afterRevocationDenied = await sql(`select public.tool_start_offline_occurrence(
  'OA-${stamp}-R',${q(recoveryCode)},'oa-${stamp}-after-revoke',${q(new Date(Date.parse(recoveryRevokedAt) + 1000).toISOString())},
  ${q(recoverySnapshot.snapshot_id)},${q(recoverySnapshot.employee_id)},${recoverySnapshot.assignment_epoch},
  '${recoveryCredential}','${recoveryCredential}','${randomUUID()}','custodial-native-start.v1',${q(nativeStartSignature)},${q(nativeRouteSecret)},${q(execSecret)});`, { expectFailure: true });
assert.match(afterRevocationDenied, /snapshot was not valid|credential was not valid/i,
  "revoked or expired authority cannot start new work");
await sql(`update public.device_auth_credentials set confirmed_at=${q(new Date(Date.parse(recoverySnapshot.generated_at) + 1000).toISOString())},revoked_at=null,revoked_reason=null where credential_id='${recoveryCredential}'::uuid;
  update public.custodial_offline_scan_authority_snapshots set expires_at=generated_at+interval '1 hour' where snapshot_id=${q(recoverySnapshot.snapshot_id)};`);
const postdatedEnrollmentDenied = await sql(`select public.tool_start_offline_occurrence(
  'OA-${stamp}-R',${q(recoveryCode)},'oa-${stamp}-postdated-enrollment',${q(recoveryStartedAt)},
  ${q(recoverySnapshot.snapshot_id)},${q(recoverySnapshot.employee_id)},${recoverySnapshot.assignment_epoch},
  '${recoveryCredential}','${recoveryCredential}','${randomUUID()}','custodial-native-start.v1',${q(nativeStartSignature)},${q(nativeRouteSecret)},${q(execSecret)});`, { expectFailure: true });
assert.match(postdatedEnrollmentDenied, /credential was not valid/i,
  "a credential confirmation postdated after snapshot issuance cannot backdate new work");
await sql(`update public.device_auth_credentials set revoked_at=null,revoked_reason=null where credential_id='${recoveryCredential}'::uuid;
  update public.device_auth_credentials set confirmed_at=${q(recoverySnapshot.generated_at)} where credential_id='${recoveryCredential}'::uuid;
  update public.custodial_offline_scan_authority_snapshots set expires_at=generated_at+interval '1 hour' where snapshot_id=${q(recoverySnapshot.snapshot_id)};
  update public.devices set assigned_employee_id='${employeeB}'::uuid where id='${recoveryDevice}'::uuid;
  insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,new_employee_id,new_employee_name,changed_at,change_reason,source)
  values('${recoveryDevice}'::uuid,'OA-${stamp}-R','${employeeB}'::uuid,'Offline Authority Actor B',${q(new Date(Date.parse(recoverySnapshot.generated_at) + 3).toISOString())},'replacement fixture','test');`);
const afterReassignmentDenied = await sql(`select public.tool_start_offline_occurrence(
  'OA-${stamp}-R',${q(recoveryCode)},'oa-${stamp}-after-reassign',${q(new Date(Date.parse(recoverySnapshot.generated_at) + 4).toISOString())},
  ${q(recoverySnapshot.snapshot_id)},${q(recoverySnapshot.employee_id)},${recoverySnapshot.assignment_epoch},
  '${recoveryCredential}','${recoveryCredential}','${randomUUID()}','custodial-native-start.v1',${q(nativeStartSignature)},${q(nativeRouteSecret)},${q(execSecret)});`, { expectFailure: true });
assert.match(afterReassignmentDenied, /snapshot no longer owned the phone/i,
  "an old employee snapshot cannot authorize replacement-employee work");
const scanId = `oa-${stamp}-scan-1`;
const acceptedSql = jsonSql({ session: sessionA, completion: `oa-${stamp}-complete-1`, context: contextA.context_id, proof: contextA.submission_proof, device: `OA-${stamp}-A`, location: codeA, scans: [{ event_type: "scan_finish", client_event_id: scanId, scanned_at: endedAt, result: "ok", payload_json: entryEvidence }] });
const accepted = JSON.parse(await sql(acceptedSql));
assert.equal(accepted.status, "closed");
assertCanonicalUtcMillis(accepted.started_at, "accepted.started_at");
assertCanonicalUtcMillis(accepted.completed_at, "accepted.completed_at");
assert.equal(await sql(`select employee_id::text from public.sessions where client_session_id=${q(sessionA)};`), employeeA);
const replays = await Promise.all(Array.from({ length: 8 }, () => sql(acceptedSql).then(JSON.parse)));
assert.equal(replays.filter((result) => result.replayed === true).length, 8, "concurrent exact retries converge");
const reorderedReplay = JSON.parse(await sql(jsonSql({ session: sessionA, completion: `oa-${stamp}-complete-1`, context: contextA.context_id, proof: contextA.submission_proof, device: `OA-${stamp}-A`, location: codeA, response: { alpha: 1, issues: [{ category: "plumbing", label: "Authority test faucet" }] }, scans: [{ payload_json: entryEvidence, result: "ok", scanned_at: endedAt, client_event_id: scanId, event_type: "scan_finish" }] })));
assert.equal(reorderedReplay.replayed, true, "JSON object order is canonical replay");
const correlationMismatch = JSON.parse(await sql(jsonSql({ session: sessionA, completion: `oa-${stamp}-complete-1`, context: contextA.context_id, proof: contextA.submission_proof, device: `OA-${stamp}-A`, location: codeA, correlation: "correlation-b" })));
assert.equal(correlationMismatch.reason, "payload_fingerprint_conflict");

// A second device/actor proof at the same interval is durably quarantined by
// exclusion constraints, including after the first interval is closed.
const overlap = await activate({ device: `OA-${stamp}-B`, location: codeB, session: `oa-${stamp}-overlap`, credential: credentialB });
const overlapResult = JSON.parse(await sql(jsonSql({ session: `oa-${stamp}-overlap`, completion: `oa-${stamp}-overlap-complete`, context: overlap.context_id, proof: overlap.submission_proof, device: `OA-${stamp}-B`, location: codeB, credential: credentialB, response: {}, correlation: "overlap" })));
assert.equal(overlapResult.reason, "overlapping_employee_or_device_occurrence");

// Malformed evidence reaches the durable quarantine boundary before any
// completion/ticket/outbox effect, rather than aborting and leaving retryable work.
const malformedAt = new Date(latestSnapshotGeneratedAt + 5).toISOString();
const malformed = await activate({ device: `OA-${stamp}-C`, location: codeC, session: `oa-${stamp}-malformed`, start: malformedAt, credential: credentialC });
const malformedStart = malformed.started_at;
const malformedResult = JSON.parse(await sql(jsonSql({ session: `oa-${stamp}-malformed`, completion: `oa-${stamp}-malformed-complete`, context: malformed.context_id, proof: malformed.submission_proof, device: `OA-${stamp}-C`, location: codeC, credential: credentialC, start: malformedStart, end: new Date().toISOString(), response: {}, scans: [{ event_type: "scan_finish", client_event_id: `oa-${stamp}-bad`, scanned_at: "not-a-time" }], correlation: "malformed" })));
assert.equal(malformedResult.reason, "malformed_scan_evidence");
assert.equal(await sql(`select count(*) from public.completion_responses where client_completion_id=${q(completionUuid(`oa-${stamp}-malformed-complete`))};`), "0");
assert.equal(await sql(`select count(*) from public.custodial_offline_reconciliation_outbox o join public.custodial_offline_reconciliation_records r on r.reconciliation_id=o.reconciliation_id where r.client_completion_id=${q(completionUuid(`oa-${stamp}-malformed-complete`))} and o.notification_kind='offline_reconciliation_quarantine';`), "1", "each new quarantine has one deduplicated manager outbox record");

const provenanceSession = `oa-${stamp}-provenance`;
const provenanceStart = new Date(latestSnapshotGeneratedAt + 6).toISOString();
const provenanceEnd = new Date(latestSnapshotGeneratedAt + 7).toISOString();
const provenance = await activate({ device: `OA-${stamp}-C`, location: codeC, session: provenanceSession, start: provenanceStart, credential: credentialC });
const unknownProvenance = JSON.parse(await sql(jsonSql({ session: provenanceSession, completion: `${provenanceSession}-complete`, context: provenance.context_id, proof: provenance.submission_proof, device: `OA-${stamp}-C`, location: codeC, credential: credentialC, start: provenanceStart, end: provenanceEnd, response: {}, scans: [{ client_event_id: `${provenanceSession}-event`, event_type: "scan_finish", result: "ok", notes: null, scanned_at: provenanceEnd, payload_json: { entry_source: "legacy-or-unknown" } }], correlation: "provenance" })));
assert.equal(unknownProvenance.reason, "malformed_scan_evidence");
const extraSession = `oa-${stamp}-extra-evidence`;
const extraStart = new Date(latestSnapshotGeneratedAt + 8).toISOString();
const extraEnd = new Date(latestSnapshotGeneratedAt + 9).toISOString();
const extraContext = await activate({ device: `OA-${stamp}-C`, location: codeC, session: extraSession, start: extraStart, credential: credentialC });
const extraEvidence = JSON.parse(await sql(jsonSql({ session: extraSession, completion: `${extraSession}-complete`, context: extraContext.context_id, proof: extraContext.submission_proof, device: `OA-${stamp}-C`, location: codeC, credential: credentialC, start: extraStart, end: extraEnd, response: {}, scans: [{ client_event_id: `${extraSession}-event`, event_type: "scan_finish", result: "ok", notes: null, scanned_at: extraEnd, payload_json: { ...entryEvidence, injected: true }, injected: true }], correlation: "provenance-extra" })));
assert.equal(extraEvidence.reason, "malformed_scan_evidence");

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
const truncateGuard = await sql(`truncate table public.custodial_offline_reconciliation_outbox cascade;`, { expectFailure: true });
assert.match(truncateGuard, /explicit maintenance procedure/i, "append-only evidence has a statement-level TRUNCATE guard");

// Concurrent activation has one canonical context and every exact caller gets
// a normal replay instead of a unique-constraint error.
const activationSession = `oa-${stamp}-concurrent-activation`;
const activationStartedAt = new Date(latestSnapshotGeneratedAt + 10).toISOString();
const activationResults = await Promise.all(Array.from({ length: 8 }, () => activate({
  device: `OA-${stamp}-C`, location: codeC, session: activationSession, start: activationStartedAt, credential: credentialC,
})));
assert.equal(new Set(activationResults.map((result) => result.context_id)).size, 1, "concurrent exact activation converges on one context");
assert.equal(await sql(`select count(*) from public.custodial_offline_actor_contexts where client_session_id=${q(activationSession)};`), "1");

// A same completion key on a second occurrence must fence that occurrence and
// its proof; a new key cannot subsequently close it.
const fenceStart = new Date(latestSnapshotGeneratedAt + 11).toISOString();
const fenceEnd = new Date(latestSnapshotGeneratedAt + 12).toISOString();
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
assert.equal(await sql(`select count(*) from public.completion_responses where client_completion_id=${q(completionUuid(`oa-${stamp}-fence-b-new-key`))};`), "0", "fenced proof never mints a second completion");

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
await sql(`update public.devices set active=true where id='${deviceC}'::uuid;
  update public.locations set active=true where id='${locationC}'::uuid;`);
snapshotsByDevice.set(`OA-${stamp}-B`, JSON.parse(await sql(`select public.tool_get_offline_scan_authority_snapshot(${q(`OA-${stamp}-B`)},${q(credentialB)},${q(execSecret)})::text;`)));
snapshotsByDevice.set(`OA-${stamp}-C`, JSON.parse(await sql(`select public.tool_get_offline_scan_authority_snapshot(${q(`OA-${stamp}-C`)},${q(credentialC)},${q(execSecret)})::text;`)));
const raceSnapshotGeneratedAt = Math.max(
  Date.parse(snapshotsByDevice.get(`OA-${stamp}-B`).generated_at),
  Date.parse(snapshotsByDevice.get(`OA-${stamp}-C`).generated_at),
);
const raceStart = new Date(raceSnapshotGeneratedAt + 1).toISOString();
const raceEnd = new Date(raceSnapshotGeneratedAt + 2).toISOString();
const raceA = await activate({ device: `OA-${stamp}-B`, location: codeB, session: `oa-${stamp}-race-a`, start: raceStart, credential: credentialB });
const raceB = await activate({ device: `OA-${stamp}-C`, location: codeC, session: `oa-${stamp}-race-b`, start: raceStart, credential: credentialC });
const sharedEvent = `oa-${stamp}-shared-event`;
const [raceResultA, raceResultB] = await Promise.all([
  sql(jsonSql({ session: `oa-${stamp}-race-a`, completion: `oa-${stamp}-race-a-complete`, context: raceA.context_id, proof: raceA.submission_proof, device: `OA-${stamp}-B`, location: codeB, credential: credentialB, start: raceStart, end: raceEnd, scans: [{ event_type: "scan_finish", client_event_id: sharedEvent, scanned_at: raceEnd, result: "A" }] })).then(JSON.parse),
  sql(jsonSql({ session: `oa-${stamp}-race-b`, completion: `oa-${stamp}-race-b-complete`, context: raceB.context_id, proof: raceB.submission_proof, device: `OA-${stamp}-C`, location: codeC, credential: credentialC, start: raceStart, end: raceEnd, scans: [{ event_type: "scan_finish", client_event_id: sharedEvent, scanned_at: raceEnd, result: "B" }] })).then(JSON.parse),
]);
assert.equal([raceResultA, raceResultB].filter((result) => result.status === "closed").length, 1);
const raceLoser = completionUuid(raceResultA.status === "quarantined" ? `oa-${stamp}-race-a-complete` : `oa-${stamp}-race-b-complete`);
assert.equal(await sql(`select count(*) from public.custodial_offline_reconciliation_outbox o join public.custodial_offline_reconciliation_records r on r.reconciliation_id=o.reconciliation_id where r.client_completion_id=${q(raceLoser)};`), "1", "cross-submission event race leaves a durable manager follow-up record");

const reconciliationId = await sql(`select reconciliation_id::text from public.custodial_offline_reconciliation_records where client_completion_id=${q(completionUuid(`oa-${stamp}-malformed-complete`))};`);
const managerId = "00000000-0000-4000-8000-000000000001";
const dispositionRequestId = randomUUID();
const dispositionSql = `select public.custodial_manager_dispose_offline_reconciliation('${managerId}'::uuid,${q(reconciliationId)}::uuid,'reviewed','validated exactly-once recovery disposition','${dispositionRequestId}'::uuid,${q(execSecret)})::text;`;
const dispositionResults = await Promise.all([sql(dispositionSql).then(JSON.parse), sql(dispositionSql).then(JSON.parse)]);
assert.equal(new Set(dispositionResults.map((result) => result.disposition_id)).size, 1, "concurrent exact dispositions converge on one canonical outcome");
assert.equal(dispositionResults.filter((result) => result.replayed).length, 1);
const dispositionConflict = await sql(`select public.custodial_manager_dispose_offline_reconciliation('${managerId}'::uuid,${q(reconciliationId)}::uuid,'reviewed','different request payload','${dispositionRequestId}'::uuid,${q(execSecret)});`, { expectFailure: true });
assert.match(dispositionConflict, /already bound to a different recovery outcome/i);
assert.equal(await sql(`select count(*) from public.custodial_offline_reconciliation_outbox where disposition_id=${q(dispositionResults[0].disposition_id)}::uuid and notification_kind='offline_reconciliation_disposition';`), "1", "an accepted disposition emits one deduplicated notification fact");

// Claim state, retry timing, restart recovery, delivery evidence, and terminal
// failure are all durable outbox transitions rather than in-memory worker work.
const firstWorker = "offline-authority-db-worker-before-restart";
const firstClaims = await claimNotifications(firstWorker);
assert.ok(firstClaims.length >= 3, "quarantines and the accepted disposition are claimable");
const dispositionNotification = firstClaims.find((notification) => notification.notification_kind === "offline_reconciliation_disposition");
const terminalNotification = firstClaims.find((notification) => notification.notification_kind === "offline_reconciliation_quarantine");
assert.ok(dispositionNotification && terminalNotification, "claim includes both reconciliation lifecycle notification kinds");
const retried = await finishNotification(dispositionNotification, {
  workerId: firstWorker, succeeded: false, error: "transient messenger outage", retrySeconds: 15,
});
assert.equal(retried.state, "retry");
assert.equal(retried.attempts, 1);
const terminalFailure = await finishNotification(terminalNotification, {
  workerId: firstWorker, succeeded: false, terminal: true, error: "named manager recipient permanently unavailable",
});
assert.equal(terminalFailure.state, "failed");
assert.equal(terminalFailure.terminal, true);
for (const notification of firstClaims.filter((notification) => notification.outbox_id !== dispositionNotification.outbox_id && notification.outbox_id !== terminalNotification.outbox_id)) {
  const delivered = await finishNotification(notification, { workerId: firstWorker, succeeded: true, delivery: { channel: "test", delivered: true } });
  assert.equal(delivered.state, "delivered");
}
await new Promise((resolve) => setTimeout(resolve, 16_000));
const restartClaims = await claimNotifications("offline-authority-db-worker-after-restart");
assert.equal(restartClaims.length, 1, "a fresh worker process claims the due retry exactly once");
assert.equal(restartClaims[0].outbox_id, dispositionNotification.outbox_id);
assert.equal(restartClaims[0].attempts, 2);
const retriedDelivered = await finishNotification(restartClaims[0], {
  workerId: "offline-authority-db-worker-after-restart", succeeded: true, delivery: { channel: "test", delivered_after_restart: true },
});
assert.equal(retriedDelivered.state, "delivered");
assert.equal(await sql(`select state from public.custodial_offline_reconciliation_outbox where outbox_id=${q(terminalNotification.outbox_id)}::uuid;`), "failed", "terminal delivery failure remains visible instead of retry");
const retiredMaintenance = await sql(`select public.custodial_truncate_offline_evidence_for_maintenance('public.custodial_offline_reconciliation_outbox'::regclass,'disposable rebuild verification');`, { expectFailure: true });
assert.match(retiredMaintenance, /truncation is retired/i, "there is no application-callable or owner-maintenance purge of append-only custodial evidence");
const legacyDenied = await sql(`select public.tool_complete_session('missing','{}'::jsonb,null,'OA-${stamp}-A','oa-${stamp}-legacy');`, { expectFailure: true });
assert.match(legacyDenied, /Use tool_complete_session_authoritative/i);
const messengerDenied = await sql(`select public.msg_delete_thread_permanently(gen_random_uuid());`, { expectFailure: true });
assert.match(messengerDenied, /retired/i);

console.log("OFFLINE_ACTOR_RECOVERY_DATABASE_PASS");
