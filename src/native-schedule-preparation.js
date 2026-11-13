import {readNativeTargetSource} from './native-target-source.js';
import {assertNativeScheduleRequest,deriveNativeScheduleOccurrence,NATIVE_SCHEDULE_SOURCE_LIMITS,
 unavailableNativeScheduleSource} from './native-schedule-occurrence.js';

// Existing custodial_application_reader only; no table access, DDL, caller SQL,
// clock or new permission. A single statement uses a single MVCC snapshot.
// Recipient checks use the separate, existing service-only RPC capability.
export function nativeScheduleSnapshotSql(serviceDate){
 assertNativeScheduleRequest({serviceDate,sourceKey:'00000000-0000-0000-0000-000000000001',
  employeeId:'00000000-0000-0000-0000-000000000002',generationId:'00000000-0000-0000-0000-000000000003'});
 const day="'"+serviceDate+"'::date",limit=NATIVE_SCHEDULE_SOURCE_LIMITS.rows+1;
 return `select jsonb_build_object('schema','custodial.native-schedule-read.v1',
 'authority',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (
  select service_date,governed,authority_source,projection_status,version_id,publication_id,projection_id,
   projection_authority_revision::text from public.static_weekly_v6_schedule_authority_state(${day}) limit 2) r),
 'segments',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (
  select service_date,projection_status,version_id,publication_id,projection_id,segment_id,location_group_id,
   included_location_ids,owner_type,assigned_employee_id,coverage_start,coverage_end,status,source_type,service_mode,governed
  from public.static_weekly_v6_read_schedule_segments(${day}) limit ${limit}) r),
 'physical',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (
  select service_date,projection_status,version_id,publication_id,projection_id,occurrence_id,location_group_id,location_id,
   assigned_employee_id,coverage_start::text,coverage_end::text,assignment_status,authority_source
  from public.custodial_operational_location_assignments(${day}) limit ${limit}) r),
 'lunch',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (
  select projection_id,loan_id,responsibility_id,normal_occurrence_id,normal_owner_id,coverer_id,location_group_id,
   included_location_ids,included_snapshots='[]'::jsonb as included_snapshots_empty,
   service_mode,coverage_start::text,coverage_end::text
  from public.static_weekly_v8_read_lunch_segments(${day}) limit ${limit}) r)) as data`;
}

export async function prepareNativeScheduleOccurrence({runReadOnlySql,runRpc,sourceKey,employeeId,generationId,serviceDate}){
 const request={sourceKey,employeeId,generationId,serviceDate};assertNativeScheduleRequest(request);
 if(typeof runReadOnlySql!=='function'||typeof runRpc!=='function')throw Object.assign(new Error('REQUEST_INVALID'),{code:'REQUEST_INVALID'});
 try{
  const read=()=>readNativeTargetSource({runRpc,kind:'SCHEDULE',sourceKey,employeeId,generationId});
  const targetBefore=structuredClone(await read());
  if(targetBefore.status!=='SOURCE_ONLY_POLICY_MISSING')return unavailableNativeScheduleSource('TARGET_UNAVAILABLE');
  const result=await runReadOnlySql(nativeScheduleSnapshotSql(serviceDate));
  // Capture bytes before the next await; mutable transports cannot rewrite the
  // first observation into apparent agreement after rotation/publication.
  if(!Array.isArray(result)||result.length!==1||!result[0]||Object.keys(result[0]).join()!=='data')
   return unavailableNativeScheduleSource('SOURCE_SHAPE_INVALID');
  const snapshot=structuredClone(result[0].data),targetAfter=structuredClone(await read());
  return deriveNativeScheduleOccurrence({request,snapshot,targetBefore,targetAfter});
 }catch{return unavailableNativeScheduleSource('READ_UNAVAILABLE');}
}
