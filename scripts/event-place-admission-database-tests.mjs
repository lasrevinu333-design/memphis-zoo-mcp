// Disposable, network-isolated actual PostgreSQL proof for Event adoption of the Place overlay.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const container=`mz_schema_rebuild_event_place_${process.pid}`;
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,...options});
const raw=(statement)=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d','postgres'],
  {input:'set client_min_messages=warning;\n'+statement,stdio:['pipe','pipe','pipe']});
const sql=(statement)=>raw(statement).trim().split('\n').at(-1);
const q=(value)=>`'${String(value).replaceAll("'","''")}'`;
const j=(value)=>`${q(JSON.stringify(value))}::jsonb`;
let checks=0,owned=false;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const rejects=(statement,pattern,label)=>{let error;try{raw(statement);}catch(caught){error=caught;}assert.ok(error,label);assert.match(String(error.stderr),pattern,label);checks++;};
function removeDefaults(){for(const owner of ['postgres','supabase_admin'])for(const scope of ['','in schema public'])raw(`alter default privileges for role ${owner} ${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner} ${scope} revoke all on sequences from public,anon,authenticated,service_role;`);}
const manager=randomUUID(),group=randomUUID(),venue=randomUUID(),place=randomUUID(),request=randomUUID();
try {
  docker(['image','inspect',image]);
  docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g',
    '-e','POSTGRES_PASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);
  owned=true;
  const info=JSON.parse(docker(['inspect',container]))[0];
  check(info.HostConfig.NetworkMode,'none','isolated network');
  check(Object.keys(info.HostConfig.PortBindings??{}).length,0,'no published ports');
  let ready=0;for(let i=0;i<120&&ready<5;i++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(resolve=>setTimeout(resolve,500));}
  check(ready,5,'PostgreSQL ready');removeDefaults();
  const migrations=readdirSync(path.join(root,'supabase/migrations')).filter(name=>name.endsWith('.sql')).sort();
  for(const [index,name] of migrations.entries()){
    try{raw(readFileSync(path.join(root,'supabase/migrations',name),'utf8'));}
    catch(error){throw new Error(`Migration ${name} failed: ${error.stderr||error.message}`);}
    const defaultCount=Number(sql("select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in(0,'public'::regnamespace) and d.defaclrole in('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in('r','S') and a.grantee in(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)"));
    if(defaultCount){assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(name));removeDefaults();}
    if((index+1)%40===0)console.log('APPLIED_EVENT_PLACE_MIGRATIONS',index+1);
  }
  console.log('EXACT_EVENT_PLACE_REPLAY_COMPLETE',migrations.length);
  raw(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
    values(${q(manager)}::uuid,'Synthetic Event Place Manager',array['CUSTODIAL_MANAGER','OPS_MANAGER'],true,false);
    insert into public.location_groups(id,group_code,group_name,active,eligible_event_venue)
    values(${q(group)}::uuid,'EVENT_PLACE_SYNTH','Synthetic Event Place',true,true);
    insert into public.event_venues(id,venue_code,display_name,event_scope,location_group_id,eligible_event_venue,active,aliases)
    values(${q(venue)}::uuid,'EVENT_PLACE_SYNTH','Synthetic legacy venue','SINGLE_VENUE',${q(group)}::uuid,true,true,array['Legacy named venue']);`);
  const event=JSON.parse(sql(`set role service_role;select public.app_apply_event_command('create',null,${j({
    event_name:'Synthetic Event Place proof',location_group_id:group,event_scope:'SINGLE_VENUE',primary_venue_id:venue,
    venue_ids:[venue],display_location:'Synthetic legacy venue',coverage_location_ids:[],staffing_area_ids:[],
    status:'SCHEDULED',needs_review:false,event_timezone:'America/Chicago',event_date:'2026-11-01',end_date:'2026-11-01',
    start_time:'09:00:00',end_time:'11:00:00',start_instant_utc:'2026-11-01T15:00:00.000Z',
    end_instant_utc:'2026-11-01T17:00:00.000Z',operation_id:randomUUID(),actor_manager_id:manager,
  })},null,null);`));
  const authority=()=>JSON.parse(sql(`set role custodial_application_reader;select public.app_event_place_authority(to_jsonb(e),statement_timestamp()) from public.events_app_events e where id=${q(event.id)}::uuid;`));
  check(authority().admissible,true,'UNMAPPED legacy venue retains admission');
  check(authority().mapping_status,'UNMAPPED','UNMAPPED status remains explicit');
  const created=JSON.parse(sql(`set role service_role;select public.custodial_place_command(${q(randomUUID())}::uuid,${q(manager)}::uuid,${q(place)}::uuid,0,'add',null,${j({canonical_code:'EVENT_PLACE_SYNTH',display_name:'Synthetic canonical venue',aliases:['Canonical named venue'],cleaning_mode:'NEVER_CLEAN',event_eligible:true})},'Synthetic explicit event-only mapping');`));
  check(created.place_id,place,'explicit canonical place created');
  const preview=JSON.parse(sql(`set role service_role;select public.custodial_place_bridge_preview(${q(manager)}::uuid,'event_venue',${q(venue)}::uuid,'map',${q(place)}::uuid,null,'Synthetic explicit mapping');`));
  const confirmation=JSON.parse(sql(`set role service_role;select public.custodial_place_bridge_confirm(${q(request)}::uuid,${q(manager)}::uuid,${q(preview.preview_id)}::uuid);`));
  check(confirmation.data.legacy_id,venue,'bridge retains Event Venue UUID');
  check(authority().mapping_status,'MAPPED','mapped canonical Event authority admitted');
  check(authority().primary_display_name,'Synthetic canonical venue','mapped canonical display readback');
  check(authority().admissible,true,'mapped event still admitted');
  raw(`update public.event_venues set aliases=array['Drifted legacy alias'] where id=${q(venue)}::uuid;`);
  check(authority().admissible,false,'mapped legacy source drift fails closed');
  check(authority().review_reason,'legacy_source_drift','source-drift reason retained');
  check(sql(`select count(*) from public.events_app_events e where id=${q(event.id)}::uuid and
    (public.app_event_place_authority(to_jsonb(e),statement_timestamp())->>'admissible')::boolean is true;`),'0','public/employee read predicate excludes drifted mapped event');
  rejects(`update public.events_app_events set event_name='Invalid reschedule' where id=${q(event.id)}::uuid;`,/40901.*mapping is inactive or requires manager review/s,'scheduled writer denied after drift');
  rejects(`set role service_role;select public.mz_preview_event_impact(to_jsonb(e),${q(manager)}::uuid,e.id,e.revision)
    from public.events_app_events e where e.id=${q(event.id)}::uuid;`,/40901.*mapping requires manager review/s,'impact preview refuses drifted mapped event');
  const cancelled=JSON.parse(sql(`set role service_role;select public.app_transition_event_cancellation(${q(event.id)}::uuid,'cancel',1,${q(randomUUID())}::uuid,${q(manager)}::uuid,'Synthetic drift cancellation');`));
  check(cancelled.event.status,'CANCELLED','cancellation remains available to remove stale schedule');
  rejects(`set role service_role;select public.app_transition_event_cancellation(${q(event.id)}::uuid,'restore',2,${q(randomUUID())}::uuid,${q(manager)}::uuid,'Synthetic invalid restore');`,/40901.*mapping is inactive or requires manager review/s,'restore denied after drift');
  check(sql("select has_function_privilege('custodial_application_reader','public.app_event_place_authority(jsonb,timestamptz)','execute')::text"),'true','read-only authority grant');
  check(sql("select has_function_privilege('anon','public.app_event_place_authority(jsonb,timestamptz)','execute')::text"),'false','anonymous authority denied');
  check(sql("select count(*) from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(object_identity)='public.app_event_place_authority(jsonb,timestamptz)'::regprocedure"),'1','Event authority recovery inventory bound');
  console.log('EVENT_PLACE_ADMISSION_PASS',JSON.stringify({checks,migrations:migrations.length,container,event_id:event.id,bridge_revision:confirmation.data.revision}));
} finally {if(owned)docker(['rm','-f',container],{timeout:30000});}
