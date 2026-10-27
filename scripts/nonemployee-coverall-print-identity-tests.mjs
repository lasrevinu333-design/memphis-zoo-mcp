import assert from 'node:assert/strict';
import {createCoverAllPrintDocument} from '../src/static-weekly-coverall-print.js';
const id='20000000-0000-4000-8000-000000000001',day='2026-09-28';
const fixture=()=>({serviceDate:day,expectedRevision:6,projectionId:'projection',
 snapshot:{authority_revision:6,projection_status:'current',current_publication:{publication_id:'publication',version_id:'version'},roster:[],
  exceptions:[{type:'cover_all',serviceDate:day,payload:{availability:{slotId:id,shift:{start:'07:00',end:'15:00'}}}}],
  latest_projection:{projection_id:'projection',publication_id:'publication',version_id:'version',week_start:day,week_end:'2026-10-04',replay_digest:'a'.repeat(64),
   assignments:[{status:'assigned',service_date:day,plan_work_id:'one',owner_slot_id:id,owner_kind:'CONTRACTOR_CAPACITY',capacity_id:id,owner_person_id:null,
    work_snapshot:{window:{start:'08:00',end:'08:10'},serviceMode:'scan_tracked',locationNameSnapshot:'Synthetic area',includedLocations:[{locationId:'physical',locationNameSnapshot:'Synthetic physical'}]}}]}},
 source:{publication_id:'publication',version_id:'version',compiler_input:{slots:[{id,label:'CoverAll01',kind:'CONTRACTOR_CAPACITY',capacityId:id,contractorCapacity:true,incumbencies:[]}]}},
 lunch:{persistence_status:'PERSISTED',projection_id:'projection',document_identity:'b'.repeat(64),service_date:day,loans:[],responsibilities:[]}});
assert.equal(createCoverAllPrintDocument(fixture()).contractors[0].name,'CoverAll01');
for(const patch of [{owner_kind:'EMPLOYEE'},{capacity_id:'different'},{owner_person_id:'fabricated'},{owner_person_id:undefined}]){
 const input=fixture();Object.assign(input.snapshot.latest_projection.assignments[0],patch);
 assert.throws(()=>createCoverAllPrintDocument(input),/nonemployee_identity_mismatch/);
}
const hidden=fixture();hidden.source.compiler_input.slots[0].incumbencies=[{personId:'fabricated'}];assert.throws(()=>createCoverAllPrintDocument(hidden));
console.log('PASS6 typed CoverAll print identity checks; synthetic JSON presentation only');
