// Owner-only observation codec, not application acceptance/health/delivery proof.
// Runtime notification readers never invoke this backfill or infer authority
// from this descriptor; SQL uses its private immutable stored certificate.
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const FIELDS=['schema','projectionId','documentIdentity','validatorFingerprint','projectionDigest','documentDigest','validatedAt','validationTransactionId','scope'];
const SCOPE='FULL_STORED_VALIDATION_ONLY_NOT_CURRENT_AUTHORITY_OR_DEVICE_DELIVERY';
const unavailable=()=>Object.assign(new Error('Owned stored lunch revalidation observation unavailable.'),{code:'lunch_admission_observation_unavailable'});
export function decodeLunchAdmissionProofObservation(row,{projectionId,validatorFingerprint=null}={}){
 if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!==[...FIELDS].sort().join(',')
  ||row.schema!=='custodial.full-lunch-admission-proof.v1'||row.scope!==SCOPE||!UUID.test(row.projectionId??'')
  ||row.projectionId!==projectionId||!['documentIdentity','validatorFingerprint','projectionDigest','documentDigest'].every(k=>typeof row[k]==='string'&&HEX.test(row[k]))
  ||(validatorFingerprint!==null&&row.validatorFingerprint!==validatorFingerprint)
  ||typeof row.validatedAt!=='string'||!Number.isFinite(Date.parse(row.validatedAt))
  ||typeof row.validationTransactionId!=='string'||!/^[1-9][0-9]*$/.test(row.validationTransactionId))throw unavailable();
 return Object.freeze({...row,databaseAuthority:false,deviceDelivery:false});
}
export async function ownerRevalidateStoredLunchAdmission({ownerQuery,projectionId}){
 if(typeof ownerQuery!=='function'||typeof projectionId!=='string'||!UUID.test(projectionId))throw unavailable();
 const r=await ownerQuery('select custodial_coverall.owner_revalidate_lunch_admission($1::uuid) as proof',[projectionId]);
 return decodeLunchAdmissionProofObservation(r?.rows?.length===1?r.rows[0].proof:null,{projectionId});
}
