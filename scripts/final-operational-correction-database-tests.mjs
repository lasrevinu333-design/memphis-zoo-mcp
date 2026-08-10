#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.CUSTODIAL_FINAL_OPERATIONAL_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.CUSTODIAL_FINAL_OPERATIONAL_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("An owned disposable schema-rebuild database is required.");
}

const secret = "final-operational-correction-secret-012345678901234567890";
const stamp = Date.now().toString(36);
const managerA = randomUUID();
const managerB = randomUUID();
function q(value) { return `'${String(value ?? "").replaceAll("'", "''")}'`; }
async function sql(statement, { expectFailure = false } = {}) {
  try {
    const result = await execFileAsync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", statement], { maxBuffer: 16 * 1024 * 1024 });
    if (expectFailure) assert.fail(`Expected SQL failure: ${statement}`);
    return result.stdout.trim().split("\n").map((line) => line.trim()).filter(Boolean).reverse().find((line) => !/^(INSERT|UPDATE|DELETE|SELECT|SET|BEGIN|COMMIT)\b/.test(line)) || "";
  } catch (error) {
    if (!expectFailure) throw error;
    return String(error.stderr || error.message);
  }
}
async function json(statement) { return JSON.parse(await sql(statement)); }
async function claim(worker, limit = 50) {
  return json(`select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb)::text from public.custodial_claim_offline_reconciliation_notifications(${q(worker)},${limit},15,${q(secret)}) n;`);
}
async function finish(notification, worker, { succeeded, terminal = false, error = null, delivery = {} }) {
  return json(`select public.custodial_finish_offline_reconciliation_notification(${q(notification.outbox_id)}::uuid,${q(worker)},${q(notification.lease_token)}::uuid,${succeeded},${q(error)},15,${terminal},${q(JSON.stringify(delivery))}::jsonb,${q(secret)})::text;`);
}
async function forceExpiry(outboxId, { recipients = false } = {}) {
  await sql(`begin; select public.custodial_require_backend_execution_secret(${q(secret)}); update public.custodial_offline_reconciliation_outbox set lease_expires_at=now()-interval '1 second' where outbox_id=${q(outboxId)}::uuid; ${recipients ? `update public.custodial_offline_reconciliation_delivery_recipients set lease_expires_at=now()-interval '1 second' where outbox_id=${q(outboxId)}::uuid;` : ""} commit;`);
}
async function makeOutbox(label) {
  const reconciliationId = await sql(`insert into public.custodial_offline_reconciliation_records(client_session_id,client_completion_id,payload_fingerprint,payload_json,state,quarantine_reason,result_json) values (${q(`final-${stamp}-${label}-session`)},${q(`final-${stamp}-${label}-completion`)},${q(createHash("sha256").update(`${stamp}:${label}`).digest("hex"))},'{}'::jsonb,'quarantined',${q(`final operational ${label}`)},jsonb_build_object('status','quarantined','terminal',true)) returning reconciliation_id::text;`);
  const outboxId = await sql(`insert into public.custodial_offline_reconciliation_outbox(reconciliation_id,notification_key,notification_kind,payload_json,next_attempt_at) values (${q(reconciliationId)}::uuid,${q(`final-operational:${stamp}:${label}`)},'offline_reconciliation_quarantine',jsonb_build_object('reconciliation_id',${q(reconciliationId)},'reason',${q(`final operational ${label}`)}),now()) returning outbox_id::text;`);
  return { reconciliationId, outboxId };
}

await sql(`select public.custodial_configure_backend_execution_key(encode(extensions.digest(convert_to(${q(secret)},'UTF8'),'sha256'),'hex'),'final-operational-correction-test');
  insert into public.ops_manager_managers(manager_id,display_name,roles,active) values
    (${q(managerA)}::uuid,${q(`Final Operational Manager A ${stamp}`)},array['OPS_MANAGER','DIRECTOR']::text[],true),
    (${q(managerB)}::uuid,${q(`Final Operational Manager B ${stamp}`)},array['OPS_MANAGER']::text[],true);`);
const userA = await sql(`select id::text from public.msg_ensure_ops_manager_user(${q(managerA)}::uuid);`);
const userB = await sql(`select id::text from public.msg_ensure_ops_manager_user(${q(managerB)}::uuid);`);
let memphisUser = await sql(`select coalesce(public.msg_get_memphis_user_id()::text,'');`);
if (!memphisUser) memphisUser = await sql(`insert into public.msg_users(display_name,role,is_active) values ('Memphis','bot',true) returning id::text;`);

// Attempts 1-4 reclaim and retry. The fifth expired lease terminalizes before
// the next batch selects candidates, so an unrelated row still progresses.
const exhausted = await makeOutbox("lease-exhausted");
for (let attempt = 1; attempt <= 5; attempt += 1) {
  const rows = await claim(`final-lease-worker-${attempt}`);
  const row = rows.find((item) => item.outbox_id === exhausted.outboxId);
  assert.ok(row, `attempt ${attempt} claims the exhausted-row fixture`);
  assert.equal(Number(row.attempts), attempt, `claim ${attempt} remains within the bounded attempt ceiling`);
  await forceExpiry(exhausted.outboxId);
}
const progress = await makeOutbox("batch-progress");
const recoveryBatch = await claim("final-lease-worker-recovery");
assert.ok(recoveryBatch.some((item) => item.outbox_id === progress.outboxId), "an exhausted row does not abort or wedge later claim-batch progress");
assert.ok(!recoveryBatch.some((item) => item.outbox_id === exhausted.outboxId), "the exhausted row is terminalized rather than claimed a sixth time");
assert.equal(await sql(`select state || '|' || attempts::text || '|' || (failed_at is not null)::text || '|' || left(last_error,60) from public.custodial_offline_reconciliation_outbox where outbox_id=${q(exhausted.outboxId)}::uuid;`), "failed|5|true|notification delivery lease expired after maximum attempts", "fifth expired lease records terminal failure evidence");
assert.equal(await sql(`select count(*) from public.custodial_offline_reconciliation_delivery_events where outbox_id=${q(exhausted.outboxId)}::uuid and event_type='outbox_lease_reclaimed';`), "4", "attempts one through four have durable reclaim evidence");

// A direct terminal failure is visible in both named-manager list and detail
// with stable state, bounded error, timestamps, and disposition linkage field.
const visibleFailure = await makeOutbox("manager-visible-failure");
const visibleClaim = (await claim("final-manager-visible-worker")).find((item) => item.outbox_id === visibleFailure.outboxId);
assert.ok(visibleClaim, "manager visibility fixture is claimed");
const visibleFinished = await finish(visibleClaim, "final-manager-visible-worker", { succeeded: false, terminal: true, error: "named manager recipient is unavailable" });
assert.equal(visibleFinished.state, "failed");
const managerList = await json(`select public.custodial_manager_list_offline_reconciliations(${q(managerA)}::uuid,100,null,${q(secret)})::text;`);
const listRecord = managerList.find((item) => item.reconciliation_id === visibleFailure.reconciliationId);
assert.equal(listRecord.notifications[0].state, "failed", "manager list exposes terminal notification state");
assert.equal(listRecord.notifications[0].status_label, "Delivery unavailable");
assert.equal(listRecord.notifications[0].attempts, 1);
assert.ok(listRecord.notifications[0].failed_at);
assert.match(listRecord.notifications[0].last_error, /unavailable/i);
const managerDetail = await json(`select public.custodial_manager_get_offline_reconciliation(${q(managerA)}::uuid,${q(visibleFailure.reconciliationId)}::uuid,${q(secret)})::text;`);
assert.equal(managerDetail.notifications[0].state, "failed", "manager detail exposes terminal notification state");
assert.ok(Object.hasOwn(managerDetail.notifications[0], "disposition_id"), "manager detail preserves disposition linkage even when none exists");
assert.ok(Array.isArray(managerDetail.notifications[0].events), "manager detail exposes durable notice evidence without backend-only jargon");

// Crash after the first recipient send: the outer and recipient leases expire,
// a restart obtains new claims, and the same immutable per-recipient key makes
// Messenger return the original row instead of emitting a duplicate.
const messenger = await makeOutbox("recipient-idempotency");
const firstOuter = (await claim("final-messenger-before-crash")).find((item) => item.outbox_id === messenger.outboxId);
assert.ok(firstOuter, "Messenger fixture outer notification is claimed");
const recipientInput = [{ manager_id: managerA, user_id: userA }, { manager_id: managerB, user_id: userB }];
const firstRecipients = await json(`select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb)::text from public.custodial_claim_offline_reconciliation_notification_recipients(${q(messenger.outboxId)}::uuid,'final-messenger-before-crash',${q(firstOuter.lease_token)}::uuid,${q(JSON.stringify(recipientInput))}::jsonb,${q(secret)}) r;`);
assert.equal(firstRecipients.length, 2, "the immutable recipient snapshot has two named managers");
const firstA = firstRecipients.find((item) => item.recipient_user_id === userA);
const threadA = await json(`select row_to_json(t)::text from public.msg_get_or_create_direct_thread(${q(memphisUser)}::uuid,${q(userA)}::uuid) t;`);
const firstMessage = await json(`select row_to_json(m)::text from public.msg_send_message(${q(threadA.id)}::uuid,${q(memphisUser)}::uuid,'Final operational correction recipient test','bot_response',jsonb_build_object('channel','offline_reconciliation_recovery','client_message_id',${q(firstA.client_message_id)},'notification_instance_key',${q(firstA.notification_instance_key)})) m;`);
await forceExpiry(messenger.outboxId, { recipients: true });
const restartOuter = (await claim("final-messenger-after-restart")).find((item) => item.outbox_id === messenger.outboxId);
assert.ok(restartOuter && Number(restartOuter.attempts) === 2, "restart reclaims the expired notification with a new outer lease");
const restartedRecipients = await json(`select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb)::text from public.custodial_claim_offline_reconciliation_notification_recipients(${q(messenger.outboxId)}::uuid,'final-messenger-after-restart',${q(restartOuter.lease_token)}::uuid,${q(JSON.stringify(recipientInput))}::jsonb,${q(secret)}) r;`);
const restartA = restartedRecipients.find((item) => item.recipient_user_id === userA);
const restartB = restartedRecipients.find((item) => item.recipient_user_id === userB);
assert.ok(restartA && restartB, "restart reclaims only the original immutable recipient snapshot");
const replayMessage = await json(`select row_to_json(m)::text from public.msg_send_message(${q(threadA.id)}::uuid,${q(memphisUser)}::uuid,'Final operational correction recipient test','bot_response',jsonb_build_object('channel','offline_reconciliation_recovery','client_message_id',${q(restartA.client_message_id)},'notification_instance_key',${q(restartA.notification_instance_key)})) m;`);
assert.equal(replayMessage.id, firstMessage.id, "stable per-recipient key reuses the message after crash/restart");
assert.equal(await sql(`select count(*) from public.msg_messages where client_message_id=${q(firstA.client_message_id)};`), "1", "crash recovery creates zero duplicate Messenger rows");
const recipientDelivered = await json(`select public.custodial_finish_offline_reconciliation_notification_recipient(${q(restartA.delivery_recipient_id)}::uuid,'final-messenger-after-restart',${q(restartA.lease_token)}::uuid,true,${q(replayMessage.id)}::uuid,null,15,false,jsonb_build_object('channel','messenger'),${q(secret)})::text;`);
assert.equal(recipientDelivered.state, "delivered");
const recipientFailed = await json(`select public.custodial_finish_offline_reconciliation_notification_recipient(${q(restartB.delivery_recipient_id)}::uuid,'final-messenger-after-restart',${q(restartB.lease_token)}::uuid,false,null,'recipient permanently unavailable',15,true,jsonb_build_object('channel','messenger'),${q(secret)})::text;`);
assert.equal(recipientFailed.state, "failed", "mixed-recipient terminal failure is persisted per recipient");
const messengerFinished = await finish(restartOuter, "final-messenger-after-restart", { succeeded: false, terminal: true, error: "one recipient unavailable", delivery: { channel: "messenger", crash_recovered: true } });
assert.equal(messengerFinished.state, "failed", "partial recipient failure terminalizes the aggregate notice without resending delivered recipients");
const messengerDetail = await json(`select public.custodial_manager_get_offline_reconciliation(${q(managerA)}::uuid,${q(messenger.reconciliationId)}::uuid,${q(secret)})::text;`);
const recipientStates = messengerDetail.notifications[0].recipients.map((recipient) => recipient.state).sort();
assert.deepEqual(recipientStates, ["delivered", "failed"], "manager detail exposes delivered and unavailable recipient evidence");
assert.equal(messengerDetail.notifications[0].recipients.find((recipient) => recipient.state === "delivered").message_id, firstMessage.id);

console.log("FINAL_OPERATIONAL_CORRECTION_DATABASE_PASS");
