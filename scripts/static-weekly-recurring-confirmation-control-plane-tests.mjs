import assert from 'node:assert/strict';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {RECURRING_DECISION_SCHEMA,RECURRING_IMPLEMENTATION_DIGEST} from '../src/static-weekly-recurring-preview.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {createOpeningCoverageReport} from '../src/static-weekly-opening-coverage-report.js';
import {loadOpeningCoverageFixture} from './static-weekly-opening-coverage-report-tests.mjs';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {contentDigest} from '../src/static-weekly-schedule-model.js';
import {RECURRING_WEEK_COMMITMENT_SCHEMA,RECURRING_PHASE_SCOPE,RECURRING_MORNING_SCOPE} from '../src/static-weekly-recurring-week-commitment.js';
import {COMPONENT_WEIGHT_LEDGER_DIGEST} from '../src/schedule-component-weight-authority.js';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {prepareValue}=require('pg/lib/utils');
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));

// Transaction orchestration only. SQL, compiler, HTTP and physical proofs are
// separately required; this mock never supplies release authority.
const id=n=>`81000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const approvedFullNineSourceId=JSON.parse(readFileSync(new URL(
 '../config/custodial-full-nine-family-owners-20260926.json',import.meta.url))).baseSourceId;
const manager={manager_id:id(1),manager_display_name:'Second authorized synthetic manager',auth_mode:'trusted_device'};
const week='2026-10-05',key=id(2),oldPublication=id(3),sourceId=id(4),newSourceId=id(5),publicationId=id(6),projectionId=id(7);
// The former empty source was sufficient for transaction orchestration but
// cannot witness canonical report authority. Reuse lossless executed LOCAL
// selection facts; SQL child responses remain explicitly orchestration mocks.
const actual=loadOpeningCoverageFixture().baseline,raw=structuredClone(actual.source);
raw.version.id=id(8);raw.version.publicationId=oldPublication;
const reportCache=new Map();
function candidateFor(basis){
 const decision={schema:RECURRING_DECISION_SCHEMA,implementationDigest:RECURRING_IMPLEMENTATION_DIGEST,
  effectiveDate:week,compilerVersion:'synthetic-only',candidateSourceDigest:digest(raw),
  recurringAvailabilityDigest:digest(raw.version.slotAvailability),geographyDigest:digest(raw.proximity),assignments:structuredClone(actual.result.assignments),
  gaps:{open:structuredClone(actual.result.assignments.filter(r=>actual.result.open.includes(r.planWorkId))),review:[]},
  fixedLunch:{loans:structuredClone(actual.result.lunch.loans),responsibilities:structuredClone(actual.result.lunch.responsibilities),
   notificationIntents:structuredClone(actual.result.lunch.notification_intents)},shiftEnd:null,metrics:structuredClone(actual.result.metrics),changes:[]};
 const candidate={status:'CANDIDATE_ONLY',compilerStatus:'FEASIBLE',publicationAuthority:'ACCEPTABLE',verifierOk:true,
  weekOptimizationScope:RECURRING_PHASE_SCOPE,staffedPositions:7,sourcePatternKind:'UNSPLIT',
  sourceId,publicationId:oldPublication,authorityRevision:basis.expectedRevision,effectiveDate:week,
  publishedSourceDigest:digest(basis.publishedSource.compiler_input),managerSnapshotDigest:digest(basis.managerSnapshot),
  fullNineSourceDigest:basis.fullNineSource?digest(basis.fullNineSource.compiler_input):null,
  candidateSourceDigest:digest(raw),readbackPatternDigest:'c'.repeat(64),patternFingerprint:'b'.repeat(64),
  phaseSourceBasisDigest:'4'.repeat(64),modelBasisDigest:'d'.repeat(64),
  assignmentWitnessDigest:'e'.repeat(64),finalWitnessDigest:'f'.repeat(64),weeklyAssignmentsDigest:digest(decision.assignments),
  metricsDigest:digest(decision.metrics),lunchFactsDigest:digest(decision.fixedLunch),openWorkDigest:digest(decision.gaps.open),
  shiftEndDerivationDigest:digest(null),lunchLoanCount:decision.fixedLunch.loans.length,openWorkCount:decision.gaps.open.length,reviewWorkCount:0,assignmentCount:raw.version.assignments.length,
  compilerVersion:decision.compilerVersion,decision,decisionDigest:digest(decision),changes:[],
  registrationRequired:true,managerConfirmationRequired:true};
 // Orchestration mock only: the real isolated compiler constructs this from
 // seven fresh terminal receipts. This fixture tests the CP binding/fencing,
 // not solver correctness or a publication proof.
 const commitment={schema:RECURRING_WEEK_COMMITMENT_SCHEMA,status:'PROVEN_CANDIDATE_ONLY',
  scope:'EXACT_SELECTED_POST0945_NORMAL_WEEK_MORNING_FROM_BOUND_INPUT_FIXED',
  sourceId:candidate.sourceId,publicationId:candidate.publicationId,
  authorityRevision:candidate.authorityRevision,effectiveWeek:candidate.effectiveDate,
  publishedSourceDigest:candidate.publishedSourceDigest,
  managerSnapshotDigest:candidate.managerSnapshotDigest,
  readbackPatternDigest:candidate.readbackPatternDigest,
  fullNineSourceDigest:candidate.fullNineSourceDigest,
  sourceDigest:'1'.repeat(64),sourceBasisDigest:candidate.phaseSourceBasisDigest,
  sourceSqlDigest:'2'.repeat(64),configDigest:'3'.repeat(64),
  finalPatternDigest:candidate.patternFingerprint,
  fullOwnersDigest:'4'.repeat(64),componentLedgerDigest:COMPONENT_WEIGHT_LEDGER_DIGEST,
  implementationDigest:RECURRING_IMPLEMENTATION_DIGEST,
  finalSourceDigest:'5'.repeat(64),finalSourceSqlDigest:candidate.candidateSourceDigest,
  days:Array.from({length:7},(_,dayOfWeek)=>({dayOfWeek,
   descriptorDigest:'6'.repeat(64),originalLowerBoundDescriptorDigest:'7'.repeat(64),
   originalSolverSourceDigest:'9'.repeat(64),freshCanonicalSourceBasisDigest:'a'.repeat(64),
   unchangedRelaxationDayFactsDigest:'b'.repeat(64),unchangedRelaxationDescriptorDigest:'c'.repeat(64),
   minimumDoubledSpread:1,preferenceCost:4,stableIdentity:[0],selectedOwnership:[{workId:'synthetic',slotId:'synthetic'}],
   terminalOptima:['raw_spread','inherited_preference','inherited_identity_0'].map((name,index)=>({name,
    modelDigest:'d'.repeat(64),lpDigest:'e'.repeat(64),objectiveValue:index===0?1:index===1?4:0})),
   finalCanonicalWitnessDigest:'8'.repeat(64)})),
  canonicalHard:{modelBasisDigest:'d'.repeat(64),hardConstraintDigest:'e'.repeat(64),
   hardConstraintCount:1,witnessDigest:'8'.repeat(64)},
  completeCompiler:{compilerVersion:candidate.compilerVersion,canonicalInputDigest:'f'.repeat(64),modelBasisDigest:candidate.modelBasisDigest,
   finalWitnessDigest:candidate.finalWitnessDigest,assignmentDigest:candidate.assignmentWitnessDigest,
   weeklyAssignmentsDigest:candidate.weeklyAssignmentsDigest},
  normalMorningOptimumClaim:false,datedPriorityChange:false,physicalMinuteFeasibilityClaim:false,
  admitted:false,published:false};
 candidate.weekCommitment={...commitment,digest:contentDigest(commitment)};
 // Mandatory sibling SHAPE for this injected orchestration mock, never an
 // actual solver/SQL receipt. Preserve all transaction and original late
 // checks while exercising current morning binding and rejection controls.
 const morningFacts={sourceBasisDigest:'a'.repeat(64),originalSourceDigest:contentDigest(basis.publishedSource.compiler_input),
  candidateSourceDigest:commitment.sourceDigest,targetEffectiveDate:week,targetCalendarReceiptDigest:'b'.repeat(64),
  days:Array.from({length:7},(_,dayOfWeek)=>({dayOfWeek,contractDigest:'c'.repeat(64),metrics:{coverage:[0]},
   selection:[{workId:`synthetic-morning-${dayOfWeek}`,slotId:'synthetic'}],
   terminalOptima:Array.from({length:6},(_,i)=>({name:`synthetic-${i}`,modelDigest:'d'.repeat(64),lpDigest:'e'.repeat(64),primitiveObjective:0,originalObjective:0}))}))};
 const morning={schema:'custodial.recurring-morning-combined-commitment.v1',scope:RECURRING_MORNING_SCOPE,status:'PROVEN_CANDIDATE_ONLY',
  sourceId:candidate.sourceId,publicationId:candidate.publicationId,authorityRevision:candidate.authorityRevision,effectiveWeek:week,
  publishedSourceDigest:candidate.publishedSourceDigest,managerSnapshotDigest:candidate.managerSnapshotDigest,readbackPatternDigest:candidate.readbackPatternDigest,
  originalMorningSourceDigest:morningFacts.originalSourceDigest,morningSourceBasisDigest:morningFacts.sourceBasisDigest,
  originalMorningSourceSqlDigest:candidate.publishedSourceDigest,targetCalendarReceiptDigest:morningFacts.targetCalendarReceiptDigest,
  targetEffectiveDate:week,originalCalendarHeaderDigest:'f'.repeat(64),targetCalendarHeaderDigest:'f'.repeat(64),originalDatedOverlayCount:0,
  datedOverlaysRetainedInOriginalOnly:true,recurringRowsAnchorsAvailabilityAndHistoryPreserved:true,
  morningFacts,morningFactsDigest:contentDigest(morningFacts),morningCandidateSourceDigest:commitment.sourceDigest,
  phaseSourceBasisDigest:commitment.sourceBasisDigest,lateCommitmentDigest:candidate.weekCommitment.digest,
  finalSourceDigest:commitment.finalSourceDigest,finalSourceSqlDigest:commitment.finalSourceSqlDigest,finalCanonicalWitnessDigest:commitment.canonicalHard.witnessDigest,
  sharedMorningAdmissionBudgetMs:30000,originalAnchorsPreserved:true,originalLateReferencePreserved:true,sourceRequiredPlannedMorningOptimum:true,
  openingReadinessProven:false,physicalMinuteFeasibilityClaim:false,acceptedStaticChanged:false,datedPriorityChange:false,admitted:false,published:false};
 candidate.morningOptimizationScope=RECURRING_MORNING_SCOPE;
 candidate.morningSourceBasisDigest=morningFacts.sourceBasisDigest;
 candidate.morningCommitment={...morning,digest:contentDigest(morning)};
 const reportKey=digest({sourceDigest:digest(raw),decisionDigest:candidate.decisionDigest,revision:basis.expectedRevision});
 if(!reportCache.has(reportKey))reportCache.set(reportKey,createOpeningCoverageReport({source:raw,assignments:decision.assignments,lunch:actual.result.lunch,
  context:{publicationId:oldPublication,authorityRevision:basis.expectedRevision},decisionDigest:candidate.decisionDigest}));
 candidate.openingCoverageReport=structuredClone(reportCache.get(reportKey));
 return candidate;
}
function harness({failAt=null,mutatePrivate=null,commitUnknown=false,publishedAssignmentsCount=323,
 forceStaticTemplateCandidate=false,registeredSourceId=approvedFullNineSourceId,onQuery=null,onPrivatePrepare=null,
 connectGate=null,onClientEnd=null}={}){
 let state={revision:7,generation:2,publication:oldPublication,projection:null,receipt:null,writes:[]};
 const publishedSource=structuredClone(raw);
 publishedSource.version.assignments=publishedSource.version.assignments.slice(0,publishedAssignmentsCount);
 let backup,connections=0,checkedOut=0,privateCompiles=0,draftCompiles=0,projectionCompiles=0,beginRequest=null;
 const queries=[];let clientSerial=0,endedClients=0;
 const database={async connect(){if(connectGate)await connectGate;connections++;checkedOut++;assert.equal(checkedOut,1,'only ONE checked-out client');
  const clientId=++clientSerial;
  return{async query(sql,args=[]){queries.push({sql,args:structuredClone(args),clientId});
   if(onQuery)await onQuery(sql,args);
   if(sql==='begin'){backup=structuredClone(state);return{rows:[]};}
   if(sql==='rollback'){if(backup)state=backup;backup=null;return{rows:[]};}
   if(sql==='commit'){backup=null;if(commitUnknown)throw Object.assign(new Error('connection terminated after commit'),{code:'08006'});return{rows:[]};}
   if(failAt&&sql.includes(failAt))throw new Error('injected '+failAt);
   const result=value=>({rows:[{result:value}]});
   if(sql.includes('static_weekly_v13_begin_recurring_confirmation')){
    if(beginRequest&&JSON.stringify(beginRequest)!==JSON.stringify(args))throw new Error('recurring confirmation idempotency conflict');
    beginRequest??=structuredClone(args);
    return result(state.receipt?{state:'ACCEPTED',operationId:id(9),receipt:state.receipt}:{state:'RESERVED',operationId:id(9)});
   }
   if(sql.includes('static_weekly_v13_read_recurring_confirmation'))return result(state.receipt?
    {state:'ACCEPTED',operationId:id(9),receipt:state.receipt}:{state:'NOT_FOUND'});
   if(sql.includes('static_weekly_v15_read_recurring_generation'))return result(state.generation);
   if(sql.includes('static_weekly_sch022_preview_witness'))return result('9'.repeat(64));
   if(sql.includes('static_weekly_v3_read_manager_snapshot'))return result({authority_revision:state.revision,
    current_publication:{publication_id:state.publication},projection_status:state.projection?'current':'missing',
    latest_projection:state.projection?{projection_id:state.projection}:null});
   if(sql.includes('static_weekly_v20_read_recurring_preview_basis'))return result({source_id:sourceId,
    publication_id:oldPublication,authority_revision:state.revision,compiler_input:structuredClone(publishedSource)});
   if(sql.includes('static_weekly_v3_read_authority_source'))return result({source_id:registeredSourceId,
    compiler_input:structuredClone(raw)});
   if(sql.includes('static_weekly_v3_read_publication_source'))return result({compiler_input:structuredClone(raw),exceptions:[]});
   if(sql.includes('static_weekly_v14_admit_recurring_source')){
    assert.equal(args[0],manager.manager_id);assert.equal(args[1],key);assert.deepEqual(args[2],raw);assert.equal(args[3],digest(raw));
    state.writes.push('source');return result({source_id:newSourceId,source_digest:digest(raw)});
   }
   if(sql.includes('static_weekly_v3_create_draft')){
    assert.equal(args[5],state.revision);assert.equal(args[7],`recurring:${manager.manager_id}:${key}:draft`);assert.equal(args[8],newSourceId);
    assert.notEqual(args[4].versionId,raw.version.id,'copy gets new draft identity');
    state.writes.push('draft');return result({revision:++state.revision,data:{version_id:args[4].versionId,draft_revision:1}});
   }
   if(sql.includes('static_weekly_v3_publish_draft')){
    assert.equal(args[2],state.revision);assert.equal(args[4],`recurring:${manager.manager_id}:${key}:publish`);
    assert.equal(args[5],'supersede');state.publication=publicationId;state.generation++;state.writes.push('publication');
    return result({revision:++state.revision,data:{publication_id:publicationId}});
   }
   if(sql.includes('static_weekly_v18_bind_recurring_publication')){
    assert.equal(args[2],publicationId);assert.equal(args[3],state.generation);assert.equal(digest(args[4]),digest(candidateFor({
     expectedRevision:7,publishedSource:{compiler_input:raw},managerSnapshot:{}}).decision));
    state.writes.push('binding');return result({publicationId});
   }
   if(sql.includes('static_weekly_v3_materialize_projection')){
    assert.equal(args[8],state.revision);assert.equal(args[10],`recurring:${manager.manager_id}:${key}:projection:${week}`);
    state.projection=projectionId;state.writes.push('projection');return result({revision:++state.revision,data:{projection_id:projectionId}});
   }
   if(sql.includes('static_weekly_v8_materialize_lunch_document')){
    state.writes.push('lunch');return result({ok:true,persistence_status:'PERSISTED',projection_id:projectionId,document_identity:'lunch-id'});
   }
   if(sql.includes('static_weekly_v23_finalize_recurring_confirmation')){
    state.writes.push('targets-and-receipt');state.receipt={schema:'static-weekly.recurring-confirmation-receipt.v1',
     operationId:id(9),managerId:manager.manager_id,confirmationKey:key,previewDigest:beginRequest[4],effectiveStart:week,
     sourceId:newSourceId,sourceDigest:digest(raw),publicationId,projectionId,authorityRevision:state.revision,
     accepted:true,phoneDeliveryState:'PENDING',affectedPhonesUpdated:false};return result(state.receipt);
   }
   return{rows:[]};
  },end(){endedClients++;onClientEnd?.();return Promise.resolve();},release(){checkedOut--;}};
 },async end(){assert.equal(checkedOut,0);}};
 const plane=createStaticWeeklyControlPlane({database,shutdownCompiler:async()=>{},
  recurringCandidatePreparer:async basis=>{
   const result=candidateFor(basis);
   if(forceStaticTemplateCandidate)result.weekOptimizationScope='HISTORICAL_FULL_NINE_STATIC_TEMPLATE_ONLY';
   return result;
  },
  recurringAdmissionPreparer:async(basis,options)=>{privateCompiles++;if(onPrivatePrepare)await onPrivatePrepare(options);const reply={schema:'static-weekly.recurring-admission-candidate.v1',
   candidate:candidateFor(basis),canonicalSource:structuredClone(raw)};mutatePrivate?.(reply);return reply;},
  compilerPreparer:async(input,options)=>{
   if(options.kind==='draft'){draftCompiles++;assert.deepEqual(input.versions[0].assignments,raw.version.assignments);
    return{effectiveStart:week,objectiveVersion:'synthetic',objective:{},inputProvenance:{},document:{versionId:input.versions[0].id},expectedRevision:options.expectedRevision};}
   projectionCompiles++;return{publicationId:options.publicationId,serviceDate:week,exceptionSetDigest:'exceptions',compilerVersion:'synthetic',
    objective:{},metrics:{},replayDigest:'replay',envelope:{authority_digest:'authority'},expectedRevision:options.expectedRevision,
    idempotencyKey:options.actor.idempotencyKey,lunchDocument:{document_identity:'lunch-id',base_replay_digest:'replay',base_authority_digest:'authority'}};
  }});
 return{plane,queries,state:()=>state,connections:()=>connections,checkout:()=>checkedOut,endedClients:()=>endedClients,
  counts:()=>[privateCompiles,draftCompiles,projectionCompiles],
  changeRevision:()=>{state.revision++;},changeGeneration:()=>{state.generation++;},
  setCommitUnknown:value=>{commitUnknown=value;}};
}
let checks=0;
const check=(label,actual,expected)=>{assert.deepEqual(actual,expected,label);checks++;};
// CP source binding only: the injected candidate is deliberately a synthetic
// orchestration fixture, not a proved split-source reduction. The real worker
// independently validates the exact 313-row lineage and current roster.
const source313=harness({publishedAssignmentsCount:313});
const driverWorkExample=seasonWorkFromCandidate(actual.result.assignments);
assert.notEqual(prepareValue(driverWorkExample),JSON.stringify(driverWorkExample),
 'node-postgres formats a JavaScript array as PostgreSQL array text, not JSONB text');checks++;
const autoSourcePreview=await source313.plane.previewRecurringStaffing({manager,effectiveStart:week,expectedRevision:7});
function assertSeasonWitnessJsonb(label,queries){
 const calls=queries.filter(row=>row.sql.includes('static_weekly_sch022_preview_witness'));
 assert.ok(calls.length>0,`${label} must invoke the exact seasonal witness`);
 for(const row of calls){
  assert.equal(typeof row.args[1],'string',`${label} must send JSON text, not a node-postgres array`);
  const work=JSON.parse(prepareValue(row.args[1]));
  assert.ok(Array.isArray(work)&&work.length>0,`${label} must retain typed scheduled work`);
  assert.deepEqual(work,seasonWorkFromCandidate(actual.result.assignments),`${label} must retain exact work identities`);
  checks++;
 }
}
function seasonWorkFromCandidate(assignments){return assignments.map(row=>({
 locationId:row.workSnapshot.locationId||null,locationCode:row.workSnapshot.locationCodeSnapshot,
 includedLocationIds:row.workSnapshot.includedLocations.map(location=>location.locationId)}));}
assertSeasonWitnessJsonb('manager preview',source313.queries);
const authorityReads=source313.queries.filter(row=>row.sql.includes('static_weekly_v3_read_authority_source'));
check('split publication privately fetches only pinned full source under lock',
 authorityReads.map(row=>row.args),[[approvedFullNineSourceId,week]]);
check('preview binds fetched exact registered source bytes',autoSourcePreview.fullNineSourceDigest,digest(raw));
const explicitSourcePreview=await source313.plane.previewRecurringStaffing({manager,effectiveStart:week,
 expectedRevision:7,fullNineSourceId:approvedFullNineSourceId});
assert.notEqual(autoSourcePreview.previewDigest,explicitSourcePreview.previewDigest,
 'implicit pinned fetch and explicit manager request cannot share a confirmation digest');checks++;
await assert.rejects(()=>source313.plane.previewRecurringStaffing({manager,effectiveStart:week,
 expectedRevision:7,fullNineSourceId:id(99)}),error=>error.code==='static_weekly_recurring_full_source_not_approved');checks++;
check('source-binding preview never writes',source313.state().writes,[]);
await source313.plane.close();
const missingPinned=harness({publishedAssignmentsCount:313,registeredSourceId:id(98)});
await assert.rejects(()=>missingPinned.plane.previewRecurringStaffing({manager,effectiveStart:week,
 expectedRevision:7}),error=>error.code==='static_weekly_recurring_full_source_not_approved');checks++;
check('wrong registered-source readback never writes',missingPinned.state().writes,[]);
await missingPinned.plane.close();
const staticNoId=harness({publishedAssignmentsCount:313,forceStaticTemplateCandidate:true});
await assert.rejects(()=>staticNoId.plane.previewRecurringStaffing({manager,effectiveStart:week,
 expectedRevision:7}),error=>error.code==='static_weekly_recurring_preview_rejected');checks++;
check('historical static-nine still requires explicit source request',staticNoId.state().writes,[]);
await staticNoId.plane.close();
const requestFor=async h=>{const preview=await h.plane.previewRecurringStaffing({manager,effectiveStart:week,expectedRevision:7});
 return{manager,effectiveStart:week,expectedRevision:7,confirmationKey:key,previewDigest:preview.previewDigest};};
const h=harness(),request=await requestFor(h),before=h.connections(),start=h.queries.length;
const receipt=await h.plane.confirmRecurringStaffing(request);
const statementBudgets=h.queries.slice(start).filter(row=>row.sql.startsWith('set local statement_timeout'))
 .map(row=>Number(/'([0-9]+)ms'/.exec(row.sql)?.[1]));
assert.ok(statementBudgets.length>3,'every new authority statement must inherit the same absolute operation budget');
assert.ok(statementBudgets.every((value,index)=>Number.isSafeInteger(value)&&value>0&&value<=60_000
 &&(index===0||value<=statementBudgets[index-1])),'SQL statements may only consume the shrinking initial minute');checks++;
assertSeasonWitnessJsonb('manager confirmation',h.queries.slice(start));
check('one client for complete confirmation',h.connections()-before,1);
check('one transaction for all parent children',new Set(h.queries.slice(start).map(x=>x.clientId)).size,1);
check('all owning writes in order',h.state().writes,['source','draft','publication','binding','projection','lunch','targets-and-receipt']);
check('three bounded private preparation stages',h.counts(),[1,1,1]);
check('accepted receipt never means phones applied',[receipt.state,receipt.receipt.accepted,receipt.receipt.affectedPhonesUpdated],['ACCEPTED',true,false]);
check('canonical source not mutated',raw.version.id,id(8));
const priorCounts=h.counts(),priorWrites=structuredClone(h.state().writes);
h.changeRevision();h.changeGeneration();
check('retry returns original acceptance before stale checks',await h.plane.confirmRecurringStaffing(request),receipt);
check('retry does not compile',h.counts(),priorCounts);check('retry does not append',h.state().writes,priorWrites);
await assert.rejects(()=>h.plane.confirmRecurringStaffing({...request,previewDigest:'0'.repeat(64)}),/idempotency conflict/);checks++;
await h.plane.close();
for(const failure of ['static_weekly_v14_admit_recurring_source','static_weekly_v3_create_draft',
 'static_weekly_v3_publish_draft','static_weekly_v18_bind_recurring_publication','static_weekly_v3_materialize_projection',
 'static_weekly_v8_materialize_lunch_document','static_weekly_v23_finalize_recurring_confirmation']){
 const failed=harness({failAt:failure}),r=await requestFor(failed);
 await assert.rejects(()=>failed.plane.confirmRecurringStaffing(r),/injected/);checks++;
 check(failure+' rollback all prior writes',failed.state().writes,[]);
 check(failure+' no accepted receipt',failed.state().receipt,null);
 check(failure+' transaction rolled back',failed.queries.at(-1).sql,'rollback');await failed.plane.close();
}
for(const change of ['revision','generation','preview','manager']){
 const stale=harness(),r=await requestFor(stale);
 if(change==='revision')stale.changeRevision();if(change==='generation')stale.changeGeneration();
 if(change==='preview')r.previewDigest='0'.repeat(64);
 if(change==='manager')r.manager={...manager,manager_id:id(11)};
 await assert.rejects(()=>stale.plane.confirmRecurringStaffing(r),/changed|preview|match/);checks++;
 check(change+' cannot write candidate',stale.state().writes,[]);await stale.plane.close();
}
for(const mutate of [r=>r.canonicalSource.proximity.push({forged:true}),r=>r.candidate.decision.implementationDigest='0'.repeat(64),
 r=>r.candidate.publishedSourceDigest='0'.repeat(64),r=>r.candidate.decision.fixedLunch.loans.push({forged:true}),
 r=>r.candidate.weekCommitment.days[3].descriptorDigest='0'.repeat(64),
 r=>r.candidate.weekCommitment.sourceId=id(99),
 r=>{delete r.candidate.morningCommitment;},
 r=>{r.candidate.morningCommitment.targetEffectiveDate='2026-10-12';
  const {digest:old,...body}=r.candidate.morningCommitment;r.candidate.morningCommitment.digest=contentDigest(body);},
 r=>{r.candidate.morningCommitment.finalSourceDigest='0'.repeat(64);
  const {digest:old,...body}=r.candidate.morningCommitment;r.candidate.morningCommitment.digest=contentDigest(body);},
 r=>{r.candidate.morningCommitment.morningFacts.days.pop();
  r.candidate.morningCommitment.morningFactsDigest=contentDigest(r.candidate.morningCommitment.morningFacts);
  const {digest:old,...body}=r.candidate.morningCommitment;r.candidate.morningCommitment.digest=contentDigest(body);}]){
 const hostile=harness({mutatePrivate:mutate}),r=await requestFor(hostile);
 await assert.rejects(()=>hostile.plane.confirmRecurringStaffing(r),/source|decision|preview|candidate/);checks++;
 check('hostile private candidate writes nothing',hostile.state().writes,[]);await hostile.plane.close();
}
const uncertain=harness(),uncertainRequest=await requestFor(uncertain);
uncertain.setCommitUnknown(true);
await assert.rejects(()=>uncertain.plane.confirmRecurringStaffing(uncertainRequest),e=>e.code==='static_weekly_control_plane_database_unavailable');checks++;
check('lost commit response is not rolled back success',uncertain.state().receipt.accepted,true);
uncertain.setCommitUnknown(false);
const exactStatus=await uncertain.plane.getRecurringConfirmationStatus({manager,confirmationKey:key});
check('unknown outcome resolves by exact durable status',exactStatus.receipt,uncertain.state().receipt);
check('unknown outcome recovery does not recompile',uncertain.counts(),[1,1,1]);
await uncertain.plane.close();
const expired=harness(),expiredRequest=await requestFor(expired);
const expiredBegins=expired.queries.filter(row=>row.sql==='begin').length;
await assert.rejects(()=>expired.plane.confirmRecurringStaffing({...expiredRequest,deadlineAt:performance.now()-1}),
 error=>error.code==='static_weekly_recurring_operation_deadline_exceeded');checks++;
check('expired absolute deadline starts no new SQL transaction',expired.queries.filter(row=>row.sql==='begin').length,expiredBegins);
await expired.plane.close();
let releaseCheckout;
const checkoutGate=new Promise(resolve=>{releaseCheckout=resolve;});
const waitingCheckout=harness({connectGate:checkoutGate}),checkoutAbort=new AbortController();
const checkoutOutcome=assert.rejects(()=>waitingCheckout.plane.previewRecurringStaffing({manager,
 effectiveStart:week,expectedRevision:7,signal:checkoutAbort.signal}),
 error=>error.code==='static_weekly_recurring_operation_aborted');
await new Promise(resolve=>setImmediate(resolve));
checkoutAbort.abort(new Error('synthetic pool checkout interruption'));
await checkoutOutcome;checks++;
releaseCheckout();
await new Promise(resolve=>setImmediate(resolve));
check('late pool checkout never begins a transaction',waitingCheckout.queries,[]);
check('late pool checkout returns only its exact client',waitingCheckout.checkout(),0);
await waitingCheckout.plane.close();
let beginEntered,releaseBegin;
const beginStarted=new Promise(resolve=>{beginEntered=resolve;});
const beginGate=new Promise(resolve=>{releaseBegin=resolve;});
const waitingBegin=harness({onQuery:async sql=>{if(sql==='begin'){beginEntered();await beginGate;}},
 onClientEnd:()=>releaseBegin()}),beginAbort=new AbortController();
const beginOutcome=assert.rejects(()=>waitingBegin.plane.previewRecurringStaffing({manager,
 effectiveStart:week,expectedRevision:7,signal:beginAbort.signal}),
 error=>error.code==='static_weekly_recurring_operation_aborted');
await beginStarted;
beginAbort.abort(new Error('synthetic BEGIN interruption'));
await beginOutcome;checks++;
check('BEGIN interruption invokes exact client termination',waitingBegin.endedClients(),1);
check('BEGIN interruption releases only after driver settlement',waitingBegin.checkout(),0);
await waitingBegin.plane.close();
const duringPrivate=new AbortController();
const privateAbort=harness({onPrivatePrepare:async options=>{
 assert.equal(options.signal instanceof AbortSignal,true);
 assert.equal(options.signal.aborted,false);
 assert.equal(options.deadlineMilliseconds<=60_000,true);
 duringPrivate.abort(new Error('synthetic private cancellation'));
}}),privateRequest=await requestFor(privateAbort);
await assert.rejects(()=>privateAbort.plane.confirmRecurringStaffing({...privateRequest,signal:duringPrivate.signal}),
 error=>error.code==='static_weekly_recurring_operation_aborted'
   && error.cause?.message==='synthetic private cancellation');checks++;
check('private cancellation rolls back without a durable write',privateAbort.state().writes,[]);
await privateAbort.plane.close();
let enteredSql,releaseSql;
const sqlEntered=new Promise(resolve=>{enteredSql=resolve;});
const sqlReleased=new Promise(resolve=>{releaseSql=resolve;});
const duringSql=new AbortController();
const heldSql=harness({onQuery:async sql=>{
 if(sql.includes('static_weekly_v3_create_draft')){enteredSql();await sqlReleased;}
}}),heldRequest=await requestFor(heldSql);
const heldOutcome=assert.rejects(()=>heldSql.plane.confirmRecurringStaffing({...heldRequest,signal:duringSql.signal}),
 error=>error.code==='static_weekly_recurring_operation_aborted'
   && error.cause?.message==='synthetic SQL cancellation');
await sqlEntered;
duringSql.abort(new Error('synthetic SQL cancellation'));
check('abort does not release or roll back an unsettled SQL statement',heldSql.queries.at(-1).sql.includes('static_weekly_v3_create_draft'),true);
releaseSql();await heldOutcome;checks++;
check('settled aborted SQL cannot commit a receipt',heldSql.state().receipt,null);
check('settled aborted SQL rolls back before client release',heldSql.queries.at(-1).sql,'rollback');
await heldSql.plane.close();
let enteredCommit,releaseCommit;
const commitEntered=new Promise(resolve=>{enteredCommit=resolve;});
const commitReleased=new Promise(resolve=>{releaseCommit=resolve;});
const duringCommit=new AbortController();
let pauseConfirmationCommit=false;
const committedUnknown=harness({onQuery:async sql=>{
 if(pauseConfirmationCommit&&sql==='commit'){enteredCommit();await commitReleased;}
}}),commitRequest=await requestFor(committedUnknown);
pauseConfirmationCommit=true;
const unknownAfterAbort=assert.rejects(()=>committedUnknown.plane.confirmRecurringStaffing({
 ...commitRequest,signal:duringCommit.signal}),error=>error.code==='static_weekly_recurring_confirmation_outcome_unknown');
await commitEntered;
duringCommit.abort(new Error('synthetic close during commit'));
releaseCommit();await unknownAfterAbort;checks++;
check('late COMMIT keeps its durable receipt but cannot return PASS',committedUnknown.state().receipt?.accepted,true);
check('late COMMIT is never described as rolled back',committedUnknown.queries.at(-1).sql,'commit');
check('exact status resolves the unknown response after commit',
 (await committedUnknown.plane.getRecurringConfirmationStatus({manager,confirmationKey:key})).receipt,
 committedUnknown.state().receipt);
await committedUnknown.plane.close();
console.log(JSON.stringify({status:'PASS',checks,scope:'mock single-client recurring confirmation ordering, rollback, exact retry and hostile inputs; not SQL/HTTP/phone proof'}));
