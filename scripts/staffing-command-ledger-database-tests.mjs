import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const container = `mz_staffing_ledger_${process.pid}`;
const image = 'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker = (args, extra = {}) => execFileSync('docker', args, {
  encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024,
  stdio: ['pipe', 'pipe', 'pipe'], ...extra,
});
const sql = text => docker(['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1',
  '-U', 'supabase_admin', '-d', 'postgres'], { input: `set statement_timeout=30000;${text}` }).trim();
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const id = n => `46000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const defaults = "select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace='public'::regnamespace and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults = () => { for (const owner of ['postgres', 'supabase_admin']) sql(`alter default privileges for role ${owner} in schema public revoke all on tables from anon,authenticated,service_role;alter default privileges for role ${owner} in schema public revoke all on sequences from anon,authenticated,service_role;`); };
let owned = false; let checks = 0;
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks++; console.log('PASS', name); };
const reject = (name, query, pattern = /ERROR/) => { let error; try { sql(query); } catch (candidate) { error = candidate; } assert.ok(error, name); assert.match(String(error.stderr), pattern, name); checks++; console.log('PASS', name); };
const cleanup = () => { if (!owned) return; docker(['rm', '-f', container]); owned = false; assert.equal(docker(['ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}']).trim(), ''); console.log('OWNED_CONTAINER_REMOVED', container); };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { try { cleanup(); } finally { process.exit(143); } });

const files = readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort();
assert.equal(files.at(-1), '20260925190000_gps_exact_location_authority_boundary.sql');
try {
  docker(['image', 'inspect', image]);
  docker(['run', '--rm', '-d', '--network', 'none', '--name', container,
    '--tmpfs', '/var/lib/postgresql/data:rw,size=1g', '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', 'PGPASSWORD=postgres', image, '-c', 'shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);
  owned = true;
  console.log(JSON.stringify({ owned: container, cleanup: 'exact container in finally', image, network: 'none', production: false }));
  let ready = 0; for (let attempt = 0; attempt < 60 && ready < 4; attempt++) { try { sql('select 1'); ready++; } catch { ready = 0; } await new Promise(resolve => setTimeout(resolve, 500)); } assert.equal(ready, 4);
  removeDefaults();
  for (const file of files) {
    assert.equal(sql(defaults), '0', `automatic grants before ${file}`);
    const bytes = readFileSync(`supabase/migrations/${file}`);
    try { sql(bytes.toString()); } catch (error) { console.error('FAILED_MIGRATION', file, String(error.stderr)); throw error; }
    if (Number(sql(defaults))) {
      assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql', '20260729150527_audit_defense_in_depth_hardening.sql', '20260815160613_normalize_managed_production_schema_security.sql'].includes(file));
      assert.doesNotMatch(bytes.toString(), /create\s+(?:unlogged\s+)?table|create\s+sequence/i); removeDefaults();
    }
    assert.equal(sql(defaults), '0', `automatic grants after ${file}`);
  }
  console.log('REPLAYED_EXACT_MIGRATIONS', files.length);

  const manager = id(1), otherManager = id(2), employee = id(3), key = id(4);
  sql(`insert into public.ops_manager_managers(manager_id,display_name) values(${q(manager)},'Synthetic Manager'),(${q(otherManager)},'Successor Manager');insert into public.employees(id,employee_code,display_name,role,active) values(${q(employee)},'EMPLEDGER','Synthetic Employee','staff',true);`);
  const elapsedDate=sql("select (public.sch_service_date(statement_timestamp())-1)::text"),elapsedOperation=id(5),elapsedKey=id(6),elapsedTarget=id(7);
  const elapsedBody={absenceKind:null,commandKind:'cancel_absence',employeeId:employee,endDate:elapsedDate,startDate:elapsedDate,targetAbsenceId:elapsedTarget};
  sql(`set session_replication_role=replica;insert into public.static_weekly_staffing_commands(operation_id,command_kind,employee_id,start_date,end_date,target_absence_id,semantic_body,semantic_digest,client_prepare_key,expected_revision,prepared_by_manager_id) values(${q(elapsedOperation)},'cancel_absence',${q(employee)},${q(elapsedDate)},${q(elapsedDate)},${q(elapsedTarget)},${q(JSON.stringify(elapsedBody))}::jsonb,public.static_weekly_digest_jsonb(${q(JSON.stringify(elapsedBody))}::jsonb),${q(elapsedKey)},0,${q(manager)});insert into public.static_weekly_staffing_absences(absence_id,employee_id,absence_kind,start_date,end_date,accepted_operation_id,accepted_revision,accepted_by_manager_id) values(${q(elapsedTarget)},${q(employee)},'daily_absence',${q(elapsedDate)},${q(elapsedDate)},${q(elapsedOperation)},0,${q(manager)});set session_replication_role=origin;`);
  const elapsedReplay=JSON.parse(sql(`set role static_weekly_control_plane;select public.static_weekly_v10_begin_staffing_command(${q(JSON.stringify(elapsedBody))}::jsonb,${q(elapsedKey)}::uuid,0,${q(manager)}::uuid)::text`));
  check('lost begin after date rollover resolves exact existing operation before freshness guard',elapsedReplay.operation_id,elapsedOperation);
  check('elapsed exact begin replay is marked durable replay',elapsedReplay.replayed,true);
  reject('elapsed cancellation with a new prepare key remains rejected',`set role static_weekly_control_plane;select public.static_weekly_v10_begin_staffing_command(${q(JSON.stringify(elapsedBody))}::jsonb,${q(id(8))}::uuid,0,${q(manager)}::uuid)`,/cannot rewrite an elapsed service date/);
  sql(`begin;select set_config('app.static_weekly_staffing_write','on',true);update public.static_weekly_staffing_commands set state='REJECTED' where operation_id=${q(elapsedOperation)}::uuid;commit;`);
  const body = { absenceKind: 'daily_absence', commandKind: 'absence', employeeId: employee,
    endDate: '2026-10-09', startDate: '2026-09-28', targetAbsenceId: null };
  const json = q(JSON.stringify(body));
  const correctCall = `set role static_weekly_control_plane;select public.static_weekly_v10_begin_staffing_command(${json}::jsonb,${q(key)}::uuid,0,${q(manager)}::uuid)::text`;
  const first = JSON.parse(sql(correctCall)); check('durable command begins PREPARING', first.state, 'PREPARING'); check('not replayed', first.replayed, false);
  const replay = JSON.parse(sql(correctCall)); check('exact replay keeps operation', replay.operation_id, first.operation_id); check('exact replay marked', replay.replayed, true);
  check('begin does not advance schedule authority', sql('select current_revision from public.static_weekly_schedule_control where singleton'), '0');
  check('begin creates no authority candidate rows', sql('select count(*) from public.static_weekly_staffing_staged_candidates'), '0');
  check('server actor persisted', sql(`select prepared_by_manager_id from public.static_weekly_staffing_commands where operation_id=${q(first.operation_id)}::uuid`), manager);
  check('one append-only PREPARING receipt', sql(`select count(*) from public.static_weekly_staffing_command_receipts where operation_id=${q(first.operation_id)}::uuid and event_kind='PREPARING'`), '1');
  const status = JSON.parse(sql(`set role static_weekly_control_plane;select public.static_weekly_v10_read_staffing_command(${q(first.operation_id)}::uuid,${q(otherManager)}::uuid)::text`));
  check('different current manager can recover status', status.operation_id, first.operation_id);
  const pending = JSON.parse(sql(`set role static_weekly_control_plane;select public.static_weekly_v10_list_pending_staffing_commands(${q(otherManager)}::uuid,50,null,null)::text`));
  check('different manager discovers pending operation', pending.commands.map(row => row.operation_id), [first.operation_id]);
  reject('same prepare key changed semantics denied', `set role static_weekly_control_plane;select public.static_weekly_v10_begin_staffing_command(${q(JSON.stringify({ ...body, absenceKind: 'pto' }))}::jsonb,${q(key)}::uuid,0,${q(manager)}::uuid)`, /different semantics|invalid canonical/);
  reject('stale authority revision denied', `set role static_weekly_control_plane;select public.static_weekly_v10_begin_staffing_command(${json}::jsonb,${q(id(18))}::uuid,1,${q(manager)}::uuid)`, /expected revision is stale/);
  reject('direct state update denied', `update public.static_weekly_staffing_commands set state='PREPARED' where operation_id=${q(first.operation_id)}::uuid`, /typed authority RPC/);
  for (const role of ['anon', 'authenticated', 'service_role', 'static_weekly_release_operator', 'custodial_application_reader']) {
    reject(`direct command table denied ${role}`, `set role ${role};select * from public.static_weekly_staffing_commands`, /permission denied/);
    reject(`begin RPC denied ${role}`, `set role ${role};select public.static_weekly_v10_begin_staffing_command(${json}::jsonb,${q(id(9))}::uuid,0,${q(manager)}::uuid)`, /permission denied/);
  }
  const candidates = [
    { candidateKey: 'week:2026-09-28', candidateKind: 'lunch', payload: { week: 1, lunch: true }, serviceDate: '2026-09-28' },
    { candidateKey: 'week:2026-09-28', candidateKind: 'projection', payload: { week: 1, projection: true }, serviceDate: '2026-09-28' },
    { candidateKey: 'employee:one', candidateKind: 'schedule_refresh', payload: { employeeId: employee }, serviceDate: '2026-09-30' },
    { candidateKey: 'week:2026-10-05', candidateKind: 'lunch', payload: { week: 2, lunch: true }, serviceDate: '2026-10-05' },
    { candidateKey: 'week:2026-10-05', candidateKind: 'projection', payload: { week: 2, projection: true }, serviceDate: '2026-10-05' },
  ];
  const candidateJson = q(JSON.stringify(candidates));
  const stageCall = (candidateValue = candidateJson, actor = manager, preview = 'a'.repeat(64)) => `set role static_weekly_control_plane;select public.static_weekly_v10_stage_staffing_command(${q(first.operation_id)}::uuid,${candidateValue}::jsonb,${q(preview)},${q('b'.repeat(64))},'{"revision":0,"weeks":["2026-09-28","2026-10-05"]}'::jsonb,${q(actor)}::uuid)::text`;
  reject('different manager cannot replace original preparer during staging', stageCall(candidateJson, otherManager), /original preparer/);
  const staged = JSON.parse(sql(stageCall()));
  check('complete private candidate set becomes PREPARED', staged.state, 'PREPARED');
  check('stage is not authority publication', sql('select current_revision from public.static_weekly_schedule_control where singleton'), '0');
  check('all candidate rows staged atomically', sql(`select count(*) from public.static_weekly_staffing_staged_candidates where operation_id=${q(first.operation_id)}::uuid`), String(candidates.length));
  const preparedRead=JSON.parse(sql(`set role static_weekly_control_plane;select public.static_weekly_v10_read_staffing_command(${q(first.operation_id)}::uuid,${q(otherManager)}::uuid)::text`));
  check('prepared manager read exposes exact staged preview schema',preparedRead.preview.schema,'memphis-zoo.staffing-command-preview.v1');
  check('prepared manager read exposes every staged schedule and lunch week',preparedRead.preview.weeks.map(row=>row.week_start),['2026-09-28','2026-10-05']);
  check('prepared manager read exposes canonical current service date',/^\d{4}-\d{2}-\d{2}$/.test(preparedRead.current_service_date),true);
  check('one append-only PREPARED receipt', sql(`select count(*) from public.static_weekly_staffing_command_receipts where operation_id=${q(first.operation_id)}::uuid and event_kind='PREPARED'`), '1');
  const stagedReplay = JSON.parse(sql(stageCall())); check('exact stage replay is idempotent', stagedReplay.replayed, true);
  reject('changed stage replay denied', stageCall(candidateJson, manager, 'c'.repeat(64)), /different candidates/);
  const secondBody = { ...body, startDate: '2026-10-12', endDate: '2026-10-16' };
  const second = JSON.parse(sql(`set role static_weekly_control_plane;select public.static_weekly_v10_begin_staffing_command(${q(JSON.stringify(secondBody))}::jsonb,${q(id(10))}::uuid,0,${q(manager)}::uuid)::text`));
  const missingWeek = q(JSON.stringify([
    { candidateKey: 'week:2026-10-12', candidateKind: 'projection', payload: { week: 3 }, serviceDate: '2026-10-12' },
  ]));
  reject('incomplete weekly candidates fail closed', `set role static_weekly_control_plane;select public.static_weekly_v10_stage_staffing_command(${q(second.operation_id)}::uuid,${missingWeek}::jsonb,${q('a'.repeat(64))},${q('b'.repeat(64))},'{}'::jsonb,${q(manager)}::uuid)`, /invalid staffing candidate row|incomplete/);
  check('failed staging retains PREPARING and zero rows', sql(`select state||':'||(select count(*) from public.static_weekly_staffing_staged_candidates s where s.operation_id=c.operation_id) from public.static_weekly_staffing_commands c where operation_id=${q(second.operation_id)}::uuid`), 'PREPARING:0');
  const cancelled = JSON.parse(sql(`set role static_weekly_control_plane;select public.static_weekly_v10_cancel_staffing_preparation(${q(second.operation_id)}::uuid,${q(otherManager)}::uuid)::text`));
  check('successor manager can explicitly cancel unaccepted preparation', cancelled.state, 'CANCELLED_BY_SUCCESSOR');
  check('successor cancellation preserves original preparer and actor receipt', sql(`select (select prepared_by_manager_id from public.static_weekly_staffing_commands where operation_id=${q(second.operation_id)}::uuid)||':'||(select actor_manager_id from public.static_weekly_staffing_command_receipts where operation_id=${q(second.operation_id)}::uuid and event_kind='CANCELLED_BY_SUCCESSOR')`), `${manager}:${otherManager}`);
  check('successor cancellation exact retry is durable', JSON.parse(sql(`set role static_weekly_control_plane;select public.static_weekly_v10_cancel_staffing_preparation(${q(second.operation_id)}::uuid,${q(otherManager)}::uuid)::text`)).replayed, true);
  const device = id(20), credential = id(21), intent = id(22), publication = id(23), projection = id(24);
  sql(`insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values(${q(device)},'KIOSK_TEST','Synthetic Phone',true,${q(employee)},7);insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at) values(${q(credential)},${q(device)},repeat('a',64),statement_timestamp(),statement_timestamp()+interval '1 day');set session_replication_role=replica;insert into public.weekly_schedule_compiled_projections(projection_id,publication_id,version_id,week_start,week_end,exception_set_json,exception_set_digest,compiler_version,objective_json,metrics_json,replay_digest,authority_digest,receipt_json,projection_envelope,compiled_by_manager_id) values(${q(projection)},${q(publication)},${q(id(25))},'2026-09-28','2026-10-04','[]',repeat('1',64),'synthetic','{}','{}',repeat('2',64),repeat('3',64),'{}','{}',${q(manager)});insert into public.static_weekly_schedule_application_intents(intent_id,operation_id,service_date,employee_id,device_id,credential_id,assignment_epoch,authority_revision,publication_id,projection_id,lunch_document_identity) values(${q(intent)},${q(first.operation_id)},'2026-09-30',${q(employee)},${q(device)},${q(credential)},7,1,${q(publication)},${q(projection)},${q('d'.repeat(64))});set session_replication_role=origin;`);
  const readApplication = `set role service_role;select public.static_weekly_v10_read_device_schedule_application('2026-09-30',${q(device)}::uuid,${q(credential)}::uuid,${q(employee)}::uuid,7)::text`;
  check('current exact phone reads pending accepted-revision target', JSON.parse(sql(readApplication)).application_status, 'PENDING');
  const appliedAt = sql('select statement_timestamp()::text');
  const ackApplication = (digestValue = 'e'.repeat(64), epoch = 7) => `set role service_role;select public.static_weekly_v10_ack_device_schedule_application(${q(intent)}::uuid,${q(device)}::uuid,${q(credential)}::uuid,${q(employee)}::uuid,${epoch},1,${q(projection)}::uuid,${q('d'.repeat(64))},${q(digestValue)},${q(appliedAt)}::timestamptz)::text`;
  const acked = JSON.parse(sql(ackApplication()));check('current phone appends device-reported application receipt', acked.application_status, 'DEVICE_REPORTED_APPLIED');
  check('exact application receipt retry is idempotent', JSON.parse(sql(ackApplication())).replayed, true);
  reject('changed rendered receipt replay denied', ackApplication('f'.repeat(64)), /different receipt/);
  reject('wrong assignment epoch cannot acknowledge target', ackApplication('e'.repeat(64), 8), /does not match/);
  check('current phone readback reports applied without claiming person read it', JSON.parse(sql(readApplication)).application_status, 'DEVICE_REPORTED_APPLIED');
  const managerDelivery = JSON.parse(sql(`set role static_weekly_control_plane;select public.static_weekly_v10_read_staffing_delivery_status(${q(first.operation_id)}::uuid,${q(otherManager)}::uuid)::text`));
  check('manager delivery view uses exact device readback evidence', managerDelivery.targets[0].status, 'DEVICE_REPORTED_APPLIED');
  reject('anon cannot call application read RPC', `set role anon;select public.static_weekly_v10_read_device_schedule_application('2026-09-30',${q(device)}::uuid,${q(credential)}::uuid,${q(employee)}::uuid,7)`, /permission denied/);
  reject('employee runtime cannot directly read application ledger', 'set role service_role;select * from public.static_weekly_schedule_application_intents', /permission denied/);
  const commandTable = 'public.static_weekly_staffing_commands';
  const beginSignature = sql("select 'public.static_weekly_v10_begin_staffing_command(jsonb,uuid,bigint,uuid)'::regprocedure::text");
  check('seven relation definitions inventoried', sql("select count(*) from public.custodial_release_authority_restore_inventory where object_kind='relation' and object_identity like 'public.static_weekly_%staffing%' or object_kind='relation' and object_identity like 'public.static_weekly_schedule_application_%'"), '7');
  check('begin function and grant inventoried', sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and object_identity like '%(%' and to_regprocedure(object_identity)=${q(beginSignature)}::regprocedure`), '2');
  const saved = sql(`select md5(jsonb_agg(to_jsonb(c) order by operation_id)::text) from ${commandTable} c`);
  const restore = (kind, identity) => `do $r$declare d text;begin select definition_sql into strict d from public.custodial_release_authority_restore_inventory where object_kind=${q(kind)} and object_identity=${q(identity)};execute d;end$r$;`;
  sql(`grant select on ${commandTable} to anon;` + restore('grant', commandTable));
  reject('recovered direct command table denial', `set role anon;select * from ${commandTable}`, /permission denied/);
  const triggerIdentity = `${commandTable}.trg_static_weekly_staffing_guard`;
  sql(`alter table ${commandTable} disable trigger trg_static_weekly_staffing_guard;` + restore('trigger', triggerIdentity));
  reject('recovered typed transition trigger', `update ${commandTable} set state='PREPARED' where operation_id=${q(first.operation_id)}::uuid`, /typed authority RPC/);
  check('recovery retained command bytes', sql(`select md5(jsonb_agg(to_jsonb(c) order by operation_id)::text) from ${commandTable} c`), saved);
  check('all new relations force RLS', sql("select count(*) from pg_class where oid in('public.static_weekly_staffing_commands'::regclass,'public.static_weekly_staffing_command_receipts'::regclass,'public.static_weekly_staffing_staged_candidates'::regclass,'public.static_weekly_staffing_absences'::regclass,'public.static_weekly_staffing_absence_cancellations'::regclass,'public.static_weekly_schedule_application_intents'::regclass,'public.static_weekly_schedule_application_receipts'::regclass) and relrowsecurity and relforcerowsecurity"), '7');
  check('UUID ledgers require no sequences', sql("select count(*) from pg_depend where refobjid in('public.static_weekly_staffing_commands'::regclass,'public.static_weekly_schedule_application_intents'::regclass) and classid='pg_class'::regclass and objid in(select oid from pg_class where relkind='S')"), '0');
  assert.equal(sql(defaults), '0'); checks++;
  console.log(JSON.stringify({ status: 'PASS', checks, migrations: files.length,
    automaticGrantsAbsentBeforeAndAfterEach: true, actualPostgres: true, synthetic: true,
    production: false, independentAudit: false, privateCandidatePrepared: true,
    authorityPublished: false, deviceReportedReceiptSyntheticOnly: true, physicalPhoneProof: false }));
} finally { cleanup(); }
