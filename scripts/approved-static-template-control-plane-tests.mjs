import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {loadSixPersonAbsenceSource} from './fixtures/six-person-absence-source.mjs';

const start=performance.now(),deadlineAt=start+60_000,clone=structuredClone,initialMode=process.argv.includes('--initial');
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const configBytes=readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url));
assert.equal(createHash('sha256').update(configBytes).digest('hex'),'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30');
const ownerConfig=JSON.parse(configBytes),packet=loadSixPersonAbsenceSource(),currentSource=packet.compilerInput;
assert.equal(packet.fixtureSha256,'882e5895d60338313b08f28ec327f2087468261749cdbac5dc7d78ac22e20469');
assert.equal(postgresJsonbContentDigest(currentSource),'ac98f94d0c28a9cd493898bef2463059ef59a80bfcac1f8d0a455ddf6901571a');
const removed=new Set(currentSource.slots.filter(s=>s.contractorCapacity).map(s=>s.id));
assert.equal(currentSource.version.assignments.filter(r=>removed.has(r.ownerSlotId)).length,0);
if(!initialMode){
 currentSource.slots=currentSource.slots.filter(s=>!removed.has(s.id));
 currentSource.version.slotAvailability=currentSource.version.slotAvailability.filter(r=>!removed.has(r.slotId));
 for(const key of ['namedAbsentSlotIds','vacancyCapableSlotIds','vacantSlotIds'])currentSource.version[key]=(currentSource.version[key]||[]).filter(id=>!removed.has(id));
}
const templateId='owner-corrected-six',roleSlotIds=Object.values(ownerConfig.slots).filter(s=>!s.vacancy).map(s=>s.slotId).sort();
const templates=[{templateId,staffingCount:6,source:clone(currentSource),roleSlotIds}],admittedBindings=[{
 schema:'custodial.approved-static-template-binding.v1',templateId,staffingCount:6,
 sourceDigest:contentDigest(currentSource),roleSlotIdsDigest:contentDigest(roleSlotIds),
 patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:createHash('sha256').update(configBytes).digest('hex'),
 ownerConfigDigest:contentDigest(ownerConfig),patternPublicationStatus:'UNPUBLISHED_LOCAL_CANDIDATE'}];
const catalogDigest=postgresJsonbContentDigest({templates,admittedBindings,ownerConfig});
const publication='81000000-0000-4000-8000-000000000001',newPublication='81000000-0000-4000-8000-000000000002',projection='81000000-0000-4000-8000-000000000003';
const actor={manager_id:'fixture-named-manager',manager_display_name:'Fixture Manager',auth_mode:'trusted_device'};
let revision=4,accepted=null,saved=null,lunch=null,basisMutator=x=>x,readbackBad=false,releases=0;
let transactionSnapshot=null;
const sourceId=loadSixPersonAbsenceSource().sourceId;
const calls=[];
class Client extends EventEmitter {
 async query(sql,args=[]){
  calls.push({sql,args});
  if(sql==='begin')transactionSnapshot={revision,accepted,saved,lunch};
  if(sql==='rollback'&&transactionSnapshot){({revision,accepted,saved,lunch}=transactionSnapshot);transactionSnapshot=null;}
  if(sql==='commit')transactionSnapshot=null;
  let result=null;
  if(sql.includes('static_weekly_read_approved_template_confirmation')||sql.includes('static_weekly_read_approved_initial_confirmation'))result=saved;
  else if(sql.includes('static_weekly_v3_read_manager_snapshot'))result={authority_revision:revision,
    current_publication:{publication_id:accepted?newPublication:publication},projection_status:accepted?'current':'missing',
    latest_projection:accepted?{projection_id:readbackBad?'wrong':projection}:null};
  else if(sql.includes('static_weekly_v3_read_authority_source'))result={source_id:args[0],compiler_input:clone(currentSource),exceptions:[]};
  else if(sql.includes('static_weekly_read_approved_initial_basis'))result=basisMutator({schema:'custodial.approved-static-initial-basis.v1',
    sourceId:args[1],serviceDate:args[2],authorityRevision:revision,generation:2,
    currentSource:clone(currentSource),currentSourceDigest:postgresJsonbContentDigest(currentSource),
    ownerConfig:clone(ownerConfig),templates:clone(templates),admittedBindings:clone(admittedBindings),templateCatalogDigest:catalogDigest});
  else if(sql.includes('static_weekly_read_approved_template_basis'))result=basisMutator({schema:'custodial.approved-static-template-basis.v1',
    publicationId:args[1],serviceDate:args[2],kind:args[3],authorityRevision:revision,generation:2,
    currentSource:clone(currentSource),ownerConfig:clone(ownerConfig),templates:clone(templates),admittedBindings:clone(admittedBindings),templateCatalogDigest:catalogDigest});
  else if(sql.includes('static_weekly_materialize_approved_template')||sql.includes('static_weekly_materialize_approved_initial_baseline')){
    const envelope=args[initialMode?6:8];assert.equal(args[0],actor.manager_id);assert.equal(args[initialMode?3:4],revision);
    if(initialMode){assert.equal(args[1],sourceId);assert.equal(envelope.feasibility.currentSourceDigest,postgresJsonbContentDigest(currentSource));
      assert.deepEqual(envelope.feasibility.candidateSource,currentSource);
      assert.equal(envelope.feasibility.initialBaseline.document.assignments.length,323);
      assert.equal(envelope.feasibility.initialBaseline.projection.assignments.length,494);
      assert.equal(envelope.feasibility.initialBaseline.document.authority.schema,'custodial.approved-static-authority.v1');
      assert.equal(Object.hasOwn(envelope.feasibility.initialBaseline.document.authority,'optimizerResult'),false);
      assert.ok(envelope.feasibility.shiftEndDerivation.parentChains.length===323);
      const working=envelope.feasibility.projectionAvailability.filter(a=>a.status==='working'&&a.incumbentPersonId);
      const employees=new Set(Object.values(ownerConfig.slots).filter(s=>!s.vacancy).map(s=>s.personId));
      assert.equal(working.length,30);
      assert.ok(working.every(a=>employees.has(a.incumbentPersonId)));
    }else assert.equal(args[7],envelope.previewDigest);
    assert.equal(envelope.feasibility.optimized,false);
    assert.equal(envelope.feasibility.projectionAssignments.length,494);
    assert.equal(envelope.feasibility.lunchDocument.responsibilities.some(r=>r.creates_deep_clean!==false),false);
    revision++;lunch=envelope.feasibility.lunchDocument;
    accepted={ok:true,persistence_status:'PERSISTED',publication_id:newPublication,projection_id:projection,
      authority_revision:revision,source_id:sourceId,feasibility_digest:envelope.feasibility.digest,lunch_document_identity:lunch.document_identity};
    saved={request:envelope.request,receipt:{schema:'custodial.approved-static-confirmation.v1',status:'PERSISTED_CURRENT',
      ...accepted,revision,previewDigest:envelope.previewDigest,solverInvoked:false}};result=accepted;
  } else if(sql.includes('static_weekly_v8_read_lunch_document'))result={persistence_status:'PERSISTED',projection_id:projection,document_identity:lunch.document_identity};
  else if(sql.includes('static_weekly_v21_reconcile_dependency_changes'))result={authorityRevision:revision,processedChangeCount:0,
    invalidations:[],blockedPublications:[],affectedPhonesUpdated:false};
  return {rows:[{result}]};
 }
 release(){releases++;}
}
const database={connect:async()=>new Client()},cp=createStaticWeeklyControlPlane({database,
 compiler:()=>{throw Error('FORBIDDEN_SOLVER');},compilerPreparer:()=>{throw Error('FORBIDDEN_SOLVER');},shutdownCompiler:async()=>{}});
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const input={manager:actor,serviceDate:'2026-10-05',expectedRevision:4,deadlineAt};
try {
 if(initialMode){
  const sql=readFileSync(new URL('../supabase/migrations/20261004140657_approved_static_template_authority.sql',import.meta.url),'utf8');
  check('initial SQL keeps predecessor optimized validators untouched and private copied writers reversible',()=>{
    assert.equal(/create\s+or\s+replace\s+function\s+public\.static_weekly_assert_compiler_authority/i.test(sql),false);
    assert.equal(/create\s+or\s+replace\s+function\s+public\.static_weekly_v2_(create_draft|publish_draft|materialize_projection)/i.test(sql),false);
    assert.match(sql,/if reversed<>original then raise exception/);
    assert.match(sql,/kind:=case when exists\(select 1 from public.weekly_schedule_publications\) then 'supersede' else 'publish'/);
    assert.match(sql,/public\.static_weekly_v3_assert_draft_incumbency\(v_version_id\)/);
    assert.match(sql,/public\.static_weekly_v8_materialize_lunch_document\(v_projection_id/);
    assert.match(sql,/initial adapter provenance seam changed/);
  });
  check('initial SQL admission/actor/current-source/CAS/generation/private grants and recovery remain explicit source obligations',()=>{
    for(const needle of ['static_weekly_v3_assert_release_operator','static_weekly_v3_assert_control_plane','static_weekly_v3_manager_actor',
      "baseline.feasibility->'candidateSource' is distinct from source","p_generation is distinct from (basis->>'generation')::bigint",
      'static_weekly_v9_assert_shift_end_derivation','force row level security','custodial_release_authority_current_grant_definition',
      'initial canary recovery alias count changed'])assert.ok(sql.includes(needle),needle);
    assert.equal(/grant\s+(select|insert|update|delete|all)\s+on\s+table/i.test(sql),false);
    assert.equal(/grant\s+execute[^;]*\bto\s+(anon|authenticated|service_role)\b/i.test(sql),false);
  });
  const initial={manager:actor,sourceId,effectiveStart:'2026-10-05',templateId,expectedRevision:4,deadlineAt};
  await assert.rejects(cp.createInitialDraft({...initial,idempotencyKey:'original-initial-must-not-solve'}),/FORBIDDEN_SOLVER/);checks++;
  await assert.rejects(cp.previewApprovedInitialBaseline({...initial,manager:{...actor,read_only:true}}),{code:'static_weekly_named_manager_required'});checks++;
  await assert.rejects(cp.previewApprovedInitialBaseline({...initial,expectedRevision:3}),{code:'static_template_revision_changed'});checks++;
  await assert.rejects(cp.previewApprovedInitialBaseline({...initial,effectiveStart:'2026-09-28'}),{code:'static_template_initial_source_invalid'});checks++;
  basisMutator=x=>({...x,currentSourceDigest:'0'.repeat(64)});
  await assert.rejects(cp.previewApprovedInitialBaseline(initial),{code:'static_template_trusted_basis_invalid'});checks++;
  basisMutator=x=>({...x,currentSource:{...x.currentSource,exceptions:[{}]}});
  await assert.rejects(cp.previewApprovedInitialBaseline(initial),{code:'static_template_trusted_basis_invalid'});checks++;
  basisMutator=x=>({...x,templateCatalogDigest:'0'.repeat(64)});
  await assert.rejects(cp.previewApprovedInitialBaseline(initial),{code:'static_template_trusted_basis_invalid'});checks++;
  basisMutator=x=>x;
  const preview=await cp.previewApprovedInitialBaseline(initial);
  check('exact untrimmed current-six initial preview retains323 including complete source, derives494/lunch30 without solver',()=>{
    assert.equal(preview.status,'PREVIEW_ONLY');assert.equal(preview.mapping.unchanged,true);
    assert.equal(preview.assignments.length,494);assert.equal(preview.lunch.lunches.length,30);
    assert.equal(currentSource.version.assignments.length,323);assert.equal(currentSource.slots.filter(s=>s.contractorCapacity).length,removed.size);
    assert.equal(revision,4);assert.equal(preview.solverInvoked,false);
    const employees=new Set(Object.values(ownerConfig.slots).filter(s=>!s.vacancy).map(s=>s.personId));
    assert.equal(preview.lunch.lunches.every(l=>employees.has(l.normalOwnerPersonId)),true);
    assert.equal(preview.lunch.lunches.flatMap(l=>l.responsibilities).every(r=>employees.has(r.covererPersonId)&&r.createsDeepClean===false),true);
  });
  const confirmation={...initial,previewDigest:preview.previewDigest,idempotencyKey:'fixture-initial-approved-six'};
  readbackBad=true;
  await assert.rejects(cp.publishApprovedInitialBaseline({...confirmation,idempotencyKey:'fixture-readback-mismatch'}),{code:'static_template_current_readback_mismatch'});checks++;
  check('missing/mismatched authoritative readback rolls back fake initial write without commit',()=>{
    assert.equal(revision,4);assert.equal(accepted,null);assert.equal(saved,null);assert.equal(lunch,null);
    assert.equal(calls.at(-1).sql,'rollback');
  });
  readbackBad=false;
  const result=await cp.publishApprovedInitialBaseline(confirmation);
  check('initial typed baseline publishes over existing historical publication then checks current projection and persisted lunch',()=>{
    assert.equal(result.status,'PERSISTED_CURRENT');assert.equal(result.source_id,sourceId);assert.equal(result.revision,5);
    assert.equal(result.projection_id,projection);assert.ok(calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));
    assert.ok(calls.some(c=>c.sql.includes('set local role static_weekly_control_plane')));
    assert.ok(calls.some(c=>c.sql==='commit'));
  });
  const basisReads=calls.filter(c=>c.sql.includes('static_weekly_read_approved_initial_basis')).length;
  const replay=await cp.publishApprovedInitialBaseline(confirmation);
  check('initial replay retains original accepted receipt without regenerating or resetting authority',()=>{
    assert.equal(replay.status,'ACCEPTED_ORIGINAL_RECEIPT');assert.equal(calls.filter(c=>c.sql.includes('static_weekly_read_approved_initial_basis')).length,basisReads);
  });
  await assert.rejects(cp.publishApprovedInitialBaseline({...confirmation,previewDigest:'1'.repeat(64)}),{code:'static_template_confirmation_identity_conflict'});checks++;
  await assert.rejects(cp.previewApprovedInitialBaseline({...initial,deadlineAt:start-1}),{code:'static_weekly_recurring_operation_deadline_exceeded'});checks++;
  check('no optimized materializer or fabricated certificate on static initial path',()=>{
    assert.equal(calls.some(c=>/static_weekly_v3_(create_draft|publish_draft|materialize_projection)/.test(c.sql)),false);
    assert.equal(calls.filter(c=>c.sql.includes('static_weekly_materialize_approved_initial_baseline')).length,2);
  });
 }else{
 await assert.rejects(cp.previewApprovedStaticPattern({...input,manager:{...actor,read_only:true}}),{code:'static_weekly_named_manager_required'});checks++;
 await assert.rejects(cp.previewApprovedStaticPattern({...input,expectedRevision:3}),{code:'static_template_revision_changed'});checks++;
 basisMutator=x=>({...x,templateCatalogDigest:'0'.repeat(64)});
 await assert.rejects(cp.previewApprovedStaticPattern(input),{code:'static_template_trusted_basis_invalid'});checks++;
 basisMutator=x=>x;
 const preview=await cp.previewApprovedStaticPattern(input);
 check('actual six manager preview returns fixed unchanged323/complete494 plus lunch without compiler',()=>{
  assert.equal(preview.status,'PREVIEW_ONLY');assert.equal(preview.mapping.unchanged,true);assert.equal(preview.assignments.length,494);
  assert.equal(preview.lunch.status,'PLANNED');assert.equal(preview.solverInvoked,false);assert.equal(revision,4);
 });
 const writesBefore=calls.filter(c=>c.sql.includes('static_weekly_materialize_approved_template')).length;
 await assert.rejects(cp.confirmApprovedStaticPattern({...input,previewDigest:'0'.repeat(64),idempotencyKey:'stale-preview-fixture'}),{code:'static_template_preview_changed'});checks++;
 check('changed preview digest never reaches typed writer',()=>assert.equal(calls.filter(c=>c.sql.includes('static_weekly_materialize_approved_template')).length,writesBefore));
 const confirmation={...input,previewDigest:preview.previewDigest,idempotencyKey:'fixture-static-six-confirm'};
 const result=await cp.confirmApprovedStaticPattern(confirmation);
 check('fake transport confirms same actor/CAS typed write then exact current projection and persisted lunch readback',()=>{
  assert.equal(result.status,'PERSISTED_CURRENT');assert.equal(result.revision,5);assert.equal(result.projection_id,projection);
  assert.ok(calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));assert.ok(calls.some(c=>c.sql.includes('set local role static_weekly_control_plane')));
 });
 const basisReads=calls.filter(c=>c.sql.includes('static_weekly_read_approved_template_basis')).length;
 const replay=await cp.confirmApprovedStaticPattern(confirmation);
 check('original exact confirmation replay survives later revision without new basis/solver',()=>{
  assert.equal(replay.status,'ACCEPTED_ORIGINAL_RECEIPT');assert.equal(replay.currentReadbackNotRepeated,true);
  assert.equal(calls.filter(c=>c.sql.includes('static_weekly_read_approved_template_basis')).length,basisReads);
 });
 await assert.rejects(cp.confirmApprovedStaticPattern({...confirmation,previewDigest:'1'.repeat(64)}),{code:'static_template_confirmation_identity_conflict'});checks++;
 await assert.rejects(cp.previewApprovedStaticPattern({...input,deadlineAt:start-1}),{code:'static_weekly_recurring_operation_deadline_exceeded'});checks++;
 check('legacy optimized writer is never used by static preview/confirmation',()=>assert.equal(calls.some(c=>/static_weekly_v3_(create_draft|publish_draft|materialize_projection)/.test(c.sql)),false));
 check('all checked out fake clients are released',()=>assert.ok(releases>=7));
 }
 console.log(JSON.stringify({status:'PASS',checks,elapsedMilliseconds:performance.now()-start,
  actualArtifactPatternRows:323,actualDerivedProjectionRows:494,solver:false,sqlExecuted:false,production:false,
  scope:initialMode?'EXACT_UNTRIMMED_SOURCE_INITIAL_STATIC_BASELINE_FAKE_TRANSACTION_NOT_SQL_ACCEPTANCE':
    'ACTUAL_SOURCE_STATIC_FEASIBILITY_AND_FAKE_MANAGER_TRANSACTION_CONTRACT_NOT_SQL_ACCEPTANCE'}));
} finally {await cp.close();}
