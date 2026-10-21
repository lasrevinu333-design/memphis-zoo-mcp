import {messageFixture,id,sha} from './native-message-dispatch-fixture.mjs';
import {prepareNativeEventDataSender} from '../../src/native-event-dispatch.js';
// Shares only the already-tested private ledger/RPC simulator. Event identity,
// source fields and the real Event sender are set explicitly and independently.
export function eventFixture(options={}){
 const f=messageFixture({...options,targetTransform:value=>{
  value.kind='EVENT';return options.targetTransform?options.targetTransform(value):value;
 }});
 const event=id(20),instance=id(21),kind='shift_plus_15',day='2026-10-04';
 const key=`event:${event}:7:${day}:${f.expected.employee_id}:${f.expected.device_uuid}:${f.expected.assignment_epoch}:${kind}`;
 Object.assign(f.job,{job_type:'employee_event_push',source_id:instance,job_key:'employee-event-push:'+key,payload_json:{
  instance_id:instance,notification_key:key,event_id:event,employee_id:f.expected.employee_id,
  device_id:f.expected.device_uuid,credential_id:f.expected.credential_id,assignment_epoch:2,notification_kind:kind,
 }});
 const projection={current:true,event_id:event,instance_id:instance,event_revision:7,service_date:day,notification_kind:kind,
  notification_key:key,employee_id:f.expected.employee_id,employee_name:'Synthetic Employee',event_name:'Synthetic Event',
  display_location:'Synthetic Pavilion',event_date:day,start_time:'10:30',end_time:'11:30',
  start_instant_utc:'2026-10-04T15:30:00Z',end_instant_utc:'2026-10-04T16:30:00Z',attendee_count:120,
  custodial_note_codes:['trash_boxes'],custodial_public_notes:'Eight trash boxes requested.',private_notes:'PRIVATE CATERING MUST NOT BE SPOKEN'};
 Object.assign(f.prepared,{kind:'EVENT',source_revision:sha(JSON.stringify(projection)),source_projection:projection});
 f.pushRuntime.prepareNativeEventSender=async()=>{
  f.calls.push({name:'OAUTH_SYNTHETIC'});if(options.oauth)await options.oauth(f.job);
  return options.sender||prepareNativeEventDataSender({projectId:'synthetic-zoo',accessToken:'synthetic-not-oauth',fetchImpl:async(url,init)=>{
   f.calls.push({name:'FCM_SYNTHETIC'});f.requests.push({url,init,body:JSON.parse(init.body)});
   return options.fetchImpl?options.fetchImpl(url,init):new Response(JSON.stringify({name:'projects/synthetic-zoo/messages/original'}));
  }});
 };
 f.eventBody=p=>`${p.employee_name}, ${p.event_name} at ${p.display_location}.`;
 return f;
}
