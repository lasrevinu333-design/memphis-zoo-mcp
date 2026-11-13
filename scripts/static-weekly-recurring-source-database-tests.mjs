import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {Pool} from 'pg';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
const container=process.env.SHIFT_END_TEST_CONTAINER,socket=process.env.SHIFT_END_TEST_SOCKET;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
assert.match(socket??'',/^\/tmp\/mz-shift-socket-[a-zA-Z0-9]+$/);
const i=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(i.HostConfig.NetworkMode,'none');assert.equal(Object.keys(i.HostConfig.PortBindings??{}).length,0);
assert.ok(i.Mounts.some(m=>m.Source===socket&&m.Destination==='/test-socket'));
assert.ok(process.env.STATIC_WEEKLY_TEST_SIX_PACKET,'explicit preserved source fixture required');
const packet=JSON.parse(readFileSync(process.env.STATIC_WEEKLY_TEST_SIX_PACKET));
assert.equal(digest(packet.compilerInput),packet.sourceDigest);
const pool=new Pool({host:socket,database:'postgres',user:'supabase_admin',password:'postgres',max:3,connectionTimeoutMillis:3000});
pool.on('error',e=>console.error('OWNED_SOURCE_POOL_ERROR',e.code));
const manager='10000000-0000-4000-8000-000000000161',other='10000000-0000-4000-8000-000000000162',key='30000000-0000-4000-8000-000000000161';
const q=async(sql,args=[])=>{const r=await pool.query(sql,args);return r.rows[0]?.result;};
const rpc=async(c,name,args)=>{const r=await c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);return r.rows[0]?.result;};
const checks=[];const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks.push(name);};
async function reject(name,work,pattern){await assert.rejects(work,pattern,name);checks.push(name);}
async function tx(role,work){const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);return await work(c);}finally{await c.query('rollback');c.release();}}
const admit='static_weekly_v14_admit_recurring_source',guard='static_weekly_v14_assert_recurring_source_use';
try{
 await pool.query(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
 values($1,'Synthetic source manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false),
 ($2,'Synthetic different source manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false)`,[manager,other]);
 const rev=Number(await q('select current_revision as result from public.static_weekly_schedule_control where singleton'));
 const monday=await q("select (date_trunc('week',public.sch_service_date(statement_timestamp())::timestamp)::date+7)::text as result");
 const source=structuredClone(packet.compilerInput);
 source.serviceDate=monday;source.version.effectiveStart=monday;source.version.effectiveEnd=null;
 source.version.namedAbsentSlotIds=[];source.exceptions=[];
 const sourceDigest=digest(source),request=[manager,key,monday,rev,'a'.repeat(64),null];
 const begin=c=>rpc(c,'static_weekly_v13_begin_recurring_confirmation',request);
 const counts=()=>q(`select jsonb_build_object('sources',(select count(*) from public.static_weekly_authority_source_documents),
 'bindings',(select count(*) from public.static_weekly_recurring_source_bindings),
 'parents',(select count(*) from public.static_weekly_recurring_confirmations),
 'publications',(select count(*) from public.weekly_schedule_publications)) as result`);
 const before=await counts();let identity;
 await reject('no standalone source admission',()=>tx('static_weekly_control_plane',c=>rpc(c,admit,[manager,key,source,sourceDigest])),/uncompleted named-manager reservation/);
 for(let pass=0;pass<2;pass++)await tx('static_weekly_control_plane',async c=>{
  const parent=await begin(c),accepted=await rpc(c,admit,[manager,key,source,sourceDigest]);
  check('exact SQL source digest '+pass,accepted.source_digest,sourceDigest);
  check('source bound to original parent '+pass,accepted.operation_id,parent.operationId);
  check('admission replay exact '+pass,await rpc(c,admit,[manager,key,source,sourceDigest]),accepted);
  if(identity)check('same semantic key/source deterministic after rollback',accepted.source_id,identity);
  identity=accepted.source_id;
  await c.query('reset role');
  const stored=await rpc(c,'static_weekly_digest_jsonb',[source]);
  check('PostgreSQL hashes actual source same as worker '+pass,stored,sourceDigest);
  const r=await c.query('select canonical_source from public.static_weekly_authority_source_documents where source_id=$1',[identity]);
  check('actual stored canonical source exact '+pass,r.rows[0].canonical_source,source);
  await rpc(c,guard,[identity,manager,monday,`recurring:${manager}:${key}:draft`,'draft']);checks.push('exact draft child binding accepted '+pass);
  await rpc(c,guard,[identity,manager,monday,`recurring:${manager}:${key}:publish`,'publish']);checks.push('exact publish child binding accepted '+pass);
 });
 check('source and parent rollback together',await counts(),before);
 await reject('source admission cannot commit without complete parent outcome',()=>tx('static_weekly_control_plane',async c=>{
  await begin(c);await rpc(c,admit,[manager,key,source,sourceDigest]);await c.query('commit');
 }),/cannot commit without its complete atomic receipt/);
 for(const [name,mutate] of [
  ['wrong digest',s=>[s,'b'.repeat(64)]],
  ['dated overlay',s=>{s.exceptions=[{type:'daily_absence'}];return[s,digest(s)];}],
  ['named absence',s=>{s.version.namedAbsentSlotIds=['forged'];return[s,digest(s)];}],
  ['other effective date',s=>{s.serviceDate='2099-01-05';return[s,digest(s)];}],
  ['unbounded duplicate version input',s=>{s.versions=[s.version];return[s,digest(s)];}],
 ])await reject(name+' rejected',()=>tx('static_weekly_control_plane',async c=>{
  await begin(c);const [s,d]=mutate(structuredClone(source));await rpc(c,admit,[manager,key,s,d]);
 }),/actual inserted bytes|exact future exception-free candidate/);
 await reject('same parent cannot admit different bytes',()=>tx('static_weekly_control_plane',async c=>{
  await begin(c);await rpc(c,admit,[manager,key,source,sourceDigest]);
  const changed=structuredClone(source);changed.version.assignments[0].serviceEffortMinutes+=1;
  await rpc(c,admit,[manager,key,changed,digest(changed)]);
 }),/already binds different source bytes/);
 for(const [name,actor,date,child,stage] of [
  ['different named manager',other,monday,`recurring:${manager}:${key}:draft`,'draft'],
  ['different key',manager,monday,'ordinary-manager-draft','draft'],
  ['different Monday',manager,'2099-01-05',`recurring:${manager}:${key}:draft`,'draft'],
  ['old mutable-draft path',manager,monday,`recurring:${manager}:${key}:draft`,'update'],
 ])await reject(name+' cannot escape parent',()=>tx('static_weekly_control_plane',async c=>{
  await begin(c);const a=await rpc(c,admit,[manager,key,source,sourceDigest]);await c.query('reset role');
  await rpc(c,guard,[a.source_id,actor,date,child,stage]);
 }),/cannot escape its original confirmation/);
 await reject('ordinary draft endpoint blocked before any malformed draft parsing',()=>tx('static_weekly_control_plane',async c=>{
  await begin(c);const a=await rpc(c,admit,[manager,key,source,sourceDigest]);
  await rpc(c,'static_weekly_v3_create_draft',[monday,'synthetic',{}, {}, {},rev,manager,'ordinary-draft',a.source_id]);
 }),/cannot escape its original confirmation/);
 await tx('supabase_admin',async c=>{await rpc(c,guard,['50000000-0000-4000-8000-000000000199',manager,null,'legacy-release-path','update']);checks.push('non-derived release source path unaffected');});
 for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader']){
  check('no direct source binding table '+role,await q("select has_table_privilege($1,'public.static_weekly_recurring_source_bindings','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege($1,'public.static_weekly_recurring_source_bindings','SELECT,INSERT,UPDATE,REFERENCES') as result",[role]),false);
  await reject('private source guard denied '+role,()=>tx(role,c=>rpc(c,guard,[null,null,null,null,null])),/permission denied/);
  if(role!=='static_weekly_control_plane')await reject('admission denied '+role,()=>tx(role,c=>rpc(c,admit,[manager,key,source,sourceDigest])),/permission denied/);
 }
 const functions=['public.static_weekly_v14_admit_recurring_source(uuid,uuid,jsonb,text)',
  'public.static_weekly_v14_assert_recurring_source_use(uuid,uuid,date,text,text)',
  'public.static_weekly_v13_guard_recurring_receipt()',
  'public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)',
  'public.static_weekly_v3_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text)',
  'public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)'];
 for(const f of functions)for(const kind of ['function','grant'])check('exact source recovery '+kind+' '+f,
  await q(`select count(*)::integer as result from public.custodial_release_authority_restore_inventory where object_kind=$2
   and to_regprocedure(object_identity)=$1::regprocedure and definition_sql=${kind==='function'?'pg_get_functiondef($1::regprocedure)':'public.custodial_release_authority_current_grant_definition(object_identity)'}`,[f,kind]),1);
 check('all hostile cases leave no source/publication/parent changes',await counts(),before);
 const proof={status:'PASS',checks:checks.length,assertions:checks,production:false,independentAudit:false,
  sourceFixtureDigest:packet.sourceDigest,testSourceDigest:sourceDigest,
  scope:'transaction-bound canonical source insertion and legacy-wrapper containment only',
  publicationOrPhoneAcceptance:'NOT_IMPLEMENTED_OR_CLAIMED'};
 if(process.env.STATIC_WEEKLY_RECURRING_SOURCE_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_RECURRING_SOURCE_EVIDENCE,JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify(proof));
}finally{await pool.end();}
