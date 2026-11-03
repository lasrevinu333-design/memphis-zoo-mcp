import assert from 'node:assert/strict';
import {validateRecordOperation,recordOperationRequiresCsrf} from '../src/custodial-record-operations.mjs';
import {feedbackTriageHandler} from '../src/feedback-triage.js';
import {createCustodialLeadershipRecordOperation} from '../src/auth/custodial-leadership-record-operation.mjs';
const id=n=>`0b110000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const manager={auth_mode:'custodial_leadership_pin',actor_kind:'CUSTODIAL_LEADERSHIP_COHORT',role:'ops_manager',read_only:false,owner:false,custodial_management_admin:true,manager_id:id(1),credential_id:id(2),device_id:id(3),claimed_manager_id:id(4),identity_assurance:'SELF_ASSERTED_NAME',individual_identity_verified:false,permissions:{schema:'custodial.manager-permissions.v1',read:true,owner:false,custodialManagementAdmin:true,policyVersion:1}};
let checks=0;
const invalid=x=>{assert.throws(x);checks++;};
const command={request_id:id(8),place_id:id(9),expected_revision:0,action:'add',payload:{canonical_code:'SYNTHETIC',display_name:'Synthetic',cleaning_mode:'REMINDER_ONLY'},reason:'Synthetic audit'};
const valid=validateRecordOperation('place_operation',{action:'command',input:command});assert.equal(valid.input.effective_at,null);checks++;
for(const x of [{...command,manager_id:id(1)},{...command,payload:{...command.payload,arbitrary_sql:'delete'}}])invalid(()=>validateRecordOperation('place_operation',{action:'command',input:x}));
invalid(()=>validateRecordOperation('place_operation',{action:'run_sql',input:{}}));
invalid(()=>validateRecordOperation('place_operation',{action:'preview',input:{query:'select'}}));
assert.equal(recordOperationRequiresCsrf('place_operation',{action:'command'}),true);assert.equal(recordOperationRequiresCsrf('place_operation',{action:'preview'}),false);checks++;
const req={params:{feedbackId:id(5)},memphisAuth:manager,body:{request_id:id(6),status:'acknowledged',expected_version:'a'.repeat(64),expected_manager_id:id(1),expected_credential_id:id(2)}};
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}});
let bridgeCalls=0,namedCalls=0;const receipt={request_id:id(6),feedback_id:id(5),status:'acknowledged',triage_version:'b'.repeat(64),actor_manager_id:id(1),actor_credential_id:id(2),accepted_at:'2026-11-01T00:00:00.123456Z'};
const handler=feedbackTriageHandler({runRpc:async()=>{namedCalls++;throw Error('must not impersonate named')},leadershipRecordBridge:async(r,a,input)=>{assert.equal(r.memphisAuth,manager);assert.equal(a,'feedback_triage');assert.equal(input.feedback_id,id(5));bridgeCalls++;return {ok:true,replayed:false,receipt}}});
let res=response();await handler(req,res);assert.equal(res.statusCode,200);assert.equal(bridgeCalls,1);assert.equal(namedCalls,0);checks++;
res=response();await handler({...req,body:{...req.body,expected_manager_id:id(99)}},res);assert.equal(res.statusCode,403);assert.equal(bridgeCalls,1);checks++;
for(const [action,input,csrf] of [['place_operation',valid,true],['place_operation',{action:'preview',input:{}},false],['feedback_triage',{...req.body,feedback_id:id(5)},true],['feedback_triage_status',{...req.body,feedback_id:id(5)},false]]){
 const calls=[];let released=0;
 const operation=createCustodialLeadershipRecordOperation({database:{async connect(){return {async query(sql,args){calls.push(sql);return sql.includes('custodial_leadership_record_operation')?{rows:[{result:{saved:true}}]}:{rows:[]}},release(){released++}}}},service:{async authenticateManagerSessionToken(options){assert.equal(options.requireCsrf,csrf);return {managerSession:manager}}},requestId:()=>id(7),verifyTransaction:async()=>({policy_version:1,claimed_account_id:id(4),request_id:id(7),identity_assurance:'SELF_ASSERTED_NAME',individual_identity_verified:false})});
 assert.deepEqual(await operation({token:'synthetic',csrfToken:'synthetic',action,input}),{saved:true});assert.equal(released,1);assert.equal(calls.at(-1),'commit');checks++;
}
console.log(JSON.stringify({passed:true,checks,scope:'actual typed adapters and companion transaction/CSRF with synthetic ports; no live effect'}));
const {default:express}=await import('express');
const {createPlacesAdminRouter}=await import('../src/places-api.js');
const app=express();app.use(express.json());let placeCalls=0,forbiddenFallbacks=0;
app.use('/places',createPlacesAdminRouter({client:{rpc(){forbiddenFallbacks++;throw Error('No named impersonation')}},requireManagerWrite:(req,res,next)=>{req.memphisAuth={...manager,roles:['CUSTODIAL_MANAGER']};next()},leadershipRecordBridge:async(req,action,input)=>{const selected=validateRecordOperation(action,input);placeCalls++;if(req.get('X-Test-Conflict'))throw Object.assign(Error('synthetic conflict'),{code:'record_correction_conflict',status:409});return {places:[],revision:1,replayed:false,action:selected.action}}}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
try{
 const base='http://127.0.0.1:'+server.address().port+'/places';
 for(const [path,body] of [['/preview',null],['/commands',command],['/bridge/preview',{legacy_kind:'event_venue',legacy_id:id(5),action:'map',target_place_id:id(9),reason:'Synthetic'}],['/bridge/confirm',{request_id:id(6),preview_id:id(7)}],['/source/preview',{legacy_kind:'location_group',legacy_id:null,action:'add',payload:{},effective_at:null,reason:'Synthetic'}],['/source/confirm',{request_id:id(6),preview_id:id(7)}]]){
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,200);assert.equal((await response.json()).ok,true);checks++;
 }
 const conflict=await fetch(base+'/commands',{method:'POST',headers:{'Content-Type':'application/json','X-Test-Conflict':'yes'},body:JSON.stringify(command)});assert.equal(conflict.status,409);assert.equal((await conflict.json()).command_rejected,true);checks++;
 assert.equal(placeCalls,7);assert.equal(forbiddenFallbacks,0);
}finally{await new Promise(r=>server.close(r));}
console.log(JSON.stringify({passed:true,checks,scope:'Includes actual Places router HTTP projection through six fixed cohort actions; synthetic authority/companion; no live effect'}));
