import assert from 'node:assert/strict';
import express from 'express';
import { createMessagingRouter } from '../src/messaging-api.js';
const id=n=>`bc000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const manager=id(1),user=id(2),receipts=new Map();let effects=0,lost=false;
const boundary=(req,_res,next)=>{req.memphisAuth={manager_id:manager,credential_id:id(3),device_id:'synthetic-broadcast-browser',read_only:false};next();};
const runRpc=async(name,args)=>{
 if(name==='msg_ensure_ops_manager_user')return{id:user,role:'manager',is_active:true};
 if(name==='msg_send_broadcast') { effects++;if(lost){lost=false;throw Error('Synthetic response lost after commit');}return[{thread_id:id(100+effects),broadcast_id:id(200+effects),message_id:id(300+effects),recipient_count:2}]; }
 assert.equal(name,'msg_broadcast_operation_v1');assert.equal(args.p_sender_user_id,user);
 const key=args.p_sender_user_id+':'+args.p_client_broadcast_id,payload=JSON.stringify([args.p_title,args.p_body]);
 let existing=receipts.get(key);
 if(existing){if(existing.payload!==payload)throw Object.assign(Error('Client broadcast ID already belongs to a different payload.'),{code:'23505'});return structuredClone(existing.data);}
 if(args.p_read_only)return [];
 effects++;const data=[{thread_id:id(100+effects),broadcast_id:id(200+effects),message_id:id(300+effects),recipient_count:2}];receipts.set(key,{payload,data});
 if(lost){lost=false;throw Error('Synthetic response lost after commit');}return structuredClone(data);
};
const app=express();app.use(express.json());app.use('/messaging-api',createMessagingRouter({runRpc,runReadOnlySql:async()=>[],requireDeviceAccess:boundary,appVersion:'synthetic',releaseId:'not-deployed',contractVersion:'messaging.v5'}));
const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
const origin=`http://127.0.0.1:${server.address().port}`;
async function post(suffix,body){const r=await fetch(origin+'/messaging-api/broadcast'+suffix,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};}
const failures=[];let passed=0;async function check(name,run){try{await run();passed++;}catch(error){failures.push({name,error:error.message});}}
try {
 const request={sender_user_id:user,title:'Synthetic operations',body:'Synthetic retained broadcast',client_broadcast_id:'synthetic-original-broadcast'};
 await check('lost committed response retry creates exactly one broadcast',async()=>{lost=true;assert.equal((await post('',request)).body.ok,false);assert.equal(effects,1);const retry=await post('',request);assert.equal(retry.status,200);assert.equal(effects,1);assert.equal(retry.body.data[0].broadcast_id,id(201));});
 await check('original outcome returns the same accepted result without mutation',async()=>{const result=await post('/original-outcome',request);assert.equal(result.status,200);assert.equal(result.body.data[0].broadcast_id,id(201));assert.equal(effects,1);});
 await check('changed payload under the original ID conflicts',async()=>{const result=await post('',{...request,body:'Changed'});assert.equal(result.status,409);assert.equal(effects,1);});
 await check('missing stable ID fails before writer',async()=>{const result=await post('',{title:request.title,body:request.body});assert.equal(result.status,422);assert.equal(effects,1);});
 await check('forged sender remains refused',async()=>{const result=await post('',{...request,sender_user_id:id(99)});assert.equal(result.status,403);assert.equal(effects,1);});
 await check('unknown original outcome never writes',async()=>{const result=await post('/original-outcome',{...request,client_broadcast_id:'never-sent'});assert.equal(result.status,200);assert.deepEqual(result.body.data,[]);assert.equal(effects,1);});
 console.log(JSON.stringify({scope:'Shipping HTTP router with synthetic transactional receipt adapter; PostgreSQL separately required',passed,failed:failures.length,failures,effects},null,2));if(failures.length)process.exitCode=1;
}finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));console.log('OWNED_BROADCAST_HTTP_SERVER_CLOSED');}
