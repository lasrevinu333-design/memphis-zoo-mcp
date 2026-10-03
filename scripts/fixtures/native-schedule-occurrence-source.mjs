import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

export const SCHEDULE_SOURCE_FIXTURE_SHA256='882e5895d60338313b08f28ec327f2087468261749cdbac5dc7d78ac22e20469';
const hash=x=>createHash('sha256').update(x).digest('hex');
export const syntheticId=label=>{const h=hash('native-schedule-test:'+label);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;};
// Exact tracked raw pattern input -> simulated existing reader DTO -> actual JS
// adapter. NOT SQL execution, a publication receipt, an optimizer result, or a
// claim that the synthetic current projection/recipient exists in any database.
// No solver/model is invoked and no raw fixture contents are copied into logs.
export function nativeScheduleOccurrenceFixture(){
 const bytes=fs.readFileSync(new URL('./six-person-absence-source.json',import.meta.url));
 assert.equal(hash(bytes),SCHEDULE_SOURCE_FIXTURE_SHA256,'pinned raw source bytes changed');
 const source=JSON.parse(bytes).compilerInput,day='2026-10-05';
 const assignments=source.version.assignments.filter(a=>a.dayOfWeek===1);
 const owner=a=>source.slots.find(s=>s.id===a.ownerSlotId).incumbencies.find(i=>i.effectiveStart<=day&&(!i.effectiveEnd||i.effectiveEnd>=day)).personId;
 const anchor=assignments.find(a=>a.locationCodeSnapshot==='CHINA'&&a.window.end==='09:45');
 assert.ok(anchor);const employeeId=owner(anchor),sourceKey=syntheticId(anchor.workId);
 const a={service_date:day,governed:true,authority_source:'static_weekly_projection',projection_status:'current',
  version_id:source.version.id,publication_id:syntheticId('publication'),projection_id:syntheticId('projection'),projection_authority_revision:'1'};
 const binding={service_date:day,projection_status:'current',version_id:a.version_id,publication_id:a.publication_id,projection_id:a.projection_id};
 const segments=assignments.map(row=>({...binding,segment_id:syntheticId(row.workId),location_group_id:syntheticId(row.locationCodeSnapshot),
  included_location_ids:row.includedLocations.map(x=>x.locationId),owner_type:'EMPLOYEE',assigned_employee_id:owner(row),
  coverage_start:row.window.start,coverage_end:row.window.end,status:'ASSIGNED',source_type:'static_weekly_projection',service_mode:row.serviceMode,governed:true}));
 const physical=segments.filter(s=>s.service_mode==='scan_tracked').flatMap(s=>s.included_location_ids.map(location_id=>({...binding,
  occurrence_id:s.segment_id,location_group_id:s.location_group_id,location_id,assigned_employee_id:s.assigned_employee_id,
  coverage_start:s.coverage_start+':00',coverage_end:s.coverage_end+':00',assignment_status:'ASSIGNED',authority_source:'static_weekly_projection'})));
 const request={sourceKey,employeeId,generationId:syntheticId('generation'),serviceDate:day};
 const target={schema:'custodial.native-target-source.v1',kind:'SCHEDULE',source_key:sourceKey,status:'SOURCE_ONLY_POLICY_MISSING',delivery_admitted:false,
  recipient:{employee_id:employeeId,device_id:syntheticId('device'),device_identifier:'KIOSK_08',credential_id:syntheticId('credential'),assignment_epoch:1,
   generation_id:request.generationId,principal_digest:hash('synthetic-principal'),token_digest:hash('synthetic-token-digest-only')},
  source:{source_id:a.projection_id,source_revision:'1',source_digest:hash(JSON.stringify(anchor)),publication_id:a.publication_id,version_id:a.version_id,
   service_date:day,assignment_occurrence_id:sourceKey,delivery_occurrence_id:null,delivery_key:null,valid_from:null,valid_until:null}};
 const units=rows=>rows.filter(row=>owner(row)===employeeId).flatMap(row=>row.serviceMode==='scan_tracked'
  ?row.includedLocations.map(m=>'LOCATION:'+m.locationId):['DUTY:'+row.serviceMode+':'+syntheticId(row.locationCodeSnapshot)]).sort();
 return {request,snapshot:{schema:'custodial.native-schedule-read.v1',authority:[a],segments,physical,lunch:[]},target,
  raw_pattern_expected:{before:units(assignments.filter(row=>row.window.end==='09:45')),after:units(assignments.filter(row=>row.window.start==='09:45'))},
  provenance:{path:'scripts/fixtures/six-person-absence-source.json',sha256:SCHEDULE_SOURCE_FIXTURE_SHA256,
   assignment_count:assignments.length,source_fields_preserved:['ownerSlotId/incumbent','serviceMode','includedLocations','window'],
   synthetic_edges:['projection/publication','occurrence identity','recipient generation','no boundary lunch'],sql_executed:false,solver_executed:false}};
}
