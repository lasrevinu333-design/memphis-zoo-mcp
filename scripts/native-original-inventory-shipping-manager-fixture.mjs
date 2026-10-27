import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSameOriginalRecoveryManagerSqlFixture} from './same-original-recovery-manager-composition-tests.mjs';
import {qualifyNativeInventoryRegistrationStatusJoin} from './native-original-inventory-request-sql-tests.mjs';

// An existing restricted SQL owner calls this only AFTER its normal native
// challenge registration finishes, loaning the ACTUAL first request bytes and
// headers from that same invocation. This module creates no native original,
// accepts no invented target/manager authority, and never replays an exporter.
export async function qualifyShippingOriginalInventoryWithCurrentManager({admin,backendRoot,challengeId,
 preparationBody,preparationHeaders}){
 assert.equal(typeof admin?.query,'function');assert.ok(Buffer.isBuffer(preparationBody));
 assert.ok(preparationHeaders&&typeof preparationHeaders==='object');
 const manager=await createSameOriginalRecoveryManagerSqlFixture({admin,backendRoot,challengeId,inventoryManagerHttpJoin:true});
 try{
  const prefix='/admin-api/device-security/same-original-recovery';
  const preview=await manager.request(Object.freeze({method:'GET',path:prefix+'/challenges/'+manager.challengeId}));
  const issuer=manager.currentOwner();assert.ok(issuer);
  const approval={schema:'custodial.same-original-recovery-approval-request.v1',request_id:randomUUID(),challenge_id:preview.challenge_id,
   expected_challenge_sha256:preview.challenge_sha256,expected_preview_sha256:preview.preview_sha256,
   expected_manager_id:issuer.manager_id,expected_manager_credential_id:issuer.manager_credential_id,expected_manager_device_id:issuer.manager_device_id,
   decision:preview.purpose,manager_confirmation:'CONFIRM_THIS_SAME_ORIGINAL_ONLY'};
  // One normal original preparation approval is prerequisite only. Its exact
  // current issuer stays closure-owned and alive through inventory status.
  await manager.request(Object.freeze({method:'POST',path:prefix+'/approvals',body:approval}));
  const result=await qualifyNativeInventoryRegistrationStatusJoin({admin,target:preview.original_target,
   preparationBody,preparationHeaders,managerShippingHttpRequest:manager.inventoryRequest});
  const evidence=manager.inventoryEvidence();assert.equal(evidence.issue_attempts,1);
  assert.equal(evidence.calls.filter(x=>x.name==='custodial_original_inventory_separation_status_v1').length,2,
   'Exactly original and changed-raw status reach SQL; wrong expected issuer/withdrawn auth refuse before SQL');
  return {...result,actual_loopback_HTTP:true,manager_HTTP:evidence,prerequisite_source:'ACTUAL_CURRENT_NATIVE_CHALLENGE_INPUTS_LOANED_BY_EXISTING_RESTRICTED_OWNER',
   manager_gateway_closed_in_finally:true};
 }finally{await manager.close();}
}
