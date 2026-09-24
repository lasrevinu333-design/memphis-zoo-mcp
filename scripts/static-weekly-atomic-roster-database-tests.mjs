import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const container=process.env.SHIFT_END_TEST_CONTAINER;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const sql=text=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
 {input:text,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024}).trim().split('\n').at(-1);
const json=text=>JSON.parse(sql(text));let checks=0;
const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;console.log('PASS',name);};
const reject=(name,query,pattern=/ERROR/)=>{assert.throws(()=>sql(query),pattern,name);checks++;console.log('PASS',name);};
const manager='10000000-0000-4000-8000-000000000095',sourceId='50000000-0000-4000-8000-000000000095';
const slots=[1,2,3,4].map(n=>`20000000-0000-4000-8000-00000000009${n}`),employee='40000000-0000-4000-8000-000000000095';
const today=sql('select public.sch_service_date(statement_timestamp())::text;');
const week=sql("select (public.sch_service_date(statement_timestamp())-(extract(isodow from public.sch_service_date(statement_timestamp()))::int-1))::text;");
const restoreDate=sql('select (public.sch_service_date(statement_timestamp())+1)::text;');
const revision=()=>Number(sql('select current_revision from public.static_weekly_schedule_control where singleton;'));
const cp=(name,args)=>`set role static_weekly_control_plane;select public.${name}(${args})::text;`;
sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
 values(${q(manager)},'Synthetic Atomic Roster Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);
 insert into public.employees(id,employee_code,display_name,role,active) values(${q(employee)},'EMP995','Synthetic Restored Custodian','staff',false);
 insert into public.msg_users(employee_id,display_name,role,is_active) values(${q(employee)},'Synthetic Restored Custodian','employee',false);`);
for(const [index,id] of slots.entries())json(cp('static_weekly_v7_create_vacant_roster_slot',`${q(id)},'Synthetic Position ${index}',${revision()},${q(manager)},'create-synthetic-${index}'`));
const source={serviceDate:week,exceptions:[],proximity:[],slots:slots.map((id,index)=>({id,label:`Synthetic Position ${index}`,
 incumbencies:index===3?[{personId:employee,displayName:'Synthetic Restored Custodian',effectiveStart:restoreDate,effectiveEnd:null}]:[]})),
 version:{id:'60000000-0000-4000-8000-000000000095',publicationId:'70000000-0000-4000-8000-000000000095',status:'published',
 effectiveStart:week,effectiveEnd:null,objective:{},vacancyCapableSlotIds:slots.slice(0,3),vacantSlotIds:slots.slice(0,3),slotAvailability:[],assignments:[]}};
sql(`set role static_weekly_release_operator;select public.static_weekly_v3_register_authority_source(${q(sourceId)},${j(source)},'synthetic atomic roster test');`);
const initial=revision();
const fill=(id,expected,key='fill-synthetic',source=sourceId,name='Synthetic New Hire')=>cp('static_weekly_v9_fill_vacant_roster_slot',
 `${q(source)},${q(id)},${q(name)},${q(week)},'Synthetic hire only',${expected},${q(manager)},${q(key)}`);
const state=()=>json(`select jsonb_build_object('revision',(select current_revision from public.static_weekly_schedule_control where singleton),
 'employees',(select count(*) from public.employees),'incumbencies',(select count(*) from public.weekly_roster_slot_incumbencies),
 'staffing',(select count(*) from public.weekly_roster_slot_staffing_states),'receipts',(select count(*) from public.weekly_schedule_command_receipts))::text;`);
const before=state();
reject('unknown source cannot fill',fill(slots[0],initial,'unknown-source','50000000-0000-4000-8000-000000000000'),/active registered source/);
reject('non-vacancy-capable source position cannot fill',fill(slots[3],initial),/vacancy-capable/);
reject('legacy unbound fill is not callable',cp('static_weekly_v7_fill_vacant_roster_slot',`${q(slots[0])},'Synthetic',${q(week)},'Synthetic',${initial},${q(manager)},'legacy-bypass'`),/permission denied/);
check('failed source admission changes nothing',state(),before);
const filled=json(fill(slots[0],initial));check('fill chooses original mutation-only mode',filled.data.completion_mode,'mutation_only');
check('fill binds original absent publication',filled.data.original_publication_id,null);
check('fill binds exact source',filled.data.source_id,sourceId);check('fill advances once',filled.revision,initial+1);
check('same fill returns exact receipt',json(fill(slots[0],initial)),filled);
check('completed fill returns same immutable response',json(cp('static_weekly_v9_read_completed_roster_change',`${q(manager)},'fill-synthetic','fill_vacant_slot'`)),filled);
reject('different same-key semantics rejected',fill(slots[0],initial,'fill-synthetic',sourceId,'Changed Synthetic Hire'),/idempotency/);
const beforeFailure=state();
reject('in-transaction downstream failure aborts new employee and staffing',`begin;${fill(slots[1],revision(),'rollback-fill',sourceId,'Synthetic Rollback Hire')}
 do $x$begin raise exception 'injected downstream projection failure';end$x$;commit;`,/injected downstream/);
check('rolled-back fill leaves every authority count unchanged',state(),beforeFailure);
const restoreRevision=revision(),restore=cp('static_weekly_v8_restore_existing_employee',
 `${q(sourceId)},${q(slots[3])},${q(employee)},${q(restoreDate)},'Synthetic existing identity restore',${restoreRevision},${q(manager)},'restore-synthetic'`);
const restored=json(restore);check('restore retains same employee',restored.data.employee_id,employee);
check('restore chooses original mutation-only mode',restored.data.completion_mode,'mutation_only');
check('restore no phone invented',restored.data.phone_assignment,null);
check('restore does not create person',state().employees,beforeFailure.employees);
check('restore exact replay',json(restore),restored);
check('completed restore exact response',json(cp('static_weekly_v9_read_completed_roster_change',`${q(manager)},'restore-synthetic','restore_existing_employee'`)),restored);
reject('completed reader rejects unsupported operation',cp('static_weekly_v9_read_completed_roster_change',`${q(manager)},'restore-synthetic','invented'`),/exact manager and command identity/);
check('cross-operation receipt is SQL null',sql(`set role static_weekly_control_plane;select (public.static_weekly_v9_read_completed_roster_change(${q(manager)},'restore-synthetic','fill_vacant_slot') is null)::text;`),'true');
for(const role of ['anon','authenticated','service_role','static_weekly_release_operator','custodial_application_reader']){
 reject('unauthorized '+role+' cannot read completion',`set role ${role};select public.static_weekly_v9_read_completed_roster_change(${q(manager)},'fill-synthetic','fill_vacant_slot');`,/permission denied/);
}
for(const identity of ['public.static_weekly_v9_roster_completion_context(uuid,uuid,date,boolean)',
 'public.static_weekly_v9_fill_vacant_roster_slot(uuid,uuid,text,date,text,bigint,uuid,text)',
 'public.static_weekly_v9_read_completed_roster_change(uuid,text,text)',
 'public.static_weekly_v8_restore_existing_employee(uuid,uuid,uuid,date,text,bigint,uuid,text)']){
 for(const kind of ['function','grant'])check('exact recovery '+kind+' '+identity,sql(`select count(*)::text from public.custodial_release_authority_restore_inventory
  where object_kind=${q(kind)} and (case when object_kind in ('function','grant') then to_regprocedure(object_identity) end)=${q(identity)}::regprocedure
  and definition_sql=${kind==='function'?`pg_get_functiondef(${q(identity)}::regprocedure)`:`public.custodial_release_authority_current_grant_definition(${q(identity)})`};`),'1');
}
console.log(JSON.stringify({status:'PASS',checks,noPublicationSqlProof:true,publishedWeekAtomicSqlProof:false,production:false,independentAudit:false}));
