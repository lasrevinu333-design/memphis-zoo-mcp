import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {loadSixPersonAbsenceSource} from './fixtures/six-person-absence-source.mjs';

const start=performance.now(),deadlineAt=start+60_000,clone=structuredClone;
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const configBytes=readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url));
assert.equal(createHash('sha256').update(configBytes).digest('hex'),'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30');
const ownerConfig=JSON.parse(configBytes),currentSource=loadSixPersonAbsenceSource().compilerInput;
const removed=new Set(currentSource.slots.filter(s=>s.contractorCapacity).map(s=>s.id));
assert.equal(currentSource.version.assignments.filter(r=>removed.has(r.ownerSlotId)).length,0);
currentSource.slots=currentSource.slots.filter(s=>!removed.has(s.id));
currentSource.version.slotAvailability=currentSource.version.slotAvailability.filter(r=>!removed.has(r.slotId));
for(const key of ['namedAbsentSlotIds','vacancyCapableSlotIds','vacantSlotIds'])currentSource.version[key]=(currentSource.version[key]||[]).filter(id=>!removed.has(id));
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
const calls=[];
class Client extends EventEmitter {
 async query(sql,args=[]){
  calls.push({sql,args});
  let result=null;
  if(sql.includes('static_weekly_read_approved_template_confirmation'))result=saved;
  else if(sql.includes('static_weekly_v3_read_manager_snapshot'))result={authority_revision:revision,
    current_publication:{publication_id:accepted?newPublication:publication},projection_status:accepted?'current':'missing',
    latest_projection:accepted?{projection_id:readbackBad?'wrong':projection}:null};
  else if(sql.includes('static_weekly_read_approved_template_basis'))result=basisMutator({schema:'custodial.approved-static-template-basis.v1',
    publicationId:args[1],serviceDate:args[2],kind:args[3],authorityRevision:revision,generation:2,
    currentSource:clone(currentSource),ownerConfig:clone(ownerConfig),templates:clone(templates),admittedBindings:clone(admittedBindings),templateCatalogDigest:catalogDigest});
  else if(sql.includes('static_weekly_materialize_approved_template')){
    const envelope=args[8];assert.equal(args[0],actor.manager_id);assert.equal(args[4],revision);
    assert.equal(args[7],envelope.previewDigest);assert.equal(envelope.feasibility.optimized,false);
    assert.equal(envelope.feasibility.projectionAssignments.length,494);
    assert.equal(envelope.feasibility.lunchDocument.responsibilities.some(r=>r.creates_deep_clean!==false),false);
    revision++;lunch=envelope.feasibility.lunchDocument;
    accepted={ok:true,persistence_status:'PERSISTED',publication_id:newPublication,projection_id:projection,
      authority_revision:revision,feasibility_digest:envelope.feasibility.digest,lunch_document_identity:lunch.document_identity};
    saved={request:envelope.request,receipt:{schema:'custodial.approved-static-confirmation.v1',status:'PERSISTED_CURRENT',
      ...accepted,revision,previewDigest:args[7],solverInvoked:false}};result=accepted;
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
 console.log(JSON.stringify({status:'PASS',checks,elapsedMilliseconds:performance.now()-start,
  actualArtifactPatternRows:323,actualDerivedProjectionRows:494,solver:false,sqlExecuted:false,production:false,
  scope:'ACTUAL_SOURCE_STATIC_FEASIBILITY_AND_FAKE_MANAGER_TRANSACTION_CONTRACT_NOT_SQL_ACCEPTANCE'}));
} finally {await cp.close();}
