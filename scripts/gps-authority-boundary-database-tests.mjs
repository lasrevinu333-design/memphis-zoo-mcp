import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const container=process.env.GPS_AUTHORITY_TEST_CONTAINER||'';
assert.match(container,/^mz_verified_visit_\d+$/,'disposable no-network test container required');
const sql=(query)=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:query,encoding:'utf8',maxBuffer:1024*1024}).trim();
const fail=(query,pattern)=>{try{sql(query);assert.fail('expected SQL rejection');}catch(error){assert.match(String(error.stderr||error.message),pattern);}};
const id={employee:'00000000-0000-4000-8000-00000000d801',device:'00000000-0000-4000-8000-00000000d802',location:'00000000-0000-4000-8000-00000000d803',group:'00000000-0000-4000-8000-00000000d804',near:'00000000-0000-4000-8000-00000000d805',away:'00000000-0000-4000-8000-00000000d806'};
sql(`
insert into public.employees(id,employee_code,display_name,active,role) values
('${id.employee}','GPSAUTH01','GPS Test Worker',true,'staff');
insert into public.locations(id,location_code,location_name,location_type,form_type,active) values ('${id.location}','GPSAUTH','GPS Test Location','exhibit','exhibit',true);
insert into public.devices(id,device_id,device_name,active,assigned_employee_id) values
('${id.device}','GPS_AUTH_DEVICE','GPS Test Phone',true,'${id.employee}');
insert into public.location_groups(id,group_code,group_name,active) values ('${id.group}','GPS_AUTH_GROUP','GPS Test Group',true);
insert into public.location_group_memberships(location_id,location_group_id,active) values ('${id.location}','${id.group}',true);
insert into public.location_group_proximity_settings(location_group_id,working_cluster,route_x,route_y,latitude,longitude,coordinate_source,active)
values ('${id.group}','gps-test',1,1,35.15,-90.05,'group_center',true);
insert into public.sessions(id,session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at) values
('${id.near}','gps-auth-near','gps-auth-near','${id.location}','${id.employee}','${id.device}','active',clock_timestamp()-interval '5 minutes');
`);
const call=(event,session,latitude,longitude,observed='clock_timestamp()')=>JSON.parse(sql(`
set role service_role;
select public.tool_evaluate_location_proximity_v2('GPSAUTH','GPS_AUTH_DEVICE',${latitude},${longitude},5,'${session}','${event}','${event}',${observed})::text;
`));
const missingTime=call('gps-no-time','gps-auth-near',35.15,-90.05,'null');
assert.equal(missingTime.result,'gps_timestamp_unavailable');assert.equal(missingTime.authoritative,false);
assert.equal(sql("select count(*) from public.scan_events where client_event_id='gps-no-time'"),'0','missing time writes no false-fresh event');
fail("set role service_role; select public.tool_evaluate_location_proximity_v2('GPSAUTH','GPS_AUTH_DEVICE',35.15,-90.05,5,'wrong-session','gps-wrong-session','gps-wrong-session',null);",/Session does not belong/);
const group=call('gps-group-only','gps-auth-near',35.15,-90.05);
assert.equal(group.result,'location_uncalibrated');assert.equal(group.authoritative,false);
assert.equal(group.authority_scope,'advisory_uncalibrated');
assert.equal(sql("select result||'|'||(payload_json->>'authoritative') from public.scan_events where client_event_id='gps-group-only'"),'location_uncalibrated|false');
sql(`insert into public.location_proximity_settings(location_id,latitude,longitude,coordinate_source,coordinate_confidence,active)
values ('${id.location}',35.15,-90.05,'google_pin','high',true);`);
const unsurveyed=call('gps-unsurveyed','gps-auth-near',35.15,-90.05);
assert.equal(unsurveyed.result,'location_uncalibrated');assert.equal(unsurveyed.authoritative,false);
sql(`update public.location_proximity_settings set coordinate_source='surveyed_test_point',coordinate_confidence='surveyed',authority_radius_m=80,authority_surveyed_at=clock_timestamp()+interval '1 day' where location_id='${id.location}';`);
const futureSurvey=call('gps-future-survey','gps-auth-near',35.15,-90.05);
assert.equal(futureSurvey.result,'location_uncalibrated');assert.equal(futureSurvey.authoritative,false,'future-dated calibration is not authority');
sql(`update public.location_proximity_settings set coordinate_source='surveyed_test_point',coordinate_confidence='surveyed',authority_radius_m=80,authority_surveyed_at=clock_timestamp() where location_id='${id.location}';`);
const near=call('gps-surveyed-near','gps-auth-near',35.15,-90.05);
assert.equal(near.result,'near');assert.equal(near.authoritative,true);
assert.equal(near.authority_scope,'surveyed_location_radius');assert.equal(Number(near.allowed_radius_m),80);
assert.equal(sql("select result||'|'||(payload_json->>'authoritative')||'|'||(payload_json->>'authority_scope') from public.scan_events where client_event_id='gps-surveyed-near'"),'near|true|surveyed_location_radius');
const replayConflict=call('gps-surveyed-near','gps-auth-near',35.1511,-90.05,`'${near.observed_at}'::timestamptz`);
assert.equal(replayConflict.result,'gps_duplicate_event');assert.equal(replayConflict.authoritative,false);
assert.equal(sql("select result||'|'||(payload_json->>'client_latitude') from public.scan_events where client_event_id='gps-surveyed-near'"),'near|35.15','same event ID cannot rewrite the original observation');
sql(`update public.sessions set status='pending_submit',ended_at=clock_timestamp(),duration_minutes=5,duration_display='5 min' where id='${id.near}';
update public.sessions set status='closed',completion_source='kiosk_form' where id='${id.near}';
insert into public.sessions(id,session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at)
values ('${id.away}','gps-auth-away','gps-auth-away','${id.location}','${id.employee}','${id.device}','active',clock_timestamp());`);
const away=call('gps-surveyed-away','gps-auth-away',35.1511,-90.05);
assert.equal(away.result,'away','explicit 80 m radius overrides historical 175 m global radius');assert.equal(away.authoritative,true);
assert.equal(sql("select result||'|'||(metadata_json->>'authoritative') from public.device_location_proximity_status where session_uuid='gps-auth-away'"),'away|true');
fail(`update public.location_proximity_settings set authority_radius_m=5001 where location_id='${id.location}';`,/location_proximity_authority_radius_bound/);
for(const role of ['anon','authenticated']){
 assert.equal(sql(`select has_table_privilege('${role}','public.location_proximity_settings','SELECT,INSERT,UPDATE,DELETE')`),'f');
 assert.equal(sql(`select has_function_privilege('${role}','public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)','EXECUTE')`),'f');
}
console.log('GPS_AUTHORITY_BOUNDARY_DATABASE_PASS',{missing_timestamp_rejected:true,group_advisory:true,unsurveyed_advisory:true,future_survey_advisory:true,surveyed_near:true,surveyed_away:true,duplicate_event_bound:true,default_grants_absent:true});
