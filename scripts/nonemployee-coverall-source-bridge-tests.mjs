import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {nonemployeeCoverAllSource} from './fixtures/nonemployee-coverall-source.mjs';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {createContractorCapacityTransitionCandidate} from '../src/static-weekly-contractor-source-transition.js';
import {canonicalAuthorityInput} from '../src/static-weekly-schedule-program.js';
import {capacitySourceBasisSummary,capacitySourcePublicationInput,capacitySourcePreviewSummary} from '../src/static-weekly-contractor-source-bridge.js';
const {source}=nonemployeeCoverAllSource();const legacy=canonicalAuthorityInput(source.versions[0],source.slots,[],source.proximity,source.serviceDate);
legacy.slots.slice(9).forEach((s,i)=>{delete s.kind;delete s.capacityId;s.incumbencies=[{personId:`90000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,displayName:`Historical fixture person ${i+1}`,effectiveStart:'2020-01-01',effectiveEnd:null}];});
const basis={authority_revision:17,trusted_service_date:'2026-10-02',publication_id:legacy.version.publicationId,
 current_publication_id:legacy.version.publicationId,version_id:legacy.version.id,source_id:randomUUID(),source_digest:digest(legacy),compiler_input:legacy,
 roster_digest:'a'.repeat(64),dependency_digest:'b'.repeat(64),future_exception_count:0,capacity_dependency_findings:[],all_slot_ids:legacy.slots.map(s=>s.id)};
const selection=legacy.slots.slice(9).map((s,i)=>({legacy_slot_id:s.id,new_capacity_id:randomUUID(),capacity_code:`CoverAll0${i+1}`}));
const args={basis,selection,effectiveStart:'2026-10-12',expectedRevision:17,reason:'Explicit synthetic source mapping',candidateVersionId:randomUUID(),candidatePublicationId:randomUUID()};
const candidate=createContractorCapacityTransitionCandidate(args);
const preview={schema:'custodial.capacity-source-preview.v1',preview_id:randomUUID(),source_publication_id:basis.publication_id,
 expected_revision:17,effective_start:args.effectiveStart,selection,basis,candidate_source:candidate.candidateSource,candidate_digest:candidate.candidateDigest,
 reason:args.reason,expires_at:new Date(Date.now()+600000).toISOString()};
let checks=0;const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;console.log('PASS',name);};
const bytes=JSON.stringify(preview);const input=capacitySourcePublicationInput(preview);
check('pure adapter does not mutate server preview',JSON.stringify(preview),bytes);
check('compiler receives exactly one server source version',input.versions,[candidate.candidateSource.version]);
check('accepted employee source bytes retained',input.slots.filter(s=>!s.contractorCapacity),legacy.slots.filter(s=>!s.contractorCapacity));
check('basis is explicit mapping not admission',capacitySourceBasisSummary(basis).state,'MAPPING_REQUIRED');
const summary=capacitySourcePreviewSummary(preview);
check('preview summary no raw compiler source',Object.hasOwn(summary,'candidate_source'),false);
check('preview summary retains exact eight mapping values',summary.selection,selection);
check('preview summary never phone acceptance',summary.affected_phones_updated,false);
check('preview summary retains manual-only requirement',summary.manual_activation_required,true);
for(const mutate of [p=>p.candidate_source.version.assignments[0].window.start='08:00',p=>p.candidate_digest='f'.repeat(64),
 p=>p.selection[0].legacy_slot_id=p.basis.all_slot_ids[0],p=>p.basis.capacity_dependency_findings=['PROTECTED_WORK'],
 p=>p.basis.compiler_input.slots[0].label='unapproved change']){
 const bad=structuredClone(preview);mutate(bad);assert.throws(()=>capacitySourcePublicationInput(bad));checks++;
}
check('protected-work basis stays Needs Review',capacitySourceBasisSummary({...basis,capacity_dependency_findings:['PROTECTED_WORK']}).state,'NEEDS_REVIEW');
check('future command basis stays Needs Review',capacitySourceBasisSummary({...basis,future_exception_count:1}).state,'NEEDS_REVIEW');
console.log(JSON.stringify({status:'PASS',checks,scope:'pure server-preview parity/summary adapter only; database admission/HTTP/UI runtime not inferred'}));
