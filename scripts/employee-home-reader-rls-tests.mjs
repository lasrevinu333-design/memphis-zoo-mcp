import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readHomeTimeFacts} from '../src/employee-home-time-facts.js';
import {readZooWideCoverage} from '../src/employee-zoo-wide-coverage.js';

// Isolated PostgreSQL permission fixture. Canonical freshness/dated readers are
// explicitly synthetic; the exact replacement, restore guards and application
// SQL execute unchanged. This is not a production restore or phone acceptance.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stem='20261110081113_custodial_home_reader_projection_scope';
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/pending-repairs',stem+'.json'),'utf8'));
const repair=fs.readFileSync(path.join(root,'docs/pending-repairs',stem+'.sql'),'utf8');
const target=manifest.target;
const original=target.inventory.find(r=>r.object_kind==='function').definition_sql;
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const day={service_date:'2026-11-10',employee_id:id(1),projection_id:id(2),publication_id:id(3),projection_status:'current'};
let homeQuery,zooQuery;
await readHomeTimeFacts({day,employeeId:id(1),runReadOnlySql:async q=>{homeQuery=q;return[];}});
await readZooWideCoverage({day,runReadOnlySql:async q=>{zooQuery=q;return[];}});
const call=`public.static_weekly_v27_read_home_time_facts('2026-11-10', '${id(1)}','${id(3)}','${id(2)}')`;
const assertSql=(condition,label)=>`do $check$ begin if not coalesce((${condition}),false) then raise exception '${label}';end if;raise notice '${label}_PASS';end $check$;\n`;
const reader=sql=>`set session authorization fixture_login;begin read only;\n${sql}\nrollback;reset session authorization;\n`;
const executeFact=(query,condition,label)=>`do $check$declare f jsonb;begin execute ${literal(query)} into f;if not coalesce((${condition}),false) then raise exception '${label}';end if;raise notice '${label}_PASS';end $check$;\n`;
const repairBody=repair.slice(repair.indexOf('begin;')+6).replace(/commit;\s*$/,'');
const rejected=(setup,reason,label)=>`begin;${setup}\ndo $negative$ begin begin execute ${literal(repairBody)};raise exception 'UNEXPECTED_ACCEPTANCE';exception when raise_exception then if position(${literal(reason)} in sqlerrm)=0 then raise;end if;raise notice '${label}_PASS';end;end $negative$;rollback;\n`;
const availability={slotId:id(5),incumbentPersonId:id(1),serviceDate:day.service_date,dayOfWeek:2,status:'working',shift:{start:'05:00',end:'14:00'},lunch:{start:'09:30',end:'10:30'}};
let sql=`create role custodial_application_reader;create role fixture_login login;grant custodial_application_reader to fixture_login;
create role service_role;create role anon;create role authenticated;create role static_weekly_control_plane;
create table public.employees(id uuid,active boolean,private_fixture text);insert into public.employees values('${id(1)}',true,'NOT_RETURNED');
create table public.weekly_schedule_compiled_projections(projection_id uuid,publication_id uuid,version_id uuid,week_start date,week_end date,projection_envelope jsonb);
insert into public.weekly_schedule_compiled_projections values('${id(2)}','${id(3)}','${id(4)}','2026-11-09','2026-11-15',${literal(JSON.stringify({private_fixture:'NOT_RETURNED',authority:{projectionAvailability:[availability]}}))}::jsonb);
alter table public.weekly_schedule_compiled_projections enable row level security;
alter table public.weekly_schedule_compiled_projections force row level security;
grant select on public.weekly_schedule_compiled_projections to custodial_application_reader;
grant select(id,active) on public.employees to custodial_application_reader;
create table public.home_roster_fixture(employee_id uuid,slot_id uuid,version_id uuid,publication_id uuid,projection_id uuid,projection_status text,active boolean,staffing_state text,governed boolean);
insert into public.home_roster_fixture values('${id(1)}','${id(5)}','${id(4)}','${id(3)}','${id(2)}','current',true,'working',true);
create table public.home_authority_fixture(current boolean);insert into public.home_authority_fixture values(true);
create function public.static_weekly_v6_read_roster(date) returns setof public.home_roster_fixture language sql stable security definer set search_path=pg_catalog,public as $$select r.* from public.home_roster_fixture r,public.home_authority_fixture a where a.current and $1='2026-11-10'::date$$;
create function public.static_weekly_v6_schedule_authority_state(date) returns table(projection_id uuid,publication_id uuid,version_id uuid,governed boolean,projection_status text) language sql stable security definer set search_path=pg_catalog,public as $$select distinct r.projection_id,r.publication_id,r.version_id,true,'current'::text from public.home_roster_fixture r,public.home_authority_fixture a where a.current and $1='2026-11-10'::date$$;
create function public.custodial_operational_location_assignments(date) returns table(service_date date,projection_id uuid,publication_id uuid,projection_status text,location_id uuid,assigned_employee_id uuid,assignment_status text,coverage_start time,coverage_end time) language sql stable security definer set search_path=pg_catalog,public as $$select $1,r.projection_id,r.publication_id,'current'::text,'${id(20)}'::uuid,r.employee_id,'assigned'::text,'05:00'::time,'14:00'::time from public.home_roster_fixture r,public.home_authority_fixture a where a.current$$;
create table public.home_dated_fixture(rec jsonb,roster jsonb);insert into public.home_dated_fixture values(null,'[]');
create function public.custodial_dated_record(date) returns jsonb language sql stable as $$select rec from public.home_dated_fixture$$;
create function public.custodial_dated_rows(text,date) returns jsonb language sql stable as $$select roster from public.home_dated_fixture$$;
create function public.static_weekly_digest_text(text) returns text language sql stable strict as $$select encode(sha256(convert_to($1,'UTF8')),'hex')$$;
${original};
revoke all on all functions in schema public from public;
grant execute on function public.static_weekly_v6_read_roster(date),public.static_weekly_v6_schedule_authority_state(date),public.custodial_operational_location_assignments(date) to custodial_application_reader;
grant execute on function ${target.identity} to service_role,custodial_application_reader;
create table public.custodial_release_authority_restore_inventory(object_kind text,object_identity text,restore_order integer,definition_sql text,definition_sha256 text,captured_at timestamptz);
${target.inventory.map(r=>`insert into public.custodial_release_authority_restore_inventory values(${literal(r.object_kind)},${literal(r.object_identity)},${r.restore_order},${literal(r.definition_sql)},${literal(r.definition_sha256)},clock_timestamp());`).join('\n')}
create function public.fixture_immutable() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
create trigger trg_custodial_release_authority_restore_inventory_immutable before insert or update or delete on public.custodial_release_authority_restore_inventory for each row execute function public.fixture_immutable();
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
create function public.custodial_release_canary_authority_surface() returns table(object_kind text,object_identity text,purpose text) language sql stable as $$select null::text,null::text,null::text where false$$;
create table public.home_dated_expected(value jsonb);
update public.home_dated_fixture set rec=jsonb_build_object('projectionStatus','current','publicationId','${id(3)}','projectionId','${id(2)}','phonePdfRevision','dated-fixture'),roster=jsonb_build_array(jsonb_build_object('employee_id','${id(1)}','employee_name','Fixture','active',true,'shift_start','07:00','shift_end','16:00','lunch_start','12:00','lunch_end','13:00'));
insert into public.home_dated_expected select ${call};update public.home_dated_fixture set rec=null;
`;
sql+=reader(assertSql(`(select count(*) from public.weekly_schedule_compiled_projections)=0 and (select count(*) from public.static_weekly_v6_read_roster('2026-11-10'))=1`,'RAW_RLS_ZERO_CANONICAL_ONE'));
sql+=rejected('create policy fixture_unexpected on public.weekly_schedule_compiled_projections for select using(true);','projection RLS predecessor differs','RLS_DRIFT_REFUSED');
sql+=rejected(`grant execute on function ${target.identity} to static_weekly_control_plane;`,'metadata differs','ACL_DRIFT_REFUSED');
sql+=rejected(original.replace('begin\n','begin\n -- Intentional fixture predecessor drift.\n')+';','predecessor differs','FUNCTION_DRIFT_REFUSED');
sql+=repair;
sql+=reader(executeFact(homeQuery,"f#>>'{availability,0,shift,start}'='05:00' and f#>>'{availability,0,lunch,start}'='09:30' and f->>'contract_version'='employee-home-projected-record.v1' and position('NOT_RETURNED' in f::text)=0",'BOUNDED_READER_RESTRICTED_LOGIN'));
sql+=reader(executeFact(zooQuery,"f->>'availability_authority'='bounded_home_reader.v1' and jsonb_array_length(f->'roster')=1 and f#>>'{roster,0,home_record,availability,0,lunch,start}'='09:30'",'ZOO_BOUNDED_RESTRICTED_LOGIN'));
sql+=reader(assertSql(`(select count(*) from public.weekly_schedule_compiled_projections)=0`,'RLS_REMAINS_ZERO_AFTER_REPAIR'));
for(const role of ['anon','authenticated','static_weekly_control_plane'])sql+=`set session authorization ${role};do $deny$begin begin perform ${call};raise exception 'unexpected permission';exception when insufficient_privilege then raise notice '${role.toUpperCase()}_DENIED_PASS';end;end $deny$;reset session authorization;\n`;
sql+=reader(assertSql(`${call.replace(id(3),id(99))} is null and ${call.replace(id(2),id(99))} is null and ${call.replace(id(1),id(99))} is null and ${call.replace('2026-11-10','2026-11-16')} is null`,'EXACT_BINDINGS_REFUSED'));
sql+=`update public.home_authority_fixture set current=false;`+reader(assertSql(`${call} is null`,'STALE_CANONICAL_REFUSED'))+`update public.home_authority_fixture set current=true;\n`;
sql+=`insert into public.home_roster_fixture select * from public.home_roster_fixture;`+reader(assertSql(`${call} is null`,'AMBIGUOUS_ROSTER_REFUSED'))+`delete from public.home_roster_fixture where ctid not in(select min(ctid) from public.home_roster_fixture);\n`;
sql+=`update public.weekly_schedule_compiled_projections set version_id='${id(99)}';`+reader(assertSql(`${call} is null`,'PROJECTION_VERSION_MISMATCH_REFUSED'))+`update public.weekly_schedule_compiled_projections set version_id='${id(4)}';\n`;
sql+=`update public.employees set active=false;`+reader(assertSql(`${call}->>'employee_active'='false'`,'INACTIVE_EMPLOYEE_PRESERVED'))+`update public.employees set active=true;\n`;
sql+=`update public.weekly_schedule_compiled_projections set projection_envelope=jsonb_set(projection_envelope,'{authority,projectionAvailability,0,blockedWindows}','[{"start":"05:00","end":"14:00"}]');`+reader(assertSql(`${call}#>>'{availability,0,blockedWindows,0,end}'='14:00'`,'APPROVED_ABSENCE_PRESERVED'));
sql+=`update public.home_dated_fixture set rec=jsonb_build_object('projectionStatus','current','publicationId','${id(3)}','projectionId','${id(2)}','phonePdfRevision','dated-fixture');`+assertSql(`${call}=(select value from public.home_dated_expected)`,'DATED_ORIGINAL_RESULT_UNCHANGED');
sql+=`update public.home_dated_fixture set rec=jsonb_set(rec,'{projectionStatus}','"stale"');`+reader(assertSql(`${call} is null`,'STALE_DATED_NO_NORMAL_FALLBACK'));
sql+=assertSql(`public.static_weekly_digest_text(pg_get_functiondef('${target.identity}'::regprocedure))=${literal(target.replacement_sha256)} and (select definition_sha256 from public.custodial_release_authority_restore_inventory where object_kind='function')=${literal(target.replacement_sha256)} and (select tgenabled='A' from pg_trigger where tgname='trg_custodial_release_authority_restore_inventory_immutable')`,'REPAIR_READBACK_AND_ALWAYS_GUARD');

const out=process.env.CUSTODIAL_RLS_FIXTURE_EVIDENCE_DIR;
if(out){assert.ok(path.isAbsolute(out)&&fs.statSync(out).isDirectory());fs.writeFileSync(path.join(out,'au13-generated-rls-fixture.sql'),sql);}
const name=`custodial-au13-rls-${process.pid}`;
const image='public.ecr.aws/supabase/postgres:17.6.1.165';
const command=`set -eu
initdb -D /tmp/au13-pg --auth=trust >/dev/null
pg_ctl -D /tmp/au13-pg -l /tmp/au13-postgres.log -o '-c shared_buffers=16MB -c listen_addresses= -k /tmp' -w start >/dev/null
psql -X -v ON_ERROR_STOP=1 -h /tmp -U postgres -d postgres
`;
let result;
try{
 assert.equal(spawnSync('docker',['image','inspect',image],{stdio:'ignore',timeout:10000}).status,0,'Fixture image must already be cached; no pull');
 result=spawnSync('docker',['run','--rm','--network','none','--name',name,'-i','--user','postgres','--entrypoint','bash',image,'-c',command],{input:sql,encoding:'utf8',timeout:90000,maxBuffer:5*1024*1024});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
 assert.equal(result.status,0,result.error?.message||'PostgreSQL fixture failed');
 assert.equal((result.stderr.match(/_PASS/g)||[]).length,19,'All positive/negative database controls must run');
 console.log('HOME_BOUNDED_READER_RLS_FIXTURE_PASS: exact repair and application queries, 19 controls, synthetic canonical readers; no production or phone effect.');
}finally{
 spawnSync('docker',['rm','-f',name],{stdio:'ignore',timeout:10000});
 const absent=spawnSync('docker',['container','inspect',name],{stdio:'ignore',timeout:10000}).status!==0;
 if(out)fs.writeFileSync(path.join(out,'au13-owned-rls-fixture-cleanup.json'),JSON.stringify({container:name,network:'none',publishedPorts:0,removed:absent},null,2)+'\n');
 assert.ok(absent,'Owned fixture cleanup required');
}
