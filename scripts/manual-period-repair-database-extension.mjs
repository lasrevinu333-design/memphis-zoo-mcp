// V2 test-only correction after preserved database009 failure. Original callback
// SHA2569b44bc09628855d87b250e36e44dad328b34af1d07a434c25c8d617788827b5e remains intact.
// Root-invoked only, on the existing freshly constructed and populated canonical304
// fixture. No constructor, environment URL, provider, fetch, listen or cleanup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {coverAllAccessTokenHash} from '../src/static-weekly-coverall-access.js';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),add=(d,n)=>new Date(Date.parse(d+'T12:00Z')+n*86400000).toISOString().slice(0,10);
export const schedulingRepairExternalDependencies=Object.freeze(['memphis-approved-schedule.js','memphis-scheduler-actions.js'].map(n=>fileURLToPath(new URL('../release/sealed-repair-frontend-source/'+n,import.meta.url))));
export function freezeSchedulingRepairExternalDependencies(){return schedulingRepairExternalDependencies.map(path=>{const s=fs.lstatSync(path);assert.ok(s.isFile()&&!s.isSymbolicLink());const bytes=fs.readFileSync(path);return{path,sha256:digest(bytes),bytes:bytes.length};});}
// Status precedence belongs to the actual SQL reader. A manager's staffing
// label alone cannot distinguish an absent projection from a stored stale one.
export function assertMissingApprovedPeriod({snapshot,state,frame,publicationId,versionId}) {
 const a=state.authority;assert.equal(a.projection_status,'missing_projection');assert.equal(a.governed,true);
 assert.equal(a.week_start,frame);assert.equal(a.publication_id,publicationId);assert.equal(a.version_id,versionId);
 assert.equal(a.projection_id,null);assert.equal(a.projection_authority_revision,null);
 assert.equal(state.matching_projection_rows,0);assert.deepEqual(state.projections,[]);
 assert.equal(snapshot.projection_status,'stale_staffing_change');assert.equal(snapshot.latest_projection,null);
 assert.equal(snapshot.projection_authority_revision,null);assert.ok(Number.isSafeInteger(a.staffing_authority_revision)&&a.staffing_authority_revision>0);
 assert.equal(snapshot.staffing_authority_revision,a.staffing_authority_revision);
 assert.equal(snapshot.approved_manual_period.frameStart,frame);assert.equal(snapshot.approved_manual_period.normalSourceLocked,true);
 assert.equal(snapshot.current_publication.publication_id,publicationId);assert.equal(snapshot.current_publication.version_id,versionId);
 assert.equal(Object.hasOwn(snapshot,'approved_manual_schedule'),false);assert.equal(snapshot.approved_manual_schedule,undefined);
}
export function assertStoredStaleHistoricalPeriod({state,serviceDate,currentPublicationId}) {
 const a=state.authority;assert.equal(a.governed,true);assert.equal(a.service_date,serviceDate);
 assert.equal(a.projection_status,'stale_staffing_change');assert.notEqual(a.publication_id,currentPublicationId);
 assert.match(a.projection_id,/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.ok(Number.isSafeInteger(a.projection_authority_revision)&&a.projection_authority_revision>0);
 assert.ok(Number.isSafeInteger(a.staffing_authority_revision)&&a.projection_authority_revision<=a.staffing_authority_revision);
 assert.equal(state.matching_projection_rows,1);assert.equal(state.projections.length,1);
 assert.equal(state.projections[0].id,a.projection_id);assert.equal(state.projections[0].week_start,a.week_start);
 assert.ok(serviceDate>=a.week_start&&serviceDate<=state.projections[0].week_end);
}
export async function runSchedulingRepairDatabaseExtension({fixture,pool,plane,manager,at,accepted,query,tx,save,sourceCurrent,cohort,externalSourceRefs}){
 assert.equal(typeof fixture?.assertOwned,'function');await fixture.assertOwned();assert.equal(fixture.receipt.selected_replay.migrations,304);
 assert.equal(pool.options.host,fixture.socketDirectory);assert.ok(fixture.socketDirectory?.startsWith('/'));
 for(const key of ['DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL'])assert.equal(process.env[key],undefined,'No ambient database/provider configuration');
 assert.ok(cohort?.manager&&typeof cohort.verifyTransaction==='function','Root must supply its current signed synthetic cohort');
 assert.deepEqual(externalSourceRefs,freezeSchedulingRepairExternalDependencies(),'Root must freeze exact frontend dependencies before construction');
 const frontend={URL,TextEncoder,console};for(const path of schedulingRepairExternalDependencies)vm.runInNewContext(fs.readFileSync(path,'utf8'),frontend,{filename:path});
 const A=frontend.MemphisSchedulerActions,week=readApprovedManualWeek(),checks=[],operations=[];
 const mark=(name,data={})=>{checks.push({name,status:'PASS',...data});save('SCHEDULING_CHECK_'+String(checks.length).padStart(3,'0')+'.json',checks.at(-1));};
 const perform=async(label,input,fn)=>{const n=operations.length+1;operations.push({label,input});save('SCHEDULING_OPERATION_'+n+'_BEFORE.json',{label,input});try{const value=await fn();save('SCHEDULING_OPERATION_'+n+'_RETURNED.json',{label,value});return value;}catch(e){save('SCHEDULING_OPERATION_'+n+'_ERROR.json',{label,code:e.code??null,message:e.message});throw e;}};
 const run=(method,input={},actor=manager,cp=plane,permission='write')=>perform(method,{...input,manager_id:actor.manager_id,credential_id:actor.credential_id},()=>cp.runManagerOperation({manager:actor,signal:new AbortController().signal,deadlineAt:performance.now()+120000,permission},()=>cp[method]({manager:actor,...input})));
 const snapshot=day=>run('getManagerSnapshot',{weekStart:day});
 const periodState=async(serviceDate,label)=>{
  const result=await query(`select jsonb_build_object('authority',to_jsonb(a),
   'matching_projection_rows',(select count(*)::integer from public.weekly_schedule_compiled_projections p where p.publication_id=a.publication_id and p.week_start=a.week_start),
   'projections',(select coalesce(jsonb_agg(jsonb_build_object('id',p.projection_id,'week_start',p.week_start,'week_end',p.week_end) order by p.projection_id),'[]'::jsonb)
    from public.weekly_schedule_compiled_projections p where p.publication_id=a.publication_id and p.week_start=a.week_start)) as value
   from public.static_weekly_v6_schedule_authority_state($1::date) a`,[serviceDate]);
  assert.equal(result.rows.length,1);const state=result.rows[0].value;save('SCHEDULING_PERIOD_STATE_'+label+'.json',{serviceDate,state});return state;
 };
 const revision=async()=>Number((await query('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision);
 const refused=async(name,fn,code)=>{let error;try{await fn();}catch(e){error=e;}assert.ok(error,name+' must reject');if(/^(08|57P|ECONN)/.test(String(error.code||''))||/unknown/i.test(String(error.code||'')))throw error;if(code)assert.equal(error.code,code);mark(name,{code:error.code??null});};
 const originalNormal=(await query('select s.source_id,s.source_digest,s.canonical_source from public.static_weekly_authority_source_documents s join public.weekly_schedule_versions v on v.authority_source_id=s.source_id join public.weekly_schedule_publications p using(version_id) where p.publication_id=$1',[accepted.publicationId])).rows;
 assert.equal(originalNormal.length,1);
 const current=await snapshot(at),origin=current.week_start;assert.equal(origin,at);assert.equal(current.approved_manual_period.frameStart,origin);assert.equal(current.approved_manual_period.normalSourceLocked,true);
 mark('F03 actual current source-aligned period metadata',{origin,weekday:new Date(origin+'T12:00Z').getUTCDay(),fridayClaim:false});
 const historicalDate=add(origin,-1),historicalStale=await periodState(historicalDate,'STORED_STALE_HISTORY_BEFORE');
 assertStoredStaleHistoricalPeriod({state:historicalStale,serviceDate:historicalDate,currentPublicationId:accepted.publicationId});
 mark('F03 actual stored-stale historical authority is distinct from an absent future projection',{serviceDate:historicalDate,
  projectionId:historicalStale.authority.projection_id,projectionRevision:historicalStale.authority.projection_authority_revision,
  staffingRevision:historicalStale.authority.staffing_authority_revision,scope:'HISTORICAL_STALE_READ_ONLY; not native-manual stale recovery'});
 const next=add(origin,7),missing=await snapshot(next),missingState=await periodState(next,'MISSING_FUTURE_BEFORE');
 assertMissingApprovedPeriod({snapshot:missing,state:missingState,frame:next,publicationId:accepted.publicationId,versionId:accepted.versionId});
 mark('F03 true absent native future projection has exact manager staffing-status precedence',{frame:next,
  authorityStatus:missingState.authority.projection_status,managerStatus:missing.projection_status,physicalProjectionCount:0});
 const rebuildInput={weekStart:next,expectedRevision:missing.authority_revision,idempotencyKey:'sealed-period-materialize:'+randomUUID()};
 await run('rebuildCurrentProjection',rebuildInput);const rebuilt=await snapshot(next);assert.equal(rebuilt.projection_status,'current');
 const materializedState=await periodState(next,'MATERIALIZED_FUTURE_AFTER');assert.equal(materializedState.authority.projection_status,'current');
 assert.equal(materializedState.authority.publication_id,accepted.publicationId);assert.equal(materializedState.authority.version_id,accepted.versionId);
 assert.equal(materializedState.authority.projection_id,rebuilt.latest_projection.projection_id);assert.equal(materializedState.matching_projection_rows,1);
 assert.equal(materializedState.projections[0].id,rebuilt.latest_projection.projection_id);
 assert.ok(materializedState.authority.projection_authority_revision>materializedState.authority.staffing_authority_revision);
 const replay=await run('rebuildCurrentProjection',rebuildInput);assert.equal(replay.replayed,true);assert.equal(replay.data.current_readback_repeated,true);assert.equal(replay.data.current_projection.projection_id,rebuilt.latest_projection.projection_id);
 mark('F03 missing next period materializes unchanged source and original retry reads persisted projection',{frame:next,projectionId:rebuilt.latest_projection.projection_id});
 async function prepare({employeeId,startDate,endDate,commandKind='absence',targetAbsenceId=null}){
  const first=await snapshot(startDate),body={command_kind:commandKind,employee_id:employeeId,start_date:startDate,end_date:endDate,client_prepare_key:randomUUID(),expected_revision:first.authority_revision,...(commandKind==='absence'?{absence_kind:'pto'}:{target_absence_id:targetAbsenceId})};
  const {bases}=await A.readStaffingBindings({snapshot:first,body,currentServiceDate:first.current_service_date,api:async path=>snapshot(new URL(path,'https://fixture.invalid').searchParams.get('week_start'))});
  const input={commandKind,employeeId,startDate,endDate,clientPrepareKey:body.client_prepare_key,expectedRevision:body.expected_revision,...(commandKind==='absence'?{absenceKind:'pto'}:{targetAbsenceId})};
  const begun=await run('beginStaffingCommand',input);assert.equal(begun.state,'PREPARING');
  const record={path:A.staffingCommandPath,body,managerId:manager.manager_id,weekBindings:bases,command:{operationId:begun.operation_id,semanticDigest:begun.semantic_digest,confirmationAttempted:false,confirmationKey:null}};
  return{begun,record,body,bases};
 }
 async function stageAndAccept(preparation){
  const {begun,record}=preparation;await run('prepareStaffingCommand',{operationId:begun.operation_id});
  const staged=await run('getStaffingCommand',{operationId:begun.operation_id});A.validateStaffingPreview(staged,record);assert.equal(staged.state,'PREPARED');
  const confirmationKey=randomUUID(),result=await run('acceptStaffingCommand',{operationId:begun.operation_id,previewDigest:staged.preview_digest,confirmationKey});assert.equal(result.event,'ACCEPTED');
  const read=await run('getStaffingCommand',{operationId:begun.operation_id});assert.equal(read.state,'ACCEPTED');assert.equal(read.preview_digest,staged.preview_digest);
  assert.deepEqual(JSON.parse(JSON.stringify(staged.publication_vector.weeks)),JSON.parse(JSON.stringify(preparation.bases)));
  for(const binding of preparation.bases){const s=await snapshot(binding.weekStart),p=read.accepted_receipt.projections[binding.weekStart];assert.equal(s.projection_status,'current');assert.equal(s.latest_projection.projection_id,p.projection_id);}
  return read;
 }
 // Actual three-day PTO and cancellation cross two approved publication frames.
 const range=await prepare({employeeId:week.referenceBindings.people[0].employeeId,startDate:add(origin,6),endDate:add(origin,8)});
 assert.equal(range.bases.length,2);assert.equal(range.bases[0].weekStart,origin);assert.equal(range.bases[1].weekStart,next);
 const ranged=await stageAndAccept(range);mark('F02 actual browser period vector passes persisted multi-frame PTO preview and acceptance',{operationId:ranged.operation_id,frames:range.bases});
 const cancellation=await prepare({employeeId:range.body.employee_id,startDate:range.body.start_date,endDate:range.body.end_date,commandKind:'cancel_absence',targetAbsenceId:ranged.operation_id});
 await stageAndAccept(cancellation);mark('F02 exact original multi-frame cancellation persists and reads both actual frames');
 // These approved employee identities/hours are the existing Tuesday pure
 // feasibility fixture. Dates derive from the server, never from its old date.
 const tuesday=add(origin,(2-new Date(origin+'T12:00Z').getUTCDay()+7)%7),absent=['8067cca2-7487-4589-ba7c-aa442e135045','d5fecc86-659b-464a-bc99-f0d914385db4'],third='3da709bb-2223-4e15-8e3a-db02e3f32e97';
 for(const employeeId of [...absent,third])assert.ok(week.referenceBindings.people.some(p=>p.employeeId===employeeId));
 for(const employeeId of absent)await stageAndAccept(await prepare({employeeId,startDate:tuesday,endDate:tuesday}));
 const thirdPreparation=await prepare({employeeId:third,startDate:tuesday,endDate:tuesday});
 await refused('Q01 exact third absence requires explicit CoverAll choice',()=>run('prepareStaffingCommand',{operationId:thirdPreparation.begun.operation_id}),'static_manual_coverall_choice_required');
 const options=await run('getApprovedManualCoverAllOptions',{operationId:thirdPreparation.begun.operation_id});A.validateCoverAllOptions(options,thirdPreparation.record);assert.equal(options.days.length,1);
 const option=options.days[0],capacity=option.capacities[0],helper=option.lunchCoverers.find(p=>p.slotId==='5d2d2a0e-230f-5b03-9867-2e4c2826871f');assert.ok(capacity&&helper);
 const days=[{service_date:tuesday,capacity_id:capacity.capacityId,shift:{start:'05:00',end:'14:00'},lunch:{start:'09:30',end:'10:30'},lunch_coverer_slot_id:helper.slotId,confirmation_reference:'OWNED SYNTHETIC FIXTURE; no vendor booked',actual_hours_confirmed:true}];A.validateCoverAllDays(options,days);
 const choice=await run('prepareApprovedManualCoverAllStaffing',{operationId:thirdPreparation.begun.operation_id,request:{choice_id:randomUUID(),days}});assert.equal(choice.state,'PREPARED');
 const thirdRead=await run('getStaffingCommand',{operationId:thirdPreparation.begun.operation_id});A.validateStaffingPreview(thirdRead,thirdPreparation.record);
 await run('acceptStaffingCommand',{operationId:thirdRead.operation_id,previewDigest:thirdRead.preview_digest,confirmationKey:randomUUID()});
 const thirdCurrent=await snapshot(tuesday);assert.equal(thirdCurrent.projection_status,'current');
 mark('Q01 third absence preserves retained two-absence basis with actual confirmed full-hour CoverAll choice',{operationId:thirdRead.operation_id,serviceDate:tuesday,capacityId:capacity.capacityId});
 const documentInput={weekStart:thirdCurrent.week_start,serviceDate:tuesday,expectedRevision:thirdCurrent.authority_revision,projectionId:thirdCurrent.latest_projection.projection_id};
 const namedDocument=await run('getCoverAllPrintDocument',documentInput,manager,plane,'manage_coverall');assert.equal(namedDocument.managerContact.authority,'AUTHENTICATED_NAMED_MANAGER');
 const cohortPlane=createStaticWeeklyControlPlane({database:{connect:async()=>{await fixture.assertOwned();return pool.connect();}},leadershipRequestActorVerifier:cohort.verifyTransaction});
 const tokens=[],links=[];
 try{
  for(const [kind,actor,cp] of [['named',manager,plane],['cohort',cohort.manager,cohortPlane]]){
   const request={...documentInput,capacityId:capacity.capacityId,requestId:randomUUID(),ttlHours:24};
   const link=await run('issueCoverAllAssignmentLink',request,actor,cp,'manage_coverall');links.push({kind,...link});
   const token=new URLSearchParams(link.assignment_path.split('#')[1]).get('access_token');assert.ok(token);tokens.push({kind,token,hash:coverAllAccessTokenHash(token),linkId:link.link_id,actor,cp});
   const read=await perform(kind+'_public_capability_read',{linkId:link.link_id},()=>plane.readCoverAllAssignmentLink({accessToken:token}));
   assert.equal(read.contractors.length,1);assert.equal(read.contractors[0].slotId,capacity.capacityId);assert.equal(read.managerContact.authority,kind==='named'?'AUTHENTICATED_NAMED_MANAGER':'AUTHENTICATED_COHORT_SELF_ASSERTED_NAME');
   if(kind==='cohort'){assert.equal(read.managerContact.identityAssurance,'SELF_ASSERTED_NAME');assert.equal(read.managerContact.individualIdentityVerified,false);assert.equal(read.managerContact.claimedAccountId,cohort.manager.claimed_manager_id);}
   mark('F09 '+kind+' actual accepted-period issue → persistence → public read',{linkId:link.link_id,period:documentInput.weekStart});
  }
  const rows=(await query('select manager_id,link_id,credential_id,cohort_registration_id,cohort_claimed_account_id,cohort_request_id from public.static_weekly_coverall_access_links where link_id=any($1::uuid[])',[links.map(l=>l.link_id)])).rows;
  assert.equal(rows.length,2);const cohortRow=rows.find(r=>r.manager_id===cohort.manager.manager_id);assert.equal(cohortRow.credential_id,null);assert.equal(cohortRow.cohort_registration_id,cohort.manager.credential_id);assert.equal(cohortRow.cohort_claimed_account_id,cohort.manager.claimed_manager_id);assert.ok(cohortRow.cohort_request_id);
  assert.equal(Number((await query('select count(*) n from public.ops_manager_trusted_devices where credential_id=$1',[cohort.manager.credential_id])).rows[0].n),0);mark('F09 distinct real cohort FK and original request/claim persisted without trusted-device mirror');
  const binding=(await query('select binding from public.static_weekly_coverall_access_links where manager_id=$1 and link_id=$2',[cohort.manager.manager_id,cohortRow.link_id])).rows[0].binding;
  const rawIssue=(c,actor,b)=>c.query('select public.static_weekly_issue_coverall_link($1,$2,$3,$4,$5,$6,$7,$8)',[actor.manager_id,actor.credential_id,actor.device_id,actor.access_level,randomUUID(),digest(randomUUID()),b,24]);
  await refused('F09 cohort issuance without original signed transaction context denied',()=>tx('static_weekly_control_plane',c=>rawIssue(c,cohort.manager,binding)),'42501');
  await refused('F09 SQL rejects caller period differing from actual accepted projection',()=>tx('static_weekly_control_plane',c=>rawIssue(c,manager,{...binding,week_start:add(documentInput.weekStart,tuesday>documentInput.weekStart?1:-1)})),'40001');
  await refused('F09 mixed legacy/cohort credential row denied',()=>tx('supabase_admin',c=>c.query('update public.static_weekly_coverall_access_links set credential_id=$1 where manager_id=$2 and link_id=$3',[manager.credential_id,cohort.manager.manager_id,cohortRow.link_id])),'23514');
  const sqlRead=(c,hash)=>c.query('select public.static_weekly_read_coverall_link($1)',[hash]);
  async function alteredDenial(label,token,sql,params){let error;await tx('supabase_admin',async c=>{await c.query('savepoint negative');try{await c.query(sql,params);await c.query('set local role static_weekly_control_plane');await sqlRead(c,token.hash);}catch(e){error=e;}await c.query('rollback to savepoint negative');});assert.ok(error,label);assert.ok(['42501','40001'].includes(error.code),label+': '+error.code);mark(label,{code:error.code,rolledBack:true});}
  const named=tokens.find(t=>t.kind==='named'),shared=tokens.find(t=>t.kind==='cohort');
  await alteredDenial('F09 named original credential revocation denies read',named,'update public.ops_manager_trusted_devices set revoked_at=clock_timestamp() where credential_id=$1',[manager.credential_id]);
  await alteredDenial('F09 cohort registration revocation denies public read',shared,'update custodial_leadership_private.registrations set revoked_at=clock_timestamp() where registration_id=$1',[cohort.manager.credential_id]);
  await alteredDenial('F09 changed cohort policy epoch denies public read',shared,'update custodial_leadership_private.policy set security_epoch=security_epoch+1 where singleton',[]);
  await alteredDenial('F09 changed original browser binding denies public read',shared,"update public.static_weekly_coverall_access_links set device_id='unrelated-browser' where manager_id=$1 and link_id=$2",[cohort.manager.manager_id,shared.linkId]);
  await alteredDenial('F09 expired capability denies read',shared,"update public.static_weekly_coverall_access_links set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where manager_id=$1 and link_id=$2",[cohort.manager.manager_id,shared.linkId]);
  await alteredDenial('F09 changed authority revision denies stale read',shared,'update public.static_weekly_schedule_control set current_revision=current_revision+1 where singleton',[]);
  for(const role of ['anon','authenticated','service_role'])await refused('F09 '+role+' cannot read capability SQL',()=>tx(role,c=>sqlRead(c,shared.hash)),'42501');
  await refused('F09 CP cannot invoke private cohort resolver',()=>tx('static_weekly_control_plane',c=>c.query('select custodial_leadership_private.coverall_link_issuer($1,null,$2,$3,$4,$5,1,1)',[cohort.manager.manager_id,cohort.manager.device_id,'full_access',cohort.manager.credential_id,cohort.manager.claimed_manager_id])),'42501');
  for(const token of tokens){await run('revokeCoverAllAssignmentLink',{linkId:token.linkId},token.actor,token.cp,'manage_coverall');await refused('F09 '+token.kind+' explicit revoke denies public read',()=>plane.readCoverAllAssignmentLink({accessToken:token.token}),'42501');}
  const revoked=(await query('select cohort_revoked_registration_id,cohort_revoked_claimed_account_id,cohort_revoked_request_id from public.static_weekly_coverall_access_links where manager_id=$1 and link_id=$2',[cohort.manager.manager_id,shared.linkId])).rows[0];assert.equal(revoked.cohort_revoked_registration_id,cohort.manager.credential_id);assert.equal(revoked.cohort_revoked_claimed_account_id,cohort.manager.claimed_manager_id);assert.ok(revoked.cohort_revoked_request_id);mark('F09 cohort revocation preserves actual original registration/claim/request');
  const tombstone=randomUUID();await run('revokeCoverAllAssignmentLink',{linkId:tombstone},cohort.manager,cohortPlane,'manage_coverall');
  await refused('F09 cohort durable tombstone blocks delayed original issue',()=>run('issueCoverAllAssignmentLink',{...documentInput,capacityId:capacity.capacityId,requestId:tombstone,ttlHours:24},cohort.manager,cohortPlane,'manage_coverall'),'23505');
 }finally{await cohortPlane.close();}
 const normalAfter=(await query('select s.source_id,s.source_digest,s.canonical_source from public.static_weekly_authority_source_documents s join public.weekly_schedule_versions v on v.authority_source_id=s.source_id join public.weekly_schedule_publications p using(version_id) where p.publication_id=$1',[accepted.publicationId])).rows;assert.deepEqual(normalAfter,originalNormal);
 const historicalAfter=await periodState(historicalDate,'STORED_STALE_HISTORY_AFTER');assert.deepEqual(historicalAfter,historicalStale);
 mark('Historical stored-stale authority preserved without rebuild or source changes',{scope:'HISTORICAL_STALE_READ_ONLY'});
 sourceCurrent();assert.deepEqual(externalSourceRefs,freezeSchedulingRepairExternalDependencies());mark('Approved normal source preserved after dated adjustments; source bytes frozen');
 const result={status:'PASS',checks,operations:operations.length,origin,productionWritten:false,providerCalls:0,physicalBrowser:false,physicalPhone:false,canonicalIdentityQualified:false,finalAudit:false};save('SCHEDULING_EXTENSION_RESULT.json',result);return result;
}
