import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {feedbackTriageHandler} from '../src/feedback-triage.js';
import {createOpsManagerSession,makeOpsAccessMiddleware} from '../src/auth/shared-access-auth.js';

// The owning replay supplies a disposable database. No connection or production
// discovery is performed by this module.
export async function runFeedbackTriageDatabaseTests({sql,parallelSql}){
 let checks=0;
 const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const q=x=>"'"+String(x).replaceAll("'","''")+"'";
 const manager=randomUUID(),credential=randomUUID(),other=randomUUID(),item=randomUUID();
 const createItem=id=>sql(`insert into public.system_feedback_items(id,operation_id,request_fingerprint,category,priority,message,submitted_by,hub_context,metadata_json)
   values(${q(id)},${q(randomUUID())},${q('d'.repeat(64))},'other','normal','Synthetic exact feedback','Synthetic Manager','manager',
    jsonb_build_object('identity_verification',jsonb_build_object('status','verified','kind','named_manager_session','manager_id',${q(manager)},'credential_id',${q(credential)})));`);
 sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
  values(${q(manager)},'Synthetic Triage Manager',array['CUSTODIAL_MANAGER'],true,false),
   (${q(other)},'Synthetic Other Manager',array['CUSTODIAL_MANAGER'],true,false);
 insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at)
  values(${q(credential)},'OPS_TRIAGE_SYNTHETIC','Synthetic Triage',${q('b'.repeat(64))},'full_access',${q(manager)},now()+interval '1 day');`);
 createItem(item);
 const version=id=>sql(`set role custodial_application_reader;select public.custodial_feedback_triage_version(status,updated_at) from public.system_feedback_items where id=${q(id)};`);
 const make=(status,id=item)=>({p_request:randomUUID(),p_manager:manager,p_credential:credential,
  p_feedback:id,p_action:status,p_expected_version:version(id)});
 const statement=a=>'set role service_role;select public.custodial_feedback_triage('+[
  a.p_request,a.p_manager,a.p_credential,a.p_feedback,a.p_action,a.p_expected_version].map(q).join(',')+');';
 const rpc=a=>JSON.parse(sql(statement(a)).split('\n').at(-1));
 const reject=(statement,pattern)=>{let error;try{sql(statement);}catch(e){error=e;}assert.ok(error);assert.match(String(error.stderr||error),pattern);checks++;};
 const state=id=>sql(`select jsonb_build_object('status',status,'notification_status',notification_status,
  'notified_ops_count',notified_ops_count,'acknowledged_at',acknowledged_at,'message',message) from public.system_feedback_items where id=${q(id)};`);
 eq(sql("set role custodial_application_reader;select public.custodial_feedback_triage_version('new','2026-10-02T00:00:00.123456Z')<>public.custodial_feedback_triage_version('new','2026-10-02T00:00:00.123457Z');"),'t','fractional timestamps never collapse');
 const first=make('acknowledged'),before=JSON.parse(state(item)),accepted=rpc(first);
 eq(accepted.ok,true);eq(accepted.replayed,false);eq(accepted.receipt.status,'acknowledged');
 eq(accepted.receipt.actor_manager_id,manager);eq(accepted.receipt.actor_credential_id,credential);
 const after=JSON.parse(state(item));eq(after.notification_status,before.notification_status);eq(after.notified_ops_count,before.notified_ops_count);eq(after.message,before.message);
 eq(rpc(first),{...accepted,replayed:true},'lost response gets original exact receipt');
 reject(statement({...first,p_action:'closed'}),/40001/);
 reject(statement({...first,p_request:randomUUID()}),/40001/);
 reject(statement({...make('resolved'),p_manager:other}),/42501/);
 const resolved=rpc(make('resolved'));eq(resolved.receipt.status,'resolved');
 const closed=rpc(make('closed'));eq(closed.receipt.status,'closed');
 eq(rpc(first).receipt,accepted.receipt,'later state never rewrites original action receipt');
 reject(statement(make('acknowledged')),/40001/);
 // A current session is required even for exact response-loss replay.
 sql(`update public.ops_manager_trusted_devices set revoked_at=now() where credential_id=${q(credential)};`);
 reject(statement(first),/42501/);
 sql(`update public.ops_manager_trusted_devices set revoked_at=null,max_access_level='read_only' where credential_id=${q(credential)};`);
 reject(statement(first),/42501/);
 sql(`update public.ops_manager_trusted_devices set max_access_level='full_access' where credential_id=${q(credential)};`);
 for(const role of ['anon','authenticated','custodial_application_reader']){
  reject(statement(first).replace('set role service_role','set role '+role),/42501/);
  reject(`set role ${role};select * from public.system_feedback_triage_receipts;`,/42501/);
 }
 reject('set role service_role;select * from public.system_feedback_triage_receipts;',/42501/);
 reject(`update public.system_feedback_triage_receipts set action='closed' where request_id=${q(first.p_request)};`,/55000/);
 eq(sql("select relrowsecurity and relforcerowsecurity from pg_class where oid='public.system_feedback_triage_receipts'::regclass;"),'t');
 // Opposite concurrent actions on one exact version cannot silently overwrite.
 const race=randomUUID();createItem(race);const a=make('resolved',race),b={...make('closed',race),p_expected_version:a.p_expected_version};
 const outcomes=await Promise.allSettled([parallelSql(statement(a)),parallelSql(statement(b))]);
 eq(outcomes.filter(r=>r.status==='fulfilled').length,1);eq(outcomes.filter(r=>r.status==='rejected').length,1);
 eq(sql(`select count(*) from public.system_feedback_triage_receipts where feedback_id=${q(race)};`),'1');

 const env={NODE_ENV:'production',OPS_MANAGER_AUTH_REQUIRED:'true',OPS_MANAGER_SESSION_SECRET:'synthetic-feedback-triage-auth-test-only'};
 const named={manager_id:manager,display_name:'Synthetic Triage Manager',roles:['CUSTODIAL_MANAGER'],active:true,revoked_at:null};
 const trusted={credential_id:credential,device_id:'OPS_TRIAGE_SYNTHETIC',device_label:'Synthetic',token_hash:'synthetic-only',
  created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),manager_id:manager,manager:named,max_access_level:'full_access',revoked_at:null};
 const app=express();app.use(express.json());let calls=0;
 const auth=makeOpsAccessMiddleware({env,requireWrite:true,trustedDeviceStore:{find:async key=>key===credential?trusted:null}});
 app.post('/feedback/:feedbackId',auth,feedbackTriageHandler({runRpc:async(name,args)=>{
  eq(name,'custodial_feedback_triage');calls++;try{return rpc(args);}catch(error){const code=String(error.stderr).match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1];throw Object.assign(error,{code});}
 }}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const httpItem=randomUUID();createItem(httpItem);const command=make('closed',httpItem);
  const body={request_id:command.p_request,status:command.p_action,expected_version:command.p_expected_version,
   expected_manager_id:manager,expected_credential_id:credential};
  const token=createOpsManagerSession({credentialId:credential,deviceId:trusted.device_id,manager:named,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env}).token;
  const url=`http://127.0.0.1:${server.address().port}/feedback/${httpItem}`;
  const send=(payload=body,authorization=token)=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...(authorization?{authorization:'Bearer '+authorization}:{})},body:JSON.stringify(payload)});
  eq((await send(body,null)).status,401);eq(calls,0);
  eq((await send({...body,expected_manager_id:other})).status,403);eq(calls,0);
  eq((await send({...body,actor:'forged'})).status,422);eq(calls,0);
  let response=await send();eq(response.status,200);eq(response.headers.get('cache-control'),'no-store');
  const result=await response.json();eq(result.receipt.request_id,body.request_id);eq(result.receipt.status,'closed');
  response=await send();eq(response.status,200);eq((await response.json()).receipt,result.receipt);
  eq((await send({...body,request_id:randomUUID()})).status,409);
  trusted.revoked_at=new Date().toISOString();eq((await send()).status,401);
 }finally{await new Promise(r=>server.close(r));}
 // Catalog/readback uses only explicitly granted pure version helper.
 eq(sql("select bool_and(definition_sha256=public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(object_identity))) from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity like '%custodial_feedback_triage%';"),'t');
 console.log(JSON.stringify({status:'FEEDBACK_TRIAGE_SQL_AND_AUTHENTICATED_HTTP_PASS',checks,realPostgres:true,syntheticRows:true,productionWritten:false}));
 return checks;
}
