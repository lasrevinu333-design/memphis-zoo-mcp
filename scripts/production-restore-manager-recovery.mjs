#!/usr/bin/env node
// Operator-only recovery: issue an ordinary one-use code, never a credential.
import {createHash, createHmac, randomInt, randomUUID} from 'node:crypto';
import {fstatSync, readFileSync, writeSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {requireSigningKey, signBinding, stableJson, verifyBinding} from './disaster-recovery-crypto.mjs';

const FORMAT='memphis-zoo-post-restore-manager-recovery.v1';
const PURPOSE='memphis-zoo-post-restore-manager-recovery';
const PHASE='MANAGER_RECOVERY_ISSUANCE';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const fail=()=>{throw new Error('Post-restore manager recovery authorization refused.');};
const insist=x=>{if(!x)fail();};
const digest=x=>createHash('sha256').update(stableJson(x)).digest('hex');
function keys(o, expected){insist(o&&typeof o==='object'&&!Array.isArray(o)&&stableJson(Object.keys(o).sort())===stableJson([...expected].sort()));}
export function recoveryBinding(intent){return {purpose:PURPOSE,format:FORMAT,intent};}
function managerSnapshot(m){
  insist(m&&UUID.test(m.manager_id)&&m.active===true&&!m.revoked_at&&m.is_system_principal===false);
  insist(typeof m.display_name==='string'&&m.display_name.trim()&&Array.isArray(m.roles)&&m.roles.includes('CUSTODIAL_MANAGER'));
  insist(m.roles.every(x=>['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN'].includes(x))&&new Set(m.roles).size===m.roles.length);
  return {manager_id:m.manager_id,display_name:m.display_name,roles:[...m.roles].sort(),active:true,revoked_at:null,is_system_principal:false};
}
function validateIntent(i, now=Date.now(),statusOnly=false){
  keys(i,['recovery_id','restore_id','authority_generation','archive_digest','target_project_ref','final_manifest_sha256','database_identity','manager','code_ttl_seconds','actor','approved_at','expires_at']);
  insist(UUID.test(i.recovery_id)&&UUID.test(i.restore_id)&&Number.isSafeInteger(i.authority_generation)&&i.authority_generation>0&&SHA.test(i.archive_digest)&&SHA.test(i.final_manifest_sha256));
  insist(/^[a-z0-9]{20}$/.test(i.target_project_ref)&&/^[a-zA-Z0-9 ._@:-]{2,160}$/.test(i.actor));
  keys(i.database_identity,['database_name','database_oid','database_owner','session_user']);
  insist(/^[a-zA-Z0-9_]{1,63}$/.test(i.database_identity.database_name)&&/^[1-9][0-9]{0,9}$/.test(i.database_identity.database_oid)&&i.database_identity.database_owner==='postgres'&&['postgres','supabase_admin'].includes(i.database_identity.session_user));
  keys(i.manager,['manager_id','display_name','roles','active','revoked_at','is_system_principal']);managerSnapshot(i.manager);
  insist(Number.isInteger(i.code_ttl_seconds)&&i.code_ttl_seconds>=60&&i.code_ttl_seconds<=900);
  const approved=Date.parse(i.approved_at),expiry=Date.parse(i.expires_at);
  insist(Number.isFinite(approved)&&Number.isFinite(expiry)&&approved<=now&&(statusOnly||expiry>now)&&expiry>approved&&expiry-approved<=30*60_000);
  return i;
}
export function validateRecoveryIntent(i,now=Date.now()){return validateIntent(i,now,false);}
function verifyEnvelope(e,{key,keyId,now=Date.now()},statusOnly=false){
  keys(e,['format','algorithm','key_id','intent','signature']);
  insist(e.format===FORMAT&&e.algorithm==='hmac-sha256'&&e.key_id===keyId&&/^[a-zA-Z0-9._:-]{1,120}$/.test(keyId));
  validateIntent(e.intent,now,statusOnly);insist(verifyBinding(recoveryBinding(e.intent),e.signature,requireSigningKey(key,'RESTORE_RECONCILIATION_VERIFY_KEY')));
  return e.intent;
}
export function verifyRecoveryEnvelope(e,options){return verifyEnvelope(e,options,false);}
export const recoverySql=Object.freeze({
 identity:`select current_database() database_name,d.oid::text database_oid,pg_get_userbyid(d.datdba) database_owner,session_user,current_user from pg_database d where d.datname=current_database()`,
 control:`select * from custodial_dr.restore_control where singleton=true`,
 manifest:`select * from custodial_dr.restore_manifests where restore_id=$1`,
 manager:`select manager_id::text,display_name,roles,active,revoked_at,is_system_principal from public.ops_manager_managers where manager_id=$1`,
 counts:`select (select count(*) from custodial_dr.restore_discrepancies where restore_id=$1 and status='OPEN')::int open_count,(select count(*) from custodial_dr.application_mutation_leases)::int lease_count`,
 prior:`select outcome,evidence_json from custodial_dr.restore_events where restore_id=$1 and authority_generation=$2 and phase='MANAGER_RECOVERY_ISSUANCE' and evidence_json->>'recovery_id'=$3 order by event_id`,
 trust:`select count(*)::int count from public.ops_manager_trusted_devices t join public.ops_manager_managers m on m.manager_id=t.manager_id where t.revoked_at is null and t.expires_at>clock_timestamp() and t.created_at+interval '365 days'>clock_timestamp() and m.active=true and m.revoked_at is null`,
 pending:`select count(*)::int count from public.ops_manager_enrollment_codes where status='active' and consumed_at is null and revoked_at is null and expires_at>clock_timestamp() and (manager_id=$1 or (metadata_json->>'purpose'='post_restore_manager_recovery' and metadata_json->>'restore_id'=$2 and metadata_json->>'authority_generation'=$3))`,
 insert:`insert into public.ops_manager_enrollment_codes(id,manager_id,code_hash,role_snapshot,created_by_manager_id,created_by_credential_id,expires_at,max_attempts,metadata_json) values($1,$2,$3,$4,null,null,$5,5,$6::jsonb) returning id::text,expires_at`,
 event:`insert into custodial_dr.restore_events(restore_id,authority_generation,phase,outcome,actor,evidence_json) values($1,$2,'MANAGER_RECOVERY_ISSUANCE','PASSED',$3,$4::jsonb)`,
});
async function row(db,sql,args=[]){const r=await db.query(sql,args);insist(r.rows?.length===1);return r.rows[0];}
async function snapshot(db,{managerId,projectRef}){
  const identity=await row(db,recoverySql.identity);
  insist(identity.current_user===identity.session_user&&['postgres','supabase_admin'].includes(identity.session_user)&&identity.database_owner==='postgres');
  const database_identity={database_name:identity.database_name,database_oid:identity.database_oid,database_owner:identity.database_owner,session_user:identity.session_user};
  const control=await row(db,recoverySql.control);
  insist(control.state==='COMPLETE'&&control.mutations_paused===false&&UUID.test(String(control.restore_id))&&Number.isSafeInteger(Number(control.authority_generation))&&Number(control.authority_generation)>0&&control.target_project_ref===projectRef&&SHA.test(control.archive_digest));
  const manifest=await row(db,recoverySql.manifest,[control.restore_id]);
  insist(String(manifest.restore_id)===String(control.restore_id)&&Number(manifest.authority_generation)===Number(control.authority_generation)&&manifest.archive_digest===control.archive_digest&&manifest.database_verified===true&&manifest.storage_verified===true&&manifest.authority_invalidated===true&&manifest.post_restore_verified===true&&SHA.test(manifest.final_manifest_sha256));
  const counts=await row(db,recoverySql.counts,[control.restore_id]);insist(Number(counts.open_count)===0&&Number(counts.lease_count)===0);
  const manager=managerSnapshot(await row(db,recoverySql.manager,[managerId]));
  return {restore_id:String(control.restore_id),authority_generation:Number(control.authority_generation),archive_digest:control.archive_digest,target_project_ref:projectRef,final_manifest_sha256:manifest.final_manifest_sha256,database_identity,manager};
}
export async function createManagerRecoveryEnvelope(db,{managerId,projectRef,actor,key,keyId,codeTtlSeconds=900,now=Date.now()}){
  insist(UUID.test(managerId)&&/^[a-z0-9]{20}$/.test(projectRef)&&/^[a-zA-Z0-9._:-]{1,120}$/.test(keyId));
  const state=await snapshot(db,{managerId,projectRef});
  insist(Number((await row(db,recoverySql.trust)).count)===0);
  insist(Number((await row(db,recoverySql.pending,[managerId,state.restore_id,String(state.authority_generation)])).count)===0);
  const intent={recovery_id:randomUUID(),...state,code_ttl_seconds:codeTtlSeconds,actor,approved_at:new Date(now).toISOString(),expires_at:new Date(now+15*60_000).toISOString()};
  validateRecoveryIntent(intent,now);
  return {format:FORMAT,algorithm:'hmac-sha256',key_id:keyId,intent,signature:signBinding(recoveryBinding(intent),requireSigningKey(key,'RESTORE_RECONCILIATION_SIGNING_KEY'))};
}
export async function applyManagerRecovery(db,{envelope,key,keyId,projectRef,confirmedRef,sessionSecret,deliverCode,now=Date.now()}){
  const intent=verifyRecoveryEnvelope(envelope,{key,keyId,now});
  insist(projectRef===intent.target_project_ref&&confirmedRef===projectRef&&typeof deliverCode==='function');
  const normalizedSessionSecret=String(sessionSecret||'').trim();
  insist(normalizedSessionSecret.length>=32);requireSigningKey(normalizedSessionSecret,'OPS_MANAGER_SESSION_SECRET');
  const intentDigest=digest(recoveryBinding(intent));let began=false,commitAttempted=false,locked=false;
  try{
    await db.query("set lock_timeout='5s'");await db.query("set statement_timeout='15s'");
    await db.query("select pg_advisory_lock(hashtextextended('memphis-zoo-production-restore',0))");locked=true;
    await db.query('begin isolation level serializable');began=true;
    await db.query("set local lock_timeout='5s'");await db.query("set local statement_timeout='15s'");
    await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))");
    await db.query('select singleton from custodial_dr.restore_control where singleton=true for update');
    await db.query('lock table public.ops_manager_enrollment_codes,public.ops_manager_trusted_devices,public.ops_manager_managers in share row exclusive mode');
    const state=await snapshot(db,{managerId:intent.manager.manager_id,projectRef});
    for(const k of Object.keys(state))insist(stableJson(state[k])===stableJson(intent[k]));
    const prior=await db.query(recoverySql.prior,[intent.restore_id,intent.authority_generation,intent.recovery_id]);
    if(prior.rows.length){
      insist(prior.rows.length===1&&prior.rows[0].outcome==='PASSED'&&prior.rows[0].evidence_json.intent_sha256===intentDigest);
      const evidence=prior.rows[0].evidence_json;
      commitAttempted=true;await db.query('commit');began=false;
      return {ok:true,idempotent_replay:true,restore_id:intent.restore_id,recovery_id:intent.recovery_id,code_id:evidence.code_id,code_delivered:false};
    }
    insist(Number((await row(db,recoverySql.trust)).count)===0);
    insist(Number((await row(db,recoverySql.pending,[intent.manager.manager_id,intent.restore_id,String(intent.authority_generation)])).count)===0);
    verifyRecoveryEnvelope(envelope,{key,keyId,now:Date.now()});
    insist(Date.parse(intent.expires_at)>=Date.now()+60_000);
    // Identical code domain and role choice to the current named-leadership issuer.
    const code=String(randomInt(0,100_000_000)).padStart(8,'0'),codeId=randomUUID();
    const codeHash=createHmac('sha256',normalizedSessionSecret).update(`ops-manager-enrollment-code:v1:${code}`).digest('hex');
    const role=intent.manager.roles.includes('DIRECTOR')?'DIRECTOR':intent.manager.roles.includes('SECURITY_ADMIN')?'SECURITY_ADMIN':'OPS_MANAGER';
    const expiresAt=new Date(Math.min(Date.parse(intent.expires_at),Date.now()+intent.code_ttl_seconds*1000)).toISOString();
    const metadata={purpose:'post_restore_manager_recovery',restore_id:intent.restore_id,authority_generation:String(intent.authority_generation),recovery_id:intent.recovery_id,intent_sha256:intentDigest,approving_operator:intent.actor};
    const inserted=await row(db,recoverySql.insert,[codeId,intent.manager.manager_id,codeHash,role,expiresAt,JSON.stringify(metadata)]);insist(inserted.id===codeId);
    const evidence={recovery_id:intent.recovery_id,intent_sha256:intentDigest,archive_digest:intent.archive_digest,manager_id:intent.manager.manager_id,manager_snapshot_sha256:digest(intent.manager),code_id:codeId,expires_at:expiresAt};
    await db.query(recoverySql.event,[intent.restore_id,intent.authority_generation,intent.actor,JSON.stringify(evidence)]);
    // Private delivery before COMMIT: a delivery error rolls back both rows.
    // The receiver must wait for the sanitized committed receipt before use.
    await deliverCode({code_id:codeId,one_time_code:code,expires_at:expiresAt});
    verifyRecoveryEnvelope(envelope,{key,keyId,now:Date.now()});
    insist(Date.parse(expiresAt)>Date.now());
    commitAttempted=true;await db.query('commit');began=false;
    return {ok:true,idempotent_replay:false,restore_id:intent.restore_id,recovery_id:intent.recovery_id,code_id:codeId,expires_at:expiresAt,code_delivered:true};
  }catch(error){
    if(began)await db.query('rollback').catch(()=>{});
    if(commitAttempted)throw new Error('Manager recovery COMMIT outcome unknown; reconcile this exact signed intent and code ID before any new authorization.');
    throw error;
  }finally{if(locked)await db.query("select pg_advisory_unlock(hashtextextended('memphis-zoo-production-restore',0))").catch(()=>{});}
}
export async function statusManagerRecovery(db,{envelope,key,keyId,projectRef,now=Date.now()}){
  const intent=verifyEnvelope(envelope,{key,keyId,now},true);
  insist(projectRef===intent.target_project_ref);
  await db.query('begin isolation level repeatable read read only');
  try{
    await db.query("set local statement_timeout='15s'");
    const identity=await row(db,recoverySql.identity);
    const actual={database_name:identity.database_name,database_oid:identity.database_oid,database_owner:identity.database_owner,session_user:identity.session_user};
    insist(identity.current_user===identity.session_user&&stableJson(actual)===stableJson(intent.database_identity));
    const control=await row(db,recoverySql.control);
    const current_control={restore_id:control.restore_id,authority_generation:String(control.authority_generation),state:control.state,mutations_paused:control.mutations_paused};
    const prior=await db.query(recoverySql.prior,[intent.restore_id,intent.authority_generation,intent.recovery_id]);
    insist(prior.rows.length<=1);
    if(!prior.rows.length){await db.query('rollback');return {ok:true,state:'NOT_OBSERVED',recovery_id:intent.recovery_id,current_control,rollback_proven:false,code_delivered:false};}
    const evidence=prior.rows[0].evidence_json;
    insist(prior.rows[0].outcome==='PASSED'&&evidence.intent_sha256===digest(recoveryBinding(intent))&&evidence.archive_digest===intent.archive_digest&&evidence.manager_id===intent.manager.manager_id&&evidence.manager_snapshot_sha256===digest(intent.manager)&&UUID.test(evidence.code_id));
    const codes=await db.query('select id::text,manager_id::text,status,expires_at,consumed_at,revoked_at,metadata_json from public.ops_manager_enrollment_codes where id=$1',[evidence.code_id]);
    insist(codes.rows.length<=1);const code=codes.rows[0];
    if(code)insist(code.manager_id===intent.manager.manager_id&&code.metadata_json.recovery_id===intent.recovery_id&&code.metadata_json.intent_sha256===evidence.intent_sha256);
    await db.query('rollback');
    return {ok:true,state:'COMMITTED',recovery_id:intent.recovery_id,code_id:evidence.code_id,current_control,code_status:code?.status||'NOT_PRESENT',expired:code?Date.parse(code.expires_at)<=now:null,consumed:code?code.consumed_at!==null:null,revoked:code?code.revoked_at!==null:null,code_delivered:false};
  }catch(error){await db.query('rollback').catch(()=>{});throw error;}
}
async function cli(){
  const mode=process.argv[2];insist(['--create','--apply','--status'].includes(mode)&&process.argv.length===3);
  const env=process.env,url=String(env.SUPABASE_DB_URL||env.DATABASE_URL||'').trim(),projectRef=String(env.SUPABASE_PROJECT_REF||'');
  insist(url&&/^[a-z0-9]{20}$/.test(projectRef));
  const {default:pg}=await import('pg');
  const db=new pg.Client({connectionString:url,application_name:'memphis-zoo-post-restore-manager-recovery',connectionTimeoutMillis:10000,...(env.SUPABASE_DB_CA_CERT_PATH?{ssl:{ca:readFileSync(env.SUPABASE_DB_CA_CERT_PATH,'utf8'),rejectUnauthorized:true}}:{})});
  await db.connect();
  try{
    if(mode==='--create'){
      await db.query('begin isolation level repeatable read read only');
      const envelope=await createManagerRecoveryEnvelope(db,{managerId:String(env.RESTORE_MANAGER_RECOVERY_MANAGER_ID||''),projectRef,actor:String(env.RESTORE_RECONCILIATION_NAMED_ACTOR||''),key:env.RESTORE_RECONCILIATION_SIGNING_KEY,keyId:String(env.RESTORE_RECONCILIATION_SIGNING_KEY_ID||'')});
      await db.query('rollback');console.log(JSON.stringify(envelope));
    }else if(mode==='--status'){
      const result=await statusManagerRecovery(db,{envelope:JSON.parse(String(env.RESTORE_MANAGER_RECOVERY_JSON||'null')),key:env.RESTORE_RECONCILIATION_VERIFY_KEY,keyId:String(env.RESTORE_RECONCILIATION_VERIFY_KEY_ID||''),projectRef});
      console.log(JSON.stringify(result));
    }else{
      insist(env.RESTORE_MANAGER_RECOVERY_APPLY==='true');
      const fd=Number(env.RESTORE_MANAGER_RECOVERY_CODE_FD);insist(Number.isInteger(fd)&&fd>=3&&fd<=9);
      const output=fstatSync(fd);insist(output.isFIFO()&&output.uid===process.getuid()&&(output.mode&0o077)===0);
      for(const publicFd of [1,2]){const other=fstatSync(publicFd);insist(output.dev!==other.dev||output.ino!==other.ino);}
      const result=await applyManagerRecovery(db,{envelope:JSON.parse(String(env.RESTORE_MANAGER_RECOVERY_JSON||'null')),key:env.RESTORE_RECONCILIATION_VERIFY_KEY,keyId:String(env.RESTORE_RECONCILIATION_VERIFY_KEY_ID||''),projectRef,confirmedRef:String(env.RESTORE_MANAGER_RECOVERY_CONFIRM_PROJECT_REF||''),sessionSecret:env.OPS_MANAGER_SESSION_SECRET,deliverCode:async data=>{const bytes=Buffer.from(JSON.stringify(data)+'\n');insist(writeSync(fd,bytes)===bytes.length);bytes.fill(0);}});
      console.log(JSON.stringify(result));
    }
  }finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){cli().catch(()=>{console.error('Post-restore manager recovery failed; retain the exact intent and reconcile any attempted COMMIT. No secret details were logged.');process.exitCode=1;});}
