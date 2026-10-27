import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {verifyNativeProtectedSnapshotEvidence as verify} from '../src/native-protected-snapshot-evidence.js';
// Synthetic signature fixtures test the exact existing Java VaultValidation.bindingSeal contract.
// They are not Java emitter, device, HTTP/SQL, inventory ACK or physical acceptance evidence.
const C='11111111-1111-4111-8111-111111111111',E='22222222-2222-4222-8222-222222222222',D='33333333-3333-4333-8333-333333333333',S='44444444-4444-4444-8444-444444444444',O='55555555-5555-4555-8555-555555555555',secret='SYNTHETIC_SEAL_BOUNDARY_ONLY',VERSION='custodial-native-protected-snapshot.v1',SCHEMA='custodial.native-protected-work-snapshot.v1';
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const context={schema:'custodial.separation-context.v1',separation_id:S,authority_revision:9,employee_id:E,device_id:D,canonical_device_id:'KIOSK_08',credential_id:C,assignment_epoch:3,cutoff_at:'2026-10-08T12:00:00.000001Z',state:'PENDING_RECONCILIATION',native_inventory_state:'UNKNOWN',server_known_open_sessions:[],new_work_allowed:false,phone_released:false,purpose:'SEPARATION_STATUS_ONLY'};
function checkSeal(seal){
 const principal={schema_version:'custodial-protected-principal.v1',device_id:'KIOSK_08',employee_id:E,assignment_epoch:3,credential_id:C,credential_operation_id:O,installation_seal:seal,enrolled_at:'2026-10-01T12:00:00.000Z'};
 const body=JSON.stringify({schema:SCHEMA,separation_context:context,original_principal:principal,raw_snapshot_sha256:hash(JSON.stringify([SCHEMA,'[]'])),record_count:0,records:[],native_semantic_inventory_state:'UNKNOWN',browser_inventory_state:'UNKNOWN',new_work_allowed:false,phone_released:false}),digest=hash(body);
 const wire=Buffer.from(JSON.stringify({attestation_version:VERSION,manifest_body:body,manifest_sha256:digest,attestation:createHmac('sha256',secret).update([VERSION,C,digest].join('\n')).digest('hex')}));
 return verify(wire,{separationContext:context,nativePrincipal:principal,credentialToken:C+'.'+secret});
}
const names=[];const pass=(name,fn)=>{fn();names.push(name);console.log('PASS '+name);};
for(const length of [8,512])pass('native_seal_valid_exact_'+length,()=>{const r=checkSeal('s'.repeat(length));assert.equal(r.record_count,0);assert.equal(r.native_semantic_inventory_state,'UNKNOWN');for(const key of ['inventory_acknowledged','automatic_acceptance','new_work_allowed','phone_released'])assert.equal(r[key],false);});
for(const [name,seal]of [['over_512','s'.repeat(513)],['under_8','s'.repeat(7)],['invalid_character','invalid seal']])pass('native_seal_'+name+'_refused_even_resigned',()=>assert.throws(()=>checkSeal(seal),e=>e.code==='native_protected_snapshot_evidence_invalid'));
assert.equal(names.length,5);console.log(JSON.stringify({cases:5,pass:5,fail:0,synthetic_signature_fixtures:true,unmounted:true,native_emitter_or_phone_proof:false,names}));
