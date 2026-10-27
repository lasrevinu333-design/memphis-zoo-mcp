import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {feedbackTriageHandler} from '../src/feedback-triage.js';
const finalNewlineOnly=process.argv.includes('--affected-final-newline-only');
if(process.argv.includes('--affected-civil-time-only')||finalNewlineOnly){
 const manager=randomUUID(),credential=randomUUID(),feedback=randomUUID(),body={request_id:randomUUID(),status:'closed',expected_version:'a'.repeat(64),expected_manager_id:manager,expected_credential_id:credential};
 const invalid=['2026-02-31T20:00:00Z','2026-02-29T20:00:00Z','1900-02-29T20:00:00Z','2100-02-29T20:00:00Z','2024-02-30T20:00:00Z','2026-04-31T20:00:00Z','2026-13-01T20:00:00Z','2026-01-00T20:00:00Z','0000-01-01T20:00:00Z','2026-01-01T24:00:00Z','2026-01-01T20:60:00Z','2026-01-01T20:00:60Z','2026-01-01T20:00:00+24:00','2026-01-01T20:00:00+00:60','2026-01-01T20:00Z','2026-01-01T20:00:00.1234567Z'];
 const valid=['2024-02-29T20:00:00.123456+00:00','2000-02-29T20:00:00.000001+00:00','1900-02-28T20:00:00Z','2026-04-30T23:59:59.999999-05:00','2026-01-01T00:00:00+05:30','0400-02-29T00:00:00Z','0001-01-01T00:00:00+00:00','9999-12-31T23:59:59.999999Z'];
 const finalNewlines=['\n','\r','\r\n','\u2028','\u2029'].map(suffix=>'2026-10-11T20:00:00.123456+00:00'+suffix);
 const rejected=finalNewlineOnly?finalNewlines:invalid;
 let cases=0;
 for(const accepted_at of finalNewlineOnly?finalNewlines:[...invalid,...valid]){
  const expected={ok:true,replayed:false,receipt:{request_id:body.request_id,feedback_id:feedback,status:body.status,triage_version:'b'.repeat(64),actor_manager_id:manager,actor_credential_id:credential,accepted_at}};let status=200,response,calls=0;
  await feedbackTriageHandler({runRpc:async(name,args)=>{calls++;assert.equal(name,'custodial_feedback_triage');assert.equal(args.p_request,body.request_id);return expected;}})({body,params:{feedbackId:feedback},memphisAuth:{manager_id:manager,credential_id:credential}},
   {setHeader(){},status(value){status=value;return this;},json(value){response=value;return this;}});
  if(finalNewlineOnly)console.log(JSON.stringify({case:'final_line_terminator',accepted_at,actual_http_status:status}));
  else if(cases===0)console.log(JSON.stringify({case:'impossible_original_acceptance_date',accepted_at,node_parse_normalized:new Date(accepted_at).toISOString(),actual_http_status:status}));
  assert.equal(calls,1);
  if(rejected.includes(accepted_at)){assert.equal(status,503,accepted_at);assert.equal(response.command_rejected,false);assert.equal(response.receipt,undefined);}
  else{assert.equal(status,200,accepted_at);assert.deepEqual(response,expected);assert.equal(response.receipt.accepted_at,accepted_at);}
  cases++;
 }
 console.log(JSON.stringify({status:finalNewlineOnly?'FEEDBACK_TRIAGE_FINAL_NEWLINE_PASS':'FEEDBACK_TRIAGE_CIVIL_TIME_PASS',cases,at_utc:new Date().toISOString(),actualModule:true,rpc:'synthetic',SQL:false,normalAuth:false,originalTimestampPreserved:true}));process.exit(0);
}
if(process.argv.includes('--affected-writer-receipt-only')){
 const manager=randomUUID(),credential=randomUUID(),feedback=randomUUID(),command={request_id:randomUUID(),status:'closed',expected_version:'a'.repeat(64),expected_manager_id:manager,expected_credential_id:credential};
 const exact=()=>({ok:true,replayed:false,receipt:{request_id:command.request_id,feedback_id:feedback,status:command.status,triage_version:'b'.repeat(64),actor_manager_id:manager,actor_credential_id:credential,accepted_at:'2026-10-11T12:00:00.123456+00:00'}});
 let cases=0;
 async function invoke(output,change){const req={body:structuredClone(command),params:{feedbackId:feedback},memphisAuth:{manager_id:manager,credential_id:credential}},headers={};let status=200,response,calls=0;
  await feedbackTriageHandler({runRpc:async(name,args)=>{calls++;assert.equal(name,'custodial_feedback_triage');assert.deepEqual(args,{p_request:command.request_id,p_manager:manager,p_credential:credential,p_feedback:feedback,p_action:command.status,p_expected_version:command.expected_version});if(change)change(req);return output;}})(req,{setHeader:(k,v)=>headers[k]=v,status(v){status=v;return this;},json(v){response=v;return this;}});
  assert.equal(calls,1);assert.equal(headers['Cache-Control'],'no-store');return{status,response};}
 for(const edit of [r=>delete r.replayed,r=>{r.replayed='true';},r=>{r.receipt.extra='DO_NOT_LEAK';},r=>{r.receipt.triage_version=command.expected_version;},r=>{delete r.receipt.accepted_at;},r=>{r.receipt.accepted_at='invalid';},r=>{r.receipt.accepted_at='2026-10-11T12:00:00';},r=>{r.receipt.accepted_at=42;},r=>{r.receipt.accepted_at='2026-99-99T12:00:00Z';}]){
  const value=exact();edit(value);const result=await invoke(value);assert.equal(result.status,503);assert.equal(result.response.command_rejected,false);assert.doesNotMatch(result.response.error,/retry/i);assert.match(result.response.error,/original|exact/i);assert.match(result.response.error,/do not|don't/i);assert.equal(JSON.stringify(result).includes('DO_NOT_LEAK'),false);cases++;
 }
 for(const replayed of [false,true]){const value=exact();value.replayed=replayed;const result=await invoke(value);assert.equal(result.status,200);assert.deepEqual(result.response,value);cases++;}
 for(const change of [req=>{req.memphisAuth.manager_id=randomUUID();},req=>{req.memphisAuth={manager_id:manager,credential_id:randomUUID()};},req=>{req.memphisAuth.read_only=true;}]){const result=await invoke(exact(),change);assert.equal(result.status,503);assert.equal(result.response.command_rejected,false);cases++;}
 console.log(JSON.stringify({status:'FEEDBACK_TRIAGE_AFFECTED_WRITER_RECEIPT_PASS',cases,at_utc:new Date().toISOString(),actualModule:true,rpc:'synthetic',normalAuth:false,SQL:false}));process.exit(0);
}
let checks=0,calls=0;
const manager=randomUUID(),credential=randomUUID(),item=randomUUID();
const body={request_id:randomUUID(),status:'closed',expected_version:'a'.repeat(64),expected_manager_id:manager,expected_credential_id:credential};
const request=(payload=body,auth={manager_id:manager,credential_id:credential})=>({body:payload,params:{feedbackId:item},memphisAuth:auth});
async function invoke(req,runRpc){let status=200,data,headers={};await feedbackTriageHandler({runRpc})(req,{
 setHeader:(key,value)=>{headers[key]=value;},status(value){status=value;return this;},json(value){data=value;return this;}
 });return {status,data,headers};}
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const rpc=async(name,args)=>{calls++;eq(name,'custodial_feedback_triage');eq(args,{p_request:body.request_id,p_manager:manager,
 p_credential:credential,p_feedback:item,p_action:body.status,p_expected_version:body.expected_version});
 return {ok:true,replayed:false,receipt:{request_id:body.request_id,feedback_id:item,status:body.status,
  actor_manager_id:manager,actor_credential_id:credential,triage_version:'b'.repeat(64),accepted_at:'2026-10-11T12:00:00.123456Z'}};};
let result=await invoke(request(),rpc);eq(result.status,200);eq(result.headers['Cache-Control'],'no-store');eq(result.data.receipt.status,'closed');
if(process.argv.includes('--affected-default-receipt-only')){console.log(JSON.stringify({status:'FEEDBACK_TRIAGE_DEFAULT_RECEIPT_COMPATIBILITY_PASS',checks,at_utc:new Date().toISOString(),actualModule:true,rpc:'synthetic',normalAuth:false,SQL:false}));process.exit(0);}
for(const auth of [null,{manager_id:manager,credential_id:credential,read_only:true},{manager_id:manager,credential_id:randomUUID()},
 {manager_id:randomUUID(),credential_id:credential}]){
 const before=calls;eq((await invoke(request(body,auth),rpc)).status,403);eq(calls,before);
}
for(const extra of [{status:'new'},{status:'closed',actor:manager},{request_id:null},{expected_version:'a'},{expected_credential_id:undefined}]){
 const before=calls;eq((await invoke(request({...body,...extra}),rpc)).status,422);eq(calls,before);
}
for(const [code,status] of [['22023',422],['42501',403],['40001',409],['P0002',404],['unexpected',503]]){
 result=await invoke(request(),async()=>{throw Object.assign(Error('DO_NOT_LEAK_PRIVATE_PROVIDER_DETAIL'),{code});});
 eq(result.status,status);eq(result.data.command_rejected,status!==503);eq(JSON.stringify(result).includes('DO_NOT_LEAK'),false);
}
for(const altered of [{},{ok:true},{ok:true,receipt:{request_id:randomUUID()}}]){
 result=await invoke(request(),async()=>altered);eq(result.status,503);eq(result.data.command_rejected,false);
}
const index=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
assert.match(index,/app\.post\("\/dashboard-api\/system-feedback\/:feedbackId\/status", requireOpsManagerWrite, feedbackTriageHandler\(\{runRpc\}\)\)/);checks++;
eq((index.match(/custodial_feedback_triage_version\(status,updated_at\) as triage_version/g)||[]).length,2);
console.log(JSON.stringify({status:'FEEDBACK_TRIAGE_ADAPTER_PASS',checks,transport:false}));
