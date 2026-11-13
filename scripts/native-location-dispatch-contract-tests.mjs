import assert from 'node:assert/strict';
import express from 'express';
import {generateKeyPairSync} from 'node:crypto';
import {installEmployeeNotificationRoutes} from '../src/employee-notifications.js';
import {createPushRuntime} from '../src/manager-notifications.js';
import {deliverNativeLocationJob} from '../src/native-location-dispatch.js';

const id=n=>`88000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let checks=0;const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;console.log('PASS',name);};
const reject=async(name,fn,pattern)=>{await assert.rejects(fn,pattern);checks++;console.log('PASS',name);};
const intervals=[],realInterval=globalThis.setInterval,realFetch=globalThis.fetch;
globalThis.setInterval=(...args)=>{const timer=realInterval(...args);intervals.push(timer);return timer;};
const rpcCalls=[];let sends=0,prepared=0;
const empty={schema:'custodial.native-location-dispatch-status.v1',reserved:false,dispatch_authorized:false};
const db={rpc:async(name)=>{rpcCalls.push(name);if(name==='custodial_native_location_dispatch_status')return{data:empty};
 if(name==='custodial_native_location_target')return{data:{current:false,reason:'native_location_target_unavailable'}};
 throw new Error('legacy_route_marker');}};
const job={job_id:id(1),lease_token:id(2),job_type:'employee_native_push',payload_json:{credential_id:id(3),assignment_epoch:1,data_json:{kind:'employee_location_status'}}};
try{
 const runtime=installEmployeeNotificationRoutes(express(),{env:{},supabase:db,pushRuntime:{configured:false,send:async()=>{sends++;},prepareNativeLocationSender:async()=>{prepared++;return async()=>{sends++;};}}});
 await reject('actual LOCATION callsite uses guarded target route',()=>runtime.deliverClaimedJob(job),/native_location_target_unavailable/);
 check('no legacy reservation health or release call',rpcCalls,['custodial_native_location_dispatch_status','custodial_native_location_target']);
 check('no missing-authority network attempt',sends,0);check('exactly one preparation before admission',prepared,1);
 rpcCalls.length=0;
 await reject('manager test marker stays legacy, not a protected admission',()=>runtime.deliverClaimedJob({...job,payload_json:{...job.payload_json,data_json:{...job.payload_json.data_json,test_delivery:true}}}),/legacy_route_marker/);
 check('test path cannot ask for new protected attempt',rpcCalls.some(x=>x.startsWith('custodial_native_location_')),false);
 rpcCalls.length=0;
 for(const changed of [{...job,job_id:[id(1)]},{...job,lease_token:[id(2)]},{...job,job_type:'employee_event_push'}])
  await reject('typed original job refuses coercion or other kind',()=>deliverNativeLocationJob({db,pushRuntime:{},job:changed}),/contract_invalid/);
 check('typed rejection makes no database call',rpcCalls.length,0);
 await reject('unavailable sender stays pending',()=>deliverNativeLocationJob({db,pushRuntime:{},job}),/sender_unavailable/);
 await reject('preparation failure is finite and does not leak provider text',()=>deliverNativeLocationJob({db,pushRuntime:{prepareNativeLocationSender:async()=>{throw new Error('synthetic-sensitive-provider-text');}},job}),/^Error: native_location_sender_preparation_pending$/);

 // Existing OAuth closure, ephemeral synthetic key only; all network intercepted.
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push(String(url));assert.equal(String(url),'https://oauth2.googleapis.com/token');
  assert.equal(options.method,'POST');return new Response(JSON.stringify({access_token:'synthetic-test-oauth',expires_in:3600}));};
 const push=createPushRuntime({db:null,env:{FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'synthetic-project',client_email:'synthetic@example.invalid',private_key:privateKey})}});
 check('existing runtime config recognized',push.configured,true);
 check('private OAuth closure constructs callable sender',typeof await push.prepareNativeLocationSender(),'function');
 check('preparation does not send a notification',calls,['https://oauth2.googleapis.com/token']);
 await push.prepareNativeLocationSender();check('uses same scoped existing OAuth cache',calls.length,1);
 await reject('missing account remains unavailable',()=>createPushRuntime({db:null,env:{}}).prepareNativeLocationSender(),/not configured/);
 console.log(JSON.stringify({status:'PASS',checks,syntheticTransport:true,production:false,clockQualification:false,activation:false}));
}finally{globalThis.fetch=realFetch;globalThis.setInterval=realInterval;for(const timer of intervals)clearInterval(timer);console.log('OWNED_NOTIFICATION_TIMERS_CLOSED',intervals.length);}
