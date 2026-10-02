import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {feedbackTriageHandler} from '../src/feedback-triage.js';
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
  actor_manager_id:manager,actor_credential_id:credential,triage_version:'b'.repeat(64)}};};
let result=await invoke(request(),rpc);eq(result.status,200);eq(result.headers['Cache-Control'],'no-store');eq(result.data.receipt.status,'closed');
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
