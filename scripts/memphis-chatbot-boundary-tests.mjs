import {pathToFileURL, fileURLToPath} from 'node:url';
const backend=fileURLToPath(new URL('..',import.meta.url));
const names=['GEMINI_API_KEY','MEMPHIS_GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_GENAI_API_KEY','EVENTS_GEMINI_API_KEY','SCHEDULE_GEMINI_API_KEY'];
const saved=new Map([...names,'MEMPHIS_GEMINI_TIMEOUT_MS'].map(n=>[n,process.env[n]]));
const originalFetch=globalThis.fetch,results=[];
for(const n of names)process.env[n]='';process.env.MEMPHIS_GEMINI_TIMEOUT_MS='1000';
const {createMemphisResponder}=await import(pathToFileURL(backend+'/src/memphis-ai.js'));
const {createMessagingRouter}=await import('../src/messaging-api.js');
const user='10000000-0000-4000-8000-000000000001',thread='20000000-0000-4000-8000-000000000001';
function fixture({role='employee',deviceMapped=true,recent=[],managerRecord=true}={}){
 const reads=[],rpcs=[];
 const runReadOnlySql=async sql=>{reads.push(sql);
  if(sql.includes('sch_service_date'))return[{service_date:'2026-10-06'}];
  if(sql.includes('msg_get_memphis_thread_context'))return[{data:{}}];
  if(sql.includes('msg_get_user_by_device'))return deviceMapped?[{msg_user_id:user,display_name:'Synthetic Person',role}]:[];
  if(sql.includes('from public.msg_messages'))return recent;
  if(sql.includes('from public.current_attendance_state'))return[{attendance:123,fetched_at:new Date().toISOString()}];
  if(sql.includes('from public.msg_users')&&sql.includes('ops_manager_managers'))return managerRecord?[{msg_user_id:user,role,display_name:'Synthetic Person',manager_id:'30000000-0000-4000-8000-000000000001',manager_roles:['OPS_MANAGER']}]:[];
  return[];
 };
 const responder=createMemphisResponder({runReadOnlySql,runRpc:async(name,args)=>{rpcs.push({name,args});return null;}});
 return{reads,rpcs,call:userMessage=>responder.generateReply({deviceId:'SYNTHETIC_SESSION_DEVICE',userId:user,threadId:thread,userMessage})};
}
async function probe(id,description,fn){try{results.push({id,description,...await fn()});}catch(error){results.push({id,description,harness_error:String(error.stack||error)});}}
const payload=text=>({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]});
function provider(reply){process.env.MEMPHIS_GEMINI_API_KEY='SYNTHETIC-NOT-A-LIVE-KEY';globalThis.fetch=async(_url,options)=>({ok:true,json:async()=>typeof reply==='function'?reply(options):reply});}
try{
 await probe('AI-01','Completed model answer reaches responder',async()=>{provider(payload('Plants use light.'));const r=await fixture().call('Explain photosynthesis.');return{pass:r.text==='Plants use light.'&&r.meta.provider==='gemini'};});
 await probe('AI-02','Answer fits existing 2000-character persistence limit',async()=>{provider(payload('A'.repeat(2500)));const r=await fixture().call('Explain photosynthesis.');return{pass:Array.from(r.text).length<=2000,reply_characters:Array.from(r.text).length};});
 await probe('AI-03','Explicitly incomplete model answer is identified',async()=>{provider({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'An incomplete sentence because'}]}}]});const r=await fixture().call('Explain photosynthesis.');return{pass:r.meta.provider!=='gemini'||r.meta.truncated===true||r.meta.incomplete===true,text:r.text,meta:r.meta};});
 await probe('AI-04','Thought parts do not enter final response',async()=>{provider({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'SYNTHETIC_INTERNAL_THOUGHT'},{text:'Plants use light.'}]}}]});const r=await fixture().call('Explain photosynthesis.');return{pass:!r.text.includes('SYNTHETIC_INTERNAL_THOUGHT'),text:r.text};});
 await probe('AI-05','Timeout covers response body, not only headers',async()=>{let aborted=false;process.env.MEMPHIS_GEMINI_API_KEY='SYNTHETIC-NOT-A-LIVE-KEY';globalThis.fetch=async(_url,{signal})=>({ok:true,json:()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(payload('LATE BODY ACCEPTED')),1300);signal.addEventListener('abort',()=>{aborted=true;clearTimeout(timer);reject(Error('Synthetic body abort'));},{once:true});})});const start=Date.now();const r=await fixture().call('Explain photosynthesis.');return{pass:aborted&&r.text!=='LATE BODY ACCEPTED',aborted,elapsed_ms:Date.now()-start,text:r.text};});
 await probe('AI-06','Current message not repeated in provider history',async()=>{let contents=[];provider(options=>{contents=JSON.parse(options.body).contents;return payload('Plants use light.');});const prompt='Explain photosynthesis.';await fixture({recent:[{message_type:'text',body:prompt}]}).call(prompt);const copies=contents.flatMap(c=>c.parts).filter(p=>p.text.includes(prompt)).length;return{pass:copies===1,current_message_copies:copies};});
 await probe('AI-07','Upcoming query honors exact recorded end instant',async()=>{for(const n of names)process.env[n]='';const f=fixture();await f.call('What events are coming up?');const sql=f.reads.find(q=>q.includes('from public.events_app_events'))||'';return{pass:/end_instant_utc\s*>\s*(?:now\(\)|statement_timestamp\(\))/.test(sql),events_query_reached:!!sql,date_only_end_filter:sql.includes('coalesce(e.end_date, e.event_date) >=')};});
 await probe('AI-08','Chat history respects deleted and user-hidden content',async()=>{provider(payload('General answer.'));const f=fixture();await f.call('Explain photosynthesis.');const sql=f.reads.find(q=>q.includes('from public.msg_messages'))||'';return{pass:/is_deleted\s+is\s+false/.test(sql)&&sql.includes('hidden_before'),history_query_reached:!!sql,deleted_filter:/is_deleted\s+is\s+false/.test(sql),user_visibility_filter:sql.includes('hidden_before')};});
 await probe('AI-09','Named manager need not have legacy device mapping',async()=>{for(const n of names)process.env[n]='';const f=fixture({role:'manager',deviceMapped:false});const r=await f.call('What is guest attendance today?');return{pass:r.text.includes('123'),text:r.text,scope:'Actual responder with synthetic named-manager registry and unmapped session-device ID; no live account.'};});
 await probe('AI-10','Operational question remains on internal data path',async()=>{let calls=0;provider(()=>{calls++;return payload('UNSUPPORTED CLAIM');});const r=await fixture().call('How many maintenance tickets are open?');return{pass:calls===0&&r.text!=='UNSUPPORTED CLAIM',external_calls:calls};});
 await probe('AI-11','Provider failure has safe nontechnical fallback',async()=>{process.env.MEMPHIS_GEMINI_API_KEY='SYNTHETIC-NOT-A-LIVE-KEY';globalThis.fetch=async()=>({ok:false,status:429,json:async()=>({error:{message:'SYNTHETIC_PROVIDER_SECRET_DETAIL'}})});const r=await fixture().call('Explain photosynthesis.');return{pass:!!r.text&&!r.text.includes('SYNTHETIC_PROVIDER_SECRET_DETAIL')&&r.meta.provider!=='gemini',text:r.text};});
 await probe('AI-12','Unmapped employee cannot gain manager reads by claiming a role',async()=>{for(const n of names)process.env[n]='';const f=fixture({deviceMapped:false,managerRecord:false});let denied=false;try{await f.call('What is guest attendance today?');}catch{denied=true;}return{pass:denied&&!f.reads.some(q=>q.includes('from public.current_attendance_state'))};});
 await probe('AI-13','Safety-stopped candidate is not presented as a final answer',async()=>{provider({candidates:[{finishReason:'SAFETY',content:{parts:[{text:'SYNTHETIC_BLOCKED_CANDIDATE'}]}}]});const r=await fixture().call('Explain photosynthesis.');return{pass:!r.text.includes('SYNTHETIC_BLOCKED_CANDIDATE')&&r.meta.provider!=='gemini'};});
 await probe('AI-14','Empty successful provider response uses fallback',async()=>{provider({candidates:[]});const r=await fixture().call('Explain photosynthesis.');return{pass:!!r.text&&r.meta.provider!=='gemini'};});
 await probe('AI-15','Actual durable bot worker bounds generated messages before saving',async()=>{
  provider(payload('B'.repeat(2500)));let worker,stored,history='';
  const message='40000000-0000-4000-8000-000000000001',bot='50000000-0000-4000-8000-000000000001';
  createMessagingRouter({runReadOnlySql:async sql=>{
   if(sql.includes('where m.id ='))return[{id:message,thread_id:thread,sender_user_id:user,device_id:'SYNTHETIC_SESSION_DEVICE',body:'Explain photosynthesis.'}];
   if(sql.includes('msg_get_memphis_user_id'))return[{memphis_user_id:bot}];
   if(sql.includes('msg_get_user_by_device'))return[{msg_user_id:user,role:'employee'}];
   if(sql.includes('msg_get_memphis_thread_context'))return[{data:{}}];
   if(sql.includes('sch_service_date'))return[{service_date:'2026-10-06'}];
   if(sql.includes('from public.msg_messages m'))history=sql;
   return[];
  },runRpc:async(name,args)=>{if(name==='msg_send_message'){stored=args;return{id:'60000000-0000-4000-8000-000000000001'};}return null;},
   buildHealthPayload:()=>({ok:true}),requireDeviceAccess:(_q,_s,next)=>next(),
   registerOperationalJobHandler:(name,fn)=>{if(name==='memphis_bot_reply')worker=fn;},appVersion:'test',releaseId:'test',contractVersion:'test'});
  await worker({source_id:message});return{pass:!!stored&&Array.from(stored.p_body).length<=2000&&stored.p_metadata_json.truncated===true&&history.includes('original.id=')&&stored.p_client_message_id==='memphis-reply:'+message,stored_characters:Array.from(stored?.p_body||'').length};
 });
 await probe('AI-16','Missing or hidden queued source completes without recreating a conversation',async()=>{
  let worker,writes=0,sourceQuery='';
  createMessagingRouter({runReadOnlySql:async sql=>{if(sql.includes('where m.id ='))sourceQuery=sql;return[];},runRpc:async()=>{writes++;throw Error('Unexpected write');},buildHealthPayload:()=>({ok:true}),requireDeviceAccess:(_q,_s,next)=>next(),registerOperationalJobHandler:(name,fn)=>{if(name==='memphis_bot_reply')worker=fn;},appVersion:'test',releaseId:'test',contractVersion:'test'});
  const result=await worker({source_id:'40000000-0000-4000-8000-000000000001'});
  return{pass:result.skipped===true&&writes===0&&sourceQuery.includes('hidden_before')&&sourceQuery.includes('participant.left_at is null')};
 });
 await probe('AI-17','Named manager self-identification uses the resolved sender rather than a kiosk assignment',async()=>{for(const n of names)process.env[n]='';const r=await fixture({role:'manager',deviceMapped:false}).call('Who am I?');return{pass:r.text==='You are Synthetic Person.',text:r.text};});
}finally{globalThis.fetch=originalFetch;for(const[n,v]of saved){if(v===undefined)delete process.env[n];else process.env[n]=v;}}
const result={source:backend,scope:'Actual responder with synthetic SQL/RPC/provider transport. No real model call, private data, live message or production change.',cases:results.length,passed:results.filter(r=>r.pass===true).length,failed:results.filter(r=>r.pass===false).length,harness_errors:results.filter(r=>r.harness_error).length,results};
console.log(JSON.stringify(result,null,2));process.exitCode=result.harness_errors?2:result.failed?1:0;
