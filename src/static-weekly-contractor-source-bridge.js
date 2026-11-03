import {createContractorCapacityTransitionCandidate} from './static-weekly-contractor-source-transition.js';
import {canonicalJson} from './static-weekly-schedule-model.js';

const fail=()=>{throw Object.assign(new Error('Exact server-derived capacity source preview required.'),{code:'capacity_source_preview_changed'});};
export function capacitySourceBasisSummary(basis) {
 if(!basis?.compiler_input?.version||!Array.isArray(basis.compiler_input.slots))fail();
 const slots=basis.compiler_input.slots;
 const legacy=slots.filter(s=>s.contractorCapacity===true&&s.kind!=='CONTRACTOR_CAPACITY');
 const findings=[...basis.capacity_dependency_findings];
 if(legacy.length!==8||slots.filter(s=>s.contractorCapacity!==true).length!==9)findings.push('EXACT_NINE_POSITION_EIGHT_LEGACY_POOL_NOT_PRESENT');
 if(basis.future_exception_count!==0)findings.push('FUTURE_DATED_COMMANDS_REQUIRE_RECONCILIATION');
 return {schema:'custodial.capacity-source-basis.v1',source_publication_id:basis.publication_id,
  expected_revision:basis.authority_revision,trusted_service_date:basis.trusted_service_date,
  source_id:basis.source_id,version_id:basis.version_id,source_digest:basis.source_digest,
  roster_digest:basis.roster_digest,dependency_digest:basis.dependency_digest,
  state:findings.length?'NEEDS_REVIEW':'MAPPING_REQUIRED',findings,
  position_count:slots.filter(s=>s.contractorCapacity!==true).length,
  legacy_slots:legacy.map(s=>({legacy_slot_id:s.id,label:s.label,
   historical_people:(s.incumbencies||[]).map(i=>({person_id:i.personId,name:i.displayName}))})),
  historical_employee_rows_changed:false,new_employee_rows:0,affected_phones_updated:false};
}
export function capacitySourcePublicationInput(preview) {
 if(preview?.schema!=='custodial.capacity-source-preview.v1'||!preview.candidate_source?.version)fail();
 const candidate=createContractorCapacityTransitionCandidate({basis:preview.basis,selection:preview.selection,
  effectiveStart:preview.effective_start,expectedRevision:preview.expected_revision,reason:preview.reason,
  candidateVersionId:preview.candidate_source.version.id,candidatePublicationId:preview.candidate_source.version.publicationId});
 if(candidate.candidateDigest!==preview.candidate_digest
  ||canonicalJson(candidate.candidateSource)!==canonicalJson(preview.candidate_source))fail();
 const {version,...input}=structuredClone(candidate.candidateSource);
 return {...input,versions:[version]};
}
export function capacitySourcePreviewSummary(preview) {
 capacitySourcePublicationInput(preview);
 return {...capacitySourceBasisSummary(preview.basis),schema:'custodial.capacity-source-preview.v1',
  state:'PREVIEW_ONLY',preview_id:preview.preview_id,effective_start:preview.effective_start,
  selection:structuredClone(preview.selection),candidate_digest:preview.candidate_digest,
  reason:preview.reason,expires_at:preview.expires_at,compiler_verified:true,
  admitted:false,published:false,manual_activation_required:true,phone_delivery_state:'NOT_ACCEPTED'};
}
