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
for (const [table, digest] of [
  ['custodial_activation_legacy_lineage_bindings', '631407ef4816c053c6bac2b1d404fd21d5df8455292aac42a530361940cbd454'],
  ['custodial_assigned_activation_operations', '5f64cded9a19eafa8243e5466312ae9c90c8b7b6bca91c5b811ced0d790190c6'],
  ['employee_native_push_generations', '3e87d5bac94a61fcec70c9c68a615cd7160c1dddbd588702c7a97d4311f9229a'],
]) {
  equal(sql(`select count(*)::text||'|'||min(definition_sha256) from public.custodial_release_authority_restore_inventory
    where object_kind='trigger' and object_identity=${q(`public.${table}.custodial_disaster_restore_mutation_fence`)}`),
  `1|${digest}`, `${table} exact restored-ledger disaster fence captured once`);
}
sql(`begin;
  drop trigger custodial_disaster_restore_mutation_fence on public.static_weekly_recurring_terminal_intents;
  select custodial_dr.install_application_mutation_fences();
  do $installer_proof$ declare actual_digest text;denied boolean:=false;begin
    if (select count(*) from pg_trigger
      where tgrelid='public.static_weekly_recurring_terminal_intents'::regclass
        and tgname='custodial_disaster_restore_mutation_fence'
        and tgenabled='O' and not tgisinternal)<>1 then
      raise exception 'explicit installer did not restore the exact recurring mutation fence';
    end if;
    select public.static_weekly_digest_text(
      'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'; '
      ||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' enable trigger '
      ||quote_ident(t.tgname)||';') into actual_digest from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      and c.relname='static_weekly_recurring_terminal_intents'
      and t.tgname='custodial_disaster_restore_mutation_fence' and not t.tgisinternal;
    if actual_digest is distinct from 'a27e95125b9f7994596c5625c440fd0f21333c6081b824094fa6051d95f82e8d' then
      raise exception 'recreated recurring fence definition changed';end if;
    update custodial_dr.restore_control set mutations_paused=true where singleton=true;
    begin
      delete from public.static_weekly_recurring_terminal_intents where false;
    exception when others then
      denied:=sqlstate='55000' and sqlerrm='disaster recovery is in progress; application mutations are paused';
    end;
    if not denied then raise exception 'recreated recurring fence did not reject paused zero-row DML';end if;
  end $installer_proof$;
  rollback;`);
checks+=3;
equal(sql('select mutations_paused::text from custodial_dr.restore_control where singleton=true'),
  'false','paused-state challenge rolled back without altering restore control');
const closureSql = readFileSync(new URL('../supabase/migrations/20260929125440_custodial_recovery_inventory_closure.sql', import.meta.url),'utf8');
const closurePreflight = closureSql.match(/do \$preflight\$[\s\S]*?end \$preflight\$;/)?.[0];
assert.ok(closurePreflight,'exact closure preflight is extractable for privileged drift challenges');
for (const [routine,returnType,body] of [
  ['acquire_application_mutation_fence','bigint','return 0;'],
  ['guard_application_mutation','trigger','return null;'],
  ['install_application_mutation_fences','void','return;'],
]) {
  assert.throws(() => sql(`begin;
    create or replace function custodial_dr.${routine}() returns ${returnType}
      language plpgsql security definer set search_path=pg_catalog,custodial_dr
      as $changed$ begin ${body} end $changed$;
    ${closurePreflight}
    rollback;`), /disaster fence privileged predecessor changed/,
    `${routine} drift must fail in the real closure preflight`);
  checks++;
}
for (const routine of ['install_application_mutation_fences','install_application_mutation_fences_after_ddl']) {
  for (const role of ['custodial_application_reader','mz_recovery_acl_probe']) {
    assert.throws(() => sql(`begin;
      do $probe$ begin if not exists(select 1 from pg_roles where rolname='mz_recovery_acl_probe')
        then create role mz_recovery_acl_probe noinherit;end if;end $probe$;
      grant execute on function custodial_dr.${routine}() to ${role};
      ${closurePreflight}
      rollback;`), /disaster fence routine ACL changed/,
      `${routine} must reject unlisted ${role} direct EXECUTE before the installer`);
    checks++;
  }
}
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
