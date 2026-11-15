import {randomUUID} from 'node:crypto';
import express from 'express';
import {validateRecordOperation,recordOperationFailure} from '../custodial-record-operations.mjs';
import {isCustodialLeadershipManagementSession} from './manager-permissions.js';
const fault=(code,status=403)=>Object.assign(new Error(code),{code,status});
const path='/custodial-leadership-internal/records';
export function createCustodialLeadershipRecordOperation({database,service,verifyTransaction,requestId=randomUUID}){
 if(!database?.connect||typeof service?.authenticateManagerSessionToken!=='function'||typeof verifyTransaction!=='function')throw fault('record_authority_unavailable',503);
 let outstanding=0;
 return async({token,csrfToken,action,input})=>{
  const selected=validateRecordOperation(action,input);
  const verified=await service.authenticateManagerSessionToken({token,csrf:csrfToken,requireCsrf:action==='correct'});
  const manager=verified.managerSession;
  if(!isCustodialLeadershipManagementSession(manager)||manager.identity_assurance!=='SELF_ASSERTED_NAME'||manager.individual_identity_verified!==false)throw fault('record_authority_denied');
  if(outstanding>=4)throw fault('record_operation_busy',503);
  outstanding++;let client,commitStarted=false;
  try{
   client=await database.connect();await client.query('begin');await client.query('set local role static_weekly_control_plane');
   await client.query("set local statement_timeout='5000ms'");await client.query("set local lock_timeout='5000ms'");
   const originalRequestId=requestId();const actor=await verifyTransaction(client,{manager:{...manager,token},leadershipRequestId:originalRequestId});
   if(actor?.policy_version!==manager.permissions.policyVersion||actor.claimed_account_id!==manager.claimed_manager_id||actor.request_id!==originalRequestId
    ||actor.identity_assurance!=='SELF_ASSERTED_NAME'||actor.individual_identity_verified!==false)throw fault('record_authority_denied');
   const r=await client.query('select public.custodial_leadership_record_operation_v1($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) as result',[manager.manager_id,manager.credential_id,manager.device_id,action,JSON.stringify(selected)]);
   if(r.rows?.length!==1||!r.rows[0].result||typeof r.rows[0].result!=='object')throw fault('record_readback_unavailable',503);
   commitStarted=true;await client.query('commit');return r.rows[0].result;
  }catch(e){if(client)await client.query('rollback').catch(()=>{});if(commitStarted)throw fault('record_outcome_unconfirmed',503);throw e;}
  finally{client?.release();outstanding--;}
 };
}
export function installCustodialLeadershipRecordCompanion({router,database,service,verifyTransaction,requireOrigin,token}){
 const operation=database?.connect?createCustodialLeadershipRecordOperation({database,service,verifyTransaction}):null;
 router.post(path,express.json({limit:'20kb'}),async(req,res)=>{try{
  const b=req.body;if(!b||Object.keys(b).sort().join(',')!=='action,csrfToken,input,origin'||typeof b.origin!=='string'||typeof b.csrfToken!=='string')throw fault('invalid_record_request',422);
  validateRecordOperation(b.action,b.input);if(b.action==='correct'||b.origin)requireOrigin(b.origin);
  if(!operation)throw fault('record_authority_unavailable',503);
  const data=await operation({token:token(req),csrfToken:b.csrfToken,action:b.action,input:b.input});
  res.set('Cache-Control','no-store').json({ok:true,data});
 }catch(e){const f=recordOperationFailure(e);res.set('Cache-Control','no-store').status(f.status).json(f.body);}});
}
export function createCustodialLeadershipRecordBridge({env=process.env,fetchImpl=fetch}={}){
 return async(req,action,input)=>{
  if(env.CUSTODIAL_LEADERSHIP_PIN_ENABLED!=='true'||!isCustodialLeadershipManagementSession(req.memphisAuth))throw fault('record_authority_denied');
  const selected=validateRecordOperation(action,input);let response,body;
  try{
   const u=new URL(String(env.STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL||''));
   if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||(u.protocol!=='https:'&&!(env.CUSTODIAL_LEADERSHIP_ALLOW_LOOPBACK_TEST==='true'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))throw fault('record_authority_unavailable',503);
   response=await fetchImpl(u.origin+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+req.memphisAuth.token},body:JSON.stringify({action,input:selected,origin:String(req.get?.('Origin')||''),csrfToken:String(req.get?.('X-CSRF-Token')||'')})});
   const reader=response.body?.getReader();if(!reader)throw fault('record_readback_unavailable',503);const chunks=[];let n=0;
   try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.byteLength;if(n>1048576)throw fault('record_readback_unavailable',503);chunks.push(Buffer.from(p.value));}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch{throw fault('record_outcome_unconfirmed',503);}
  if(!response.ok||body?.ok!==true){const f=recordOperationFailure({status:response.status});throw fault(f.body.code,f.status);}
  if(!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw fault('record_readback_unavailable',503);
  return body.data;
 };
}
