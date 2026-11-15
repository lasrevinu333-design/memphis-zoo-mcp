// The DB owns MANUAL_INITIAL origin and immutable operation identity. This
// transport validator grants no authority and never recreates/ACKs any job.
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const unavailable=()=>Object.assign(new Error('Exact manual schedule delivery authority is unavailable.'),{code:'manual_device_delivery_unavailable',status:503});
export function assertManualScheduleDeliveryOrigin(delivery){
 if(delivery?.authorityOrigin==null)return delivery; // Existing genuine named/recurring/terminal route is literal.
 const origin=delivery.authorityOrigin;
 // Finite internal reason only: never attach the rejected origin/target or
 // any principal/credential value to an error or log.
 const refuse=reason=>{throw Object.assign(unavailable(),{deliveryDiagnostic:reason});};
 if(!exact(origin,['kind','bindingId']))refuse('ORIGIN_SHAPE');
 if(!['MANUAL_INITIAL','RECURRING_CONFIRMATION'].includes(origin.kind))refuse('ORIGIN_KIND');
 if(!UUID.test(origin.bindingId??''))refuse('BINDING_ID');
 if(delivery.mode!=='RECURRING_SCHEDULE')refuse('DELIVERY_MODE');
 if(delivery.delivery?.target?.targetType!=='SCHEDULE')refuse(delivery.delivery?.target==null?'TARGET_MISSING':'TARGET_TYPE');
 if(delivery.delivery.target.operationId!==origin.bindingId)refuse('OPERATION_MISMATCH');
 return delivery;
}
export async function bindApprovedManualDeviceDelivery({query,managerId,publicationId,originalReceiptDigest}){
 if(typeof query!=='function'||![managerId,publicationId].every(x=>typeof x==='string'&&UUID.test(x))||!HASH.test(originalReceiptDigest??''))throw unavailable();
 const result=await query('select public.static_weekly_bind_manual_device_delivery($1::uuid,$2::uuid,$3::text) as result',[managerId,publicationId,originalReceiptDigest]);
 const row=result?.rows?.length===1?result.rows[0].result:null;
 if(!row||row.schema!=='custodial.manual-device-delivery-binding.v1'||row.origin!=='MANUAL_INITIAL'
  ||row.publicationId!==publicationId||row.originalReceiptDigest!==originalReceiptDigest
  ||![row.bindingId,row.sourceId,row.originalProjectionId].every(x=>typeof x==='string'&&UUID.test(x))
  ||!HASH.test(row.originalLunchDocumentIdentity??'')||row.phoneDeliveryState!=='PENDING'||row.affectedPhonesUpdated!==false||row.acceptanceRerun!==false)throw unavailable();
 return row;
}
