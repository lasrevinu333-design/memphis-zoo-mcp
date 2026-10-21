import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const sha=b=>createHash('sha256').update(b).digest('hex');
const id=value=>{const h=sha('synthetic-dated-native-reader:'+value);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;};
const clone=x=>structuredClone(x);
export const DATED_READER_PINS=Object.freeze({
 'config/custodial-october-dated-plan-20261001.json':'9e9977c09ec264ba7bf0654df260849d487b8d2f5bf514087c6c660d1b2330d1',
 'supabase/migrations/20261001130750_october_bounded_dated_transition.sql':'2c260b0bf1e6cd5e119348ea8e442c71f074f389af9f851b0e7852ddfd894e20',
 'supabase/migrations/20261001152633_october_dated_consumer_corrections.sql':'6a15cf945b69429d5fe3243e0bf9112ef4940d104b6c3c6c71db6683c769eb0b',
 'supabase/migrations/20261001161831_october_dated_review_authority_corrections.sql':'0a6a72072e40a82f1a45b0b8b284e8970f68fcfdaa96b7ed143add547045d06f',
 'supabase/migrations/20261003140000_static_weekly_nonemployee_contractor_capacity.sql':'8ae8467900940a76b296030f630fbc610b7d21d619661a13d8caee32c4d8ddca',
});
export const EMPTY_NONPHYSICAL_SQL="included_location_ids,included_snapshots='[]'::jsonb as included_snapshots_empty";

// This is a simulated reader DTO, NOT a SQL execution or an admitted target.
// Exact plan values/members/intervals/OPEN rows are retained; publication, group,
// occurrence, generation and currentness edges are explicitly synthetic.
export function nativeScheduleDatedReaderFixture(serviceDate){
 for(const[path,expected]of Object.entries(DATED_READER_PINS))
  assert.equal(sha(fs.readFileSync(new URL('../../'+path,import.meta.url))),expected,'dated reader source pin: '+path);
 const plan=JSON.parse(fs.readFileSync(new URL('../../config/custodial-october-dated-plan-20261001.json',import.meta.url)));
 const day=plan.days.find(d=>d.serviceDate===serviceDate);assert.ok(day,'exact bounded Oct1–4 date');
 const authority={service_date:serviceDate,governed:true,authority_source:'static_weekly_projection',projection_status:'current',
  version_id:day.weeklyVersionId,publication_id:id('publication'),projection_id:id('projection'),projection_authority_revision:'1'};
 const binding={service_date:serviceDate,projection_status:'current',version_id:authority.version_id,
  publication_id:authority.publication_id,projection_id:authority.projection_id};
 const segments=day.assignments.map(a=>({...binding,segment_id:id(serviceDate+':'+a.planWorkId),location_group_id:id(a.workSnapshot.locationCodeSnapshot),
  included_location_ids:a.workSnapshot.includedLocations.map(x=>x.locationId),owner_type:a.status==='ASSIGNED'?'EMPLOYEE':'OPEN',
  assigned_employee_id:a.personId,coverage_start:a.window.start,coverage_end:a.window.end,status:a.status,
  source_type:'static_weekly_projection',service_mode:a.workSnapshot.serviceMode,governed:true}));
 const lunch=day.lunchLoans.flatMap(l=>l.responsibilities.flatMap(r=>r.segments.map(s=>{
  const assignment=day.assignments.find(a=>a.planWorkId===s.planWorkId);assert.ok(assignment);
  return {projection_id:authority.projection_id,loan_id:l.loanId,responsibility_id:r.responsibilityId,
   normal_occurrence_id:id(serviceDate+':'+s.planWorkId),normal_owner_id:l.normalOwnerPersonId,coverer_id:r.covererPersonId,
   location_group_id:id(assignment.workSnapshot.locationCodeSnapshot),included_location_ids:s.includedLocations.length?s.includedLocations.map(x=>x.locationId):null,
   included_snapshots:clone(s.includedLocations),service_mode:s.serviceMode,coverage_start:s.window.start+':00',coverage_end:s.window.end+':00'};
 })));
 const physical=segments.filter(s=>s.service_mode==='scan_tracked').flatMap(s=>s.included_location_ids.flatMap(location_id=>{
  const loans=lunch.filter(l=>l.normal_occurrence_id===s.segment_id&&l.included_location_ids?.includes(location_id));
  const cuts=[...new Set([s.coverage_start+':00',s.coverage_end+':00',...loans.flatMap(l=>[l.coverage_start,l.coverage_end])])].sort();
  return cuts.slice(0,-1).map((start,i)=>{const end=cuts[i+1],l=loans.find(l=>start>=l.coverage_start&&end<=l.coverage_end);
   return {...binding,occurrence_id:s.segment_id,location_group_id:s.location_group_id,location_id,
    assigned_employee_id:l?l.coverer_id:s.assigned_employee_id,coverage_start:start,coverage_end:end,assignment_status:s.status,
    authority_source:l?'static_weekly_lunch_coverage':'static_weekly_projection'};
  });
 }));
 const anchor=segments.find(s=>s.owner_type==='EMPLOYEE'&&s.coverage_end==='09:45');assert.ok(anchor);
 const request={serviceDate,sourceKey:anchor.segment_id,employeeId:anchor.assigned_employee_id,generationId:id('generation')};
 const target={schema:'custodial.native-target-source.v1',kind:'SCHEDULE',source_key:request.sourceKey,status:'SOURCE_ONLY_POLICY_MISSING',delivery_admitted:false,
  recipient:{employee_id:request.employeeId,device_id:id('device'),device_identifier:'KIOSK_08',credential_id:id('credential'),assignment_epoch:1,
   generation_id:request.generationId,principal_digest:sha('synthetic-principal'),token_digest:sha('synthetic-token-digest')},
  source:{source_id:authority.projection_id,source_revision:'1',source_digest:sha('synthetic-source'),publication_id:authority.publication_id,
   version_id:authority.version_id,service_date:serviceDate,assignment_occurrence_id:request.sourceKey,delivery_occurrence_id:null,delivery_key:null,valid_from:null,valid_until:null}};
 const raw={authority:[authority],segments,physical,lunch};
 const snapshotForSql=sql=>({schema:'custodial.native-schedule-read.v1',authority:clone(raw.authority),segments:clone(raw.segments),physical:clone(raw.physical),
  lunch:raw.lunch.map(l=>{const{included_snapshots,...row}=clone(l);
   // Explicit simulation of the pinned fixed query expression, never a SQL receipt.
   if(sql.includes(EMPTY_NONPHYSICAL_SQL))row.included_snapshots_empty=included_snapshots===null?null:Array.isArray(included_snapshots)&&included_snapshots.length===0;
   return row;
  })});
 const at=(row,before)=>before?row.coverage_start<'09:45'&&row.coverage_end>='09:45':row.coverage_start<='09:45'&&row.coverage_end>'09:45';
 const expectedUnits=before=>segments.filter(s=>at(s,before)).flatMap(s=>{
  const loan=lunch.find(l=>l.normal_occurrence_id===s.segment_id&&at({coverage_start:l.coverage_start.slice(0,5),coverage_end:l.coverage_end.slice(0,5)},before));
  if((loan?loan.coverer_id:s.assigned_employee_id)!==request.employeeId)return [];
  return s.service_mode==='scan_tracked'?s.included_location_ids.map(x=>'LOCATION:'+x):['DUTY:'+s.service_mode+':'+s.location_group_id];
 }).sort();
 const expected={before:expectedUnits(true),after:expectedUnits(false)};
 expected.changed=JSON.stringify(expected.before)!==JSON.stringify(expected.after);
 return {request,target,raw,snapshotForSql,expected,provenance:{source_pins:DATED_READER_PINS,plan_digest:plan.planDigest,
  sql_executed:false,solver_executed:false,target_synthetic:true,phone_delivery_state:plan.phoneDeliveryState,
  synthetic_edges:['current authority','publication/projection','occurrence/group UUIDs','recipient/generation','prospective dated-target response']}};
}
