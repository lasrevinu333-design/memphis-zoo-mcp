// Actual PostgreSQL proof on an owned, network-isolated disposable database.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {buildEventStaticAuthoritySource,seedCompiledEventAuthority,eventAuthorityWeekStart} from './fixtures/event-static-authority-fixture.mjs';

const root=path.resolve(import.meta.dirname,'..');
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const container=`mz_schema_rebuild_memphis_day_${process.pid}`;
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,...options});
const raw=(statement)=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d','postgres'],
  {input:'set client_min_messages=warning;\n'+statement,stdio:['pipe','pipe','pipe']});
const sql=(statement)=>raw(statement).trim().split('\n').at(-1);
const q=(value)=>`'${String(value).replaceAll("'","''")}'`;
let owned=false,checks=0;
function check(actual,expected,label){assert.deepEqual(actual,expected,label);checks++;}
function denied(statement,label){let error;try{raw(statement);}catch(caught){error=caught;}assert.ok(error,label);assert.match(String(error.stderr),/42501|permission denied/i,label);checks++;}
function removeDefaults(){for(const owner of ['postgres','supabase_admin'])for(const scope of ['','in schema public'])raw(`alter default privileges for role ${owner} ${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner} ${scope} revoke all on sequences from public,anon,authenticated,service_role;`);}
try{
  docker(['image','inspect',image]);
  docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g',
    '-e','POSTGRES_PASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);
  owned=true;
  const info=JSON.parse(docker(['inspect',container]))[0];
  check(info.HostConfig.NetworkMode,'none','network isolated');
  check(Object.keys(info.HostConfig.PortBindings??{}).length,0,'no published ports');
  let ready=0;for(let i=0;i<120&&ready<5;i++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(resolve=>setTimeout(resolve,500));}
  check(ready,5,'PostgreSQL ready');removeDefaults();
  const migrations=readdirSync(path.join(root,'supabase/migrations')).filter(name=>name.endsWith('.sql')).sort();
  for(const [index,name] of migrations.entries()){
    try{raw(readFileSync(path.join(root,'supabase/migrations',name),'utf8'));}
    catch(error){throw new Error(`Migration ${name} failed: ${error.stderr||error.message}`);}
    const count=Number(sql("select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in(0,'public'::regnamespace) and d.defaclrole in('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in('r','S') and a.grantee in(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)"));
    if(count){assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(name));removeDefaults();}
    if((index+1)%40===0)console.log('APPLIED_MEMPHIS_MIGRATIONS',index+1);
  }
  console.log('EXACT_MEMPHIS_REPLAY_COMPLETE',migrations.length);
  const reader='public.custodial_memphis_schedule_day(date)';
  for(const role of ['postgres','service_role','custodial_application_reader'])
    check(sql(`select has_function_privilege(${q(role)},${q(reader)},'execute')::text;`),'true',`${role} execute`);
  for(const role of ['anon','authenticated','static_weekly_control_plane'])
    check(sql(`select has_function_privilege(${q(role)},${q(reader)},'execute')::text;`),'false',`${role} denied`);
  denied("set role anon;select public.custodial_memphis_schedule_day(date '2026-10-02');",'anon cannot invoke schedule reader');
  const [serviceDate,weekStart,nextWeek]=sql("select public.sch_service_date(now())::text||'|'||(public.sch_service_date(now())-(extract(isodow from public.sch_service_date(now()))::integer-1))::text||'|'||(public.sch_service_date(now())+7)::text;").split('|');
  const day=()=>JSON.parse(sql(`set role custodial_application_reader;select public.custodial_memphis_schedule_day(${q(serviceDate)}::date)::text;`));
  check(day().status,'unavailable','missing publication is unavailable');
  const manager=randomUUID(),person=randomUUID(),slot=randomUUID(),backup=randomUUID(),backupSlot=randomUUID(),location=randomUUID(),group=randomUUID();
  const label=`Memphis Test ${process.pid}`;
  raw(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
    values(${q(manager)}::uuid,'Synthetic Memphis Manager',array['CUSTODIAL_MANAGER','OPS_MANAGER'],true,false);
    insert into public.locations(id,location_code,location_name,location_type,form_type,active)
    values(${q(location)}::uuid,'MEMPHIS_DAY','Synthetic Memphis restroom','restroom','restroom',true);
    insert into public.location_groups(id,group_code,group_name,active)
    values(${q(group)}::uuid,'MEMPHIS_DAY','Synthetic Memphis family',true);
    insert into public.location_group_memberships(location_id,location_group_id,active)
    values(${q(location)}::uuid,${q(group)}::uuid,true);
    insert into public.employees(id,employee_code,display_name,active,role)
    values(${q(person)}::uuid,'MEMPHIS_DAY_PERSON',${q(label)},true,'staff'),
      (${q(backup)}::uuid,'MEMPHIS_DAY_BACKUP',${q(label+' Backup')},true,'staff');
    insert into public.msg_users(employee_id,display_name,role,is_active)
    values(${q(person)}::uuid,${q(label)},'employee',true),
      (${q(backup)}::uuid,${q(label+' Backup')},'employee',true);`);
  const source=buildEventStaticAuthoritySource({weekStart:eventAuthorityWeekStart(serviceDate),
    employees:[{id:person,slotId:slot,displayName:label},{id:backup,slotId:backupSlot,displayName:label+' Backup',noWork:true}],locationId:location,
    locationCode:'MEMPHIS_DAY',locationName:'Synthetic Memphis family',label:'memphis-day'});
  const fixture=await seedCompiledEventAuthority({sql,container,managerId:manager,dates:[serviceDate],source,label:'memphis-day',mode:'official'});
  const published=day();
  check(published.status,'current','current accepted publication visible');
  check(published.rows.length,2,'exact current employees');
  check(published.rows.find(row=>row.employee_id===person)?.working,true,'accepted working availability');
  check(published.rows.find(row=>row.employee_id===person)?.shift_start,'07:00','compiled shift not legacy template');
  check(JSON.stringify(published).includes('reason'),false,'private reason omitted');
  const segments=JSON.parse(sql(`set role custodial_application_reader;
    select jsonb_build_object('authority',to_jsonb(a),'assignments',
      (select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb)
        from public.static_weekly_v6_read_schedule_segments(${q(serviceDate)}::date) s
        where s.publication_id=a.publication_id and s.projection_id=a.projection_id
          and s.owner_type='EMPLOYEE' and s.status='ASSIGNED'))::text
    from public.static_weekly_v6_schedule_authority_state(${q(serviceDate)}::date) a;`));
  check(segments.authority.projection_id,published.projection_id,'authenticated reader segments bind exact projection');
  check(segments.assignments.length>0,true,'authenticated reader sees compiled current assignment');
  check(segments.assignments.every(row=>published.rows.some(personRow=>personRow.employee_id===row.assigned_employee_id&&personRow.working)),
    true,'authenticated assignment owner is accepted working person');
  const area=JSON.parse(sql(`set role custodial_application_reader;
    select jsonb_build_object('authority',to_jsonb(a),'assignments',
      (select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('current_at_query',
        s.coverage_start::time<=(now() at time zone 'America/Chicago')::time
        and (now() at time zone 'America/Chicago')::time<s.coverage_end::time)
        order by s.coverage_start,s.segment_number),'[]'::jsonb)
        from public.static_weekly_v6_read_schedule_segments(${q(serviceDate)}::date) s
        where s.location_group_id=${q(group)}::uuid and s.owner_type='EMPLOYEE'
          and s.status='ASSIGNED' and s.publication_id=a.publication_id
          and s.projection_id=a.projection_id))::text
    from public.static_weekly_v6_schedule_authority_state(${q(serviceDate)}::date) a;`));
  check(area.authority.projection_id,published.projection_id,'authenticated area read binds exact projection');
  check(area.assignments.some(row=>published.rows.some(personRow=>personRow.employee_id===row.assigned_employee_id&&personRow.working)
    &&typeof row.current_at_query==='boolean'),true,'authenticated area read has current-time fact without legacy owner shortcut');
  check(JSON.parse(sql(`set role custodial_application_reader;select public.custodial_memphis_schedule_day(${q(nextWeek)}::date)::text;`)).status,'unavailable','missing future projection does not reuse current week');
  const historyBefore=sql("select count(*)::text||'|'||coalesce(max(authority_revision),0)::text from public.weekly_schedule_authority_revisions;");
  const revision=Number(sql('select current_revision from public.static_weekly_schedule_control where singleton;'));
  const accepted=JSON.parse(sql(`set role static_weekly_control_plane;
    select public.static_weekly_v3_apply_exception('pto',${q(serviceDate)}::date,null,null,
      ${q(fixture.versionId)}::uuid,${q(fixture.publicationId)}::uuid,'Private synthetic absence reason',
      jsonb_build_object('slotId',${q(slot)}::uuid),${revision},${q(manager)}::uuid,
      ${q(`memphis-absence-${randomUUID()}`)},null)::text;`));
  check(accepted.data.exception_id?.length>0,true,'accepted dated absence command receipt');
  const stale=day();
  check(stale.status,'unavailable','accepted exception without recompiled projection is unavailable');
  await fixture.recompile(weekStart);
  const absent=day();
  check(absent.status,'current','recompiled accepted absence remains current');
  check(absent.rows.find(row=>row.employee_id===person)?.working,false,'accepted absence suppresses work');
  check(absent.rows.find(row=>row.employee_id===person)?.shift_start,null,'off-day shift suppressed');
  check(JSON.stringify(absent).includes('Private synthetic absence reason'),false,'absence reason never returned');
  const historyAfterWrite=sql("select count(*)::text||'|'||coalesce(max(authority_revision),0)::text from public.weekly_schedule_authority_revisions;");
  day();day();
  check(sql("select count(*)::text||'|'||coalesce(max(authority_revision),0)::text from public.weekly_schedule_authority_revisions;"),historyAfterWrite,'reader preserves immutable authority history');
  assert.notEqual(historyAfterWrite,historyBefore);
  check(sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity=${q(reader)};`),'1','recovery definition bound');
  check(sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity=${q(reader)};`),'1','recovery grant bound');
  console.log('MEMPHIS_CURRENT_SCHEDULE_DB_PASS',JSON.stringify({checks,migrations:migrations.length,container,projection_id:absent.projection_id}));
}finally{if(owned)docker(['rm','-f',container],{timeout:30000});}
