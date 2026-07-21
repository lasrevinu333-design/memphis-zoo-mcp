#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.OPERATIONS_LEADERSHIP_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.OPERATIONS_LEADERSHIP_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("A disposable schema-rebuild database is required.");
}

async function sql(statement) {
  const { stdout } = await execFileAsync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", statement], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}
async function json(statement) {
  const output = await sql(`select (${statement})::text;`);
  return JSON.parse(output.split("\n").at(-1));
}

const canonicalFilter = `metadata_json @> '{"canonical_leadership_roster":true}'::jsonb`;
const roster = await json(`(
  select jsonb_agg(jsonb_build_object(
    'display_name',display_name,
    'job_title',job_title,
    'department_key',department_key,
    'roles',roles,
    'system_key',system_key,
    'metadata_json',metadata_json
  ) order by leadership_sort_order,display_name)
  from public.ops_manager_managers
  where active=true and revoked_at is null and is_system_principal=false
    and ${canonicalFilter}
)`);
assert.deepEqual(roster.map((row) => row.display_name), [
  "Jennifer Sheffield",
  "Annie Feist",
  "Brandy Gull",
  "Haley Lejman",
  "Eric McKenney",
  "Eric Operle",
]);
assert.deepEqual(roster.map((row) => row.job_title), [
  "Director of Operations",
  "Operations Admin",
  "Horticulture Manager",
  "Water Quality Manager",
  "Facilities Maintenance Manager",
  "Custodial Manager",
]);
assert.deepEqual(roster.find((row) => row.display_name === "Jennifer Sheffield").roles, ["DIRECTOR"], "Jennifer must not be stored as an Ops Manager");
assert.equal(roster.find((row) => row.display_name === "Annie Feist").system_key, "annie_feist_operations_admin");
assert.equal(roster.find((row) => row.display_name === "Annie Feist").metadata_json.moxie_access, true);
assert.ok(roster.find((row) => row.display_name === "Eric Operle").roles.includes("CUSTODIAL_MANAGER"));
assert.ok(roster.find((row) => row.display_name === "Eric Operle").roles.includes("SECURITY_ADMIN"));

assert.equal(await sql("select count(*) from public.ops_manager_managers where system_key='shared_ops_manager' and active=true and revoked_at is null;"), "0");
assert.equal(await sql("select count(*) from public.ops_manager_shared_enrollment_windows where status='active' and disabled_at is null and expires_at>now();"), "0");
assert.equal(await sql("select count(*) from public.ops_manager_trusted_devices d join public.ops_manager_managers m on m.manager_id=d.manager_id where m.system_key='shared_ops_manager' and d.revoked_at is null;"), "0");

const thread = await json(`(
  select jsonb_build_object(
    'title',t.title,
    'system_key',t.system_key,
    'canonical_participants',(
      select count(*) from public.msg_thread_participants p
      join public.msg_users u on u.id=p.user_id
      join public.ops_manager_managers m on m.manager_id=u.ops_manager_id
      where p.thread_id=t.id and p.left_at is null and u.is_active=true
        and m.active=true and m.revoked_at is null and m.is_system_principal=false
        and m.metadata_json @> '{"canonical_leadership_roster":true}'::jsonb
    )
  )
  from public.msg_threads t
  where t.system_key='ops_manager_shared_chat_v1'
  limit 1
)`);
assert.equal(thread.title, "Operations Leadership Chat");
assert.equal(Number(thread.canonical_participants), 6);
assert.equal(await sql("select count(*) from public.msg_users u join public.ops_manager_managers m on m.manager_id=u.ops_manager_id where m.active=true and m.revoked_at is null and m.is_system_principal=false and m.metadata_json @> '{\"canonical_leadership_roster\":true}'::jsonb and u.is_active=true;"), "6");
assert.equal(await sql("select count(*) from public.msg_users where display_name='Legacy Shared Ops Manager' and is_active=false;"), "1");

const publicSnapshot = await json("public.public_viewer_dashboard_snapshot()");
for (const forbidden of ["employee", "device", "notes", "ticket", "feedback"]) {
  assert.equal(Object.keys(publicSnapshot).some((key) => key.toLowerCase().includes(forbidden)), false, `public snapshot leaked ${forbidden}`);
}
assert.ok(Object.hasOwn(publicSnapshot, "locations_total"));
assert.ok(Object.hasOwn(publicSnapshot, "cleanings_completed_today"));

const annieId = await sql("select manager_id from public.ops_manager_managers where system_key='annie_feist_operations_admin';");
assert.match(annieId, /^[0-9a-f-]{36}$/i);
const codeId = randomUUID();
const credentialId = randomUUID();
await sql(`insert into public.ops_manager_enrollment_codes(id,manager_id,code_hash,role_snapshot,expires_at,max_attempts,metadata_json) values ('${codeId}'::uuid,'${annieId}'::uuid,'${"b".repeat(64)}','OPS_MANAGER',now()+interval '15 minutes',5,'{"database_acceptance":true}'::jsonb);`);
const consumed = await json(`public.ops_manager_consume_enrollment_code('${"b".repeat(64)}','${credentialId}'::uuid,'annie-android-acceptance','Annie Personal Android','${"c".repeat(64)}',null,null,'Android app',now()+interval '1 day','{"database_acceptance":true}'::jsonb)`);
assert.equal(consumed.ok, true);
assert.equal(consumed.manager.display_name, "Annie Feist");
assert.equal(consumed.trusted_device.manager_id, annieId);
assert.equal(await sql(`select manager_id::text from public.ops_manager_trusted_devices where credential_id='${credentialId}'::uuid;`), annieId);
assert.equal(await sql(`select status from public.ops_manager_enrollment_codes where id='${codeId}'::uuid;`), "used");


await sql(`insert into public.ops_manager_notification_preferences(credential_id,manager_id)
  values ('${credentialId}'::uuid,'${annieId}'::uuid);`);
const notificationDefaults = await json(`(
  select jsonb_build_object(
    'messages_enabled',messages_enabled,
    'event_reminders_enabled',event_reminders_enabled,
    'due_soon_enabled',due_soon_enabled,
    'overdue_enabled',overdue_enabled
  )
  from public.ops_manager_notification_preferences
  where credential_id='${credentialId}'::uuid
)`);
assert.deepEqual(notificationDefaults, {
  messages_enabled: true,
  event_reminders_enabled: false,
  due_soon_enabled: false,
  overdue_enabled: false,
});
await sql(`insert into public.ops_manager_push_devices(credential_id,manager_id,device_id,platform,fcm_token)
  values ('${credentialId}'::uuid,'${annieId}'::uuid,'annie-android-acceptance','android','${"fcm-test-token-" + "x".repeat(40)}');`);
const ericId = await sql("select manager_id from public.ops_manager_managers where system_key='eric_custodial_manager';");
const leadershipThreadId = await sql("select id from public.msg_threads where system_key='ops_manager_shared_chat_v1';");
const notificationMessageId = await sql(`select (public.msg_send_message_as_ops_manager('${ericId}'::uuid,'${leadershipThreadId}'::uuid,'Named manager push acceptance','text','{}'::jsonb,'db-notification-acceptance')).id;`);
assert.match(notificationMessageId, /^[0-9a-f-]{36}$/i);
assert.equal(await sql(`select u.display_name from public.msg_messages m join public.msg_users u on u.id=m.sender_user_id where m.id='${notificationMessageId}'::uuid;`), "Eric Operle");
assert.equal(await sql(`select count(*) from public.ops_manager_notification_queue where source_id='${notificationMessageId}'::uuid and credential_id='${credentialId}'::uuid and notification_type='message';`), "1");
await sql("select public.ops_manager_enqueue_scheduled_notifications(now());");
assert.equal(await sql(`select count(*) from public.ops_manager_notification_queue where credential_id='${credentialId}'::uuid and notification_type in ('event_digest','location_digest');`), "0");

console.log("OPERATIONS_LEADERSHIP_MOBILE_DATABASE_PASS");
