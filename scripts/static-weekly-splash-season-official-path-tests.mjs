// SCH-022 changed-input fixture. Imported by the root-owned combined replay;
// never creates a database/container or reaches a configured production URL.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {buildEventStaticAuthoritySource,seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';

const HEX=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DOCKER=['--host','unix:///var/run/docker.sock'];
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const json=value=>`${quote(JSON.stringify(value))}::jsonb`;

function bindSyntheticTarget(target){
 assert.ok(target&&typeof target==='object'&&!Array.isArray(target));
 assert.deepEqual(Object.keys(target).sort(),['database','fixture_id','id','image','name']);
 assert.match(target.name,/^mz_schema_rebuild_[a-zA-Z0-9_]+$/);
 assert.match(target.id,HEX);
 assert.match(target.image,/^sha256:[0-9a-f]{64}$/);
 assert.match(target.fixture_id,UUID);
 assert.equal(target.database,'postgres');
 const inspected=JSON.parse(execFileSync('docker',[...DOCKER,'inspect','--type','container',target.name],
  {encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,LANG:'C.UTF-8'}}));
 assert.equal(inspected.length,1);
 const actual=inspected[0];
 assert.equal(actual.Id,target.id);assert.equal(actual.Image,target.image);
 assert.equal(actual.Name,`/${target.name}`);assert.equal(actual.State?.Running,true);
 assert.equal(actual.HostConfig?.NetworkMode,'none');
 assert.deepEqual(actual.HostConfig?.PortBindings||{},{});
 assert.ok(Object.values(actual.NetworkSettings?.Ports||{}).every(value=>value===null));
 assert.deepEqual(Object.keys(actual.NetworkSettings?.Networks||{}),['none']);
 assert.equal(actual.Config?.Labels?.['org.memphiszoo.custodial.fixture'],'synthetic');
 assert.equal(actual.Config?.Labels?.['org.memphiszoo.custodial.owner'],'/root');
 assert.equal(actual.Config?.Labels?.['org.memphiszoo.custodial.fixture-id'],target.fixture_id);
 // Only the inspected immutable ID is subsequently used; never a user URL.
 return statement=>execFileSync('docker',[...DOCKER,'exec','-i',target.id,'psql','-X','-q','-At',
  '-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d',target.database],
 {encoding:'utf8',input:`set statement_timeout='30s';${statement}`,timeout:45000,
  maxBuffer:16*1024*1024,env:{PATH:process.env.PATH,LANG:'C.UTF-8'}}).trim();
}

export async function verifyStaticWeeklySplashSeasonOfficialPaths({target}){
 const sql=bindSyntheticTarget(target);
 const checks=[];
 const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push(name);};
 const reject=async(name,run,pattern)=>{let error;try{await run();}catch(caught){error=caught;}
  assert.ok(error,name);assert.match(String(error.stderr||error.message),pattern,name);checks.push(name);};
 const scalar=statement=>sql(statement).split('\n').at(-1);
 const row=statement=>JSON.parse(scalar(statement));
 const cp=(name,args)=>row(`set role static_weekly_control_plane;select public.${name}(${args})::text`);
 const revision=()=>Number(scalar('select current_revision from public.static_weekly_schedule_control where singleton'));
 check('source-retention migration installed',scalar("select to_regprocedure('public.static_weekly_sch022_retained_member_referenced(uuid)') is not null"),'t');
 check('clean official scheduler prerequisite',scalar("select count(*) from public.weekly_schedule_publications"),'0');
 check('clean official roster prerequisite',scalar("select count(*) from public.weekly_roster_slots"),'0');
 const manager=randomUUID(),worker=randomUUID(),cover=randomUUID(),ordinaryGroup=randomUUID(),ordinary=randomUUID();
 const splashGroup=randomUUID(),splash=randomUUID(),workerSlot=randomUUID(),coverSlot=randomUUID();
 sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values
  (${quote(manager)},'SCH022 official-path manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);
 insert into public.employees(id,employee_code,display_name,role,active) values
  (${quote(worker)},'SCH022_OFFICIAL_WORKER','SCH022 Official Worker','staff',true),
  (${quote(cover)},'SCH022_OFFICIAL_COVER','SCH022 Official Cover','staff',true);
 insert into public.location_groups(id,group_code,group_name,active) values
  (${quote(ordinaryGroup)},'SCH022_ORDINARY_SOURCE','SCH022 ordinary source',true),
  (${quote(splashGroup)},'SPLASH_PAD_RESTROOMS','SCH022 Splash restroom source',true);
 insert into public.locations(id,location_code,location_name,location_type,active) values
  (${quote(ordinary)},'SCH022_ORDINARY_PHYSICAL','SCH022 ordinary physical','restroom',true),
  (${quote(splash)},'SCH022_SPLASH_PHYSICAL','SCH022 Splash physical','restroom',true);
 insert into public.location_group_memberships(location_group_id,location_id,active) values
  (${quote(ordinaryGroup)},${quote(ordinary)},true),(${quote(splashGroup)},${quote(splash)},true);`);
 const source=buildEventStaticAuthoritySource({weekStart:'2027-05-24',locationId:ordinary,
  locationCode:'SCH022_ORDINARY_PHYSICAL',locationName:'SCH022 ordinary physical',
  employees:[{id:worker,displayName:'SCH022 Official Worker',slotId:workerSlot},
   {id:cover,displayName:'SCH022 Official Cover',slotId:coverSlot,noWork:true}],
  proximity:[{from:ordinary,to:splash,minutes:1,verified:true,provenance:'synthetic exact physical route'},
   {from:splash,to:ordinary,minutes:1,verified:true,provenance:'synthetic exact physical route'}],
  label:'sch022-official-path'});
 const fixture=await seedCompiledEventAuthority({sql,container:target.name,managerId:manager,
  dates:['2027-05-24','2027-05-31'],source,label:'sch022-official-path',mode:'official'});
 const baseline=fixture.projectionIds['2027-05-31'];
 check('ordinary published baseline retains no Splash duty',scalar(`select count(*) from public.weekly_schedule_occurrences
  where projection_id=${quote(baseline)}::uuid and location_id=${quote(splash)}::uuid`),'0');
 const original=scalar(`select public.static_weekly_digest_jsonb(coalesce(jsonb_agg(to_jsonb(o) order by o.occurrence_id),'[]'::jsonb))
  from public.weekly_schedule_occurrences o where o.projection_id=${quote(baseline)}::uuid`);
 const eventWork=(date,id,locationId,locationCode,name,window)=>({workId:id,
  dayOfWeek:new Date(`${date}T00:00:00Z`).getUTCDay(),originSlotId:workerSlot,locationId,
  locationCodeSnapshot:locationCode,locationNameSnapshot:name,
  includedLocations:[{locationId,locationNameSnapshot:name}],window,serviceEffortMinutes:5,
  serviceEffortProvenance:'sch022-official-fixture-effort',priority:1,
  priorityProvenance:'sch022-official-fixture-priority',requiredQualifications:['general'],
  qualificationProvenance:'sch022-official-fixture-role',restrictions:[],
  restrictionProvenance:'sch022-official-fixture-restrictions'});
 const impact=(work)=>({removeWorkIds:[],patchWork:[],addWork:[work]});
 const preWork=eventWork('2027-05-30','sch022-too-early',splash,'SCH022_SPLASH_PHYSICAL',
  'SCH022 Splash physical',{start:'09:00',end:'09:15'});
 const preRevision=revision(),preExceptions=scalar('select count(*) from public.weekly_schedule_exception_commands');
 await reject('official dated event addition before Memorial Day is refused',
  ()=>fixture.applyException({serviceDate:'2027-05-30',exceptionType:'event_impact',
   reason:'Synthetic too-early Splash duty',payload:impact(preWork)}),
  /23514.*inactive before Memorial Day 2027/s);
 check('too-early exception creates no accepted revision',revision(),preRevision);
 check('too-early exception creates no history row',scalar('select count(*) from public.weekly_schedule_exception_commands'),preExceptions);
 const acceptedWork=eventWork('2027-05-31','sch022-post-memorial',splash,'SCH022_SPLASH_PHYSICAL',
  'SCH022 Splash physical',{start:'09:00',end:'09:15'});
 const accepted=await fixture.applyException({serviceDate:'2027-05-31',exceptionType:'event_impact',
  reason:'Synthetic accepted post-Memorial Splash duty',payload:impact(acceptedWork)});
 check('official postdate event exception has accepted identity',UUID.test(accepted.exceptionId),true);
 check('postdate projection changes from immutable ordinary baseline',
  accepted.projection.data.projection_id===baseline,false);
 const acceptedProjection=accepted.projection.data.projection_id;
 check('official postdate occurrence uses exact physical member',scalar(`select count(*) from public.weekly_schedule_occurrences
  where projection_id=${quote(acceptedProjection)}::uuid and service_date='2027-05-31'
   and work_id='sch022-post-memorial' and location_id=${quote(splash)}::uuid`),'1');
 check('original baseline occurrence bytes retained',scalar(`select public.static_weekly_digest_jsonb(coalesce(jsonb_agg(to_jsonb(o) order by o.occurrence_id),'[]'::jsonb))
  from public.weekly_schedule_occurrences o where o.projection_id=${quote(baseline)}::uuid`),original);
 check('accepted physical-code event is retained source provenance',scalar(`select public.static_weekly_sch022_retained_member_referenced(${quote(splash)}::uuid)`),'t');
 await reject('referenced Splash membership cannot be hard-deleted',
  ()=>sql(`delete from public.location_group_memberships where location_group_id=${quote(splashGroup)}::uuid
   and location_id=${quote(splash)}::uuid`),/23514.*accepted Splash member provenance/s);
 await reject('referenced Splash membership cannot be reassigned',
  ()=>sql(`update public.location_group_memberships set location_group_id=${quote(ordinaryGroup)}::uuid
   where location_group_id=${quote(splashGroup)}::uuid and location_id=${quote(splash)}::uuid`),
  /23514.*accepted Splash member provenance/s);
 await reject('referenced exact group code cannot be renamed',
  ()=>sql(`update public.location_groups set group_code='SCH022_RENAMED'
   where id=${quote(splashGroup)}::uuid`),/23514.*accepted Splash group identity/s);
 sql(`update public.location_groups set group_name='SCH022 display name changed' where id=${quote(splashGroup)}::uuid`);
 check('harmless group display metadata remains editable',scalar(`select group_name from public.location_groups
  where id=${quote(splashGroup)}::uuid`),'SCH022 display name changed');
 sql(`update public.location_group_memberships set active=false where location_group_id=${quote(splashGroup)}::uuid
  and location_id=${quote(splash)}::uuid`);
 check('inactive original member row retained',scalar(`select count(*) from public.location_group_memberships
  where location_group_id=${quote(splashGroup)}::uuid and location_id=${quote(splash)}::uuid and active=false`),'1');
 await reject('formerly accepted physical-code Splash work cannot become NO_TARGET',
  ()=>sql(`select public.static_weekly_sch022_work_witness('2027-05-31',${json([{
   locationId:splash,locationCode:'SCH022_SPLASH_PHYSICAL',includedLocationIds:[splash]}])})`),
  /23514.*current exact group members/s);
 check('unrelated ordinary physical work remains no-target while Splash inactive',
  HEX.test(scalar(`select public.static_weekly_sch022_work_witness('2027-05-31',${json([{
   locationId:ordinary,locationCode:'SCH022_ORDINARY_PHYSICAL',includedLocationIds:[ordinary]}])})`)),true);
 const driftWork=eventWork('2027-05-31','sch022-ordinary-recompile-drift',ordinary,'SCH022_ORDINARY_PHYSICAL',
  'SCH022 ordinary physical',{start:'10:00',end:'10:15'});
 const beforeDriftProjection=scalar(`select count(*) from public.weekly_schedule_compiled_projections
  where publication_id=${quote(fixture.publicationId)}::uuid and week_start='2027-05-31'`);
 await reject('official recompile cannot create stale Splash occurrence after deactivation',
  ()=>fixture.applyException({serviceDate:'2027-05-31',exceptionType:'event_impact',
   reason:'Synthetic ordinary work to force current recompile',payload:impact(driftWork)}),
  /23514.*current exact group members/s);
 check('stale official recompile adds no projection',scalar(`select count(*) from public.weekly_schedule_compiled_projections
  where publication_id=${quote(fixture.publicationId)}::uuid and week_start='2027-05-31'`),beforeDriftProjection);
 check('accepted target occurrence history remains byte-identical',scalar(`select count(*) from public.weekly_schedule_occurrences
  where projection_id=${quote(acceptedProjection)}::uuid and work_id='sch022-post-memorial'`),'1');
 sql(`update public.location_group_memberships set active=true where location_group_id=${quote(splashGroup)}::uuid
  and location_id=${quote(splash)}::uuid`);
 const recompiled=await fixture.recompile('2027-05-31');
 check('current valid member permits official repaired occurrence',scalar(`select count(*) from public.weekly_schedule_occurrences
  where projection_id=${quote(recompiled.data.projection_id)}::uuid and work_id='sch022-post-memorial'
   and location_id=${quote(splash)}::uuid`),'1');
 check('original accepted postdate occurrence remains immutable',scalar(`select count(*) from public.weekly_schedule_occurrences
  where projection_id=${quote(acceptedProjection)}::uuid and work_id='sch022-post-memorial'`),'1');
 for(const name of ['static_weekly_sch022_retained_member_referenced(uuid)',
  'static_weekly_sch022_membership_identity_guard()','static_weekly_sch022_group_identity_guard()',
  'static_weekly_sch022_work_witness(date,jsonb)']){
  check(`${name} exact function recovery binding`,scalar(`select count(*) from public.custodial_release_authority_restore_inventory
   where object_kind='function' and to_regprocedure(object_identity)=${quote('public.'+name)}::regprocedure
    and definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(${quote('public.'+name)}::regprocedure))`),'1');
  check(`${name} exact grant recovery binding`,scalar(`select count(*) from public.custodial_release_authority_restore_inventory
   where object_kind='grant' and to_regprocedure(object_identity)=${quote('public.'+name)}::regprocedure
    and definition_sha256=public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(object_identity))`),'1');
 }
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator']){
  check(`${role} retained-member helper denied`,scalar(`select has_function_privilege(${quote(role)},
   'public.static_weekly_sch022_retained_member_referenced(uuid)','EXECUTE')`),'f');
 }
 check('control-plane direct retained-member helper denied',scalar(`select has_function_privilege('static_weekly_control_plane',
  'public.static_weekly_sch022_retained_member_referenced(uuid)','EXECUTE')`),'f');
 for(const [relation,trigger] of [['location_group_memberships','trg_static_weekly_sch022_membership_identity_guard'],
  ['location_groups','trg_static_weekly_sch022_group_identity_guard']]){
  check(`${relation} source-retention trigger enabled`,scalar(`select count(*) from pg_trigger
   where tgrelid=${quote('public.'+relation)}::regclass and tgname=${quote(trigger)} and tgenabled='O'`),'1');
  check(`${relation} source-retention trigger exact recovery binding`,scalar(`select count(*) from public.custodial_release_authority_restore_inventory
   where object_kind='trigger' and object_identity=${quote('public.'+relation+'.'+trigger)}
    and definition_sha256=public.static_weekly_digest_text(
     'drop trigger if exists '||quote_ident(${quote(trigger)})||' on public.'||quote_ident(${quote(relation)})||'; '
      ||(select pg_get_triggerdef(t.oid,true) from pg_trigger t
        where t.tgrelid=${quote('public.'+relation)}::regclass and t.tgname=${quote(trigger)})
      ||'; alter table public.'||quote_ident(${quote(relation)})||' enable trigger '||quote_ident(${quote(trigger)})||';')`),'1');
 }
 return {status:'PASS',scope:'synthetic official dated exception and occurrence SCH022 paths',checks:checks.length,
  target:{id:target.id,image:target.image,fixture_id:target.fixture_id,network:'none'},
  source:{publication_id:fixture.publicationId,group_id:splashGroup,member_id:splash,
   baseline_projection_id:baseline,accepted_projection_id:acceptedProjection,
   repaired_projection_id:recompiled.data.projection_id},
  limitations:['No production group/member identity or pre-upgrade deleted membership preimage was admitted.',
   'The disposable helper separates accepted exception and recompile transactions; product control plane atomicity is separately proved.']};
}
