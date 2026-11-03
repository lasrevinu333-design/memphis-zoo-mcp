import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {deliverNativeEventJob} from '../../src/native-event-dispatch.js';
import {buildEmployeeEventReminderBody} from '../../src/employee-notifications.js';
import {buildEventStaticAuthoritySource,seedCompiledEventAuthority} from './event-static-authority-fixture.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const q=x=>`'${String(typeof x==='object'?JSON.stringify(x):x).replaceAll("'","''")}'`;
export async function proveQualifiedEventSql({sql,one,call,db,check,checkpoint,inventory,decisions,eventCall,register,employee,device,credential,container}){
 assert.match(container,/^mz_schema_rebuild_overnight_alert_[a-f0-9]{16}$/);
 const location=randomUUID(),group=randomUUID(),slot=randomUUID();
 // The owning claim requires scheduled_for <= NOW, not merely a future Event.
 // Tomorrow's Event has an already-due two-days-before reminder. Never move
 // the production clock, weaken that guard, or force-send the future fixture.
 const dates=await one("select jsonb_build_object('week',date_trunc('week',public.sch_service_date(now())::timestamp)::date,'event',public.sch_service_date(now())+1) as v");
 await sql(`insert into public.locations(id,location_code,location_name,location_type,form_type,active) values(${q(location)},'ALERT_SQL_LOC','Synthetic alert location','restroom','restroom',true);
  insert into public.location_groups(id,group_code,group_name,active) values(${q(group)},'ALERT_SQL_GROUP','Synthetic alert group',true);
  insert into public.location_group_memberships(location_id,location_group_id,active) values(${q(location)},${q(group)},true);`);
 const source=buildEventStaticAuthoritySource({weekStart:dates.week,employees:[{id:employee,slotId:slot,displayName:'Synthetic Message recipient'}],locationId:location,locationCode:'ALERT_SQL_GROUP',locationName:'Synthetic alert group',label:'qualified-event-sql'});
 const fixtureSql=async statement=>{await sql('reset role');const r=await sql(statement);const value=r.rows[0]&&Object.values(r.rows[0])[0];return value==null?'':typeof value==='object'?JSON.stringify(value):String(value);};
 checkpoint('EVENT_REAL_STATIC_FIXTURE_BEGIN');
 const authority=await seedCompiledEventAuthority({sql:fixtureSql,container,managerId:'00000000-0000-4000-8000-000000000001',dates:[dates.week,dates.event],source,label:'qualified-event-sql',mode:'official'});
 await sql('reset role');
 check('Event SQL fixture has a real accepted publication',typeof authority.publicationId,'string');
 check('Event SQL fixture has independently verified dated projection',authority.compiledByWeek[dates.week].verifier.ok,true);
 const registrationId=await one(`select registration_id as v from public.employee_native_push_generations where generation_id=${q(register.generation_id)}`);
 async function makeEventJob(){
  const event=randomUUID(),instance=randomUUID(),jobId=randomUUID(),lease=randomUUID();
  await sql(`insert into public.events_app_events(id,event_name,location_group_id,event_scope,primary_venue_id,venue_ids,display_location,event_date,end_date,start_time,end_time,start_instant_utc,end_instant_utc,status,needs_review,audience_scope,notes,custodial_note_codes,custodial_public_notes)
   select ${q(event)},'Synthetic qualified Event',v.location_group_id,'SINGLE_VENUE',v.id,array[v.id],v.display_name,${q(dates.event)}::date,${q(dates.event)}::date,'10:00','11:00',(${q(dates.event)}::date+'10:00'::time) at time zone 'America/Chicago',(${q(dates.event)}::date+'11:00'::time) at time zone 'America/Chicago','SCHEDULED',false,'all_working_employees','PRIVATE_EVENT_NOTE_NEVER_SEND',array['trash_boxes'],'Eight trash boxes requested.' from public.event_venues v where v.venue_code='CAT_HOUSE_CAFE';`);
  const scheduled=await one(`select scheduled_for::text as v from public.mz_event_reminder_schedule(${q(event)},1,${q(employee)},'two_days_before')`);
  assert.ok(scheduled,'actual accepted staffing must permit the exact reminder');
  check('Event fixture reminder is actually due before production claim',await one(`select ${q(scheduled)}::timestamptz<=clock_timestamp() as v`),true);
  const key=`event:${event}:1:${dates.event}:${employee}:${device}:1:two_days_before`;
  const payload={instance_id:instance,event_id:event,notification_key:key,notification_kind:'two_days_before',employee_id:employee,device_id:device,credential_id:credential,assignment_epoch:1};
  await sql(`insert into public.event_push_instances(instance_id,notification_key,event_id,event_revision,service_date,employee_id,device_id,credential_id,assignment_epoch,notification_kind,scheduled_for,state) values(${q(instance)},${q(key)},${q(event)},1,${q(dates.event)},${q(employee)},${q(device)},${q(credential)},1,'two_days_before',${q(scheduled)},'pending');
   insert into public.operational_notification_jobs(job_id,job_key,job_type,source_id,status,leased_at,leased_until,lease_token,payload_json) values(${q(jobId)},${q('employee-event-push:'+key)},'employee_event_push',${q(instance)},'leased',now(),now()+interval '2 minutes',${q(lease)},${q(payload)});`);
  return await one(`select to_jsonb(j) as v from public.operational_notification_jobs j where job_id=${q(jobId)}`);
 }
 let sends=0,wire;
 const observedDb={async rpc(name,args){
  const result=await db.rpc(name,args),v=result.data;
  checkpoint('EVENT_RPC',{name,error:Boolean(result.error),current:v?.current??null,dispatch_authorized:v?.dispatch_authorized??null,reason:v?.reason??null,
   keys:v&&typeof v==='object'?Object.keys(v).sort():[],source_projection_keys:v?.source_projection?Object.keys(v.source_projection).sort():[],
   preparation_identity_matches:v?.source_projection?{instance:v.source_projection.instance_id===first.source_id,canonical_key:v.source_projection.notification_key===`event:${v.source_projection.event_id}:${v.source_projection.event_revision}:${v.source_projection.service_date}:${v.expected?.employee_id}:${v.expected?.device_uuid}:${v.expected?.assignment_epoch}:${v.source_projection.notification_kind}`}:null});
  return result;
 }};
 const pushRuntime={async prepareNativeEventSender(){return async({permit})=>{sends++;wire=permit.reservation.payload;return{outcome:'provider_accepted',provider_message_id:'projects/synthetic-zoo/messages/event-original',error_code:null};};}};
 const first=await makeEventJob();
 const result=await deliverNativeEventJob({db:observedDb,pushRuntime,job:first,eventBody:p=>buildEmployeeEventReminderBody(p,p.employee_name)});
 check('real EVENT SQL plus actual producer sends once only to fake provider',sends,1);
 check('new EVENT finalization is not replay',result.replayed,false);
 check('EVENT source identity',[wire.event_id,wire.instance_id],[first.payload_json.event_id,first.source_id]);
 check('EVENT closed native schema',wire.schema,'custodial.native-event-payload.v1');
 check('EVENT body uses actual public formatter',wire.body.includes('Eight trash boxes requested.'),true);
 check('EVENT excludes private manager notes',JSON.stringify(wire).includes('PRIVATE_EVENT_NOTE_NEVER_SEND'),false);
 check('EVENT exact canonical key',wire.notification_key,first.payload_json.notification_key);
 check('EVENT native receipt has current registration',await one(`select expected->>'registration_id' as v from public.employee_native_alert_preparations where job_id=${q(first.job_id)}`),registrationId);
 const replay=await deliverNativeEventJob({db,pushRuntime,job:first,eventBody:p=>buildEmployeeEventReminderBody(p,p.employee_name)});
 check('EVENT accepted receipt replay cannot send again',[replay.replayed,sends],[true,1]);
 const request={schema:'custodial.native-provider-inventory-request.v1',scan_id:randomUUID(),device_id:'KIOSK_08',credential_id:credential,employee_id:employee,assignment_epoch:1,principal_digest:register.principal_digest,generation_ids:[register.generation_id],limit:32,cursor:null,ceiling:null,server_now:null};
 check('EVENT original finalized bytes appear in current inventory',JSON.stringify(await inventory(request)).includes(wire.content_sha256),true);
 const observation={earliest_at:wire.reservation_at,latest_at:wire.reservation_at,clock_profile_id:'SYNTHETIC_ONLY_NOT_QUALIFIED',elapsed_realtime_ms:1,boot_count:1};
 const received={schema:'custodial.native-provider-event.v2',event_id:randomUUID(),record_id:sha(wire.generation_id+'\n'+wire.receipt_job_id+'\n'+wire.notification_key),action:'received',...Object.fromEntries(['generation_id','content_sha256','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id','receipt_device_id','principal_digest','token_digest'].map(k=>[k,wire[k]])),receipt_assignment_epoch:1,admission_bounds:observation,original_observation:observation};
 check('EVENT actual receive lookup accepts finalized tuple',(await eventCall([received])).data.results[0].admitted_state,'ACCEPTED');
 check('EVENT original lookup resolves accepted tuple',(await decisions([received])).data.results[0].decision,'ORIGINAL_ACCEPTED');
 check('EVENT crossed bytes do not resolve original',(await decisions([{...received,content_sha256:'f'.repeat(64)}])).data.results[0].decision,'UNRESOLVED');
 const original=await one(`select to_jsonb(r) as v from public.employee_native_alert_finalizations r where job_id=${q(first.job_id)}`);
 await assert.rejects(()=>sql(`update public.events_app_events set status='CANCELLED',cancelled_at=now() where id=${q(first.payload_json.event_id)}`),e=>e.code==='42501'&&/revision-bound named manager/.test(e.message));
 check('raw Event cancellation remains denied even in isolated fixture',true,true);
 async function cancelEvent(event){
  const revision=await one(`select revision as v from public.events_app_events where id=${q(event)}`);
  const result=await call('app_transition_event_cancellation',{p_event_id:event,p_action:'cancel',p_expected_revision:revision,p_operation_id:randomUUID(),p_manager_id:'00000000-0000-4000-8000-000000000001',p_reason:'Isolated qualified alert cancellation proof'});
  check('Event cancellation uses real revision-bound named manager',[result.event.id,result.event.status,result.event.revision],[event,'CANCELLED',revision+1]);
 }
 await cancelEvent(first.payload_json.event_id);
 check('cancelled EVENT disappears from fresh inventory',JSON.stringify(await inventory({...request,scan_id:randomUUID()})).includes(wire.content_sha256),false);
 check('cancelled EVENT leaves immutable original receipt',await one(`select to_jsonb(r) as v from public.employee_native_alert_finalizations r where job_id=${q(first.job_id)}`),original);
 check('cancelled EVENT retains exact original observation',(await decisions([received])).data.results[0].decision,'ORIGINAL_ACCEPTED');
 const second=await makeEventJob();const target=await call('custodial_native_alert_target',{p_job:second.job_id,p_lease:second.lease_token});
 const prep=await call('custodial_native_alert_prepare',{p_job:second.job_id,p_lease:second.lease_token,p_expected:target.expected});
 check('EVENT prepare does not authorize delivery',prep.dispatch_authorized,false);
 await cancelEvent(second.payload_json.event_id);
 const {buildNativeAlertCandidate}=await import('../../src/native-alert-two-stage.js');
 const final=await call('custodial_native_alert_finalize',{p_job:second.job_id,p_lease:second.lease_token,p_prepared:prep.prepared_id,p_expected:target.expected,p_candidate:buildNativeAlertCandidate(prep,{eventBody:p=>buildEmployeeEventReminderBody(p,p.employee_name)})});
 check('EVENT cancellation between stages refuses delivery',final.dispatch_authorized,false);
 check('refused EVENT finalize creates no receipt',await one(`select count(*)::int as v from public.employee_native_alert_finalizations where job_id=${q(second.job_id)}`),0);
 check('EVENT cancelled preparation never invokes provider',sends,1);
 checkpoint('EVENT_REAL_SQL_PASS',{actual_sql:true,provider_delivery:false,physical:false,staff_fixture:'single synthetic employee, actual accepted static publication/projection'});
}
