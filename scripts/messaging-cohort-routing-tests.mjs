import assert from 'node:assert/strict';
import express from 'express';
const {createMessagingRouter}=await import(process.argv.includes('--preserved-baseline')?'../src/.sealed-messaging-before.js':'../src/messaging-api.js');
const id=n=>`c1010000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const cohort=id(1),named=id(2),bot=id(3),threadA=id(4),threadB=id(5),botThread=id(6);
const sessions={A:{manager_id:cohort,claimed_manager_id:id(11),credential_id:id(21),device_id:id(31)},B:{manager_id:cohort,claimed_manager_id:id(12),credential_id:id(22),device_id:id(32)},N:{manager_id:named,credential_id:id(23),device_id:id(33)}};
for(const [key,session]of Object.entries(sessions))Object.assign(session,{role:'ops_manager',read_only:false,token:'synthetic-'+key,...(key==='N'?{}:{auth_mode:'custodial_leadership_pin',actor_kind:'CUSTODIAL_LEADERSHIP_COHORT'})});
const userFor=s=>s.claimed_manager_id===id(11)?id(41):s.claimed_manager_id===id(12)?id(42):id(43);
const messages=new Map(),rpcCalls=[],bridgeCalls=[];let revoked=false,worker,source=null,botWrites=0;
const boundary=(req,res,next)=>{const session=sessions[req.get('X-Synthetic-Actor')||'A'];if(!session||revoked)return res.status(401).json({ok:false});
 if(req.method==='POST'&&req.get('X-CSRF-Token')!=='synthetic-csrf')return res.status(403).json({ok:false});req.memphisAuth={...session};next();};
const bridge=async({session,action,input,origin,csrfToken})=>{
 bridgeCalls.push(action);assert.equal(origin,'https://synthetic.invalid');if(revoked)throw Object.assign(Error('revoked'),{status:403});
 const user=userFor(session);
 if(action==='identity')return{schema:'custodial.cohort-messenger-identity.v1',msg_user_id:user,role:'manager',display_name:'Synthetic selected name (shared PIN)',ops_manager_id:null,custodial_cohort_manager_id:cohort,custodial_claimed_account_id:session.claimed_manager_id,identity_assurance:'SELF_ASSERTED_NAME',individual_identity_verified:false};
 assert.equal(action,'send');assert.equal(csrfToken,'synthetic-csrf');const key=user+':'+input.client_message_id;
 if(messages.has(key))return messages.get(key);
 const result={id:id(100+messages.size),thread_id:input.thread_id,sender_user_id:user,body:input.body,metadata_json:{...input.metadata_json,device_id:session.device_id},client_message_id:input.client_message_id};messages.set(key,result);return result;
};
const runRpc=async(name,args)=>{rpcCalls.push(name);
 if(name==='msg_ensure_ops_manager_user'){if(args.p_manager_id===cohort)throw Object.assign(Error('Active named leadership identity was not found'),{status:403});return{id:id(43),role:'manager',display_name:'Synthetic verified named manager'};}
 if(name==='msg_get_or_create_memphis_thread')return{id:botThread,thread_type:'bot',is_active:true};
 if(name==='claim_operational_notification_job_by_key')return null;
 if(name==='msg_send_message'){assert.equal(args.p_sender_user_id,bot);botWrites++;return{id:id(200),body:args.p_body};}
 if(name==='msg_send_message_as_ops_manager')return{id:id(201),sender_user_id:id(43)};
 if(name==='msg_mark_thread_read_through')return{marked:1,user_id:args.p_user_id};
 throw Error('Unexpected synthetic RPC '+name);
};
const runReadOnlySql=async sql=>{
 if(sql.includes('msg_custodial_cohort_message_actor_v1'))return[{actor:revoked?null:{schema:'custodial.cohort-messenger-actor.v1',msg_user_id:source.sender_user_id,source_message_id:source.id,role:'manager',owner:false,custodial_cohort_manager_id:cohort,custodial_claimed_account_id:id(11),identity_assurance:'SELF_ASSERTED_NAME',individual_identity_verified:false}}];
 if(sql.includes('coalesce(m.metadata_json'))return source?[source]:[];
 if(sql.includes('msg_get_memphis_user_id'))return[{memphis_user_id:bot}];
 if(sql.includes('where client_message_id'))return[];
 if(sql.includes('thread_messages')){
  assert.match(sql,/exists \(select 1 from public.msg_thread_participants tp/,'cohort must not enter named overview');
  return sql.includes(`m.thread_id = '${threadB}'`)&&sql.includes(`tp.user_id = '${id(41)}'`)?[]:[{id:id(101),body:'Own inbox'}];
 }
 if(sql.includes('from public.msg_threads t'))return[{id:sql.includes(botThread)?botThread:sql.includes(threadB)?threadB:threadA,thread_type:sql.includes(botThread)?'bot':'direct',is_active:true,has_memphis_bot:sql.includes(botThread)}];
 if(sql.includes('from public.msg_thread_participants'))return sql.includes(threadB)&&sql.includes(id(41))?[]:[{present:1}];
 if(sql.includes('from public.msg_users'))return[];
 throw Error('Unaccounted SQL boundary');
};
const app=express();app.use(express.json());app.use('/messaging-api',createMessagingRouter({runRpc,runReadOnlySql,requireDeviceAccess:boundary,leadershipMessagingBridge:bridge,
 registerOperationalJobHandler:(type,handler)=>{assert.equal(type,'memphis_bot_reply');worker=handler;},appVersion:'synthetic',releaseId:'not-deployed',contractVersion:'messaging.v5'}));
const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});const origin=`http://127.0.0.1:${server.address().port}`;
async function request(path,{actor='A',body,csrf=true}={}){const r=await fetch(origin+'/messaging-api'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',Origin:'https://synthetic.invalid','X-Synthetic-Actor':actor,...(csrf?{'X-CSRF-Token':'synthetic-csrf'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};}
let passed=0;const failures=[];async function check(name,run){try{await run();passed++;}catch(error){failures.push({name,error:error.message});}}
try{
 await check('two selected names obtain distinct self-asserted inboxes',async()=>{for(const actor of ['A','B']){const r=await request('/me/by-device',{actor});assert.equal(r.status,200);assert.equal(r.body.data.msg_user_id,userFor(sessions[actor]));assert.equal(r.body.data.individual_identity_verified,false);assert.equal(r.body.data.ops_manager_id,null);}});
 await check('cohort cannot impersonate another selected inbox or use overview reads',async()=>{assert.equal((await request('/threads?user_id='+id(42))).status,403);const r=await request(`/thread/${threadB}/messages?user_id=${id(41)}`);assert.equal(r.status,200);assert.deepEqual(r.body.data,[]);});
 await check('ordinary cohort send uses original typed companion and stable receipt',async()=>{const body={sender_user_id:id(41),body:'Synthetic own message',client_message_id:'same-original'};const a=await request(`/thread/${threadA}/message`,{body}),b=await request(`/thread/${threadA}/message`,{body});assert.equal(a.status,200);assert.equal(a.body.data.id,b.body.data.id);assert.equal(a.body.data.sender_user_id,id(41));assert.equal(messages.size,1);});
 await check('foreign thread write, missing CSRF and global admin tombstone denied',async()=>{assert.equal((await request(`/thread/${threadB}/message`,{body:{body:'Forbidden',client_message_id:'no'}})).body.ok,false);assert.equal((await request(`/thread/${threadA}/message`,{csrf:false,body:{body:'Forbidden',client_message_id:'no'}})).status,403);assert.equal((await request(`/thread/${threadA}/admin-tombstone`,{body:{operation_id:id(80)}})).status,403);});
 await check('named path still uses genuine named identity and sender RPC',async()=>{assert.equal((await request('/me/by-device',{actor:'N'})).body.data.msg_user_id,id(43));assert.equal((await request(`/thread/${threadA}/message`,{actor:'N',body:{body:'Named sender',client_message_id:'named-original'}})).status,200);assert.ok(rpcCalls.includes('msg_send_message_as_ops_manager'));});
 await check('Memphis persists cohort sender with typed identity and queued original message',async()=>{const r=await request('/memphis/message',{body:{user_id:id(41),body:'What can you do?',client_message_id:'memphis-original',device_id:sessions.A.device_id}});assert.equal(r.status,200);assert.equal(r.body.data.user_message.sender_user_id,id(41));source={...r.body.data.user_message,device_id:sessions.A.device_id,custodial_cohort_manager_id:cohort,custodial_claimed_account_id:id(11)};await worker({source_id:source.id});assert.equal(botWrites,1);});
 await check('revoked original cohort source cannot produce a later bot message',async()=>{assert.ok(source);revoked=true;await assert.rejects(worker({source_id:source.id}),/no longer current/);assert.equal(botWrites,1);revoked=false;});
 console.log(JSON.stringify({scope:'Shipping router and durable worker; synthetic CP/SQL, no model/provider; per-name authority',passed,failed:failures.length,failures,typedCalls:bridgeCalls,botWrites},null,2));if(failures.length)process.exitCode=1;
}finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));console.log('OWNED_COHORT_HTTP_SERVER_CLOSED');}
