import {canonicalJson, assertServiceDate, snapshotContractorCapacity} from './static-weekly-schedule-model.js';
import {postgresJsonbContentDigest} from './static-weekly-schedule-compiler.js';

const fail = code => {throw Object.assign(new Error(code), {code});};
const uuid = value => {if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))fail('capacity_transition_uuid_required');return value;};
const hash = value => {if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))fail('capacity_transition_source_witness_required');return value;};
const same = (a,b) => canonicalJson(a)===canonicalJson(b);

/** Pure, nonmutating source candidate. The basis is a SERVER-owned authority
 * read, never HTTP compiler data. This helper alone cannot register/publish.
 * Existing staffing/vacancies remain unchanged; nine POSITIONS is not a claim
 * that nine real people currently work or that historical people are deleted.
 */
export function createContractorCapacityTransitionCandidate({basis,selection,effectiveStart,expectedRevision,
  reason,candidateVersionId,candidatePublicationId}) {
 const date=assertServiceDate(effectiveStart);
 assertServiceDate(basis?.trusted_service_date);
 if(new Date(`${date}T00:00:00Z`).getUTCDay()!==1||!Number.isSafeInteger(expectedRevision)
  ||date<=basis.trusted_service_date||expectedRevision!==basis?.authority_revision||basis?.current_publication_id!==basis?.publication_id
  ||basis?.future_exception_count!==0||!Array.isArray(basis?.capacity_dependency_findings)
  ||basis.capacity_dependency_findings.length)fail('capacity_transition_current_basis_changed_or_requires_reconciliation');
 for(const key of ['source_digest','roster_digest','dependency_digest'])hash(basis[key]);
 for(const key of ['source_id','publication_id','version_id'])uuid(basis[key]);
 const source=basis.compiler_input;
 if(!source||!Array.isArray(source.slots)||!source.version||source.version.id!==basis.version_id
  ||source.version.publicationId!==basis.publication_id||postgresJsonbContentDigest(source)!==basis.source_digest
  ||!Array.isArray(source.version.slotAvailability)||!Array.isArray(source.version.assignments)
  ||!Array.isArray(basis.all_slot_ids))fail('capacity_transition_exact_source_required');
 if(typeof reason!=='string'||!reason.trim()||reason.length>500)fail('capacity_transition_reason_required');
 const ordinary=source.slots.filter(s=>s.contractorCapacity!==true),legacy=source.slots.filter(s=>s.contractorCapacity===true);
 if(ordinary.length!==9||legacy.length!==8||legacy.some(s=>s.kind==='CONTRACTOR_CAPACITY'))fail('capacity_transition_explicit_legacy_pool_required');
 const people=new Set(ordinary.flatMap(s=>(s.incumbencies||[]).map(i=>i.personId)));
 if(legacy.some(s=>!Array.isArray(s.incumbencies)||!s.incumbencies.length||s.incumbencies.some(i=>people.has(i.personId))))fail('capacity_transition_legacy_person_shared_with_employee');
 if(!Array.isArray(selection)||selection.length!==8)fail('capacity_transition_exact_eight_mappings_required');
 const mapped=new Map(),newIds=new Set(),codes=new Set();
 for(const entry of selection){
  if(!entry||Object.keys(entry).sort().join(',')!=='capacity_code,legacy_slot_id,new_capacity_id')fail('capacity_transition_exact_mapping_required');
  uuid(entry.legacy_slot_id);uuid(entry.new_capacity_id);
  if(!legacy.some(s=>s.id===entry.legacy_slot_id)||mapped.has(entry.legacy_slot_id)||newIds.has(entry.new_capacity_id)
   ||basis.all_slot_ids.includes(entry.new_capacity_id)||!/^CoverAll0[1-8]$/.test(entry.capacity_code)||codes.has(entry.capacity_code))fail('capacity_transition_duplicate_or_unbound_mapping');
  mapped.set(entry.legacy_slot_id,entry);newIds.add(entry.new_capacity_id);codes.add(entry.capacity_code);
 }
 // No inferred reassignment/removal of accepted duties, origins, exclusions,
 // accepted routes, absences or roster-history references is authorized here.
 const referencesLegacy = value => {
  if(typeof value==='string')return mapped.has(value);
  if(Array.isArray(value))return value.some(referencesLegacy);
  return value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>mapped.has(key)||referencesLegacy(item));
 };
 const version=structuredClone(source.version);
 for(const [key,value] of Object.entries(version))if(!['id','publicationId','effectiveStart','effectiveEnd','slotAvailability'].includes(key)&&referencesLegacy(value))fail('capacity_transition_legacy_duty_or_policy_reference_requires_reconciliation');
 const candidate=structuredClone(source);
 candidate.slots=source.slots.map(slot=>{
  const mapping=mapped.get(slot.id);if(!mapping)return structuredClone(slot);
  if(!Array.isArray(slot.contractorAvailability)||!slot.contractorAvailability.length)fail('capacity_transition_inherited_template_required');
  const capacity={id:mapping.new_capacity_id,capacityId:mapping.new_capacity_id,label:mapping.capacity_code,
   kind:'CONTRACTOR_CAPACITY',contractorCapacity:true,incumbencies:[],contractorAvailability:structuredClone(slot.contractorAvailability)};
  snapshotContractorCapacity(capacity,date);return capacity;
 });
 version.slotAvailability=version.slotAvailability.map(row=>{
  const mapping=mapped.get(row.slotId);if(!mapping)return row;
  if(row.status!=='unavailable'||Object.keys(row).some(k=>!['slotId','dayOfWeek','status'].includes(k)))fail('capacity_transition_baseline_capacity_must_be_inactive');
  return {...row,slotId:mapping.new_capacity_id};
 });
 version.id=uuid(candidateVersionId);version.publicationId=uuid(candidatePublicationId);version.effectiveStart=date;version.effectiveEnd=null;version.status='published';
 candidate.version=version;candidate.serviceDate=date;
 if(!same(candidate.slots.filter(s=>s.contractorCapacity!==true),ordinary)
  ||!same(candidate.version.assignments,source.version.assignments)
  ||!same(candidate.version.slotAvailability.filter(s=>!newIds.has(s.slotId)),source.version.slotAvailability.filter(s=>!mapped.has(s.slotId))))fail('capacity_transition_unintended_employee_or_duty_change');
 const binding={source_id:basis.source_id,publication_id:basis.publication_id,version_id:basis.version_id,
  source_digest:basis.source_digest,roster_digest:basis.roster_digest,dependency_digest:basis.dependency_digest,
  expected_revision:expectedRevision,effective_start:date,selection:structuredClone(selection),reason};
 return {schema:'custodial.contractor-source-transition-candidate.v1',state:'SOURCE_CANDIDATE_ONLY',
  admitted:false,published:false,affectedPhonesUpdated:false,binding,bindingDigest:postgresJsonbContentDigest(binding),
  candidateSource:candidate,candidateDigest:postgresJsonbContentDigest(candidate),
  unchangedPositionIds:ordinary.map(s=>s.id),historicalCapacitySlotIds:legacy.map(s=>s.id),newCapacityIds:[...newIds],
  historicalPersonRowsChanged:false,employeeRowsCreated:0,
  remainingGate:'SERVER_BASIS_PREVIEW_AND_APPEND_ONLY_CURRENT_AUTHORITY_ADMISSION_NOT_IMPLEMENTED'};
}
