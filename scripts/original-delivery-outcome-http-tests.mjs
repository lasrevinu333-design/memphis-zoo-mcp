import assert from 'node:assert/strict';
import express from 'express';
import {createScheduleRouter} from '../src/schedule-api.js';
import {makeDeviceCredentialMiddleware,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';

export const outcomeHttpFixture={
 env:{NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'synthetic-original-outcome-root-secret-0123456789'},
 secret:'synthetic-original-outcome-device-secret-abcdefghijklmnopqrstuvwxyz1234567890',
};
export function outcomeCredentialSeed(){return {
 hash:deviceCredentialInternals.tokenHash(outcomeHttpFixture.secret,outcomeHttpFixture.env),
 metadata:deviceCredentialInternals.deviceCredentialSecretMetadata(outcomeHttpFixture.env),
};}

export async function testOriginalDeliveryOutcomeHttp({client,id,applied,blocked,check}){
 let rpcCalls=0;const credential=id(2),label='KIOSK_08';
 const readSql=async sql=>(await client.query(sql)).rows;
 const auth=makeDeviceCredentialMiddleware({env:outcomeHttpFixture.env,requireEnrolledCredential:true,runReadOnlySql:readSql,
  store:{getPolicy:async()=>({mode:'enforce'}),findCredential:async value=>(await client.query('select * from public.device_auth_credentials where credential_id=$1',[value])).rows[0]??null,
   touchCredential:async()=>{},audit:async()=>{}}});
 const app=express();
 const denyManager=(_req,res)=>res.status(403).json({ok:false,code:'synthetic_manager_route_denied'});
 app.use('/schedule-api',createScheduleRouter({runReadOnlySql:readSql,requireDeviceAccess:auth,
  requireAdminApiAuth:denyManager,requireOpsManagerAuth:denyManager,
  runRpc:async(name,args)=>{
   rpcCalls++;assert.equal(name,'static_weekly_v26_read_original_delivery_outcome');
   assert.deepEqual(Object.keys(args).sort(),['p_credential','p_device','p_employee','p_epoch','p_intent','p_target_type']);
   await client.query('savepoint http_rpc');await client.query('set local role service_role');
   try{
    const result=(await client.query('select public.static_weekly_v26_read_original_delivery_outcome($1,$2,$3,$4,$5,$6) as result',
     [args.p_intent,args.p_target_type,args.p_device,args.p_credential,args.p_employee,args.p_epoch])).rows[0].result;
    await client.query('reset role');await client.query('release savepoint http_rpc');return result;
   }catch(error){await client.query('rollback to savepoint http_rpc');await client.query('release savepoint http_rpc');throw error;}
  },appVersion:'synthetic-test',releaseId:'synthetic-test',contractVersion:'synthetic-test'}));
 const server=await new Promise((resolve,reject)=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));value.once('error',reject);});
 const origin='http://127.0.0.1:'+server.address().port;
 const headers={authorization:`Device ${credential}.${outcomeHttpFixture.secret}`,'x-device-id':label,origin:'https://localhost','x-memphis-app-edition':'custodial'};
 const request=async(query,custom=headers)=>{
  const response=await fetch(origin+'/schedule-api/my-day-summary/delivery-receipt'+query,{headers:custom,signal:AbortSignal.timeout(3000)});
  return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
 };
 const query=`?intent_id=${id(10)}&target_type=SCHEDULE`;
 try{
  let response=await request(query);check([response.status,response.body.data,response.cache],[200,applied,'no-store'],'actual HTTP original schedule receipt');
  response=await request(`?intent_id=${id(20)}&target_type=BLOCKED_RECURRING_AUTHORITY`);
  check([response.status,response.body.data],[200,blocked],'actual HTTP terminal original');
  response=await request(query);check(response.body.data,applied,'current terminal never hides original schedule');
  for(const [suffix,status] of [['',422],[`?intent_id=${id(10)}`,422],[query+'&device_id=FORGED',401],
   [query+'&intent_id='+id(20),422],[query.replace('SCHEDULE','OTHER'),422]]){
   const before=rpcCalls;response=await request(suffix);check([response.status,rpcCalls],[status,before],'malformed/extra/duplicate query refused before RPC');
  }
  for(const custom of [{},{...headers,authorization:'Device '+credential+'.wrong-secret'},{...headers,'x-device-id':'FOREIGN_OUTCOME'}]){
   const before=rpcCalls;response=await request(query,custom);check(response.status>=400&&rpcCalls===before,true,'actual credential failure refuses read');
  }
  check(rpcCalls,3,'only exact authenticated queries reached outcome SQL');
  response=await request(`?intent_id=${id(99)}&target_type=SCHEDULE`);
  check([response.status,response.body.code],[403,'original_delivery_outcome_unavailable'],'missing original refused without database details');
  response=await request(query);check(response.body.data,applied,'a refused query cannot poison later original read');
  check(rpcCalls,5,'only five exact authenticated SQL calls');
  return {actualLocalHttp:true,actualCredentialMiddleware:true,actualMigratedRpc:true,nativeHmacOrNativeSend:false};
 }finally{
  await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();});
  assert.equal(server.listening,false,'owned local HTTP server closed');
 }
}
