// Observational DATA only. The original exception is retained and rethrown by
// the owning factory; no catch here resumes, retries or admits an operation.
import {types} from 'node:util';
import {createHash} from 'node:crypto';
const failures=new WeakMap();
const enums={
 fresh_stage:new Set(['ADMIT_FRESH_STAGE','VERIFY_ORIGINAL_FIDELITY','INITIALIZE_SOURCE','PREPARE_RESTORE_CONTROL','CAPTURE_PRE_RESTORE_STATE','IMPORT_ORIGINAL_DATA','VERIFY_STAGED_DATA','LEGACY_COMPLETION_UUID_CHECK_STAGED','LEGACY_COMPLETION_UUID_CHECK_RESTORED']),
 initializer_stage:new Set(['PREPARE_SOURCE','VERIFY_NATIVE_CONTEXT','VERIFY_EMPTY_RELATIONS','VERIFY_ISOLATED_CRON_SETUP','INITIALIZE_CONTROL','RECONCILE_ARCHIVED_ACLS','VERIFY_PREDECESSORS','INSTALL_PINNED_STATEMENT','INSTALL_APPLICATION_GUARD','VERIFY_SUCCESSORS','VERIFY_OWNER_FENCE','RESTORE_METADATA','RESTORE_MIGRATION_LEDGER','RESTORE_CRON','RESTORE_RELEASES','RESTORE_REGISTRY','VERIFY_RESTORED_METADATA','VERIFY_FINAL_STATE']),
 initializer_operation:new Set(['READ_NATIVE_CONTEXT','EXECUTE_QUERY','READ_PINNED_STATEMENT']),
 import_operation:new Set(['BEGIN_IMPORT','VERIFY_INITIAL_WITNESS','PLAN_ORDINARY_ORDER','STAGE_PRIVATE_ORIGINALS','CONSUME_ORDINARY_ORIGINALS','FINISH_IMPORT']),
 ordinary_mode:new Set(['BOOTSTRAP','EMPTY','DIRECT','STAGED','BOUNDED_STAGE','COHORT_STAGE']),
 ordinary_phase:new Set(['SOURCE_OPEN','FIRST_SQL','SOURCE_EOF','INSERT_SET','BODY_COMPLETE']),
 import_validation:new Set(["PLANNER_CONTEXT","PLANNER_CATALOG_RESULT","PLANNER_RELATION","PLANNER_FOREIGN_KEY","PLANNER_FK_COLUMNS","PLANNER_GRAPH","PLANNER_INACTIVE_FK_SOURCE","PLANNER_TOPOLOGY","PLANNER_BATCH_CATALOG","PLANNER_BATCH_ROW"]),
 import_relation_schema:new Set(['public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private']),
 import_native_operation:new Set(['LOCK_RELATION_ACCESS_EXCLUSIVE','COUNT_RELATION_ROWS']),
 guard_schema:new Set(['public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private']),
 source_statement:new Set(Array.from({length:13},(_,i)=>String(i+1).padStart(2,'0'))),
 fresh_refusal:new Set(['GLOBAL_FENCE_UNAVAILABLE','EVENT_PREDECESSOR_DIFFERS','MESSENGER_PREDECESSOR_DIFFERS','MESSAGE_GUARD_PREDECESSOR_DIFFERS','MESSAGE_EFFECTS_PREDECESSOR_DIFFERS','MESSAGE_AUDIT_PREDECESSOR_DIFFERS','MESSAGE_RECEIPT_PREDECESSOR_DIFFERS','DEVICE_TRIGGER_DIFFERS','DEVICE_PREDECESSOR_DIFFERS','DEVICE_ACL_DIFFERS','MANAGER_TRIGGER_DIFFERS','MANAGER_PREDECESSOR_DIFFERS','MANAGER_ACL_DIFFERS','EMPLOYEE_PUSH_TRIGGER_DIFFERS','EMPLOYEE_PUSH_PREDECESSOR_DIFFERS','EMPLOYEE_PUSH_ACL_DIFFERS','SOURCE_INVENTORY_EPOCH_UNAVAILABLE','SOURCE_INVENTORY_CONTEXT_CHANGED','SOURCE_INVENTORY_ORIGINAL_CHANGED','IMPORT_ORIGINAL_CONTEXT_CHANGED','IMPORT_FULL_TARGET_CATALOG_MISMATCH','PRIVATE_GUARD_KIND_UNSUPPORTED','MIXED_GENERATED_ONLY_INSERT_UNSUPPORTED','MIXED_INSERT_GUARD_UNSUPPORTED','CURRENT_SOURCE_REGISTRY_STALE']),
};
const permissionRefusals=new Map([
 ['PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED','IMPORT_GUARD_CONTEXT_DENIED'],
 ['Immutable import policy creator changed','IMPORT_POLICY_CREATOR_CHANGED'],
 ['Original immutable import context cannot be replaced','IMPORT_CONTEXT_REPLACEMENT_DENIED'],
 ['Original immutable import context cannot be removed','IMPORT_CONTEXT_REMOVAL_DENIED'],
 ['Original staged private DATA cannot be replaced or removed','STAGED_DATA_REPLACEMENT_DENIED'],
 ['Immutable original codec owner unavailable','ORIGINAL_CODEC_OWNER_UNAVAILABLE'],
 ['Original group owner differs; original object owner required','ORIGINAL_GROUP_OWNER_DENIED'],
 ['Original application fence owner differs; original object owner required','ORIGINAL_APPLICATION_OWNER_DENIED'],
]);
for(const label of [...permissionRefusals.values(),'NATIVE_RELATION_ACCESS_DENIED','NATIVE_SCHEMA_ACCESS_DENIED','NATIVE_FUNCTION_EXECUTE_DENIED','NATIVE_ROW_SECURITY_DENIED'])enums.fresh_refusal.add(label);
const fixedRefusals=new Map([
 ['Immutable import original global fence unavailable','GLOBAL_FENCE_UNAVAILABLE'],
 ['Exact original event function predecessor differs','EVENT_PREDECESSOR_DIFFERS'],
 ['Exact original messenger function/ACL/trigger predecessor differs','MESSENGER_PREDECESSOR_DIFFERS'],
 ['Exact original message function/owner/ACL/trigger predecessor differs','MESSAGE_GUARD_PREDECESSOR_DIFFERS'],
 ['Exact original message effects function/ACL/trigger predecessor differs','MESSAGE_EFFECTS_PREDECESSOR_DIFFERS'],
 ['Exact original message-audit function/owner/ACL/trigger predecessor differs','MESSAGE_AUDIT_PREDECESSOR_DIFFERS'],
 ['Exact original receipt function/owner/ACL/trigger predecessor differs','MESSAGE_RECEIPT_PREDECESSOR_DIFFERS'],
 ['Exact original device activation trigger differs','DEVICE_TRIGGER_DIFFERS'],
 ['Exact original device activation function predecessor differs','DEVICE_PREDECESSOR_DIFFERS'],
 ['Original device activation function ACL differs','DEVICE_ACL_DIFFERS'],
 ['Exact original manager owner trigger consumers differ','MANAGER_TRIGGER_DIFFERS'],
 ['Exact original manager owner function predecessor differs','MANAGER_PREDECESSOR_DIFFERS'],
 ['Original manager owner function ACL differs','MANAGER_ACL_DIFFERS'],
 ['Exact original employee push credential trigger differs','EMPLOYEE_PUSH_TRIGGER_DIFFERS'],
 ['Original employee push credential function predecessor differs','EMPLOYEE_PUSH_PREDECESSOR_DIFFERS'],
 ['Original employee push credential function ACL differs','EMPLOYEE_PUSH_ACL_DIFFERS'],
]);
// The original importer already records ONLY this fixed guard vocabulary on
// its private wrapper. Project it through the same closed receipt chain; never
// inspect or emit a raw cause, detail, command, row, SQL body or stack.
const importRefusals=new Map([
 ['Immutable import original global fence unavailable','GLOBAL_FENCE_UNAVAILABLE'],
 ['Immutable import Source inventory epoch unavailable','SOURCE_INVENTORY_EPOCH_UNAVAILABLE'],
 ['Immutable import Source inventory context changed','SOURCE_INVENTORY_CONTEXT_CHANGED'],
 ['Immutable import Source inventory original changed','SOURCE_INVENTORY_ORIGINAL_CHANGED'],
 ['Immutable import original context changed','IMPORT_ORIGINAL_CONTEXT_CHANGED'],
 ['Immutable import full target catalog mismatch','IMPORT_FULL_TARGET_CATALOG_MISMATCH'],
 ['Immutable private guard kind unsupported','PRIVATE_GUARD_KIND_UNSUPPORTED'],
 ['IMMUTABLE_MIXED_GENERATED_ONLY_INSERT_UNSUPPORTED','MIXED_GENERATED_ONLY_INSERT_UNSUPPORTED'],
 ['IMMUTABLE_MIXED_INSERT_GUARD_UNSUPPORTED','MIXED_INSERT_GUARD_UNSUPPORTED'],
 ['Immutable import current Source registry unavailable or stale','CURRENT_SOURCE_REGISTRY_STALE'],
 ["Immutable import manifest field type invalid","IMPORT_MANIFEST_FIELD_TYPE_INVALID"],
 ["Immutable import manifest original target absent","IMPORT_MANIFEST_TARGET_ABSENT"],
 ["Immutable import member type invalid","IMPORT_MEMBER_TYPE_INVALID"],
 ["Immutable import private source member invalid","IMPORT_PRIVATE_SOURCE_MEMBER_INVALID"],
 ["Immutable import catalog shape invalid","IMPORT_CATALOG_SHAPE_INVALID"],
 ["Immutable import catalog invalid","IMPORT_CATALOG_INVALID"],
 ["Immutable import relation kind unsupported","IMPORT_RELATION_KIND_UNSUPPORTED"],
 ["Immutable import exact columns changed","IMPORT_EXACT_COLUMNS_CHANGED"],
 ["Immutable import original primary key changed","IMPORT_PRIMARY_KEY_CHANGED"],
 ["Immutable import release bootstrap not exact","IMPORT_RELEASE_HISTORY_BOOTSTRAP_DIFFERS"],
 ["Immutable import current Source registry bootstrap not exact","IMPORT_REGISTRY_BOOTSTRAP_DIFFERS"],
 ["Immutable import target DATA is not fresh","IMPORT_TARGET_DATA_NOT_FRESH"],
 ["Immutable import private owner/schema boundary changed","IMPORT_PRIVATE_OWNER_SCHEMA_CHANGED"],
 ["Immutable import exact constraints or policy changed","IMPORT_CONSTRAINTS_POLICY_CHANGED"],
 ["Immutable import ALWAYS/source guard unqualified","IMPORT_ALWAYS_GUARD_UNQUALIFIED"],
 ["Immutable import exact ALWAYS scope changed","IMPORT_ALWAYS_SCOPE_CHANGED"],
 ["Immutable import exact recovery metadata unavailable","IMPORT_RECOVERY_METADATA_UNAVAILABLE"],
 ["Immutable import original target identity changed","IMPORT_ORIGINAL_TARGET_IDENTITY_CHANGED"],
]);
for(const label of importRefusals.values())enums.fresh_refusal.add(label);
const own=(value,key)=>{
 if(!value||typeof value!=='object'||types.isProxy(value))return undefined;
 const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;
};
export function classifyImmutableImportPermission(error){
 if(own(error,'code')!=='42501')return undefined;
 const message=own(error,'message');if(typeof message!=='string'||message.length>512)return undefined;
 if(permissionRefusals.has(message))return permissionRefusals.get(message);
 // Names are discarded. No raw message, detail, row, SQL or identifier export.
 if(/^permission denied for (?:table|relation) (?:[A-Za-z_][A-Za-z0-9_]*|"[^"]{1,63}")$/.test(message))return 'NATIVE_RELATION_ACCESS_DENIED';
 if(/^permission denied for schema (?:[A-Za-z_][A-Za-z0-9_]*|"[^"]{1,63}")$/.test(message))return 'NATIVE_SCHEMA_ACCESS_DENIED';
 if(/^permission denied for function [A-Za-z_][A-Za-z0-9_]*$/.test(message))return 'NATIVE_FUNCTION_EXECUTE_DENIED';
 if(/^query would be affected by row-level security policy for table "[^"]{1,63}"$/.test(message))return 'NATIVE_ROW_SECURITY_DENIED';
 return undefined;
}
export function classifyImmutableImportPermissionContext(error,tables){
 const result={};if(classifyImmutableImportPermission(error)!=='NATIVE_RELATION_ACCESS_DENIED')return Object.freeze(result);
 const message=own(error,'message'),match=/^permission denied for (?:table|relation) (?:"([^"]{1,63})"|([A-Za-z_][A-Za-z0-9_]*))$/.exec(message);
 if(match&&Array.isArray(tables)&&!types.isProxy(tables)){
  const schemas=[];
  for(const key of Reflect.ownKeys(tables)){
   if(typeof key!=='string'||!(/^(0|[1-9][0-9]*)$/.test(key)))continue;
   const row=own(tables,key),schema=own(row,'schema_name');
   if(own(row,'table_name')===(match[1]??match[2])&&enums.import_relation_schema.has(schema))schemas.push(schema);
  }
  if(schemas.length===1)result.import_relation_schema=schemas[0];
 }
 const context=own(error,'where');
 if(typeof context==='string'&&context.length<=16384){
  if(/SQL statement "LOCK TABLE [^\n"]{1,192} IN ACCESS EXCLUSIVE MODE"/.test(context))result.import_native_operation='LOCK_RELATION_ACCESS_EXCLUSIVE';
  else if(/SQL statement "SELECT count\(\*\) FROM ONLY [^\n"]{1,192}"/.test(context))result.import_native_operation='COUNT_RELATION_ROWS';
 }
 return Object.freeze(result);
}
const finishRefusals=new Map([
 ['Immutable import actual mixed DATA count changed','FINISH_ORDINARY_COUNT_DIFFERS'],
 ['Immutable import partial staged original','FINISH_PRIVATE_STAGE_COUNT_DIFFERS'],
 ['Immutable import original raw changed','FINISH_PRIVATE_RAW_DIFFERS'],
 ['Immutable import typed original changed','FINISH_PRIVATE_CODEC_DIFFERS'],
 ['Immutable import actual inserted count changed','FINISH_PRIVATE_COUNT_DIFFERS'],
 ['Immutable import foreign final staged relation refused','FINISH_FOREIGN_STAGE_RELATION'],
 ['Immutable ordinary final staged originals differ','FINISH_ORDINARY_STAGE_DIFFERS'],
 ['Immutable ordinary final DATA multiset differs','FINISH_ORDINARY_DATA_DIFFERS'],
 ['Immutable private final staged originals differ','FINISH_PRIVATE_STAGE_DIFFERS'],
 ['Immutable private final DATA multiset differs','FINISH_PRIVATE_DATA_DIFFERS'],
]);
for(const label of finishRefusals.values())enums.fresh_refusal.add(label);

export function classifyImmutableImportGuard(error,tables){
 if(own(error,'code')==='P0001'){
  const refusal=finishRefusals.get(own(error,'message'));
  return Object.freeze(refusal?{fresh_refusal:refusal}:{});
 }
 if(own(error,'code')!=='55000'||own(error,'message')!=='IMMUTABLE_MIXED_INSERT_GUARD_UNSUPPORTED')return Object.freeze({});
 const raw=own(error,'detail');if(typeof raw!=='string'||Buffer.byteLength(raw)>8192||types.isProxy(tables)||!Array.isArray(tables))return Object.freeze({});
 let d;try{d=JSON.parse(raw);}catch{return Object.freeze({});}
 const keys=['schema','table','trigger','function_identity','tgtype','enabled','owner','function_sha256',
  ...(Object.hasOwn(d??{},'receipt_guard_checks')?['receipt_guard_checks']:[])];
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.getPrototypeOf(d)!==Object.prototype||
  !keys.every(k=>Object.hasOwn(d,k))||Object.keys(d).length!==keys.length)return Object.freeze({});
 const identifier=v=>typeof v==='string'&&/^[A-Za-z_][A-Za-z0-9_$]*$/.test(v)&&Buffer.byteLength(v)<=63;
 if(!enums.guard_schema.has(d.schema)||!identifier(d.table)||!identifier(d.trigger)||!identifier(d.owner)||
  typeof d.function_identity!=='string'||!(/^[A-Za-z_][A-Za-z0-9_$]*\.[A-Za-z_][A-Za-z0-9_$]*\(\)$/.test(d.function_identity))||d.function_identity.length>130||
  !Number.isSafeInteger(d.tgtype)||d.tgtype<0||d.tgtype>127||!['O','A'].includes(d.enabled)||
  d.function_sha256!==null&&(typeof d.function_sha256!=='string'||!/^[a-f0-9]{64}$/.test(d.function_sha256)))return Object.freeze({});
 let matches=0;
 for(const key of Reflect.ownKeys(tables))if(typeof key==='string'&&/^(0|[1-9][0-9]*)$/.test(key)){
  const row=own(tables,key);if(own(row,'schema_name')===d.schema&&own(row,'table_name')===d.table)matches++;
 }
 if(matches!==1)return Object.freeze({});
 const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 if(Object.hasOwn(d,'receipt_guard_checks')&&d.receipt_guard_checks!==null&&(!Array.isArray(d.receipt_guard_checks)
  ||d.receipt_guard_checks.length!==9||d.receipt_guard_checks.some(v=>typeof v!=='boolean')))return Object.freeze({});
 if(d.receipt_guard_checks&&(d.schema!=='custodial_coverall'||!([
  ['activation_operations','complete_coverall_activation','public.static_weekly_coverall_require_activation_receipt()'],
  ['recurring_materialization_operations','complete_recurring_receipt','public.static_weekly_manual_recurring_require_receipt()'],
 ].some(([table,trigger,identity])=>table===d.table&&trigger===d.trigger&&identity===d.function_identity))))return Object.freeze({});
 return Object.freeze({guard_schema:d.schema,guard_relation_sha256:sha([d.schema,d.table]),guard_trigger_sha256:sha([d.schema,d.table,d.trigger]),
  ...(d.function_sha256?{guard_function_sha256:d.function_sha256}:{}),
  ...(d.receipt_guard_checks?{guard_receipt_checks:d.receipt_guard_checks.map(v=>v?'1':'0').join('')}:{})});
}
export function immutableFreshDiagnosticFields(value){
 const result={};
 for(const [key,allowed] of Object.entries(enums)){const data=own(value,key);if(allowed.has(data))result[key]=data;}
 const digest=key=>{const v=own(value,key);return typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:undefined;};
 if(result.import_relation_schema&&result.ordinary_mode&&result.ordinary_phase&&digest('ordinary_relation_sha256')){
  result.ordinary_relation_sha256=digest('ordinary_relation_sha256');
 }else{delete result.ordinary_mode;delete result.ordinary_phase;}
 if(result.guard_schema&&digest('guard_relation_sha256')&&digest('guard_trigger_sha256')){
  for(const key of ['guard_relation_sha256','guard_trigger_sha256','guard_function_sha256'])if(digest(key))result[key]=digest(key);
  const checks=own(value,'guard_receipt_checks');if(typeof checks==='string'&&/^[01]{9}$/.test(checks))result.guard_receipt_checks=checks;
 }else delete result.guard_schema;
 // An ordinal is meaningful only inside the pinned installer loop.
 if(result.initializer_stage!=='INSTALL_PINNED_STATEMENT')delete result.source_statement;
 return Object.freeze(result);
}
export function recordImmutableFreshFailure(error,fields){
 if(!error||typeof error!=='object'||types.isProxy(error))return;
 // Preserve the innermost operation. Outer factory adds only its fresh stage.
 const previous=failures.get(error)||{},next=immutableFreshDiagnosticFields(fields);
 failures.set(error,Object.freeze({...next,...previous}));
}
export function readImmutableFreshFailure(error){
 const saved=error&&typeof error==='object'&&!types.isProxy(error)?failures.get(error):null;
 const code=own(error,'code'),message=own(error,'message');
 const refusal=(code==='55000'||code==='42501')&&typeof message==='string'?fixedRefusals.get(message):undefined;
 const importRefusal=code==='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'&&['55000','P0001'].includes(own(error,'sql_state'))
  ?importRefusals.get(own(error,'import_refusal')):undefined;
 return Object.freeze({...saved,...(refusal||importRefusal?{fresh_refusal:refusal??importRefusal}:{})});
}

// Bounded observational checkpoints for the one explicit private rehearsal.
// No SQL, row data, retry, validity verdict or admission is produced here.
let progressRecords=0,ordinaryProgressRecords=0;
export function recordImmutableFreshProgress(fields){
 try{
  if(process.env.RESTORE_PRIVATE_DIAGNOSTICS!=='bounded-v1'||process.env.REHEARSAL_SCOPE!=='backup_only'
   ||process.env.OFFICIAL_LOCAL_STORAGE_PROVIDER!=='true'||process.env.RESTORE_DATABASE_ONLY!=='true')return;
  const projected=immutableFreshDiagnosticFields(fields);if(Object.keys(projected).length===0)return;
  const ordinary=Boolean(projected.ordinary_phase);
  // At most5 metadata-only checkpoints for each of this finite archive's
  //353 selected tables. Separate counters retain the original64-stage cap.
  //2048*384 +64*2048 stays below the unchanged1MiB private stream ceiling.
  if(ordinary?ordinaryProgressRecords>=2048:progressRecords>=64)return;
  const line=JSON.stringify({schema:'custodial.private-restore-stage.v1',phase:'stage_fresh_private_database',
   event:'ENTER',private_payload_exported:false,...projected});
  if(Buffer.byteLength(line)>(ordinary?384:2048))return;
  if(ordinary)ordinaryProgressRecords++;else progressRecords++;
  console.error(line);
 }catch{} // Observation cannot change source validation, refusal or cleanup.
}
