import {makeCompletionEvidenceReader} from '../src/completion-taxonomy-manager.js';
// Real signed/current auth and exported route/companion adapters; SQL is a modeled port.
// No sockets, database, provider, enrolled browser, production environment or acceptance claim.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {createCustodialLeadershipControlPlane} from '../src/auth/custodial-leadership-runtime.js';
import {createCustodialLeadershipOpsSession,verifyCustodialLeadershipOpsToken,makeOpsAccessMiddleware} from '../src/auth/shared-access-auth.js';
import {createCustodialLeadershipRecordBridge} from '../src/auth/custodial-leadership-record-operation.mjs';
import {installCustodialRecordRoutes,validateRecordOperation} from '../src/custodial-record-operations.mjs';
const id=randomUUID,ram=()=>randomBytes(32).toString('hex'),origin='https://record-fixture.example.invalid';
const env={NODE_ENV:'test',OPS_MANAGER_SESSION_SECRET:ram(),CUSTODIAL_LEADERSHIP_PIN_PEPPER:ram(),CUSTODIAL_LEADERSHIP_PIN_ENABLED:'true',CUSTODIAL_LEADERSHIP_ALLOWED_ORIGINS:origin,STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL:'https://companion.example.invalid'};
const raw={registrationId:id(),browserId:id(),credentialExpiresAt:new Date(Date.now()+3600000).toISOString(),csrfBinding:ram(),claimedAccount:{accountId:id(),displayName:'Eric Operle',contact:null},cohort:{principalId:id(),policyVersion:1,securityEpoch:1,permissions:['custodialManagementAdmin']}};
const expected={role:'ops_manager',access_level:'full_access',roles:['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN'],claimed_manager_id:raw.claimedAccount.accountId,claimed_manager_display_name:raw.claimedAccount.displayName,identity_assurance:'SELF_ASSERTED_NAME',individual_identity_verified:false,manager_id:raw.cohort.principalId,credential_id:raw.registrationId,device_id:raw.browserId,manager_display_name:'Custodial leadership cohort',permissions:{schema:'custodial.manager-permissions.v1',read:true,owner:false,custodialManagementAdmin:true,policyVersion:1},auth_mode:'custodial_leadership_pin',actor_kind:'CUSTODIAL_LEADERSHIP_COHORT',read_only:false,owner:false,custodial_management_admin:true};
const signed=createCustodialLeadershipOpsSession({expectedClaims:expected,credentialExpiresAt:raw.credentialExpiresAt,env});
const csrf=createHmac('sha256',env.CUSTODIAL_LEADERSHIP_PIN_PEPPER).update('leadership-csrf-v1\0'+raw.csrfBinding).digest('hex');
const sessionId=id(),operationId=id(),employeeId=id(),opaque='Exact / original ? α identity',correctionId=id();
const body={reason:' Synthetic verified correction ',expected_correction_id:null,expected_session_uuid:opaque,corrected_employee_id:employeeId};
const input={...body,session_id:sessionId,operation_id:operationId};
const receipt={session_id:sessionId,operation_id:operationId,correction_id:correctionId,changed_fields:['employee'],created_at:'2026-10-31T20:00:00Z',replayed:false};
let revoked=false,failAt='',actorChange={},connections=[],legacy=[],fetches=[],recorded=false,resultOverride=undefined;
const database={connect:async()=>{const calls=[];connections.push(calls);return{query:async(sql,args)=>{calls.push({sql,args});if(failAt&&sql.includes(failAt))throw Object.assign(Error('Synthetic failure; never expose this detail'),{code:'42501'});
 if(sql.includes('bind_verified_request'))return{rows:[{actor:{...expected,policy_version:1,claimed_account_id:raw.claimedAccount.accountId,request_id:args[3],custodialManagementAdmin:true,...actorChange}}]};
 if(sql.includes('record_operation_v1')){const selected=JSON.parse(args[4]);let result;
  if(resultOverride!==undefined)result=resultOverride;
  else if(args[3]==='correct'){recorded=true;result={...receipt,operation_id:selected.operation_id,session_id:selected.session_id};}
  else if(args[3]==='correction_outcome')result=recorded?{found:true,...receipt,replayed:true,actor_manager_id:raw.cohort.principalId,actor_name:'Eric Operle (shared PIN; self-asserted)',reason:body.reason.trim()}:{found:false,operation_id:selected.operation_id,session_id:selected.session_id};
  else if(args[3]==='truth')result={session_id:selected.session_id,session_uuid:opaque,status:'completed',correction_id:recorded?correctionId:null};
  else if(args[3]==='choices')result={employees:[{id:employeeId,label:'Synthetic employee'}],locations:[],devices:[]};
  else result={schema:'custodial.open-problems.v1',generated_at:new Date().toISOString(),total:0,items:[]};
  return{rows:[{result}]};}
 return{rows:[]};},release(){calls.push({sql:'release'});}};}};
const store={execute:async(action,data)=>{assert.equal(action,'credential_readback');assert.deepEqual(data,{registration_id:raw.registrationId,cohort_principal_id:raw.cohort.principalId,browser_id:raw.browserId});if(revoked)throw Object.assign(Error('Synthetic revoked'),{status:403});return structuredClone(raw);}};
const cp=createCustodialLeadershipControlPlane({env,store,database});
const internal=cp.router.stack.find(x=>x.route?.path==='/custodial-leadership-internal/records')?.route.stack.at(-1).handle;assert.equal(typeof internal,'function');
const response=()=>({statusCode:200,headers:{},status(n){this.statusCode=n;return this;},set(k,v){this.headers[k]=v;return this;},setHeader(k,v){this.headers[k]=v;},json(value){this.body=value;return this;}});
const request=({method='POST',path='/admin-api/custodial/cleaning-sessions/:sessionId/corrections',params={sessionId},query={},value=body,token=signed.token,csrfValue=csrf,originValue=origin,op=operationId}={})=>{const headers={authorization:'Bearer '+token,'x-csrf-token':csrfValue,origin:originValue,'idempotency-key':op};return{method,path,url:path,originalUrl:path,params,query,body:value,headers,get:key=>headers[key.toLowerCase()]||'',header:key=>headers[key.toLowerCase()]||''};};
const fetchImpl=async(url,init)=>{fetches.push({url,init});assert.equal(url,env.STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL+'/custodial-leadership-internal/records');assert.equal(init.redirect,'error');const req=request({value:JSON.parse(init.body),token:init.headers.Authorization.slice(7)}),res=response();await internal(req,res);return new Response(JSON.stringify(res.body),{status:res.statusCode});};
const bridge=createCustodialLeadershipRecordBridge({env,fetchImpl}),routes=[];
const app={get:(path,...stack)=>routes.push({method:'GET',path,stack}),post:(path,...stack)=>routes.push({method:'POST',path,stack})};
const authOptions={env,trustedDeviceStore:{find:async()=>{throw Error('No cohort named-store fallback');}},leadershipVerifier:cp.verify};
installCustodialRecordRoutes(app,{requireOpsManagerAuth:makeOpsAccessMiddleware(authOptions),requireOpsManagerWrite:makeOpsAccessMiddleware({...authOptions,requireWrite:true}),managerId:req=>req.memphisAuth.manager_id,backendSecret:()=>{throw Error('No cohort backend secret read');},runRpc:async(...args)=>{legacy.push(args);return{};},leadershipRecordBridge:bridge});
async function route(req,{skipAuth=false}={}){const selected=routes.find(x=>x.path===req.path&&x.method===req.method);assert.ok(selected);const res=response();for(const fn of skipAuth?selected.stack.slice(1):selected.stack){let next=false;await fn(req,res,()=>next=true);if(!next)break;}return res;}
let passed=0;const cases=[];async function test(name,fn){await fn();passed++;cases.push(name);console.log('PASS '+name);}
await test('actual signed cohort middleware → fixed companion → same-client binding before typed write and commit',async()=>{
 const r=await route(request());assert.equal(r.statusCode,201,JSON.stringify(r.body));assert.equal(r.body.data.operation_id,operationId);assert.equal(r.body.contract_version,'cleaning-truth.v1');assert.equal(legacy.length,0);const calls=connections.at(-1);assert.deepEqual(calls.map(x=>x.sql.split(' ')[0]),['begin','set','set','set','select','select','commit','release']);assert.match(calls[4].sql,/bind_verified_request/);assert.match(calls[5].sql,/record_operation_v1/);assert.deepEqual(calls[5].args.slice(0,4),[raw.cohort.principalId,raw.registrationId,raw.browserId,'correct']);const selected=JSON.parse(calls[5].args[4]);assert.equal(selected.expected_session_uuid,opaque);assert.equal(selected.expected_correction_id,null);assert.equal(selected.reason,body.reason.trim());assert.equal(selected.operation_id,operationId);
});
await test('preview marker and opaque identity are required; actors/RPC/SQL/unknown fields never reach SQL',async()=>{
 const n=connections.length;for(const field of ['expected_correction_id','expected_session_uuid']){const value={...body};delete value[field];assert.equal((await route(request({value}))).statusCode,422);}for(const field of ['manager_id','credential_id','operation_id','session_id','rpc','sql','actor_name'])assert.equal((await route(request({value:{...body,[field]:id()}}))).statusCode,422);assert.equal((await route(request({op:''}))).statusCode,422);assert.throws(()=>validateRecordOperation('execute_sql',{}));assert.equal(connections.length,n);
});
await test('timestamps reject civil overflow and retain accepted exact offset/microsecond facts',()=>{
 for(const value of ['2026-02-30T10:00:00Z','2026-13-01T10:00:00Z','2026-10-31T24:00:00Z','2026-10-31T12:60:00Z','2026-10-31T10:00','2026-10-31T10:00:00+00:60'])assert.throws(()=>validateRecordOperation('correct',{...input,corrected_started_at:value}));
 for(const value of ['2026-10-31T10:00:00.123456Z','2026-10-31T10:00:00.123456-05:00','2028-02-29T10:00:00Z'])assert.equal(validateRecordOperation('correct',{...input,corrected_started_at:value}).corrected_started_at,value);
});
await test('truth/choices/open problems are authenticated reads without write CSRF; exact genuine zero preserved',async()=>{
 for(const path of ['/admin-api/custodial/cleaning-sessions/:sessionId/truth','/admin-api/custodial/cleaning-correction-choices','/admin-api/custodial/open-problems']){const r=await route(request({method:'GET',path,csrfValue:''}));assert.equal(r.statusCode,200);if(path.endsWith('open-problems'))assert.deepEqual([r.body.data.total,r.body.data.items],[0,[]]);}
});
await test('wrong/missing CSRF and unapproved origin fail before any SQL connection; internal companion independently rechecks',async()=>{
 const n=connections.length;for(const csrfValue of ['',ram()])assert.equal((await route(request({csrfValue}))).statusCode,403);assert.equal((await route(request({originValue:'https://evil.invalid'}))).statusCode,403);const req=request({value:{action:'correct',input,origin,csrfToken:''}}),res=response();await internal(req,res);assert.equal(res.statusCode,403);assert.equal(connections.length,n);
});
await test('forged/expired tokens, revoked registration and changed claimed account cannot obtain SQL client',async()=>{
 const n=connections.length;assert.equal((await route(request({token:signed.token+'x'}))).statusCode,401);const expired=createCustodialLeadershipOpsSession({expectedClaims:expected,credentialExpiresAt:new Date(Date.now()-1000).toISOString(),now:new Date(Date.now()-7200000),env});assert.equal((await route(request({token:expired.token}))).statusCode,401);revoked=true;assert.equal((await route(request())).statusCode,403);revoked=false;const claimed=raw.claimedAccount.accountId;raw.claimedAccount.accountId=id();assert.equal((await route(request())).statusCode,403);raw.claimedAccount.accountId=claimed;assert.equal(connections.length,n);
});
await test('transaction actor mismatches in principal/registration/browser/policy/account/request/assurance deny before typed SQL',async()=>{
 for(const change of [{manager_id:id()},{credential_id:id()},{device_id:id()},{policy_version:2},{claimed_account_id:id()},{request_id:id()},{owner:true},{identity_assurance:'VERIFIED_INDIVIDUAL'},{individual_identity_verified:true}]){actorChange=change;assert.equal((await route(request())).statusCode,403);assert.ok(!connections.at(-1).some(x=>x.sql.includes('record_operation_v1')||x.sql==='commit'));assert.deepEqual(connections.at(-1).slice(-2).map(x=>x.sql),['rollback','release']);}actorChange={};
});
await test('SQL refusal and unavailable result roll back once, redact errors and never turn into empty success',async()=>{
 let n=connections.length;failAt='record_operation_v1';let r=await route(request());failAt='';assert.equal(r.statusCode,403);assert.equal(connections.length,n+1);assert.doesNotMatch(JSON.stringify(r.body),/Synthetic failure/);resultOverride=null;r=await route(request({method:'GET',path:'/admin-api/custodial/open-problems'}));resultOverride=undefined;assert.equal(r.statusCode,503);assert.equal(r.body.ok,false);assert.equal(r.body.data,undefined);
});
await test('COMMIT acknowledgement loss stays unknown and no automatic retry; original operation readback is separate GET',async()=>{
 const n=connections.length;failAt='commit';let r=await route(request());failAt='';assert.equal(r.statusCode,503);assert.equal(r.body.code,'record_outcome_unconfirmed');assert.equal(connections.length,n+1);assert.equal(connections.at(-1).filter(x=>x.sql==='commit').length,1);
 r=await route(request({method:'GET',path:'/admin-api/custodial/cleaning-sessions/:sessionId/corrections/:operationId',params:{sessionId,operationId},csrfValue:''}));assert.equal(r.statusCode,200);assert.equal(r.body.data.found,true);assert.equal(r.body.data.operation_id,operationId);assert.equal(r.body.data.actor_manager_id,raw.cohort.principalId);assert.match(r.body.data.actor_name,/self-asserted/);assert.equal(connections.at(-1)[5].args[3],'correction_outcome');assert.deepEqual(JSON.parse(connections.at(-1)[5].args[4]),{session_id:sessionId,operation_id:operationId});
});
await test('missing original operation remains explicit found:false with exact target, never substituted latest',async()=>{
 recorded=false;const other=id(),r=await route(request({method:'GET',path:'/admin-api/custodial/cleaning-sessions/:sessionId/corrections/:operationId',params:{sessionId,operationId:other},csrfValue:''}));assert.deepEqual(r.body.data,{found:false,operation_id:other,session_id:sessionId});recorded=true;
});
await test('bounded queue input and fixed origin bridge reject arbitrary targets and failures without retry/fallback',async()=>{
 for(const limit of ['0','201','NaN'])assert.equal((await route(request({method:'GET',path:'/admin-api/custodial/open-problems',query:{limit}}))).statusCode,422);
 const req=request();req.memphisAuth={...expected,token:signed.token};for(const bad of ['https://user:secret@companion.invalid','https://companion.invalid/other','https://companion.invalid/?x=1','http://remote.invalid']){let calls=0;const b=createCustodialLeadershipRecordBridge({env:{...env,STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL:bad},fetchImpl:async()=>{calls++;throw Error('must not send');}});await assert.rejects(b(req,'truth',{session_id:sessionId}),e=>e.status===503);assert.equal(calls,0);}
 let calls=0;const b=createCustodialLeadershipRecordBridge({env,fetchImpl:async()=>{calls++;throw Error('Synthetic transport loss');}});await assert.rejects(b(req,'correct',input),e=>e.status===503);assert.equal(calls,1);assert.equal(legacy.length,0);
});
await test('named existing branch uses fixed named RPC and server actor only; missing cohort bridge never falls back',async()=>{
 const collected=[],seen=[],plain={get:(path,...stack)=>collected.push({method:'GET',path,stack}),post:(path,...stack)=>collected.push({method:'POST',path,stack})};installCustodialRecordRoutes(plain,{requireOpsManagerAuth(){},requireOpsManagerWrite(){},managerId:req=>req.memphisAuth.manager_id,backendSecret:()=>'SYNTHETIC_BACKEND_SECRET',runRpc:async(...args)=>{seen.push(args);return receipt;}});
 const req=request();req.memphisAuth={manager_id:id(),credential_id:id(),device_id:'SYNTHETIC_NAMED_BROWSER',auth_mode:'trusted_device'};let res=response();await collected.find(r=>r.method==='POST'&&r.path==='/admin-api/custodial/cleaning-sessions/:sessionId/corrections').stack.at(-1)(req,res);assert.equal(res.statusCode,201);assert.equal(seen[0][0],'custodial_named_record_operation_v1');assert.equal(seen[0][1].p_manager_id,req.memphisAuth.manager_id);assert.equal(seen[0][1].p_backend_execution_secret,'SYNTHETIC_BACKEND_SECRET');assert.equal(seen[0][1].p_input.expected_session_uuid,opaque);
 req.memphisAuth={...expected,token:signed.token};res=response();await collected.find(r=>r.method==='POST'&&r.path==='/admin-api/custodial/cleaning-sessions/:sessionId/corrections').stack.at(-1)(req,res);assert.equal(res.statusCode,503);assert.equal(seen.length,1);
});
await test('exact completion reader uses current signed cohort bridge and opaque original identity without named impersonation',async()=>{
 const identity='..\t原始/session?#';
 const read=makeCompletionEvidenceReader({runRpc:async()=>{throw Error('No cohort legacy RPC');},managerId:()=>{throw Error('No cohort named identity');},backendSecret:()=>{throw Error('No cohort backend secret');},leadershipRecordBridge:bridge});
 resultOverride={session_uuid:identity,completion_recorded:false,classification:'no_completion_record'};
 const req=request({method:'GET',path:'/admin-api/custodial/cleaning-sessions/completion-evidence',query:{session_uuid:identity},params:{},csrfValue:''});
 const res=response();let accepted=false;await makeOpsAccessMiddleware(authOptions)(req,res,()=>accepted=true);assert.equal(accepted,true);await read(req,res);
 assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.equal(res.body.data.session_uuid,identity);
 assert.equal(connections.at(-1)[5].args[3],'completion_evidence');assert.deepEqual(JSON.parse(connections.at(-1)[5].args[4]),{session_uuid:identity});
 assert.equal(connections.at(-1)[5].args[0],raw.cohort.principalId);assert.notEqual(connections.at(-1)[5].args[0],raw.claimedAccount.accountId);
 for(const change of [{owner:true},{individual_identity_verified:true},{claimed_account_id:id()}]){actorChange=change;const denied=response();await read(req,denied);assert.equal(denied.statusCode,403);}actorChange={};
 const missing=makeCompletionEvidenceReader({runRpc:async()=>{throw Error('No fallback');},managerId:()=>{throw Error('No fallback');},backendSecret:()=>{throw Error('No secret');}});const held=response();await missing(req,held);assert.equal(held.statusCode,503);
 resultOverride={session_uuid:'different',completion_recorded:false};const wrong=response();await read(req,wrong);assert.equal(wrong.statusCode,503);
 resultOverride=undefined;
});
await test('completion evidence input is exact bounded opaque Unicode, never actor or RPC selection',()=>{
 for(const identity of ['..','a/b?c#d','\toriginal\n','😀'.repeat(200)])assert.equal(validateRecordOperation('completion_evidence',{session_uuid:identity}).session_uuid,identity);
 for(const identity of ['', ' original','original ','x'.repeat(201),'😀'.repeat(201),'a\0b','\uD800'])assert.throws(()=>validateRecordOperation('completion_evidence',{session_uuid:identity}));
 for(const field of ['manager_id','sql','rpc'])assert.throws(()=>validateRecordOperation('completion_evidence',{session_uuid:'original',[field]:'forged'}));
});
await test('unfinished work uses the signed companion with CSRF only for the explicit clear',async()=>{
 const noticeId=id(),op=id();resultOverride={items:[],truncated:false,limit:100};
 let r=await route(request({method:'GET',path:'/admin-api/custodial/unfinished-work',csrfValue:''}));assert.equal(r.statusCode,200);assert.equal(connections.at(-1)[5].args[3],'unfinished_work');
 const options={method:'POST',path:'/admin-api/custodial/unfinished-work/:noticeId/clear',params:{noticeId},value:{reason:'Original work was not completed'},op};
 const before=connections.length;r=await route(request({...options,csrfValue:''}));assert.equal(r.statusCode,403);assert.equal(connections.length,before);
 resultOverride={notice_id:noticeId,operation_id:op,status:'cancelled_without_completion',history_preserved:true,phone_released:false,key_removal:false};r=await route(request(options));assert.equal(r.statusCode,200);assert.equal(connections.at(-1)[5].args[3],'clear_unfinished_work');
 assert.deepEqual(JSON.parse(connections.at(-1)[5].args[4]),{notice_id:noticeId,operation_id:op,reason:options.value.reason});
 resultOverride={found:true,notice_id:noticeId,operation_id:op};r=await route(request({method:'GET',path:'/admin-api/custodial/unfinished-work/:noticeId/operations/:operationId',params:{noticeId,operationId:op},csrfValue:''}));assert.equal(r.statusCode,200);assert.equal(connections.at(-1)[5].args[3],'unfinished_work_outcome');
 for(const value of [{notice_id:noticeId,operation_id:op,reason:''},{notice_id:noticeId,operation_id:op,reason:'ok',manager_id:id()}])assert.throws(()=>validateRecordOperation('clear_unfinished_work',value));
 resultOverride=undefined;
});
console.log(JSON.stringify({status:'PASS',passed,cases,scope:'Real signed/current authentication, exact installed routes/private companion, fixed bridge and same-client transaction orchestration; SQL modeled, no socket/database/provider/build; development checks only, not independent acceptance.'}));
