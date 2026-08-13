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
const entryEvidence = { entry_source: "native-nfc" };

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
  const canonicalScans = scans.map((event) => ({
    client_event_id: event.client_event_id,
    event_type: event.event_type,
    result: event.result ?? null,
    notes: event.notes ?? null,
    scanned_at: event.scanned_at,
    payload_json: event.payload_json ?? entryEvidence,
  }));
  return `select public.tool_commit_cleaning_workflow_authoritative(
    ${q(session)},${q(completion)},${q(device)},${q(location)},${q(start)},${q(end)},
    ${q(JSON.stringify(response))}::jsonb,${q(JSON.stringify(canonicalScans))}::jsonb,${q(correlation)},
    ${q(context)},${q(proof)},${q(credential)},${q(execSecret)}
  )::text;`;
}
async function activate({ device, location, session, start = startedAt, credential = credentialA }) {
  return JSON.parse(await sql(`select public.tool_start_offline_occurrence(${q(device)},${q(location)},${q(session)},${q(start)},${q(credential)},${q(execSecret)})::text;`));
}
async function claimNotifications(workerId, limit = 50) {
  return JSON.parse(await sql(`select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb)::text from public.custodial_claim_offline_reconciliation_notifications(${q(workerId)},${limit},15,${q(execSecret)}) n;`));
}
async function finishNotification(notification, { workerId, succeeded, terminal = false, error = null, retrySeconds = 15, delivery = {} }) {
  return JSON.parse(await sql(`select public.custodial_finish_offline_reconciliation_notification(${q(notification.outbox_id)}::uuid,${q(workerId)},${q(notification.lease_token)}::uuid,${succeeded},${q(error)},${retrySeconds},${terminal},${q(JSON.stringify(delivery))}::jsonb,${q(execSecret)})::text;`));
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
const snapshot = JSON.parse(await sql(`select public.tool_get_offline_scan_authority_snapshot(${q(`OA-${stamp}-A`)},${q(credentialA)},${q(execSecret)})::text;`));
assert.equal(snapshot.schema_version, "offline-scan-snapshot.v1");
assert.equal(snapshot.contract_version, "scan.v3.offline-authority");
assert.equal(snapshot.canonical_device_id, `OA-${stamp}-A`);
assert.equal(snapshot.employee_id, employeeA);
assert.equal(snapshot.employee_name, "Offline Authority Actor A");
assert.equal(snapshot.assignment_epoch, 1);
assert.equal(snapshot.locations.some((row) => row.location_code === codeA), true);
assert.equal(Date.parse(snapshot.expires_at) - Date.parse(snapshot.generated_at) <= 24 * 60 * 60 * 1000, true);
const foreignSnapshotDenied = await sql(`select public.tool_get_offline_scan_authority_snapshot(${q(`OA-${stamp}-A`)},${q(credentialB)},${q(execSecret)});`, { expectFailure: true });
assert.match(foreignSnapshotDenied, /active authenticated employee-device assignment is required/i);

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
const changedStartDenied = await sql(`select public.tool_start_offline_occurrence(${q(`OA-${stamp}-A`)},${q(codeA)},${q(sessionA)},${q(new Date(Date.parse(startedAt) + 1000).toISOString())},${q(credentialA)},${q(execSecret)});`, { expectFailure: true });
assert.match(changedStartDenied, /does not match the original occurrence/i, "different start content remains fenced");

const genericDenied = await sql(`set role service_role; select public.tool_start_offline_occurrence('OA-${stamp}-A','${codeA}','oa-${stamp}-forged',${q(startedAt)},'${credentialA}','not-the-backend-secret');`, { expectFailure: true });
assert.match(genericDenied, /not authorized/i, "generic service_role cannot forge the backend execution proof");
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
assert.equal(await sql(`select count(*) from public.custodial_terminal_writer_inventory where application_callable and (mutates_terminal_truth or delegates_alternate_terminal_authority) and proname not in ('tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative','custodial_close_maintenance_ticket_authoritative');`), "0", "capability/grant inventory leaves no application-callable alternate terminal writer");

// A lost response is recoverable only while the issuing assignment remains
// authoritative. After reassignment the replay must not disclose the proof,
// while the proof already held by actor A remains valid for completion.
await sql(`update public.devices set assigned_employee_id='${employeeB}'::uuid where id='${deviceA}'::uuid;
  insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,new_employee_id,new_employee_name,change_reason,source)
  values('${deviceA}'::uuid,'OA-${stamp}-A','${employeeB}'::uuid,'Offline Authority Actor B','proof replay reassignment fixture','test');`);
const reassignedReplayDenied = await sql(`select public.tool_start_offline_occurrence(${q(`OA-${stamp}-A`)},${q(codeA)},${q(sessionA)},${q(startedAt)},${q(credentialA)},${q(execSecret)});`, { expectFailure: true });
assert.match(reassignedReplayDenied, /authoritative assignment changed/i, "reassigned exact start replay is fenced without returning the old proof");
assert.doesNotMatch(reassignedReplayDenied, new RegExp(contextA.submission_proof), "reassigned replay never discloses the held completion proof");
const scanId = `oa-${stamp}-scan-1`;
const acceptedSql = jsonSql({ session: sessionA, completion: `oa-${stamp}-complete-1`, context: contextA.context_id, proof: contextA.submission_proof, device: `OA-${stamp}-A`, location: codeA, scans: [{ event_type: "scan_finish", client_event_id: scanId, scanned_at: endedAt, result: "ok", payload_json: entryEvidence }] });
const accepted = JSON.parse(await sql(acceptedSql));
assert.equal(accepted.status, "closed");
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

const provenanceSession = `oa-${stamp}-provenance`;
const provenanceStart = new Date(Date.now() - 2 * 60_000).toISOString();
const provenanceEnd = new Date(Date.now() - 60_000).toISOString();
const provenance = await activate({ device: `OA-${stamp}-C`, location: codeC, session: provenanceSession, start: provenanceStart, credential: credentialC });
const unknownProvenance = JSON.parse(await sql(`select public.tool_commit_cleaning_workflow_authoritative(${q(provenanceSession)},${q(`${provenanceSession}-complete`)},${q(`OA-${stamp}-C`)},${q(codeC)},${q(provenanceStart)},${q(provenanceEnd)},'{}'::jsonb,${q(JSON.stringify([{ client_event_id: `${provenanceSession}-event`, event_type: "scan_finish", result: "ok", notes: null, scanned_at: provenanceEnd, payload_json: { entry_source: "legacy-or-unknown" } }]))}::jsonb,'provenance',${q(provenance.context_id)},${q(provenance.submission_proof)},${q(credentialC)},${q(execSecret)})::text;`));
assert.equal(unknownProvenance.reason, "malformed_scan_evidence");
const extraSession = `oa-${stamp}-extra-evidence`;
const extraStart = new Date(Date.now() - 4 * 60_000).toISOString();
const extraEnd = new Date(Date.now() - 3 * 60_000).toISOString();
const extraContext = await activate({ device: `OA-${stamp}-C`, location: codeC, session: extraSession, start: extraStart, credential: credentialC });
const extraEvidence = JSON.parse(await sql(`select public.tool_commit_cleaning_workflow_authoritative(${q(extraSession)},${q(`${extraSession}-complete`)},${q(`OA-${stamp}-C`)},${q(codeC)},${q(extraStart)},${q(extraEnd)},'{}'::jsonb,${q(JSON.stringify([{ client_event_id: `${extraSession}-event`, event_type: "scan_finish", result: "ok", notes: null, scanned_at: extraEnd, payload_json: { ...entryEvidence, injected: true }, injected: true }]))}::jsonb,'provenance-extra',${q(extraContext.context_id)},${q(extraContext.submission_proof)},${q(credentialC)},${q(execSecret)})::text;`));
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
