import assert from 'node:assert/strict';
import express from 'express';
import {createScheduleRouter} from '../src/schedule-api.js';
import {makeDeviceCredentialMiddleware} from '../src/auth/device-credential-auth.js';
import {outcomeHttpFixture} from './original-delivery-outcome-http-tests.mjs';

// Actual router + credential middleware + migrated RPCs. Synthetic secret is
// confined to the disposable fixture; this is not native MAC/install evidence.
export async function testNotificationPlanHttp({client,fixture:f,envelope,applied,check}){
 let calls=0;const names=[];
 const readSql=async sql=>(await client.query(sql)).rows;
 const auth=makeDeviceCredentialMiddleware({env:outcomeHttpFixture.env,requireEnrolledCredential:true,runReadOnlySql:readSql,
  store:{getPolicy:async()=>({mode:'enforce'}),findCredential:async value=>(await client.query('select * from public.device_auth_credentials where credential_id=$1',[value])).rows[0]??null,
   touchCredential:async()=>{},audit:async()=>{}}});
 const deny=(_req,res)=>res.status(403).json({ok:false,code:'synthetic_manager_denied'});
 const app=express();app.use(express.json({limit:'256kb'}));
 const rpc={
  static_weekly_v24_read_device_schedule_delivery:{keys:['p_date','p_device','p_credential','p_employee','p_epoch'],sql:'select public.static_weekly_v24_read_device_schedule_delivery($1,$2,$3,$4,$5) value'},
  static_weekly_v27_issue_recurring_notification_plan:{keys:['p_date','p_device','p_credential','p_employee','p_epoch','p_intent','p_target_digest'],sql:'select public.static_weekly_v27_issue_recurring_notification_plan($1,$2,$3,$4,$5,$6,$7) value'},
  static_weekly_v27_ack_device_schedule_delivery:{keys:['p_plan_read','p_intent','p_device','p_credential','p_employee','p_epoch','p_target_type','p_revision','p_target_digest','p_rendered_digest','p_applied_at'],sql:'select public.static_weekly_v27_ack_device_schedule_delivery($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value'},
  static_weekly_v26_read_original_delivery_outcome:{keys:['p_intent','p_target_type','p_device','p_credential','p_employee','p_epoch'],sql:'select public.static_weekly_v26_read_original_delivery_outcome($1,$2,$3,$4,$5,$6) value'},
 };
 app.use('/schedule-api',createScheduleRouter({runReadOnlySql:readSql,requireDeviceAccess:auth,requireAdminApiAuth:deny,requireOpsManagerAuth:deny,
  runRpc:async(name,args)=>{
   const spec=rpc[name];assert.ok(spec,'fixed finite RPC only '+name);assert.deepEqual(Object.keys(args).sort(),[...spec.keys].sort());
   calls++;names.push(name);await client.query('savepoint plan_http_rpc');
   try{await client.query('set local role service_role');const value=(await client.query(spec.sql,spec.keys.map(key=>args[key]))).rows[0].value;
    await client.query('reset role');await client.query('release savepoint plan_http_rpc');return value;
   }catch(error){await client.query('rollback to savepoint plan_http_rpc');await client.query('release savepoint plan_http_rpc');throw error;}
  },appVersion:'synthetic-plan-test',releaseId:'synthetic-plan-test',contractVersion:'schedule.v2'}));
 const server=await new Promise((resolve,reject)=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));value.once('error',reject);});
 const origin='http://127.0.0.1:'+server.address().port;
 const headers={authorization:`Device ${f.credential}.${outcomeHttpFixture.secret}`,'x-device-id':'KIOSK_08',origin:'https://localhost','x-memphis-app-edition':'custodial','content-type':'application/json'};
 const receipt={intent_id:f.intent,target_type:'SCHEDULE',authority_revision:f.delivery.target.authorityRevision,target_digest:f.delivery.targetDigest,rendered_digest:f.delivery.viewDigest,applied_at:applied};
 const send=async({method='POST',path='/my-day-summary/delivery-receipt',body=receipt,custom={...headers,'x-custodial-plan-read-id':envelope.body.plan_read_id}}={})=>{
  const response=await fetch(origin+'/schedule-api'+path,{method,headers:custom,body:method==='POST'?JSON.stringify(body):undefined,signal:AbortSignal.timeout(3000)});
  return {status:response.status,body:await response.json()};
 };
 const requireData=(response,label)=>{
  const code=response?.body?.code;
  const diagnostic={status:response?.status,ok:response?.body?.ok===true,
   hasData:response?.body?.data!==null&&typeof response?.body?.data==='object'&&!Array.isArray(response?.body?.data),
   code:typeof code==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(code)?code:null,
   rpcCalls:calls,rpcNames:[...new Set(names)]};
  assert.equal(response?.status,200,label+' '+JSON.stringify(diagnostic));
  assert.equal(diagnostic.ok,true,label+' '+JSON.stringify(diagnostic));
  assert.equal(diagnostic.hasData,true,label+' '+JSON.stringify(diagnostic));
  return response.body.data;
 };
 try{
  let response=await send();let data=requireData(response,'actual authenticated exact-token HTTP receipt');assert.ok(data.receipt&&typeof data.receipt==='object','actual receipt object required');check([response.status,data.receipt.intentId],[200,f.intent],'actual authenticated exact-token HTTP receipt');
  for(const custom of [headers,{...headers,'x-custodial-plan-read-id':'not-a-uuid'},{...headers,'x-custodial-plan-read-id':[envelope.body.plan_read_id,envelope.body.plan_read_id]}]){
   const before=calls;response=await send({custom});check([response.status,calls],[422,before],'missing/malformed/duplicate plan header refused before RPC');
  }
  for(const value of [{...receipt,extra:true},{...receipt,authority_revision:'1'},{...receipt,authority_revision:9007199254740992},{...receipt,applied_at:'2026-02-31T12:00:00.000000Z'}]){
   const before=calls;response=await send({body:value});check([response.status,calls],[422,before],'extra/coerced/unsafe/nonGregorian six-field body refused before RPC');
  }
  for(const custom of [{},{...headers,authorization:'Device '+f.credential+'.wrong-secret'},{...headers,'x-device-id':'KIOSK_09'}]){
   const before=calls;response=await send({custom});check(response.status>=400&&calls===before,true,'actual auth/device denial before receipt RPC');
  }
  response=await send({custom:{...headers,'x-custodial-plan-read-id':'99999999-9999-4999-8999-999999999999'}});
  check([response.status,response.body.code],[503,'original_delivery_receipt_unavailable'],'unknown token never reaches old writer and no SQL details');
  response=await send({method:'GET',path:`/my-day-summary/delivery-receipt?intent_id=${f.intent}&target_type=SCHEDULE`,custom:headers});
  data=requireData(response,'actual original outcome HTTP');check([response.status,data.status,data.retryAuthorized],[200,'RECEIPT_RECORDED',false],'original outcome remains available without plan token');
  response=await send({method:'GET',path:`/my-day-summary?device_id=KIOSK_08&service_date=${f.serviceDate}`,custom:headers});
  data=requireData(response,'actual normal authenticated summary');check(response.status,200,'actual normal authenticated summary remains compatible');
  if(f.normalDeliveryMode==='RECURRING_SCHEDULE'){
   check(data.schedule_delivery_mode,'RECURRING_SCHEDULE','normal GET uses actual accepted recurring publication');
   assert.ok(data.recurring_delivery&&typeof data.recurring_delivery==='object','actual recurring delivery object required');
   check([data.recurring_delivery.targetDigest,data.recurring_delivery.viewDigest],[f.delivery.targetDigest,f.delivery.viewDigest],'old target/view digests unchanged by plan metadata');
   const plan=data.ordinary_notification_plan;assert.ok(plan?.body&&typeof plan.body==='object','actual issued complete plan body required');check([plan.body.complete,plan.body.intent_id,plan.body.target_digest],[true,f.intent,f.delivery.targetDigest],'actual normal GET includes newly issued complete plan');
   assert.ok(names.includes('static_weekly_v27_issue_recurring_notification_plan'));
  }else{
   check([data.schedule_delivery_mode,data.recurring_delivery],['LEGACY_REGISTERED',null],'old official release publication is not relabeled recurring acceptance');
   check(data.ordinary_notification_plan,{schema:'custodial.recurring-current-notification-plan-unavailable.v1',complete:false,receipt_eligible:false},'legacy GET explicit unavailable; no omitted metadata inferred empty');
  }
  check(names.includes('static_weekly_v24_ack_device_schedule_delivery'),false,'router has no old direct recurring receipt RPC');
  return {actualLocalHttp:true,actualCredentialMiddleware:true,actualMigratedRpc:true,wholeSixBodyUnchanged:true,nativeInstallOrSendEvidence:false};
 }finally{await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();});assert.equal(server.listening,false,'owned loopback server closed');}
}
