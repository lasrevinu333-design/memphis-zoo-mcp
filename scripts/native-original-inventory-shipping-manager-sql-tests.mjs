import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {createOriginalInventoryManifestFixture} from './native-original-inventory-manifest-tests.mjs';
import {nativeOriginalInventoryManifestChunkWire as C} from '../src/native-original-inventory-manifest-chunk.js';
import {nativeOriginalInventoryManifestChunkStatusWire as CS} from '../src/native-original-inventory-manifest-chunk-status.js';
import {nativeOriginalInventoryStatusWire as S,nativeOriginalInventorySeparationApprovalStatusWire as A} from '../src/native-original-inventory-status.js';
import {validateInventorySeparationReview,validateInventorySeparationReceipt,inventorySeparationPurpose,
 inventorySeparationConfirmation,inventorySeparationDeniedEffects as denied} from '../src/original-inventory-separation-wire.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
// Called only by the existing restricted owning SQL runner. Both HTTP servers
// already belong to that runner: native registration/chunk/status composition,
// and SAME signed manager/session/security stores used for original approval.
// Inventory rows are synthetic pending-only DATA, not private Android owners.
export async function qualifyNativeInventoryShippingManagerHttpJoin({admin,target,originalParameters,originalRequestHeaders,
 parentReceipt,secret,nativeHttpRequest,managerHttpRequest}){
 assert.equal(typeof admin?.query,'function');assert.equal(typeof nativeHttpRequest,'function');assert.equal(typeof managerHttpRequest,'function');
 const checks=[],parentBody=JSON.parse(originalParameters.p_original_request_utf8),intent=JSON.parse(parentBody.original_intent_utf8);
 const nativeId=originalParameters.p_native_request,archived=Object.freeze({...originalRequestHeaders});
 assert.equal(archived['x-memphis-native-request-id'],nativeId);
 assert.equal(sha(originalParameters.p_original_request_utf8),originalParameters.p_native_request_body_sha256);
 const envelope={schema:S.schema,purpose:S.purpose,original_request_utf8:originalParameters.p_original_request_utf8,
  original_request_timestamp:archived['x-memphis-native-request-timestamp'],original_request_attestation:archived['x-memphis-native-request-attestation']};
 const status=await nativeHttpRequest(S.path,JSON.stringify(envelope),new Date().toISOString());
 assert.equal(status.status,200);assert.deepEqual(status.body.data,parentReceipt);
 checks.push('actual shipping native registration/status HTTP bind the same first raw request to actual restricted SQL receipt');
 const value=createOriginalInventoryManifestFixture();value.schema='custodial.native-original-complete-inventory-manifest.v2';
 value.original_target=structuredClone(target);value.native_request_id=nativeId;
 value.registration_request_body_sha256=originalParameters.p_native_request_body_sha256;
 value.intent_document_sha256=parentBody.original_intent_document_sha256;value.intent_disk_sha256=parentBody.original_intent_disk_sha256;
 value.native_held_stamp=intent.native_held_stamp;value.browser_part_set_sha256=intent.browser_part_set_sha256;
 value.browser_value_frame.frame_sha256=intent.browser_frame_sha256;value.browser_value_frame.chunk_sha256=[intent.browser_frame_sha256];
 for(const row of [...value.native_records,...value.browser_records]){row.disposition='UNRESOLVED_RETAINED';row.completion_readback=null;}
 for(const item of value.native_namespaces){item.accepted_exact_original_count=0;item.unresolved_retained_count=item.record_count;}
 value.browser_accepted_exact_original_count=0;value.browser_unresolved_retained_count=value.browser_records.length;
 const manifest=Buffer.from(JSON.stringify(value));const chunkCount=Math.ceil(manifest.length/C.chunkBytes),records=[];
 const managerBase='/admin-api/device-security/original-inventory-separation';
 const manager=(method,path,originalUtf8)=>managerHttpRequest(Object.freeze({method,path,...(originalUtf8===undefined?{}:{originalUtf8})}));
 function unknown(reply,expectedStatus=null){if(expectedStatus===null)assert.ok([400,403,409,503].includes(reply.status),JSON.stringify(reply.body));else assert.equal(reply.status,expectedStatus,JSON.stringify(reply.body));assert.equal(reply.body.outcome,'UNKNOWN');assert.equal(reply.body.retry_safe,false);assert.deepEqual(reply.body.limits,denied);}
 const count=async()=>(await admin.query('select count(*)::int n from public.custodial_original_inventory_separation_approvals')).rows[0].n;
 try{
  assert.equal(await count(),0);
  for(let index=0;index<chunkCount;index++){
   const piece=manifest.subarray(index*C.chunkBytes,(index+1)*C.chunkBytes);
   const body={schema:C.schema,purpose:C.purpose,inventory_native_request_id:nativeId,
    registration_request_body_sha256:originalParameters.p_native_request_body_sha256,
    intent_document_sha256:value.intent_document_sha256,intent_disk_sha256:value.intent_disk_sha256,original_target:target,
    manifest_sha256:sha(manifest),manifest_byte_count:String(manifest.length),manifest_chunk_count:String(chunkCount),
    manifest_chunk_index:String(index),chunk_base64:piece.toString('base64'),chunk_sha256:sha(piece)};
   body.purpose_binding_sha256=sha([C.purposeVersion,body.inventory_native_request_id,body.registration_request_body_sha256,
    body.intent_document_sha256,body.intent_disk_sha256,body.manifest_sha256,body.manifest_byte_count,body.manifest_chunk_count,
    body.manifest_chunk_index,body.chunk_sha256].join('\n'));
   body.purpose_attestation=createHmac('sha256',secret).update([C.purposeVersion,target.credential_id,body.purpose_binding_sha256].join('\n')).digest('hex');
   const original=JSON.stringify(body),requestId=randomUUID(),written=await nativeHttpRequest(C.path,original,new Date().toISOString(),requestId);
   assert.equal(written.status,200,JSON.stringify(written.body));assert.equal(written.body.ok,true);assert.deepEqual(written.body.data.limits,denied);
   const chunkEnvelope={schema:CS.schema,purpose:CS.purpose,original_request_utf8:original,
    original_request_timestamp:written.headers['x-memphis-native-request-timestamp'],original_request_attestation:written.headers['x-memphis-native-request-attestation']};
   const observed=await nativeHttpRequest(CS.path,JSON.stringify(chunkEnvelope),new Date().toISOString(),requestId);
   assert.equal(observed.status,200,JSON.stringify(observed.body));assert.deepEqual(observed.body.data,written.body.data);
   records.push({native_request_id:requestId,original_request_utf8:original,receipt_utf8:JSON.stringify(written.body.data)});
  }
  assert.equal((await admin.query('select count(*)::int n from public.custodial_native_inventory_manifest_chunks')).rows[0].n,chunkCount);
  const retainedChunks=(await admin.query('select native_request_id,original_request_utf8,receipt_utf8 from public.custodial_native_inventory_manifest_chunks order by chunk_index')).rows;
  const retainedCounts=(await admin.query('select (select count(*) from public.custodial_native_private_custody_operations)::int operations,(select count(*) from public.custodial_native_private_custody_chunks)::int chunks,(select count(*) from public.custodial_native_inventory_requests)::int parents')).rows;
  checks.push('complete pending-only v2 manifest publishes each exact native-signed chunk once through shipping raw/auth HTTP and actual SQL; shipping READ ONLY chunk status returns same receipts');
  const preview=await manager('GET',managerBase+'/reviews/'+nativeId);assert.equal(preview.status,200,JSON.stringify(preview.body));
  assert.equal(preview.cacheControl,'private, no-store');assert.equal(preview.body.ok,true);
  const review=validateInventorySeparationReview(preview.body.data);assert.equal(review.inventory_manifest_sha256,sha(manifest));assert.deepEqual(review.original_target,target);
  assert.equal(review.registration_receipt_sha256,parentReceipt.receipt_sha256);assert.deepEqual(review.limits,denied);
  assert.equal(review.browser_summary.accepted_exact_original_count,0);
  for(const row of review.native_namespaces)assert.equal(row.accepted_exact_original_count,0);
  const issuer=review.issuer,request={schema:'custodial.original-inventory-separation-request.v1',request_id:randomUUID(),native_request_id:nativeId,
   expected_review_sha256:review.review_sha256,expected_inventory_manifest_sha256:review.inventory_manifest_sha256,
   expected_registration_receipt_sha256:review.registration_receipt_sha256,expected_separation_authority_revision:target.separation_authority_revision,
   expected_manager_id:issuer.manager_id,expected_manager_credential_id:issuer.manager_credential_id,expected_manager_device_id:issuer.manager_device_id,
   decision:inventorySeparationPurpose,manager_confirmation:inventorySeparationConfirmation};
  const original=' \n'+JSON.stringify(request)+'\t';
  const lost=await manager('POST',managerBase+'/approvals',original);unknown(lost);assert.equal(await count(),1);
  const saved=(await admin.query('select original_request_utf8,original_request_sha256,receipt_utf8 from public.custodial_original_inventory_separation_approvals')).rows;
  assert.equal(saved.length,1);assert.equal(saved[0].original_request_utf8,original);assert.equal(saved[0].original_request_sha256,sha(original));
  checks.push('actual shipping signed-session/security/CSRF manager review -> complete-manifest owning store loan -> ONE actual SQL issue; deliberate lost reply stays UNKNOWN');
  const observed=await manager('POST',managerBase+'/approvals/original-status',original);assert.equal(observed.status,200,JSON.stringify(observed.body));
  const receipt=validateInventorySeparationReceipt(observed.body.data);assert.deepEqual(receipt,JSON.parse(saved[0].receipt_utf8));
  assert.deepEqual(receipt.original_request,request);assert.deepEqual(receipt.limits,{...denied,inventory_acknowledged:true,finalizer_allowed:true});
  const nativeEnvelope={...envelope,schema:A.schema,purpose:A.purpose},nativeText=JSON.stringify(nativeEnvelope);
  const nativeObserved=await nativeHttpRequest(A.path,nativeText,new Date().toISOString());assert.equal(nativeObserved.status,200,JSON.stringify(nativeObserved.body));assert.deepEqual(nativeObserved.body.data,receipt);
  checks.push('same live manager fixture recovers immutable raw original through shipping manager status; shipping native approval-status HTTP reopens actual current SQL decision READ ONLY, no issue resend');
  unknown(await manager('POST',managerBase+'/approvals/original-status',original+'\n'));
  const wrong={...request,expected_manager_credential_id:randomUUID()};unknown(await manager('POST',managerBase+'/approvals/original-status',JSON.stringify(wrong)));
  unknown(await nativeHttpRequest(A.path,JSON.stringify({...nativeEnvelope,original_request_utf8:nativeEnvelope.original_request_utf8+'\n'}),new Date().toISOString()));
  assert.equal(await count(),1);
  assert.deepEqual((await admin.query('select original_request_utf8,original_request_sha256,receipt_utf8 from public.custodial_original_inventory_separation_approvals')).rows,saved);
  checks.push('changed raw manager original, wrong expected owner and changed archived native original all refuse; actual original decision remains byte-for-byte exactly once');
  // LAST: withdraw only this disposable fixture's actual issuing password.
  // Never nest the HTTP readers' own transactions or restore retired authority.
  const config=(await admin.query('select password_version from public.ops_manager_device_security_config where singleton')).rows;
  assert.equal(config.length,1);const previous=config[0].password_version;
  const changed=(await admin.query('update public.ops_manager_device_security_config set password_version=password_version+1 where singleton and password_version=$1 returning password_version',[previous])).rows;
  assert.deepEqual(changed,[{password_version:previous+1}]);
  const withdrawnManager=await manager('POST',managerBase+'/approvals/original-status',original);
  assert.equal(withdrawnManager.body.code,'original_inventory_separation_issuer_denied');
  unknown(withdrawnManager,401); // Normal shipping security-session withdrawal.
  unknown(await nativeHttpRequest(A.path,nativeText,new Date().toISOString()));
  assert.equal(await count(),1);assert.deepEqual((await admin.query('select original_request_utf8,original_request_sha256,receipt_utf8 from public.custodial_original_inventory_separation_approvals')).rows,saved);
  assert.equal((await admin.query('select password_version from public.ops_manager_device_security_config where singleton')).rows[0].password_version,previous+1);
  assert.deepEqual(originalRequestHeaders,archived);
  const chunks=(await admin.query('select native_request_id,original_request_utf8,receipt_utf8 from public.custodial_native_inventory_manifest_chunks order by chunk_index')).rows;
  assert.deepEqual(chunks,retainedChunks,'Every exact retained manifest receipt/raw original survives every manager/current read outcome');
  assert.deepEqual((await admin.query('select (select count(*) from public.custodial_native_private_custody_operations)::int operations,(select count(*) from public.custodial_native_private_custody_chunks)::int chunks,(select count(*) from public.custodial_native_inventory_requests)::int parents')).rows,retainedCounts);
  assert.equal(chunks.length,records.length);
  for(let index=0;index<records.length;index++){
   assert.equal(chunks[index].native_request_id,records[index].native_request_id);assert.equal(chunks[index].original_request_utf8,records[index].original_request_utf8);
   assert.deepEqual(JSON.parse(chunks[index].receipt_utf8),JSON.parse(records[index].receipt_utf8));
  }
  checks.push('actual issuing-password withdrawal invalidates both mounted current manager/native decision readers without retry; all original chunks/decision/headers retained, authority stays withdrawn until fixture disposal');
  return {checks,actual_HTTP:true,actual_SQL:true,shipping_manager_auth:true,shipping_complete_manifest_store:true,actual_READ_ONLY_status:true,
   manager_issue_attempts:1,decision_records:1,manifest_chunks:chunkCount,manifest_sha256:sha(manifest),receipt_sha256:receipt.receipt_sha256,
   inventory_source:'SYNTHETIC_PENDING_ONLY_MANIFEST_NOT_PRIVATE_NATIVE_BROWSER_ISSUER',real_manager:false,actual_native_manifest_producer:false,
   native_private_ACK:false,finalizer:false,key_removal:false,phone_release:false,Android:false,production:false,
   issuing_password_withdrawn_until_fixture_disposal:true};
 }finally{manifest.fill(0);}
}
