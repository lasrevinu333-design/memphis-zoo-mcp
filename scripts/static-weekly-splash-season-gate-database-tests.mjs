// Disposable SCH-022 SQL proof. No production connection, provider or phone.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildEventStaticAuthoritySource,seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';
import {compileStaticWeeklySchedule} from '../src/static-weekly-schedule-compiler.js';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {createStaffingWeekPreviewInput} from '../src/static-weekly-staffing-preview.js';
import {createStaffingCandidateSet} from '../src/static-weekly-staffing-candidates.js';
import {canonicalJson} from '../src/static-weekly-schedule-model.js';

const container=`mz_schema_rebuild_sch022_${process.pid}`;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
const sql=statement=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d','postgres'],{input:'set client_min_messages=warning;'+statement}).trim();
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const json=value=>`${quote(JSON.stringify(value))}::jsonb`;
const canonicalDigest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const row=statement=>JSON.parse(sql(statement).split('\n').at(-1));
const cp=(name,args)=>row(`set role static_weekly_control_plane;select public.${name}(${args})::text`);
const checks=[];
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push(name);};
const reject=(name,statement,pattern)=>{let error;try{sql(statement);}catch(caught){error=caught;}assert.ok(error,name);assert.match(String(error.stderr),pattern,name);checks.push(name);};
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in(0,'public'::regnamespace) and d.defaclrole in('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in('r','S') and a.grantee in(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])for(const scope of ['',' in schema public'])sql(`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`);};
let owned=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{if(owned)docker(['rm','-f',container]);}finally{process.exit(143);}});
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--name',container,'-p','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD=postgres',image,'-c','listen_addresses=*','-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements','-c','cron.database_name=postgres']);owned=true;
 console.log('OWNED_CONTAINER',container);
 let ready=0;for(let i=0;i<100&&ready<5;i++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(resolve=>setTimeout(resolve,500));}assert.equal(ready,5);
 removeDefaults();
 const files=readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')).sort();
 const manifest=[];
 for(const [index,file] of files.entries()){
  assert.equal(sql(defaults),'0','absent automatic grants before '+file);
  const bytes=readFileSync('supabase/migrations/'+file);
  try{sql(bytes.toString('utf8'));}catch(error){console.error('FAILED_MIGRATION',file,String(error.stderr));throw error;}
  manifest.push({path:'supabase/migrations/'+file,sha256:createHash('sha256').update(bytes).digest('hex')});
  if(Number(sql(defaults))){assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));assert.doesNotMatch(bytes.toString('utf8'),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);removeDefaults();}
  assert.equal(sql(defaults),'0','absent automatic grants after '+file);
  if(index%25===0)console.log('REPLAY_PROGRESS',index+1,file);
  await new Promise(resolve=>setImmediate(resolve));
 }
 check('own migration present',files.includes('20261003210000_static_weekly_splash_season_gate.sql'),true);
 console.log('EXACT_REPLAY_COMPLETE',files.length,createHash('sha256').update(JSON.stringify(manifest)).digest('hex'));
 const feedbackRecovery=JSON.parse(sql("select jsonb_build_object('object_identity','public.system_feedback_email_intents',\n  'stored_definition',(select definition_sql from public.custodial_release_authority_restore_inventory where object_kind='relation' and object_identity='public.system_feedback_email_intents'),\n  'stored_hash',(select definition_sha256 from public.custodial_release_authority_restore_inventory where object_kind='relation' and object_identity='public.system_feedback_email_intents'),\n  'actual_definition',public.custodial_release_authority_current_relation_definition('public.system_feedback_email_intents'),\n  'actual_hash',public.static_weekly_digest_text(public.custodial_release_authority_current_relation_definition('public.system_feedback_email_intents')))"));
 console.log('OPTIONAL_FEEDBACK_RELATION_RECOVERY_PREDECESSOR',JSON.stringify({object_identity:feedbackRecovery.object_identity,
  stored_hash:feedbackRecovery.stored_hash,actual_hash:feedbackRecovery.actual_hash}));
 if(process.env.SCH022_RELATION_RECEIPT){
  assert.match(process.env.SCH022_RELATION_RECEIPT,/^\/home\/eric\/Documents\/Codex\/2026-10-02\/events-worker\/[A-Za-z0-9_-]+\.json$/);
  writeFileSync(process.env.SCH022_RELATION_RECEIPT,JSON.stringify({scope:'synthetic predecessor relation mismatch only',
   production:false,container,image,source_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
   script_sha256:createHash('sha256').update(readFileSync('scripts/static-weekly-splash-season-gate-database-tests.mjs')).digest('hex'),
   control_plane_sha256:createHash('sha256').update(readFileSync('src/static-weekly-control-plane.js')).digest('hex'),
   migration_manifest_sha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),manifest,
   relation:feedbackRecovery},null,2)+'\n',{flag:'wx',mode:0o600});
 }
 const unknown=randomUUID(),member=randomUUID(),group=randomUUID();
 const ordinary=[{locationId:unknown,locationCode:'ORDINARY_RESTROOMS',includedLocationIds:[unknown]}];
 const splash=[{locationId:group,locationCode:'SPLASH_PAD_RESTROOMS',includedLocationIds:[member]}];
 const venue=[{locationId:unknown,locationCode:'SPLASH_PAD',includedLocationIds:[]}];
 const witness=(date,work)=>sql(`select public.static_weekly_sch022_work_witness(${quote(date)},${json(work)})`);
 const noTarget=witness('2026-10-05',ordinary);
 check('missing Splash catalog does not block unrelated six-person source',noTarget,witness('2027-05-31',ordinary));
 check('Event venue SPLASH_PAD is not restroom work',witness('2026-10-05',venue),noTarget);
 reject('exact group-code work fails closed when catalog absent',`select public.static_weekly_sch022_work_witness('2027-05-31',${json(splash)})`,/23514.*exact active custodial group/s);
 sql(`insert into public.location_groups(id,group_code,group_name,active) values(${quote(group)},'SPLASH_PAD_RESTROOMS','Synthetic Splash restroom group',true);
 insert into public.locations(id,location_code,location_name,location_type,active) values(${quote(member)},'SPLASH_RESTROOM_SYNTHETIC','Synthetic Splash restroom','restroom',true);
 insert into public.location_group_memberships(location_group_id,location_id,active) values(${quote(group)},${quote(member)},true);`);
 reject('before Memorial Day 2027 target duty denied',`select public.static_weekly_sch022_work_witness('2027-05-30',${json(splash)})`,/23514.*inactive before Memorial Day 2027/s);
 const allowed=witness('2027-05-31',splash);
 check('last Monday of May 2027 allowed with exact catalog witness',/^[0-9a-f]{64}$/.test(allowed),true);
 check('later target date same catalog witness',witness('2027-06-07',splash),allowed);
 sql(`update public.location_group_memberships set updated_at=updated_at+interval '1 second' where location_group_id=${quote(group)} and location_id=${quote(member)}`);
 check('same member IDs with advanced catalog source revision invalidate stale preview',witness('2027-05-31',splash)===allowed,false);
 reject('unknown target member denied',`select public.static_weekly_sch022_work_witness('2027-05-31',${json([{...splash[0],includedLocationIds:[unknown]}])})`,/23514.*exact group members/s);
 reject('group name alone cannot stand in for a physical member witness',`select public.static_weekly_sch022_work_witness('2027-05-31',${json([{locationId:group,locationCode:'SPLASH_PAD_RESTROOMS',includedLocationIds:[]}])})`,/23514.*exact group members/s);
 check('unrelated work can accompany target without becoming a false member',/^[0-9a-f]{64}$/.test(witness('2027-05-31',[...splash,...ordinary])),true);
 check('raw note mention is not a typed duty',witness('2026-10-05',[{...ordinary[0],locationCode:'ORDINARY_RESTROOMS'}]),noTarget);
 reject('extra untyped fields rejected',`select public.static_weekly_sch022_work_witness('2027-05-31',${json([{...ordinary[0],notes:'Splash Pad Restrooms'}])})`,/22023.*typed work identity/s);
 const secondMember=randomUUID();
 sql(`insert into public.locations(id,location_code,location_name,location_type,active) values(${quote(secondMember)},'SPLASH_RESTROOM_SECOND','Synthetic second Splash restroom','restroom',true);
 insert into public.location_group_memberships(location_group_id,location_id,active) values(${quote(group)},${quote(secondMember)},true);`);
 check('changed exact group membership invalidates preview witness',witness('2027-05-31',splash)===allowed,false);
 // Exercise the accepted v11 product path, including historical projection
 // reuse on cancellation. The earlier checks only call the final trigger.
 const week='2027-05-31',activeManager=randomUUID(),absentEmployee=randomUUID(),coverEmployee=randomUUID();
 const absentSlot=randomUUID(),coverSlot=randomUUID();
 sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
 values(${quote(activeManager)},'Synthetic Season Acceptance Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);
 insert into public.employees(id,employee_code,display_name,role,active) values
 (${quote(absentEmployee)},'SCH022_ABSENT','Synthetic Season Absent','staff',true),
 (${quote(coverEmployee)},'SCH022_COVER','Synthetic Season Cover','staff',true);`);
 const targetAssignments=Array.from({length:7},(_,dayOfWeek)=>({workId:`splash-${dayOfWeek}`,dayOfWeek,
  ownerSlotId:absentSlot,locationId:member,locationCodeSnapshot:'SPLASH_RESTROOM_SYNTHETIC',
  locationNameSnapshot:'Synthetic Splash restroom',
  includedLocations:[{locationId:member,locationNameSnapshot:'Synthetic Splash restroom'}],
  window:{start:'08:00',end:'08:15'},serviceEffortMinutes:5,serviceEffortProvenance:'sch022-fixture-effort',
  priority:1,priorityProvenance:'sch022-fixture-priority',requiredQualifications:['general'],
  qualificationProvenance:'sch022-fixture-role',restrictions:[],restrictionProvenance:'sch022-fixture-restrictions'}));
 const authoritySource=buildEventStaticAuthoritySource({weekStart:week,locationId:member,
  locationCode:'SPLASH_RESTROOM_SYNTHETIC',locationName:'Synthetic Splash restroom',
  employees:[{id:absentEmployee,displayName:'Synthetic Season Absent',slotId:absentSlot},
   {id:coverEmployee,displayName:'Synthetic Season Cover',slotId:coverSlot,noWork:true}],
  assignments:targetAssignments,label:'sch022-official'});
 authoritySource.versions[0].slotAvailability=authoritySource.versions[0].slotAvailability.map(row=>({
  ...row,lunch:row.slotId===absentSlot?{start:'12:00',end:'13:00'}:{start:'13:00',end:'14:00'},
 }));
 const fixture=await seedCompiledEventAuthority({sql,container,managerId:activeManager,
  dates:[week],source:authoritySource,label:'sch022-official',mode:'official'});
 const baselineProjection=fixture.projectionIds[week];
 check('official post-May31 publication and projection retain original accepted target',
  /^[0-9a-f-]{36}$/.test(baselineProjection),true);
 const currentRevision=()=>Number(sql('select current_revision from public.static_weekly_schedule_control where singleton'));
 async function prepareAcceptedPath(commandKind,targetAbsenceId=null){
  const expectedRevision=currentRevision();
  const semanticBody={absenceKind:commandKind==='absence'?'daily_absence':null,commandKind,
   employeeId:absentEmployee,endDate:week,startDate:week,targetAbsenceId};
  const begun=cp('static_weekly_v10_begin_staffing_command',`${json(semanticBody)},${quote(randomUUID())}::uuid,${expectedRevision},${quote(activeManager)}::uuid`);
  const source=cp('static_weekly_v3_read_publication_source',`${quote(fixture.publicationId)}::uuid,${quote(week)}::date`);
  const overlay=createStaffingWeekPreviewInput({operationId:begun.operation_id,managerId:activeManager,
   semanticBody,expectedRevision,weekStart:week,source,currentServiceDate:sql('select public.sch_service_date(statement_timestamp())::text')});
  const compiled=await compileStaticWeeklySchedule(overlay.input);
  check(`${commandKind} accepted compiler result`,compiled.status,'FEASIBLE');
  check(`${commandKind} accepted compiler verifier`,compiled.verifier?.ok,true);
  const prepared=createStaticWeeklyProjectionWithLunchRpcInput({result:compiled,
   publicationId:fixture.publicationId,expectedRevision,actor:{managerId:activeManager,
    managerName:'Synthetic Season Acceptance Manager',idempotencyKey:`staffing:${begun.operation_id}:${week}`}});
  const {lunchDocument,...projectionPayload}=prepared;
  const prior=cp('static_weekly_v11_read_current_refresh_targets',`${quote(week)}::date,${quote(week)}::date,${quote(activeManager)}::uuid`);
  const affected=new Set([absentEmployee,...prior.map(item=>item.employeeId)]);
  for(const assignment of prepared.envelope.assignments){
   if(assignment.service_date===week&&assignment.status==='assigned'&&assignment.owner_person_id)affected.add(assignment.owner_person_id);
  }
  for(const responsibility of lunchDocument.responsibilities||[]){
   if(responsibility.service_date===week)for(const id of [responsibility.normal_owner_person_id,responsibility.coverer_person_id])if(id)affected.add(id);
  }
  const candidates=[{candidateKind:'lunch',candidateKey:`week:${week}`,serviceDate:week,payload:lunchDocument},
   {candidateKind:'projection',candidateKey:`week:${week}`,serviceDate:week,payload:projectionPayload},
   ...[...affected].sort().map(employeeId=>({candidateKind:'schedule_refresh',candidateKey:`date:${week}:employee:${employeeId}`,
    serviceDate:week,payload:{employeeId,weekStart:week,publicationId:fixture.publicationId,
     projectionIdentity:prepared.envelope.database_projection_identity,lunchDocumentIdentity:lunchDocument.document_identity}}))];
  const candidateSet=createStaffingCandidateSet({window:{weeks:[week],dates:[week]},candidates});
  const rows=candidateSet.rows.map(({candidateKind,candidateKey,serviceDate,payload})=>({candidateKind,candidateKey,serviceDate,payload}));
  const season=cp('static_weekly_sch022_preview_staffing_witness',`${json(rows)},${quote(activeManager)}::uuid`);
  check(`${commandKind} preview binds target week`,season.target_week_count,1);
  const publicationVector={expectedRevision,weeks:[overlay.publication]};
  const inputDigest=canonicalDigest({operationId:begun.operation_id,semanticDigest:begun.semantic_digest,
   publicationVector,inputDigests:[canonicalDigest(overlay.input)]});
  const previewDigest=canonicalDigest({operationId:begun.operation_id,semanticDigest:begun.semantic_digest,
   candidateSetDigest:candidateSet.digest,publicationVector,summary:candidateSet.summary,seasonWitnessDigest:season.digest});
  const staged=cp('static_weekly_sch022_stage_staffing_command',`${quote(begun.operation_id)}::uuid,${json(rows)},
   ${quote(previewDigest)},${quote(inputDigest)},${json(publicationVector)},${quote(activeManager)}::uuid,${quote(season.digest)}`);
  check(`${commandKind} staged through current season wrapper`,staged.state,'PREPARED');
  return {...begun,previewDigest,confirmationKey:randomUUID(),expectedRevision};
 }
 const absence=await prepareAcceptedPath('absence');
 const acceptedAbsence=cp('static_weekly_v11_accept_staffing_command',`${quote(absence.operation_id)}::uuid,
  ${quote(absence.previewDigest)},${quote(absence.confirmationKey)}::uuid,${quote(activeManager)}::uuid`);
 check('actual v11 absence advances one authority revision',acceptedAbsence.authority_revision,absence.expectedRevision+1);
 check('actual v11 absence creates a new projection',acceptedAbsence.projections[week].reused,false);
 const cancellation=await prepareAcceptedPath('cancel_absence',absence.operation_id);
 const beforeStale=currentRevision(),beforeReceipts=sql('select count(*) from public.static_weekly_staffing_command_receipts');
 const transientMember=randomUUID();
 sql(`insert into public.locations(id,location_code,location_name,location_type,active) values
  (${quote(transientMember)},'SPLASH_RESTROOM_REUSE_DRIFT','Synthetic reuse-drift restroom','restroom',true);
  insert into public.location_group_memberships(location_group_id,location_id,active)
   values(${quote(group)},${quote(transientMember)},true)`);
 reject('actual v11 projection-reuse acceptance refuses stale catalog binding',`set role static_weekly_control_plane;
  select public.static_weekly_v11_accept_staffing_command(${quote(cancellation.operation_id)}::uuid,
   ${quote(cancellation.previewDigest)},${quote(cancellation.confirmationKey)}::uuid,${quote(activeManager)}::uuid)`,
  /40001.*current exact catalog preview/s);
 check('stale v11 reuse adds no accepted authority',currentRevision(),beforeStale);
 check('stale v11 reuse adds no command receipt',sql('select count(*) from public.static_weekly_staffing_command_receipts'),beforeReceipts);
 check('stale v11 reuse retains original prepared operation',sql(`select state from public.static_weekly_staffing_commands
  where operation_id=${quote(cancellation.operation_id)}`),'PREPARED');
 sql(`delete from public.location_group_memberships where location_group_id=${quote(group)} and location_id=${quote(transientMember)};
  delete from public.locations where id=${quote(transientMember)}`);
 const restored=cp('static_weekly_v11_accept_staffing_command',`${quote(cancellation.operation_id)}::uuid,
  ${quote(cancellation.previewDigest)},${quote(cancellation.confirmationKey)}::uuid,${quote(activeManager)}::uuid`);
 check('actual v11 cancellation reuses original exact projection',restored.projections[week].projection_id,baselineProjection);
 check('actual v11 cancellation marks historical reuse',restored.projections[week].reused,true);
 check('actual v11 accepted same-operation retry remains stable',
  cp('static_weekly_v11_accept_staffing_command',`${quote(cancellation.operation_id)}::uuid,
   ${quote(cancellation.previewDigest)},${quote(cancellation.confirmationKey)}::uuid,${quote(activeManager)}::uuid`).replayed,true);
 check('actual v11 exact retry adds no authority revision',currentRevision(),restored.authority_revision);
 const manager=randomUUID(),otherManager=randomUUID(),employee=randomUUID(),operation=randomUUID(),confirmation=randomUUID();
 sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values
 (${quote(manager)},'Synthetic SCH022 Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false),
 (${quote(otherManager)},'Synthetic SCH022 Other Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);
 insert into public.employees(id,employee_code,display_name,role,active) values(${quote(employee)},'SCH022_SYNTHETIC','Synthetic Season Employee','staff',true);
 insert into public.static_weekly_staffing_commands(operation_id,command_kind,employee_id,start_date,end_date,absence_kind,
 semantic_body,semantic_digest,client_prepare_key,expected_revision,prepared_by_manager_id,state)
 values(${quote(operation)},'absence',${quote(employee)},'2027-05-31','2027-05-31','daily_absence','{}'::jsonb,repeat('a',64),${quote(randomUUID())},
 (select current_revision from public.static_weekly_schedule_control where singleton),${quote(manager)},'PREPARING');`);
 const projectionPayload={envelope:{assignments:[{work_id:'synthetic-splash',work_snapshot:{locationId:group,
   locationCodeSnapshot:'SPLASH_PAD_RESTROOMS',includedLocations:[{locationId:member,locationNameSnapshot:'Synthetic Splash restroom'}]}}]}};
 const stageCandidates=[{candidateKind:'lunch',candidateKey:'week:2027-05-31',serviceDate:'2027-05-31',payload:{synthetic:'lunch-only'}},
  {candidateKind:'projection',candidateKey:'week:2027-05-31',serviceDate:'2027-05-31',payload:projectionPayload}];
 const preview=JSON.parse(sql(`set role static_weekly_control_plane;select public.static_weekly_sch022_preview_staffing_witness(${json(stageCandidates)},${quote(manager)})`));
 check('authenticated protected staffing preview binds target week',preview.target_week_count,1);
 check('protected staffing preview has digest',/^[0-9a-f]{64}$/.test(preview.digest),true);
 reject('stale staffing preview witness refused before staging',`set role static_weekly_control_plane;
 select public.static_weekly_sch022_stage_staffing_command(${quote(operation)},${json(stageCandidates)},repeat('b',64),repeat('c',64),
 ${json({expectedRevision:0,weeks:[]})},${quote(manager)},repeat('0',64))`,/40001.*catalog changed since manager preview/s);
 const staged=JSON.parse(sql(`set role static_weekly_control_plane;
 select public.static_weekly_sch022_stage_staffing_command(${quote(operation)},${json(stageCandidates)},repeat('b',64),repeat('c',64),
 ${json({expectedRevision:0,weeks:[]})},${quote(manager)},${quote(preview.digest)})`));
 check('original manager stages exact target-bearing witness',staged.state,'PREPARED');
 check('bound witness persisted privately',sql(`select witness_digest from public.static_weekly_sch022_staffing_witnesses where operation_id=${quote(operation)}`),preview.digest);
 const replay=JSON.parse(sql(`set role static_weekly_control_plane;
 select public.static_weekly_sch022_stage_staffing_command(${quote(operation)},${json(stageCandidates)},repeat('b',64),repeat('c',64),
 ${json({expectedRevision:0,weeks:[]})},${quote(manager)},${quote(preview.digest)})`));
 check('same manager exact staging replay retained',replay.replayed,true);
 reject('different named manager cannot rebind staged witness',`set role static_weekly_control_plane;
 select public.static_weekly_sch022_stage_staffing_command(${quote(operation)},${json(stageCandidates)},repeat('b',64),repeat('c',64),
 ${json({expectedRevision:0,weeks:[]})},${quote(otherManager)},${quote(preview.digest)})`,/42501.*original preparer/s);
 const thirdMember=randomUUID();
 sql(`insert into public.locations(id,location_code,location_name,location_type,active) values(${quote(thirdMember)},'SPLASH_RESTROOM_THIRD','Synthetic third Splash restroom','restroom',true);
 insert into public.location_group_memberships(location_group_id,location_id,active) values(${quote(group)},${quote(thirdMember)},true);`);
 const fakeAccept=`set app.static_weekly_staffing_write='on';update public.static_weekly_staffing_commands set state='ACCEPTED',
 confirmation_key=${quote(confirmation)},confirmed_by_manager_id=${quote(manager)},authority_command_id=${quote(operation)},
 accepted_revision=1,accepted_receipt='{}'::jsonb,accepted_at=statement_timestamp() where operation_id=${quote(operation)}`;
 reject('final prepared-to-accepted transition rejects catalog drift before any durable receipt',fakeAccept,/40001.*current exact catalog preview/s);
 check('stale final transition leaves original prepared command',sql(`select state from public.static_weekly_staffing_commands where operation_id=${quote(operation)}`),'PREPARED');
 sql(`delete from public.location_group_memberships where location_group_id=${quote(group)} and location_id=${quote(thirdMember)};
 delete from public.locations where id=${quote(thirdMember)};`);
 check('final protected transition allowed after exact source restored',sql(fakeAccept+';select state from public.static_weekly_staffing_commands where operation_id='+quote(operation)),'ACCEPTED');
 check('accepted witness and receipt row remain unchanged',sql(`select state from public.static_weekly_staffing_commands where operation_id=${quote(operation)}`),'ACCEPTED');
 reject('protected witness immutable after staging',`update public.static_weekly_sch022_staffing_witnesses set witness_digest=repeat('0',64) where operation_id=${quote(operation)}`,/append-only|durable|immutable|cannot be/i);
 const port=Number(docker(['port',container,'5432/tcp']).trim().split(':').at(-1));
 const pool=new Pool({host:'127.0.0.1',port,database:'postgres',user:'supabase_admin',password:'postgres',max:3,connectionTimeoutMillis:3000});
 const holder=await pool.connect(),waiter=await pool.connect();
 try{
  const concurrentMember=randomUUID();
  await holder.query('begin');
  await holder.query("select pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0))");
  await holder.query("insert into public.locations(id,location_code,location_name,location_type,active) values($1,'SPLASH_CONCURRENT','Synthetic concurrent restroom','restroom',true)",[concurrentMember]);
  await holder.query('insert into public.location_group_memberships(location_group_id,location_id,active) values($1,$2,true)',[group,concurrentMember]);
  const waiting=waiter.query('select public.static_weekly_sch022_work_witness($1::date,$2::jsonb) as witness',['2027-05-31',JSON.stringify(splash)]);
  waiting.catch(()=>{});
  let blocked=false;
  for(let attempt=0;attempt<100&&!blocked;attempt++){
   const observed=await pool.query("select wait_event_type='Lock' and wait_event='advisory' as blocked from pg_stat_activity where pid=$1",[waiter.processID]);
   blocked=observed.rows[0]?.blocked===true;
   if(!blocked)await new Promise(resolve=>setTimeout(resolve,10));
  }
  check('concurrent catalog publication witness waits behind common authority lock',blocked,true);
  await holder.query('commit');
  const after=(await waiting).rows[0].witness;
  check('waiting witness observes the committed new member, not old preview',after===allowed,false);
 }finally{await holder.query('rollback').catch(()=>{});holder.release();waiter.release();await pool.end();}
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator']){
  reject(role+' private preview denied',`set role ${role};select public.static_weekly_sch022_preview_witness('2027-05-31',${json(splash)},${quote(randomUUID())})`,/42501.*permission denied/s);
  reject(role+' private staffing stage denied',`set role ${role};select public.static_weekly_sch022_stage_staffing_command(${quote(randomUUID())},'[]'::jsonb,repeat('a',64),repeat('b',64),'{}'::jsonb,${quote(randomUUID())},repeat('c',64))`,/42501.*permission denied/s);
 }
 check('witness table forced RLS',sql("select relrowsecurity and relforcerowsecurity from pg_class where oid='public.static_weekly_sch022_staffing_witnesses'::regclass"),'t');
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
  check(role+' direct witness table denied',sql(`select has_table_privilege(${quote(role)},'public.static_weekly_sch022_staffing_witnesses','SELECT,INSERT,UPDATE,DELETE')`),'f');
 }
 for(const relation of ['weekly_schedule_publications','weekly_schedule_exception_commands','weekly_schedule_occurrences','static_weekly_staffing_commands']){
  check(relation+' final trigger enabled',sql(`select count(*) from pg_trigger where tgrelid=${quote('public.'+relation)}::regclass and tgname like 'trg_static_weekly_sch022_%' and tgenabled='O'`),'1');
  check(relation+' final trigger in recovery inventory',sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='trigger' and object_identity like ${quote('public.'+relation+'.trg_static_weekly_sch022_%')}`),'1');
 }
 check('new witness relation in recovery inventory',sql("select count(*) from public.custodial_release_authority_restore_inventory where object_kind in('relation','column_set','relation_state','grant') and object_identity='public.static_weekly_sch022_staffing_witnesses'"),'4');
 const receipt={status:'PASS',scope:'SCH022 typed season group/member/current-source proof on disposable full replay; actual compiled publication, v11 absence and cancellation projection-reuse admission, stale rollback and exact replay; exception/occurrence trigger registration and ACL; no production or physical release',checks:checks.length,
  source_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),container,image,
  script_sha256:createHash('sha256').update(readFileSync('scripts/static-weekly-splash-season-gate-database-tests.mjs')).digest('hex'),
  control_plane_sha256:createHash('sha256').update(readFileSync('src/static-weekly-control-plane.js')).digest('hex'),
  migration_count:files.length,migration_manifest_sha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),manifest,assertions:checks,
  limitations:['Current production Splash group/member IDs and pre-release old-source admission not inspected.','Dated exception and occurrence gates were checked by trigger registration; their full official mutation paths were not separately executed.']};
 if(process.env.SCH022_TEST_RECEIPT){
  assert.match(process.env.SCH022_TEST_RECEIPT,/^\/home\/eric\/Documents\/Codex\/2026-10-02\/events-worker\/[A-Za-z0-9_-]+\.json$/);
  writeFileSync(process.env.SCH022_TEST_RECEIPT,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
 }
 console.log(JSON.stringify({status:receipt.status,checks:receipt.checks,migration_count:receipt.migration_count,
  migration_manifest_sha256:receipt.migration_manifest_sha256,script_sha256:receipt.script_sha256,
  control_plane_sha256:receipt.control_plane_sha256,receipt_path:process.env.SCH022_TEST_RECEIPT||null,limitations:receipt.limitations}));
}finally{if(owned)docker(['rm','-f',container]);}
