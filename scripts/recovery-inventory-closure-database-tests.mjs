#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// This fixture is restricted to an owned, network-none PostgreSQL container.
// Synthetic SQL regression evidence is never reported as physical NFC proof.
const container = String(process.env.BUILD52_RECOVERY_TEST_DOCKER_CONTAINER || '');
const database = String(process.env.BUILD52_RECOVERY_TEST_DATABASE || 'postgres');
assert.match(container, /^mz_schema_rebuild_[a-zA-Z0-9_]+$/);
assert.match(database, /^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/);
const inspection = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(inspection.HostConfig.NetworkMode, 'none');
assert.equal(Object.keys(inspection.HostConfig.PortBindings || {}).length, 0);
const root = fileURLToPath(new URL('../', import.meta.url));
const q = value => `'${String(value).replaceAll("'", "''")}'`;
function sql(statement) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-At',
    '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', database], {
    input: statement, encoding: 'utf8', timeout: 90_000, maxBuffer: 16 * 1024 * 1024,
  }).trim().split('\n').at(-1);
}
const secret = `isolated-recovery-closure-${randomUUID()}`;
const manager = '00000000-0000-4000-8000-000000000001';
const device = 'KIOSK_08';
let checks = 0;
function equal(actual, expected, description) { assert.deepEqual(actual, expected, description); checks++; }
function canonical() {
  const output = execFileSync(process.execPath, ['scripts/refresh-schema-fingerprint.mjs', '--check'], {
    cwd: root, env: { ...process.env, SCHEMA_FINGERPRINT_MCP_URL: '',
      SCHEMA_FINGERPRINT_DOCKER_CONTAINER: container, SCHEMA_FINGERPRINT_DATABASE: database },
    encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  const result = JSON.parse(output);
  equal(result.checked, true, 'canonical verifier executed, not refreshed');
  return result.schema_fingerprint;
}
const beforeFingerprint = canonical();
const helper = 'public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)';
const wrapper = 'public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)';
const measurement = 'public.custodial_evaluate_location_proximity_v2_measurement(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)';
sql(`select public.custodial_configure_backend_execution_key(
  encode(extensions.digest(convert_to(${q(secret)},'UTF8'),'sha256'),'hex'),'isolated-recovery-closure');`);
const health = () => JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
function healthy(label) {
  const value = health();
  equal(value.ok, true, label);
  equal(Object.values(value.checks).every(Boolean), true, `${label}: every guard stays active`);
  for (const field of ['missing_objects','mismatched_objects','surface_missing_objects','surface_uncovered_objects']) {
    equal(value[field], [], `${label}: ${field}`);
  }
  return value;
}
const initial = healthy('clean forward migration is healthy');
equal(initial.canonical_objects_expected, 5127, 'seven missing GPS recovery objects were added, not duplicated');
const wanted = [
  ['column', 'public.location_proximity_settings:authority_radius_m'],
  ['column', 'public.location_proximity_settings:authority_surveyed_at'],
  ['constraint', 'public.location_proximity_settings:location_proximity_authority_radius_bound'],
];
for (const [kind, identity] of wanted) {
  equal(sql(`select count(*)::text from public.custodial_release_authority_restore_inventory
    where object_kind=${q(kind)} and object_identity=${q(identity)}`), '1', `${identity} captured exactly once`);
}
for (const signature of [helper, wrapper]) {
  for (const kind of ['function', 'grant']) {
    equal(sql(`select count(*)::text from public.custodial_release_authority_restore_inventory
      where object_kind=${q(kind)} and object_identity like '%(%'
        and to_regprocedure(object_identity)=${q(signature)}::regprocedure`), '1', `${kind} ${signature} exactly once`);
  }
}
const orders = [measurement, helper, wrapper].map(signature => Number(sql(`select restore_order
  from public.custodial_release_authority_restore_inventory where object_kind='function'
    and object_identity like '%(%' and to_regprocedure(object_identity)=${q(signature)}::regprocedure`)));
equal(orders[0] < orders[1] && orders[1] < orders[2], true, 'GPS dependencies restored before the caller');
equal(sql(`select has_function_privilege('service_role',${q(helper)},'EXECUTE')::text`), 'false', 'internal GPS implementation is not a service entry point');
equal(sql(`select has_function_privilege('service_role',${q(wrapper)},'EXECUTE')::text`), 'true', 'existing supported GPS wrapper remains callable');
for (const role of ['anon','authenticated']) {
  equal(sql(`select has_function_privilege(${q(role)},${q(helper)},'EXECUTE') or has_function_privilege(${q(role)},${q(wrapper)},'EXECUTE')`), 'f', `${role} cannot call either GPS function`);
}
const location = sql('select location_code from public.locations where active order by location_code limit 1');
assert.ok(location);
assert.throws(() => sql(`begin;set local role service_role;
  select public.evaluate_location_proximity_v2(${q(location)},${q(device)},35.15,-90.05,5,null,null,null,null);rollback;`),
  /permission denied for function evaluate_location_proximity_v2/);
checks++;
const wrapperResult = JSON.parse(sql(`begin;set local role service_role;
  select public.tool_evaluate_location_proximity_v2(${q(location)},${q(device)},35.15,-90.05,5,null,null,null,null)::text;rollback;`));
equal(wrapperResult.result, 'gps_timestamp_unavailable', 'service-role wrapper really executes the unchanged implementation');
equal(wrapperResult.authoritative, false, 'missing capture time cannot manufacture authoritative GPS');

const businessTables = ['sessions','completion_responses','scan_events','maintenance_tickets',
  'employees','devices','location_proximity_settings','weekly_schedule_versions','weekly_schedule_publications'];
function businessSnapshot() {
  return Object.fromEntries(businessTables.map(table => [table, sql(`select md5(coalesce(string_agg(row_json,E'\n' order by row_json),''))
    from (select to_jsonb(r)::text row_json from public.${table} r) rows`)]));
}
const businessBefore = businessSnapshot();
const control = (action, reason) => JSON.parse(sql(`select public.custodial_control_release_canary(
  ${q(manager)}::uuid,${q(randomUUID())}::uuid,${q(device)},${q(action)},${q(reason)},
  '{"ok":false,"fixture":"recovery-inventory-closure"}'::jsonb,${q(secret)})::text`));
equal(control('pause_canary','isolated recovery closure regression').canary_paused, true, 'fixture is paused before faults');
const triggerTable = 'public.static_weekly_recurring_terminal_intents';
const triggerName = 'trg_recurring_terminal_immutable';
let repairNeeded = false;
try {
  repairNeeded = true;
  sql(`alter table public.location_proximity_settings alter column authority_radius_m set default 125;
    alter table ${triggerTable} disable trigger ${triggerName};
    grant execute on function ${helper} to service_role;`);
  const drift = health();
  equal(drift.ok, false, 'all sensitivity faults fail closed');
  equal(drift.checks.alternate_terminal_writers_absent, false, 'reopened internal writer is detected by unchanged guard');
  equal(drift.mismatched_objects.includes('public.location_proximity_settings:authority_radius_m'), true, 'new GPS column drift is independently detected');
  equal(drift.mismatched_objects.includes(`${triggerTable}.${triggerName}`), true, 'recurring trigger disabled state is detected');
  const restored = control('restore_authority','restore exact GPS and recurring trigger bindings');
  equal(restored.canary_paused, true, 'restoration cannot resume the phone');
  equal(restored.restored_objects, initial.canonical_objects_expected, 'restore uses full captured inventory');
  healthy('controller restored exact current authority');
  equal(sql(`select has_function_privilege('service_role',${q(helper)},'EXECUTE')::text`), 'false', 'restoration does not resurrect direct helper access');
  equal(sql(`select has_function_privilege('service_role',${q(wrapper)},'EXECUTE')::text`), 'true', 'restoration retains existing service GPS caller');
  equal(sql(`select tgenabled from pg_trigger where tgrelid=${q(triggerTable)}::regclass and tgname=${q(triggerName)}`), 'O', 'recurring immutability enforcement is re-enabled');
  equal(businessSnapshot(), businessBefore, 'restore preserves exact existing business and GPS-setting rows');
  equal(canonical(), beforeFingerprint, 'recovery returns to the exact current canonical schema');
  repairNeeded = false;
} finally {
  if (repairNeeded) {
    try { control('restore_authority','cleanup failed isolated recovery closure'); healthy('cleanup'); }
    catch (error) { console.error(`RECOVERY_CLOSURE_FIXTURE_CLEANUP_FAILED: ${error.message}`); }
  }
}
console.log(JSON.stringify({ok:true,marker:'RECOVERY_INVENTORY_CLOSURE_DATABASE_PASS',checks,
  restored_objects:initial.canonical_objects_expected,schema_fingerprint:beforeFingerprint,
  original_authority_guards_unchanged:true,production_touched:false,physical_nfc_verified:false}));
