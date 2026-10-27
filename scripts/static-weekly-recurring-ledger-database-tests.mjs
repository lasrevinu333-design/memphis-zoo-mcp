import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {Pool} from 'pg';

const container=process.env.SHIFT_END_TEST_CONTAINER,socket=process.env.SHIFT_END_TEST_SOCKET;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
assert.match(socket??'',/^\/tmp\/mz-shift-socket-[a-zA-Z0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
assert.ok(inspection.Mounts.some(m=>m.Source===socket&&m.Destination==='/test-socket'));
const pool=new Pool({host:socket,database:'postgres',user:'supabase_admin',password:'postgres',max:4,connectionTimeoutMillis:3000});
pool.on('error',e=>console.error('OWNED_LEDGER_POOL_ERROR',e.code));
const names=['static_weekly_recurring_confirmations','static_weekly_recurring_confirmation_receipts'];
const roles=['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'];
const managers=['10000000-0000-4000-8000-000000000151','10000000-0000-4000-8000-000000000152'];
const key='30000000-0000-4000-8000-000000000151';
const beginName='static_weekly_v13_begin_recurring_confirmation';
const readName='static_weekly_v13_read_recurring_confirmation';
const q=async(sql,values=[])=>{const r=await pool.query(sql,values);return r.rows[0]?.result;};
const rpc=async(client,name,args)=>{const r=await client.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);return r.rows[0].result;};
const checks=[];
const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks.push(name);};
async function reject(name,work,pattern){await assert.rejects(work,pattern,name);checks.push(name);}
async function ownedTransaction(role,work){const c=await pool.connect();try{
 await c.query('begin');await c.query("set local statement_timeout='4000ms'");await c.query('set local role '+role);
 return await work(c);
}finally{await c.query('rollback');c.release();}}
async function observeAdvisoryWait(pid){
 const until=Date.now()+1500;
 while(Date.now()<until){
  const waiting=await q("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and lower(wait_event)='advisory') as result",[pid]);
  if(waiting)return;
  await new Promise(r=>setTimeout(r,10));
 }
 assert.fail('second connection did not demonstrably wait for the common authority lock');
}
try{
 await pool.query(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
  values($1,'Synthetic recurring manager A',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false),
        ($2,'Synthetic recurring manager B',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false)`,managers);
 const revision=Number(await q('select current_revision as result from public.static_weekly_schedule_control where singleton'));
 const monday=await q("select (date_trunc('week',public.sch_service_date(statement_timestamp())::timestamp)::date+7)::text as result");
 const request=[managers[0],key,monday,revision,'a'.repeat(64),null];
 const counts=()=>q(`select jsonb_build_object('parents',(select count(*) from public.${names[0]}),
  'receipts',(select count(*) from public.${names[1]}),
  'revision',(select current_revision from public.static_weekly_schedule_control where singleton),
  'sources',(select count(*) from public.static_weekly_authority_source_documents),
  'publications',(select count(*) from public.weekly_schedule_publications)) as result`);
 const before=await counts();
 for(const table of names){
  check(table+' FORCE RLS',await q("select relrowsecurity and relforcerowsecurity as result from pg_class where oid=$1::regclass",['public.'+table]),true);
  check(table+' no PUBLIC table ACL',await q("select exists(select 1 from pg_class c,lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=$1::regclass and a.grantee=0) as result",['public.'+table]),false);
  for(const role of roles){
   check(table+' no direct '+role,await q("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege($1,$2,'SELECT,INSERT,UPDATE,REFERENCES') as result",[role,'public.'+table]),false);
   await reject(table+' actual read denied '+role,()=>ownedTransaction(role,c=>c.query('select * from public.'+table)),/permission denied/);
  }
 }
 for(const role of roles.filter(r=>r!=='static_weekly_control_plane')){
  await reject('begin denied '+role,()=>ownedTransaction(role,c=>rpc(c,beginName,request)),/permission denied/);
  await reject('status denied '+role,()=>ownedTransaction(role,c=>rpc(c,readName,[managers[0],key])),/permission denied/);
 }
 await ownedTransaction('static_weekly_control_plane',async c=>{
  check('unknown operation exact status',await rpc(c,readName,[managers[0],key]),{state:'NOT_FOUND',confirmationKey:key});
  const first=await rpc(c,beginName,request),again=await rpc(c,beginName,request);
  check('first phase is only RESERVED',first.state,'RESERVED');
  check('same transaction exact-key replay stable',again,first);
  check('uncommitted parent invisible from other connection',(await counts()).parents,before.parents);
 });
 check('rollback removes every parent and changes no authority',await counts(),before);
 await reject('reservation cannot independently commit',()=>ownedTransaction('static_weekly_control_plane',async c=>{
  await rpc(c,beginName,request);await c.query('commit');
 }),/cannot commit without its complete atomic receipt/);
 check('failed commit leaves no preparing row',await counts(),before);
 await reject('same-key different preview conflicts',()=>ownedTransaction('static_weekly_control_plane',async c=>{
  await rpc(c,beginName,request);await rpc(c,beginName,[...request.slice(0,4),'b'.repeat(64),null]);
 }),/idempotency conflict/);
 await reject('same-key changed revision conflicts before stale check',()=>ownedTransaction('static_weekly_control_plane',async c=>{
  await rpc(c,beginName,request);await rpc(c,beginName,[...request.slice(0,3),revision+1,...request.slice(4)]);
 }),/idempotency conflict/);
 await reject('new stale request fails',()=>ownedTransaction('static_weekly_control_plane',c=>rpc(c,beginName,[...request.slice(0,3),revision+1,...request.slice(4)])),/authority revision changed/);
 for(const [name,args,pattern] of [
  ['malformed preview',[...request.slice(0,4),'not-a-hash',null],/exact recurring/],
  ['null key',[managers[0],null,...request.slice(2)],/exact recurring/],
  ['unknown manager',['10000000-0000-4000-8000-000000000199',...request.slice(1)],/manager/i],
  ['unapproved template',[...request.slice(0,5),'50000000-0000-4000-8000-000000000199'],/exact recurring/],
  ['infinite date',[...request.slice(0,2),'infinity',...request.slice(3)],/exact recurring/],
  ['historical Monday',[...request.slice(0,2),'2020-01-06',...request.slice(3)],/future zoo-local Monday/],
 ])await reject(name,()=>ownedTransaction('static_weekly_control_plane',c=>rpc(c,beginName,args)),pattern);
 await ownedTransaction('static_weekly_control_plane',async c=>{
  const a=await rpc(c,beginName,request),b=await rpc(c,beginName,[managers[1],...request.slice(1)]);
  check('different authorized manager has separate operation',a.operationId===b.operationId,false);
  await reject('status never calls uncommitted reservation accepted',()=>rpc(c,readName,[managers[0],key]),/has not committed a complete receipt/);
 });
 await reject('header immutable even for owner',()=>ownedTransaction('static_weekly_control_plane',async c=>{
  await rpc(c,beginName,request);await c.query('reset role');
  await c.query(`update public.${names[0]} set expected_revision=expected_revision+1`);
 }),/immutable|append.only|cannot.*updat/i);
 await reject('runtime cannot insert success receipt',()=>ownedTransaction('static_weekly_control_plane',c=>c.query(`insert into public.${names[1]}(operation_id) values($1)`,[key])),/permission denied/);
 // Real concurrent connections: NOT_FOUND may be returned only after the
 // uncertain writer releases its lock. It is never inferred from timeout.
 const c1=await pool.connect(),c2=await pool.connect();
 try{
  for(const c of [c1,c2]){await c.query('begin');await c.query("set local statement_timeout='4000ms'");await c.query('set local role static_weekly_control_plane');}
  await rpc(c1,beginName,request);
  let settled=false;const pending=rpc(c2,readName,[managers[0],key]).then(value=>{settled=true;return value;});
  pending.catch(()=>{});
  await observeAdvisoryWait(c2.processID);check('status waits behind uncertain writer',settled,false);
  await c1.query('rollback');check('post-rollback authoritative status',await pending,{state:'NOT_FOUND',confirmationKey:key});
  await c2.query('commit');
  for(const c of [c1,c2]){await c.query('begin');await c.query("set local statement_timeout='4000ms'");await c.query('set local role static_weekly_control_plane');}
  const first=await rpc(c1,beginName,request);
  const competing=rpc(c2,beginName,request);competing.catch(()=>{});
  await observeAdvisoryWait(c2.processID);await c1.query('rollback');
  const second=await competing;check('aborted same-key writer admits a fresh reservation',second.state,'RESERVED');
  check('aborted operation identity not reused as accepted',first.operationId===second.operationId,false);
 }finally{for(const c of [c1,c2]){await c.query('rollback');c.release();}}
 check('races leave no accepted authority or partial operation',await counts(),before);
 const identities=[
  'public.static_weekly_v13_require_completed_recurring_confirmation()',
  'public.static_weekly_v13_guard_recurring_receipt()',
  'public.static_weekly_v13_begin_recurring_confirmation(uuid,uuid,date,bigint,text,uuid)',
  'public.static_weekly_v13_read_recurring_confirmation(uuid,uuid)',
 ];
 for(const identity of identities){
  check('PUBLIC cannot execute '+identity,await q("select exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') as result",[identity]),false);
  for(const kind of ['function','grant'])check('exact recovery '+kind+' '+identity,await q(`select count(*)::integer as result from public.custodial_release_authority_restore_inventory
   where object_kind=$2 and to_regprocedure(object_identity)=$1::regprocedure and definition_sql=${kind==='function'?'pg_get_functiondef($1::regprocedure)':'public.custodial_release_authority_current_grant_definition(object_identity)'}`,[identity,kind]),1);
 }
 const stored=await q(`select jsonb_agg(jsonb_build_object('kind',object_kind,'identity',object_identity,'definition',definition_sql) order by restore_order) as result
  from public.custodial_release_authority_restore_inventory
  where (object_kind in ('function','grant') and to_regprocedure(object_identity)=to_regprocedure($1))
   or (object_kind='trigger' and object_identity=$2)
   or (object_kind='relation_state' and object_identity=$3)`,
 [identities[3],'public.static_weekly_recurring_confirmations.trg_recurring_confirmation_complete','public.static_weekly_recurring_confirmations']);
 check('exact narrow recovery inventory count',stored.length,4);
 await pool.query('drop function public.static_weekly_v13_read_recurring_confirmation(uuid,uuid)');
 await pool.query('drop trigger trg_recurring_confirmation_complete on public.static_weekly_recurring_confirmations');
 await pool.query('alter table public.static_weekly_recurring_confirmations disable row level security');
 for(const item of stored)await pool.query(item.definition);
 check('constraint recovery retains deferred semantics',await q("select tgdeferrable and tginitdeferred and tgenabled='O' as result from pg_trigger where tgrelid='public.static_weekly_recurring_confirmations'::regclass and tgname='trg_recurring_confirmation_complete'"),true);
 await reject('restored commit guard still blocks partial write',()=>ownedTransaction('static_weekly_control_plane',async c=>{await rpc(c,beginName,request);await c.query('commit');}),/cannot commit without its complete atomic receipt/);
 await ownedTransaction('static_weekly_control_plane',async c=>check('restored exact status works',await rpc(c,readName,[managers[0],key]),{state:'NOT_FOUND',confirmationKey:key}));
 check('recovery leaves all authority and parents unchanged',await counts(),before);
 const evidence={status:'PASS',checks:checks.length,assertions:checks,production:false,independentAudit:false,
  boundary:'reservation/status/rollback/serialization/ACL/recovery only',
  acceptedPublicationFlow:'NOT_IMPLEMENTED_OR_CLAIMED',phoneTargets:'NOT_IMPLEMENTED_OR_CLAIMED'};
 if(process.env.STATIC_WEEKLY_RECURRING_LEDGER_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_RECURRING_LEDGER_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence));
}finally{await pool.end();}
