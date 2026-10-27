#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {lstatSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createManagerRecoveryEnvelope,applyManagerRecovery,recoveryBinding,verifyRecoveryEnvelope,statusManagerRecovery} from './production-restore-manager-recovery.mjs';
import {signBinding} from './disaster-recovery-crypto.mjs';
const key='synthetic-recovery-signing-key-never-production-0123456789';
const secret='synthetic-normal-manager-session-key-0123456789';
const keyId='synthetic-recovery-v1',projectRef='abcdefghijklmnopqrst';
let checks=0;const pass=()=>{checks++;};
const role=['OPS_MANAGER','CUSTODIAL_MANAGER','SECURITY_ADMIN'];
const managerId=randomUUID(),restoreId=randomUUID();
function base(){const now=Date.now();return {recovery_id:randomUUID(),restore_id:restoreId,authority_generation:1,archive_digest:'a'.repeat(64),target_project_ref:projectRef,final_manifest_sha256:'b'.repeat(64),database_identity:{database_name:'mz_schema_rebuild_recovery_test',database_oid:'12345',database_owner:'postgres',session_user:'supabase_admin'},manager:{manager_id:managerId,display_name:'Synthetic isolated recovery test manager',roles:role.slice().sort(),active:true,revoked_at:null,is_system_principal:false},code_ttl_seconds:900,actor:'Synthetic isolated recovery operator',approved_at:new Date(now).toISOString(),expires_at:new Date(now+900000).toISOString()};}
function signed(intent){return {format:'memphis-zoo-post-restore-manager-recovery.v1',algorithm:'hmac-sha256',key_id:keyId,intent,signature:signBinding(recoveryBinding(intent),key)};}
const good=signed(base());assert.equal(verifyRecoveryEnvelope(good,{key,keyId}),good.intent);pass();
for(const mutate of [e=>e.signature='0'.repeat(64),e=>e.key_id='other',e=>e.format='memphis-zoo-production-restore-reconciliation.v1',e=>e.intent.extra=true,e=>e.intent.database_identity.extra=true,e=>e.intent.manager.extra=true,e=>e.intent.authority_generation=0,e=>e.intent.manager.active=false,e=>e.intent.manager.is_system_principal=true,e=>e.intent.manager.roles=['OPS_MANAGER'],e=>e.intent.manager.roles.push('SUPERADMIN'),e=>e.intent.code_ttl_seconds=3600,e=>e.intent.database_identity.database_owner='service_role',e=>e.intent.database_identity.session_user='authenticated',e=>e.intent.expires_at=new Date(Date.now()-1).toISOString(),e=>e.intent.approved_at=new Date(Date.now()+60000).toISOString()]){
 const e=structuredClone(good);mutate(e);assert.throws(()=>verifyRecoveryEnvelope(e,{key,keyId}));pass();
}
// Authentic re-signed malformed identities still fail the closed validator.
for(const mutate of [i=>i.manager.roles=['OPS_MANAGER'],i=>i.database_identity.session_user='authenticated',i=>i.target_project_ref='evil',i=>i.manager.is_system_principal=true]){
 const i=base();mutate(i);assert.throws(()=>verifyRecoveryEnvelope(signed(i),{key,keyId}));pass();
}
export async function runRecoveryDatabaseTests(fixture){
 assert.ok(fixture&&typeof fixture.assertOwned==='function'&&typeof fixture.socketDirectory==='string');await fixture.assertOwned();
 const socket=fixture.socketDirectory,parent=dirname(socket),uid=process.getuid();
 assert.equal(realpathSync(socket),socket);assert.equal(realpathSync(parent),parent);
 assert.ok(new RegExp(`^(?:/run/user/${uid}/custodial-s27-[A-Za-z0-9]+|/tmp/custodial-s27-sock-[A-Za-z0-9]+)/socket$`).test(socket));
 const parentStat=lstatSync(parent);assert.equal(parentStat.uid,uid);assert.equal(parentStat.mode&0o777,0o700);assert.ok(lstatSync(resolve(socket,'.s.PGSQL.5432')).isSocket());
 const databaseName='postgres';
 const databaseUrl=`postgresql://supabase_admin:postgres@localhost/${databaseName}?host=${encodeURIComponent(socket)}`;
 const {default:pg}=await import('pg');
 const connect=async()=>{const c=new pg.Client({connectionString:databaseUrl,connectionTimeoutMillis:10000});await c.connect();return c;};
 const source=new pg.Client({host:socket,user:'supabase_admin',password:'postgres',database:'postgres',connectionTimeoutMillis:10000});
 await source.connect();try{const actual=(await source.query("select current_database() database_name,(select oid::text from pg_database where datname=current_database()) database_oid,(select pg_get_userbyid(datdba) from pg_database where datname=current_database()) database_owner,session_user,current_user")).rows[0];console.log(JSON.stringify({scope:'SYNTHETIC_FIXTURE_ORIGINAL_DATABASE_IDENTITY',actual}));}finally{await source.end();}
 const admin=new pg.Client({host:socket,user:'supabase_admin',password:'postgres',database:'template1',connectionTimeoutMillis:10000});await admin.connect();
 let changed=false,targetOid=null,originalOwner=null,db=null;
 try{
  const original=(await admin.query('select oid::text,pg_get_userbyid(datdba) owner from pg_database where datname=$1',[databaseName])).rows[0];
  assert.ok(original&&['postgres','supabase_admin'].includes(original.owner));targetOid=original.oid;originalOwner=original.owner;
  if(originalOwner!=='postgres'){await admin.query('alter database postgres owner to postgres');changed=true;}
  const owned=(await admin.query('select oid::text,pg_get_userbyid(datdba) owner from pg_database where datname=$1',[databaseName])).rows[0];assert.equal(owned.oid,targetOid);assert.equal(owned.owner,'postgres');
  console.log(JSON.stringify({scope:'SYNTHETIC_OWNED_DATABASE_OWNER_MATCHES_NORMAL_RESTORE',database_name:databaseName,database_oid:targetOid,before_owner:originalOwner,after_owner:owned.owner,workers_terminated:false}));
  db=await connect();let delivered=null;const issued=[];
 const opts=e=>({envelope:e,key,keyId,projectRef,confirmedRef:projectRef,sessionSecret:` \n${secret}\t `,deliverCode:async x=>{delivered=x;}});
 const make=()=>createManagerRecoveryEnvelope(db,{managerId,projectRef,actor:'Synthetic isolated recovery operator',key,keyId});
 const reject=async work=>{await assert.rejects(work);pass();};
 try{
  const identity=(await db.query('select current_database() name,session_user,current_user')).rows[0];assert.equal(identity.name,databaseName);assert.equal(identity.session_user,'supabase_admin');assert.equal(identity.current_user,'supabase_admin');
  assert.equal(Number((await db.query('select count(*) count from public.ops_manager_trusted_devices where revoked_at is null and expires_at>now()')).rows[0].count),0,'Test fixture must start without unrelated usable trust');
  await db.query("update custodial_dr.restore_control set state='COMPLETE',mutations_paused=false,restore_id=$1,authority_generation=1,archive_digest=$2,source_project_ref=$3,target_project_ref=$3 where singleton=true",[restoreId,'a'.repeat(64),projectRef]);
  await db.query('insert into custodial_dr.restore_manifests(restore_id,authority_generation,archive_digest,database_verified,storage_verified,authority_invalidated,post_restore_verified,final_manifest_sha256) values($1,1,$2,true,true,true,true,$3)',[restoreId,'a'.repeat(64),'b'.repeat(64)]);
  await db.query('insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,$2,$3,true,false)',[managerId,'Synthetic isolated recovery test manager',role]);
  // Same explicit-column insertRelease pattern as the maintained production
  // release-recorder DB fixture. Resume must retain one legitimate selector;
  // recovery_staged is database-derived and is deliberately NOT supplied.
  assert.equal(Number((await db.query("select count(*) count from public.release_deployment_manifest where status='deployed'")).rows[0].count),0);
  const syntheticRelease=randomUUID(),migrationHead='20260922090000'; // Maintained production-release-recorder synthetic fixture head; NOT a measured ledger.
  assert.match(migrationHead,/^[0-9]{14}$/);
  await db.query(`insert into public.release_deployment_manifest(release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256,environment_contract_version,status,details_json,created_at,deployed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[syntheticRelease,'a'.repeat(40),'b'.repeat(40),migrationHead,'c'.repeat(64),'synthetic-recovery-test.v1','deployed',{},new Date().toISOString(),new Date().toISOString()]);
  const release=(await db.query('select status,recovery_staged from public.release_deployment_manifest where release_id=$1',[syntheticRelease])).rows[0];assert.equal(release.status,'deployed');assert.equal(release.recovery_staged,false);pass();
  console.log(JSON.stringify({scope:'SYNTHETIC_NORMAL_RESUME_SINGLE_DEPLOYED_IDENTITY',release_id:syntheticRelease,migration_head:migrationHead,head_scope:'maintained synthetic fixture only; no Supabase CLI ledger exists here',recovery_staged_database_derived:true,canary_or_guard_bypass:false,cleanup:'retained only until this exact owned fixture is removed'}));
  const first=await make();
  for(const [field,value] of [['authority_generation',2],['archive_digest','c'.repeat(64)],['manager',{...first.intent.manager,manager_id:randomUUID()}],['database_identity',{...first.intent.database_identity,database_oid:'54321'}]]){
   const i=structuredClone(first.intent);i[field]=value;await reject(()=>applyManagerRecovery(db,opts(signed(i))));
  }
  await reject(()=>applyManagerRecovery(db,{...opts(first),key:'wrong-key-that-is-at-least-thirty-two-bytes'}));
  await reject(()=>applyManagerRecovery(db,{...opts(first),confirmedRef:'wrong'}));
  await db.query('update public.ops_manager_managers set roles=$2 where manager_id=$1',[managerId,['OPS_MANAGER']]);await reject(()=>applyManagerRecovery(db,opts(first)));await db.query('update public.ops_manager_managers set roles=$2 where manager_id=$1',[managerId,role]);
  await db.query("update custodial_dr.restore_control set state='PAUSED_RECONCILIATION',mutations_paused=true where singleton=true");await reject(()=>applyManagerRecovery(db,opts(first)));await db.query("update custodial_dr.restore_control set state='COMPLETE',mutations_paused=false where singleton=true");
  const lease=randomUUID();await db.query("insert into custodial_dr.application_mutation_leases(request_id,authority_generation,service_name) values($1,1,'synthetic-recovery-test')",[lease]);await reject(()=>applyManagerRecovery(db,opts(first)));await db.query('delete from custodial_dr.application_mutation_leases where request_id=$1',[lease]);
  await db.query("insert into custodial_dr.restore_discrepancies(restore_id,authority_generation,category,status) values($1,1,'synthetic_recovery_test','OPEN')",[restoreId]);await reject(()=>applyManagerRecovery(db,opts(first)));await db.query('delete from custodial_dr.restore_discrepancies where restore_id=$1',[restoreId]);
  await reject(()=>applyManagerRecovery(db,{...opts(first),deliverCode:async()=>{throw new Error('synthetic private output failure');}}));
  assert.equal(Number((await db.query("select count(*) count from custodial_dr.restore_events where restore_id=$1 and phase='MANAGER_RECOVERY_ISSUANCE'",[restoreId])).rows[0].count),0);pass();
  const success=await applyManagerRecovery(db,opts(first));assert.equal(success.idempotent_replay,false);assert.match(delivered.one_time_code,/^\d{8}$/);issued.push(success.code_id);pass();
  const before=delivered;let redelivered=false;const replay=await applyManagerRecovery(db,{...opts(first),deliverCode:async()=>{redelivered=true;}});assert.equal(replay.idempotent_replay,true);assert.equal(redelivered,false);pass();
  const different=signed({...first.intent,recovery_id:randomUUID()});await reject(()=>applyManagerRecovery(db,opts(different)));
  // Revoke the still-unconsumed test code normally in the disposable fixture;
  // a NEW explicit authority is allowed, while the OLD intent never remints.
  await db.query("update public.ops_manager_enrollment_codes set revoked_at=clock_timestamp(),status='revoked',revoked_reason='synthetic test explicit revocation' where id=$1",[success.code_id]);
  const second=await make();const a=await connect(),b=await connect();let deliveries=0;
  try{
   const common={...opts(second),deliverCode:async x=>{deliveries++;delivered=x;}};
   const results=await Promise.all([applyManagerRecovery(a,common),applyManagerRecovery(b,common)]);
   assert.equal(deliveries,1);assert.equal(results.filter(x=>x.idempotent_replay).length,1);assert.equal(new Set(results.map(x=>x.code_id)).size,1);issued.push(results[0].code_id);pass();
  }finally{await a.end();await b.end();}
  // Actual canonical consumer, not a simulated credential insertion.
  const credential=randomUUID(),tokenHash='d'.repeat(64);
  const codeHash=createHmac('sha256',secret).update(`ops-manager-enrollment-code:v1:${delivered.one_time_code}`).digest('hex');
  const result=(await db.query("select public.ops_manager_consume_enrollment_code($1,$2,'synthetic-recovered-browser','Synthetic recovered browser',$3,null,null,'Synthetic isolated test',now()+interval '1 day','{}'::jsonb) result",[codeHash,credential,tokenHash])).rows[0].result;
  assert.equal(result.ok,true);assert.equal(result.manager.manager_id,managerId);pass();
  const row=(await db.query('select manager_id,revoked_at,token_hash from public.ops_manager_trusted_devices where credential_id=$1',[credential])).rows[0];assert.equal(row.manager_id,managerId);assert.equal(row.revoked_at,null);assert.equal(row.token_hash,tokenHash);pass();
  await reject(()=>make());
  const double=(await db.query("select public.ops_manager_consume_enrollment_code($1,$2,'synthetic-second-browser','Synthetic second browser',$3,null,null,'Synthetic isolated test',now()+interval '1 day','{}'::jsonb) result",[codeHash,randomUUID(),tokenHash])).rows[0].result;assert.equal(double.ok,false);pass();
  const managerAfter=(await db.query('select roles,active,is_system_principal from public.ops_manager_managers where manager_id=$1',[managerId])).rows[0];assert.deepEqual(managerAfter.roles,role);assert.equal(managerAfter.active,true);assert.equal(managerAfter.is_system_principal,false);pass();
  assert.notEqual(before.code_id,delivered.code_id);pass();
  // Receipt-only reconciliation remains valid after authorization expiry and
  // a later generation; it cannot deliver code or become issuance authority.
  await db.query('update custodial_dr.restore_control set authority_generation=2 where singleton=true');
  const historical=await statusManagerRecovery(db,{envelope:second,key,keyId,projectRef,now:Date.parse(second.intent.expires_at)+1});
  assert.equal(historical.state,'COMMITTED');assert.equal(historical.code_delivered,false);assert.equal(historical.current_control.authority_generation,'2');pass();
  const absent=await statusManagerRecovery(db,{envelope:signed({...second.intent,recovery_id:randomUUID()}),key,keyId,projectRef});assert.equal(absent.state,'NOT_OBSERVED');assert.equal(absent.rollback_proven,false);pass();
  await reject(()=>statusManagerRecovery(db,{envelope:{...second,signature:'0'.repeat(64)},key,keyId,projectRef}));
  await db.query('update custodial_dr.restore_control set authority_generation=1 where singleton=true');
  await db.query("update public.ops_manager_trusted_devices set revoked_at=clock_timestamp(),revoked_reason='synthetic normal logout' where credential_id=$1",[credential]);
  const third=await make();
  const privateFdDriver=String.raw`import os,sys,json,subprocess,tempfile
node,script,mode=sys.argv[1:]
e=dict(os.environ)
e['RESTORE_MANAGER_RECOVERY_CODE_FD']='3'
r,w=os.pipe()
pre=None
with tempfile.TemporaryDirectory(prefix='custodial-recovery-fd-test-') as d:
 if mode=='alias':
  fd=r
  def pre(): os.dup2(1,3)
  e['RESTORE_MANAGER_RECOVERY_CODE_FD']='3'
 elif mode=='world':
  os.close(r);os.close(w);r=w=-1
  p=d+'/output';os.mkfifo(p,0o666);os.chmod(p,0o666)
  fd=os.open(p,os.O_RDWR|os.O_NONBLOCK)
  e['RESTORE_MANAGER_RECOVERY_CODE_FD']=str(fd)
 else:
  fd=w;e['RESTORE_MANAGER_RECOVERY_CODE_FD']=str(fd)
 child=subprocess.Popen([node,script,'--apply'],env=e,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(fd,),preexec_fn=pre)
 if mode!='world':os.close(w);w=-1
 out,err=child.communicate(timeout=25)
 private=b''
 if mode=='normal':
  private=os.read(r,4096)
 data=json.loads(private) if private else None
 meta=json.loads(out) if child.returncode==0 else None
 print(json.dumps({'exit':child.returncode,'private_received':bool(data),'private_code_shape':bool(data and len(data.get('one_time_code',''))==8 and data['one_time_code'].isdigit()),'stdout_nonsecret':not(data and data['one_time_code'].encode() in out),'metadata':meta}))
 if mode=='world':os.close(fd)
 elif r>=0:os.close(r)
`;
  const cliEnv={...process.env,SUPABASE_DB_URL:databaseUrl,SUPABASE_PROJECT_REF:projectRef,RESTORE_MANAGER_RECOVERY_APPLY:'true',RESTORE_MANAGER_RECOVERY_CONFIRM_PROJECT_REF:projectRef,RESTORE_RECONCILIATION_VERIFY_KEY:key,RESTORE_RECONCILIATION_VERIFY_KEY_ID:keyId,RESTORE_MANAGER_RECOVERY_JSON:JSON.stringify(third),OPS_MANAGER_SESSION_SECRET:` \n${secret}\t `};
  const cliPath=resolve(dirname(fileURLToPath(import.meta.url)),'production-restore-manager-recovery.mjs');
  const count=async()=>Number((await db.query('select count(*) count from public.ops_manager_enrollment_codes where manager_id=$1',[managerId])).rows[0].count);
  for(const mode of ['alias','world','normal']){
   const n=await count();const child=spawnSync('python3',['-c',privateFdDriver,process.execPath,cliPath,mode],{env:cliEnv,encoding:'utf8',timeout:30000,maxBuffer:65536});
   assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.stdout_nonsecret,true);
   if(mode==='normal'){assert.equal(result.exit,0);assert.equal(result.private_received,true);assert.equal(result.private_code_shape,true);assert.equal(await count(),n+1);assert.equal(result.metadata.code_delivered,true);}
   else{assert.notEqual(result.exit,0);assert.equal(result.private_received,false);assert.equal(await count(),n);}
   pass();
  }
  await fixture.assertOwned();
  console.log(JSON.stringify({ok:true,scope:'SYNTHETIC_OWNED_DB_RECOVERY_AND_ACTUAL_CANONICAL_CONSUMER',checks,actual_canonical_consume:true,production:false,real_G12_identity:false}));
 }finally{await db.end();db=null;}
 }finally{
  if(db)await db.end();
  try{if(targetOid){const actual=(await admin.query('select oid::text,pg_get_userbyid(datdba) owner from pg_database where datname=$1',[databaseName])).rows;assert.equal(actual.length,1);assert.equal(actual[0].oid,targetOid);assert.equal(actual[0].owner,'postgres');if(changed)await admin.query(`alter database postgres owner to ${originalOwner}`);const after=(await admin.query('select oid::text,pg_get_userbyid(datdba) owner from pg_database where datname=$1',[databaseName])).rows[0];assert.equal(after.oid,targetOid);assert.equal(after.owner,originalOwner);console.log(JSON.stringify({scope:'SYNTHETIC_OWNED_DEFAULT_DATABASE_OWNER_RESTORED',database_name:databaseName,database_oid:targetOid,owner:after.owner,restored:true,workers_terminated:false}));}}
  finally{await admin.end();}
 }
}
if(process.argv.includes('--pure'))console.log(JSON.stringify({ok:true,scope:'PURE_CLOSED_RECOVERY_AUTHORIZATION_ONLY',checks,PG:false}));
else if(process.argv.includes('--database'))throw new Error('Use the existing owned createCiFreshOnlyFixture hostSocket wrapper and call runRecoveryDatabaseTests(fixture); this test never births an unowned fixture.');
