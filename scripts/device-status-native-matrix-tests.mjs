import assert from 'node:assert/strict';
import { authenticateDeviceCredentialRequest, installDeviceCredentialRoutes, deviceCredentialInternals } from '../src/auth/device-credential-auth.js';

// Exact route responses, not hand-authored native fixtures. Synthetic only.
const device = { requested_device_id:'KIOSK_08', canonical_device_id:'KIOSK_08',
  canonical_device_pk:'11111111-1111-4111-8111-111111111111', device_id:'KIOSK_08',
  device_name:'Synthetic Custodial', device_active:true, assignment_valid:true,
  employee_active:true, employee_code:'EMP008', role:'staff', assignment_epoch:7,
  assigned_employee_id:'22222222-2222-4222-8222-222222222222', assigned_employee_name:'Synthetic' };
const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'synthetic-status-matrix-dedicated-secret-20260924'};
const credentialId='80000000-0000-4000-8000-000000000008';
const otherCredential='90000000-0000-4000-8000-000000000009';
const secret='syntheticStatusSecretAbcdefghijklmnopqrstuvwxyz1234567890';
const base={credential_id:credentialId,device_id:device.canonical_device_pk,
  token_hash:deviceCredentialInternals.tokenHash(secret,env),
  created_at:'2026-01-01T00:00:00.000Z',confirmed_at:'2026-01-01T00:00:00.000Z',
  last_used_at:new Date().toISOString(),expires_at:'2099-01-01T00:00:00.000Z',revoked_at:null,
  metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)};
const cases=[],failures=[];let offlineRecoveryChecks=0;
for(const mode of ['observe','enroll','enforce-ready','enforce']) {
  for(const kind of ['healthy','revoked','expired','wrong_secret','generation_mismatch','unknown','wrong_device','wrong_expected_id','unconfirmed']) {
    let row=structuredClone(base),presented=secret,expected='REFUSED';
    if(kind==='healthy') expected='ACCEPTED';
    if(kind==='revoked') {row.revoked_at='2026-01-02T00:00:00.000Z';expected='ENROLLMENT_REQUIRED';}
    if(kind==='expired') {row.expires_at='2026-01-02T00:00:00.000Z';expected='ENROLLMENT_REQUIRED';}
    if(kind==='wrong_secret') {presented+='wrong';expected='ENROLLMENT_REQUIRED';}
    if(kind==='generation_mismatch') {row.metadata_json.credential_secret_key_id='b'.repeat(64);expected='ENROLLMENT_REQUIRED';}
    if(kind==='unknown') row=null;
    if(kind==='wrong_device') row.device_id='33333333-3333-4333-8333-333333333333';
    if(kind==='unconfirmed') {row.confirmed_at=null;row.metadata_json.enrollment_operation_id='44444444-4444-4444-8444-444444444444';row.metadata_json.enrollment_flow='enrollment';}
    const routes=new Map();const app={use(){},get:(p,...h)=>routes.set('GET '+p,h),post:(p,...h)=>routes.set('POST '+p,h)};
    const store={async getPolicy(){return{mode}},async findCredential(id){return id===credentialId?row:null},
      async touchCredential(){},async audit(){}};
    installDeviceCredentialRoutes(app,{env,store,runReadOnlySql:async()=>[device],
      requireOpsAuth:(_q,_s,n)=>n(),requireOpsWrite:(_q,_s,n)=>n()});
    const headers={'x-device-id':'KIOSK_08','authorization':`Device ${credentialId}.${presented}`};
    const req={headers,query:{device_id:'KIOSK_08'},body:{},header:n=>headers[n.toLowerCase()]||''};
    const res={statusCode:0,status(c){this.statusCode=c;return this},json(p){this.payload=p;return this}};
    await routes.get('GET /device-auth/status').at(-1)(req,res);
    const entry={name:mode+'/'+kind,status:res.statusCode,body:res.payload,expected,
      expected_device:'KIOSK_08',expected_credential:kind==='wrong_expected_id'?otherCredential:credentialId};
    cases.push(entry);
    try {
      assert.equal(res.statusCode,200);const data=res.payload.data;
      assert.equal(data.policy_mode,mode);
      if(expected==='ACCEPTED') {assert.equal(data.authenticated,true);assert.equal(data.enrollment_required,false);assert.equal(data.recovery_required,false);assert.equal(data.credential_id,credentialId);}
      if(expected==='ENROLLMENT_REQUIRED') {assert.equal(data.authenticated,false);assert.equal(data.enrollment_required,true);assert.equal(data.recovery_required,true);assert.equal(data.credential_id,null);}
      if(!data.authenticated) {assert.equal(data.employee_id,null);assert.equal(data.employee_name,null);assert.equal(data.assignment_epoch,null);}
      if(['revoked','expired','wrong_secret','generation_mismatch','unknown','wrong_device'].includes(kind)) {
        for(const fn of ['tool_start_offline_occurrence','tool_commit_cleaning_workflow']) {
          const result=await authenticateDeviceCredentialRequest({...req,body:{fn}},
            {env,store,runReadOnlySql:async()=>[device],requireEnrolledCredential:true});
          const allowed=['revoked','expired'].includes(kind);
          assert.equal(result.ok,allowed,entry.name+'/'+fn);
          assert.equal(result.offline_recovery_only===true,allowed,entry.name+'/'+fn+' frozen-only authority');
          offlineRecoveryChecks++;
        }
      }
    } catch(error){failures.push({name:entry.name,error:error.message});}
  }
}
if(process.argv.includes('--json')) console.log(JSON.stringify({schema:1,synthetic:true,cases,offlineRecoveryChecks,failures},null,2));
else console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',cases:cases.length,offlineRecoveryChecks,failures},null,2));
if(failures.length)process.exitCode=1;
