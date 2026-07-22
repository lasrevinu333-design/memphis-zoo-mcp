#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const container = String(process.env.EVENT_INTEGRITY_TEST_DOCKER_CONTAINER || '').trim();
const database = String(process.env.EVENT_INTEGRITY_TEST_DATABASE || 'postgres').trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error('A disposable schema-rebuild database is required.');
}

async function sql(statement) {
  const { stdout } = await execFileAsync('docker', [
    'exec', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-At',
    '-U', 'supabase_admin', '-d', database, '-c', statement,
  ], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

const eventId = '00000000-0000-4000-8000-00000000e901';
const employeeId = '00000000-0000-4000-8000-00000000e902';
const userId = '00000000-0000-4000-8000-00000000e903';
const groupId = '00000000-0000-4000-8000-00000000e904';

const constraint = await sql(`select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.events_app_notification_log'::regclass and conname='events_app_notification_log_kind_check';`);
assert.match(constraint, /event_reminder/, 'database constraint must accept the worker canonical kind');

const retentionDefinition = await sql(`select pg_get_functiondef('public.mz_apply_free_tier_retention(timestamptz)'::regprocedure);`);
assert.match(retentionDefinition, /'disabled', true|disabled.*true/is, 'legacy retention function must be a compatibility no-op');
assert.doesNotMatch(retentionDefinition, /delete\s+from\s+public\.events_app_events/i, 'retention must not delete event parents');
assert.doesNotMatch(retentionDefinition, /delete\s+from\s+public\.events_app_event_history/i, 'retention must not delete event history');

await sql(`
  insert into public.location_groups(id,group_code,group_name,active,eligible_custodial_coverage,eligible_staffing_assignment)
  values ('${groupId}'::uuid,'EVENT_INTEGRITY_TEST_GROUP','Event Integrity Test Group',true,true,true)
  on conflict(id) do update set active=true;

  insert into public.employees(id,employee_code,display_name,active,role,notes)
  values ('${employeeId}'::uuid,'EMP999998','Event Integrity Test Employee',true,'staff','disposable database acceptance')
  on conflict(id) do update set active=true;

  insert into public.msg_users(id,employee_id,display_name,role,is_active,active)
  values ('${userId}'::uuid,'${employeeId}'::uuid,'Event Integrity Test Employee','employee',true,true)
  on conflict(id) do update set is_active=true,active=true;

  insert into public.events_app_events(
    id,event_name,location_group_id,event_date,end_date,start_time,end_time,
    attendee_count,notes,created_by,status,event_scope,coverage_location_ids
  ) values (
    '${eventId}'::uuid,'Event Integrity Database Acceptance','${groupId}'::uuid,
    date '2030-01-02',date '2030-01-02',time '10:00',time '11:00',10,
    'Database acceptance event','database-test','SCHEDULED','SINGLE_VENUE',array['${groupId}'::uuid]
  )
  on conflict(id) do update set status='SCHEDULED';

  insert into public.events_app_event_history(event_id,action,actor,reason,previous_record,new_record)
  values ('${eventId}'::uuid,'create','database-test','history preservation acceptance',null,jsonb_build_object('id','${eventId}'))
  on conflict do nothing;
`);

const firstClaim = JSON.parse(await sql(`select public.claim_event_notification('${eventId}'::uuid,'${employeeId}'::uuid,'${userId}'::uuid,'event_reminder','2030-01-02 07:15')::text;`));
assert.equal(firstClaim.claimed, true, 'canonical event reminder must be claimable');
assert.equal(firstClaim.notification_kind, 'event_reminder');

const secondClaim = JSON.parse(await sql(`select public.claim_event_notification('${eventId}'::uuid,'${employeeId}'::uuid,'${userId}'::uuid,'event_reminder','2030-01-02 07:15')::text;`));
assert.equal(secondClaim.claimed, false, 'same event and employee must not be claimed twice');
assert.equal(await sql(`select count(*) from public.events_app_notification_log where event_id='${eventId}'::uuid and employee_id='${employeeId}'::uuid and notification_kind='event_reminder';`), '1');

const retention = JSON.parse(await sql(`select public.mz_apply_free_tier_retention('2031-01-01T00:00:00Z'::timestamptz)::text;`));
assert.equal(retention.ok, true);
assert.equal(retention.disabled, true);
assert.equal(retention.deleted_events, 0);
assert.equal(await sql(`select count(*) from public.events_app_events where id='${eventId}'::uuid;`), '1', 'retention compatibility call must preserve event');
assert.equal(await sql(`select count(*) from public.events_app_event_history where event_id='${eventId}'::uuid;`), '1', 'retention compatibility call must preserve audit history');

console.log('EVENT_NOTIFICATION_RETENTION_DATABASE_PASS');
