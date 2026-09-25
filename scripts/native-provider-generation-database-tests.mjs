import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const container=`mz_native_provider_${process.pid}`;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:'set statement_timeout=30000;'+text}).trim();
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`,id=n=>`33000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace='public'::regnamespace and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])sql(`alter default privileges for role ${owner} in schema public revoke all on tables from anon,authenticated,service_role;alter default privileges for role ${owner} in schema public revoke all on sequences from anon,authenticated,service_role;`);};
let owned=false,checks=0;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
const reject=(name,query,pattern=/ERROR/)=>{let error;try{sql(query);}catch(e){error=e;}assert.ok(error,name);assert.match(String(error.stderr),pattern,name);checks++;console.log('PASS',name);};
const cleanup=()=>{if(owned){docker(['rm','-f',container]);owned=false;assert.equal(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');console.log('OWNED_CONTAINER_REMOVED',container);}};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{cleanup();}finally{process.exit(143);}});
const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort(),manifest=[];
assert.equal(files.length,148);assert.equal(files.at(-1),'20260924201258_native_provider_durable_authority.sql');
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g',
  '-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);owned=true;
 console.log(JSON.stringify({owned:container,cleanup:'exact container in finally',image,network:'none',production:false}));
 let ready=0;for(let n=0;n<60&&ready<4;n++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}assert.equal(ready,4);
 removeDefaults();for(const file of files){
  assert.equal(sql(defaults),'0','before '+file);const bytes=readFileSync('supabase/migrations/'+file);
  try{sql(bytes.toString());}catch(error){console.error('FAILED_MIGRATION',file,String(error.stderr));throw error;}
  if(Number(sql(defaults))){assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);removeDefaults();}
  assert.equal(sql(defaults),'0','after '+file);manifest.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});
  if(manifest.length%25===0)console.log('REPLAYED_EXACT_MIGRATIONS',manifest.length);
 }
 console.log('NO_AUTOMATIC_TABLE_OR_SEQUENCE_GRANTS_REPLAY_PASS',manifest.length);
 const table='public.employee_native_push_generations',device=id(1),employee=id(2),credential=id(3);
 sql(`insert into public.employees(id,employee_code,display_name,role,active) values(${q(employee)},'EMP995','Synthetic provider custodian','staff',true);
 insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values(${q(device)},'PROVIDER_SYNTHETIC','Synthetic provider device',true,${q(employee)},1);
 insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at,created_at)
 values(${q(credential)},${q(device)},repeat('c',64),'Synthetic provider credential',now()-interval '1 day',now()+interval '1 day',now()-interval '1 day');`);
 const token='synthetic-provider-token-value-0001',hash=t=>createHash('sha256').update(t).digest('hex');
 const body=(n,t=token)=>({schema:'custodial.native-provider-register.v1',operation_id:id(n),generation_id:id(n+100),
  credential_id:credential,employee_id:employee,device_id:'PROVIDER_SYNTHETIC',assignment_epoch:1,principal_digest:'a'.repeat(64),token_digest:hash(t),token:t,
  native_app:{package_name:'org.memphiszoo.custodial',version_name:'synthetic-only',version_code:53,build_id:'synthetic.custodial.df36d32368b6'}});
 let request=1000;const rpc=(b,status=false,role='service_role',credHash='c'.repeat(64))=>`set role ${role};select public.custodial_native_provider_registration(${q(credential)},${q(credHash)},${q(id(request++))},repeat('b',64),${j(b)},${status})::text`;
 const result=(b,status=false)=>JSON.parse(sql(rpc(b,status)));
 const snapshot=()=>sql(`select coalesce(jsonb_agg(to_jsonb(g) order by generation_id),'[]') from ${table} g`);
 for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader']){
  reject('direct table denied '+role,`set role ${role};select * from ${table}`,/permission denied/);
  reject('private helper denied '+role,`set role ${role};select public.custodial_native_provider_app_valid('{}')`,/permission denied/);
  if(role!=='service_role')reject('registration RPC denied '+role,rpc(body(10),false,role),/permission denied/);
 }
 const first=result(body(10));check('intended service caller admits original binding',first.generation_id,id(110));
 check('first generation has no invented predecessor',first.prior_generation_id,null);check('not a replay',first.replayed,false);
 assert.match(first.activated_at,/\.\d{6}Z$/);const before=snapshot();
 const replay=result(body(10));check('retry retains original activation',replay.activated_at,first.activated_at);check('retry exact stored row unchanged',snapshot(),before);
 const statusBody={...body(10),schema:'custodial.native-provider-status.v1'};delete statusBody.token;
 check('status exact original generation',result(statusBody,true).generation_id,first.generation_id);
 reject('status cannot invent an unknown generation',rpc({...statusBody,operation_id:id(99)},true),/original operation unknown/);
 for(const [field,value] of Object.entries({principal_digest:'d'.repeat(64),generation_id:id(900),token_digest:hash('other'),extra:true}))
  reject('same operation changed '+field,rpc({...body(10),[field]:value}));
 for(const [field,value] of Object.entries({assignment_epoch:1.5,employee_id:id(9),device_id:'OTHER',credential_id:id(4),principal_digest:null,operation_id:7,token:'short'}))
  reject('invalid typed recipient '+field,rpc({...body(11),[field]:value}));
 for(const app of [{...body(11).native_app,version_code:'53'},{...body(11).native_app,version_code:2100000001},
  {...body(11).native_app,package_name:'org.memphiszoo.infrastructure'},{...body(11).native_app,extra:1},null])
  reject('invalid packaged app '+JSON.stringify(app),rpc({...body(11),native_app:app}));
 reject('wrong authenticated credential secret rejected',rpc(body(11),false,'service_role','d'.repeat(64)),/current assigned/);
 const second=result(body(11,token+'2'));check('rotation keeps registration UUID',second.registration_id,first.registration_id);
 check('rotation names exact old generation',second.prior_generation_id,first.generation_id);
 check('one transaction exact retirement activation boundary',second.prior_dispatch_retired_at,second.activated_at);
 check('token rotation drains not revokes old arrival generation',sql(`select (dispatch_retired_at is not null and revoked_at is null)::text from ${table} where generation_id=${q(first.generation_id)}`),'true');
 check('old committed binding replay remains original',result(statusBody,true).activated_at,first.activated_at);
 check('exact one active generation',sql(`select count(*) from ${table} where dispatch_retired_at is null and revoked_at is null`),'1');
 reject('original binding cannot be edited',`update ${table} set principal_digest=repeat('d',64) where generation_id=${q(first.generation_id)}`,/immutable/);
 reject('old generation cannot become active again',`update ${table} set dispatch_retired_at=null where generation_id=${q(first.generation_id)}`,/immutable/);
 reject('generation history cannot be deleted',`delete from ${table}`,/history is retained/);
 const pause=`begin;update custodial_dr.restore_control set mutations_paused=true,state='PREPARING',restore_id=${q(id(88))} where singleton=true;`;
 reject('registration obeys mutation fence before acquiring locks',pause+rpc(body(12)),/mutations are paused/);
 // Existing generic registration must invalidate old authority even though it cannot create native generation proof.
 sql(`set role service_role;select public.mz_register_employee_push(${q(credential)},${q(token+'legacy')},${q(hash(token+'legacy'))},'android','synthetic','legacy');`);
 check('legacy token writer leaves no protected active generation',sql(`select count(*) from ${table} where dispatch_retired_at is null and revoked_at is null`),'0');
 const third=result(body(12,token+'3'));check('native re-entry makes explicit generation',third.generation_id,id(112));
 // Concurrent exact retries must not create extra rows or reset the original time.
 const parallel=promisify(execFile),query=rpc(body(12,token+'3'));
 const values=await Promise.all([query,query].map(s=>parallel('docker',['exec',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-c',s],{timeout:35000}).then(r=>JSON.parse(r.stdout.trim()))));
 check('concurrent exact retries retain activation',values.map(x=>x.activated_at),[third.activated_at,third.activated_at]);
 check('no duplicate generation after concurrent replay',sql(`select count(*) from ${table}`),'3');
 check('forced RLS without direct runtime policies',sql(`select (relrowsecurity and relforcerowsecurity)::text from pg_class where oid=${q(table)}::regclass`),'true');
 check('no sequence needed by UUID generation ledger',sql(`select count(*) from pg_depend where refobjid=${q(table)}::regclass and classid='pg_class'::regclass and objid in(select oid from pg_class where relkind='S')`),'0');
 const saved=snapshot(),restore=(kind,identity)=>`do $r$declare d text;begin select definition_sql into strict d from public.custodial_release_authority_restore_inventory where object_kind=${q(kind)} and object_identity=${q(identity)};execute d;end$r$;`;
 const resolver=sql("select 'public.custodial_native_provider_registration(uuid,text,uuid,text,jsonb,boolean)'::regprocedure::text");
 sql(`grant select on ${table} to anon;grant execute on function ${resolver} to public;`+restore('grant',table)+restore('grant',resolver));
 reject('recovered direct table denial',`set role anon;select * from ${table}`,/permission denied/);
 reject('recovered exact RPC denial',rpc(body(12,token+'3'),false,'anon'),/permission denied/);
 sql(`alter table ${table} disable trigger trg_native_provider_generation_guard;`+restore('trigger',table+'.trg_native_provider_generation_guard'));
 reject('recovered immutable trigger',`delete from ${table}`,/history is retained/);
 sql(restore('function',resolver));check('recovered service caller retains original binding',result(body(12,token+'3')).activated_at,third.activated_at);
 check('recovery retained all history bytes',snapshot(),saved);
 for(const [name,update] of [
  ['expired',`update public.device_auth_credentials set expires_at=now()-interval '1 minute' where credential_id=${q(credential)}`],
  ['revoked',`update public.device_auth_credentials set revoked_at=now() where credential_id=${q(credential)}`],
  ['inactive employee',`update public.employees set active=false where id=${q(employee)}`],
  ['inactive device',`update public.devices set active=false where id=${q(device)}`],
  ['changed epoch',`update public.devices set assignment_epoch=assignment_epoch+1 where id=${q(device)}`],
 ])reject('current binding refuses '+name,`begin;${update};`+rpc(body(12,token+'3')),/current assigned/);
 assert.equal(sql(defaults),'0');console.log(JSON.stringify({status:'PASS',checks,migrations:manifest,automatic_grants_absent_before_and_after_each:true,
  actualPostgres:true,synthetic:true,production:false,independentAudit:false,httpAttestation:false,providerClock:false,delivery:false}));
}finally{cleanup();}
