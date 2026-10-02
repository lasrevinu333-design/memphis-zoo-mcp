import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../src/static-weekly-schedule-model.js';
import {previewCoverAllEventBrief,confirmCoverAllEventBrief,
 revalidateConfirmedCoverAllEventBrief} from '../src/coverall-event-brief.js';

const ids={manager:'00000000-0000-4000-8000-000000000001',capacity:'00000000-0000-4000-8000-000000000002',
 event:'00000000-0000-4000-8000-000000000003',projection:'00000000-0000-4000-8000-000000000004',
 publication:'00000000-0000-4000-8000-000000000005',group:'00000000-0000-4000-8000-000000000006',
 physical:'00000000-0000-4000-8000-000000000007'};
const sha=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>sha(canonicalJson(value));
let checks=0;
const yes=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
const denied=async(name,operation,code)=>{await assert.rejects(operation,error=>error?.code===code,name);checks++;console.log('PASS',name);};
const document={schema:'custodial.coverall-accepted-print.v1',serviceDate:'2026-10-05',authorityRevision:17,
 publicationId:ids.publication,projectionId:ids.projection,replayDigest:'a'.repeat(64),
 lunchDocumentIdentity:'b'.repeat(64),contractors:[{slotId:ids.capacity,periods:[
  {start:'08:00',end:'09:00',areas:[{purpose:'area_owner',locations:[{id:ids.physical,name:'Accepted restroom'}]}]},
  {start:'09:00',end:'10:00',areas:[]},
  {start:'10:00',end:'11:00',areas:[{purpose:'lunch_coverage',locations:[{id:ids.physical,name:'Accepted restroom'}]}]},
 ]}]};
const printDocument={...document,documentDigest:digest(document)};
const row={schema:'custodial.coverall-event-brief-candidate.v1',status:'PREVIEW_ONLY',disclosure_approved:false,
 manager_id:ids.manager,capacity_slot_id:ids.capacity,service_date:document.serviceDate,
 projection_id:ids.projection,publication_id:ids.publication,authority_revision:17,
 projection_replay_digest:document.replayDigest,lunch_document_identity:document.lunchDocumentIdentity,
 print_document_digest:printDocument.documentDigest,event_id:ids.event,event_revision:3,
 event_name:'Evening event',display_location:'Event venue',event_date:document.serviceDate,
 start_instant_utc:'2026-10-06T00:00:00Z',end_instant_utc:'2026-10-06T01:00:00Z',
 start_time:'19:00:00',end_time:'20:00:00',custodial_note_codes:['trash_boxes'],
 custodial_public_notes:'Set extra trash boxes at the accepted location.',matched_areas:[
  {location_group_id:ids.group,group_name:'Accepted group',starts:'08:30',ends:'10:30',
   included_location_ids:[ids.physical],purpose:'area_owner'},
  {location_group_id:ids.group,group_name:'Accepted group',starts:'10:00',ends:'10:30',
   included_location_ids:[ids.physical],purpose:'lunch_coverage'},
 ]};
let current=structuredClone(row),calls=0;
const runRpc=async(name,args)=>{yes('exact private reader name',name,'static_weekly_coverall_event_brief_candidate');
 yes('exact named-manager and basis args',args,[ids.manager,ids.event,3,ids.capacity,document.serviceDate,
  ids.projection,17,document.lunchDocumentIdentity,printDocument.documentDigest]);calls++;return {result:structuredClone(current)};};
const input={runRpc,manager:{managerId:ids.manager,managerName:'Synthetic named manager'},
 eventId:ids.event,eventRevision:3,capacitySlotId:ids.capacity,printDocument};
const preview=await previewCoverAllEventBrief(input);
yes('preview-only never contractor disclosure',preview.disclosureApproved,false);
yes('event time may follow preparatory same-day work',preview.candidate.start_time,'19:00:00');
yes('only exact accepted ordinary interval survives',preview.candidate.matched_areas[0].ends,'09:00');
yes('exact accepted lunch interval remains separate',preview.candidate.matched_areas[1].starts,'10:00');
yes('no raw manager note or private source field',JSON.stringify(preview).includes('PRIVATE_MANAGER_NOTE'),false);
yes('no brief before explicit manager confirmation',Object.hasOwn(preview,'brief'),false);
const confirmation={decision:'CONFIRM_FOR_COVERALL_PRINT',managerId:ids.manager,capacitySlotId:ids.capacity,
 eventId:ids.event,eventRevision:3,digest:preview.digest};
const confirmed=await confirmCoverAllEventBrief({...input,preview,confirmation});
yes('explicit exact confirmation yields safe brief',confirmed.brief.custodialPublicNotes,row.custodial_public_notes);
yes('safe confirmed brief has no source notes',Object.hasOwn(confirmed.brief,'notes'),false);
yes('same source revalidates immediately before bytes',await revalidateConfirmedCoverAllEventBrief({...input,confirmed}),confirmed);
const forged={...confirmed,brief:{...confirmed.brief,custodialPublicNotes:'PRIVATE MANAGER SOURCE NOTE'}};
yes('revalidation reconstructs safe brief, never returns caller-forged content',
 (await revalidateConfirmedCoverAllEventBrief({...input,confirmed:forged})).brief.custodialPublicNotes,
 row.custodial_public_notes);
await denied('no implicit confirmation',()=>confirmCoverAllEventBrief({...input,preview,confirmation:{...confirmation,decision:'PRINT'}}),'coverall_event_explicit_confirmation_required');
await denied('foreign manager denied',()=>confirmCoverAllEventBrief({...input,preview,confirmation:{...confirmation,managerId:ids.event}}),'coverall_event_explicit_confirmation_required');
await denied('changed event revision denied',()=>confirmCoverAllEventBrief({...input,eventRevision:4,preview,confirmation}),'coverall_event_explicit_confirmation_required');
await denied('changed accepted print digest denied',()=>confirmCoverAllEventBrief({...input,printDocument:{...printDocument,documentDigest:'c'.repeat(64)},preview,confirmation}),'coverall_event_explicit_confirmation_required');
await denied('read-only manager denied',()=>previewCoverAllEventBrief({...input,manager:{...input.manager,read_only:true}}),'coverall_event_request_invalid');
current={...row,custodial_public_notes:'Now use a different safe instruction.'};
await denied('changed notes require re-preview before confirm',()=>confirmCoverAllEventBrief({...input,preview,confirmation}),'coverall_event_source_changed_repreview_required');
current=structuredClone(row);
const confirmedAgain=await confirmCoverAllEventBrief({...input,preview,confirmation});
current={...row,event_revision:4};
await denied('post-confirm revision change blocks release',()=>revalidateConfirmedCoverAllEventBrief({...input,confirmed:confirmedAgain}),'coverall_event_candidate_invalid');
current={...row,notes:'PRIVATE_MANAGER_NOTE'};
await denied('unexpected private field never accepted',()=>previewCoverAllEventBrief(input),'coverall_event_candidate_invalid');
current={...row,matched_areas:[{...row.matched_areas[0],included_location_ids:[ids.event]}]};
await denied('foreign physical cannot ride same group name',()=>previewCoverAllEventBrief(input),'coverall_event_no_exact_accepted_period');
current={...row,matched_areas:[{...row.matched_areas[0],starts:'09:00',ends:'10:00'}]};
await denied('unassigned accepted period not inferred',()=>previewCoverAllEventBrief(input),'coverall_event_no_exact_accepted_period');
current={schema:row.schema,status:'EVENT_NOT_CURRENT_OR_UNSCOPED',disclosure_approved:false};
yes('noncurrent event has no notes or brief',(await previewCoverAllEventBrief(input)).status,'UNAVAILABLE');
yes('read calls were actually exercised',calls>=9,true);
console.log(JSON.stringify({status:'PASS',checks,scope:'pure manager confirmation/source revalidation; SQL fixture separate'}));
