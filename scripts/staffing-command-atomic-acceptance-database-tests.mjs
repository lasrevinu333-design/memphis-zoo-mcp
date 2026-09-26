import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import {seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';
import {compileStaticWeeklySchedule,postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {createStaffingWeekPreviewInput} from '../src/static-weekly-staffing-preview.js';
import {createStaffingCandidateSet} from '../src/static-weekly-staffing-candidates.js';
import {enumerateStaffingServiceWindow} from '../src/static-weekly-staffing-preparation.js';
import {canonicalJson} from '../src/static-weekly-schedule-model.js';

const container=`mz_schema_rebuild_staffing_accept_${process.pid}`;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:`set statement_timeout=30000;${text}`}).trim();
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const j=value=>`${q(JSON.stringify(value))}::jsonb`;
const json=text=>JSON.parse(sql(text).split('\n').at(-1));
const cp=(name,args)=>json(`set role static_weekly_control_plane;select public.${name}(${args})::text`);
const sha=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace='public'::regnamespace and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])sql(`alter default privileges for role ${owner} in schema public revoke all on tables from anon,authenticated,service_role;alter default privileges for role ${owner} in schema public revoke all on sequences from anon,authenticated,service_role;`);};
let owned=false,checks=0;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
const reject=(name,statement,pattern)=>{let error;try{sql(statement);}catch(candidate){error=candidate;}assert.ok(error,name);assert.match(String(error.stderr),pattern,name);checks++;console.log('PASS',name);};
const cleanup=()=>{if(!owned)return;docker(['rm','-f',container]);owned=false;assert.equal(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');console.log('OWNED_CONTAINER_REMOVED',container);};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{cleanup();}finally{process.exit(143);}});

const files=readdirSync('supabase/migrations').filter(file=>file.endsWith('.sql')).sort();
assert.equal(files.at(-1),'20260925190000_gps_exact_location_authority_boundary.sql');
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g',
  '-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);owned=true;
 console.log(JSON.stringify({owned:container,cleanup:'exact container in finally',network:'none',production:false}));
 let ready=0;for(let attempt=0;attempt<60&&ready<4;attempt++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(resolve=>setTimeout(resolve,500));}assert.equal(ready,4);
 removeDefaults();
 for(const file of files){assert.equal(sql(defaults),'0');const bytes=readFileSync(`supabase/migrations/${file}`);sql(bytes.toString());
  if(Number(sql(defaults))){assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));removeDefaults();}assert.equal(sql(defaults),'0');}
 console.log('REPLAYED_EXACT_MIGRATIONS',files.length);

 const manager=randomUUID(),successor=randomUUID(),week='2026-09-28',serviceDate=week;
 const slots=['a','b','c','d'].map((key,index)=>({key,id:randomUUID(),person:randomUUID(),name:`Staffing ${index}`}));
 const locations=Object.fromEntries(['W','E','B','B2','C','C2','D','D2'].map(code=>[code,{id:randomUUID(),group:randomUUID(),code:`STAFF_${code}`} ]));
 sql(`insert into public.ops_manager_managers(manager_id,display_name) values(${q(manager)},'Staffing Manager'),(${q(successor)},'Successor Manager');`);
 for(const slot of slots)sql(`insert into public.employees(id,display_name,employee_code,role,active) values(${q(slot.person)},${q(slot.name)},${q('STF_'+slot.key)},'staff',true);`);
 const currentServiceDate=sql('select public.sch_service_date(statement_timestamp())::text');
 const priorDay=new Date(`${currentServiceDate}T00:00:00Z`);priorDay.setUTCDate(priorDay.getUTCDate()-1);const elapsedStart=priorDay.toISOString().slice(0,10);
 const futureDay=new Date(`${currentServiceDate}T00:00:00Z`);futureDay.setUTCDate(futureDay.getUTCDate()+2);const elapsedEnd=futureDay.toISOString().slice(0,10);
 const seededOperation=randomUUID(),seededAbsence=randomUUID(),seededBody={absenceKind:'daily_absence',commandKind:'absence',employeeId:slots[0].person,endDate:elapsedEnd,startDate:elapsedStart,targetAbsenceId:null};
 sql(`insert into public.static_weekly_staffing_commands(operation_id,command_kind,employee_id,start_date,end_date,absence_kind,semantic_body,semantic_digest,client_prepare_key,expected_revision,prepared_by_manager_id) values(${q(seededOperation)},'absence',${q(slots[0].person)},${q(elapsedStart)},${q(elapsedEnd)},'daily_absence',${j(seededBody)},repeat('a',64),${q(randomUUID())},0,${q(manager)});insert into public.static_weekly_staffing_absences(absence_id,employee_id,absence_kind,start_date,end_date,accepted_operation_id,accepted_revision,accepted_by_manager_id) values(${q(seededAbsence)},${q(slots[0].person)},'daily_absence',${q(elapsedStart)},${q(elapsedEnd)},${q(seededOperation)},0,${q(manager)});`);
 const elapsedCancellation={absenceKind:null,commandKind:'cancel_absence',employeeId:slots[0].person,endDate:elapsedEnd,startDate:elapsedStart,targetAbsenceId:seededAbsence};
 reject('begin rejects cancellation starting on an elapsed service date',`set role static_weekly_control_plane;select public.static_weekly_v10_begin_staffing_command(${j(elapsedCancellation)},${q(randomUUID())}::uuid,0,${q(manager)}::uuid)`,/cannot rewrite an elapsed service date/);
 const elapsedPrepared=randomUUID(),elapsedPreview='9'.repeat(64),beforeElapsedReject=Number(sql('select current_revision from public.static_weekly_schedule_control where singleton'));
 sql(`insert into public.static_weekly_staffing_commands(operation_id,command_kind,employee_id,start_date,end_date,target_absence_id,semantic_body,semantic_digest,client_prepare_key,expected_revision,prepared_by_manager_id,state,preview_digest,prepared_at) values(${q(elapsedPrepared)},'cancel_absence',${q(slots[0].person)},${q(elapsedStart)},${q(elapsedEnd)},${q(seededAbsence)},${j(elapsedCancellation)},${q(sha(elapsedCancellation))},${q(randomUUID())},0,${q(manager)},'PREPARED',${q(elapsedPreview)},statement_timestamp());`);
 const elapsedRejected=cp('static_weekly_v11_accept_staffing_command',`${q(elapsedPrepared)}::uuid,${q(elapsedPreview)},${q(randomUUID())}::uuid,${q(manager)}::uuid`);
 check('prepared cancellation that becomes elapsed terminalizes without authority mutation',elapsedRejected.state,'REJECTED');
 check('elapsed confirmation rejection advances no authority',Number(sql('select current_revision from public.static_weekly_schedule_control where singleton')),beforeElapsedReject);
 check('elapsed confirmation rejection releases pending state with one durable receipt',sql(`select state||':'||(select count(*) from public.static_weekly_staffing_command_receipts where operation_id=${q(elapsedPrepared)}::uuid and event_kind='REJECTED') from public.static_weekly_staffing_commands where operation_id=${q(elapsedPrepared)}::uuid`),'REJECTED:1');
 for(const location of Object.values(locations))sql(`insert into public.locations(id,location_code,location_name,location_type,form_type) values(${q(location.id)},${q(location.code)},${q(location.code)},'restroom','restroom');insert into public.location_groups(id,group_code,group_name) values(${q(location.group)},${q(location.code)},${q(location.code)});insert into public.location_group_memberships(location_group_id,location_id) values(${q(location.group)},${q(location.id)});`);
 const codes=Object.keys(locations),ownerCodes=[['W','E'],['B','B2'],['C','C2'],['D','D2']],lunches=[['12:00','13:00'],['12:30','13:30'],['10:00','11:00'],['14:00','15:00']];
 const source={serviceDate:week,timezone:'America/Chicago',exceptions:[],
  slots:slots.map(slot=>({id:slot.id,label:slot.name,incumbencies:[{personId:slot.person,displayName:slot.name,effectiveStart:'2020-01-01',effectiveEnd:null}]})),
  proximity:codes.flatMap(from=>codes.filter(to=>to!==from).map(to=>({from:locations[from].id,to:locations[to].id,minutes:(from==='B'&&to==='W')||(from==='C'&&to==='E')?1:10,verified:true,provenance:'synthetic geometry'}))),
  versions:[{id:randomUUID(),publicationId:randomUUID(),status:'published',effectiveStart:week,effectiveEnd:null,objective:{requireVerifiedProximity:true},
   slotAvailability:slots.map((slot,index)=>({slotId:slot.id,dayOfWeek:1,status:'working',shift:{start:'07:00',end:'17:00'},lunch:{start:lunches[index][0],end:lunches[index][1]},productiveCapacityProvenance:'fixture-shift',maxServiceEffortMinutes:300,maxServiceEffortProvenance:'fixture-capacity',qualifications:['general'],qualificationProvenance:'fixture-role',restrictions:[],restrictionProvenance:'fixture-restrictions',acceptedRouteAnchorLocationId:locations[ownerCodes[index][0]].id,acceptedRouteProvenance:'fixture-route'})),
   assignments:slots.flatMap((slot,index)=>ownerCodes[index].map(code=>({workId:code,dayOfWeek:1,ownerSlotId:slot.id,locationId:locations[code].id,locationCodeSnapshot:locations[code].code,locationNameSnapshot:locations[code].code,includedLocations:[{locationId:locations[code].id,locationNameSnapshot:locations[code].code}],schedulingMode:'flexible_coverage_ownership',window:{start:'09:45',end:'16:00'},serviceEffortMinutes:20,serviceEffortProvenance:'fixture-effort',priority:2,priorityProvenance:'fixture-priority',requiredQualifications:['general'],qualificationProvenance:'fixture-work-role',restrictions:[],restrictionProvenance:'fixture-work-restrictions'})))}]};
 const fixture=await seedCompiledEventAuthority({sql,container,managerId:manager,dates:[serviceDate],source,label:'staffing-atomic-test',mode:'official'});
 const baselineProjection=fixture.projectionIds[week];
 for(const [index,slot] of slots.slice(0,3).entries()){
  const device=randomUUID(),credential=randomUUID();
  sql(`insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values(${q(device)},${q('STAFF_PHONE_'+index)},${q('Staff phone '+index)},true,${q(slot.person)},1);insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at) values(${q(credential)},${q(device)},repeat(${q(String(index+1))},64),statement_timestamp(),statement_timestamp()+interval '1 day');`);
  slot.device=device;slot.credential=credential;
 }
 const revision=()=>Number(sql('select current_revision from public.static_weekly_schedule_control where singleton'));

 async function prepare({commandKind='absence',absenceKind='daily_absence',targetAbsenceId=null,startDate=serviceDate,endDate=serviceDate,employeeId=slots[0].person,omitRefreshEmployee=null}){
  const expectedRevision=revision(),semanticBody={absenceKind:commandKind==='absence'?absenceKind:null,commandKind,employeeId,endDate,startDate,targetAbsenceId:commandKind==='cancel_absence'?targetAbsenceId:null};
  const begun=cp('static_weekly_v10_begin_staffing_command',`${j(semanticBody)},${q(randomUUID())}::uuid,${expectedRevision},${q(manager)}::uuid`);
  const preparationServiceDate=sql('select public.sch_service_date(statement_timestamp())::text');
  const priorTargets=cp('static_weekly_v11_read_current_refresh_targets',`${q(startDate)}::date,${q(endDate)}::date,${q(manager)}::uuid`);
  const priorByDate=new Map();for(const row of priorTargets){if(!priorByDate.has(row.serviceDate))priorByDate.set(row.serviceDate,new Set());priorByDate.get(row.serviceDate).add(row.employeeId);}
  const window=enumerateStaffingServiceWindow(startDate,endDate),candidates=[],publications=[],inputDigests=[],preparedByWeek={};
  for(const weekStart of window.weeks){
   const publicationSource=cp('static_weekly_v3_read_publication_source',`${q(fixture.publicationId)}::uuid,${q(weekStart)}::date`);
   const overlay=createStaffingWeekPreviewInput({operationId:begun.operation_id,managerId:manager,semanticBody,expectedRevision,weekStart,source:publicationSource,currentServiceDate:preparationServiceDate});
   const compiled=await compileStaticWeeklySchedule(overlay.input);assert.equal(compiled.status,'FEASIBLE');assert.equal(compiled.verifier.ok,true);assert.equal(compiled.publicationAuthority,'ACCEPTABLE');
   const prepared=createStaticWeeklyProjectionWithLunchRpcInput({result:compiled,publicationId:fixture.publicationId,expectedRevision,actor:{managerId:manager,managerName:'Staffing Manager',idempotencyKey:`staffing:${begun.operation_id}:${weekStart}`}});
   const {lunchDocument,...projectionPayload}=prepared;preparedByWeek[weekStart]={prepared,lunchDocument};
   candidates.push({candidateKind:'lunch',candidateKey:`week:${weekStart}`,serviceDate:weekStart,payload:lunchDocument},
    {candidateKind:'projection',candidateKey:`week:${weekStart}`,serviceDate:weekStart,payload:projectionPayload});
   for(const date of overlay.dates){const employees=new Set(priorByDate.get(date)||[]);for(const id of prepared.envelope.assignments.filter(row=>row.service_date===date&&row.status==='assigned'&&row.owner_person_id).map(row=>row.owner_person_id))employees.add(id);for(const responsibility of lunchDocument.responsibilities||[]){if(responsibility.service_date!==date)continue;for(const id of [responsibility.normal_owner_person_id,responsibility.coverer_person_id])if(id)employees.add(id);}employees.add(employeeId);
    for(const affectedEmployee of [...employees].sort())candidates.push({candidateKind:'schedule_refresh',candidateKey:`date:${date}:employee:${affectedEmployee}`,serviceDate:date,payload:{employeeId:affectedEmployee,weekStart,publicationId:fixture.publicationId,projectionIdentity:prepared.envelope.database_projection_identity,lunchDocumentIdentity:lunchDocument.document_identity}});}
   publications.push(overlay.publication);inputDigests.push(sha(overlay.input));
  }
  const candidateRows=omitRefreshEmployee?candidates.filter(row=>!(row.candidateKind==='schedule_refresh'&&row.payload.employeeId===omitRefreshEmployee)):candidates;
  const set=createStaffingCandidateSet({window,candidates:candidateRows});
  const publicationVector={expectedRevision,weeks:publications};const inputDigest=sha({operationId:begun.operation_id,semanticDigest:begun.semantic_digest,publicationVector,inputDigests});
  const previewDigest=sha({operationId:begun.operation_id,semanticDigest:begun.semantic_digest,candidateSetDigest:set.digest,publicationVector,summary:set.summary});
  const rows=set.rows.map(({candidateKind,candidateKey,serviceDate:date,payload})=>({candidateKind,candidateKey,serviceDate:date,payload}));
  cp('static_weekly_v10_stage_staffing_command',`${q(begun.operation_id)}::uuid,${j(rows)},${q(previewDigest)},${q(inputDigest)},${j(publicationVector)},${q(manager)}::uuid`);
  return{...begun,previewDigest,confirmationKey:randomUUID(),expectedRevision,preparedByWeek};
 }

 const absence=await prepare({});const accepted=cp('static_weekly_v11_accept_staffing_command',`${q(absence.operation_id)}::uuid,${q(absence.previewDigest)},${q(absence.confirmationKey)}::uuid,${q(manager)}::uuid`);
 check('absence accepted exactly one authority revision',accepted.authority_revision,absence.expectedRevision+1);
 check('one person-bound absence fact',sql(`select count(*) from public.static_weekly_staffing_absences where absence_id=${q(absence.operation_id)}::uuid`),'1');
 check('one accepted staffing authority revision',sql(`select count(*) from public.weekly_schedule_authority_revisions where authority_revision=${accepted.authority_revision} and operation='apply_staffing_command' and command_id=${q(absence.operation_id)}::uuid`),'1');
 check('one replacement projection and lunch companion',sql(`select count(*) from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id) where p.projection_id=${q(accepted.projections[week].projection_id)}::uuid`),'1');
 check('accepted projection is current',sql(`select projection_id::text from public.static_weekly_v6_schedule_authority_state(${q(serviceDate)}::date)`),accepted.projections[week].projection_id);
 check('all three current affected phones have exact pending intent',Number(sql(`select count(*) from public.static_weekly_schedule_application_intents where operation_id=${q(absence.operation_id)}::uuid`)),3);
 check('manager delivery distinguishes pending phones from no-current-device target',cp('static_weekly_v10_read_staffing_delivery_status',`${q(absence.operation_id)}::uuid,${q(successor)}::uuid`).targets.map(row=>row.status).sort(),['NO_CURRENT_DEVICE','PENDING','PENDING','PENDING']);
 const exactReplay=cp('static_weekly_v11_accept_staffing_command',`${q(absence.operation_id)}::uuid,${q(absence.previewDigest)},${q(absence.confirmationKey)}::uuid,${q(manager)}::uuid`);
 check('lost response exact retry recovers accepted receipt',exactReplay.replayed,true);check('exact retry adds no revision',revision(),accepted.authority_revision);
 reject('successor cannot replay original confirmation',`set role static_weekly_control_plane;select public.static_weekly_v11_accept_staffing_command(${q(absence.operation_id)}::uuid,${q(absence.previewDigest)},${q(absence.confirmationKey)}::uuid,${q(successor)}::uuid)`,/different confirmation identity|original preparer/);
 reject('changed confirmation key cannot replace accepted receipt',`set role static_weekly_control_plane;select public.static_weekly_v11_accept_staffing_command(${q(absence.operation_id)}::uuid,${q(absence.previewDigest)},${q(randomUUID())}::uuid,${q(manager)}::uuid)`,/different confirmation identity/);
 const firstIntent=json(`select row_to_json(i)::text from public.static_weekly_schedule_application_intents i where operation_id=${q(absence.operation_id)}::uuid and employee_id=${q(slots[0].person)}::uuid`);
 const appliedAt=sql('select statement_timestamp()::text');
 const applied=json(`set role service_role;select public.static_weekly_v10_ack_device_schedule_application(${q(firstIntent.intent_id)}::uuid,${q(firstIntent.device_id)}::uuid,${q(firstIntent.credential_id)}::uuid,${q(firstIntent.employee_id)}::uuid,${firstIntent.assignment_epoch},${firstIntent.authority_revision},${q(firstIntent.projection_id)}::uuid,${q(firstIntent.lunch_document_identity)},${q('e'.repeat(64))},${q(appliedAt)}::timestamptz)::text`);
 check('exact device readback changes only its target to applied',applied.application_status,'DEVICE_REPORTED_APPLIED');

 const cancellation=await prepare({commandKind:'cancel_absence',targetAbsenceId:absence.operation_id});
 const beforeFailure={revision:revision(),cancellations:sql('select count(*) from public.static_weekly_staffing_absence_cancellations'),receipts:sql(`select count(*) from public.static_weekly_staffing_command_receipts where operation_id=${q(cancellation.operation_id)}::uuid`),baselineLunch:sql(`select count(*) from public.weekly_schedule_lunch_documents where projection_id=${q(baselineProjection)}::uuid`)};
 sql(`create function public.synthetic_fail_staffing_intent() returns trigger language plpgsql as $$begin raise exception 'synthetic application intent failure';end$$;create trigger trg_synthetic_fail_staffing_intent before insert on public.static_weekly_schedule_application_intents for each row execute function public.synthetic_fail_staffing_intent();`);
 reject('injected final intent failure aborts complete acceptance',`set role static_weekly_control_plane;select public.static_weekly_v11_accept_staffing_command(${q(cancellation.operation_id)}::uuid,${q(cancellation.previewDigest)},${q(cancellation.confirmationKey)}::uuid,${q(manager)}::uuid)`,/synthetic application intent failure/);
 check('failed acceptance rolls back revision',revision(),beforeFailure.revision);
 check('failed acceptance rolls back cancellation fact',sql('select count(*) from public.static_weekly_staffing_absence_cancellations'),beforeFailure.cancellations);
 check('failed acceptance rolls back accepted receipt',sql(`select count(*) from public.static_weekly_staffing_command_receipts where operation_id=${q(cancellation.operation_id)}::uuid`),beforeFailure.receipts);
 check('failed acceptance rolls back lunch companion',sql(`select count(*) from public.weekly_schedule_lunch_documents where projection_id=${q(baselineProjection)}::uuid`),beforeFailure.baselineLunch);
 sql('drop trigger trg_synthetic_fail_staffing_intent on public.static_weekly_schedule_application_intents;drop function public.synthetic_fail_staffing_intent();');
 const cancelled=cp('static_weekly_v11_accept_staffing_command',`${q(cancellation.operation_id)}::uuid,${q(cancellation.previewDigest)},${q(cancellation.confirmationKey)}::uuid,${q(manager)}::uuid`);
 check('cancellation accepted on retry after repaired injected fault',cancelled.authority_revision,beforeFailure.revision+1);
 check('cancellation returns to exact historical baseline projection',cancelled.projections[week].projection_id,baselineProjection);
 check('historical projection reuse is explicit',cancelled.projections[week].reused,true);
 check('remaining-window cancellation lineage retained',sql(`select remaining_start_date||':'||remaining_end_date from public.static_weekly_staffing_absence_cancellations where accepted_operation_id=${q(cancellation.operation_id)}::uuid`),`${serviceDate}:${serviceDate}`);
 check('current exception set is empty after cancellation',json(`select public.static_weekly_accepted_exception_set(${q(fixture.publicationId)}::uuid,${q(week)}::date)::text`),[]);
 check('cancellation targets remain pending or explicitly lack a current device',cp('static_weekly_v10_read_staffing_delivery_status',`${q(cancellation.operation_id)}::uuid,${q(successor)}::uuid`).targets.map(row=>row.status).sort(),['NO_CURRENT_DEVICE','PENDING','PENDING','PENDING']);
 const incompleteRefresh=await prepare({employeeId:slots[1].person,omitRefreshEmployee:slots[3].person});const beforeIncomplete=revision();
 reject('acceptance rejects one omitted previously affected employee refresh target',`set role static_weekly_control_plane;select public.static_weekly_v11_accept_staffing_command(${q(incompleteRefresh.operation_id)}::uuid,${q(incompleteRefresh.previewDigest)},${q(incompleteRefresh.confirmationKey)}::uuid,${q(manager)}::uuid)`,/affected employee schedule refresh set is incomplete or excessive/);
 check('incomplete affected-employee set advances no authority',revision(),beforeIncomplete);
 const multiweek=await prepare({employeeId:slots[1].person,startDate:'2026-09-28',endDate:'2026-10-05'});
 const multiweekAccepted=cp('static_weekly_v11_accept_staffing_command',`${q(multiweek.operation_id)}::uuid,${q(multiweek.previewDigest)},${q(multiweek.confirmationKey)}::uuid,${q(manager)}::uuid`);
 check('two-week absence still advances authority exactly once',multiweekAccepted.authority_revision,multiweek.expectedRevision+1);
 check('two-week acceptance publishes both exact projections',Object.keys(multiweekAccepted.projections).sort(),['2026-09-28','2026-10-05']);
 check('two-week acceptance creates both lunch companions',sql(`select count(*) from public.weekly_schedule_lunch_documents where projection_id in (${Object.values(multiweekAccepted.projections).map(row=>`${q(row.projection_id)}::uuid`).join(',')})`),'2');
 check('two-week accepted fact retains complete date window',sql(`select start_date||':'||end_date from public.static_weekly_staffing_absences where absence_id=${q(multiweek.operation_id)}::uuid`),'2026-09-28:2026-10-05');
 check('two-week phone targets remain pending or explicitly lack a current device',cp('static_weekly_v10_read_staffing_delivery_status',`${q(multiweek.operation_id)}::uuid,${q(successor)}::uuid`).targets.every(row=>['PENDING','NO_CURRENT_DEVICE'].includes(row.status)),true);
 for(const role of ['anon','authenticated','service_role','static_weekly_release_operator','custodial_application_reader'])reject(`atomic acceptance denied ${role}`,`set role ${role};select public.static_weekly_v11_accept_staffing_command(${q(cancellation.operation_id)}::uuid,${q(cancellation.previewDigest)},${q(cancellation.confirmationKey)}::uuid,${q(manager)}::uuid)`,/permission denied/);
 check('private batch digest helper has no control-plane EXECUTE',sql("select has_function_privilege('static_weekly_control_plane','public.static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)','EXECUTE')::text"),'false');
 check('current refresh ownership helper is control-plane only',sql("select has_function_privilege('static_weekly_control_plane','public.static_weekly_v11_read_current_refresh_targets(date,date,uuid)','EXECUTE')::text||':'||has_function_privilege('service_role','public.static_weekly_v11_read_current_refresh_targets(date,date,uuid)','EXECUTE')::text"),'true:false');
 check('current refresh ownership helper is captured in recovery inventory',sql("select count(*) from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(object_identity)='public.static_weekly_v11_read_current_refresh_targets(date,date,uuid)'::regprocedure and definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v11_read_current_refresh_targets(date,date,uuid)'::regprocedure))"),'1');
 check('current refresh ownership grant is captured in recovery inventory',sql("select count(*) from public.custodial_release_authority_restore_inventory where object_kind='grant' and to_regprocedure(object_identity)='public.static_weekly_v11_read_current_refresh_targets(date,date,uuid)'::regprocedure and definition_sha256=public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(object_identity))"),'1');
 check('delivery status replacement is captured in recovery inventory',sql("select count(*) from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(object_identity)='public.static_weekly_v10_read_staffing_delivery_status(uuid,uuid)'::regprocedure and definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v10_read_staffing_delivery_status(uuid,uuid)'::regprocedure))"),'1');
 check('delivery status replacement grant is captured in recovery inventory',sql("select count(*) from public.custodial_release_authority_restore_inventory where object_kind='grant' and to_regprocedure(object_identity)='public.static_weekly_v10_read_staffing_delivery_status(uuid,uuid)'::regprocedure and definition_sha256=public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(object_identity))"),'1');
 check('automatic table and sequence grants remain absent',sql(defaults),'0');
 console.log(JSON.stringify({status:'PASS',checks,migrations:files.length,actualPostgres:true,actualCompiler:true,synthetic:true,production:false,independentAudit:false,oneRevisionAtomicAcceptance:true,realPhone:false,physicalNfc:false}));
}finally{cleanup();}
