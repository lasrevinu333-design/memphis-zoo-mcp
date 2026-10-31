// Root-invoked readback only, after the real manual-period callback succeeds.
// Uses its original owned pool; no constructor, target URL, provider or replay.
import assert from 'node:assert/strict';
export async function run({fixture,pool,manager,at,accepted,query,save,sourceCurrent,assertFrozen}) {
 await fixture.assertOwned();assert.equal(fixture.receipt.selected_replay.migrations,303);
 assert.equal(pool.options.host,fixture.socketDirectory);sourceCurrent();assertFrozen();
 const result=await query(`select jsonb_build_object(
  'operationId',o.operation_id,'publicationId',o.publication_id,'frameStart',o.frame_start,
  'projectionId',p.projection_id,'ownerXid',o.owner_xid::text,'receiptXmin',r.xmin::text,
  'canonicalRequestExact',r.request_canonical_json=jsonb_build_object(
   'operation','materialize_projection','publication_id',p.publication_id,'service_date',p.week_start,
   'exception_set_digest',p.exception_set_digest,'compiler_version',p.compiler_version,
   'objective',p.objective_json,'metrics',p.metrics_json,'replay_digest',p.replay_digest,
   'projection_envelope',p.projection_envelope,'expected_revision',r.expected_revision,
   'actor_manager_id',r.actor_manager_id,'actor_manager_name',r.actor_manager_name_snapshot),
  'canonicalDigestExact',r.request_digest=public.static_weekly_digest_jsonb(r.request_canonical_json),
  'originalKeyExact',r.idempotency_key=o.operation_id::text||':normal-period',
  'originalBasisPreserved',o.basis_json is null and o.repeat_basis->>'schema'='custodial.approved-manual-recurring-basis.v1'
    and jsonb_array_length(o.repeat_basis->'employmentByDate')=7,
  'originalOwnerReceiptExact',owner_receipt.receipt_json->>'operationId'=o.operation_id::text
    and owner_receipt.receipt_json->>'projectionId'=p.projection_id::text
    and owner_receipt.receipt_json->>'status'='PERSISTED_CURRENT',
  'originalConfirmationExact',confirmation.receipt_json->>'projection_id'=p.projection_id::text
    and confirmation.request_json->>'requestId'=o.operation_id::text,
  'lunchIdentityExact',l.document_identity=owner_receipt.receipt_json->>'lunchDocumentIdentity') value
 from custodial_coverall.recurring_materialization_operations o
 join custodial_coverall.recurring_materialization_receipts owner_receipt using(operation_id)
 join public.static_weekly_manual_repeat_confirmations confirmation on confirmation.manager_id=o.manager_id and confirmation.request_id=o.operation_id
 join public.weekly_schedule_command_receipts r on r.actor_manager_id=o.manager_id and r.idempotency_key=o.operation_id::text||':normal-period'
 join public.weekly_schedule_compiled_projections p on p.projection_id::text=r.response_json#>>'{data,projection_id}' and p.publication_id=o.publication_id
 join public.weekly_schedule_lunch_documents l on l.projection_id=p.projection_id
 where o.manager_id=$1::uuid and o.publication_id=$2::uuid and o.frame_start=$3::date+7
  and o.request_json->>'kind'='RECURRING_MANUAL_MATERIALIZATION'`,[manager.manager_id,accepted.publicationId,at]);
 assert.equal(result.rows.length,1,'Exactly one real original next-period normal operation required');
 const witness=result.rows[0].value;
 for(const key of ['canonicalRequestExact','canonicalDigestExact','originalKeyExact','originalBasisPreserved',
  'originalOwnerReceiptExact','originalConfirmationExact','lunchIdentityExact'])assert.equal(witness[key],true,key);
 assert.equal(BigInt(witness.ownerXid)%4294967296n,BigInt(witness.receiptXmin));
 sourceCurrent();assertFrozen();await fixture.assertOwned();
 const answer={status:'PASS',scope:'ACTUAL_ORIGINAL_RECURRING_CANONICAL_REQUEST_AND_SAME_TRANSACTION_RECEIPT_READBACK',
  witness,readOnly:true,providerCalls:0,replayed:false,normalPatternChanged:false,memoryLimitIncreased:false,canonicalIdentityQualified:false};
 save('MANUAL_REPEAT_MEMORY_RECEIPT_READBACK.json',answer);return answer;
}
