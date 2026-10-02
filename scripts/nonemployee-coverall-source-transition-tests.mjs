import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {nonemployeeCoverAllSource} from './fixtures/nonemployee-coverall-source.mjs';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {createContractorCapacityTransitionCandidate as preview} from '../src/static-weekly-contractor-source-transition.js';
const {source}=nonemployeeCoverAllSource();
const legacy=structuredClone(source);legacy.version=legacy.versions[0];delete legacy.versions;
legacy.slots.slice(9).forEach((s,i)=>{delete s.kind;delete s.capacityId;s.incumbencies=[{personId:`90000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,displayName:`Historical fixture contractor ${i+1}`,effectiveStart:'2020-01-01',effectiveEnd:null}];});
const basis={authority_revision:17,trusted_service_date:'2026-10-02',publication_id:legacy.version.publicationId,
 current_publication_id:legacy.version.publicationId,version_id:legacy.version.id,source_id:randomUUID(),source_digest:digest(legacy),
 compiler_input:legacy,roster_digest:'a'.repeat(64),dependency_digest:'b'.repeat(64),future_exception_count:0,
 capacity_dependency_findings:[],all_slot_ids:legacy.slots.map(s=>s.id)};
const selection=legacy.slots.slice(9).map((s,i)=>({legacy_slot_id:s.id,new_capacity_id:randomUUID(),capacity_code:`CoverAll0${i+1}`}));
const args={basis,selection,effectiveStart:'2026-10-12',expectedRevision:17,reason:'Explicit legacy-to-new capacity selection',candidateVersionId:randomUUID(),candidatePublicationId:randomUUID()};
let checks=0;const check=(name,predicate)=>{assert.ok(predicate,name);checks++;console.log('PASS',name);};
const bytes=JSON.stringify(args),candidate=preview(args);
check('nonmutating complete exact source candidate',JSON.stringify(args)===bytes&&candidate.admitted===false&&candidate.published===false);
check('all nine existing positions and current people unchanged',JSON.stringify(candidate.candidateSource.slots.slice(0,9))===JSON.stringify(legacy.slots.slice(0,9)));
check('no duty/workday/shift/lunch/restriction changes to employee branch',JSON.stringify(candidate.candidateSource.version.assignments)===JSON.stringify(legacy.version.assignments)&&JSON.stringify(candidate.candidateSource.version.slotAvailability.slice(0,9))===JSON.stringify(legacy.version.slotAvailability.slice(0,9)));
check('new stable capacities never inherit fake employee history',candidate.candidateSource.slots.slice(9).every(s=>s.kind==='CONTRACTOR_CAPACITY'&&s.incumbencies.length===0));
check('old contractor identities remain explicit historical exclusions',candidate.historicalCapacitySlotIds.every(s=>basis.all_slot_ids.includes(s))&&candidate.historicalPersonRowsChanged===false);
check('all inherited template facts preserved by explicit old UUID mapping',candidate.candidateSource.slots.slice(9).every((s,i)=>JSON.stringify(s.contractorAvailability)===JSON.stringify(legacy.slots[i+9].contractorAvailability)));
for(const change of [x=>{x.expectedRevision++;},x=>{x.basis.capacity_dependency_findings=['existing legacy device/protected identity'];},x=>{x.selection[0].new_capacity_id=x.basis.all_slot_ids[0];},x=>{x.selection[0].legacy_slot_id=x.basis.all_slot_ids[0];},x=>{x.basis.future_exception_count=1;},x=>{x.basis.compiler_input.version.assignments[0].ownerSlotId=x.selection[0].legacy_slot_id;x.basis.source_digest=digest(x.basis.compiler_input);},x=>{x.basis.compiler_input.slots[9].incumbencies[0].personId=x.basis.compiler_input.slots[0].incumbencies[0].personId;x.basis.source_digest=digest(x.basis.compiler_input);},x=>{x.basis.compiler_input.version.slotAvailability[9].status='working';x.basis.source_digest=digest(x.basis.compiler_input);},x=>{x.basis.source_digest='c'.repeat(64);}]){
 const forged=structuredClone(args);change(forged);assert.throws(()=>preview(forged));checks++;
}
console.log(JSON.stringify({status:'PASS',checks,scope:'pure exact source candidate only; actual server basis, append-only admission, publication CAS and historical catalog cutover remain unimplemented'}));
