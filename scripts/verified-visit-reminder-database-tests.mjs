import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const container=process.env.VERIFIED_VISIT_TEST_CONTAINER;
assert.match(container??'',/^mz_verified_visit_[0-9]+$/,'explicit owned isolated container required');
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
function sql(text){return execFileSync('docker',['exec','-i',container,'psql','-X','-v',
  'ON_ERROR_STOP=1','-At','-U','supabase_admin','-d','postgres'],
  {input:text,encoding:'utf8',maxBuffer:8*1024*1024,timeout:30000}).trim();}
let passed=0;
function check(name,text,expected){assert.equal(sql(text),expected,name);passed++;}
const at=t=>`'2026-09-22 ${t}:00-05'::timestamptz`;
function cycle(form,now,checked='null',cleaned=at('09:00')){
 return `public.mz_verified_visit_reminder_cycle('${form}',${cleaned},${checked},${at(now)})`;
}
for(const [form,now,status,index] of [
 ['restroom','10:14','none',0],['restroom','10:15','due_soon',0],
 ['restroom','10:29','due_soon',0],['restroom','10:30','overdue',0],
 ['restroom','10:34','overdue',0],['restroom','10:35','overdue',1],
 ['restroom','10:40','overdue',2],['restroom','12:00','overdue',18],
 ['exhibit','12:14','none',0],['exhibit','12:15','due_soon',0],
 ['exhibit','12:29','due_soon',0],['exhibit','12:30','overdue',0],
 ['exhibit','12:35','overdue',1],['exhibit','12:40','overdue',2],
])check(`${form} ${now}`,`select coalesce(status_code,'none')||':'||repeat_index from ${cycle(form,now)}`,`${status}:${index}`);
check('unarmed without actual cleaning',`select count(*) from ${cycle('restroom','10:40',at('10:35'),'null')}`,'0');
check('checkout clears overdue',`select coalesce(status_code,'none')||':'||cycle_base_evidence from ${cycle('restroom','10:40',at('10:37'))}`,'none:verified_check_checkout');
check('check due soon after75',`select status_code from ${cycle('restroom','11:52',at('10:37'))}`,'due_soon');
check('check overdue after90',`select status_code||':'||repeat_index from ${cycle('restroom','12:07',at('10:37'))}`,'overdue:0');
check('check overdue repeats after5',`select status_code||':'||repeat_index from ${cycle('restroom','12:12',at('10:37'))}`,'overdue:1');
check('old checkout cannot roll back new clean',`select cycle_base_evidence from ${cycle('restroom','12:00',at('10:00'),at('11:00'))}`,'completed_cleaning');
check('future checkout ignored',`select cycle_base_evidence from ${cycle('restroom','10:40',at('12:00'))}`,'completed_cleaning');
check('no future cleaning arming',`select count(*) from ${cycle('restroom','10:40','null',at('12:00'))}`,'0');
check('unknown area excluded',`select count(*) from ${cycle('other','12:00')}`,'0');
check('candidate has no provider clock','select (position(\'employee_native_push_delivery_receipts\' in pg_get_functiondef(\'public.mz_location_reminder_candidates(date,timestamptz)\'::regprocedure))=0)::text','true');
for(const signature of ['mz_latest_verified_check(uuid,timestamptz,timestamptz)',
 'mz_verified_visit_reminder_cycle(text,timestamptz,timestamptz,timestamptz)',
 'mz_location_reminder_candidates(date,timestamptz)']) {
 check('no public execute '+signature,`select (not has_function_privilege('anon','public.${signature}','EXECUTE') and not has_function_privilege('authenticated','public.${signature}','EXECUTE'))::text`,'true');
 check('recovery binding '+signature,`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity='${signature.replaceAll('timestamptz','timestamp with time zone')}' and definition_sha256=encode(extensions.digest(convert_to(pg_get_functiondef('public.${signature}'::regprocedure),'UTF8'),'sha256'),'hex')`,'1');
}
check('timer uses90 and not open-work as completion',`select (position('01:30:00' in pg_get_viewdef('public.v_restroom_check_timers'::regclass,true))>0 and position('custodial_open_work' in pg_get_viewdef('public.v_restroom_check_timers'::regclass,true))=0)::text`,'true');
check('all minute boundaries for both area types',`select count(*) from (values ('restroom',75,90),('exhibit',195,210)) spec(form_type,due,overdue) cross join generate_series(0,600) elapsed cross join lateral public.mz_verified_visit_reminder_cycle(spec.form_type,'2026-09-22 09:00-05',null,'2026-09-22 09:00-05'::timestamptz+make_interval(mins=>elapsed)) actual where actual.status_code is distinct from case when elapsed>=spec.overdue then 'overdue' when elapsed>=spec.due then 'due_soon' else null end or actual.repeat_index<>case when elapsed>=spec.overdue then (elapsed-spec.overdue)/5 else 0 end`,'0');
check('five-minute boundary exact to millisecond',`select string_agg(repeat_index::text,',' order by elapsed) from (values(interval '94 minutes 59.999 seconds'),(interval '95 minutes')) offsets(elapsed) cross join lateral public.mz_verified_visit_reminder_cycle('restroom','2026-09-22 09:00-05',null,'2026-09-22 09:00-05'::timestamptz+elapsed)`,'0,1');
for(const name of ['v_location_dashboard_status','v_restroom_check_timers'])check('view recovery '+name,`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='view' and object_identity='public.${name}' and definition_sql=public.custodial_release_authority_current_view_definition('public.${name}')`,'1');
check('inventory immutability restored',`select tgenabled::text from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable'`,'O');
console.log(JSON.stringify({passed,failed:0,database:'owned isolated PostgreSQL',physical_verification:false},null,2));
