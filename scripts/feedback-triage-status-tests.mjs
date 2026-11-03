import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {feedbackTriageStatusHandler} from '../src/feedback-triage-status.js';

if(!process.argv.includes('--affected-sql-member-only')){
const ids={manager:randomUUID(),credential:randomUUID(),feedback:randomUUID(),request:randomUUID()};
const command={request_id:ids.request,status:'closed',expected_version:'a'.repeat(64),
  expected_manager_id:ids.manager,expected_credential_id:ids.credential};
const original={...command,feedback_id:ids.feedback};
const session={role:'ops_manager',manager_id:ids.manager,credential_id:ids.credential,device_id:'SYNTHETIC_MANAGER',
  token:'SYNTHETIC_SIGNED_BINDING_NOT_A_CREDENTIAL',expires_at:new Date(Date.now()+3600000).toISOString(),
  access_level:'full_access',read_only:false,auth_mode:'trusted_device'};
const applied=()=>({ok:true,outcome:'APPLIED',retry_safe:false,command:{...original},receipt:{request_id:ids.request,
  feedback_id:ids.feedback,status:'closed',triage_version:'b'.repeat(64),actor_manager_id:ids.manager,
  actor_credential_id:ids.credential,accepted_at:'2026-10-11T12:00:00.123456+00:00'}});
if(process.argv.includes('--affected-runtime-mount-only')){
 const route='/dashboard-api/system-feedback/:feedbackId/triage-status';
 const registrations=readFileSync(new URL('../src/index.js',import.meta.url),'utf8').split('\n').filter(line=>line.startsWith('app.post("'+route+'"'));
 assert.equal(registrations.length,1);let count=0;
 for(const mode of ['applied','reader-unavailable','denied']){
  let handler,status=200,response,reads=0,gates=0;
  const runRpc=async(name,args)=>{reads++;assert.equal(name,'custodial_feedback_triage_receipt');
   assert.equal(Object.isFrozen(args),true);assert.equal(args.p_request,command.request_id);
   assert.equal(args.p_feedback,ids.feedback);assert.equal(args.p_manager,ids.manager);assert.equal(args.p_credential,ids.credential);
   assert.equal(args.p_action,command.status);assert.equal(args.p_expected_version,command.expected_version);
   if(mode==='reader-unavailable')throw Error('SYNTHETIC_PRIVATE_DB_ERROR');return applied();};
  const requireOpsManagerWrite=async(req,res,next)=>{gates++;assert.equal(req.memphisAuth,undefined);
   if(mode==='denied'){res.status(403).json({error:'denied'});return;}req.memphisAuth={...session};next();};
  vm.runInNewContext(registrations[0],{app:{post(path,registered){assert.equal(path,route);handler=registered;}},feedbackTriageStatusHandler,runRpc,requireOpsManagerWrite});
  assert.equal(typeof handler,'function');
  await handler({body:{...command},params:{feedbackId:ids.feedback}},
   {setHeader(){},status(value){status=value;return this;},json(value){response=value;return this;}});
  if(mode==='applied'){assert.equal(status,200);assert.deepEqual(JSON.parse(JSON.stringify(response)),applied());assert.equal(reads,1);assert.equal(gates,2);}
  else{assert.equal(status,mode==='denied'?403:503);assert.equal(response.outcome,'UNKNOWN');assert.equal(response.retry_safe,false);
   assert.equal(response.receipt,undefined);assert.equal(JSON.stringify(response).includes('SYNTHETIC_PRIVATE_DB_ERROR'),false);
   assert.equal(reads,mode==='denied'?0:1);assert.equal(gates,mode==='denied'?1:2);}
  count++;
 }
 console.log(JSON.stringify({status:'FEEDBACK_ORIGINAL_STATUS_OWNING_MOUNT_PASS',cases:count,actualSourceRegistration:true,RPC:'synthetic',gate:'synthetic',SQL:false,HTTP:false,browser:false}));process.exit(0);
}
let cases=0;
async function invoke({value=applied(),body=command,feedbackId=ids.feedback,gateHook,readerHook}={}){
  const req={body:structuredClone(body),params:{feedbackId},memphisAuth:{...session}},headers={};
  let response,status=200,reads=0,gates=0;
  const handler=feedbackTriageStatusHandler({
    requireOpsManagerWrite:async(req,sink,next)=>{gates++;assert.equal(req.memphisAuth,undefined);
      const changed=gateHook?await gateHook({req,sink,number:gates,value}):null;
      if(changed?.deny){sink.status(changed.deny).json({error:'DO_NOT_LEAK_PROVIDER'});return;}
      if(changed?.throw)throw Error('DO_NOT_LEAK_PROVIDER');
      if(changed?.skip)return;req.memphisAuth={...session,...changed?.session};next();},
    readOriginalReceipt:async args=>{reads++;assert.equal(Object.isFrozen(args),true);
      assert.deepEqual(args,{p_request:ids.request,p_manager:ids.manager,p_credential:ids.credential,
        p_feedback:ids.feedback,p_action:'closed',p_expected_version:'a'.repeat(64)});
      if(readerHook)await readerHook({req,args,value});return value;},
  });
  await handler(req,{setHeader:(k,v)=>headers[k]=v,status(v){status=v;return this;},json(v){response=v;return this;}});
  assert.equal(headers['Cache-Control'],'private, no-store');assert.equal(headers.Vary,'Authorization, Cookie, X-Device-Id');
  assert.equal(JSON.stringify(response).includes('DO_NOT_LEAK'),false);assert.equal(JSON.stringify(response).includes(session.token),false);
  return{status,response,reads,gates};
}
function unknown(result,status){assert.equal(result.status,status);assert.equal(result.response.outcome,'UNKNOWN');
  assert.equal(result.response.retry_safe,false);assert.notEqual(result.response.command_rejected,true);assert.equal(result.response.receipt,undefined);}

const finalNewlineOnly=process.argv.includes('--affected-final-newline-only');
if(process.argv.includes('--affected-civil-time-only')||finalNewlineOnly){
 const invalid=['2026-02-31T20:00:00Z','2026-02-29T20:00:00Z','1900-02-29T20:00:00Z','2100-02-29T20:00:00Z','2024-02-30T20:00:00Z','2026-04-31T20:00:00Z','2026-13-01T20:00:00Z','2026-01-00T20:00:00Z','0000-01-01T20:00:00Z','2026-01-01T24:00:00Z','2026-01-01T20:60:00Z','2026-01-01T20:00:60Z','2026-01-01T20:00:00+24:00','2026-01-01T20:00:00+00:60','2026-01-01T20:00Z','2026-01-01T20:00:00.1234567Z'];
 const valid=['2024-02-29T20:00:00.123456+00:00','2000-02-29T20:00:00.000001+00:00','1900-02-28T20:00:00Z','2026-04-30T23:59:59.999999-05:00','2026-01-01T00:00:00+05:30','0400-02-29T00:00:00Z','0001-01-01T00:00:00+00:00','9999-12-31T23:59:59.999999Z'];
 const finalNewlines=['\n','\r','\r\n','\u2028','\u2029'].map(suffix=>'2026-10-11T20:00:00.123456+00:00'+suffix);
 const rejected=finalNewlineOnly?finalNewlines:invalid;
 for(const accepted_at of finalNewlineOnly?finalNewlines:[...invalid,...valid]){
  const value=applied();value.receipt.accepted_at=accepted_at;const result=await invoke({value});
  if(finalNewlineOnly)console.log(JSON.stringify({case:'final_line_terminator',accepted_at,actual_http_status:result.status}));
  else if(cases===0)console.log(JSON.stringify({case:'impossible_original_acceptance_date',accepted_at,node_parse_normalized:new Date(accepted_at).toISOString(),actual_http_status:result.status}));
  assert.equal(result.reads,1);assert.equal(result.gates,2);
  if(rejected.includes(accepted_at))unknown(result,503);
  else{assert.equal(result.status,200,accepted_at);assert.deepEqual(result.response,value);assert.equal(result.response.receipt.accepted_at,accepted_at);}
  cases++;
 }
 console.log(JSON.stringify({status:finalNewlineOnly?'FEEDBACK_TRIAGE_STATUS_FINAL_NEWLINE_PASS':'FEEDBACK_TRIAGE_STATUS_CIVIL_TIME_PASS',cases,at_utc:new Date().toISOString(),actualModule:true,reader:'synthetic',SQL:false,normalAuth:false,originalTimestampPreserved:true}));process.exit(0);
}

assert.throws(()=>feedbackTriageStatusHandler(),/fixed_reader/);
assert.throws(()=>feedbackTriageStatusHandler({readOriginalReceipt(){}}),/normal_gate/);cases++;
let result=await invoke();assert.equal(result.status,200);assert.deepEqual(result.response,applied());assert.equal(result.reads,1);assert.equal(result.gates,2);cases++;
result=await invoke({value:{ok:true,outcome:'UNKNOWN',retry_safe:false}});assert.deepEqual(result.response,{ok:true,outcome:'UNKNOWN',retry_safe:false});assert.equal(result.gates,2);cases++;
for(const altered of [{...command,extra:true},{...command,expected_version:'invalid'},{...command,status:'new'},{...command,request_id:null}]){
  result=await invoke({body:altered});unknown(result,422);assert.equal(result.reads,0);assert.equal(result.gates,0);cases++;
}
result=await invoke({feedbackId:'invalid'});unknown(result,422);assert.equal(result.reads,0);cases++;
for(const sessionChange of [{manager_id:randomUUID()},{credential_id:randomUUID()},{read_only:true},{access_level:'read_only'},
  {role:'public'},{token:''},{device_id:''},{expires_at:'2000-01-01T00:00:00Z'}]){
  result=await invoke({gateHook:()=>({session:sessionChange})});unknown(result,403);assert.equal(result.reads,0);cases++;
}
for(const number of [1,2])for(const deny of [401,403,503]){
  result=await invoke({gateHook:ctx=>ctx.number===number?{deny}:null});unknown(result,deny);assert.equal(result.reads,number===1?0:1);cases++;
}
for(const sessionChange of [{manager_id:randomUUID()},{credential_id:randomUUID()},{device_id:'OTHER'},
  {token:'OTHER'},{expires_at:new Date(Date.now()+7200000).toISOString()},{auth_mode:'other'},{read_only:true},{access_level:'read_only'}]){
  result=await invoke({gateHook:ctx=>ctx.number===2?{session:sessionChange}:null});unknown(result,403);assert.equal(result.reads,1);cases++;
}
for(const action of ['throw','skip']){result=await invoke({gateHook:()=>({[action]:true})});unknown(result,503);assert.equal(result.reads,0);cases++;}
for(const field of Object.keys(original)){
  const value=applied();value.command[field]=field==='status'?'resolved':field==='expected_version'?'c'.repeat(64):randomUUID();
  result=await invoke({value});unknown(result,503);assert.equal(result.reads,1);cases++;
}
for(const field of ['request_id','feedback_id','actor_manager_id','actor_credential_id','status','triage_version','accepted_at']){
  const value=applied();value.receipt[field]=field==='status'?'resolved':field==='triage_version'?command.expected_version:field==='accepted_at'?'invalid':randomUUID();
  result=await invoke({value});unknown(result,503);cases++;
}
for(const edit of [v=>{v.extra='DO_NOT_LEAK';},v=>{v.command.extra=true;},v=>{v.receipt.extra=true;},
  v=>{delete v.command.expected_version;},v=>{delete v.receipt.accepted_at;},v=>{v.retry_safe=true;},v=>{v.receipt.accepted_at='2026-10-11T12:00:00';}]){
  const value=applied();edit(value);result=await invoke({value});unknown(result,503);cases++;
}
for(const value of [null,[],{ok:true,outcome:'UNKNOWN',retry_safe:true},{ok:true,outcome:'UNKNOWN',retry_safe:false,receipt:applied().receipt}]){
  result=await invoke({value});unknown(result,503);cases++;
}
result=await invoke({readerHook:()=>{throw Error('DO_NOT_LEAK_PROVIDER');}});unknown(result,503);assert.equal(result.gates,2);cases++;
result=await invoke({readerHook:({args})=>{args.p_action='resolved';}});unknown(result,503);assert.equal(result.gates,2);cases++;
result=await invoke({readerHook:({req})=>{req.body.request_id=randomUUID();req.params.feedbackId=randomUUID();}});
assert.equal(result.status,200);assert.deepEqual(result.response.command,original);cases++;
result=await invoke({gateHook:ctx=>{if(ctx.number===2){ctx.value.command.expected_version='c'.repeat(64);ctx.value.receipt.status='resolved';}return null;}});
assert.equal(result.status,200);assert.deepEqual(result.response,applied());cases++;
console.log(JSON.stringify({status:'FEEDBACK_TRIAGE_STATUS_HANDLER_PASS',cases,at_utc:new Date().toISOString(),
  actualModule:true,reader:'synthetic fixed callback',managerGate:'synthetic normal-interface callback',
  normalAuth:false,SQL:false,endpointMounted:false,writerCalls:0}));
}

// Existing owning SQL fixture interface; importing with the explicit member
// flag prepares only this suite. Main supplies its isolated SQL runner. Nothing
// here discovers/connects to a database or creates a competing runtime.
export async function runFeedbackTriageStatusDatabaseTests({sql}){
 let checks=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const q=value=>value===null?'null':"'"+String(value).replaceAll("'","''")+"'";
 const manager=randomUUID(),credential=randomUUID(),secondCredential=randomUUID(),otherManager=randomUUID(),otherCredential=randomUUID(),feedback=randomUUID();
 const identity='public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)';
 eq(await sql(`select to_regprocedure(${q(identity)}) is not null;`),'t','reader installed before fixture execution');
 await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
  values(${q(manager)},'Synthetic Original Triage Manager',array['CUSTODIAL_MANAGER'],true,false),
   (${q(otherManager)},'Synthetic Other Triage Manager',array['CUSTODIAL_MANAGER'],true,false);
 insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at)
  values(${q(credential)},'TRIAGE_STATUS_SYNTHETIC','Synthetic original receipt',${q('b'.repeat(64))},'full_access',${q(manager)},now()+interval '1 day'),
   (${q(secondCredential)},'TRIAGE_STATUS_SECOND','Synthetic second credential',${q('c'.repeat(64))},'full_access',${q(manager)},now()+interval '1 day'),
   (${q(otherCredential)},'TRIAGE_STATUS_OTHER','Synthetic foreign manager',${q('d'.repeat(64))},'full_access',${q(otherManager)},now()+interval '1 day');
 insert into public.system_feedback_items(id,operation_id,request_fingerprint,category,priority,message,submitted_by,hub_context,device_id,metadata_json)
  select ${q(feedback)},${q(randomUUID())},${q('e'.repeat(64))},'other','normal','Synthetic original status fixture',m.display_name,'manager',upper(d.device_id),
   jsonb_build_object('identity_verification',jsonb_build_object('status','verified','kind','named_manager_session',
    'manager_id',m.manager_id,'credential_id',d.credential_id,'device_id',upper(d.device_id)))
  from public.ops_manager_managers m join public.ops_manager_trusted_devices d on d.manager_id=m.manager_id
  where m.manager_id=${q(manager)} and d.credential_id=${q(credential)} and m.active and m.revoked_at is null and not m.is_system_principal
   and nullif(btrim(m.display_name),'') is not null and m.roles&&array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
   and d.revoked_at is null and d.expires_at>clock_timestamp() and d.created_at<=clock_timestamp()
   and d.max_access_level='full_access' and nullif(btrim(d.device_id),'') is not null;`);
 const command={p_request:randomUUID(),p_manager:manager,p_credential:credential,p_feedback:feedback,p_action:'acknowledged',
  p_expected_version:await sql(`set role custodial_application_reader;select public.custodial_feedback_triage_version(status,updated_at) from public.system_feedback_items where id=${q(feedback)};`)};
 const args=c=>[c.p_request,c.p_manager,c.p_credential,c.p_feedback,c.p_action,c.p_expected_version].map(q).join(',');
 const statement=(c=command,role='service_role')=>`set role ${role};select public.custodial_feedback_triage_receipt(${args(c)});`;
 const json=async statement=>JSON.parse((await sql(statement)).split('\n').at(-1));
 const read=async(c=command)=>await json(statement(c));
 const unknown={ok:true,outcome:'UNKNOWN',retry_safe:false};
 const reject=async(statement,pattern)=>{let error;try{await sql(statement);}catch(e){error=e;}assert.ok(error);assert.match(String(error.stderr||error),pattern);checks++;};
 const persisted=(await json(`set role service_role;select public.custodial_feedback_triage(${args(command)});`)).receipt;
 const expected={ok:true,outcome:'APPLIED',retry_safe:false,command:{request_id:command.p_request,feedback_id:feedback,status:command.p_action,
  expected_version:command.p_expected_version,expected_manager_id:manager,expected_credential_id:credential},receipt:persisted};
 const state=async()=>await sql(`select jsonb_build_object('item',to_jsonb(f),'receipts',(select jsonb_agg(to_jsonb(r) order by request_id)
  from public.system_feedback_triage_receipts r where feedback_id=${q(feedback)})) from public.system_feedback_items f where id=${q(feedback)};`);
 const before=await state();eq(await read(),expected,'lost writer response reconciles the exact persisted original');eq(await read(),expected,'repeat read is not writer replay');
 for(const change of [{p_request:randomUUID()},{p_feedback:randomUUID()},{p_action:'closed'},
  {p_expected_version:'f'.repeat(64)},{p_credential:secondCredential},{p_manager:otherManager,p_credential:otherCredential}])eq(await read({...command,...change}),unknown);
 eq(await state(),before,'matched/absent/foreign reads leave original feedback and receipt bytes unchanged');
 await sql(`update public.system_feedback_items set status='closed',updated_at=clock_timestamp() where id=${q(feedback)};`);
 const later=await state();eq(await read(),expected,'later item status cannot replace original accepted action');eq(await state(),later);
 for(const field of ['p_request','p_manager','p_credential','p_feedback','p_action','p_expected_version'])await reject(statement({...command,[field]:null}),/22023/);
 await reject(statement({...command,p_action:'new'}),/22023/);await reject(statement({...command,p_expected_version:'a'.repeat(64)+'\n'}),/22023/);
 await reject(statement({...command,p_manager:otherManager}),/42501/);
 for(const edit of ["revoked_at=clock_timestamp()","expires_at=clock_timestamp()-interval '1 second'","max_access_level='read_only'","created_at=clock_timestamp()+interval '1 hour',expires_at=clock_timestamp()+interval '2 hours'"]){
  await sql(`update public.ops_manager_trusted_devices set ${edit} where credential_id=${q(credential)};`);await reject(statement(),/42501/);
  await sql(`update public.ops_manager_trusted_devices set revoked_at=null,expires_at=clock_timestamp()+interval '1 day',max_access_level='full_access',created_at=clock_timestamp()-interval '1 minute',device_id='TRIAGE_STATUS_SYNTHETIC' where credential_id=${q(credential)};`);
 }
 // Blank device IDs cannot exist under the canonical table constraint. Test
 // that refusal separately; never disable it to manufacture a reader row.
 await reject(`update public.ops_manager_trusted_devices set device_id='' where credential_id=${q(credential)};`,/23514[\s\S]*ops_manager_trusted_devices_device_id_length/);
 for(const edit of ["active=false","revoked_at=clock_timestamp()","is_system_principal=true"]){
  await sql(`update public.ops_manager_managers set ${edit} where manager_id=${q(manager)};`);await reject(statement(),/42501/);
  await sql(`update public.ops_manager_managers set active=true,revoked_at=null,is_system_principal=false,roles=array['CUSTODIAL_MANAGER'],display_name='Synthetic Original Triage Manager' where manager_id=${q(manager)};`);
 }
 // Nonmanager roles and blank names are structurally forbidden. Preserve
 // those constraints and do not pretend these mutations reached the reader.
 await reject(`update public.ops_manager_managers set roles=array['EMPLOYEE']::text[] where manager_id=${q(manager)};`,/23514[\s\S]*ops_manager_managers_roles_valid/);
 await reject(`update public.ops_manager_managers set display_name=' ' where manager_id=${q(manager)};`,/23514[\s\S]*ops_manager_managers_display_name_len/);
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])await reject(statement(command,role),/42501/);
 for(const role of ['service_role','anon','authenticated','custodial_application_reader'])await reject(`set role ${role};select * from public.system_feedback_triage_receipts;`,/42501/);
 eq(await sql("select relrowsecurity and relforcerowsecurity from pg_class where oid='public.system_feedback_triage_receipts'::regclass;"),'t');
 // Owner-created corrupt synthetic originals exercise closed evidence checks;
 // the actual immutable original is never updated or deleted.
 for(const edit of [r=>{r.extra=true;},r=>{r.actor_credential_id=secondCredential;},r=>{r.triage_version=command.p_expected_version;},
  r=>{r.accepted_at='2026-02-31T20:00:00Z';},r=>{r.accepted_at+='\n';},r=>{r.accepted_at='2026-10-11T24:00:00Z';},r=>{r.accepted_at='2000-01-01T00:00:00.000001+00:00';}]){
  const corrupt={...command,p_request:randomUUID()},receipt={...persisted,request_id:corrupt.p_request};edit(receipt);
  await sql(`insert into public.system_feedback_triage_receipts(request_id,feedback_id,manager_id,credential_id,action,expected_version,receipt,accepted_at)
   select ${q(corrupt.p_request)},feedback_id,manager_id,credential_id,action,expected_version,${q(JSON.stringify(receipt))}::jsonb,accepted_at
    from public.system_feedback_triage_receipts where request_id=${q(command.p_request)};`);
  const saved=await state();eq(await read(corrupt),unknown);eq(await state(),saved,'malformed original read remains nonmutating');
 }
 eq(await read(),expected,'original remains exact after all negative reads');
 console.log(JSON.stringify({status:'FEEDBACK_TRIAGE_ORIGINAL_RECEIPT_SQL_PASS',checks,realPostgres:true,syntheticRows:true,
  productionWritten:false,writerFixtures:1,reader:'custodial_feedback_triage_receipt',HTTP:false,browser:false}));return checks;
}
