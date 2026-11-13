import assert from 'node:assert/strict';
import {createMessagingRouter} from '../src/messaging-api.js';
const user='10000000-0000-4000-8000-000000000001',bot='10000000-0000-4000-8000-000000000002',message='20000000-0000-4000-8000-000000000001',thread='30000000-0000-4000-8000-000000000001',manager='40000000-0000-4000-8000-000000000001';
let handler,mode='employee',sent,queries=[],checks=0;
createMessagingRouter({runReadOnlySql:async sql=>{
 queries.push(sql);
 if(sql.includes('from public.msg_users u')&&sql.includes('join public.ops_manager_managers')){
  return [{msg_user_id:user,user_active:mode!=='inactive',ops_manager_id:mode.includes('manager')||mode==='unapproved-role'?manager:null,
   manager_id:manager,display_name:'Synthetic Manager',roles:mode==='unapproved-role'?['EMPLOYEE']:['OPS_MANAGER'],
   active:mode!=='revoked-manager',revoked_at:mode==='revoked-manager'?'2026-01-01T00:00:00Z':null,is_system_principal:false}];
 }
 if(sql.includes('msg_get_user_by_device'))return [{role:mode==='guest'?'guest':'employee',msg_user_id:mode==='mismatched-user'?bot:user}];
 if(sql.includes('from public.internal_ops_contacts')){
  assert.match(sql,/where active = true/);checks++;
  if(mode==='employee'){assert.doesNotMatch(sql,/\bnotes\b/);checks++;}
  return [{display_name:'Synthetic Contact',role_title:'Custodial Manager',phone:'555-0199',active:true}];
 }
 if(sql.includes('where client_message_id'))return [];
 if(sql.includes('from public.msg_messages m')&&sql.includes('where m.id ='))return [{id:message,sender_user_id:user,thread_id:thread,device_id:'SYNTHETIC',body:'How do I contact the custodial manager?',metadata_json:{role:'manager',manager_id:manager}}];
 if(sql.includes('msg_get_memphis_user_id'))return [{memphis_user_id:bot}];
 return [];
},runRpc:async(name,args)=>{
 if(name==='msg_send_message'){sent=args;return {id:'50000000-0000-4000-8000-000000000001'};}
 assert.match(name,/^msg_.*context$/);return null;
},registerOperationalJobHandler:(name,fn)=>{assert.equal(name,'memphis_bot_reply');handler=fn;},buildHealthPayload:()=>({}),appVersion:'synthetic',releaseId:'synthetic',contractVersion:'synthetic'});
for(mode of ['employee','revoked-manager','unapproved-role','manager','inactive','mismatched-user','guest']){
 queries=[];sent=null;await handler({source_id:message});
 assert.ok(sent);checks++;
 const allowed=['employee','manager'].includes(mode);
 if(allowed){assert.match(sent.p_body,/Synthetic Contact/);assert.match(sent.p_body,/555-0199/);checks+=2;}
 else{assert.doesNotMatch(sent.p_body,/Synthetic Contact|555-0199/);assert.ok(!queries.some(q=>q.includes('from public.internal_ops_contacts')));checks+=2;}
 assert.ok(queries.some(q=>q.includes('join public.ops_manager_managers')));checks++;
 assert.equal(sent.p_sender_user_id,bot);checks++;
 assert.equal(sent.p_client_message_id,`memphis-reply:${message}`);checks++;
}
console.log(JSON.stringify({status:'PASS',checks,scope:'actual durable Memphis job through shared current-identity responder with synthetic SQL/RPC; approved employee work contacts, no provider or actual directory access'}));
