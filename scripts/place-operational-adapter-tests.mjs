import assert from 'node:assert/strict';
import {assertPlaceNameOnlyTransition,placePublicationInput,placePublicationSummary} from '../src/place-operational-adapter.js';
const base={serviceDate:'2026-10-05',slots:[{id:'unchanged',incumbencies:[]}],proximity:[],exceptions:[],version:{id:'old',publicationId:'old',effectiveStart:'2026-10-05',effectiveEnd:null,status:'published',
 slotAvailability:[{slotId:'unchanged',dayOfWeek:1,lunch:{start:'12:00',end:'13:00'},restrictions:['no-herpetarium']}],
 assignments:[{workId:'original',ownerSlotId:'unchanged',dayOfWeek:1,locationId:'original-physical',locationCodeSnapshot:'ORIGINAL_CODE',serviceMode:'scan_tracked',
 window:{start:'09:45',end:'16:00'},locationNameSnapshot:'old',includedLocations:[{locationId:'original-physical',locationNameSnapshot:'old'}]}]}};
const candidate=structuredClone(base);candidate.serviceDate='2026-10-12';candidate.version.id='new';candidate.version.publicationId='new';candidate.version.effectiveStart='2026-10-12';
candidate.version.assignments[0].locationNameSnapshot='New human name';candidate.version.assignments[0].includedLocations[0].locationNameSnapshot='New human name';
assert.equal(assertPlaceNameOnlyTransition(base,candidate),true);
for(const mutate of [x=>x.slots[0].id='other',x=>x.version.slotAvailability[0].lunch.start='11:30',x=>x.version.slotAvailability[0].restrictions=[],
 x=>x.version.assignments[0].ownerSlotId='other',x=>x.version.assignments[0].dayOfWeek=2,x=>x.version.assignments[0].window.end='17:00',
 x=>x.version.assignments[0].locationId='new-canonical-id',x=>x.version.assignments[0].locationCodeSnapshot='RENAMED_KEY',
 x=>x.version.assignments[0].includedLocations[0].locationId='other',x=>x.version.assignments[0].serviceMode='reminder_only']) {
 const bad=structuredClone(candidate);mutate(bad);assert.throws(()=>assertPlaceNameOnlyTransition(base,bad),/cannot change/);
}
const preview={schema:'custodial.place-name-publication.v1',selection:[{legacy_id:'original-physical'}],base_source:base,candidate_source:candidate};
assert.equal(placePublicationInput(preview).versions[0].id,'new');assert.equal(placePublicationSummary(preview).eligibility_changed,false);
assert.equal(placePublicationSummary(preview).accepted,false);assert.throws(()=>placePublicationInput({...preview,selection:[]}),/server Place preview/);
console.log('PLACE_OPERATIONAL_ADAPTER_PASS',15);
