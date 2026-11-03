import assert from 'node:assert/strict';
import {recoveryTargetFields,recoveryDeniedEffects,recoveryPreparationPurpose,
  recoveryPreparationAdmission,validateRecoveryOriginalTarget,validateRecoveryApprovalRequest,
  decodeRecoveryApprovalRequest,validateRecoveryPreview,validateRecoveryApprovalReceipt,
  recoveryDocumentSha256,recoveryInstantMicros} from '../src/same-original-recovery-wire.js';
const id='95000000-0000-4000-8000-000000000001',sha='a'.repeat(64);
const target=Object.fromEntries(recoveryTargetFields.map(key=>[key,
  ['operation_id','separation_id','canonical_device_pk','employee_id','credential_id','original_generation_id'].includes(key)?id:
  ['assignment_epoch','separation_authority_revision'].includes(key)?'7':
  key==='engine_revision'?'0':key==='canonical_device_id'?'KIOSK_08':sha]));
const request={schema:'custodial.same-original-recovery-approval-request.v1',request_id:id,challenge_id:id,
  expected_challenge_sha256:sha,expected_preview_sha256:sha,expected_manager_id:id,
  expected_manager_credential_id:id,expected_manager_device_id:'manager-fixture',
  decision:recoveryPreparationPurpose,manager_confirmation:'CONFIRM_THIS_SAME_ORIGINAL_ONLY'};
const preview={schema:'custodial.same-original-recovery-review.v1',state:'ORIGINAL_BINDING_REVIEW_ONLY',
  purpose:recoveryPreparationPurpose,challenge_id:id,challenge_sha256:sha,preview_sha256:sha,
  original_target:target,expires_at:'2026-10-14T00:05:00.000000Z',limits:{...recoveryDeniedEffects}};
preview.preview_sha256=recoveryDocumentSha256('preview',preview);
request.expected_preview_sha256=preview.preview_sha256;
const receipt={schema:'custodial.same-original-recovery-approval-receipt.v1',state:'APPROVAL_RECORDED_ONLY',
  approval_id:id,original_request:request,original_request_sha256:recoveryDocumentSha256('request',request),
  issuer:{manager_id:id,manager_credential_id:id,manager_device_id:'manager-fixture'},
  challenge_sha256:sha,preview_sha256:preview.preview_sha256,original_target:target,
  purpose_admission_id:recoveryPreparationAdmission,issued_at:'2026-10-14T00:00:00.000000Z',
  expires_at:'2026-10-14T00:05:00.000000Z',receipt_sha256:sha,retry_safe:false,limits:{...recoveryDeniedEffects}};
receipt.receipt_sha256=recoveryDocumentSha256('receipt',receipt);
let cases=0;
function test(name,body){body();cases++;console.log('PASS '+name);}
function rejects(body){assert.throws(body,{code:'same_original_recovery_wire_invalid'});}
test('exact immutable original target and decimal precision',()=>{
  const owned=validateRecoveryOriginalTarget(target);assert.deepEqual(owned,target);assert.ok(Object.isFrozen(owned));
  rejects(()=>validateRecoveryOriginalTarget({...target,engine_revision:'9007199254740992'}));
  rejects(()=>validateRecoveryOriginalTarget({...target,assignment_epoch:7}));
  rejects(()=>validateRecoveryOriginalTarget({...target,key:sha}));
});
test('exact original manager request, no permission widening',()=>{
  assert.deepEqual(validateRecoveryApprovalRequest(request),request);
  for(const delta of [{decision:'REMOVE'},{manager_confirmation:true},{expected_manager_id:sha},{retry_safe:true}])
    rejects(()=>validateRecoveryApprovalRequest({...request,...delta}));
});
test('raw duplicate field and malformed Unicode refusal',()=>{
  const raw=JSON.stringify(request);assert.deepEqual(decodeRecoveryApprovalRequest(Buffer.from(raw)),request);
  assert.throws(()=>decodeRecoveryApprovalRequest(Buffer.from(raw.replace('{','{"request_id":"'+id+'",'))));
  assert.throws(()=>decodeRecoveryApprovalRequest(Buffer.from(raw.replace('manager-fixture','\\ud800'))));
});
test('descriptor inspection never invokes caller getters',()=>{
  let effects=0;const body={...request};Object.defineProperty(body,'request_id',{enumerable:true,get(){effects++;return id;}});
  rejects(()=>validateRecoveryApprovalRequest(body));assert.equal(effects,0);
});
test('civil microsecond expiry rejects substitutions and leap errors',()=>{
  assert.equal(recoveryInstantMicros('2024-02-29T00:00:00.000001Z')-recoveryInstantMicros('2024-02-29T00:00:00.000000Z'),1n);
  for(const text of ['2026-02-29T00:00:00.000000Z','2026-10-14T00:00:00.000Z','2026-10-14T00:00:60.000000Z'])
    rejects(()=>recoveryInstantMicros(text));
});
test('preview is exact content pin, never an effect permit',()=>{
  assert.deepEqual(validateRecoveryPreview(preview),preview);
  rejects(()=>validateRecoveryPreview({...preview,original_target:{...target,engine_revision:'1'}}));
  rejects(()=>validateRecoveryPreview({...preview,limits:{...recoveryDeniedEffects,key_removal:true}}));
});
test('receipt binds original request and authoritative issuer representation',()=>{
  assert.deepEqual(validateRecoveryApprovalReceipt(receipt),receipt);
  rejects(()=>validateRecoveryApprovalReceipt({...receipt,original_request_sha256:sha}));
  rejects(()=>validateRecoveryApprovalReceipt({...receipt,issuer:{...receipt.issuer,manager_device_id:'successor'}}));
  rejects(()=>validateRecoveryApprovalReceipt({...receipt,receipt_sha256:sha}));
});
test('receipt expiry cannot renew or exceed five minute ceiling',()=>{
  for(const expires_at of ['2026-10-14T00:00:00.000000Z','2026-10-14T00:05:00.000001Z'])
    rejects(()=>validateRecoveryApprovalReceipt({...receipt,expires_at}));
});
test('purpose-local encoding is field-order invariant and domain separated',()=>{
  assert.equal(recoveryDocumentSha256('target',target),recoveryDocumentSha256('target',Object.fromEntries(Object.entries(target).reverse())));
  assert.notEqual(recoveryDocumentSha256('request',request),receipt.receipt_sha256);
  console.log('TARGET_GOLDEN '+recoveryDocumentSha256('target',target));
  console.log('REQUEST_GOLDEN '+recoveryDocumentSha256('request',request));
});
console.log(JSON.stringify({new_cases:cases,scope:'REPRESENTATION_ONLY',manager_auth:false,SQL:false,native:false,effects:false}));
