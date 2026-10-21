import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const container = String(process.env.EVENT_CAS_TEST_CONTAINER || '');
if (!/^mz_schema_rebuild_[A-Za-z0-9_]+$/.test(container)) {
  throw new Error('EVENT_CAS_TEST_CONTAINER must name an owned disposable schema-rebuild container.');
}

function sql(statement) {
  return new Promise((resolve) => {
    const process = spawn('docker', ['exec', container, 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1',
      '-U', 'supabase_admin', '-d', 'postgres', '-c', statement]);
    let stdout = '';
    let stderr = '';
    process.stdout.on('data', (chunk) => { stdout += chunk; });
    process.stderr.on('data', (chunk) => { stderr += chunk; });
    process.on('close', (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}
async function ok(statement) {
  const result = await sql(statement);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const managerId = '00000000-0000-4000-8000-000000000001';
const eventId = await ok("select id from public.events_app_events order by created_at,id limit 1");
assert.match(eventId, /^[0-9a-f-]{36}$/);
const revision = Number(await ok(`select revision from public.events_app_events where id='${eventId}'::uuid`));
const historyBefore = Number(await ok(`select count(*) from public.events_app_event_history where event_id='${eventId}'::uuid`));
const record = (expected, name) => `to_jsonb(e)||jsonb_build_object('actor_manager_id','${managerId}',` +
  `'expected_revision',${expected},'event_name','${name}')`;
const update = (expected, name) => `select (public.app_apply_event_update_cas(e.id,${record(expected, name)},null,'CAS fixture')->>'revision')` +
  ` from public.events_app_events e where e.id='${eventId}'::uuid`;

assert.equal(await ok("select has_function_privilege('service_role','public.app_apply_event_update_cas(uuid,jsonb,text,text)','EXECUTE')"), 't');
for (const role of ['anon', 'authenticated']) {
  assert.equal(await ok(`select has_function_privilege('${role}','public.app_apply_event_update_cas(uuid,jsonb,text,text)','EXECUTE')`), 'f');
}
assert.equal(await ok("select count(*) from pg_catalog.aclexplode((select proacl from pg_catalog.pg_proc where oid='public.app_apply_event_update_cas(uuid,jsonb,text,text)'::regprocedure)) where grantee=0"), '0');
const denied = await sql(`begin; set local role authenticated; select public.app_apply_event_update_cas(` +
  `'${eventId}'::uuid,'{"expected_revision":${revision}}'::jsonb,null,null); rollback;`);
assert.notEqual(denied.status, 0);
assert.match(denied.stderr, /permission denied for function app_apply_event_update_cas/i);
for (const expected of ['0', '-1', "'1'", 'null']) {
  const invalid = await sql(update(expected, 'Invalid revision'));
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /expected event revision/i);
}
assert.equal(Number(await ok(`select revision from public.events_app_events where id='${eventId}'::uuid`)), revision);

// The first transaction owns the row lock before the second edit starts. The
// second must wait, then compare against the committed new revision and fail.
const first = sql(`begin; select id from public.events_app_events where id='${eventId}'::uuid for update;` +
  ` select pg_sleep(2); ${update(revision, 'CAS first editor')}; commit;`);
await new Promise((resolve) => setTimeout(resolve, 250));
const second = sql(update(revision, 'CAS stale second editor'));
const [firstResult, secondResult] = await Promise.all([first, second]);
assert.equal(firstResult.status, 0, firstResult.stderr);
assert.notEqual(secondResult.status, 0, 'stale concurrent editor must conflict');
assert.match(secondResult.stderr, /Event changed since this preview/i);
const after = await ok(`select revision||'|'||event_name from public.events_app_events where id='${eventId}'::uuid`);
assert.equal(after, `${revision + 1}|CAS first editor`);
assert.equal(Number(await ok(`select count(*) from public.events_app_event_history where event_id='${eventId}'::uuid`)), historyBefore + 1);
const replay = await sql(update(revision, 'CAS stale replay'));
assert.notEqual(replay.status, 0);
assert.match(replay.stderr, /Event changed since this preview/i);
await ok('revoke execute on function public.app_apply_event_update_cas(uuid,jsonb,text,text) from service_role');
assert.equal(await ok("select has_function_privilege('service_role','public.app_apply_event_update_cas(uuid,jsonb,text,text)','EXECUTE')"), 'f');
await ok(readFileSync(new URL('../supabase/migrations/20261002080000_event_manager_revision_compare_and_swap.sql', import.meta.url), 'utf8'));
assert.equal(await ok("select has_function_privilege('service_role','public.app_apply_event_update_cas(uuid,jsonb,text,text)','EXECUTE')"), 't');
console.log(JSON.stringify({ pass: true, container, event_id: eventId, initial_revision: revision,
  final_revision: revision + 1, denied_roles: ['PUBLIC', 'anon', 'authenticated'],
  simultaneous_second_editor: 'conflict', stale_replay: 'conflict', history_delta: 1,
  service_role_grant_recovery: 'pass' }));
