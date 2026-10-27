import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const container=process.env.CUSTODIAL_SYNTHETIC_EVENT_NOTIFY_DB;
assert.match(container??'',/^mz_schema_rebuild_[a-zA-Z0-9_]+$/);
const inspected=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspected.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspected.HostConfig.PortBindings??{}).length,0);
let checks=0;
function sql(input,{denied=false}={}){
  try{
    const output=execFileSync('docker',['exec','-e','PGPASSWORD=postgres','-i',container,'psql',
      '-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
      {input,encoding:'utf8',maxBuffer:4_000_000});
    if(denied)assert.fail(`SQL unexpectedly allowed: ${input}`);
    return output.trim().split('\n').filter(Boolean).at(-1);
  }catch(error){
    if(!denied)throw error;
    assert.match(String(error.stderr),/permission denied for function/);checks++;
  }
}
for(const role of ['anon','authenticated','custodial_application_reader']){
  for(const statement of [
    'public.mz_employee_event_push_current_projection(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1)',
    'public.app_event_manager_digest_candidate(gen_random_uuid(),now())',
    "public.app_event_manager_digest_is_current('{}'::jsonb,now())",
  ])sql(`set role ${role};select ${statement};`,{denied:true});
}
assert.equal(sql(`set role service_role;select public.mz_employee_event_push_current_projection(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1)->>'current';`),'false');checks++;
assert.equal(sql(`set role service_role;select public.app_event_manager_digest_is_current('{}'::jsonb,now());`),'f');checks++;

const fixture=`begin;
  insert into public.events_app_events(event_name,location_group_id,event_scope,primary_venue_id,venue_ids,
    display_location,event_date,end_date,start_time,end_time,start_instant_utc,end_instant_utc,
    status,needs_review,notes,custodial_public_notes)
  select 'SYNTH_EVENT_NOTIFY_CURRENT',v.location_group_id,'SINGLE_VENUE',v.id,array[v.id],
    v.display_name,d.d,d.d,'10:00','11:00',(d.d+'10:00'::time) at time zone 'America/Chicago',
    (d.d+'11:00'::time) at time zone 'America/Chicago','SCHEDULED',false,
    'PRIVATE_MANAGER_SOURCE_DO_NOT_SEND','Approved custodial preparation'
  from public.event_venues v cross join lateral
    (select (now() at time zone 'America/Chicago')::date+20 d) d
  where v.venue_code='CAT_HOUSE_CAFE';
  do $proof$ declare v_event public.events_app_events%rowtype;v_payload jsonb;begin
    select * into strict v_event from public.events_app_events where event_name='SYNTH_EVENT_NOTIFY_CURRENT';
    if (select count(*) from public.app_event_manager_digest_candidate(v_event.id,now()))<>1 then
      raise exception 'current resolved event missing digest candidate';end if;
    v_payload:=jsonb_build_object('next_event_id',v_event.id,
      'next_event_revision',v_event.revision,'next_event_starts_at',v_event.start_instant_utc,
      'next_event_display_location',v_event.display_location);
    if public.app_event_manager_digest_is_current(v_payload,now()) is not true then
      raise exception 'exact current digest payload rejected';end if;
    if public.app_event_manager_digest_is_current(v_payload-'next_event_revision',now()) is not false
      or public.app_event_manager_digest_is_current(v_payload||jsonb_build_object(
        'next_event_revision',v_event.revision+1),now()) is not false
      or public.app_event_manager_digest_is_current(v_payload||jsonb_build_object(
        'next_event_display_location','stale venue display'),now()) is not false then
      raise exception 'old or stale digest payload accepted';end if;
    if public.app_event_manager_digest_is_current(v_payload,v_event.start_instant_utc) is not false then
      raise exception 'elapsed event remains digest eligible';end if;
    update public.event_venues set active=false where id=v_event.primary_venue_id;
    if public.app_event_manager_digest_is_current(v_payload,now()) is not false then
      raise exception 'inactive Place/legacy venue remains digest eligible';end if;
    if (select count(*) from public.app_event_manager_digest_candidate(v_event.id,now()))<>0 then
      raise exception 'inactive venue retained candidate';end if;
  end $proof$;
  select 'CURRENT_REVISION_DRIFT_EXPIRY_PASS';rollback;`;
assert.equal(sql(fixture),'CURRENT_REVISION_DRIFT_EXPIRY_PASS');checks+=6;

const identities=[
  'mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)',
  'app_event_manager_digest_candidate(uuid,timestamp with time zone)',
  'app_event_manager_digest_is_current(jsonb,timestamp with time zone)',
  'ops_manager_enqueue_scheduled_notifications(timestamp with time zone)',
  'ops_manager_claim_notification_jobs(text,integer,integer)',
  'ops_manager_notification_job_is_current(uuid,uuid,uuid,text)',
  'ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)',
];
for(const identity of identities){
  assert.equal(sql(`select i.definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(
    ('public.${identity}')::regprocedure)) from public.custodial_release_authority_restore_inventory i
    where i.object_kind='function' and i.object_identity='${identity}';`),'t',identity);checks++;
}
for(const identity of [
  'ops_manager_enqueue_scheduled_notifications(timestamp with time zone)',
  'ops_manager_claim_notification_jobs(text,integer,integer)',
  'ops_manager_notification_job_is_current(uuid,uuid,uuid,text)',
  'ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)',
]){
  assert.equal(sql(`select position('app_event_manager_digest_is_current' in pg_get_functiondef(
    'public.${identity}'::regprocedure))>0 or position('app_event_manager_digest_candidate'
    in pg_get_functiondef('public.${identity}'::regprocedure))>0;`),'t',identity);checks++;
}
console.log('EVENT_NOTIFICATION_CURRENT_PROJECTION_DB_PASS',JSON.stringify({checks,
  disposable_container:container,network:false,provider:false,production:false}));
