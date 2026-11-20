// Root repair rehearsal only. Genuine historical construction, exact current
// forward SQL, real database auth/transactions, no production or phone target.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import pg from '../node_modules/pg/lib/index.js';
import {consumeCurrentQualifiedSqlFixture} from './current-qualified-sql-ci-fixture.mjs';
import {deriveAcceptedSevenCurrentWeekParent} from './accepted-seven-current-week-source.mjs';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {readAcceptedSevenManualWeek} from '../src/accepted-seven-manual-week.js';
import {prepareAcceptedSevenUpdateData} from '../src/accepted-seven-update-preparation.js';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {PREPARATION_SQL} from './prepare-approved-manual-release-packet.mjs';
const B=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const out=resolve(process.argv[2]??'');
const historyFile=resolve(process.argv[3]??'');
const currentWeekRegression=process.argv.length===5&&process.argv[4]==='--current-week-regression';
assert.ok(process.argv.length===4||currentWeekRegression,'Explicit owned inputs and finite qualification scope required');
assert.equal(fs.existsSync(out),false,'Do not replay an existing rehearsal');
const historyBytes=fs.readFileSync(historyFile),history=JSON.parse(historyBytes);
assert.equal(sha(historyBytes),'a760bc82ee4f15806e84b856a7b7d9920e86d737f89a56d72635da16972d6f65','Exact captured history; no backdating or caller-selected predecessor');
assert.equal(history.classification,'RECORDED_SLOT_HISTORY_FOR_ISOLATED_FIXTURE_SETUP_NOT_CURRENT_ADMISSION');
assert.equal(history.slot.slotId,'7044faec-4bbd-57ca-a898-ddd719503113');
assert.equal(history.slot.incumbencies.length,2);
// Freeze exact current source separately from the genuine historical fixture.
const sourceRefs=[];
function walk(dir){for(const name of fs.readdirSync(dir).sort()){
 if(name==='node_modules'||name==='.git')continue;
 const p=resolve(dir,name),st=fs.lstatSync(p);assert.equal(st.isSymbolicLink(),false);
 if(st.isDirectory())walk(p);else{assert.ok(st.isFile());sourceRefs.push({path:p.slice(B.length+1),bytes:st.size,mode:st.mode&0o777,sha256:sha(fs.readFileSync(p))});}
}}
walk(B);const refs=sourceRefs;
const sourceCurrent=()=>{for(const r of refs){const p=resolve(B,r.path),st=fs.lstatSync(p);assert.ok(st.isFile()&&!st.isSymbolicLink());
 assert.deepEqual([st.size,st.mode&0o777,sha(fs.readFileSync(p))],[r.bytes,r.mode,r.sha256],r.path);}};
const descriptorPath=process.env.CUSTODIAL_CURRENT310_OWNED_CI_DESCRIPTOR;assert.ok(descriptorPath);
const descriptor=JSON.parse(fs.readFileSync(descriptorPath));
const forwardManifest=resolve(descriptor.runtime,'accepted-seven-forward/manifest.json'),forward=JSON.parse(fs.readFileSync(forwardManifest));
assert.equal(forward.schema,'custodial.accepted-seven-current319-forward.v1');assert.equal(forward.production,false);
assert.equal(forward.rows.length,10);assert.equal(forward.rows.at(-1).name,'20261115205201_accepted_seven_pattern_update_reuse_existing_capacity.sql');
assert.equal(forward.rows.at(-1).sha256,'ebbf6b7ff9c2c11d711be7e222c3b27c176cd22993de2ae1cd295cd3991f35bd');
assert.deepEqual(forward.prerequisites.map(r=>r.name),['accepted-seven-live-canary-parity.sql','native-departure-v2.proposed.sql','accepted-seven-digest-callsite-retention-current310.sql']);
assert.equal(forward.prerequisites[0].sha256,'4d872fb0ea1c499abf202f7fbd4be93a27fa5e47011f72a074892b436cb37bd0');assert.equal(forward.prerequisites[1].sha256,'1e4054e0957f6b4fa3e1eda5a3dcf9b42ec33e8eabd9db4a9579c0e8d6763c70');
assert.equal(forward.prerequisites[2].sha256,'f3f4fc230b2f593dffba332dc4d473590ab5a5562615adc43ccc6d89dc60c943');
const prerequisites=forward.prerequisites.map(r=>({...r,path:resolve(descriptor.runtime,'accepted-seven-forward',r.name)}));
const migrations=forward.rows.map(r=>({...r,path:resolve(descriptor.runtime,'accepted-seven-forward',r.name)}));
assert.equal(migrations[8].name,'20261115133604_native_alert_generation_pending.sql');assert.equal(migrations[8].sha256,'79dc01a924668455a4438e11fc644a290e7caad8f39bdacf211548b363c99e8b');
// MESSAGE/EVENT generation readiness has no dependency edge into the manual
// schedule update. Preserve it as a separate held qualification lane.
const independentAlertHeld=migrations[8];
const readForward=ref=>{assert.equal(fs.lstatSync(ref.path).isSymbolicLink(),false);const b=fs.readFileSync(ref.path);assert.equal(b.length,ref.bytes);assert.equal(sha(b),ref.sha256);return b.toString('utf8');};
for(const ref of migrations)readForward(ref);
const fixtureRoot=B;
{
 const derived=deriveAcceptedSevenCurrentWeekParent(fs.readFileSync(resolve(fixtureRoot,'scripts/approved-manual-activation-database-tests.mjs')));
 const parent=derived.source;
 const seam='  const {seed,transformation}=deriveOriginal314RecordedPredecessor({fixture:reference,recorded,anchorCivilDate:at});';
 assert.equal(parent.split(seam).length,2);
 const setup=`  // Explicit test-only historical setup; no clock changes or production edits.\n  const captured=${JSON.stringify(history.slot)};\n  assert.ok(captured.incumbencies.every(r=>r.effectiveStart<at));\n  const originalHistory=structuredClone(recorded.rosterSlots.find(s=>s.slotId===captured.slotId));\n  assert.ok(originalHistory);recorded.rosterSlots.find(s=>s.slotId===captured.slotId).incumbencies=structuredClone(captured.incumbencies);\n  save('RECORDED_KILTRA_HISTORY_FIXTURE_SETUP.json',{scope:'ISOLATED_SYNTHETIC_SEED_USING_CAPTURED_HISTORY',captureSha256:'${sha(historyBytes)}',originalHistory,captured,serverServiceDate:at,clockOverridden:false,productionWritten:false});\n`;
 const driver=resolve(fixtureRoot,'scripts/accepted-seven-recorded-history-parent.mjs');
 fs.writeFileSync(driver,parent.replace(seam,setup+seam),{flag:'wx'});
 const manifest=resolve(fixtureRoot,'scripts/accepted-seven-current-source-manifest.json');
 fs.writeFileSync(manifest,JSON.stringify({source:B,refs,historySha256:sha(historyBytes),historyFile,scope:'CURRENT_SOURCE_ASSERTIONS_AND_GENUINE_CURRENT310_CONSTRUCTOR_WITH_EXACT_311TO320_FORWARD'},null,2)+'\n',{flag:'wx'});
 let consumed=false;
 const createCurrentFixture=async options=>{
  assert.equal(consumed,false,'Never replay the current-week owning constructor');consumed=true;
  const fixture=await consumeCurrentQualifiedSqlFixture(options),pool=new pg.Pool({...fixture.pgClientConfig,database:'postgres',user:'supabase_admin',password:'postgres',max:1,connectionTimeoutMillis:5000});
  const applied=[];
  try{for(const ref of migrations.slice(0,8)){
   for(const required of prerequisites.filter(r=>r.before===ref.name)){sourceCurrent();await fixture.assertOwned();
    if(required.name==='accepted-seven-digest-callsite-retention-current310.sql'){
     const metadata=(await pool.query(`select n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,p.proowner::regrole::text owner,p.proacl::text acl,p.prosecdef,p.provolatile,p.proisstrict,p.proconfig,p.proparallel from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname=ANY($1::text[]) order by n.nspname,p.proname`,[['static_weekly_manual_store_initial_baseline','activation_packet_fingerprint','static_weekly_read_approved_initial_basis','static_weekly_manual_period_basis','static_weekly_coverall_stage_initial_operational','static_weekly_coverall_finalize_initial_operational','static_weekly_coverall_initial_assert_payload','static_weekly_manual_assert_initial_employment_projection']])).rows;
     fs.writeFileSync(out+'.ACTUAL_DIGEST_PREDECESSOR_METADATA.json',JSON.stringify({scope:'Read-only actual owned fixture metadata; never used to overwrite expected input',metadata,production:false},null,2)+'\n',{flag:'wx'});
    }
    await pool.query(readForward(required));applied.push({...required,prerequisite:true});}
   sourceCurrent();await fixture.assertOwned();const sql=readForward(ref);await pool.query(sql);applied.push(ref);
  }
   fs.writeFileSync(out+'.SCHEDULE_PREDECESSORS.json',JSON.stringify({scope:'Actual isolated current310 plus exact required schedule forwards311to318; independent MESSAGE/EVENT alert migration319 held',parent:derived.proof,migrations:applied,independentAlertHeld,receipt:fixture.receipt,production:false},null,2)+'\n',{flag:'wx'});
   const originalSevenSql=readForward(migrations[9]),targets=JSON.parse(originalSevenSql.split('$target_defs$')[1]);
   const metadata=(await pool.query(`select x->>'identity' identity,p.proowner::regrole::text owner,p.proacl::text acl,
     p.prosecdef security,p.proconfig config,public.static_weekly_digest_text(pg_get_functiondef(p.oid)) definition_sha256,
     (select jsonb_agg(jsonb_build_object('kind',i.object_kind,'identity',i.object_identity,'sha256',i.definition_sha256,'sql',i.definition_sql) order by i.object_kind,i.object_identity)
      from public.custodial_release_authority_restore_inventory i where i.object_kind in('function','grant')
      and (case when i.object_kind='function' or (i.object_kind='grant' and position('(' in i.object_identity)>0) then to_regprocedure(i.object_identity) end)=p.oid) recovery,
     case when p.oid is not null then public.custodial_release_authority_current_grant_definition(x->>'identity') end current_grant_definition
     from jsonb_array_elements($1::jsonb) x left join pg_proc p on p.oid=to_regprocedure(x->>'identity') order by x->>'identity'`,[JSON.stringify(targets)])).rows;
   fs.writeFileSync(out+'.SEVEN_FIXTURE_TARGET_METADATA.json',JSON.stringify({scope:'READ_ONLY_FIXED_PREDECESSOR_CURRENT310_NOT_PRODUCTION_METADATA',targets:metadata,production:false},null,2)+'\n',{flag:'wx'});

  }finally{await pool.end();}
  return fixture;
 };
 const {runApprovedManualActivationDatabaseTest}=await import(pathToFileURL(driver));
 await runApprovedManualActivationDatabaseTest({out,constructFixture:createCurrentFixture,constructorMigrationCount:310,extensionSources:[manifest,resolve(B,'scripts/fixtures/approved-manual-week-before-start-correction.json')],
  afterInitial:async context=>{
   const {fixture,pool,manager,at,accepted,query,tx,save}=context;sourceCurrent();
   if(currentWeekRegression){
    const receipt={scope:'ACTUAL_CURRENT_WEEK_RETAINED_PATTERN_REGRESSION_SQL',status:'RUNNING',productionWritten:false,phoneTouched:false,sevenTransitionApplied:false};
    const plane=context.plane;
    try{
     const legacyDigest='eeff371f1510c6e4a079bde3ba17136dc10f64b100c7562d9b139fd14805a1c8';
     const source=(await query('select canonical_source from public.static_weekly_authority_source_documents where source_id=$1',[accepted.sourceId??context.ids.source])).rows[0].canonical_source;
     assert.equal(source.version.lunchCoveragePolicy.sourceDigest,legacyDigest);
     // Compile the repaired installer with its original production-owner pins.
     // The synthetic administrator-owned predecessor must still be refused.
     let refusal;
     try{await tx('supabase_admin',c=>c.query(readForward(migrations[9])));}catch(e){refusal=e;}
     assert.equal(refusal?.code,'P0001');assert.match(refusal.message,/Accepted predecessor definition\/owner\/ACL\/security differs/);
     save('SEVEN_SYNTAX_FIXED_ORIGINAL_OWNER_GATE_RETAINED.json',{code:refusal.code,message:refusal.message,originalOwnerGatePreserved:true,sevenApplied:false});
     const week=JSON.parse(fs.readFileSync(resolve(B,'scripts/fixtures/approved-manual-week-before-start-correction.json')));
     const monday=new Date(Date.parse(at+'T12:00Z'));monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
     const weekStart=monday.toISOString().slice(0,10);
     const read=async()=>{
      const days=[];
      for(let i=0;i<7;i++){
       const date=new Date(monday.getTime()+i*86400000).toISOString().slice(0,10),people=[];
       for(const person of week.referenceBindings.people){
        const value=await tx('custodial_application_reader',async c=>(await c.query('select public.static_weekly_v5_read_employee_day($1::date,$2::uuid,$3::timestamptz) value',[date,person.employeeId,date+'T15:00:00Z'])).rows[0].value);
        assert.equal(value.governed,true);
        if(date>=at){assert.equal(value.projection_status,'current');assert.ok(value.projection_id);}
        else assert.ok(typeof value.projection_status==='string','Retain explicit historical projection status');
        people.push({employeeId:person.employeeId,value});
       }days.push({date,people});
      }return days;
     };
     const before=await read();save('CURRENT_WEEK_CANONICAL_EMPLOYEE_READS_BEFORE_REPEAT.json',{serviceDate:at,weekStart,days:before});
     const currentRevision=Number((await query('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision);
     const nextFrame=new Date(Date.parse(at+'T12:00Z')+7*86400000).toISOString().slice(0,10);
     const repeated=await plane.runManagerOperation({manager,signal:new AbortController().signal,deadlineAt:performance.now()+120000,permission:'write'},()=>plane.materializeProjection({manager,publicationId:accepted.publicationId,serviceDate:nextFrame,expectedRevision:currentRevision,idempotencyKey:'retained-current-week-'+randomUUID()}));
     save('RETAINED_PATTERN_ACTUAL_NEXT_WEEK_REPEAT.json',repeated);
     const projection=(await query(`select p.week_start::text,p.projection_id,jsonb_array_length(p.projection_envelope->'assignments') assignments,
       jsonb_array_length(l.document_json->'loans') lunches,s.canonical_source#>>'{version,lunchCoveragePolicy,sourceDigest}' pattern_digest
       from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id)
       join public.weekly_schedule_versions v using(version_id) join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id
       where p.projection_id=$1`,[repeated.data.projection_id])).rows[0];
     assert.equal(projection.week_start,nextFrame);assert.equal(projection.assignments,346);assert.equal(projection.lunches,40);assert.equal(projection.pattern_digest,legacyDigest);
     save('RETAINED_PATTERN_NEXT_WEEK_SQL_READBACK.json',projection);
     const after=await read();assert.deepEqual(after,before,'Repeating the retained pattern must preserve every current-week historical and current read');
     save('CURRENT_WEEK_CANONICAL_EMPLOYEE_READS_AFTER_REPEAT.json',{serviceDate:at,weekStart,days:after,originalCurrentWeekUnchanged:true});
     sourceCurrent();Object.assign(receipt,{status:'PASS',serviceDate:at,weekStart,employeeDayReads:112,employees:8,days:7,actualManagerCredentialBinding:true,actualDatabaseRoleReads:true,nextWeekAssignments:346,nextWeekFullHourLunches:40,historyUnchanged:true,historicalStatusesPreserved:before.filter(d=>d.date<at).map(d=>({date:d.date,statuses:[...new Set(d.people.map(p=>p.value.projection_status))]})),currentAndFutureReads:before.filter(d=>d.date>=at).length*8*2,originalProductionOwnerGateRetained:true});
     return receipt;
    }catch(e){Object.assign(receipt,{status:'FAIL',code:e.code??null,message:e.message});throw e;}
    finally{save('CURRENT_WEEK_REGRESSION_RESULT.json',receipt);sourceCurrent();}
   }
   const receipt={status:'RUNNING',scope:'ISOLATED_CURRENT_SEVEN_UPDATE_SQL_REHEARSAL',productionWritten:false,physicalPhone:false,clockOverridden:false};
   let plane;
   const failure=async(label,work)=>{let error;try{await work();}catch(e){error=e;}
    assert.ok(error,label+' must refuse');assert.ok(!/^(08|ECONN|57P)/.test(String(error.code??'')),'Connection uncertainty cannot be treated as expected refusal');
    save('SEVEN_NEGATIVE_'+label+'.json',{label,code:error.code??null,message:error.message});return error;};
   try{
    // Genuine append migrations, never substitute a current definition into an
    // old target and claim equivalent replay. Every predecessor guard remains.
    const originalSevenSql=readForward(migrations[9]);
    const targets=JSON.parse(originalSevenSql.split('$target_defs$')[1]);
    const targetMetadata=(await query(`select x->>'identity' identity,p.proowner::regrole::text owner,p.proacl::text acl,
      p.prosecdef security,p.proconfig config,public.static_weekly_digest_text(pg_get_functiondef(p.oid)) definition_sha256,
      (select jsonb_agg(jsonb_build_object('kind',i.object_kind,'identity',i.object_identity,'sha256',i.definition_sha256,'sql',i.definition_sql) order by i.object_kind,i.object_identity)
       from public.custodial_release_authority_restore_inventory i where i.object_kind in('function','grant')
       and (case when i.object_kind='function' or (i.object_kind='grant' and position('(' in i.object_identity)>0) then to_regprocedure(i.object_identity) end)=p.oid) recovery,
      case when p.oid is not null then public.custodial_release_authority_current_grant_definition(x->>'identity') end current_grant_definition
      from jsonb_array_elements($1::jsonb) x left join pg_proc p on p.oid=to_regprocedure(x->>'identity') order by x->>'identity'`,[JSON.stringify(targets)])).rows;
    save('SEVEN_ACTUAL_FIXTURE_PREDECESSOR_METADATA.json',{scope:'READ_ONLY_ORIGINAL_CURRENT310_FIXTURE_METADATA_NO_GUARD_REWRITE',targets:targetMetadata,production:false});
    const append=[];
    for(const ref of migrations.slice(9)){
     sourceCurrent();await fixture.assertOwned();
     const sql=readForward(ref);
     await query(sql);append.push(ref);save('SEVEN_FORWARD_'+String(append.length).padStart(2,'0')+'.json',{...ref,actualSqlSucceeded:true});
    }
    receipt.forwardMigrations=append;receipt.exactAcceptedSevenMigrationApplied=true;receipt.independentMessageEventAlertMigrationHeld=independentAlertHeld;
    const snapshot=(await query(PREPARATION_SQL.snapshot)).rows[0].snapshot;
    assert.equal(snapshot.serviceDate,at);assert.equal(snapshot.rosterSlots.length,30);
    const currentSourceRecord=(await query('select source_id::text,canonical_source,source_digest from public.static_weekly_authority_source_documents where source_id=$1',[snapshot.parentPublication.sourceId])).rows[0];
    const week=readAcceptedSevenManualWeek(readApprovedManualWeek());
    const ids={packetId:randomUUID(),operationId:randomUUID(),sourceId:randomUUID(),versionId:randomUUID(),templatePublicationId:randomUUID()};
    const data=prepareAcceptedSevenUpdateData({week,referenceBytes:fs.readFileSync(resolve(B,week.referenceBindings.reference.path)),
     currentSourceRecord,snapshot,...ids,managerId:manager.manager_id,templateId:'isolated-seven-'+ids.sourceId});
    assert.equal(data.profile.assignments,323);assert.equal(data.profile.lunches,35);
    save('SEVEN_DATA_BEFORE_WRITE.json',data);
    const state=async()=>(await query(`select public.static_weekly_digest_jsonb(jsonb_build_object(
     'revision',(select to_jsonb(s) from public.static_weekly_schedule_control s where singleton),
     'roster',(select jsonb_agg(to_jsonb(s) order by slot_id) from public.weekly_roster_slots s),
     'incumbencies',(select jsonb_agg(to_jsonb(s) order by incumbency_id) from public.weekly_roster_slot_incumbencies s),
     'employees',(select jsonb_agg(to_jsonb(s) order by id) from public.employees s),
     'messenger',(select jsonb_agg(to_jsonb(s) order by id) from public.msg_users s),
     'sources',(select jsonb_agg(to_jsonb(s) order by source_id) from public.static_weekly_authority_source_documents s),
     'packets',(select jsonb_agg(to_jsonb(s) order by packet_id) from custodial_coverall.activation_packets s),
     'operations',(select jsonb_agg(to_jsonb(s) order by operation_id) from custodial_coverall.activation_operations s),
     'receipts',(select jsonb_agg(to_jsonb(s) order by operation_id) from custodial_coverall.activation_receipts s))) digest`)).rows[0].digest;
    const prepare=packet=>tx('static_weekly_release_operator',async c=>{await c.query(PREPARATION_SQL.interpret);return(await c.query(PREPARATION_SQL.prepare,[JSON.stringify(packet)])).rows[0].receipt;});
    const pristine=await state();
    for(const [label,edit] of [
     ['wrong_artifact',x=>{x.acceptedArtifactSha256='0'.repeat(64);}],
     ['wrong_count',x=>{x.profile.assignments=322;}],
     ['broadened_on_call',x=>{x.source.version.manualGroupRatingAuthority.acceptedSevenOnCallLunch.windows[0].start='09:00';}],
     ['missing_on_call',x=>{delete x.source.version.manualGroupRatingAuthority.acceptedSevenOnCallLunch;}],
     ['null_on_call',x=>{x.source.version.manualGroupRatingAuthority.acceptedSevenOnCallLunch=null;}],
     ['wrong_normal_restriction',x=>{x.source.version.assignments[0].restrictedSlotIds=[];}],
     ['wrong_capacity',x=>{x.capacityTransition.newPositionsCreated=1;}],
    ]){const bad=structuredClone(data);edit(bad);bad.updateDataDigest=digest(Object.fromEntries(Object.entries(bad).filter(([k])=>k!=='updateDataDigest')));
     assert.equal((await failure(label,()=>prepare(bad))).code,'P0001');assert.equal(await state(),pristine,'Rejected preparation must preserve exact original state');}
    for(const role of ['anon','authenticated','service_role'])assert.equal((await failure('private_helper_'+role,()=>tx(role,c=>c.query('select custodial_coverall.assert_accepted_seven_update_data($1::jsonb,$2::jsonb)',[JSON.stringify(data),JSON.stringify(snapshot)])))).code,'42501');
    const prepared=await prepare(data);save('SEVEN_PACKET_PREPARED_AFTER_COMMIT.json',prepared);
    // Privileged fixture setup supplies deliberately invalid PRIVATE context;
    // the real v8 call still runs as the original credential-qualified manager.
    // Both branches must retain standalone publication completion and roll back.
    const preparedState=await state();
    const oldXid=(await query('select owner_xid::text xid from custodial_coverall.activation_operations where operation_id=$1',[context.ids.activation])).rows[0].xid;
    for(const variant of ['foreign_transaction','wrong_manager']){
     const rolledBack=await failure('compound_context_'+variant,()=>tx('supabase_admin',async c=>{
      await c.query('insert into custodial_coverall.activation_operations(operation_id,packet_id,manager_id,owner_xid,request_json) values($1,$2,$3,CASE WHEN $4::text IS NULL THEN pg_current_xact_id() ELSE $4::xid8 END,$5::jsonb)',
       [randomUUID(),ids.packetId,variant==='wrong_manager'?randomUUID():manager.manager_id,variant==='foreign_transaction'?oldXid:null,JSON.stringify({fixtureNegative:variant})]);
      await c.query('set local role static_weekly_control_plane');
      const standalone=(await c.query('select public.static_weekly_v8_vacate_roster_slot($1,$2,$3,$4,$5,$6,$7,$8) value',
       [snapshot.parentPublication.sourceId,data.vacancy.slotId,data.vacancy.employeeId,at,'Isolated negative compound context; transaction must roll back',snapshot.authorityRevision,manager.manager_id,'seven-context-'+randomUUID()])).rows[0].value;
      assert.equal(standalone.data.completion_mode,'projection_required');assert.ok(standalone.data.original_publication_id);
      save('SEVEN_CONTEXT_'+variant.toUpperCase()+'.json',{scope:'PRIVILEGED_FIXTURE_NEGATIVE_CONTEXT_NOT_RUNTIME_AUTHORITY',standalone});
      throw Object.assign(Error('Explicit isolated negative transaction rollback'),{code:'EXPECTED_FIXTURE_ROLLBACK'});
     }));
     assert.equal(rolledBack.code,'EXPECTED_FIXTURE_ROLLBACK');assert.equal(await state(),preparedState);
    }
    plane=createStaticWeeklyControlPlane({database:{connect:async()=>{await fixture.assertOwned();return pool.connect();}}});
    const run=fn=>plane.runManagerOperation({manager,signal:new AbortController().signal,deadlineAt:performance.now()+120000,permission:'write'},fn);
    const preview=await run(()=>plane.previewApprovedManualActivation({manager,packetId:ids.packetId,expectedRevision:snapshot.authorityRevision}));
    assert.equal(preview.status,'PREVIEW_ONLY');assert.equal(preview.employmentRevisionVector.length,14);save('SEVEN_ACTUAL_PREVIEW.json',preview);
    const weekMonday=new Date(Date.parse(at+'T12:00Z'));weekMonday.setUTCDate(weekMonday.getUTCDate()-((weekMonday.getUTCDay()+6)%7));
    const currentWeekStart=weekMonday.toISOString().slice(0,10);
    const readEmployeeDay=(day,employee)=>tx('custodial_application_reader',async c=>(await c.query(
      'select public.static_weekly_v5_read_employee_day($1::date,$2::uuid,$3::timestamptz) value',[day,employee,day+'T15:00:00Z'])).rows[0].value);
    const pastReadbacks=[];
    for(let day=currentWeekStart;day<at;day=new Date(Date.parse(day+'T12:00Z')+86400000).toISOString().slice(0,10))
      for(const person of week.referenceBindings.people)pastReadbacks.push({day,employeeId:person.employeeId,value:await readEmployeeDay(day,person.employeeId)});
    save('SEVEN_CURRENT_WEEK_PAST_BEFORE_UPDATE.json',{serviceDate:at,weekStart:currentWeekStart,pastReadbacks,historyRewrite:false});
    const beforeBegin=await state();
    await failure('stale_revision',()=>run(()=>plane.activateApprovedManualSchedule({manager,packetId:ids.packetId,operationId:randomUUID(),expectedRevision:snapshot.authorityRevision-1,previewDigest:preview.previewDigest,idempotencyKey:'seven-stale-'+randomUUID()})));
    assert.equal(await state(),beforeBegin);
    // A raw begin cannot be committed as a completed update. The existing
    // deferred stage/finalization guard must roll back its vacancy and source.
    const incompleteOperation=randomUUID();let incompleteBeginReturned=false;
    const incompleteError=await failure('early_commit',()=>tx('static_weekly_control_plane',async c=>{
     await c.query('select public.static_weekly_bind_coverall_activation_request($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [manager.manager_id,incompleteOperation,'seven-incomplete-'+incompleteOperation,ids.packetId,snapshot.authorityRevision,preview.previewDigest,manager.credential_id,manager.device_id,'full_access']);
     const begun=(await c.query('select public.static_weekly_begin_coverall_activation($1,$2,$3,$4,$5,$6,$7,$8) value',
      [manager.manager_id,ids.packetId,incompleteOperation,snapshot.authorityRevision,preview.previewDigest,manager.credential_id,manager.device_id,'full_access'])).rows[0].value;
     assert.ok(begun);incompleteBeginReturned=true;save('SEVEN_INCOMPLETE_BEGIN_BEFORE_COMMIT.json',begun);
    }));
    assert.equal(incompleteBeginReturned,true,'A pre-begin refusal is not proof of deferred commit protection');
    assert.equal(incompleteError.code,'P0001');assert.match(incompleteError.message,/cannot commit without native publication\/projection\/lunch receipt/);
    assert.equal(await state(),beforeBegin,'Deferred refusal must undo the entire compound update');
    const request={manager,packetId:ids.packetId,operationId:ids.operationId,expectedRevision:snapshot.authorityRevision,previewDigest:preview.previewDigest,idempotencyKey:'seven-update-'+ids.operationId};
    save('SEVEN_ORIGINAL_ACTIVATION_REQUEST.json',request);
    const result=await run(()=>plane.activateApprovedManualSchedule(request));
    save('SEVEN_ACTUAL_COMMITTED_RESULT.json',result);assert.equal(result.status,'PERSISTED_CURRENT');assert.equal(result.samePhysicalTransaction,true);assert.equal(result.actualPositions,30);assert.equal(result.newEmployeesCreated,false);assert.equal(result.employmentRevisionVector.length,14);
    const post=(await query(PREPARATION_SQL.snapshot)).rows[0].snapshot;
    assert.equal(post.employees.find(p=>p.employeeId===data.vacancy.employeeId).active,false);
    assert.equal(post.employees.find(p=>p.employeeId===data.vacancy.employeeId).hasMessenger,false);
    const rows=(await query(`select jsonb_array_length(p.projection_envelope->'assignments') assignments,jsonb_array_length(l.document_json->'loans') lunches,
      s.canonical_source,s.source_digest from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id)
      join public.weekly_schedule_versions v using(version_id) join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id where p.projection_id=$1`,[result.normalBaselineResult.projection_id])).rows[0];
    assert.equal(rows.assignments,323);assert.equal(rows.lunches,35);assert.deepEqual(rows.canonical_source,data.source);assert.equal(rows.source_digest,data.sourceDigest);
    const witness=(await query(`select o.owner_xid::text operation_xid,p.owner_xid::text progress_xid,(s.xmin)::text stage_xmin,(r.xmin)::text receipt_xmin,r.receipt_json
      from custodial_coverall.activation_operations o join custodial_coverall.activation_progress p using(operation_id)
      join custodial_coverall.initial_operational_stages s using(operation_id) join custodial_coverall.activation_receipts r using(operation_id) where operation_id=$1`,[ids.operationId])).rows[0];
    assert.equal(witness.operation_xid,witness.progress_xid);assert.equal(witness.stage_xmin,witness.receipt_xmin);assert.equal(BigInt(witness.stage_xmin),BigInt(witness.operation_xid)%4294967296n);
    save('SEVEN_ACTUAL_SAME_TRANSACTION_WITNESS.json',witness);
    const replay=await run(()=>plane.activateApprovedManualSchedule(request));assert.equal(replay.operationId,result.operationId);assert.equal(replay.projectionId,result.projectionId);save('SEVEN_ORIGINAL_IDEMPOTENT_READBACK.json',replay);
    const nextFrame=new Date(Date.parse(at+'T12:00Z')+7*86400000).toISOString().slice(0,10);
    const currentRevision=Number((await query('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision);
    const repeatBasis=await tx('static_weekly_control_plane',async c=>(await c.query('select public.static_weekly_read_manual_repeat_basis($1,$2,$3,$4,$5,$6,$7) value',
     [manager.manager_id,result.publicationId,nextFrame,currentRevision,manager.credential_id,manager.device_id,'full_access'])).rows[0].value);
    assert.equal(repeatBasis.assignmentCount,323);assert.equal(repeatBasis.lunchCount,35);assert.equal(repeatBasis.employmentByDate.length,7);
    assert.equal(repeatBasis.manualDataDigest,week.dataDigest);save('SEVEN_ACTUAL_NEXT_WEEK_REPEAT_BASIS.json',repeatBasis);
    const repeated=await run(()=>plane.materializeProjection({manager,publicationId:result.publicationId,serviceDate:nextFrame,
     expectedRevision:currentRevision,idempotencyKey:'seven-repeat-'+randomUUID()}));
    save('SEVEN_ACTUAL_NEXT_WEEK_MATERIALIZATION.json',repeated);
    const repeatProjection=(await query(`select p.projection_id,p.week_start::text, jsonb_array_length(p.projection_envelope->'assignments') assignments,
     jsonb_array_length(l.document_json->'loans') lunches,p.projection_envelope->'authority' authority
     from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id)
     where p.projection_id=$1`,[repeated.data.projection_id])).rows[0];
    assert.equal(repeatProjection.week_start,nextFrame);assert.equal(repeatProjection.assignments,323);assert.equal(repeatProjection.lunches,35);
    save('SEVEN_ACTUAL_NEXT_WEEK_SQL_READBACK.json',repeatProjection);
    const monday=new Date(Date.parse(at+'T12:00Z'));monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
    const currentWeek=monday.toISOString().slice(0,10),days=[];
    for(let i=0;i<7;i++){const day=new Date(monday.getTime()+i*86400000).toISOString().slice(0,10);
     const rows=[];for(const person of week.referenceBindings.people){
      const value=await readEmployeeDay(day,person.employeeId);
      assert.equal(value.governed,true);
      if(day<at){const original=pastReadbacks.find(r=>r.day===day&&r.employeeId===person.employeeId);assert.ok(original);assert.deepEqual(value,original.value,'Forward update must preserve historical schedule reads');}
      else {assert.equal(value.projection_status,'current');assert.ok(value.projection_id,'Canonical current/future read must name its real projection');}
      rows.push({employeeId:person.employeeId,value});
     }days.push({day,rows});
    }
    save('SEVEN_CURRENT_WEEK_CANONICAL_EMPLOYEE_READBACK.json',{serviceDate:at,weekStart:currentWeek,days,production:false});
    receipt.currentWeekStart=currentWeek;receipt.currentWeekCanonicalReads=49;
    sourceCurrent();receipt.status='PASS';receipt.actualSqlAuth=true;receipt.sameTransaction=true;receipt.immutableNormalAssignments=323;receipt.immutableFullHourLunches=35;
    receipt.rollbackNegatives=14;receipt.wholeWeekRepetitionSql=true;receipt.productionWritten=false;receipt.phoneTouched=false;return receipt;
   }catch(e){receipt.status='FAIL';receipt.code=e.code??null;receipt.message=e.message;receipt.where=e.where??null;throw e;
   }finally{if(plane)await plane.close();save('SEVEN_REHEARSAL_RESULT.json',receipt);sourceCurrent();}
  }});
}
