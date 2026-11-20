// Closed metadata-only observer controls. No target or import authority.
import {isProxy} from 'node:util/types';
export function selectPrivateContextCostMode(value,scope,official){
 if(value===undefined||value==='false')return false;
 if(value!=='true'||scope!=='backup_only'||official!=='true')throw Error('Context observation requires the explicit existing private route');
 return true;
}
const own=(v,k)=>Object.getOwnPropertyDescriptor(v,k)?.value;
const closed=(v,keys)=>v&&typeof v==='object'&&!isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype
 &&Reflect.ownKeys(v).length===keys.length&&Reflect.ownKeys(v).every(k=>typeof k==='string'&&keys.includes(k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const sizes=['stored_shape_bytes','shape_text_bytes','stored_manifest_bytes','manifest_text_bytes','stored_epoch_bytes','certificate_current','held_locks','employee_rows','group_original_rows','message_original_rows'];
const probes=['owner_fence','catalog_epoch','inventory_state','target_shape','catalog_matches','assert_context','read_context','extract_three_data_fields'];
const flags=['application_data_imported','private_data_imported','transaction_authority','restore_complete','admission_resumed'];
export function projectPrivateContextCost(v){
 const keys=['schema','scope','archive_digest','calls_per_probe','sizes','timings',...flags,'rollback_verified','readback_connection_closed','current428_source_qualified'];
 if(!closed(v,keys)||own(v,'schema')!=='custodial.private-current-context-cost.v1'
  ||own(v,'scope')!=='SIGNED_CURRENT_SCHEMA_CONTEXT_ONLY_NOT_DATA_RESTORE'||!/^[a-f0-9]{64}$/.test(own(v,'archive_digest'))||own(v,'calls_per_probe')!==10)return null;
 if(flags.some(k=>own(v,k)!==false)||own(v,'rollback_verified')!==true||own(v,'readback_connection_closed')!==true||typeof own(v,'current428_source_qualified')!=='boolean')return null;
 const s=own(v,'sizes'),t=own(v,'timings');if(!closed(s,sizes)||!closed(t,probes)||typeof own(s,'certificate_current')!=='boolean')return null;
 for(const k of sizes)if(k!=='certificate_current'&&(typeof own(s,k)!=='string'||!/^(0|[1-9][0-9]{0,11})$/.test(own(s,k))))return null;
 if(['employee_rows','group_original_rows','message_original_rows'].some(k=>own(s,k)!=='0'))return null;
 for(const k of probes)if(typeof own(t,k)!=='string'||!/^(0|[1-9][0-9]{0,8})\.[0-9]{3}$/.test(own(t,k)))return null;
 return Object.freeze({...Object.fromEntries(keys.map(k=>[k,own(v,k)])),sizes:Object.freeze({...s}),timings:Object.freeze({...t})});
}
export function projectPrivateContextCostFailure(v){
 const keys=['schema','phase','probe','sql_state','rollback_command_received','readback_verified','connection_closed'];
 if(!closed(v,keys)||own(v,'schema')!=='custodial.private-current-context-cost-failure.v1'
  ||!['SOURCE_ADMISSION','NATIVE_CONTROL','MEASURE_CONTEXT','ROLLBACK','ROLLBACK_READBACK','CLOSE'].includes(own(v,'phase'))
  ||own(v,'probe')!==null&&!probes.includes(own(v,'probe'))
  ||own(v,'sql_state')!==null&&(typeof own(v,'sql_state')!=='string'||!/^[A-Z0-9]{5}$/.test(own(v,'sql_state'))))return null;
 if(['rollback_command_received','readback_verified','connection_closed'].some(k=>typeof own(v,k)!=='boolean'))return null;
 return Object.freeze(Object.fromEntries(keys.map(k=>[k,own(v,k)])));
}
