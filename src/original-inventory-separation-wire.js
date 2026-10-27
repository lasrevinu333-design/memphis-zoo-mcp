// Shipping manager review representation. These DTOs/digests are DATA, never
// an authenticated manager, native inventory, ACK or finalizer capability.
// The backend must derive the review from the complete retained manifest and
// authenticate the actual CURRENT manager/session inside its transaction.
export const inventorySeparationPurpose='AUTHORIZE_EXACT_ORIGINAL_RETAINED_INVENTORY_SEPARATION';
export const inventorySeparationConfirmation='CONFIRM_LOGICAL_SEPARATION_KEEP_ALL_ORIGINAL_WORK_AND_KEYS';
export const inventorySeparationApi='/admin-api/device-security/original-inventory-separation';
export const inventorySeparationDeniedEffects=Object.freeze({inventory_acknowledged:false,work_accepted:false,
 replay_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false});
const ACK=Object.freeze({...inventorySeparationDeniedEffects,inventory_acknowledged:true,finalizer_allowed:true});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const TARGET=['operation_id','separation_id','separation_authority_revision','canonical_device_pk','canonical_device_id',
 'employee_id','credential_id','assignment_epoch','original_generation_id','original_credential_secret_key_id','principal_digest',
 'engine_revision','original_wire_sha256','original_frozen_work_sha256','capsule_sha256','record_sha256','frame_sha256','plan_sha256',
 'aad_binding_sha256','source_capture_sha256','values_sha256','semantic_join_sha256','layout_sha256'];
const UUID_TARGET=new Set(['operation_id','separation_id','canonical_device_pk','employee_id','credential_id','original_generation_id']);
export const inventorySeparationNativeNamespaces=Object.freeze(['MemphisZooCustodialNativeVaultV2','MemphisZooCustodialOfflineAuthorityTimeV1',
 'MemphisZooCustodialRetainedAttemptV1','MemphisZooCustodialRetainedReadQueryV1','MemphisZooCustodialRetainedBatchV1',
 'MemphisZooCustodialNativeProviderV1','MemphisZooCustodialNativeVaultV1','WSSecureStorageSharedPreferences']);
function fail(){throw Object.assign(new TypeError('original_inventory_separation_wire_invalid'),{code:'original_inventory_separation_wire_invalid'});}
function exact(value,keys){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)fail();
 for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);
  if(!keys.includes(key)||!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();}
}
function str(value,pattern){if(typeof value!=='string'||!pattern.test(value))fail();}
function integer(value){if(!Number.isSafeInteger(value)||value<0)fail();}
function decimal(value,zero=false){str(value,zero?/^(?:0|[1-9][0-9]*)$/:/^[1-9][0-9]*$/);if(value.length>16||BigInt(value)>9007199254740991n)fail();}
function instant(value){
 str(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
 const [y,m,d,h,n,s,us]=value.match(/\d+/g).map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||m<1||m>12||d<1||d>days[m-1]||h>23||n>59||s>59)fail();
 const p=y-1,ordinal=365*p+Math.floor(p/4)-Math.floor(p/100)+Math.floor(p/400)+days.slice(0,m-1).reduce((a,b)=>a+b,0)+d-1;
 return (BigInt(ordinal)*86400n+BigInt(h*3600+n*60+s))*1000000n+BigInt(us);
}
function lifetime(start,end){const a=instant(start),b=instant(end);if(b<=a||b-a>300000000n)fail();}
function target(value){exact(value,TARGET);for(const key of TARGET){
 if(UUID_TARGET.has(key))str(value[key],UUID);
 else if(['separation_authority_revision','assignment_epoch'].includes(key))decimal(value[key]);
 else if(key==='engine_revision')decimal(value[key],true);
 else if(key==='canonical_device_id')str(value[key],/^KIOSK_(?:0[2-9]|10)$/);
 else str(value[key],SHA);
}}
function issuer(value){exact(value,['manager_id','manager_credential_id','manager_device_id']);str(value.manager_id,UUID);
 str(value.manager_credential_id,UUID);str(value.manager_device_id,/^[A-Za-z0-9_-]{1,128}$/);}
function effects(value,expected){exact(value,Object.keys(expected));for(const key of Object.keys(expected))if(value[key]!==expected[key])fail();}
function summary(value){
 for(const key of ['record_count','accepted_exact_original_count','unresolved_retained_count'])integer(value[key]);
 if(value.accepted_exact_original_count+value.unresolved_retained_count!==value.record_count)fail();
}
function immutable(value){if(value&&typeof value==='object'){for(const x of Object.values(value))immutable(x);Object.freeze(value);}return value;}
function copy(value){return immutable(structuredClone(value));}

export function validateInventorySeparationReview(value){
 exact(value,['schema','state','purpose','native_request_id','original_target','original_employee_label','original_device_label',
  'registration_receipt_sha256','inventory_manifest_sha256','review_sha256','issuer','native_namespaces','browser_summary',
  'retained_key_family_count','reviewed_at','expires_at','limits']);
 if(value.schema!=='custodial.original-inventory-separation-review.v1'||value.state!=='COMPLETE_ORIGINAL_INVENTORY_REVIEW_ONLY'
  ||value.purpose!==inventorySeparationPurpose)fail();
 str(value.native_request_id,UUID);target(value.original_target);issuer(value.issuer);
 for(const key of ['original_employee_label','original_device_label'])if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>200)fail();
 for(const key of ['registration_receipt_sha256','inventory_manifest_sha256','review_sha256'])str(value[key],SHA);
 if(!Array.isArray(value.native_namespaces)||value.native_namespaces.length!==8)fail();
 const seen=new Set();for(const row of value.native_namespaces){exact(row,['namespace','record_count','accepted_exact_original_count','unresolved_retained_count']);
  if(!inventorySeparationNativeNamespaces.includes(row.namespace)||seen.has(row.namespace))fail();seen.add(row.namespace);summary(row);}
 exact(value.browser_summary,['declared_domains','record_count','accepted_exact_original_count','unresolved_retained_count','frame_sha256','part_set_sha256']);
 summary(value.browser_summary);integer(value.browser_summary.declared_domains);
 for(const key of ['frame_sha256','part_set_sha256'])str(value.browser_summary[key],SHA);
 integer(value.retained_key_family_count);lifetime(value.reviewed_at,value.expires_at);effects(value.limits,inventorySeparationDeniedEffects);
 return copy(value);
}
export function validateInventorySeparationRequest(value){
 exact(value,['schema','request_id','native_request_id','expected_review_sha256','expected_inventory_manifest_sha256',
  'expected_registration_receipt_sha256','expected_separation_authority_revision','expected_manager_id','expected_manager_credential_id',
  'expected_manager_device_id','decision','manager_confirmation']);
 if(value.schema!=='custodial.original-inventory-separation-request.v1'||value.decision!==inventorySeparationPurpose
  ||value.manager_confirmation!==inventorySeparationConfirmation)fail();
 for(const key of ['request_id','native_request_id','expected_manager_id','expected_manager_credential_id'])str(value[key],UUID);
 for(const key of ['expected_review_sha256','expected_inventory_manifest_sha256','expected_registration_receipt_sha256'])str(value[key],SHA);
 decimal(value.expected_separation_authority_revision);str(value.expected_manager_device_id,/^[A-Za-z0-9_-]{1,128}$/);
 return copy(value);
}
export function validateInventorySeparationReceipt(value){
 exact(value,['schema','state','approval_id','original_request','original_request_sha256','original_target','issuer',
  'inventory_manifest_sha256','registration_receipt_sha256','approved_at','expires_at','receipt_sha256','limits','purpose_admission_id','retry_safe']);
 if(value.schema!=='custodial.original-inventory-separation-receipt.v1'||value.state!=='INVENTORY_ACK_RECORDED_LOGICAL_SEPARATION_ONLY'
  ||value.purpose_admission_id!=='exact-original-retained-inventory-separation.v1'||value.retry_safe!==false)fail();
 str(value.approval_id,UUID);const r=validateInventorySeparationRequest(value.original_request);target(value.original_target);issuer(value.issuer);
 for(const key of ['original_request_sha256','inventory_manifest_sha256','registration_receipt_sha256','receipt_sha256'])str(value[key],SHA);
 if(r.expected_inventory_manifest_sha256!==value.inventory_manifest_sha256||r.expected_registration_receipt_sha256!==value.registration_receipt_sha256
  ||r.expected_separation_authority_revision!==value.original_target.separation_authority_revision
  ||r.expected_manager_id!==value.issuer.manager_id||r.expected_manager_credential_id!==value.issuer.manager_credential_id
  ||r.expected_manager_device_id!==value.issuer.manager_device_id)fail();
 lifetime(value.approved_at,value.expires_at);effects(value.limits,ACK);
 return copy(value);
}
