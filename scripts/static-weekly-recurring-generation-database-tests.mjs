import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import {Pool} from 'pg';
const container=process.env.SHIFT_END_TEST_CONTAINER,socket=process.env.SHIFT_END_TEST_SOCKET;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);assert.match(socket??'',/^\/tmp\/mz-shift-socket-[a-zA-Z0-9]+$/);
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(info.HostConfig.NetworkMode,'none');assert.equal(Object.keys(info.HostConfig.PortBindings??{}).length,0);
assert.ok(info.Mounts.some(m=>m.Source===socket&&m.Destination==='/test-socket'));
const pool=new Pool({host:socket,database:'postgres',user:'supabase_admin',password:'postgres',max:4,connectionTimeoutMillis:3000});
pool.on('error',e=>console.error('OWNED_GENERATION_POOL_ERROR',e.code));
const q=async(sql,args=[])=>{const r=await pool.query(sql,args);return r.rows[0]?.result;};
const generation=()=>q('select generation::text as result from public.static_weekly_recurring_generation where singleton').then(Number);
const employee='30000000-0000-4000-8000-000000000181',manager='10000000-0000-4000-8000-000000000181';
const checks=[];const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks.push(name);};
async function tx(work,role='supabase_admin'){const c=await pool.connect();try{await c.query('begin');await c.query("set local statement_timeout='4000ms'");await c.query('set local role '+role);return await work(c);}finally{await c.query('rollback');c.release();}}
async function reject(name,work,re){await assert.rejects(work,re,name);checks.push(name);}
try{
 const original=await generation();
 await pool.query("insert into public.employees(id,employee_code,display_name,role,active) values($1,'EMP981','Synthetic Generation Person','staff',true)",[employee]);
 check('new custodian advances recurring generation once',await generation(),original+1);
 const baseline=await generation();
 await pool.query("update public.employees set notes='Synthetic irrelevant notes',updated_at=statement_timestamp() where id=$1",[employee]);
 check('notes and updated_at are not recurring authority',await generation(),baseline);
 await pool.query('update public.employees set active=active,display_name=display_name where id=$1',[employee]);
 check('semantic no-op is not a new generation',await generation(),baseline);
 for(const column of ['display_name','active'])await tx(async c=>{
  await c.query(`update public.employees set ${column}=${column==='active'?'false':"'Synthetic Changed Name'"} where id=$1`,[employee]);
  const r=await c.query('select generation::text from public.static_weekly_recurring_generation where singleton');
  check(column+' changes generation transactionally',Number(r.rows[0].generation),baseline+1);
  check(column+' uncommitted generation invisible',await generation(),baseline);
 });
 check('generation rolls back with employee semantics',await generation(),baseline);
 await pool.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,'Synthetic Generation Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false)",[manager]);
 await tx(async c=>{
  const revision=Number(await q('select current_revision as result from public.static_weekly_schedule_control where singleton'));
  await c.query('select public.static_weekly_v7_create_vacant_roster_slot($1,$2,$3,$4,$5)',
   ['20000000-0000-4000-8000-000000000181','Synthetic vacant position',revision,manager,'synthetic-generation-slot']);
  await c.query('reset role');const r=await c.query('select generation::text from public.static_weekly_recurring_generation where singleton');
  check('real vacant-position writer advances one stable slot semantic',Number(r.rows[0].generation),baseline+1);
 },'static_weekly_control_plane');
 check('vacancy and generation rollback together',await generation(),baseline);
 const source={exceptions:[],version:{id:'synthetic-generation-source',slotAvailability:[],assignments:[]},slots:[]};
 await tx(async c=>{
  await c.query('select public.static_weekly_v3_register_authority_source($1,$2,$3)',
   ['50000000-0000-4000-8000-000000000181',source,'Synthetic inactive-to-schedule evidence']);
  await c.query('reset role');const r=await c.query('select generation::text from public.static_weekly_recurring_generation where singleton');
  check('registration alone does not activate a recurring pattern',Number(r.rows[0].generation),baseline);
 },'static_weekly_release_operator');
 const tables=['weekly_roster_slots','weekly_roster_slot_incumbencies','weekly_roster_slot_incumbency_closures',
  'weekly_roster_slot_staffing_states','employees','static_weekly_authority_source_documents','weekly_schedule_publications'];
 for(const table of tables){
  check(table+' has statement lock before row mutation',await q("select count(*)::integer as result from pg_trigger where tgrelid=$1::regclass and tgname='trg_recurring_authority_lock' and (tgtype&1)=0 and (tgtype&2)=2 and tgenabled='O'",['public.'+table]),1);
  check(table+' has semantic generation trigger',await q("select count(*)::integer as result from pg_trigger where tgrelid=$1::regclass and tgname='trg_recurring_authority_generation' and (tgtype&1)=1 and (tgtype&2)=0 and tgenabled='O'",['public.'+table]),1);
  for(const name of ['trg_recurring_authority_lock','trg_recurring_authority_generation'])check('recovery covers '+table+'.'+name,
   await q("select count(*)::integer as result from public.custodial_release_authority_restore_inventory where object_kind='trigger' and object_identity=$1",['public.'+table+'.'+name]),1);
 }
 check('draft restrictions and dated overlay tables have no recurring generation trigger',await q("select count(*)::integer as result from pg_trigger where tgname='trg_recurring_authority_generation' and tgrelid in ('public.weekly_schedule_slot_availability'::regclass,'public.static_weekly_staffing_commands'::regclass,'public.static_weekly_staffing_absences'::regclass,'public.static_weekly_staffing_absence_cancellations'::regclass)"),0);
 check('generation table RLS enabled and forced',await q("select relrowsecurity and relforcerowsecurity as result from pg_class where oid='public.static_weekly_recurring_generation'::regclass"),true);
 for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader']){
  check('no direct generation access '+role,await q("select has_table_privilege($1,'public.static_weekly_recurring_generation','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as result",[role]),false);
  await reject('actual generation write denied '+role,()=>tx(c=>c.query('update public.static_weekly_recurring_generation set generation=generation+1'),role),/permission denied/);
  if(role!=='static_weekly_control_plane')await reject('generation RPC denied '+role,()=>tx(c=>c.query('select public.static_weekly_v15_read_recurring_generation()'),role),/permission denied/);
 }
 await tx(async c=>check('intended runtime generation read',Number((await c.query('select public.static_weekly_v15_read_recurring_generation() as n')).rows[0].n),baseline),'static_weekly_control_plane');
 const a=await pool.connect(),b=await pool.connect();
 try{
  await a.query('begin');await a.query("select pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0))");
  await b.query('begin');await b.query("set local statement_timeout='4000ms'");
  const pending=b.query("update public.employees set display_name='Synthetic concurrent generation' where id=$1",[employee]);pending.catch(()=>{});
  let waited=false;const deadline=Date.now()+1500;
  while(Date.now()<deadline){
   waited=await q("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and lower(wait_event)='advisory') as result",[b.processID]);
   if(waited)break;await new Promise(r=>setTimeout(r,10));
  }
  check('privileged employee writer waits for common authority lock before mutation',waited,true);
  check('locked preview generation remains stable',await generation(),baseline);
  await a.query('rollback');await pending;
  check('writer applies generation with employee change',Number((await b.query('select generation from public.static_weekly_recurring_generation')).rows[0].generation),baseline+1);
 }finally{for(const c of [a,b]){await c.query('rollback');c.release();}}
 check('concurrent rollback preserves generation',await generation(),baseline);
 const trigger='public.employees.trg_recurring_authority_generation';
 const definition=await q("select definition_sql as result from public.custodial_release_authority_restore_inventory where object_kind='trigger' and object_identity=$1",[trigger]);
 await pool.query('drop trigger trg_recurring_authority_generation on public.employees');await pool.query(definition);
 await tx(async c=>{await c.query("update public.employees set display_name='Synthetic restored trigger' where id=$1",[employee]);
  check('restored generation trigger still enforces semantic change',Number((await c.query('select generation from public.static_weekly_recurring_generation')).rows[0].generation),baseline+1);});
 // Bounded fail-before/corrected-after using an ACTUAL roster-bound non-EMP
 // employee row, not the unmaterialized contractor identity in the full source.
 const originalGeneration=readFileSync('supabase/migrations/20260926194644_static_weekly_recurring_generation_fence.sql','utf8')
  .match(/create function public\.static_weekly_v15_advance_recurring_generation\(\)[\s\S]*?\$function\$;/)[0]
  .replace('create function','create or replace function');
 for(const old of [true,false])await tx(async c=>{
  const slot='20000000-0000-4000-8000-000000000282',person='40000000-0000-4000-8000-000000000282';
  await c.query("insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values($1,'BOUND_NON_EMP','Synthetic non-EMP position',$2,'Synthetic Generation Manager',repeat('a',64))",[slot,manager]);
  await c.query("insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(gen_random_uuid(),$1,$2,'Synthetic bound contractor',current_date,$3,'Synthetic Generation Manager',repeat('b',64))",[slot,person,manager]);
  if(old)await c.query(originalGeneration);
  const before=Number((await c.query('select generation from public.static_weekly_recurring_generation')).rows[0].generation);
  const inserted=await c.query("insert into public.employees(id,employee_code,display_name,active,role) values($1,'COVERALL_RECONCILIATION_TEST','Synthetic bound contractor',true,'staff')",[person]);
  check((old?'fail-before':'corrected')+' actual bound contractor insert',inserted.rowCount,1);
  const updated=await c.query("update public.employees set display_name='Synthetic contractor corrected' where id=$1",[person]);
  check((old?'fail-before':'corrected')+' actual bound contractor update',updated.rowCount,1);
  const after=Number((await c.query('select generation from public.static_weekly_recurring_generation')).rows[0].generation);
  check(old?'original filter misses actual bound non-EMP changes':'corrected filter tracks actual bound non-EMP changes',after-before,old?0:2);
 });
 const proof={status:'PASS',checks:checks.length,assertions:checks,production:false,independentAudit:false,
  futureInvalidationAndPhoneTerminals:'NOT_IMPLEMENTED_OR_CLAIMED',scope:'semantic counter/statement lock/ACL/recovery'};
 if(process.env.STATIC_WEEKLY_RECURRING_GENERATION_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_RECURRING_GENERATION_EVIDENCE,JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify(proof));
}finally{await pool.end();}
