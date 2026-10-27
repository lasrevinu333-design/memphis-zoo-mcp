import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {Pool} from 'pg';
const container=process.env.SHIFT_END_TEST_CONTAINER,socket=process.env.SHIFT_END_TEST_SOCKET;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
assert.match(socket??'',/^\/tmp\/mz-shift-socket-[a-zA-Z0-9]+$/);
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(info.HostConfig.NetworkMode,'none');assert.equal(Object.keys(info.HostConfig.PortBindings??{}).length,0);
assert.ok(info.Mounts.some(m=>m.Source===socket&&m.Destination==='/test-socket'));
const pool=new Pool({host:socket,database:'postgres',user:'supabase_admin',password:'postgres',max:4,connectionTimeoutMillis:3000});
pool.on('error',e=>console.error('OWNED_TERMINAL_BOUNDARY_POOL_ERROR',e.code));
const q=async(sql,args=[])=>(await pool.query(sql,args)).rows[0]?.result;
const manager='90000000-0000-4000-8000-000000000001',checks=[];
const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks.push(name);};
try{
 await pool.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,'Synthetic Terminal Lock Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false)",[manager]);
 for(const date of [null,'infinity','-infinity']){
  await assert.rejects(()=>pool.query('select public.static_weekly_v19_read_terminal_target($1,null,null,null,null)',[date]),/one finite service date/);
  checks.push('terminal read rejects nonfinite or absent date '+date);
 }
 const functions=(await pool.query("select oid::regprocedure::text signature from pg_proc where pronamespace='public'::regnamespace and starts_with(proname,'static_weekly_v19_') order by proname")).rows;
 check('exact private terminal helper set',functions.length,6);
 for(const {signature} of functions)for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'])
  check(role+' cannot call '+signature,await q("select has_function_privilege($1,$2,'EXECUTE') as result",[role,signature]),false);
 const a=await pool.connect(),b=await pool.connect(),c=await pool.connect();let pending=null;
 try{
  await a.query('begin');await a.query('select * from public.ops_manager_managers where manager_id=$1 for update',[manager]);
  await b.query('begin');await b.query("select pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0))");
  await c.query('begin');await c.query("set local statement_timeout='4000ms'");
  pending=c.query("select public.static_weekly_v19_invalidate_recurring_range($1,gen_random_uuid(),gen_random_uuid(),current_date+7,null,'ROSTER_DEPENDENCY_CHANGED',repeat('a',64),0)",[manager]);
  pending.catch(()=>{});
  let waited=false;const deadline=Date.now()+1500;
  while(Date.now()<deadline){
   waited=await q("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and lower(wait_event)='advisory') as result",[c.processID]);
   if(waited)break;await new Promise(r=>setTimeout(r,10));
  }
  check('common advisory lock precedes blocked manager row lock',waited,true);
  await b.query('rollback');
  let rowWait=false;const rowDeadline=Date.now()+1500;
  while(Date.now()<rowDeadline){
   rowWait=await q("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and lower(wait_event)='transactionid') as result",[c.processID]);
   if(rowWait)break;await new Promise(r=>setTimeout(r,10));
  }
  check('only after authority lock may invalidator wait for manager row',rowWait,true);
  await a.query('rollback');await assert.rejects(pending,/exact latest winner and an affected future range/);
  checks.push('released locks proceed to unchanged exact-publication validation');
 }finally{
  // Cancellation/rollback is exact to these three owned test connections.
  if(pending){await q('select pg_cancel_backend($1) as result',[c.processID]);await pending.catch(()=>{});}
  for(const connection of [a,b,c]){await connection.query('rollback');connection.release();}
 }
 const signature='public.static_weekly_v19_invalidate_recurring_range(uuid,uuid,uuid,date,date,text,text,bigint)';
 check('exact corrected function matches recovery inventory',await q("select definition_sql=pg_get_functiondef($1::regprocedure) as result from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure",[signature]),true);
 const proof={status:'PASS',checks:checks.length,assertions:checks,production:false,independentAudit:false,
  scope:'Actual final163 lock-order/date/ACL/recovery changed-input proof, not full confirmation or phone integration'};
 if(process.env.STATIC_WEEKLY_TERMINAL_BOUNDARY_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_TERMINAL_BOUNDARY_EVIDENCE,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(proof));
}finally{await pool.end();}
