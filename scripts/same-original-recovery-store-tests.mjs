import assert from 'node:assert/strict';
import {createSameOriginalRecoveryStore} from '../src/same-original-recovery-store.js';
import {recoveryTargetFields,recoveryDeniedEffects,recoveryPreparationPurpose,
  recoveryPreparationAdmission,recoveryDocumentSha256} from '../src/same-original-recovery-wire.js';
const id='95000000-0000-4000-8000-000000000001',sha='a'.repeat(64);
function fixture() {
  const target=Object.fromEntries(recoveryTargetFields.map(key=>[key,
    ['operation_id','separation_id','canonical_device_pk','employee_id','credential_id','original_generation_id'].includes(key)?id:
    ['assignment_epoch','separation_authority_revision'].includes(key)?'7':
    key==='engine_revision'?'0':key==='canonical_device_id'?'KIOSK_08':sha]));
  const issuer=Object.freeze({manager_id:id,manager_credential_id:id,manager_device_id:'manager-fixture'});
  const preview={schema:'custodial.same-original-recovery-review.v1',state:'ORIGINAL_BINDING_REVIEW_ONLY',
    purpose:recoveryPreparationPurpose,challenge_id:id,challenge_sha256:sha,preview_sha256:sha,
    original_target:target,expires_at:'2026-10-14T00:05:00.000000Z',limits:{...recoveryDeniedEffects}};
  preview.preview_sha256=recoveryDocumentSha256('preview',preview);
  const request={schema:'custodial.same-original-recovery-approval-request.v1',request_id:id,challenge_id:id,
    expected_challenge_sha256:sha,expected_preview_sha256:preview.preview_sha256,expected_manager_id:id,
    expected_manager_credential_id:id,expected_manager_device_id:'manager-fixture',
    decision:recoveryPreparationPurpose,manager_confirmation:'CONFIRM_THIS_SAME_ORIGINAL_ONLY'};
  const receipt={schema:'custodial.same-original-recovery-approval-receipt.v1',state:'APPROVAL_RECORDED_ONLY',
    approval_id:id,original_request:request,original_request_sha256:recoveryDocumentSha256('request',request),issuer,
    challenge_sha256:sha,preview_sha256:preview.preview_sha256,original_target:target,purpose_admission_id:recoveryPreparationAdmission,
    issued_at:'2026-10-14T00:00:00.000000Z',expires_at:'2026-10-14T00:05:00.000000Z',receipt_sha256:sha,
    retry_safe:false,limits:{...recoveryDeniedEffects}};
  receipt.receipt_sha256=recoveryDocumentSha256('receipt',receipt);
  const captured={issuer,signed_session_sha256:sha,signed_session_expires_at:'2026-10-14T00:10:00.000Z',
    security_session_id:id,security_password_version:1,security_token_hash:sha,security_csrf_hash:sha,
    confirmation_csrf_verified:true,observation_only:true,transaction_authority:false};
  const privateBindings=new WeakMap([[issuer,captured]]),calls=[];
  const db={async rpc(name,args){calls.push({name,args});return {data:JSON.stringify(name.includes('preview')?preview:receipt),error:null};}};
  const store=createSameOriginalRecoveryStore({db,inspectAuthenticatedIssuer(value){if(!privateBindings.has(value))throw Error('unbound');return privateBindings.get(value);}});
  const originalRequestUtf8=' '+JSON.stringify(request)+'\n';
  return {store,db,calls,issuer,captured,request,preview,receipt,originalRequestUtf8,
    args(){return {originalRequest:request,originalRequestUtf8,issuer,verifiedPreview:preview};}};
}
let cases=0;
async function test(name,body){await body();cases++;console.log('PASS '+name);}
await test('only private captured issuer enters the fixed RPC',async()=>{
  const f=fixture();await assert.rejects(()=>f.store.readVerifiedChallenge({challengeId:id,issuer:{...f.issuer}}),{code:'same_original_recovery_issuer_unbound'});
  assert.equal(f.calls.length,0);
});
await test('read authentication cannot become a confirmation CSRF grant',async()=>{
  const f=fixture();f.captured.confirmation_csrf_verified=false;
  await assert.rejects(()=>f.store.issueOriginalApprovalOnce(f.args()),{code:'same_original_recovery_issuer_unbound'});assert.equal(f.calls.length,0);
});
await test('one issue preserves exact original raw bytes and target',async()=>{
  const f=fixture();assert.deepEqual(await f.store.issueOriginalApprovalOnce(f.args()),f.receipt);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'custodial_same_original_preparation_issue_v1');
  assert.equal(f.calls[0].args.p_original_utf8,f.originalRequestUtf8);assert.ok(Object.isFrozen(f.calls[0].args));
});
await test('lost writer reply is unknown; original status never invokes writer',async()=>{
  const f=fixture();f.db.rpc=async(name,args)=>{f.calls.push({name,args});throw Error('synthetic lost reply');};
  await assert.rejects(()=>f.store.issueOriginalApprovalOnce(f.args()),{code:'same_original_recovery_outcome_unknown',retry_safe:false});
  assert.equal(f.calls.length,1);
  f.db.rpc=async(name,args)=>{f.calls.push({name,args});return {data:JSON.stringify(f.receipt),error:null};};
  assert.deepEqual(await f.store.readOriginalApproval(f.args()),f.receipt);
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].name,'custodial_same_original_preparation_status_v1');
  assert.equal(f.calls[1].args.p_original_utf8,f.originalRequestUtf8);
});
await test('missing original returns null without a new approval',async()=>{
  const f=fixture();f.db.rpc=async(name,args)=>{f.calls.push({name,args});return {data:null,error:null};};
  assert.equal(await f.store.readOriginalApproval(f.args()),null);assert.equal(f.calls.length,1);
  assert.ok(f.calls[0].name.includes('status'));
});
await test('valid digest on a different original target is still refused',async()=>{
  const f=fixture();f.receipt.original_target={...f.receipt.original_target,engine_revision:'1'};
  f.receipt.receipt_sha256=recoveryDocumentSha256('receipt',f.receipt);
  await assert.rejects(()=>f.store.issueOriginalApprovalOnce(f.args()),{code:'same_original_recovery_response_invalid'});
  assert.equal(f.calls.length,1);
});
await test('provider object projection cannot replace exact original text',async()=>{
  const f=fixture();f.db.rpc=async()=>({data:f.receipt,error:null});
  await assert.rejects(()=>f.store.issueOriginalApprovalOnce(f.args()),{code:'same_original_recovery_response_invalid'});
});
await test('owned request and raw-body disagreement refuses before RPC',async()=>{
  const f=fixture();f.request.request_id='95000000-0000-4000-8000-000000000002';
  await assert.rejects(()=>f.store.issueOriginalApprovalOnce(f.args()),{code:'same_original_recovery_original_invalid'});assert.equal(f.calls.length,0);
});
await test('exact preview challenge locator and digest required',async()=>{
  const f=fixture();assert.deepEqual(await f.store.readVerifiedChallenge({challengeId:id,issuer:f.issuer}),f.preview);
  f.preview.challenge_id='95000000-0000-4000-8000-000000000002';f.preview.preview_sha256=recoveryDocumentSha256('preview',f.preview);
  await assert.rejects(()=>f.store.readVerifiedChallenge({challengeId:id,issuer:f.issuer}),{code:'same_original_recovery_response_invalid'});
});
console.log(JSON.stringify({new_cases:cases,scope:'SHIPPING_ADAPTER_SOURCE_WITH_SYNTHETIC_RPC_AND_PRIVATE_BINDING_PORT',SQL:false,real_manager:false,native_authority:false,effects:false}));
