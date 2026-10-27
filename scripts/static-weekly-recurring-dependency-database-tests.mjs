import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {Pool} from 'pg';
const container=process.env.SHIFT_END_TEST_CONTAINER,socket=process.env.SHIFT_END_TEST_SOCKET;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
assert.match(socket??'',/^\/tmp\/mz-shift-socket-[a-zA-Z0-9]+$/);
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(info.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(info.HostConfig.PortBindings??{}).length,0);
assert.ok(info.Mounts.some(m=>m.Source===socket&&m.Destination==='/test-socket'));
const pool=new Pool({host:socket,user:'supabase_admin',password:'postgres',database:'postgres',max:1,connectionTimeoutMillis:3000});
const c=await pool.connect(),checks=[];
const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks.push(name);};
const q=async(sql,args=[])=>(await c.query(sql,args)).rows[0]?.result;
const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const manager=id(191),employee=id(192),other=id(193),slot=id(194),vacant=id(195),incumbency=id(196),sourceId=id(197);
const fn='public.static_weekly_v17_recurring_dependency_snapshot',signature=fn+'(uuid,date)';
const read=(date)=>q('select '+fn+'($1,$2) as result',[sourceId,date]);
async function isolated(work){await c.query('savepoint dependency_case');try{return await work();}finally{await c.query('rollback to savepoint dependency_case');}}
async function rejected(name,work,pattern){await isolated(async()=>{await assert.rejects(work,pattern,name);checks.push(name);});}
try{
 await c.query('begin');await c.query("set local statement_timeout='5000ms'");
 const week=await q("select (date_trunc('week',public.sch_service_date(statement_timestamp())::timestamp)::date+7)::text as result");
 const addDate=n=>new Date(Date.parse(week+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 await c.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,'Synthetic dependency manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false)",[manager]);
 for(const [e,code,name] of [[employee,'EMP991','Synthetic dependency A'],[other,'EMP992','Synthetic dependency B']])
  await c.query("insert into public.employees(id,employee_code,display_name,active,role) values($1,$2,$3,true,'staff')",[e,code,name]);
 for(const [s,code,label] of [[slot,'DEPENDENCY_A','Synthetic occupied position'],[vacant,'DEPENDENCY_B','Synthetic vacant position']])
  await c.query("insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values($1,$2,$3,$4,'Synthetic dependency manager',repeat('a',64))",[s,code,label,manager]);
 const insertIncumbent=(i,s,p,name,start,end)=>c.query("insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,effective_end,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values($1,$2,$3,$4,$5,$6,$7,'Synthetic dependency manager',repeat('b',64))",[i,s,p,name,start,end,manager]);
 await insertIncumbent(incumbency,slot,employee,'Synthetic dependency A',addDate(-7),addDate(7));
 const source={slots:[{id:slot,label:'Synthetic occupied position'},{id:vacant,label:'Synthetic vacant position'}],
  version:{slotAvailability:[],assignments:[]},exceptions:[]};
 await c.query('set local role static_weekly_release_operator');
 await q('select public.static_weekly_v3_register_authority_source($1,$2,$3) as result',[sourceId,source,'Synthetic dependency-only source, no publication']);
 await c.query('reset role');
 const baseline=await read(week);
 check('snapshot schema exact',baseline.snapshot.schema,'static-weekly.recurring-dependency-snapshot.v1');
 check('source digest binds actual registered bytes',baseline.snapshot.sourceDigest,await q('select public.static_weekly_digest_jsonb($1) as result',[source]));
 check('snapshot digest binds actual SQL body',baseline.digest,await q('select public.static_weekly_digest_jsonb($1) as result',[baseline.snapshot]));
 check('seven days by two positions',baseline.snapshot.roster.length,14);
 check('vacancy is not an invented employee',baseline.snapshot.roster.filter(r=>r.slotId===vacant).map(r=>[r.personId,r.employeeExists,r.employeeActive]),Array(7).fill([null,false,null]));
 check('current employee identity retained',baseline.snapshot.roster.filter(r=>r.slotId===slot).map(r=>r.personId),Array(7).fill(employee));
 check('snapshot repeat deterministic',await read(week),baseline);
 for(const tz of ['UTC','America/Chicago','Asia/Tokyo'])await isolated(async()=>{
  await c.query('select set_config($1,$2,true)',['TimeZone',tz]);
  check('connection timezone cannot change date/digest '+tz,await read(week),baseline);
 });
 await isolated(async()=>{
  await c.query("update public.employees set notes='Unrelated private notes',updated_at=statement_timestamp() where id=$1",[employee]);
  check('notes do not change recurring dependency',await read(week),baseline);
 });
 for(const [label,sql] of [['active',"update public.employees set active=false where id=$1"],
  ['display name',"update public.employees set display_name='Synthetic changed display name' where id=$1"]])await isolated(async()=>{
  await c.query(sql,[employee]);assert.notEqual((await read(week)).digest,baseline.digest);checks.push(label+' changes recurring dependency');
 });
 await isolated(async()=>{
  await c.query("update public.employees set active=false where id=$1",[other]);
  check('unassigned employee does not change selected recurring roster',await read(week),baseline);
 });
 await isolated(async()=>{
  await insertIncumbent(id(198),vacant,other,'Synthetic dependency B',week,null);
  const next=await read(week);assert.notEqual(next.digest,baseline.digest);checks.push('filling stable vacancy changes dependency');
  check('new incumbent is exact person on all seven days',next.snapshot.roster.filter(r=>r.slotId===vacant).map(r=>r.personId),Array(7).fill(other));
 });
 await isolated(async()=>{
  await insertIncumbent(id(199),slot,other,'Synthetic dependency B',addDate(7),null);
  check('future-week change does not rewrite this week snapshot',await read(week),baseline);
  const next=await read(addDate(7));
  check('later-week snapshot sees exact future incumbent',next.snapshot.roster.filter(r=>r.slotId===slot).map(r=>r.personId),Array(7).fill(other));
 });
 await rejected('overlapping dated incumbents fail closed',async()=>{
  await insertIncumbent(id(200),slot,other,'Synthetic overlapping person',addDate(2),null);await read(week);
 },/ambiguous dated incumbency/);
 await isolated(async()=>{
  const authority=await q("select public.static_weekly_advance_authority((select current_revision from public.static_weekly_schedule_control where singleton),'replace_incumbency',$1,'Synthetic dependency manager',$2,repeat('a',64)) as result",[manager,id(201)]);
  await insertIncumbent(id(202),slot,other,'Synthetic dependency B',addDate(2),null);
  await c.query("insert into public.weekly_roster_slot_incumbency_closures(closed_incumbency_id,replacement_incumbency_id,closed_at_effective_date,authority_revision,actor_manager_id,actor_manager_name_snapshot,content_digest) values($1,$2,$3,$4,$5,'Synthetic dependency manager',repeat('a',64))",[incumbency,id(202),addDate(2),authority,manager]);
  check('closure-aware midweek boundary preserves exact old/new actors',(await read(week)).snapshot.roster.filter(r=>r.slotId===slot).map(r=>r.personId),[employee,employee,other,other,other,other,other]);
 });
 await isolated(async()=>{
  await c.query("update public.static_weekly_authority_source_documents set active=false,retired_at='2026-09-26T19:12:34.123456Z' where source_id=$1",[sourceId]);
  const retired=await read(week);
  check('retirement is readable dependency evidence, not an older-source fallback',retired.snapshot.sourceActive,false);
  check('retirement preserves exact microseconds',retired.snapshot.sourceRetiredAt,'2026-09-26T19:12:34.123456Z');
  assert.notEqual(retired.digest,baseline.digest);checks.push('retirement changes dependency');
  for(const tz of ['America/Chicago','Asia/Tokyo']){
   await c.query('select set_config($1,$2,true)',['TimeZone',tz]);
   check('retired dependency timestamp timezone invariant '+tz,await read(week),retired);
  }
 });
 for(const date of [null,'infinity',addDate(1)])await rejected('invalid snapshot Monday '+date,()=>read(date),/requires one source and Monday/);
 await rejected('unknown source has no fallback',()=>q('select '+fn+'($1,$2) as result',[id(203),week]),/source is unknown/);
 for(const [label,slots] of [
  ['invalid UUID',[{id:'not-a-uuid'}]],
  ['duplicate UUID spelling',[{id:slot},{id:'{'+slot+'}'}]],
  ['unknown registered position',[{id:id(204)}]],
  ['nonboolean contractor capability',[{id:slot,contractorCapacity:'true'}]],
 ])await rejected(label+' fails exact position boundary',async()=>{
  const changed={...source,slots};
  await c.query('update public.static_weekly_authority_source_documents set canonical_source=$2,source_digest=public.static_weekly_digest_jsonb($2) where source_id=$1',[sourceId,changed]);
  await read(week);
 },/requires exact unique registered positions/);
 for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader']){
  check('snapshot private ACL '+role,await q('select has_function_privilege($1,$2,\'EXECUTE\') as result',[role,signature]),false);
  await rejected('actual snapshot caller denied '+role,async()=>{await c.query('set local role '+role);await read(week);},/permission denied/);
 }
 const recovery=(await c.query("select object_kind,definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure order by restore_order",[signature])).rows;
 check('exact function and ACL recovery present',recovery.map(r=>r.object_kind),['function','grant']);
 await c.query('drop function '+signature);for(const row of recovery)await c.query(row.definition_sql);
 check('recovered snapshot preserves exact dependency bytes',await read(week),baseline);
 check('recovery does not add control-plane direct access',await q('select has_function_privilege($1,$2,\'EXECUTE\') as result',['static_weekly_control_plane',signature]),false);
 const proof={status:'PASS',checks:checks.length,assertions:checks,production:false,independentAudit:false,
  scope:'actual private one-week source/roster dependency read; invalidation, range state, phone targets and confirmation remain unimplemented'};
 if(process.env.STATIC_WEEKLY_DEPENDENCY_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_DEPENDENCY_EVIDENCE,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(proof));
}finally{await c.query('rollback');c.release();await pool.end();}
