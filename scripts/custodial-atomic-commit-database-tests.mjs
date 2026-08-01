#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.CUSTODIAL_ATOMIC_COMMIT_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.CUSTODIAL_ATOMIC_COMMIT_TEST_DATABASE || "postgres").trim();

if (
  !/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)
  || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)
) {
  throw new Error("A disposable schema-rebuild database is required.");
}

const employeeId = "00000000-0000-4000-8000-00000000f601";
const deviceId = "00000000-0000-4000-8000-00000000f602";
const locationId = "00000000-0000-4000-8000-00000000f603";
const clientSessionId = "atomic-offline-test-session-f604";
const clientCompletionId = "atomic-offline-test-completion-f605";
const clientEventId = "atomic-offline-test-event-f606";

const sql = `
begin;

insert into public.employees(id, employee_code, display_name, active, role, notes)
values (
  '${employeeId}'::uuid,
  'ATOMIC_FLEET_TEST',
  'Atomic Fleet Test Employee',
  true,
  'staff',
  'Disposable database acceptance fixture'
)
on conflict(id) do update
set display_name = excluded.display_name,
    active = true,
    updated_at = now();

insert into public.locations(
  id, location_code, location_name, location_type, active, form_type, notes
)
values (
  '${locationId}'::uuid,
  'ATOMIC_FLEET_TEST',
  'Atomic Fleet Test Location',
  'restroom',
  true,
  'restroom',
  'Disposable database acceptance fixture'
)
on conflict(id) do update
set location_name = excluded.location_name,
    active = true,
    updated_at = now();

insert into public.devices(id, device_id, device_name, active, assigned_employee_id, notes)
values (
  '${deviceId}'::uuid,
  'KIOSK_ATOMIC_FLEET_TEST',
  'Atomic Fleet Test Employee',
  true,
  '${employeeId}'::uuid,
  'Disposable database acceptance fixture'
)
on conflict(id) do update
set device_name = excluded.device_name,
    active = true,
    assigned_employee_id = excluded.assigned_employee_id,
    updated_at = now();

do $acceptance$
declare
  v_first jsonb;
  v_replay jsonb;
  v_session_id uuid;
  v_completion_id uuid;
  v_count bigint;
begin
  select public.tool_commit_cleaning_workflow(
    '${clientSessionId}',
    '${clientCompletionId}',
    'KIOSK_ATOMIC_FLEET_TEST',
    'ATOMIC_FLEET_TEST',
    now() - interval '5 minutes',
    now() - interval '1 minute',
    '{}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'event_type', 'scan_finish',
      'client_event_id', '${clientEventId}',
      'scanned_at', (now() - interval '1 minute')::text,
      'result', 'ok'
    )),
    'atomic-offline-first-commit'
  ) into v_first;

  if v_first->>'status' <> 'closed' then
    raise exception 'first commit did not close the session: %', v_first;
  end if;
  if (v_first->>'session_created_during_commit')::boolean is not true then
    raise exception 'first offline commit did not create its missing session: %', v_first;
  end if;
  if (v_first->>'replayed')::boolean is not false then
    raise exception 'first commit was incorrectly reported as replayed: %', v_first;
  end if;
  if v_first->>'location_code' <> 'ATOMIC_FLEET_TEST'
     or v_first->>'device_id' <> 'KIOSK_ATOMIC_FLEET_TEST'
     or v_first->>'employee_name' <> 'Atomic Fleet Test Employee' then
    raise exception 'first commit lost resolved identity: %', v_first;
  end if;

  select s.id into strict v_session_id
  from public.sessions s
  where s.client_session_id = '${clientSessionId}'
    and s.location_id = '${locationId}'::uuid
    and s.device_id = '${deviceId}'::uuid
    and s.employee_id = '${employeeId}'::uuid
    and s.status = 'closed'
    and s.completion_source = 'kiosk_form';

  select cr.id into strict v_completion_id
  from public.completion_responses cr
  where cr.session_id = v_session_id
    and cr.client_completion_id = '${clientCompletionId}'
    and cr.location_id = '${locationId}'::uuid
    and cr.device_id = '${deviceId}'::uuid
    and cr.submitted_by_employee_id = '${employeeId}'::uuid;

  select public.tool_commit_cleaning_workflow(
    '${clientSessionId}',
    '${clientCompletionId}',
    'KIOSK_ATOMIC_FLEET_TEST',
    'ATOMIC_FLEET_TEST',
    now() - interval '5 minutes',
    now() - interval '1 minute',
    '{}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'event_type', 'scan_finish',
      'client_event_id', '${clientEventId}',
      'scanned_at', (now() - interval '1 minute')::text,
      'result', 'ok'
    )),
    'atomic-offline-idempotent-replay'
  ) into v_replay;

  if (v_replay->>'replayed')::boolean is not true then
    raise exception 'retry was not reported as an idempotent replay: %', v_replay;
  end if;
  if (v_replay->>'completion_response_id')::uuid <> v_completion_id then
    raise exception 'replay returned a different completion: first %, replay %', v_completion_id, v_replay;
  end if;

  select count(*) into v_count
  from public.sessions
  where client_session_id = '${clientSessionId}';
  if v_count <> 1 then raise exception 'expected one logical session, found %', v_count; end if;

  select count(*) into v_count
  from public.completion_responses
  where client_completion_id = '${clientCompletionId}';
  if v_count <> 1 then raise exception 'expected one logical completion, found %', v_count; end if;

  select count(*) into v_count
  from public.scan_events
  where client_event_id = '${clientEventId}';
  if v_count <> 1 then raise exception 'expected one scan event, found %', v_count; end if;

  select count(*) into v_count
  from public.session_events
  where session_id = v_session_id
    and event_type = 'session_completed';
  if v_count <> 1 then raise exception 'expected one completion event, found %', v_count; end if;

  if has_function_privilege(
    'public',
    'public.commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'atomic commit function is exposed to an application role';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'service_role cannot execute atomic commit function';
  end if;
end
$acceptance$;

rollback;
`;

async function runSql(statement) {
  return execFileAsync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-U",
      "supabase_admin",
      "-d",
      database,
      "-c",
      statement,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
}

const sequential = await runSql(sql);
assert.match(sequential.stdout, /DO/);
assert.match(sequential.stdout, /ROLLBACK/);
assert.equal(sequential.stderr.trim(), "");

const concurrentEmployeeId = "00000000-0000-4000-8000-00000000f611";
const concurrentDeviceId = "00000000-0000-4000-8000-00000000f612";
const concurrentLocationId = "00000000-0000-4000-8000-00000000f613";
const concurrentSessionId = "atomic-concurrent-session-f614";
const concurrentCompletionId = "atomic-concurrent-completion-f615";
const concurrentEventId = "atomic-concurrent-event-f616";
const preexistingSessionId = "atomic-preexisting-session-f619";
const preexistingCompletionId = "atomic-preexisting-completion-f620";

const setup = `
begin;
insert into public.employees(id,employee_code,display_name,active,role,notes)
values('${concurrentEmployeeId}'::uuid,'ATOMIC_CONCURRENT_TEST','Atomic Concurrent Test Employee',true,'staff','Disposable concurrency fixture');
insert into public.locations(id,location_code,location_name,location_type,active,form_type,notes)
values('${concurrentLocationId}'::uuid,'ATOMIC_CONCURRENT_TEST','Atomic Concurrent Test Location','restroom',true,'restroom','Disposable concurrency fixture');
insert into public.devices(id,device_id,device_name,active,assigned_employee_id,notes)
values('${concurrentDeviceId}'::uuid,'KIOSK_ATOMIC_CONCURRENT_TEST','Atomic Concurrent Test Employee',true,'${concurrentEmployeeId}'::uuid,'Disposable concurrency fixture');
commit;
`;

const cleanup = `
begin;
delete from public.maintenance_tickets where session_id in (select id from public.sessions where device_id='${concurrentDeviceId}'::uuid);
delete from public.scan_events where device_id='${concurrentDeviceId}'::uuid;
delete from public.session_events where session_id in (select id from public.sessions where device_id='${concurrentDeviceId}'::uuid);
delete from public.completion_responses where device_id='${concurrentDeviceId}'::uuid;
delete from public.system_logs where device_id='${concurrentDeviceId}'::uuid;
delete from public.sessions where device_id='${concurrentDeviceId}'::uuid;
delete from public.device_sync_status where device_id='${concurrentDeviceId}'::uuid;
delete from public.devices where id='${concurrentDeviceId}'::uuid;
delete from public.locations where id='${concurrentLocationId}'::uuid;
delete from public.employees where id='${concurrentEmployeeId}'::uuid;
commit;
`;

const concurrentCall = `select public.tool_commit_cleaning_workflow(
  '${concurrentSessionId}',
  '${concurrentCompletionId}',
  'KIOSK_ATOMIC_CONCURRENT_TEST',
  'ATOMIC_CONCURRENT_TEST',
  now()-interval '5 minutes',
  now()-interval '1 minute',
  '{}'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'event_type','scan_finish',
    'client_event_id','${concurrentEventId}',
    'scanned_at',(now()-interval '1 minute')::text,
    'result','ok'
  )),
  'atomic-concurrent-acceptance'
)::text;`;

try {
  await runSql(setup);
  const concurrentResults = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const result = await runSql(concurrentCall);
      assert.equal(result.stderr.trim(), "");
      return JSON.parse(result.stdout.trim().split("\n").at(-1));
    }),
  );
  assert.equal(concurrentResults.filter((result) => result.replayed === false).length, 1);
  assert.equal(concurrentResults.filter((result) => result.replayed === true).length, 9);
  assert.equal(new Set(concurrentResults.map((result) => result.session_uuid)).size, 1);
  assert.equal(new Set(concurrentResults.map((result) => result.completion_response_id)).size, 1);

  const counts = await runSql(`select jsonb_build_object(
    'sessions',(select count(*) from public.sessions where client_session_id='${concurrentSessionId}'),
    'completions',(select count(*) from public.completion_responses where client_completion_id='${concurrentCompletionId}'),
    'scan_events',(select count(*) from public.scan_events where client_event_id='${concurrentEventId}'),
    'completion_events',(select count(*) from public.session_events se join public.sessions s on s.id=se.session_id where s.client_session_id='${concurrentSessionId}' and se.event_type='session_completed')
  )::text;`);
  assert.deepEqual(JSON.parse(counts.stdout.trim()), {
    sessions: 1,
    completions: 1,
    scan_events: 1,
    completion_events: 1,
  });

  await assert.rejects(
    runSql(concurrentCall.replace(concurrentCompletionId, "atomic-mismatched-completion-f617")),
    /client_session_id is already completed with another client_completion_id/,
  );
  await assert.rejects(
    runSql(concurrentCall.replace(concurrentSessionId, "atomic-mismatched-session-f618")),
    /client_completion_id is already bound to another client_session_id/,
  );

  await runSql(`insert into public.sessions(
    session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at
  ) values(
    gen_random_uuid()::text,
    '${preexistingSessionId}',
    '${concurrentLocationId}'::uuid,
    '${concurrentEmployeeId}'::uuid,
    '${concurrentDeviceId}'::uuid,
    'active',
    now()-interval '5 minutes'
  );`);
  const preexisting = await runSql(`select public.tool_commit_cleaning_workflow(
    '${preexistingSessionId}',
    '${preexistingCompletionId}',
    'KIOSK_ATOMIC_CONCURRENT_TEST',
    'ATOMIC_CONCURRENT_TEST',
    now()-interval '5 minutes',
    now()-interval '1 minute',
    '{}'::jsonb,
    '[]'::jsonb,
    'atomic-preexisting-session-acceptance'
  )::text;`);
  const preexistingResult = JSON.parse(preexisting.stdout.trim());
  assert.equal(preexistingResult.status, "closed");
  assert.equal(preexistingResult.session_created_during_commit, false);
  assert.equal(preexistingResult.replayed, false);
} finally {
  await runSql(cleanup);
}

console.log("CUSTODIAL_ATOMIC_COMMIT_DATABASE_PASS");
