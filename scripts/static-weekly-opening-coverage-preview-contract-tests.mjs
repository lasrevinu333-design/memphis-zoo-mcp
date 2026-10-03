import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {loadOpeningCoverageFixture} from './static-weekly-opening-coverage-report-tests.mjs';
import {createRecurringManagerDecision} from '../src/static-weekly-recurring-preview.js';
import {createOpeningCoverageReport,OPENING_COVERAGE_ERROR} from '../src/static-weekly-opening-coverage-report.js';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {installStaticWeeklySha256HexAccelerator,contentDigest} from '../src/static-weekly-schedule-model.js';
import {RECURRING_WEEK_COMMITMENT_SCHEMA,RECURRING_PHASE_SCOPE,RECURRING_MORNING_SCOPE} from '../src/static-weekly-recurring-week-commitment.js';
import {COMPONENT_WEIGHT_LEDGER_DIGEST} from '../src/schedule-component-weight-authority.js';
import {RECURRING_IMPLEMENTATION_DIGEST} from '../src/static-weekly-recurring-preview.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const id=n=>`91000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixture=loadOpeningCoverageFixture().baseline,source=fixture.source,week=source.serviceDate;
const pub=id(2),manager={manager_id:id(1),display_name:'Synthetic opening report manager',active:true,roles:['OPS_MANAGER']};
const actor={...manager,manager_display_name:manager.display_name,auth_mode:'trusted_device'};
let revision=7,generation=2,forge=false,accepted=false,writes=0,privateCalls=0,diagnosticMode=false;
const snapshot=()=>({authority_revision:revision,current_publication:{publication_id:pub},projection_status:'current'});
const published=()=>({publication_id:pub,source_id:id(3),authority_revision:revision,compiler_input:source});
// Explicitly synthetic CP fixture: actual seven-day proof construction is
// covered by the isolated worker, not claimed by this HTTP/report test.
function syntheticSiblingFor(candidate){
 const body={schema:RECURRING_WEEK_COMMITMENT_SCHEMA,status:'PROVEN_CANDIDATE_ONLY',
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
 return {...body,digest:contentDigest(body)};
}
// Synthetic sibling SHAPE only, matching the current mandatory CP fixture.
// This report/HTTP test never claims a fresh morning solve or publication.
function syntheticMorningFor(candidate,basis){
 const late=candidate.weekCommitment;
 const morningFacts={sourceBasisDigest:'a'.repeat(64),originalSourceDigest:contentDigest(basis.publishedSource.compiler_input),
  candidateSourceDigest:late.sourceDigest,targetEffectiveDate:week,targetCalendarReceiptDigest:'b'.repeat(64),
  days:Array.from({length:7},(_,dayOfWeek)=>({dayOfWeek,contractDigest:'c'.repeat(64),metrics:{coverage:[0]},
   selection:[{workId:`synthetic-morning-${dayOfWeek}`,slotId:'synthetic'}],
   terminalOptima:Array.from({length:6},(_,i)=>({name:`synthetic-${i}`,modelDigest:'d'.repeat(64),
    lpDigest:'e'.repeat(64),primitiveObjective:0,originalObjective:0}))}))};
 const body={schema:'custodial.recurring-morning-combined-commitment.v1',scope:RECURRING_MORNING_SCOPE,
  status:'PROVEN_CANDIDATE_ONLY',sourceId:candidate.sourceId,publicationId:candidate.publicationId,
  authorityRevision:candidate.authorityRevision,effectiveWeek:week,
  publishedSourceDigest:candidate.publishedSourceDigest,managerSnapshotDigest:candidate.managerSnapshotDigest,
  readbackPatternDigest:candidate.readbackPatternDigest,originalMorningSourceDigest:morningFacts.originalSourceDigest,
  morningSourceBasisDigest:morningFacts.sourceBasisDigest,originalMorningSourceSqlDigest:candidate.publishedSourceDigest,
  targetCalendarReceiptDigest:morningFacts.targetCalendarReceiptDigest,targetEffectiveDate:week,
  originalCalendarHeaderDigest:'f'.repeat(64),targetCalendarHeaderDigest:'f'.repeat(64),originalDatedOverlayCount:0,
  datedOverlaysRetainedInOriginalOnly:true,recurringRowsAnchorsAvailabilityAndHistoryPreserved:true,
  morningFacts,morningFactsDigest:contentDigest(morningFacts),morningCandidateSourceDigest:late.sourceDigest,
  phaseSourceBasisDigest:late.sourceBasisDigest,lateCommitmentDigest:late.digest,
  finalSourceDigest:late.finalSourceDigest,finalSourceSqlDigest:late.finalSourceSqlDigest,
  finalCanonicalWitnessDigest:late.canonicalHard.witnessDigest,sharedMorningAdmissionBudgetMs:30000,
  originalAnchorsPreserved:true,originalLateReferencePreserved:true,sourceRequiredPlannedMorningOptimum:true,
  openingReadinessProven:false,physicalMinuteFeasibilityClaim:false,acceptedStaticChanged:false,
  datedPriorityChange:false,admitted:false,published:false};
 return {scope:RECURRING_MORNING_SCOPE,sourceBasisDigest:morningFacts.sourceBasisDigest,
  commitment:{...body,digest:contentDigest(body)}};
}
function candidate(basis){
 const assignments=structuredClone(fixture.result.assignments),compiled={status:fixture.result.status,
  publicationAuthority:fixture.result.publicationAuthority,verifier:{ok:fixture.result.verifierOk},
  weeklyAssignments:assignments,openWork:assignments.filter(x=>fixture.result.open.includes(x.planWorkId)),reviewWork:[],
  compilerVersion:fixture.result.compilerVersion,timezone:fixture.result.timezone,metrics:fixture.result.metrics,canonicalAuthority:{}};
 const decision=createRecurringManagerDecision({candidateInput:source,compiled,lunch:fixture.result.lunch,changes:[]}),decisionDigest=digest(decision);
 const c={status:'CANDIDATE_ONLY',compilerStatus:'FEASIBLE',publicationAuthority:'ACCEPTABLE',verifierOk:true,
  weekOptimizationScope:RECURRING_PHASE_SCOPE,staffedPositions:7,sourcePatternKind:'UNSPLIT',
  sourceId:id(3),publicationId:pub,authorityRevision:basis.expectedRevision,effectiveDate:week,compilerVersion:compiled.compilerVersion,
  candidateSourceDigest:digest(source),publishedSourceDigest:digest(basis.publishedSource.compiler_input),managerSnapshotDigest:digest(basis.managerSnapshot),
  fullNineSourceDigest:null,readbackPatternDigest:'a'.repeat(64),patternFingerprint:'b'.repeat(64),
  phaseSourceBasisDigest:'4'.repeat(64),
  modelBasisDigest:'b'.repeat(64),assignmentWitnessDigest:'c'.repeat(64),finalWitnessDigest:'d'.repeat(64),
  weeklyAssignmentsDigest:digest(assignments),metricsDigest:digest(decision.metrics),lunchFactsDigest:digest(decision.fixedLunch),
  openWorkDigest:digest(decision.gaps.open),shiftEndDerivationDigest:digest(null),lunchLoanCount:decision.fixedLunch.loans.length,
  openWorkCount:decision.gaps.open.length,reviewWorkCount:0,assignmentCount:source.version.assignments.length,
  registrationRequired:true,managerConfirmationRequired:true,changes:[],decision,decisionDigest};
 c.weekCommitment=syntheticSiblingFor(c);
 const morning=syntheticMorningFor(c,basis);
 c.morningOptimizationScope=morning.scope;
 c.morningSourceBasisDigest=morning.sourceBasisDigest;
 c.morningCommitment=morning.commitment;
 c.openingCoverageReport=createOpeningCoverageReport({source,assignments,lunch:fixture.result.lunch,
  context:{publicationId:pub,authorityRevision:basis.expectedRevision},decisionDigest});return c;
}
const database={async connect(){return {async query(sql,args=[]){const result=x=>({rows:[{result:x}]});
 if(sql.includes('static_weekly_v15_read_recurring_generation'))return result(generation);
 if(sql.includes('static_weekly_sch022_preview_witness'))return result('9'.repeat(64));
 if(sql.includes('static_weekly_v3_read_manager_snapshot'))return result(snapshot());
 if(sql.includes('static_weekly_v20_read_recurring_preview_basis'))return result(published());
 if(sql.includes('static_weekly_v13_begin_recurring_confirmation'))return result(accepted?{state:'ACCEPTED',receipt:{accepted:true,affectedPhonesUpdated:false}}:{state:'RESERVED',operationId:id(4)});
 if(sql.includes('static_weekly_v14_admit_recurring_source')){writes++;throw new Error('TEST_STOP_AFTER_VERIFIED_SOURCE_ADMISSION_BOUNDARY');}
 return {rows:[]};},release(){}};},async end(){}};
const plane=createStaticWeeklyControlPlane({database,shutdownCompiler:async()=>{},
 recurringCandidatePreparer:async basis=>{
  const c=candidate(basis);if(diagnosticMode){const rows=structuredClone(c.decision.assignments);rows[0].personId=id(999);
   createOpeningCoverageReport({source,assignments:rows,lunch:fixture.result.lunch});}return c;},
 recurringAdmissionPreparer:async basis=>{privateCalls++;const c=candidate(basis);
  if(forge==='DIRECT_PREPARATION'){const unchecked=c.openingCoverageReport;delete c.openingCoverageReport;
   return {schema:'static-weekly.recurring-admission-candidate.v1',candidate:c,canonicalSource:source,openingCoverageReport:unchecked};}
  if(forge==='MORNING_MISSING')delete c.morningCommitment;
  if(forge==='MORNING_CHANGED'){
   c.morningCommitment.finalSourceDigest='0'.repeat(64);
   const {digest:old,...body}=c.morningCommitment;c.morningCommitment.digest=contentDigest(body);
  }
  if(forge===true){c.openingCoverageReport.rows[0].knownComponentWeight++;
   const {reportDigest,...body}=c.openingCoverageReport;c.openingCoverageReport.reportDigest=digest(body);}
  return {schema:'static-weekly.recurring-admission-candidate.v1',candidate:c,canonicalSource:source};}});
let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
const input={manager:actor,effectiveStart:week,expectedRevision:7},preview=await plane.previewRecurringStaffing(input);
check(preview.published,false);check(preview.affectedPhonesUpdated,false);check(preview.openingCoverageReport.assignmentDigest,digest(preview.decision.assignments));
const request={...input,confirmationKey:id(5),previewDigest:preview.previewDigest};
forge=true;await assert.rejects(()=>plane.confirmRecurringStaffing(request),e=>e.code===OPENING_COVERAGE_ERROR);checks++;check(writes,0);
forge='DIRECT_PREPARATION';await assert.rejects(()=>plane.confirmRecurringStaffing(request),e=>e.code===OPENING_COVERAGE_ERROR);checks++;check(writes,0);
for(const missingOrChanged of ['MORNING_MISSING','MORNING_CHANGED']){
 forge=missingOrChanged;
 await assert.rejects(()=>plane.confirmRecurringStaffing(request),e=>e.code==='static_weekly_recurring_preview_rejected');checks++;
 check(writes,0);
}
forge=false;revision=8;await assert.rejects(()=>plane.confirmRecurringStaffing(request),/changed before preview/);checks++;check(writes,0);revision=7;
await assert.rejects(()=>plane.confirmRecurringStaffing(request),/TEST_STOP_AFTER_VERIFIED_SOURCE_ADMISSION_BOUNDARY/);checks++;check(writes,1);
// The marker deliberately stops before SQL writes; it is a source-boundary
// test, NOT a fake accepted publication or database proof.
accepted=true;revision=9;const before=privateCalls;
check((await plane.confirmRecurringStaffing(request)).state,'ACCEPTED');check(privateCalls,before);revision=7;accepted=false;
await assert.rejects(()=>plane.previewRecurringStaffing({...input,manager:{...actor,read_only:true}}),/named manager/);checks++;
await assert.rejects(()=>plane.previewRecurringStaffing({...input,manager:{...actor,auth_mode:'admin_api_key'}}),/named manager/);checks++;
const env={NODE_ENV:'test',SUPABASE_URL:'https://opening-test.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-only',
 OPS_MANAGER_SESSION_SECRET:'synthetic-opening-session-secret-0123456789'};
let revoked=false;
const store={async find(){return revoked?null:{credential_id:'opening-credential',device_id:'opening-device',max_access_level:'full_access',
  created_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),manager_id:manager.manager_id,manager};}};
const session=createOpsManagerSession({credentialId:'opening-credential',deviceId:'opening-device',manager,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env});
const runtime=createStaticWeeklyControlPlaneRuntime({env,database:{},datedTransitionController:null,controlPlane:plane,trustedDeviceStore:store,
 recurringOperationAdmission:({action})=>action(),
 recurringOperationRunner:({kind,manager:actor,body,signal,deadlineAt})=>{
  assert.equal(kind,'preview','this opening-coverage fixture invokes only the actual preview method');
  return plane.previewRecurringStaffing({manager:actor,effectiveStart:body.effective_start,
   expectedRevision:body.expected_revision,fullNineSourceId:body.full_nine_source_id??null,signal,deadlineAt});
 },
 supabase:{async rpc(name){
  if(name==='custodial_release_application_mutation_lease'||name==='custodial_heartbeat_application_mutation_lease')return{data:true,error:null};
  assert.equal(name,'custodial_begin_application_mutation_lease');
  return {data:{mutations_paused:false,state:'READY',authority_generation:0,restore_id:null},error:null};}}});
const server=createServer(runtime.app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/static-weekly/recurring-adaptation/preview`;
async function http(body,authorized=true){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:`Bearer ${session.token}`}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
try{
 const body={effective_start:week,expected_revision:7};check((await http(body,false)).status,401);
 const ok=await http(body);check(ok.status,200);check(ok.body.data.openingCoverageReport.reportDigest,preview.openingCoverageReport.reportDigest);
 for(const key of ['compiler_input','source','candidate','openingCoverageReport','manager_id'])check((await http({...body,[key]:{forged:true}})).status,422);
 diagnosticMode=true;const rejected=await http(body);check(rejected.status,422);check(rejected.body.code,OPENING_COVERAGE_ERROR);
 check(rejected.body.openingCoverageDiagnostic.nonAdmissible,true);check(rejected.body.openingCoverageDiagnostic.findings[0].code,'owner_identity_mismatch');
 check(Object.hasOwn(rejected.body,'data'),false);diagnosticMode=false;revoked=true;check((await http(body)).status,401);
}finally{await new Promise(resolve=>server.close(resolve));await plane.close();}
// Exact adoption topology; actual worker uses the same helper after verifier,
// and the locked private path requires canonical recomputation. No SQL edits.
for(const [file,needles]of [['../src/static-weekly-schedule-compiler-worker.js',['decisionDigest, openingCoverageReport','source:candidate.compilerInput','source,assignments:result.weeklyAssignments']],
 ['../src/static-weekly-control-plane.js',['assertRecurringAdmissionCandidate(prepared)','recurringPreviewDigest(actor, basis, candidate) !== expectedDigest']],
 ['../src/static-weekly-recurring-preview.js',['assertOpeningCoverageCanonicalReport(reply.candidate,source)']]]){
 const text=readFileSync(new URL(file,import.meta.url),'utf8');for(const needle of needles){assert.ok(text.includes(needle),needle);checks++;}}
console.log(JSON.stringify({status:'PASS',checks,scope:'actual retained selection → helper/private canonical check + actual CP preview/CAS/retry/admission boundary + authenticated loopback HTTP; DB writes/publication deliberately not executed',loopbackClosed:!server.listening}));
