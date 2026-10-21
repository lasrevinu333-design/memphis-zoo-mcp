import {migrationReplayNames} from './migration-replay-order.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';

const container = `mz_constraint_index_recovery_${process.pid}`;
const image = 'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker = (args, extra = {}) => execFileSync('docker', args, {
  encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024,
  stdio: ['pipe', 'pipe', 'pipe'], ...extra,
});
const sql = statement => docker(['exec', '-i', container, 'psql', '-X', '-q', '-At',
  '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], {
  input: `set client_min_messages=warning;set statement_timeout=30000;${statement}`,
}).trim();
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const check = (name, actual, expected) => {assert.deepEqual(actual, expected, name); count++; console.log('PASS', name);};
const reject = (name, statement, pattern) => {
  let error;
  try {sql(statement);} catch (cause) {error = cause;}
  assert.ok(error, name); assert.match(String(error.stderr), pattern, name);
  count++; console.log('PASS', name);
};
const defaultCount = "select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults = () => {
  for (const owner of ['postgres', 'supabase_admin']) for (const scope of ['', ' in schema public']) {
    sql(`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`);
  }
};
const overlapSql = `select coalesce(jsonb_agg(jsonb_build_object(
  'index_identity',i.object_identity,'index_definition_sha256',i.definition_sha256,
  'index_live_definition_sha256',public.static_weekly_digest_text(public.custodial_release_authority_current_index_definition(i.object_identity)),
  'constraint_identity',ci.object_identity,'constraint_definition_sha256',ci.definition_sha256,
  'constraint_live_definition_sha256',public.static_weekly_digest_text(public.custodial_release_authority_current_constraint_definition(ci.object_identity)),
  'constraint_type',c.contype,'backing_index',c.conindid::regclass::text
) order by i.object_identity),'[]'::jsonb) from public.custodial_release_authority_restore_inventory i
join pg_class ix on ix.oid=to_regclass(i.object_identity)
join pg_constraint c on c.conindid=ix.oid and c.contype in ('p','u','x')
join public.custodial_release_authority_restore_inventory ci on ci.object_kind='constraint'
 and ci.object_identity=c.conrelid::regclass::text||':'||c.conname
where i.object_kind='index'`;
const inventoryDigest = () => sql("select public.static_weekly_digest_text(string_agg(restore_order::text||'|'||object_kind||'|'||object_identity||'|'||definition_sha256,E'\\n' order by restore_order,object_identity)) from public.custodial_release_authority_restore_inventory;");
const migrationName = '20261003143000_issue_constraint_index_recovery.sql';
const files = migrationReplayNames(process.cwd());
assert.equal(files.at(-1), migrationName);
const predecessors = files.filter(file => file !== migrationName);
const manifest = createHash('sha256').update(predecessors.map(file => `${file} ${createHash('sha256').update(readFileSync(`supabase/migrations/${file}`)).digest('hex')}`).join('\n')).digest('hex');
let owned = false, count = 0;
const cleanup = () => {
  if (!owned) return;
  docker(['rm', '-f', container]); owned = false;
  assert.equal(docker(['ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}']).trim(), '');
  console.log('OWNED_CONTAINER_REMOVED', container);
};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {try {cleanup();} finally {process.exit(143);}});

try {
  docker(['image', 'inspect', image]);
  docker(['run', '--rm', '-d', '--network', 'none', '--name', container,
    '--tmpfs', '/var/lib/postgresql/data:rw,size=1g', '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', 'PGPASSWORD=postgres', image, '-c', 'shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);
  owned = true;
  console.log(JSON.stringify({container, image, manifest, migrations: predecessors.length, synthetic: true}));
  let ready = 0;
  for (let n = 0; n < 60 && ready < 4; n++) {
    try {sql('select 1'); ready++;} catch {ready = 0;}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(ready, 4);
  removeDefaults(); let defaultRepairs = 0;
  for (const file of predecessors) {
    assert.equal(sql(defaultCount), '0', `defaults before ${file}`);
    try {sql(readFileSync(`supabase/migrations/${file}`, 'utf8'));}
    catch (error) {console.error('FAILED_MIGRATION', file, String(error.stderr)); throw error;}
    if (Number(sql(defaultCount))) {defaultRepairs++; removeDefaults();}
    assert.equal(sql(defaultCount), '0', `defaults after ${file}`);
  }
  console.log('REPLAY_COMPLETE', predecessors.length, 'default_repairs', defaultRepairs);
  const overlaps = JSON.parse(sql(overlapSql));
  console.log('CONSTRAINT_OWNED_INDEX_INVENTORY', JSON.stringify(overlaps));
  console.log('BEFORE_INVENTORY_DIGEST', inventoryDigest());
  if (process.argv.includes('--inspect-only')) process.exitCode = 0;
  else {
    const expected = [
      ['events_app_transition_receipts_pkey', 'events_app_transition_receipts:events_app_transition_receipts_pkey'],
      ['maintenance_ticket_outcome_history_pkey', 'maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_pkey'],
    ];
    check('exact two redundant index/constraint pairs', overlaps.map(row => [row.index_identity,row.constraint_identity]), expected);
    check('all redundant inventory hashes match live catalog', overlaps.every(row =>
      row.index_definition_sha256 === row.index_live_definition_sha256 &&
      row.constraint_definition_sha256 === row.constraint_live_definition_sha256), true);
    const beforeIndexes = Object.fromEntries(overlaps.map(row => [row.index_identity, row.index_definition_sha256]));
    const beforeConstraints = Object.fromEntries(overlaps.map(row => [row.constraint_identity, row.constraint_definition_sha256]));
    const otherIndexesBefore = JSON.parse(sql("select coalesce(jsonb_agg(jsonb_build_object('identity',object_identity,'hash',definition_sha256) order by object_identity),'[]'::jsonb) from public.custodial_release_authority_restore_inventory where object_kind='index' and object_identity not in ('events_app_transition_receipts_pkey','maintenance_ticket_outcome_history_pkey');"));
    const manager=randomUUID(), location=randomUUID(), ticket=randomUUID(), group=randomUUID(), event=randomUUID(), history=randomUUID(), operation=randomUUID();
    const secret='synthetic-constraint-index-recovery-secret-long-enough';
    sql(`select public.custodial_configure_backend_execution_key(public.static_weekly_digest_text(${quote(secret)}),'constraint-index-synthetic');
      insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
        values(${quote(manager)},'Synthetic Recovery Manager',array['OPS_MANAGER','DIRECTOR'],true,false);
      insert into public.locations(id,location_code,location_name,location_type,form_type,active)
        values(${quote(location)},${quote('CR'+manager.slice(0,8))},'Synthetic Recovery Area','restroom','restroom',true);
      insert into public.maintenance_tickets(id,location_id,issue_source,status,issue_summary)
        values(${quote(ticket)},${quote(location)},'manager_report','open','Synthetic history preservation');
      insert into public.location_groups(id,group_code,group_name,active)
        values(${quote(group)},${quote('CR'+group.slice(0,8))},'Synthetic Event Group',true);
      insert into public.events_app_events(id,event_name,location_group_id,event_date,start_time,end_time,end_date,
          event_scope,needs_review,source_location_text,status)
        values(${quote(event)},'Synthetic Unresolved Event',${quote(group)},'2030-01-07','12:00','13:00','2030-01-07',
          'UNKNOWN',true,'Synthetic unresolved venue','NEEDS_REVIEW');
      insert into public.events_app_event_history(id,event_id,action,actor,new_record)
        values(${quote(history)},${quote(event)},'cancel','Synthetic Recovery Manager','{"synthetic":true}'::jsonb);
      insert into public.events_app_transition_receipts(operation_id,event_id,action,expected_revision,actor_manager_id,request_digest,history_id,result_record)
        values(${quote(operation)},${quote(event)},'cancel',1,${quote(manager)},${quote('a'.repeat(64))},${quote(history)},'{"synthetic":true}'::jsonb);`);
    const issueResult=JSON.parse(sql(`set role service_role;select public.custodial_set_maintenance_ticket_outcome(${quote(ticket)},'work_order_sent',${quote(manager)},'SYNTHETIC-WO-1','Synthetic work order',${quote(secret)});`));
    check('official issue history outcome',issueResult.outcome,'work_order_sent');
    const historyDigest=() => sql(`select public.static_weekly_digest_text(
      (select to_jsonb(h)::text from public.maintenance_ticket_outcome_history h where ticket_id=${quote(ticket)})||'|'||
      (select to_jsonb(h)::text from public.events_app_event_history h where id=${quote(history)})||'|'||
      (select to_jsonb(r)::text from public.events_app_transition_receipts r where operation_id=${quote(operation)})
    );`);
    const originalHistory=historyDigest();
    check('original protected history populated',originalHistory.length,64);
    const canary='KIOSK_08';
    const pause=JSON.parse(sql(`set role service_role;select public.custodial_control_release_canary(${quote(manager)},${quote(randomUUID())},${quote(canary)},'pause_canary','synthetic constraint-index recovery proof','{"ok":false,"scope":"index-recovery"}'::jsonb,${quote(secret)});`));
    check('synthetic canary paused',pause.canary_paused,true);
    reject('predecessor full restore refuses constraint-owned index drop',
      `set role service_role;select public.custodial_control_release_canary(${quote(manager)},${quote(randomUUID())},${quote(canary)},'restore_authority','predecessor expected failure','{"ok":false,"scope":"index-recovery"}'::jsonb,${quote(secret)});`,
      /cannot drop index maintenance_ticket_outcome_history_pkey because constraint maintenance_ticket_outcome_history_pkey/);
    check('failed predecessor restore preserved history',historyDigest(),originalHistory);
    sql(readFileSync(`supabase/migrations/${migrationName}`,'utf8'));
    check('forward repair left no constraint-owned index duplicate',JSON.parse(sql(overlapSql)),[]);
    check('both exact primary-key constraints retained',JSON.parse(sql(`select jsonb_object_agg(object_identity,definition_sha256) from public.custodial_release_authority_restore_inventory where object_kind='constraint' and object_identity in (${expected.map(pair=>quote(pair[1])).join(',')});`)),beforeConstraints);
    check('all independent index inventory rows unchanged',JSON.parse(sql("select coalesce(jsonb_agg(jsonb_build_object('identity',object_identity,'hash',definition_sha256) order by object_identity),'[]'::jsonb) from public.custodial_release_authority_restore_inventory where object_kind='index' and object_identity not in ('events_app_transition_receipts_pkey','maintenance_ticket_outcome_history_pkey');")),otherIndexesBefore);
    check('forward repair left both live primary keys',sql("select count(*) from pg_constraint where (conrelid='public.events_app_transition_receipts'::regclass and conname='events_app_transition_receipts_pkey' or conrelid='public.maintenance_ticket_outcome_history'::regclass and conname='maintenance_ticket_outcome_history_pkey') and contype='p' and conindid<>0;"),'2');
    check('forward repair preserved history bytes',historyDigest(),originalHistory);
    check('inventory immutable trigger re-enabled',sql("select tgenabled from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable';"),'O');
    reject('inventory remains immutable',"update public.custodial_release_authority_restore_inventory set captured_at=statement_timestamp() where object_kind='index' and object_identity='maintenance_ticket_outcome_once';",/immutable/);
    reject('anonymous cannot read private inventory',"set role anon;select * from public.custodial_release_authority_restore_inventory limit 1;",/permission denied/);
    reject('service role cannot read private outcome history',"set role service_role;select * from public.maintenance_ticket_outcome_history limit 1;",/permission denied/);
    reject('service role cannot read private event receipts',"set role service_role;select * from public.events_app_transition_receipts limit 1;",/permission denied/);
    const managerEvidenceRpc='public.custodial_manager_completion_evidence(uuid,text,text)';
    check('exact manager reader initially granted',sql(`select has_function_privilege('service_role',${quote(managerEvidenceRpc)},'EXECUTE');`),'t');
    sql(`revoke execute on function ${managerEvidenceRpc} from service_role;`);
    check('deliberate exact manager reader ACL drift',sql(`select has_function_privilege('service_role',${quote(managerEvidenceRpc)},'EXECUTE');`),'f');
    sql('alter table public.maintenance_ticket_outcome_history drop constraint maintenance_ticket_outcome_history_pkey;alter table public.events_app_transition_receipts drop constraint events_app_transition_receipts_pkey;drop index public.maintenance_ticket_outcome_once;drop index public.events_app_transition_receipts_event_idx;');
    check('deliberate drift removed both primary keys',sql("select count(*) from pg_constraint where (conrelid='public.events_app_transition_receipts'::regclass and conname='events_app_transition_receipts_pkey' or conrelid='public.maintenance_ticket_outcome_history'::regclass and conname='maintenance_ticket_outcome_history_pkey') and contype='p';"),'0');
    const restore=JSON.parse(sql(`set role service_role;select public.custodial_control_release_canary(${quote(manager)},${quote(randomUUID())},${quote(canary)},'restore_authority','synthetic exact constraint-index restore','{"ok":false,"scope":"index-recovery"}'::jsonb,${quote(secret)});`));
    check('complete authority restore executed',restore.restored_objects>40,true);
    check('both constraint-backed index definitions restored exactly',Object.fromEntries(expected.map(([index])=>[index,sql(`select public.static_weekly_digest_text(public.custodial_release_authority_current_index_definition(${quote(index)}));`)])),beforeIndexes);
    check('both constraints restored exactly',Object.fromEntries(expected.map(([,constraint])=>[constraint,sql(`select public.static_weekly_digest_text(public.custodial_release_authority_current_constraint_definition(${quote(constraint)}));`)])),beforeConstraints);
    check('history bytes unchanged by full restore',historyDigest(),originalHistory);
    check('independent indexes restored',sql("select count(*) from pg_class where oid in (to_regclass('public.maintenance_ticket_outcome_once'),to_regclass('public.events_app_transition_receipts_event_idx'));"),'2');
    check('exact manager reader ACL restored',sql(`select has_function_privilege('service_role',${quote(managerEvidenceRpc)},'EXECUTE');`),'t');
    check('anonymous manager reader still denied',sql(`select has_function_privilege('anon',${quote(managerEvidenceRpc)},'EXECUTE');`),'f');
    check('default grants still absent',sql(defaultCount),'0');
    console.log('AFTER_INVENTORY_DIGEST',inventoryDigest());
    console.log('PASS_COUNT',count);
  }
} finally {cleanup();}
