import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
// Synthetic roster/history in an explicitly isolated local PostgreSQL database.
const container=process.env.ROSTER_PUBLICATION_TEST_CONTAINER;
assert.match(container??'',/^(?:mz_schema_rebuild_roster_|mz_schema_shift_end_)[0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
const q=x=>`'${String(x).replaceAll("'","''")}'`;
const j=x=>`${q(JSON.stringify(x))}::jsonb`;
function sql(text){return execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:text,encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000}).trim().split('\n').at(-1);}
const parsed=text=>JSON.parse(sql(text));let passed=0;
function check(name,actual,expected){assert.deepEqual(actual,expected,name);passed++;}
function rejected(name,text,pattern){assert.throws(()=>sql(text),pattern,name);passed++;}
check('vacancy command exists',sql("select (to_regprocedure('public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)') is not null)::text"),'true');
const manager=randomUUID(),sourceId=randomUUID(),slot=randomUUID(),employee=randomUUID(),incumbency=randomUUID();
const start=sql("select (public.sch_service_date(now())-30)::text"),effective=sql("select public.sch_service_date(now())::text");
const revision=()=>Number(sql('select current_revision from public.static_weekly_schedule_control where singleton'));
sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
 values(${q(manager)},'Synthetic Vacancy Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);
 insert into public.employees(id,employee_code,display_name,role,active)
 values(${q(employee)},'EMP901','Synthetic Former Custodian','staff',true);
 insert into public.msg_users(employee_id,display_name,role,is_active)
 values(${q(employee)},'Synthetic Former Custodian','employee',true);
 insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
 values(${q(slot)},'SYNTHETIC_VACANCY_'||${q(slot)},'Synthetic stable position',${q(manager)},'Synthetic Vacancy Manager',repeat('a',64));
 insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
 values(${q(incumbency)},${q(slot)},${q(employee)},'Synthetic Former Custodian',${q(start)},${q(manager)},'Synthetic Vacancy Manager',repeat('b',64));`);
const source={serviceDate:effective,timezone:'America/Chicago',exceptions:[],proximity:[],slots:[{id:slot,label:'Synthetic stable position',incumbencies:[{personId:employee,displayName:'Synthetic Former Custodian',effectiveStart:start,effectiveEnd:effective}]}],version:{id:randomUUID(),publicationId:randomUUID(),status:'published',effectiveStart:effective,effectiveEnd:null,objective:{},vacancyCapableSlotIds:[slot],vacantSlotIds:[slot],slotAvailability:[],assignments:[]}};
sql(`set role static_weekly_release_operator; select public.static_weekly_v3_register_authority_source(${q(sourceId)},${j(source)},'synthetic-vacancy-test');`);
const inputRevision=revision(),key='vacate-'+slot;
function call({actor=manager,source=sourceId,person=employee,date=effective,requestKey=key,expected=inputRevision,reason='Owner confirmed position is vacant'}={}){return `set role static_weekly_control_plane; select public.static_weekly_v8_vacate_roster_slot(${q(source)},${q(slot)},${q(person)},${q(date)},${q(reason)},${expected},${q(actor)},${q(requestKey)})::text`;}
const original=sql(`select to_jsonb(i)::text from public.weekly_roster_slot_incumbencies i where incumbency_id=${q(incumbency)}`);
const peopleBefore=sql('select count(*)::text from public.employees'),usersBefore=sql('select count(*)::text from public.msg_users');
rejected('unknown source rejected',call({source:randomUUID()}),/registered.*source|source.*active/i);
rejected('wrong predecessor rejected',call({person:randomUUID()}),/incumbent|predecessor/i);
rejected('unnamed manager rejected',call({actor:randomUUID()}),/manager/i);
rejected('old revision rejected',call({expected:inputRevision+10}),/revision/i);
rejected('past date cannot rewrite history',call({date:start}),/non-past|effective date/i);
const deniedSource=structuredClone(source);deniedSource.version.vacancyCapableSlotIds=[];deniedSource.version.vacantSlotIds=[];
const deniedId=randomUUID();sql(`set role static_weekly_release_operator; select public.static_weekly_v3_register_authority_source(${q(deniedId)},${j(deniedSource)},'synthetic-nonvacancy-test');`);
rejected('source must authorize an actual vacancy',call({source:deniedId}),/vacant|vacancy/i);
const concurrent=await Promise.all([0,1].map(async()=>{
 const {stdout}=await promisify(execFile)('docker',['exec',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-c',call()],{encoding:'utf8',timeout:120000});
 return JSON.parse(stdout.trim().split('\n').at(-1));
}));
const answer=concurrent[0];check('identical concurrent calls return one receipt',concurrent[1],answer);
check('one revision advanced',answer.revision,inputRevision+1);
check('no replacement invented',answer.data.replacement_employee_id,null);
check('same position returned',answer.data.slot_id,slot);
check('actual employee retained',answer.data.former_employee_id,employee);
check('history row byte-identical',sql(`select to_jsonb(i)::text from public.weekly_roster_slot_incumbencies i where incumbency_id=${q(incumbency)}`),original);
check('person count unchanged',sql('select count(*)::text from public.employees'),peopleBefore);
check('messenger identity count unchanged',sql('select count(*)::text from public.msg_users'),usersBefore);
check('former employee inactive',sql(`select active::text from public.employees where id=${q(employee)}`),'false');
check('former messenger principal inactive',sql(`select is_active::text from public.msg_users where employee_id=${q(employee)}`),'false');
check('old effective range preserved',sql(`select count(*)::text from public.v_weekly_roster_slot_incumbency_ranges where slot_id=${q(slot)} and effective_start<=${q(start)}::date and ${q(start)}::date<effective_end`),'1');
check('no incumbent on vacancy date',sql(`select count(*)::text from public.v_weekly_roster_slot_incumbency_ranges where slot_id=${q(slot)} and effective_start<=${q(effective)}::date and (effective_end is null or ${q(effective)}::date<effective_end)`),'0');
check('closed range matches vacancy date',sql(`select effective_end::text from public.v_weekly_roster_slot_incumbency_ranges where incumbency_id=${q(incumbency)}`),effective);
check('same retry returns original receipt',parsed(call()),answer);
check('one append-only closure',sql(`select count(*)::text from public.weekly_roster_slot_incumbency_closures where closed_incumbency_id=${q(incumbency)} and replacement_incumbency_id is null`),'1');
rejected('different retry cannot reuse key',call({reason:'different reason'}),/idempotency/i);
rejected('new command cannot close again',call({expected:revision(),requestKey:'again-'+key}),/incumbent|predecessor/i);
rejected('old immutable employee history cannot be deleted',`delete from public.weekly_roster_slot_incumbencies where incumbency_id=${q(incumbency)}`,/append-only|immutable/i);
rejected('vacancy closure cannot be removed',`delete from public.weekly_roster_slot_incumbency_closures where closed_incumbency_id=${q(incumbency)}`,/append-only|immutable/i);
for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator'])check(role+' cannot vacate',sql(`select has_function_privilege(${q(role)},'public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)','execute')::text`),'false');
check('only control plane is authorized',sql("select has_function_privilege('static_weekly_control_plane','public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)','execute')::text"),'true');
const afterHydration=parsed(`set role static_weekly_control_plane; select public.static_weekly_v3_read_authority_source(${q(sourceId)},${q(effective)}::date)::text`);
// A midweek closure remains historical in that week; a following Monday has no incumbent.
const nextMonday=sql(`select (${q(effective)}::date+(8-extract(isodow from ${q(effective)}::date)::integer))::text`);
const nextHydration=parsed(`set role static_weekly_control_plane; select public.static_weekly_v3_read_authority_source(${q(sourceId)},${q(nextMonday)}::date)::text`);
check('dated source now resolves true vacancy',nextHydration.compiler_input.version.vacantSlotIds,[slot]);
check('dated source does not revive former employee',nextHydration.compiler_input.slots[0].incumbencies,[]);
check('source retained closure for current-week history',afterHydration.compiler_input.slots[0].incumbencies.every(x=>x.effectiveEnd===effective),true);

rejected('future vacancy cannot deactivate a current employee',call({date:nextMonday,requestKey:'future-'+key,expected:revision()}),/current service date/i);
const functions=[
 'public.static_weekly_v8_guard_vacancy_closure()',
 'public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)',
 'public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text)',
 'public.static_weekly_v9_fill_vacant_roster_slot(uuid,uuid,text,date,text,bigint,uuid,text)',
 'public.static_weekly_v4_hydrate_compiler_source(jsonb,date)',
 'public.static_weekly_v3_assert_draft_incumbency(uuid)'
];
for(const identity of functions){
 check('recovery function matches '+identity,sql(`select count(*)::text from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity=${q(identity)} and definition_sql=pg_get_functiondef(to_regprocedure(${q(identity)}))`),'1');
 check('recovery grants match '+identity,sql(`select count(*)::text from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity=${q(identity)} and definition_sql=public.custodial_release_authority_current_grant_definition(${q(identity)})`),'1');
}
check('recovery preserves nullable vacancy closure',sql("select count(*)::text from public.custodial_release_authority_restore_inventory where object_kind='column' and object_identity='public.weekly_roster_slot_incumbency_closures:replacement_incumbency_id' and definition_sql=public.custodial_release_authority_current_column_definition(object_identity)"),'1');
const fillArgs=`${q(sourceId)},${q(slot)},'Synthetic Next Hire',${q(nextMonday)},'Test future hire',${revision()},${q(manager)},${q('refill-'+slot)}`;
const refillSql=`set role static_weekly_control_plane; select public.static_weekly_v9_fill_vacant_roster_slot(${fillArgs})::text`;
const refilled=parsed(refillSql);
check('vacated position can be filled',refilled.data.slot_id,slot);
check('new hire does not reuse former identity',refilled.data.new_employee_id===employee,false);
check('old person remains inactive after refill',sql(`select active::text from public.employees where id=${q(employee)}`),'false');
check('new hire creates no phone assignment',refilled.data.phone_assignment,null);
check('refill retry is idempotent',parsed(refillSql),refilled);
const originalServiceClock=parsed("select to_json(pg_get_functiondef('public.sch_service_date(timestamptz)'::regprocedure))::text");
const followingWeek=sql(`select (${q(nextMonday)}::date+7)::text`);
try {
 sql(`create or replace function public.sch_service_date(p_at timestamptz default now()) returns date language sql stable as $$select ${q(followingWeek)}::date$$`);
 check('lost acknowledgement replays after effective week ends',parsed(refillSql),refilled);
 rejected('cross-week changed input still conflicts with original receipt',refillSql.replace('Synthetic Next Hire','Synthetic Different Hire'),/idempotency/i);
 rejected('new command cannot retroactively fill an older week',refillSql.replace('refill-'+slot,'new-old-week-'+slot),/before the current week/i);
} finally { sql(originalServiceClock); }
check('only one new hire created',Number(sql('select count(*)::text from public.employees')),Number(peopleBefore)+1);
check('exact new hire owns the next week',sql(`select person_id::text from public.v_weekly_roster_slot_incumbency_ranges where slot_id=${q(slot)} and effective_start<=${q(nextMonday)}::date and (effective_end is null or ${q(nextMonday)}::date<effective_end)`),refilled.data.new_employee_id);
rejected('second future hire cannot occupy already-reserved slot',`set role static_weekly_control_plane; select public.static_weekly_v9_fill_vacant_roster_slot(${q(sourceId)},${q(slot)},'Synthetic Duplicate Hire',${q(nextMonday)},'Rejected duplicate',${revision()},${q(manager)},'duplicate-refill')`,/no current or future incumbent/i);

// Execute the production recovery controller against synthetic data only.
// Restore the complete ordered inventory, not just the newly captured hashes.
const releaseManager=randomUUID(),secret='synthetic-vacancy-recovery-never-production-0123456789';
sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active) values(${q(releaseManager)},'Synthetic Recovery Director',array['DIRECTOR'],true);
 select public.custodial_configure_backend_execution_key(encode(extensions.digest(convert_to(${q(secret)},'UTF8'),'sha256'),'hex'),'synthetic vacancy recovery');`);
const releaseAction=action=>`select public.custodial_control_release_canary(${q(releaseManager)},${q(randomUUID())},'KIOSK_08',${q(action)},'Synthetic isolated vacancy recovery','{}'::jsonb,${q(secret)})::text`;
check('isolated canary paused for restore',parsed(releaseAction('pause_canary')).canary_paused,true);
const beforeRecovery=sql(`select jsonb_build_object('history',(select jsonb_agg(to_jsonb(i) order by incumbency_id) from public.weekly_roster_slot_incumbencies i),'closures',(select jsonb_agg(to_jsonb(c) order by incumbency_closure_id) from public.weekly_roster_slot_incumbency_closures c),'receipts',(select jsonb_agg(to_jsonb(r) order by command_id) from public.weekly_schedule_command_receipts r))::text`);
sql('drop function public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text); drop trigger trg_static_weekly_v8_guard_vacancy_closure on public.weekly_roster_slot_incumbency_closures;');
check('missing writer is established before recovery',sql("select (to_regprocedure('public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)') is null)::text"),'true');
const restored=parsed(releaseAction('restore_authority'));
check('complete inventory actually replayed',restored.restored_objects>100,true);
check('restore keeps canary paused',restored.canary_paused,true);
check('historical rows and receipts survive recovery',sql(`select jsonb_build_object('history',(select jsonb_agg(to_jsonb(i) order by incumbency_id) from public.weekly_roster_slot_incumbencies i),'closures',(select jsonb_agg(to_jsonb(c) order by incumbency_closure_id) from public.weekly_roster_slot_incumbency_closures c),'receipts',(select jsonb_agg(to_jsonb(r) order by command_id) from public.weekly_schedule_command_receipts r))::text`),beforeRecovery);
check('vacancy receipt replays after actual restoration',parsed(call()),answer);
check('refill receipt replays after actual restoration',parsed(refillSql),refilled);
for(const identity of functions)check('restored exact function '+identity,sql(`select (definition_sql=pg_get_functiondef(to_regprocedure(${q(identity)})))::text from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity=${q(identity)}`),'true');
check('vacancy guard restored',sql("select count(*)::text from pg_trigger where tgrelid='public.weekly_roster_slot_incumbency_closures'::regclass and tgname='trg_static_weekly_v8_guard_vacancy_closure' and tgenabled<>'D'"),'1');

console.log(JSON.stringify({passed,failed:0,fixture:'isolated registered-source vacancy conversion',production_written:false,employee_deleted:false,synthetic_employee_created_in_production:false},null,2));
