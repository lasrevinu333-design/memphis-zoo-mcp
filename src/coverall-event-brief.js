// Manager-confirmed contractor handout content. The SQL reader is a candidate
// projection only; this module never turns employee-visible notes into an
// automatic contractor disclosure or changes accepted schedule ownership.
import {createHash} from 'node:crypto';
import {canonicalJson} from './static-weekly-schedule-model.js';

const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CODES=new Set(['trash_boxes','extra_cans','restroom_checks']);
const FIELDS=new Set(['schema','status','disclosure_approved','manager_id','capacity_slot_id',
 'service_date','projection_id','publication_id','authority_revision','projection_replay_digest',
 'lunch_document_identity','print_document_digest','event_id','event_revision','event_name',
 'display_location','event_date','start_instant_utc','end_instant_utc','start_time','end_time',
 'custodial_note_codes','custodial_public_notes','matched_areas']);
const LIST_FIELDS=new Set(['schema','status','disclosure_approved','manager_id','capacity_slot_id',
 'service_date','projection_id','publication_id','projection_replay_digest',
 'authority_revision','lunch_document_identity',
 'print_document_digest','candidate_limit','scan_limit','candidates']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const minute=value=>TIME.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):null;
const clock=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;

function printBasis(document,capacitySlotId){
 if(!object(document)||document.schema!=='custodial.coverall-accepted-print.v1'
  ||!UUID.test(capacitySlotId)||!UUID.test(document.projectionId)
  ||!UUID.test(document.publicationId)||!DATE.test(document.serviceDate)
  ||!Number.isSafeInteger(document.authorityRevision)||document.authorityRevision<1
  ||!SHA.test(document.lunchDocumentIdentity)||!SHA.test(document.documentDigest)
  ||!SHA.test(document.replayDigest)||!Array.isArray(document.contractors))fail('coverall_event_print_basis_invalid');
 const {documentDigest,...withoutDigest}=document;
 if(sha(canonicalJson(withoutDigest))!==documentDigest)fail('coverall_event_print_basis_invalid');
 const capacity=document.contractors.find(row=>same(row?.slotId,capacitySlotId));
 if(!capacity||!Array.isArray(capacity.periods)||document.contractors.filter(row=>same(row?.slotId,capacitySlotId)).length!==1)
  fail('coverall_event_capacity_not_in_print');
 return {capacity,serviceDate:document.serviceDate,projectionId:document.projectionId,
  publicationId:document.publicationId,authorityRevision:document.authorityRevision,
  lunchDocumentIdentity:document.lunchDocumentIdentity,printDocumentDigest:documentDigest,
  projectionReplayDigest:document.replayDigest};
}

function managerRequired(manager){
 if(!UUID.test(manager?.managerId)||typeof manager?.managerName!=='string'||!manager.managerName.trim()
  ||manager?.readOnly===true||manager?.read_only===true
  ||['operations_first','admin_api_key'].includes(manager?.auth_mode))fail('coverall_event_request_invalid');
 return manager.managerId;
}

function previewFrom(candidate,input){
 const digest=sha(canonicalJson(candidate));
 return {status:'PREVIEW_ONLY',disclosureApproved:false,digest,
  managerId:input.manager.managerId,capacitySlotId:input.capacitySlotId,
  eventId:candidate.event_id,eventRevision:candidate.event_revision,
  serviceDate:candidate.service_date,printDocumentDigest:candidate.print_document_digest,
  candidate};
}

function validateCandidate(row,{managerId,eventId,eventRevision,capacitySlotId,basis}){
 if(!object(row)||row.schema!=='custodial.coverall-event-brief-candidate.v1'
  ||typeof row.status!=='string'||row.disclosure_approved!==false)fail('coverall_event_candidate_invalid');
 if(row.status!=='PREVIEW_ONLY'){
  if(Object.keys(row).sort().join('|')!==['schema','status','disclosure_approved'].sort().join('|'))
   fail('coverall_event_candidate_invalid');
  return null;
 }
 if(Object.keys(row).some(key=>!FIELDS.has(key))||Object.keys(row).length!==FIELDS.size
  ||!same(row.manager_id,managerId)||!same(row.event_id,eventId)
  ||row.event_revision!==eventRevision||!same(row.capacity_slot_id,capacitySlotId)
  ||row.service_date!==basis.serviceDate||row.event_date!==basis.serviceDate
  ||!same(row.projection_id,basis.projectionId)||!same(row.publication_id,basis.publicationId)
  ||Number(row.authority_revision)!==basis.authorityRevision
  ||row.lunch_document_identity!==basis.lunchDocumentIdentity
  ||row.print_document_digest!==basis.printDocumentDigest
  ||row.projection_replay_digest!==basis.projectionReplayDigest
  ||typeof row.event_name!=='string'||!row.event_name.trim()
  ||typeof row.display_location!=='string'||!row.display_location.trim()
  ||typeof row.custodial_public_notes!=='string'||row.custodial_public_notes.length>500
  ||!Array.isArray(row.custodial_note_codes)
  ||row.custodial_note_codes.some(code=>!CODES.has(code))
  ||new Set(row.custodial_note_codes).size!==row.custodial_note_codes.length
  ||!Array.isArray(row.matched_areas)||!row.matched_areas.length
  ||!/^\d{4}-\d{2}-\d{2}T/.test(row.start_instant_utc)
  ||!/^\d{4}-\d{2}-\d{2}T/.test(row.end_instant_utc)
  ||!Number.isFinite(Date.parse(row.start_instant_utc))
  ||!Number.isFinite(Date.parse(row.end_instant_utc))
  ||Date.parse(row.end_instant_utc)<=Date.parse(row.start_instant_utc))
  fail('coverall_event_candidate_invalid');
 for(const period of basis.capacity.periods){
  if(minute(period?.start)===null||minute(period?.end)===null||minute(period.start)>=minute(period.end)
   ||!Array.isArray(period.areas))fail('coverall_event_print_basis_invalid');
  for(const area of period.areas){
   if(!Array.isArray(area?.locations))fail('coverall_event_print_basis_invalid');
  }
 }
 const matched=[];
 for(const area of row.matched_areas){
  if(!object(area)||Object.keys(area).sort().join('|')!==
     ['location_group_id','group_name','starts','ends','included_location_ids','purpose'].sort().join('|')
   ||!UUID.test(area.location_group_id)||typeof area.group_name!=='string'||!area.group_name.trim()
   ||!Array.isArray(area.included_location_ids)
   ||!area.included_location_ids.length||!['area_owner','lunch_coverage'].includes(area.purpose)
   ||minute(area.starts)===null||minute(area.ends)===null||minute(area.starts)>=minute(area.ends)
   ||area.included_location_ids.some(id=>!UUID.test(id)))fail('coverall_event_candidate_invalid');
  for(const period of basis.capacity.periods){
   const starts=Math.max(minute(period.start),minute(area.starts));
   const ends=Math.min(minute(period.end),minute(area.ends));
   if(starts>=ends)continue;
   if(period.areas.some(printArea=>printArea.purpose===area.purpose
    &&area.included_location_ids.every(id=>printArea.locations.some(loc=>same(loc?.id,id)))))
    matched.push({...area,starts:clock(starts),ends:clock(ends)});
  }
 }
 if(!matched.length)fail('coverall_event_no_exact_accepted_period');
 return {...row,matched_areas:matched};
}

async function readCandidate({runRpc,manager,eventId,eventRevision,capacitySlotId,printDocument}){
 if(typeof runRpc!=='function'||!UUID.test(eventId)
  ||!Number.isSafeInteger(eventRevision)||eventRevision<1||!UUID.test(capacitySlotId))
  fail('coverall_event_request_invalid');
 managerRequired(manager);
 const basis=printBasis(printDocument,capacitySlotId);
 const args=[manager.managerId,eventId,eventRevision,capacitySlotId,basis.serviceDate,
  basis.projectionId,basis.authorityRevision,basis.lunchDocumentIdentity,basis.printDocumentDigest];
 const result=await runRpc('static_weekly_coverall_event_brief_candidate',args);
 const row=object(result)&&Object.hasOwn(result,'result')?result.result:result;
 return {basis,candidate:validateCandidate(row,{managerId:manager.managerId,eventId,eventRevision,capacitySlotId,basis})};
}

function confirmedFrom(candidate,input,candidateDigest){
 return {schema:'custodial.coverall-event-brief-confirmed.v1',status:'CONFIRMED_FOR_EXACT_PRINT',
  managerId:input.manager.managerId,capacitySlotId:input.capacitySlotId,
  eventId:input.eventId,eventRevision:input.eventRevision,
  printDocumentDigest:candidate.print_document_digest,candidateDigest,
  brief:{eventId:candidate.event_id,eventRevision:candidate.event_revision,
   eventName:candidate.event_name,displayLocation:candidate.display_location,
   eventDate:candidate.event_date,startInstantUtc:candidate.start_instant_utc,
   endInstantUtc:candidate.end_instant_utc,startTime:candidate.start_time,endTime:candidate.end_time,
   custodialNoteCodes:candidate.custodial_note_codes,
   custodialPublicNotes:candidate.custodial_public_notes,
   matchedAreas:candidate.matched_areas}};
}

export async function previewCoverAllEventBrief(input){
 const {candidate}=await readCandidate(input);
 if(!candidate)return {status:'UNAVAILABLE',disclosureApproved:false};
 return previewFrom(candidate,input);
}

// A separate bounded discovery RPC lets the manager select by event title and
// time without knowing database IDs. Each result is the same exact, safe
// preview shape used by the single-Event confirmation path. An over-limit or
// stale source is explicit, never misrepresented as an empty candidate list.
export async function listCoverAllEventBriefPreviews(input){
 if(typeof input?.runRpc!=='function'||!UUID.test(input?.capacitySlotId))
  fail('coverall_event_request_invalid');
 managerRequired(input.manager);
 const basis=printBasis(input.printDocument,input.capacitySlotId);
 const args=[input.manager.managerId,input.capacitySlotId,basis.serviceDate,basis.projectionId,
  basis.authorityRevision,basis.lunchDocumentIdentity,basis.printDocumentDigest];
 const result=await input.runRpc('static_weekly_coverall_event_brief_candidates',args);
 const row=object(result)&&Object.hasOwn(result,'result')?result.result:result;
 if(!object(row)||row.schema!=='custodial.coverall-event-brief-list.v1'
  ||row.disclosure_approved!==false||!Array.isArray(row.candidates)
  ||Buffer.byteLength(JSON.stringify(row),'utf8')>140000)
  fail('coverall_event_list_invalid');
 if(row.status!=='PREVIEW_ONLY'){
  const limit=row.status==='LIMIT_EXCEEDED';
  if(!['STALE_PRINT_BASIS','CAPACITY_NOT_ACCEPTED','LIMIT_EXCEEDED'].includes(row.status)
   ||row.candidates.length!==0
   ||Object.keys(row).sort().join('|')!==
     (limit?['schema','status','limit_reason','disclosure_approved','candidates']:
      ['schema','status','disclosure_approved','candidates']).sort().join('|')
   ||(limit&&!['same_day_scan','eligible_count_or_size'].includes(row.limit_reason)))
   fail('coverall_event_list_invalid');
  return {schema:row.schema,status:row.status,disclosureApproved:false,
   limited:limit,reason:limit?row.limit_reason:null,previews:[]};
 }
 if(Object.keys(row).some(key=>!LIST_FIELDS.has(key))||Object.keys(row).length!==LIST_FIELDS.size
  ||!same(row.manager_id,input.manager.managerId)||!same(row.capacity_slot_id,input.capacitySlotId)
  ||row.service_date!==basis.serviceDate||!same(row.projection_id,basis.projectionId)
  ||!same(row.publication_id,basis.publicationId)
  ||row.projection_replay_digest!==basis.projectionReplayDigest
  ||Number(row.authority_revision)!==basis.authorityRevision
  ||row.lunch_document_identity!==basis.lunchDocumentIdentity
  ||row.print_document_digest!==basis.printDocumentDigest
  ||row.candidate_limit!==16||row.scan_limit!==32||row.candidates.length>16)
  fail('coverall_event_list_invalid');
 const seen=new Set();
 const previews=row.candidates.flatMap(candidateRow=>{
  if(!object(candidateRow)||candidateRow.status!=='PREVIEW_ONLY'
   ||!UUID.test(candidateRow.event_id)||!Number.isSafeInteger(candidateRow.event_revision)
   ||candidateRow.event_revision<1||seen.has(candidateRow.event_id))
   fail('coverall_event_list_invalid');
  seen.add(candidateRow.event_id);
  let candidate;
  try{
   candidate=validateCandidate(candidateRow,{managerId:input.manager.managerId,
    eventId:candidateRow.event_id,eventRevision:candidateRow.event_revision,
    capacitySlotId:input.capacitySlotId,basis});
  }catch(error){
   // The database knows current accepted group/physical ownership. Only the
   // trusted print document can narrow that to the exact handout periods.
   if(error?.code==='coverall_event_no_exact_accepted_period')return [];
   throw error;
  }
  return [previewFrom(candidate,input)];
 });
 return {schema:row.schema,status:'PREVIEW_ONLY',disclosureApproved:false,
  limited:false,previews};
}

export async function confirmCoverAllEventBrief(input){
 const {preview,confirmation}=input;
 if(!object(preview)||preview.status!=='PREVIEW_ONLY'||!object(confirmation)
  ||confirmation.decision!=='CONFIRM_FOR_COVERALL_PRINT'||!same(confirmation.managerId,input.manager?.managerId)
  ||!same(confirmation.capacitySlotId,input.capacitySlotId)||!same(confirmation.eventId,input.eventId)
  ||confirmation.eventRevision!==input.eventRevision||confirmation.digest!==preview.digest
  ||!SHA.test(preview.digest)||!same(preview.managerId,input.manager?.managerId)
  ||!same(preview.capacitySlotId,input.capacitySlotId)||!same(preview.eventId,input.eventId)
  ||preview.eventRevision!==input.eventRevision||!object(preview.candidate)
  ||preview.serviceDate!==input.printDocument?.serviceDate
  ||preview.printDocumentDigest!==input.printDocument?.documentDigest
  ||sha(canonicalJson(preview.candidate))!==preview.digest)
  fail('coverall_event_explicit_confirmation_required');
 const {candidate}=await readCandidate(input);
 if(!candidate||sha(canonicalJson(candidate))!==preview.digest)
  fail('coverall_event_source_changed_repreview_required');
 return confirmedFrom(candidate,input,preview.digest);
}

// Call immediately before returning copy/PDF bytes; accepted source can change
// after a preview or while a renderer works. This remains a source check, not
// a promise of an atomic event/schedule/provider transaction after return.
export async function revalidateConfirmedCoverAllEventBrief(input){
 const confirmed=input.confirmed;
 if(!object(confirmed)||confirmed.schema!=='custodial.coverall-event-brief-confirmed.v1'
  ||confirmed.status!=='CONFIRMED_FOR_EXACT_PRINT'||!SHA.test(confirmed.candidateDigest)
  ||!same(confirmed.managerId,input.manager?.managerId)
  ||!same(confirmed.capacitySlotId,input.capacitySlotId)||!same(confirmed.eventId,input.eventId)
  ||confirmed.eventRevision!==input.eventRevision
  ||confirmed.printDocumentDigest!==input.printDocument?.documentDigest)
  fail('coverall_event_confirmation_invalid');
 const {candidate}=await readCandidate(input);
 if(!candidate||sha(canonicalJson(candidate))!==confirmed.candidateDigest)
  fail('coverall_event_source_changed_repreview_required');
 return confirmedFrom(candidate,input,confirmed.candidateDigest);
}
