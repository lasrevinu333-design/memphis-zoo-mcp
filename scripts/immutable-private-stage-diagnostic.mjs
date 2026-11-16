// Observational DATA only. The original exception is retained and rethrown by
// the owning factory; no catch here resumes, retries or admits an operation.
import {types} from 'node:util';
const failures=new WeakMap();
const enums={
 fresh_stage:new Set(['ADMIT_FRESH_STAGE','VERIFY_ORIGINAL_FIDELITY','INITIALIZE_SOURCE','PREPARE_RESTORE_CONTROL','CAPTURE_PRE_RESTORE_STATE','IMPORT_ORIGINAL_DATA','VERIFY_STAGED_DATA']),
 initializer_stage:new Set(['PREPARE_SOURCE','VERIFY_NATIVE_CONTEXT','VERIFY_EMPTY_RELATIONS','VERIFY_ISOLATED_CRON_SETUP','INITIALIZE_CONTROL','RECONCILE_ARCHIVED_ACLS','VERIFY_PREDECESSORS','INSTALL_PINNED_STATEMENT','INSTALL_APPLICATION_GUARD','VERIFY_SUCCESSORS','VERIFY_OWNER_FENCE','RESTORE_METADATA','RESTORE_MIGRATION_LEDGER','RESTORE_CRON','RESTORE_RELEASES','RESTORE_REGISTRY','VERIFY_RESTORED_METADATA','VERIFY_FINAL_STATE']),
 initializer_operation:new Set(['READ_NATIVE_CONTEXT','EXECUTE_QUERY','READ_PINNED_STATEMENT']),
 import_operation:new Set(['BEGIN_IMPORT','PLAN_ORDINARY_ORDER','STAGE_PRIVATE_ORIGINALS','CONSUME_ORDINARY_ORIGINALS','FINISH_IMPORT']),
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
]);
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
export function immutableFreshDiagnosticFields(value){
 const result={};
 for(const [key,allowed] of Object.entries(enums)){const data=own(value,key);if(allowed.has(data))result[key]=data;}
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
 const importRefusal=code==='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'&&own(error,'sql_state')==='55000'
  ?importRefusals.get(own(error,'import_refusal')):undefined;
 return Object.freeze({...saved,...(refusal||importRefusal?{fresh_refusal:refusal??importRefusal}:{})});
}
