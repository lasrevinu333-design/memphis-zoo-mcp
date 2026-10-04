import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {createOpsManagerSession, makeOpsAccessMiddleware, authenticatePresentedOpsAccessRequest} from '../src/auth/shared-access-auth.js';
import {authoritativeFeedbackPayload, makeFeedbackSubmitAuthority} from '../src/feedback-authority.js';

// Real loopback-mounted source route and real signed-session/current-store/write
// middleware. Only external persistence, rate limiting, and enrolled-phone
// credential verification are fixtures. No SQL, provider send, or hosted call.
const index=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const authSource=readFileSync(new URL('../src/auth/shared-access-auth.js',import.meta.url),'utf8');
const authoritySource=readFileSync(new URL('../src/feedback-authority.js',import.meta.url),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
const factoryStart=index.indexOf('const requireFeedbackSubmitAuthority = makeFeedbackSubmitAuthority({');
const factoryEnd=index.indexOf('\n});',factoryStart)+4;
const routeStart=index.indexOf('app.post("/feedback-api/submit",');
const routeEnd=index.indexOf('\napp.get("/guest-api/status"',routeStart);
assert.ok(factoryStart>=0&&factoryEnd>factoryStart&&routeStart>=0&&routeEnd>routeStart);
const env={NODE_ENV:'production',OPS_MANAGER_AUTH_REQUIRED:'true',
  OPS_MANAGER_SESSION_SECRET:'feedback-mounted-route-test-only-secret-not-production'};
const managerId='81000000-0000-4000-8000-000000000001';
const credentialId='81000000-0000-4000-8000-000000000002';
const otherManagerId='81000000-0000-4000-8000-000000000003';
const employeeId='81000000-0000-4000-8000-000000000004';
const employeeCredentialId='81000000-0000-4000-8000-000000000005';
const manager={manager_id:managerId,display_name:'Synthetic Named Manager',roles:['CUSTODIAL_MANAGER'],active:true,revoked_at:null};
const originalRow={credential_id:credentialId,device_id:'SYNTHETIC_MANAGER_BROWSER',manager_id:managerId,manager,
  max_access_level:'full_access',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),revoked_at:null};
let row=structuredClone(originalRow),employeeEnrolled=true,writes=0,rateChecks=0,lastPayload=null;
const store={async find(id){return id===credentialId&&row?structuredClone(row):null;}};
const token=accessLevel=>createOpsManagerSession({credentialId,deviceId:originalRow.device_id,manager,
  authMode:'trusted_device',accessLevel,maximumAccessLevel:'full_access',env}).token;
const fullToken=token('full_access'),readToken=token('read_only');
const app=express();app.use(express.json());
const operations=new Map(),rows=[];
const context={app,makeFeedbackSubmitAuthority,authoritativeFeedbackPayload,
  authenticatePresentedOpsAccessRequest:req=>authenticatePresentedOpsAccessRequest(req,{env}),
  requireOpsManagerAuth:makeOpsAccessMiddleware({env,trustedDeviceStore:store}),
  requireOpsManagerWrite:makeOpsAccessMiddleware({env,trustedDeviceStore:store,requireWrite:true}),
  requireEmployeeDeviceCredential(req,_res,next){
    req.memphisDeviceAuth={credentialed:employeeEnrolled};
    req.memphisDeviceCredential=employeeEnrolled?{credential_id:employeeCredentialId}:null;
    req.memphisDevice={canonical_device_id:'KIOSK_SYNTHETIC',assigned_employee_id:employeeId,
      assigned_employee_name:'Synthetic Employee',assignment_epoch:7};next();
  },
  publicSubmissionRateLimit(name){assert.equal(name,'feedback');return(_req,_res,next)=>{rateChecks++;next();};},
  ensureSystemFeedbackSchema:async()=>{},
  requestOperationId:req=>req.get('x-operation-id'),
  createSystemFeedbackItem:async payload=>{
    writes++;lastPayload=structuredClone(payload);
    const prior=operations.get(payload.operation_id);
    if(prior)return {...prior,newly_inserted:false};
    const item={id:payload.operation_id,operation_id:payload.operation_id,status:'open',newly_inserted:true};
    operations.set(payload.operation_id,item);return item;
  },
  attachFeedbackDelivery:async items=>items.map(item=>({...item,email_delivery:{state:'unavailable'}})),
  supabaseAdmin:{},APP_VERSION:'test',RELEASE_ID:'test',FEEDBACK_CONTRACT_VERSION:'test',
  console:{error(){/* Expected denial details are asserted below, not raw logged. */}},
};
vm.runInNewContext(index.slice(factoryStart,factoryEnd)+'\n'+index.slice(routeStart,routeEnd),context,{timeout:1000});
const server=app.listen(0,'127.0.0.1');
await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
const address=server.address(),base=`http://127.0.0.1:${address.port}`;
let nextOperation=10;
const op=()=>`81000000-0000-4000-8000-${String(nextOperation++).padStart(12,'0')}`;
async function send(label,{hub='manager',bearer=fullToken,body={},status=201,persistence=1,operationId=op(),headers={}}={}){
  const before=writes,beforeRate=rateChecks;
  const remaining=Math.floor(55000-performance.now());assert.ok(remaining>0,'one absolute test attempt expired');
  const response=await fetch(base+'/feedback-api/submit',{method:'POST',redirect:'error',
    signal:AbortSignal.timeout(remaining),headers:{'content-type':'application/json','x-operation-id':operationId,
      ...(bearer?{authorization:`Bearer ${bearer}`}:{}) ,...headers},
    body:JSON.stringify({hub_context:hub,message:'Synthetic local authority test',category:'app_problem',priority:'normal',...body})});
  const result=await response.json();
  assert.equal(rateChecks-beforeRate,1,label+': original rate-limit position remains mounted');
  assert.equal(response.status,status,label+': status');assert.equal(writes-before,persistence,label+': persistence calls');
  if(persistence){assert.equal(lastPayload.operation_id,operationId,label+': saved operation identity');
    assert.equal(result.data.item.operation_id,operationId);}
  rows.push({label,status:response.status,persistenceCalls:writes-before});
  return {result,payload:persistence?structuredClone(lastPayload):null,operationId};
}
try{
  const first=await send('current full-access manager');
  assert.equal(first.payload.identity_verification.kind,'named_manager_session');
  assert.equal(first.payload.identity_verification.manager_id,managerId);
  assert.equal(first.payload.submitted_by,manager.display_name);
  await send('same saved operation replay',{operationId:first.operationId,status:200});
  await send('read-only signed manager',{bearer:readToken,status:403,persistence:0});
  row.max_access_level='read_only';
  await send('current server-side access downgrade',{status:403,persistence:0});row=structuredClone(originalRow);
  row.revoked_at=new Date().toISOString();
  await send('revoked credential',{status:401,persistence:0});row=structuredClone(originalRow);
  row.manager.active=false;
  await send('inactive current manager',{status:403,persistence:0});row=structuredClone(originalRow);
  row.manager_id=otherManagerId;row.manager.manager_id=otherManagerId;
  await send('current principal changed',{status:403,persistence:0});row=structuredClone(originalRow);
  row=null;await send('missing current credential',{status:401,persistence:0});row=structuredClone(originalRow);
  row.expires_at=new Date(Date.now()-1000).toISOString();
  await send('expired current enrollment',{status:401,persistence:0});row=structuredClone(originalRow);
  await send('invalid manager token',{bearer:'synthetic-invalid-token',status:401,persistence:0});
  await send('anonymous cannot select manager authority',{bearer:null,status:401,persistence:0});
  await send('saved different principal remains pending',{body:{expected_manager_id:otherManagerId},status:409,persistence:0});
  await send('saved different credential remains pending',{body:{expected_credential_id:otherManagerId},status:409,persistence:0});
  await send('matching saved manager authority',{body:{expected_manager_id:managerId,expected_credential_id:credentialId}});
  const employee=await send('enrolled employee preserved',{hub:'employee',bearer:null,
    headers:{authorization:'Device synthetic-credential'},
    body:{expected_employee_id:employeeId,submitted_by:'Spoofed',device_id:'SPOOFED'}});
  assert.equal(employee.payload.identity_verification.kind,'enrolled_employee_device');
  assert.equal(employee.payload.identity_verification.employee_id,employeeId);
  assert.equal(employee.payload.device_id,'KIOSK_SYNTHETIC');assert.equal(employee.payload.submitted_by,'Synthetic Employee');
  employeeEnrolled=false;await send('legacy employee refused',{hub:'employee',bearer:null,status:401,persistence:0});employeeEnrolled=true;
  await send('employee saved assignment changed',{hub:'employee',body:{expected_employee_id:otherManagerId},status:409,persistence:0});
  for(const [label,hub,bearer] of [['existing anonymous public preserved pending contract disposition','public',null],
    ['full manager selecting public remains anonymous','public',fullToken],['unknown selector stays anonymous','unknown',null]]){
    const publicResult=await send(label,{hub,bearer,body:{submitted_by:'Spoofed Manager',device_id:'SPOOFED',
      identity_verification:{status:'verified',kind:'named_manager_session',manager_id:managerId}}});
    assert.equal(publicResult.payload.hub_context,'public');assert.equal(publicResult.payload.submitted_by,null);
    assert.equal(publicResult.payload.device_id,null);
    assert.deepEqual(publicResult.payload.identity_verification,{status:'unverified',kind:'public_anonymous'});
  }
  for(const selector of ['public','unknown','',null,'employee']){
    const selectorBody=selector===null?{hub_context:undefined}:{};
    await send('read-only cannot downgrade selector '+String(selector),{hub:selector,bearer:readToken,body:selectorBody,status:403,persistence:0});
    row.revoked_at=new Date().toISOString();
    await send('revoked cannot downgrade selector '+String(selector),{hub:selector,body:selectorBody,status:401,persistence:0});row=structuredClone(originalRow);
    row.manager_id=otherManagerId;row.manager.manager_id=otherManagerId;
    await send('changed principal cannot downgrade selector '+String(selector),{hub:selector,body:selectorBody,status:403,persistence:0});row=structuredClone(originalRow);
    await send('invalid presented cannot downgrade selector '+String(selector),{hub:selector,bearer:'invalid',body:selectorBody,status:401,persistence:0});
  }
  for(const name of ['x-memphis-auth','x-gemini-admin-token']){
    await send('alternate presented read-only '+name,{hub:'public',bearer:null,headers:{[name]:readToken},status:403,persistence:0});
    await send('alternate presented invalid '+name,{hub:'public',bearer:null,headers:{[name]:'invalid'},status:401,persistence:0});
  }
  for(const name of ['x-admin-key','x-api-key']){
    await send('presented invalid admin key '+name,{hub:'public',bearer:null,headers:{[name]:'synthetic-invalid-key'},status:401,persistence:0});
  }
  for(const selector of ['',null]){
    const anonymous=await send('existing anonymous default selector '+String(selector),{
      hub:selector,bearer:null,body:selector===null?{hub_context:undefined}:{}});
    assert.deepEqual(anonymous.payload.identity_verification,{status:'unverified',kind:'public_anonymous'});
  }
}finally{
  server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  assert.equal(server.listening,false);
}
assert.ok(performance.now()<60000,'includes server cleanup under one absolute attempt');
console.log(JSON.stringify({status:'FEEDBACK_MANAGER_WRITE_MOUNTED_ROUTE_PASS',cases:rows.length,rows,
  source:{index:sha(index),authority:sha(authoritySource),sharedAuth:sha(authSource)},
  elapsedMs:performance.now(),serverClosed:!server.listening,
  scope:'Actual route/signature/current-manager/write middleware and loopback HTTP; synthetic store and persistence, not SQL/provider/deployment.'}));
