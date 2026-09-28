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
pool.on('error',e=>console.error('OWNED_RECURRING_LOCK_POOL_ERROR',e.code));
const q=async(sql,args=[])=>(await pool.query(sql,args)).rows[0]?.result;
const manager='90000000-0000-4000-8000-000000000165',checks=[];
const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks.push(name);};
const functions=[
 ['public.static_weekly_v13_begin_recurring_confirmation(uuid,uuid,date,bigint,text,uuid)',
  "select public.static_weekly_v13_begin_recurring_confirmation($1,gen_random_uuid(),$2::date,0,repeat('a',64),null) as result",'RESERVED'],
 ['public.static_weekly_v13_read_recurring_confirmation(uuid,uuid)',
  'select public.static_weekly_v13_read_recurring_confirmation($1,gen_random_uuid()) as result','NOT_FOUND'],
 ['public.static_weekly_v14_admit_recurring_source(uuid,uuid,jsonb,text)',
  "select public.static_weekly_v14_admit_recurring_source($1,gen_random_uuid(),'{}'::jsonb,repeat('a',64)) as result",/uncompleted named-manager reservation/],
 ['public.static_weekly_v18_bind_recurring_publication(uuid,uuid,uuid,bigint,jsonb)',
  "select public.static_weekly_v18_bind_recurring_publication($1,gen_random_uuid(),gen_random_uuid(),0,'{}'::jsonb) as result",/pending recurring parent/],
];
async function waitFor(pid,event){const deadline=Date.now()+1500;while(Date.now()<deadline){
 if(await q("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and lower(wait_event)=$2) as result",[pid,event]))return true;
 await new Promise(r=>setTimeout(r,10));}return false;}
try{
 // Prepare a literal date as the fixture owner. The constrained caller does
 // not have privileges on sch_service_date's internal settings helper; that
 // helper belongs inside the typed RPC, not its caller's argument expression.
 const futureMonday=await q("select to_char(date_trunc('week',public.sch_service_date(statement_timestamp())::timestamp)::date+7,'YYYY-MM-DD') as result");
 assert.match(futureMonday,/^\d{4}-\d{2}-\d{2}$/);
 await pool.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,'Synthetic Common Lock Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false)",[manager]);
 for(const [signature,sql,expected] of functions){
  for(const role of ['anon','authenticated','service_role','static_weekly_release_operator','custodial_application_reader'])
   check('denied '+role+' '+signature,await q("select has_function_privilege($1,$2,'EXECUTE') as result",[role,signature]),false);
  check('intended control-plane EXECUTE '+signature,await q("select has_function_privilege('static_weekly_control_plane',$1,'EXECUTE') as result",[signature]),true);
  check('exact function recovery '+signature,await q("select definition_sql=pg_get_functiondef($1::regprocedure) as result from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure",[signature]),true);
  const a=await pool.connect(),b=await pool.connect(),c=await pool.connect();let pending;
  try{
   await a.query('begin');await a.query('select manager_id from public.ops_manager_managers where manager_id=$1 for update',[manager]);
   await b.query('begin');await b.query("select pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0))");
   await c.query('begin');await c.query("set local statement_timeout='5000ms'");await c.query('set local role static_weekly_control_plane');
   let earlyFailure=null;
   pending=c.query(sql,sql.includes('$2')?[manager,futureMonday]:[manager]);pending.catch(error=>{earlyFailure={code:error.code,message:error.message};});
   const authorityWait=await waitFor(c.processID,'advisory');
   if(!authorityWait)console.error('LOCK_ORDER_QUERY_EARLY_FAILURE',JSON.stringify({signature,earlyFailure}));
   check('authority lock FIRST '+signature,authorityWait,true);
   await b.query('rollback');
   check('manager row only AFTER authority lock '+signature,await waitFor(c.processID,'transactionid'),true);
   await a.query('rollback');
   if(expected instanceof RegExp){await assert.rejects(pending,expected);checks.push('original parent guard preserved '+signature);}
   else check('original response preserved '+signature,(await pending).rows[0].result.state,expected);
  }finally{
   if(pending){await q('select pg_cancel_backend($1) as result',[c.processID]);await pending.catch(()=>{});}
   for(const connection of [a,b,c]){await connection.query('rollback');connection.release();}
  }
 }
 check('no parent survives rollback',await q('select count(*)::int as result from public.static_weekly_recurring_confirmations where manager_id=$1',[manager]),0);
 const proof={status:'PASS',checks:checks.length,assertions:checks,production:false,independentAudit:false,
  scope:'Actual four callable recurring RPC lock ordering, exact ACL/recovery and original response/guard preservation; not full confirmation or phone proof'};
 if(process.env.STATIC_WEEKLY_RECURRING_LOCK_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_RECURRING_LOCK_EVIDENCE,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(proof));
}finally{await pool.end();}
