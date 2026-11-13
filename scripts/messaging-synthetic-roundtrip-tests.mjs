import assert from 'node:assert/strict';
import express from 'express';
import {createHash,createHmac} from 'node:crypto';
import {createMessagingRouter} from '../src/messaging-api.js';

// Shipping HTTP router, original-action factory and native request verifier.
// Credentials, source queries and persistence below are synthetic adapters.
// This proves the bounded caller/receipt chain, NOT PostgreSQL or phone delivery.
const id=n=>`ab000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actors=[1,2].map(n=>({device_pk:id(n),device_id:`SYNTHETIC_${n}`,employee_id:id(n+10),
  credential_id:id(n+20),user_id:id(n+30),assignment_epoch:'1',token_hash:String(n).repeat(64),
  secret:`SyntheticNativeSecret${n}_OnlyNoRealCredential`}));
const thread=id(100),message=id(101),at='2026-10-31T12:00:00.123456Z';
const ledger=new Map(),outcomes=new Map(),readBy=new Set(),calls=[];
let refuse=false,loseResponse=false;
const actorFor=req=>actors.find(a=>req.headers.authorization===`Device ${a.credential_id}.${a.secret}`);
const install=(req,a)=>{
  const d={canonical_device_pk:a.device_pk,canonical_device_id:a.device_id,assigned_employee_id:a.employee_id,
    assignment_epoch:a.assignment_epoch,device_active:true,employee_active:true};
  const c={credential_id:a.credential_id,device_id:a.device_pk,token_hash:a.token_hash,confirmed_at:at,revoked_at:null,expires_at:'2099-01-01T00:00:00Z'};
  req.memphisDevice=d;req.memphisDeviceCredential=c;req.memphisDeviceAuth={ok:true,credentialed:true,device:d,credential:c};
};
const requireDeviceAccess=(req,res,next)=>{const a=actorFor(req);if(!a||refuse)return res.status(401).json({ok:false});install(req,a);next();};
const runReadOnlySql=async sql=>{
  if(sql.includes('from public.msg_messages m')){
    assert.match(sql,/msg_thread_participants/);
    return [...ledger.values()].map(r=>({...r,sender_display_name:'Synthetic sender',sender_role:'employee'}));
  }
  if(sql.includes('from public.msg_threads t'))return[{id:thread,thread_type:'direct',is_active:true,has_memphis_bot:false}];
  if(sql.includes('from public.msg_thread_participants'))return[{present:1}];
  const a=actors.find(a=>sql.includes(a.device_id)||sql.includes(a.device_pk));
  if(sql.includes('msg_get_user_by_device'))return a?[{msg_user_id:a.user_id,role:'employee'}]:[];
  if(sql.includes('public.device_aliases'))return a?[{canonical_device_id:a.device_id,device_id:a.device_id,
    device_active:true,assigned_employee_id:a.employee_id,employee_active:true}]:[];
  if(sql.includes('from public.devices d join public.employees'))return a?[{device_pk:a.device_pk,device_id:a.device_id,
    employee_id:a.employee_id,assignment_epoch:a.assignment_epoch,user_id:a.user_id}]:[];
  throw Error('Unaccounted synthetic SQL boundary');
};
const runRpc=async(name,{p_command:command,p_payload:payload})=>{
  calls.push(command);assert.equal(name,'app_apply_operational_command');
  const kind=payload.original_command||command,a=actors.find(a=>a.user_id===payload.user_id);
  assert.ok(a);assert.equal(payload.credential_token_hash,a.token_hash);
  const original={...payload};delete original.credential_token_hash;delete original.original_command;
  const key=kind+':'+JSON.stringify(original);
  if(outcomes.has(key))return structuredClone(outcomes.get(key));
  assert.notEqual(command,'employee_message_original_outcome','readback must never create an effect');
  let result;
  if(kind==='employee_message_original_send'){
    assert.equal(a.user_id,actors[0].user_id);
    result={id:message,thread_id:thread,sender_user_id:a.user_id,message_type:'text',body:payload.body.trim(),
      metadata_json:{...payload.metadata_json,client_message_id:payload.client_message_id},client_message_id:payload.client_message_id,
      sent_at:at,created_at:at,updated_at:at,is_deleted:false,deleted_at:null,deleted_by_user_id:null,purge_after:null};
    assert.equal(ledger.size,0);ledger.set(message,result);
  }else{
    assert.equal(kind,'employee_message_original_read');assert.ok(ledger.has(payload.through_message_id));
    result={marked:readBy.has(a.user_id)?0:1,thread_id:thread,user_id:a.user_id,through_message_id:payload.through_message_id};readBy.add(a.user_id);
  }
  const receipt={schema:'custodial.employee-original-message-outcome.v1',state:'ORIGINAL_TRANSACTION_OUTCOME_RECORDED',
    request_fingerprint:createHash('sha256').update(key).digest('hex'),original_command:kind,
    original_actor:{device_pk:a.device_pk,device_id:a.device_id,employee_id:a.employee_id,credential_id:a.credential_id,assignment_epoch:a.assignment_epoch,user_id:a.user_id},
    original_outcome_recorded:true,inventory_acknowledged:false,finalizer_allowed:false,key_removal:false,original_request:original,result,recorded_at:at};
  outcomes.set(key,receipt);
  if(loseResponse){loseResponse=false;throw Error('Synthetic response lost after memory persistence');}
  return structuredClone(receipt);
};
const app=express();app.use(express.json({verify(req,_res,bytes){req.scanAuthorityRawBody=Buffer.from(bytes);}}));
app.use('/messaging-api',createMessagingRouter({runReadOnlySql,runRpc,requireDeviceAccess,appVersion:'synthetic',releaseId:'not-deployed',contractVersion:'messaging.v5'}));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const origin=`http://127.0.0.1:${server.address().port}`;
async function post(a,suffix,body){
  const path=`/messaging-api/thread/${thread}/${suffix}`,raw=JSON.stringify(body),stamp=new Date().toISOString(),requestId=id(200),version='custodial-native-request.v1';
  const signature=createHmac('sha256',a.secret).update([version,a.credential_id,a.device_id,'POST',path,
    createHash('sha256').update(raw).digest('hex'),requestId,stamp,'custodial'].join('\n')).digest('hex');
  const response=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',authorization:`Device ${a.credential_id}.${a.secret}`,
    'x-memphis-native-attestation-version':version,'x-memphis-native-request-id':requestId,'x-memphis-native-request-timestamp':stamp,
    'x-memphis-app-edition':'custodial','x-memphis-native-request-attestation':signature},body:raw});
  return{status:response.status,body:await response.json()};
}
const pins=a=>({device_id:a.device_id,expected_employee_id:a.employee_id,expected_credential_id:a.credential_id,expected_assignment_epoch:a.assignment_epoch});
try{
  const [sender,recipient]=actors,send={...pins(sender),sender_user_id:sender.user_id,body:'Original synthetic message ñ',
    message_type:'text',metadata_json:{},client_message_id:'synthetic-stable-client-message'};
  loseResponse=true;const lost=await post(sender,'message',send);assert.equal(lost.body.ok,false);assert.equal(ledger.size,1);
  const recovered=await post(sender,'message/original-outcome',send);assert.equal(recovered.status,200);assert.equal(recovered.body.data.id,message);assert.equal(ledger.size,1);
  const duplicate=await post(sender,'message',send);assert.equal(duplicate.body.data.id,message);assert.equal(ledger.size,1);
  const response=await fetch(`${origin}/messaging-api/thread/${thread}/messages?device_id=${recipient.device_id}&user_id=${recipient.user_id}`,
    {headers:{authorization:`Device ${recipient.credential_id}.${recipient.secret}`}});
  const received=await response.json();assert.equal(received.ok,true);assert.equal(received.data[0].id,message);assert.equal(received.data[0].body,send.body);
  const read={...pins(recipient),user_id:recipient.user_id,through_message_id:message};
  const ack=await post(recipient,'read',read);assert.equal(ack.status,200);assert.equal(ack.body.data.marked,1);assert.equal(readBy.has(recipient.user_id),true);
  const again=await post(recipient,'read/original-outcome',read);assert.deepEqual(again.body.data,ack.body.data);assert.equal(readBy.size,1);
  const before=calls.length,forged=await post(recipient,'read',{...read,user_id:sender.user_id});assert.equal(forged.body.ok,false);assert.equal(calls.length,before);
  refuse=true;const revoked=await post(recipient,'read',read);assert.equal(revoked.status,401);assert.equal(calls.length,before);
  console.log(JSON.stringify({status:'PASS_SYNTHETIC_MESSAGE_ROUNDTRIP',messages:ledger.size,recipientReadReceipts:readBy.size,
    originalMessageId:message,lostResponseRecovered:true,duplicateEffect:false,shippingRouter:true,nativeSignatureVerifier:true,
    persistence:'in-memory synthetic adapter, not PostgreSQL',senderVisibleReadReceipt:false,physical:false}));
}finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));console.log('OWNED_SYNTHETIC_MESSAGE_HTTP_SERVER_CLOSED');}
