import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {postgresJsonbContentDigest,postgresJsonbCanonicalText} from '../src/static-weekly-schedule-compiler.js';
import {canonicalJson} from '../src/static-weekly-schedule-model.js';
import {enumerateStaffingServiceWindow} from '../src/static-weekly-staffing-preparation.js';
// NEW owning pure vacancy mapping member; no CP/pg, solver, SQL or old member
// executes in this mode. Ordinary existing member import remains below it.
if(process.argv[2]==='--vacancy-manager-preview-only'){
  const {createVacancyManagerPreview,workerCandidateDigest}=await import('../src/static-weekly-vacancy-preview.js');
  const id=n=>`${n}0000000-0000-4000-8000-000000000001`,pg=postgresJsonbContentDigest;
  const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
  const marker='SYNTHETIC_PRIVATE_SOURCE_NOT_FOR_RENDERING';
  function fixture(){
    const input={managerId:id(1),sourceId:id(2),slotId:id(3),employeeId:id(4),effectiveStart:'2026-10-12',weekStart:'2026-10-12',
      expectedRevision:19,idempotencyKey:'synthetic-original-vacancy',reasonDigest:sha('Normalized manager reason'),
      registeredSourceDigest:'a'.repeat(64),currentSourceDigest:'b'.repeat(64),publicationId:id(5)};
    const availability=Array.from({length:7},(_,offset)=>{const serviceDate=`2026-10-${12+offset}`,dayOfWeek=(offset+1)%7;
      return {slotId:id(6),serviceDate,dayOfWeek,status:'working',shift:{start:'08:00',end:'17:00'},lunch:{start:'12:00',end:'13:00'},
        blockedWindows:[],productiveCapacityMinutes:480,maxServiceEffortMinutes:480,maxDutyMinutes:480,
        incumbentSlotId:id(6),incumbentSlotLabel:'Current position',incumbentPersonId:id(7),incumbentName:'Current person',
        capacityProvenance:marker,restrictions:[marker]};});
    const assignments=availability.map(a=>({plan_work_id:`${a.dayOfWeek}:original-work`,work_id:'original-work',day_of_week:a.dayOfWeek,
      service_date:a.serviceDate,status:'assigned',owner_slot_id:id(6),owner_person_id:id(7),baseline_owner_slot_id:id(3),
      baseline_owner_person_id:id(4),baseline_owner_name:'Original person',original_actor_person_id:id(4),
      optimized_owner_slot_id:id(6),optimized_owner_person_id:id(7),owner_digest:'c'.repeat(64),exact_owner_identity:'d'.repeat(64),
      work_snapshot:{workId:'original-work',dayOfWeek:a.dayOfWeek,originSlotId:id(3),locationId:id(8),locationCodeSnapshot:'LOC',
        locationNameSnapshot:'Actual location',serviceMode:'scan_tracked',window:{start:'09:00',end:'10:00'},includedLocations:[],
        serviceEffortMinutes:60,priority:1,required:true,bestEffortCoverage:false,manualLock:false,manualLockSlotId:null,overlayWork:false,
        serviceEffortProvenance:marker,restrictionProvenance:marker,qualificationProvenance:marker},explanation:{private:marker}}));
    const objective={mode:'strict-lexicographic',rankingOrder:['coverage','equity'],exactEquityCommonDenominator:480,privateCertificate:marker};
    const metrics={daily:availability.map(a=>({dayOfWeek:a.dayOfWeek,normalizedInequity:0,exactNormalizedInequity:0,
      loads:[{slotId:id(6),serviceEffortMinutes:60,productiveCapacityMinutes:480,dutyCapacityMinutes:480,totalDutyMinutes:60,private:marker}]})),
      weekly:{normalizedInequity:0,incrementalDirectedRouteCost:0,disruption:0,resource:'verified productive minutes',
        productiveCapacityMinutes:{[id(6)]:3360},private:marker},dutySemantics:{workload:'relative workload units',service:'declared effort minutes'},private:marker};
    const authority={effectiveDate:input.weekStart,inputDigest:'e'.repeat(64),projectionAvailability:availability,
      compilerInput:{privateLeaveReason:marker},optimizerResult:{objective,metrics,certificate:{secret:marker}}};
    const envelope={service_date:input.weekStart,week_start:input.weekStart,week_end:'2026-10-18',authority,
      receipt:{private:marker},authority_digest:pg(authority),replay_digest:'f'.repeat(64),compiler_version:'synthetic-normal-shape',
      objective,metrics,assignments,semantic_snapshot:{private:marker},applied_exceptions:[]};
    envelope.database_projection_identity=pg(envelope);
    const loan={loan_id:'1'.repeat(64),service_date:input.weekStart,day_of_week:1,normal_owner_slot_id:id(6),normal_owner_person_id:id(7),
      coverage_start:'12:00',coverage_end:'13:00',status:'PLANNED',helper_slot_ids:[id(9)],total_distance_minutes:5,reason:marker,fallback:{private:marker}};
    const responsibility={responsibility_id:'2'.repeat(64),loan_id:loan.loan_id,service_date:input.weekStart,day_of_week:1,
      normal_owner_slot_id:id(6),normal_owner_person_id:id(7),coverer_slot_id:id(9),coverer_person_id:id(0),
      coverage_purpose:'lunch_coverage',coverage_start:'12:00',coverage_end:'13:00',check_deadline_policy:'inherit_existing_90_minute_deadline',
      creates_deep_clean:false,proximity_evidence:[{private:marker}],segments:[{planWorkId:'1:original-work',workId:'original-work',
        serviceMode:'scan_tracked',window:{start:'12:00',end:'13:00'},includedLocations:[],private:marker}]};
    const lunchDocument={schema:'memphis-zoo.static-weekly-lunch-authority-document.v1',persistence_authority:'NOT_PERSISTED',verification_status:'VERIFIED',
      week_start:input.weekStart,base_authority_digest:envelope.authority_digest,base_replay_digest:envelope.replay_digest,
      source_input_digest:'3'.repeat(64),candidate_digest:'4'.repeat(64),loans:[loan],responsibilities:[responsibility],notification_intents:[],private:marker};
    input.projection={publicationId:input.publicationId,serviceDate:input.weekStart,exceptionSetDigest:'5'.repeat(64),compilerVersion:envelope.compiler_version,
      objective,metrics,replayDigest:envelope.replay_digest,envelope,expectedRevision:20,actorManagerId:input.managerId,actorManagerName:'Named manager',
      idempotencyKey:`projection-${sha(input.idempotencyKey)}`,lunchDocument,openingCoverageReport:{sourceOnly:marker}};
    repin(input);return input;
  }
  function repin(i){const p=i.projection,e=p.envelope,l=p.lunchDocument;
    e.authority_digest=pg(e.authority);delete e.database_projection_identity;e.database_projection_identity=pg(e);
    l.base_authority_digest=e.authority_digest;l.base_replay_digest=p.replayDigest;
    l.semantic_snapshot={schema:'memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',loans_digest:pg(l.loans),
      responsibilities_digest:pg(l.responsibilities),notification_intents_digest:pg(l.notification_intents)};
    delete l.document_identity;l.document_identity=pg(l);
  }
  const results=[];function check(name,body){body();results.push(name);}
  check('full affected dated work/capacity/lunch map, revision phases and original person distinction',()=>{
    const i=fixture(),before=canonicalJson(i),v=createVacancyManagerPreview(i);
    assert.equal(v.schema,'custodial.stable-vacancy-preview.v1');assert.equal(v.projectionExpectedRevision,20);assert.equal(v.resultingRevision,21);
    assert.equal(v.employeeId,id(4));assert.equal(v.preview.assignments[0].ownerPersonId,id(7));assert.equal(v.preview.assignments[0].baselineOwnerPersonId,id(4));
    assert.equal(v.preview.assignments.length,7);assert.equal(v.preview.projectionAvailability.length,7);
    assert.equal(v.preview.metrics.daily[0].loads[0].productiveCapacityMinutes,480);assert.equal(v.preview.lunchDocument.responsibilities[0].covererPersonId,id(0));
    assert.equal(v.preview.sourceDigest,'e'.repeat(64));assert.equal(v.preview.sourceDigestBasis,'envelope.authority.inputDigest');
    assert.equal(v.accepted,false);assert.equal(v.persisted,false);assert.equal(v.phoneUpdated,false);
    assert.equal(canonicalJson(i),before);assert.deepEqual(createVacancyManagerPreview(i),v);
    assert(!JSON.stringify(v).includes(marker));assert(!JSON.stringify(v).includes('compilerInput'));assert(!JSON.stringify(v).includes('notification_intents'));
  });
  check('worker digest exact PG twelve-field subset, not name/report/full preview or persisted attestation',()=>{
    const i=fixture(),v=createVacancyManagerPreview(i),keys=['publicationId','serviceDate','exceptionSetDigest','compilerVersion','objective','metrics',
      'replayDigest','envelope','expectedRevision','actorManagerId','idempotencyKey','lunchDocument'];
    assert.equal(v.workerCandidateDigest,pg(Object.fromEntries(keys.map(k=>[k,i.projection[k]]))));
    const changed=structuredClone(i);changed.projection.actorManagerName='Another source name';changed.projection.openingCoverageReport={private:'changed'};
    assert.equal(workerCandidateDigest(changed.projection),v.workerCandidateDigest);assert.notEqual(createVacancyManagerPreview(changed).previewDigest,v.previewDigest);
    const stored=structuredClone(i.projection);stored.envelope.attestation={server:true};assert.throws(()=>workerCandidateDigest(stored));
  });
  for(const [name,edit] of [
    ['private compiler/source change',i=>{i.projection.envelope.authority.compilerInput.privateLeaveReason='changed';repin(i);} ],
    ['private paired lunch source change',i=>{i.projection.lunchDocument.loans[0].reason='changed';repin(i);} ],
    ['private envelope receipt change',i=>{i.projection.envelope.receipt.private='changed';repin(i);} ],
    ['normalized original reason digest',i=>{i.reasonDigest='6'.repeat(64);} ],
    ['independent registered source digest',i=>{i.registeredSourceDigest='7'.repeat(64);} ],
    ['independent current source digest',i=>{i.currentSourceDigest='8'.repeat(64);} ],
  ])check(name+' changes COMPLETE preview digest without leaking omitted data',()=>{
    const i=fixture(),before=createVacancyManagerPreview(i);edit(i);const after=createVacancyManagerPreview(i);
    assert.notEqual(after.previewDigest,before.previewDigest);assert(!JSON.stringify(after).includes(marker));
  });
  const invalid=[
    ['foreign manager',i=>{i.projection.actorManagerId=id(0);}],['foreign publication',i=>{i.projection.publicationId=id(0);}],
    ['original instead of post-vacancy projection revision',i=>{i.projection.expectedRevision=19;}],
    ['original instead of derived projection key',i=>{i.projection.idempotencyKey=i.idempotencyKey;}],
    ['wrong week/date',i=>{i.projection.envelope.service_date='2026-10-13';repin(i);}],
    ['unavailable source pin',i=>{delete i.currentSourceDigest;}],['raw entered reason forbidden',i=>{i.reason='private';}],
    ['unknown projection field',i=>{i.projection.accepted=true;}],['submitted top-level attestation even repinned',i=>{i.projection.envelope.attestation={fake:true};repin(i);}],
    ['missing availability',i=>{delete i.projection.envelope.authority.projectionAvailability;repin(i);}],
    ['duplicate availability row',i=>{i.projection.envelope.authority.projectionAvailability.push(i.projection.envelope.authority.projectionAvailability[0]);repin(i);}],
    ['missing individual shift',i=>{delete i.projection.envelope.authority.projectionAvailability[0].shift;repin(i);}],
    ['missing individual verified available-time metric',i=>{delete i.projection.metrics.daily[0].loads[0].productiveCapacityMinutes;repin(i);}],
    ['missing paired lunch',i=>{delete i.projection.lunchDocument;}],['mixed lunch base replay',i=>{i.projection.lunchDocument.base_replay_digest='0'.repeat(64);
      delete i.projection.lunchDocument.document_identity;i.projection.lunchDocument.document_identity=pg(i.projection.lunchDocument);}],
    ['dropped responsibility with stale semantic digest',i=>{i.projection.lunchDocument.responsibilities=[];delete i.projection.lunchDocument.document_identity;
      i.projection.lunchDocument.document_identity=pg(i.projection.lunchDocument);}],
    ['wrong assignment service-day identity',i=>{i.projection.envelope.assignments[0].service_date='2026-10-19';repin(i);}],
    ['unknown assignment status',i=>{i.projection.envelope.assignments[0].status='COMPLETE';repin(i);}],
    ['non-JSON getter',i=>{Object.defineProperty(i.projection,'metrics',{enumerable:true,get(){throw Error('must not invoke getter');}});}],
    ['nonfinite quantitative metric',i=>{i.projection.metrics.daily[0].loads[0].totalDutyMinutes=NaN;}],
    ['oversized assignments',i=>{i.projection.envelope.assignments=Array.from({length:1025},()=>i.projection.envelope.assignments[0]);repin(i);}],
  ];
  for(const[name,edit]of invalid)check(name+' refuses without authority/default/truncation',()=>{const i=fixture();edit(i);assert.throws(()=>createVacancyManagerPreview(i),e=>e.code==='vacancy_manager_preview_invalid');});
  check('output detached from mutable original prepared source',()=>{const i=fixture(),v=createVacancyManagerPreview(i),before=JSON.stringify(v);
    i.projection.envelope.assignments[0].work_snapshot.window.start='10:00';i.projection.envelope.authority.projectionAvailability[0].incumbentName='changed';
    assert.equal(JSON.stringify(v),before);});
  console.log(JSON.stringify({status:'PASS_NEW_VACANCY_PAGE_DOMAIN_MEMBER',cases:results.length,results,
    scope:'synthetic normal projection/lunch shape, actual pure exported domain and PG/canonical serializers only',SQL:false,solver:false,
    realManager:false,persisted:false,phoneUpdated:false}));process.exit(0);
}
const {createStaticWeeklyControlPlane}=await import('../src/static-weekly-control-plane.js');
const require=createRequire(import.meta.url);
const {prepareValue}=require('pg/lib/utils');
// Actual CP method + the separately sealed pure domain dependency; the SQL
// client and compiler boundary are synthetic. No solver/auth/runtime proof.
if (['--original-cancellation-target-only','--original-cancellation-target-before-only',
  '--cancellation-sql-digest-only','--cancellation-sql-digest-before-only'].includes(process.argv[2])) {
  const id = n => `${n}0000000-0000-4000-8000-000000000001`;
  const actor = {manager_id:id(1),manager_display_name:'Named Manager',read_only:false,
    auth_mode:'trusted_device',credential_id:id(9),device_id:'synthetic-current-device',access_level:'full_access'};
  const originalPerson=id(2), operationId=id(3), absenceId=id(4), replacement=id(5), lunchOwner=id(6);
  const publicationId=id(7), versionId=id(8);
  // Persisted semantic_digest is static_weekly_digest_jsonb(body::jsonb),
  // NOT the browser/domain canonicalJson semantic request digest.
  const digest = postgresJsonbContentDigest;
  async function run(options={}) {
    const semantic = {absenceKind:null,commandKind:'cancel_absence',employeeId:originalPerson,
      startDate:'2026-10-12',endDate:'2026-10-20',targetAbsenceId:absenceId};
    const command = {operation_id:operationId,state:'PREPARING',semantic_body:semantic,
      semantic_digest:digest(semantic),expected_revision:19,prepared_by_manager_id:actor.manager_id,
      current_service_date:'2026-10-12',original_cancellation_target:{absenceId,employeeId:originalPerson,
        startDate:'2026-10-01',endDate:'2026-10-20',acceptedOperationId:absenceId,status:'accepted'}};
    options.editCommand?.(command);
    const original=structuredClone(command), calls=[], compiled=[], sources=[], staged=[];
    let releases=0, actorReads=0;
    const client={async query(statement,values=[]){
      calls.push({statement,values:structuredClone(values)});
      if(statement.includes('custodial_action_actor_v1')){
        actorReads++;
        return {rows:[{result:{manager_id:options.denyActorAt===actorReads?id(0):actor.manager_id,
          credential_id:actor.credential_id,device_id:actor.device_id,owner:true}}]};
      }
      if(statement.includes('static_weekly_v10_read_staffing_command'))return {rows:[{result:command}]};
      if(statement.includes('static_weekly_v11_read_current_refresh_targets')){
        options.duringRefresh?.(command);
        return {rows:[{result:options.refreshUnknown?null:[
          {serviceDate:'2026-10-12',employeeId:lunchOwner},
          ...(options.originalPrior?[{serviceDate:'2026-10-13',employeeId:originalPerson}]:[])]}]};
      }
      if(statement.includes('static_weekly_v3_read_manager_snapshot'))return {rows:[{result:{
        authority_revision:options.staleWeek===values[0]?20:19,
        current_publication:{publication_id:publicationId}}}]};
      if(statement.includes('static_weekly_v3_read_publication_source')){
        const source={authority_revision:19,publication_id:publicationId,version_id:versionId,
          exceptions:[],compiler_input:{timezone:'America/Chicago',proximity:[],slots:[{id:'slot-current',
            incumbencies:[{personId:options.incumbentOriginal?originalPerson:replacement,
              effectiveStart:'2020-01-01',effectiveEnd:null}]}],version:{id:'current-version',slotAvailability:[]}}};
        sources.push({week:values[1],source:structuredClone(source)});
        return {rows:[{result:source}]};
      }
      if(statement.includes('static_weekly_sch022_preview_staffing_witness'))return {rows:[{result:{digest:'f'.repeat(64),target_week_count:0}}]};
      if(statement.includes('static_weekly_sch022_stage_staffing_command')){
        staged.push(structuredClone(values));return {rows:[{result:{operation_id:operationId,state:'PREPARED'}}]};
      }
      return {rows:[]};
    },release(){releases++;},on(){},removeListener(){}};
    const plane=createStaticWeeklyControlPlane({database:{async connect(){return client;}},
      compiler:async()=>{throw Error('Full compiler forbidden in this member');},
      compilerPreparer:async(input,preparation)=>{
        compiled.push({input:structuredClone(input),preparation:structuredClone(preparation)});
        const dates=enumerateStaffingServiceWindow(original.semantic_body.startDate,original.semantic_body.endDate).dates
          .filter(date=>date>=input.serviceDate&&date<=new Date(Date.parse(`${input.serviceDate}T00:00:00Z`)+6*86400000).toISOString().slice(0,10));
        return {publicationId:preparation.publicationId,serviceDate:input.serviceDate,exceptionSetDigest:'b'.repeat(64),
          compilerVersion:'synthetic',objective:{},metrics:{},replayDigest:'c'.repeat(64),
          envelope:{database_projection_identity:'d'.repeat(64),assignments:dates.map(service_date=>({
            service_date,status:'assigned',owner_person_id:options.originalNewWork?originalPerson:replacement}))},
          expectedRevision:preparation.expectedRevision,actorManagerId:actor.manager_id,actorManagerName:actor.manager_display_name,
          idempotencyKey:preparation.actor.idempotencyKey,lunchDocument:{document_identity:'e'.repeat(64),
            responsibilities:[{service_date:dates[0],normal_owner_person_id:replacement,coverer_person_id:lunchOwner}]}};
      },initializeSolver:async()=>{},getSolverReadiness:()=>({available:true})});
    let result,error;
    try {
      result=await plane.runManagerOperation({manager:actor,signal:new AbortController().signal,
        deadlineAt:performance.now()+120000},()=>plane.prepareStaffingCommand({manager:actor,operationId}));
    } catch(cause){error=cause;} finally{await plane.close();}
    assert.equal(releases,1,'same owning synthetic client settled and released');
    const rows=staged.length?JSON.parse(staged[0][1]):[];
    return {result,error,calls,compiled,sources,staged,rows,original,actorReads};
  }
  if(process.argv[2]==='--cancellation-sql-digest-before-only'){
    const before=await run();
    assert.equal(before.error?.code,'staffing_original_cancellation_target_invalid');
    assert.equal(before.compiled.length,0);assert.equal(before.staged.length,0);
    assert.ok(!before.calls.some(row=>row.statement.includes('read_current_refresh_targets')));
    console.log(JSON.stringify({status:'REPRODUCED',cases:1,error:before.error.code,
      scope:'sealed prior CP rejects source-pinned PostgreSQL-format semantic digest; synthetic SQL/compiler'}));
    process.exit(0);
  }
  if(process.argv[2]==='--cancellation-sql-digest-only'){
    const names=[];
    const r=await run();assert.ifError(r.error);
    const semantic=r.original.semantic_body;
    const pgText=`{"endDate": "2026-10-20", "startDate": "2026-10-12", "employeeId": "${originalPerson}", "absenceKind": null, "commandKind": "cancel_absence", "targetAbsenceId": "${absenceId}"}`;
    assert.equal(postgresJsonbCanonicalText(semantic),pgText);
    assert.equal(digest(semantic),createHash('sha256').update(pgText).digest('hex'));
    assert.notEqual(digest(semantic),createHash('sha256').update(canonicalJson(semantic)).digest('hex'));
    names.push('SQL jsonb text key order/spacing pins exact persisted digest');
    assert.equal(r.result.state,'PREPARED');assert.equal(r.compiled.length,2);
    assert.ok(!r.rows.some(row=>row.candidateKind==='schedule_refresh'&&row.payload.employeeId===originalPerson));
    assert.deepEqual(JSON.parse(r.calls.find(row=>row.statement.includes('preview_staffing_witness')).values[0]),r.rows);
    names.push('persisted PostgreSQL-format digest prepares both owning weeks');
    for(const [name,editCommand,code] of [
      ['request canonicalJson digest is not persisted authority',c=>{c.semantic_digest=createHash('sha256').update(canonicalJson(c.semantic_body)).digest('hex');},'staffing_original_cancellation_target_invalid'],
      ['changed saved body with unchanged PG digest refuses',c=>{c.semantic_body.startDate='2026-10-13';},'staffing_original_cancellation_target_invalid'],
      ['rehashing changed body cannot waive original remaining window',c=>{c.semantic_body.startDate='2026-10-13';c.semantic_digest=digest(c.semantic_body);},'staffing_original_cancellation_target_window_changed'],
    ]){
      const bad=await run({editCommand});assert.equal(bad.error?.code,code);
      assert.equal(bad.compiled.length,0);assert.equal(bad.staged.length,0);
      assert.ok(!bad.calls.some(row=>row.statement.includes('read_current_refresh_targets')));
      names.push(name);
    }
    const mutated=await run({duringRefresh:c=>{
      c.semantic_digest='0'.repeat(64);c.semantic_body.startDate='2026-10-13';c.expected_revision=20;
      c.original_cancellation_target.employeeId=replacement;
    }});assert.ifError(mutated.error);assert.equal(mutated.compiled.length,2);
    assert.equal(mutated.staged[0][4].expectedRevision,19);
    names.push('captured persisted PG semantic pins survive awaited mutation');
    console.log(JSON.stringify({status:'PASS',cases:names.length,results:names,
      pgSemanticText:pgText,pgSemanticDigest:digest(semantic),scope:'actual CP + sealed domain; source-pinned PG serializer with synthetic SQL/compiler',
      sqlExecuted:false,solverExecuted:false,normalManagerProof:false,publicationProven:false}));
    process.exit(0);
  }
  if(process.argv[2]==='--original-cancellation-target-before-only'){
    const before=await run();
    assert.equal(before.error?.code,'staffing_preview_employee_slot_unavailable');
    assert.equal(before.compiled.length,0);assert.equal(before.staged.length,0);
    console.log(JSON.stringify({status:'REPRODUCED',cases:1,error:before.error.code,
      scope:'pinned original CP with sealed domain dependency and synthetic SQL/compiler; no real SQL/solve'}));
    process.exit(0);
  }
  const results=[];
  async function check(name,body){await body();results.push(name);}
  function refused(runResult,code,{beforeSource=true}={}){
    assert.equal(runResult.error?.code,code);assert.equal(runResult.staged.length,0);
    assert.equal(runResult.compiled.length,0);
    assert.ok(runResult.calls.some(row=>row.statement==='rollback'));
    if(beforeSource)assert.ok(!runResult.calls.some(row=>row.statement.includes('static_weekly_v11_read_current_refresh_targets')));
  }
  await check('two owning weeks preserve CURRENT plan; no ledger-only original refresh',async()=>{
    const r=await run();assert.ifError(r.error);assert.equal(r.result.state,'PREPARED');
    assert.deepEqual(r.compiled.map(row=>row.input.serviceDate),['2026-10-12','2026-10-19']);
    for(let i=0;i<r.compiled.length;i++){
      assert.deepEqual(r.compiled[i].input.slots,r.sources[i].source.compiler_input.slots);
      assert.deepEqual(r.compiled[i].input.exceptions,[]);
      assert.deepEqual(r.compiled[i].input.versions,[r.sources[i].source.compiler_input.version]);
      assert.equal(r.compiled[i].preparation.expectedRevision,19);
    }
    assert.ok(!r.rows.some(row=>row.candidateKind==='schedule_refresh'&&row.payload.employeeId===originalPerson));
    assert.ok(r.rows.some(row=>row.payload.employeeId===lunchOwner));
    assert.deepEqual(JSON.parse(r.calls.find(row=>row.statement.includes('preview_staffing_witness')).values[0]),r.rows);
    assert.equal(r.staged[0][5],actor.manager_id);assert.equal(r.staged[0][6],'f'.repeat(64));assert.equal(r.actorReads,2);
  });
  await check('original enters refresh only for independently read prior date',async()=>{
    const r=await run({originalPrior:true});assert.ifError(r.error);
    assert.deepEqual(r.rows.filter(row=>row.candidateKind==='schedule_refresh'&&row.payload.employeeId===originalPerson)
      .map(row=>row.serviceDate),['2026-10-13']);
  });
  await check('original performing new actual work remains affected',async()=>{
    const r=await run({originalNewWork:true});assert.ifError(r.error);
    assert.equal(r.rows.filter(row=>row.candidateKind==='schedule_refresh'&&row.payload.employeeId===originalPerson).length,9);
  });
  const invalid = [
    ['missing original',c=>{delete c.original_cancellation_target;},'staffing_original_cancellation_target_required'],
    ['null original',c=>{c.original_cancellation_target=null;},'staffing_original_cancellation_target_required'],
    ['extra original field',c=>{c.original_cancellation_target.currentOccupant=replacement;},'staffing_original_cancellation_target_invalid'],
    ['foreign absence',c=>{c.original_cancellation_target.absenceId=id(0);},'staffing_original_cancellation_target_invalid'],
    ['foreign person',c=>{c.original_cancellation_target.employeeId=replacement;},'staffing_original_cancellation_target_invalid'],
    ['foreign accepted operation',c=>{c.original_cancellation_target.acceptedOperationId=operationId;},'staffing_original_cancellation_target_invalid'],
    ['nonaccepted original',c=>{c.original_cancellation_target.status='cancelled';},'staffing_original_cancellation_target_invalid'],
    ['UUID normalization forbidden',c=>{c.original_cancellation_target.employeeId+=' ';},'staffing_original_cancellation_target_invalid'],
    ['malformed original date',c=>{c.original_cancellation_target.startDate='2026-02-31';},'staffing_invalid_service_date'],
    ['malformed server date',c=>{c.current_service_date='2026-10-12\n';},'staffing_invalid_service_date'],
    ['full original end mismatch',c=>{c.original_cancellation_target.endDate='2026-10-21';},'staffing_original_cancellation_target_window_changed'],
    ['saved remaining start mismatch',c=>{c.semantic_body.startDate='2026-10-13';c.semantic_digest=digest(c.semantic_body);},'staffing_original_cancellation_target_window_changed'],
    ['elapsed original range',c=>{c.current_service_date='2026-10-21';},'staffing_original_cancellation_target_window_changed'],
    ['changed saved body digest',c=>{c.semantic_digest='a'.repeat(64);},'staffing_original_cancellation_target_invalid'],
    ['unknown saved field',c=>{c.semantic_body.originalCancellationTarget=c.original_cancellation_target;},'staffing_original_cancellation_target_invalid'],
    ['invalid expected revision',c=>{c.expected_revision='19';},'static_weekly_control_plane_expected_revision_required'],
    ['foreign preparer',c=>{c.prepared_by_manager_id=id(0);},'staffing_original_preparer_required'],
    ['new absence rejects private original',c=>{c.semantic_body.commandKind='absence';},'staffing_original_cancellation_target_forbidden'],
  ];
  for(const [name,editCommand,code] of invalid)await check(name,async()=>refused(await run({editCommand}),code));
  await check('awaited source cannot mutate captured target/body/revision/digest/day',async()=>{
    const r=await run({duringRefresh:c=>{
      c.original_cancellation_target.employeeId=replacement;c.original_cancellation_target.endDate='2026-10-21';
      c.semantic_body.employeeId=replacement;c.semantic_body.startDate='2026-10-13';
      c.expected_revision=20;c.semantic_digest='0'.repeat(64);c.current_service_date='2026-10-21';
    }});assert.ifError(r.error);assert.equal(r.staged[0][4].expectedRevision,19);
    assert.deepEqual(r.compiled.map(row=>row.input.serviceDate),['2026-10-12','2026-10-19']);
    assert.ok(!r.rows.some(row=>row.candidateKind==='schedule_refresh'&&row.payload.employeeId===originalPerson));
  });
  await check('unknown current refresh source refuses rather than omit prior people',async()=>
    refused(await run({refreshUnknown:true}),'staffing_current_refresh_targets_unavailable',{beforeSource:false}));
  await check('new absence retains exact requested employee refresh',async()=>{
    const r=await run({incumbentOriginal:true,editCommand:c=>{
      c.semantic_body={...c.semantic_body,commandKind:'absence',absenceKind:'daily_absence',targetAbsenceId:null};
      c.original_cancellation_target=null;c.semantic_digest=digest(c.semantic_body);
    }});assert.ifError(r.error);
    assert.equal(r.rows.filter(row=>row.candidateKind==='schedule_refresh'&&row.payload.employeeId===originalPerson).length,9);
    assert.equal(r.compiled.reduce((n,row)=>n+row.input.exceptions.length,0),9);
  });
  await check('new absence still refuses missing incumbent',async()=>refused(await run({editCommand:c=>{
    c.semantic_body={...c.semantic_body,commandKind:'absence',absenceKind:'daily_absence',targetAbsenceId:null};
    c.original_cancellation_target=null;c.semantic_digest=digest(c.semantic_body);
  }}),'staffing_preview_employee_slot_unavailable',{beforeSource:false}));
  await check('current named manager denial before command read',async()=>
    refused(await run({denyActorAt:1}),'42501'));
  await check('changed current revision refuses before compiler/stage',async()=>
    refused(await run({staleWeek:'2026-10-12'}),'staffing_preparation_revision_changed',{beforeSource:false}));
  console.log(JSON.stringify({status:'PASS',cases:results.length,results,
    scope:'actual CP preparation + sealed pure overlay; synthetic fixed SQL and compiler callbacks',
    sqlExecuted:false,solverExecuted:false,normalManagerProof:false,publicationProven:false}));
  process.exit(0);
}
// NEW affected member only. Reuses the already executed normal fused result;
// no solver, PostgreSQL, confirmation, publication or old staging-suite replay.
if (process.argv[2] === '--opening-report-boundary-only') {
  const load = (path, expectedSha) => {
    const bytes = readFileSync(path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedSha);
    return JSON.parse(bytes);
  };
  const record = load(process.argv[3], '413d0819c223511198cc27b4c143a0243e10c885dcbb6a2250802c8a97943074');
  const prepared = load(process.argv[4], 'a869f311d8ab7da87c9d1e21a5b6980121bb78958463c359206c3493e95bb40e');
  const actor = {manager_id: prepared.prepared_by_manager_id, manager_display_name: record.result.actorManagerName,
    auth_mode: 'trusted_device', trusted_device: true, read_only: false};
  const week = record.input.serviceDate, publication = prepared.publication_vector.weeks[0];
  const canonicalFields = ['actorManagerId','actorManagerName','compilerVersion','envelope','exceptionSetDigest',
    'expectedRevision','idempotencyKey','metrics','objective','publicationId','replayDigest','serviceDate'];
  const original = JSON.stringify(record);
  const run = async mutate => {
    let staged = null, witness = null, compilerCalls = 0, response = null;
    const command = {...prepared, state: 'PREPARING'};
    const source = {authority_revision: command.expected_revision, publication_id: publication.publicationId,
      version_id: publication.versionId, compiler_input: {...record.input, version: record.input.versions[0]},
      exceptions: record.input.exceptions.filter(e => e.staffingAbsenceId !== command.operation_id)};
    delete source.compiler_input.versions;
    const client = {async query(statement, values = []) {
      if (statement.includes('static_weekly_v10_read_staffing_command')) return {rows:[{result:command}]};
      if (statement.includes('static_weekly_v11_read_current_refresh_targets')) return {rows:[{result:[]}]};
      if (statement.includes('static_weekly_v3_read_manager_snapshot')) return {rows:[{result:{
        authority_revision:command.expected_revision,current_publication:{publication_id:publication.publicationId}}}]};
      if (statement.includes('static_weekly_v3_read_publication_source')) return {rows:[{result:source}]};
      if (statement.includes('static_weekly_sch022_preview_staffing_witness')) {
        witness = JSON.parse(values[0]); return {rows:[{result:{digest:'f'.repeat(64),target_week_count:0}}]};
      }
      if (statement.includes('static_weekly_sch022_stage_staffing_command')) {
        staged = JSON.parse(values[1]); return {rows:[{result:prepared}]};
      }
      return {rows:[]};
    },release(){},on(){},removeListener(){}};
    const plane = createStaticWeeklyControlPlane({database:{async connect(){return client;}},
      compiler:async()=>{throw Error('No compilation is permitted in this retained-result member');},
      compilerPreparer:async(input, preparation)=>{
        compilerCalls++;
        assert.deepEqual(input,record.input,'exact owning overlay, not a fabricated compiler input');
        assert.deepEqual(preparation,record.preparation,'same publication, revision, actor and operation binding');
        response=structuredClone(record.result); if (mutate) mutate(response); return response;
      },initializeSolver:async()=>{},getSolverReadiness:()=>({available:true})});
    try {
      await plane.prepareStaffingCommand({manager:actor,operationId:command.operation_id});
      return {staged,witness,compilerCalls,response};
    } catch(error) {
      assert.equal(staged,null,'invalid report must not reach typed staging');
      assert.equal(witness,null,'invalid report must not obtain a seasonal witness');
      throw error;
    } finally {await plane.close();}
  };
  const valid=await run();
  assert.equal(valid.compilerCalls,1);
  const payload=valid.staged.find(row=>row.candidateKind==='projection').payload;
  assert.deepEqual(Object.keys(payload).sort(),canonicalFields,'only the canonical 12 projection fields cross SQL');
  const {lunchDocument,openingCoverageReport,...expected}=record.result;
  assert.deepEqual(payload,expected,'envelope, source, identities, compiler and objective bytes remain exact');
  assert.deepEqual(valid.staged.find(row=>row.candidateKind==='lunch').payload,lunchDocument);
  assert.deepEqual(valid.witness,valid.staged,'seasonal witness and staged payload must agree');
  assert.deepEqual(valid.response.openingCoverageReport,openingCoverageReport,'original complete worker report remains intact');
  assert.equal(JSON.stringify(record),original,'retained normal input/result is not mutated');
  await assert.rejects(()=>run(response=>{response.openingCoverageReport.rows[0].knownComponentWeight++;}),
    error=>error.code==='static_weekly_opening_essential_facts_invalid');
  await assert.rejects(()=>run(response=>{
    const report=response.openingCoverageReport; report.authorityRevision++;
    const {reportDigest,...body}=report; report.reportDigest=postgresJsonbContentDigest(body);
  }),error=>error.code==='static_weekly_opening_essential_facts_invalid');
  const unknown=await run(response=>{response.unknownProjectionRootField=true;});
  assert.equal(unknown.staged.find(row=>row.candidateKind==='projection').payload.unknownProjectionRootField,true,
    'not a permissive whitelist: unknown fields remain visible to the unchanged closed SQL verifier');
  console.log(JSON.stringify({status:'PASS',cases:4,scope:'actual control-plane staging with retained fused result and synthetic SQL boundary',
    sqlExecuted:false,solverExecuted:false,confirmationCalls:0,publicationProven:false,reportDisplayed:false,week}));
  process.exit(0);
}
const manager={manager_id:'10000000-0000-4000-8000-000000000001',manager_display_name:'Named Manager',auth_mode:'trusted_device',trusted_device:true,read_only:false};
const employee='20000000-0000-4000-8000-000000000001',operation='30000000-0000-4000-8000-000000000001';
const priorOwner='20000000-0000-4000-8000-000000000002',lunchOnly='20000000-0000-4000-8000-000000000003';
const command={operation_id:operation,state:'PREPARING',semantic_body:{commandKind:'absence',absenceKind:'daily_absence',employeeId:employee,startDate:'2026-09-30',endDate:'2026-10-02',targetAbsenceId:null},semantic_digest:'a'.repeat(64),expected_revision:19,prepared_by_manager_id:manager.manager_id,current_service_date:'2026-09-25'};
const calls=[];let staged=null;
const client={async query(statement,values=[]){calls.push({statement,values});
  if(statement.includes('static_weekly_v10_read_staffing_command'))return{rows:[{result:command}]};
  if(statement.includes('static_weekly_v11_read_current_refresh_targets'))return{rows:[{result:[{serviceDate:'2026-09-30',employeeId:priorOwner}]}]};
  if(statement.includes('static_weekly_v3_read_manager_snapshot'))return{rows:[{result:{authority_revision:19,current_publication:{publication_id:'70000000-0000-4000-8000-000000000001'}}}]};
  if(statement.includes('static_weekly_v3_read_publication_source'))return{rows:[{result:{authority_revision:19,publication_id:'70000000-0000-4000-8000-000000000001',version_id:'60000000-0000-4000-8000-000000000001',exceptions:[],compiler_input:{timezone:'America/Chicago',proximity:[],slots:[{id:'slot-a',incumbencies:[{personId:employee,effectiveStart:'2020-01-01',effectiveEnd:null}]}],version:{id:'version-a',slotAvailability:[]}}}}]};
  if(statement.includes('static_weekly_sch022_preview_staffing_witness'))return{rows:[{result:{digest:'f'.repeat(64),target_week_count:0}}]};
  if(statement.includes('static_weekly_sch022_stage_staffing_command')){staged=values;return{rows:[{result:{operation_id:operation,state:'PREPARED'}}]};}
  return{rows:[]};},release(){},on(){},removeListener(){}};
const deadlineValues=[];
const plane=createStaticWeeklyControlPlane({database:{async connect(){return client;}},compiler:async()=>{throw Error('ordinary compiler not expected');},
  compilerPreparer:async(input,preparation,options)=>{deadlineValues.push(options.deadlineMilliseconds);assert.equal(preparation.kind,'projection');
    const assignments=input.exceptions.map((exception,index)=>({service_date:exception.serviceDate,status:'assigned',owner_person_id:employee,work_id:`work-${index}`}));
    return{publicationId:preparation.publicationId,serviceDate:input.serviceDate,exceptionSetDigest:'b'.repeat(64),compilerVersion:'synthetic',objective:{},metrics:{},replayDigest:'c'.repeat(64),
      envelope:{database_projection_identity:'d'.repeat(64),assignments},expectedRevision:preparation.expectedRevision,actorManagerId:manager.manager_id,actorManagerName:manager.manager_display_name,idempotencyKey:preparation.actor.idempotencyKey,
      lunchDocument:{document_identity:'e'.repeat(64),responsibilities:[{service_date:'2026-09-30',normal_owner_person_id:employee,coverer_person_id:lunchOnly}]}};},initializeSolver:async()=>{},getSolverReadiness:()=>({available:true})});
const result=await plane.prepareStaffingCommand({manager,operationId:operation});assert.equal(result.state,'PREPARED');
assert.ok(staged,'complete candidate set must cross only the typed staging RPC');assert.equal(staged[0],operation);
assert.equal(typeof staged[1],'string','stage candidates must cross as JSONB text, not a PostgreSQL array');
const stagedCandidates=JSON.parse(prepareValue(staged[1]));assert.equal(stagedCandidates.length,7);
const witnessCall=calls.find(row=>row.statement.includes('static_weekly_sch022_preview_staffing_witness'));
assert.ok(witnessCall,'preparation must obtain the exact seasonal witness');
assert.equal(typeof witnessCall.values[0],'string','preview candidates must cross as JSONB text');
assert.deepEqual(JSON.parse(prepareValue(witnessCall.values[0])),stagedCandidates,'preview and staged candidates must be identical');
assert.deepEqual(stagedCandidates.map(row=>[row.candidateKind,row.candidateKey,row.serviceDate]),[
  ['lunch','week:2026-09-28','2026-09-28'],['projection','week:2026-09-28','2026-09-28'],
  ['schedule_refresh',`date:2026-09-30:employee:${employee}`,'2026-09-30'],
  ['schedule_refresh',`date:2026-09-30:employee:${priorOwner}`,'2026-09-30'],
  ['schedule_refresh',`date:2026-09-30:employee:${lunchOnly}`,'2026-09-30'],
  ['schedule_refresh',`date:2026-10-01:employee:${employee}`,'2026-10-01'],
  ['schedule_refresh',`date:2026-10-02:employee:${employee}`,'2026-10-02'],
]);
assert.match(staged[2],/^[0-9a-f]{64}$/);assert.match(staged[3],/^[0-9a-f]{64}$/);assert.equal(staged[4].weeks.length,1);assert.equal(staged[5],manager.manager_id);
assert.equal(staged[6],'f'.repeat(64),'exact catalog witness crosses only the private typed stage boundary');
assert.equal(deadlineValues.length,1);assert.ok(deadlineValues[0]>0&&deadlineValues[0]<=30000,'preparation passes the remaining total budget into the isolated compiler');
await plane.close();
console.log(JSON.stringify({status:'PASS',checks:10,scope:'server-owned compile to complete private staging with bounded deadline; synthetic compiler and no authoritative commit'}));
