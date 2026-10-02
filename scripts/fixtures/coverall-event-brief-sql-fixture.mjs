// Run only inside the caller's disposable, complete no-default-grants replay
// after an official accepted manual CoverAll projection exists. This helper
// does not create a database/container, execute a full replay, or send output.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const q=value=>`'${String(value).replaceAll("'","''")}'`;
const result=sql=>sql.trim().split('\n').filter(Boolean).at(-1)||'';

export function verifyCoverAllEventBriefSqlFixture({sql,managerId,printDocument,areas,capacitySlotId}){
 assert.equal(printDocument.schema,'custodial.coverall-accepted-print.v1');
 const capacity=printDocument.contractors.find(c=>c.slotId===capacitySlotId);
 assert.ok(capacity,'accepted capacity required');
 const physical=capacity.periods.flatMap(p=>p.areas.flatMap(a=>a.locations)).at(0)?.id;
 const area=areas.find(a=>a.physical===physical);
 assert.ok(area?.group,'accepted physical/group assignment required');
 const venue=randomUUID(),event=randomUUID(),code=`CV${venue.replaceAll('-','').slice(0,12)}`;
 const read=(revision=1,slot=capacitySlotId,date=printDocument.serviceDate)=>JSON.parse(result(sql(`
  set role static_weekly_control_plane;
  select public.static_weekly_coverall_event_brief_candidate(
   ${q(managerId)}::uuid,${q(event)}::uuid,${revision},${q(slot)}::uuid,
   ${q(date)}::date,${q(printDocument.projectionId)}::uuid,${printDocument.authorityRevision},
   ${q(printDocument.lunchDocumentIdentity)},${q(printDocument.documentDigest)})::text;`)));
 const list=(slot=capacitySlotId,date=printDocument.serviceDate)=>JSON.parse(result(sql(`
  set role static_weekly_control_plane;
  select public.static_weekly_coverall_event_brief_candidates(
   ${q(managerId)}::uuid,${q(slot)}::uuid,${q(date)}::date,
   ${q(printDocument.projectionId)}::uuid,${printDocument.authorityRevision},
   ${q(printDocument.lunchDocumentIdentity)},${q(printDocument.documentDigest)})::text;`)));
 const empty=list();
 assert.equal(empty.status,'PREVIEW_ONLY');
 assert.deepEqual(empty.candidates,[],'absence is an honest complete list');
 sql(`insert into public.event_venues(id,venue_code,display_name,event_scope,location_group_id,
    eligible_event_venue,active) values(${q(venue)}::uuid,${q(code)},
    'Synthetic Event venue only','SINGLE_VENUE',${q(area.group)}::uuid,true,true);
  insert into public.events_app_events(id,event_name,location_group_id,event_scope,primary_venue_id,
    venue_ids,display_location,coverage_location_ids,event_date,end_date,start_time,end_time,
    start_instant_utc,end_instant_utc,status,needs_review,audience_scope,notes,
    custodial_note_codes,custodial_public_notes)
  values(${q(event)}::uuid,'Synthetic evening event',${q(area.group)}::uuid,'SINGLE_VENUE',
   ${q(venue)}::uuid,array[${q(venue)}::uuid],'Synthetic Event venue only',
   array[${q(area.group)}::uuid],${q(printDocument.serviceDate)}::date,
   ${q(printDocument.serviceDate)}::date,'19:00','20:00',
   (${q(printDocument.serviceDate)}::date+'19:00'::time) at time zone 'America/Chicago',
   (${q(printDocument.serviceDate)}::date+'20:00'::time) at time zone 'America/Chicago',
   'SCHEDULED',false,'all_working_employees','PRIVATE MANAGER SOURCE NOTE',
   array['trash_boxes']::text[],'Set extra trash boxes at the accepted location.');`);
 const candidate=read();
 assert.equal(candidate.status,'PREVIEW_ONLY',JSON.stringify(candidate));
 assert.equal(candidate.disclosure_approved,false);
 assert.equal(candidate.manager_id,managerId);
 assert.equal(candidate.capacity_slot_id,capacitySlotId);
 assert.equal(candidate.event_id,event);
 assert.equal(candidate.event_revision,1);
 assert.equal(candidate.service_date,printDocument.serviceDate);
 assert.equal(candidate.projection_id,printDocument.projectionId);
 assert.equal(candidate.publication_id,printDocument.publicationId);
 assert.equal(candidate.print_document_digest,printDocument.documentDigest);
 assert.equal(candidate.projection_replay_digest,printDocument.replayDigest);
 assert.equal(candidate.lunch_document_identity,printDocument.lunchDocumentIdentity);
 assert.ok(candidate.matched_areas.some(a=>a.location_group_id===area.group
  &&a.included_location_ids.includes(physical)&&a.purpose==='area_owner'));
 assert.deepEqual(candidate.custodial_note_codes,['trash_boxes']);
 assert.equal(candidate.custodial_public_notes,'Set extra trash boxes at the accepted location.');
 assert.equal(JSON.stringify(candidate).includes('PRIVATE MANAGER SOURCE NOTE'),false);
 const listed=list();
 assert.equal(listed.status,'PREVIEW_ONLY',JSON.stringify(listed));
 assert.equal(listed.candidates.length,1);
 assert.equal(listed.publication_id,printDocument.publicationId);
 assert.equal(listed.projection_replay_digest,printDocument.replayDigest);
 assert.deepEqual(listed.candidates[0],candidate,'discovery calls exact same classified reader');
 assert.equal(JSON.stringify(listed).includes('PRIVATE MANAGER SOURCE NOTE'),false);
 assert.equal(list(capacitySlotId,'1900-01-01').status,'STALE_PRINT_BASIS');
 assert.equal(list(randomUUID()).status,'CAPACITY_NOT_ACCEPTED');
 assert.equal(read(2).status,'EVENT_NOT_CURRENT_OR_UNSCOPED');
 assert.equal(read(1,randomUUID()).status,'CAPACITY_NOT_ACCEPTED');
 assert.equal(read(1,capacitySlotId,'1900-01-01').status,'STALE_PRINT_BASIS');
 const addEvents=count=>sql(`insert into public.events_app_events(id,event_name,location_group_id,
  event_scope,primary_venue_id,venue_ids,display_location,coverage_location_ids,
  event_date,end_date,start_time,end_time,start_instant_utc,end_instant_utc,
  status,needs_review,audience_scope,custodial_note_codes,custodial_public_notes)
  select gen_random_uuid(),'Synthetic bounded list '||i,${q(area.group)}::uuid,
   'SINGLE_VENUE',${q(venue)}::uuid,array[${q(venue)}::uuid],
   'Synthetic Event venue only',array[${q(area.group)}::uuid],
   ${q(printDocument.serviceDate)}::date,${q(printDocument.serviceDate)}::date,
   '19:00','20:00',
   (${q(printDocument.serviceDate)}::date+'19:00'::time) at time zone 'America/Chicago',
   (${q(printDocument.serviceDate)}::date+'20:00'::time) at time zone 'America/Chicago',
   'SCHEDULED',false,'all_working_employees','{}'::text[],''
  from generate_series(1,${count}) i;`);
 addEvents(16);
 assert.equal(list().status,'LIMIT_EXCEEDED','17 eligible is never a truncated apparent complete list');
 assert.equal(list().limit_reason,'eligible_count_or_size');
 addEvents(16);
 assert.equal(list().status,'LIMIT_EXCEEDED','33 scheduled rows never cause unbounded discovery');
 assert.equal(list().limit_reason,'same_day_scan');
 for(const role of ['anon','authenticated','service_role','custodial_application_reader',
   'static_weekly_release_operator','static_weekly_runtime_20260823']){
  for(const [functionName,signature,args] of [
   ['static_weekly_coverall_event_brief_candidate',
    'uuid,uuid,integer,uuid,date,uuid,bigint,text,text',
    `${q(managerId)}::uuid,${q(event)}::uuid,1,${q(capacitySlotId)}::uuid,
     ${q(printDocument.serviceDate)}::date,${q(printDocument.projectionId)}::uuid,
     ${printDocument.authorityRevision},${q(printDocument.lunchDocumentIdentity)},
     ${q(printDocument.documentDigest)}`],
   ['static_weekly_coverall_event_brief_candidates','uuid,uuid,date,uuid,bigint,text,text',
    `${q(managerId)}::uuid,${q(capacitySlotId)}::uuid,${q(printDocument.serviceDate)}::date,
     ${q(printDocument.projectionId)}::uuid,${printDocument.authorityRevision},
     ${q(printDocument.lunchDocumentIdentity)},${q(printDocument.documentDigest)}`],
  ]){
   assert.equal(result(sql(`select has_function_privilege(${q(role)},
    ${q(`public.${functionName}(${signature})`)},'EXECUTE')::text;`)),'f',
    `${role} must not execute ${functionName}`);
   assert.throws(()=>sql(`set role ${role};select public.${functionName}(${args});`),error=>
     /permission denied/i.test(String(error?.stderr||error?.message||error)),
    `${role} actual ${functionName} execution must be denied`);
  }
 }
 assert.equal(result(sql(`select has_function_privilege('static_weekly_control_plane',
  'public.static_weekly_coverall_event_brief_candidate(uuid,uuid,integer,uuid,date,uuid,bigint,text,text)',
  'EXECUTE')::text;`)),'t');
 assert.equal(result(sql(`select has_function_privilege('static_weekly_control_plane',
  'public.static_weekly_coverall_event_brief_candidates(uuid,uuid,date,uuid,bigint,text,text)',
  'EXECUTE')::text;`)),'t');
 assert.equal(result(sql(`select count(*) from public.custodial_release_authority_restore_inventory
  where object_identity in(
   'public.static_weekly_coverall_event_brief_candidate(uuid,uuid,integer,uuid,date,uuid,bigint,text,text)',
   'public.static_weekly_coverall_event_brief_candidates(uuid,uuid,date,uuid,bigint,text,text)')
  and object_kind in ('function','grant');`)),'4');
 return {status:'PASS',eventId:event,capacitySlotId,scope:'disposable accepted current projection, same-day event, denied roles; no print issuance'};
}
