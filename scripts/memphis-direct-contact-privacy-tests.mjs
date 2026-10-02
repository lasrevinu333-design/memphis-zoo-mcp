import assert from 'node:assert/strict';
import {createMessagingRouter} from '../src/messaging-api.js';
const user='10000000-0000-4000-8000-000000000001',bot='10000000-0000-4000-8000-000000000002',message='20000000-0000-4000-8000-000000000001',thread='30000000-0000-4000-8000-000000000001',manager='40000000-0000-4000-8000-000000000001';
let handler,mode='employee',sent,queries=[],checks=0;
createMessagingRouter({runReadOnlySql:async sql=>{
 queries.push(sql);
 if(sql.includes('join public.ops_manager_managers')){
  assert.match(sql,/m\.active = true/);assert.match(sql,/m\.revoked_at is null/);assert.match(sql,/m\.is_system_principal = false/);
  assert.match(sql,/u\.is_active = true/);checks+=4;
  return mode==='manager'?[{msg_user_id:user,manager_id:manager,manager_roles:['OPS_MANAGER']}]:mode==='unapproved-role'?[{msg_user_id:user,manager_id:manager,manager_roles:['EMPLOYEE']}]:[];
 }
 if(sql.includes('from public.internal_ops_contacts'))return [{display_name:'Synthetic Contact',role_title:'Custodial Manager',phone:'555-0199',notes:'PRIVATE_NOTE',active:true}];
 if(sql.includes('where client_message_id'))return [];
 if(sql.includes('from public.msg_messages m'))return [{id:message,sender_user_id:user,thread_id:thread,device_id:'SYNTHETIC',body:'How do I contact the custodial manager?',metadata_json:{role:'manager',manager_id:manager}}];
 if(sql.includes('msg_get_memphis_user_id'))return [{memphis_user_id:bot}];
 return [];
},runRpc:async(name,args)=>{assert.equal(name,'msg_send_message');sent=args;return {id:'50000000-0000-4000-8000-000000000001'};},
 registerOperationalJobHandler:(name,fn)=>{assert.equal(name,'memphis_bot_reply');handler=fn;},buildHealthPayload:()=>({}),appVersion:'synthetic',releaseId:'synthetic',contractVersion:'synthetic'});
for(mode of ['employee','revoked-manager','unapproved-role','manager']){
 queries=[];await handler({source_id:message});
 assert.match(sent.p_body,/Synthetic Contact/);checks++;
 assert.doesNotMatch(sent.p_body,/PRIVATE_NOTE/);checks++;
 if(mode==='manager'){assert.match(sent.p_body,/555-0199/);checks++;}
 else{assert.doesNotMatch(sent.p_body,/555-0199/);checks++;}
 assert.ok(queries.some(q=>q.includes('join public.ops_manager_managers')));checks++;
 assert.equal(sent.p_sender_user_id,bot);checks++;
 assert.equal(sent.p_client_message_id,`memphis-reply:${message}`);checks++;
}
console.log(JSON.stringify({status:'PASS',checks,scope:'actual durable Memphis job/direct-contact caller with synthetic SQL/RPC; no AI call, real directory or database authorization proof'}));
