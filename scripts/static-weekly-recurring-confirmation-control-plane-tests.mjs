import assert from 'node:assert/strict';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {RECURRING_DECISION_SCHEMA,RECURRING_IMPLEMENTATION_DIGEST} from '../src/static-weekly-recurring-preview.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {createOpeningCoverageReport} from '../src/static-weekly-opening-coverage-report.js';
import {loadOpeningCoverageFixture} from './static-weekly-opening-coverage-report-tests.mjs';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {createHash} from 'node:crypto';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));

// Transaction orchestration only. SQL, compiler, HTTP and physical proofs are
// separately required; this mock never supplies release authority.
const id=n=>`81000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
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
  sourceId,publicationId:oldPublication,authorityRevision:basis.expectedRevision,effectiveDate:week,
  publishedSourceDigest:digest(basis.publishedSource.compiler_input),managerSnapshotDigest:digest(basis.managerSnapshot),
  fullNineSourceDigest:basis.fullNineSource?digest(basis.fullNineSource.compiler_input):null,
  candidateSourceDigest:digest(raw),readbackPatternDigest:'c'.repeat(64),modelBasisDigest:'d'.repeat(64),
  assignmentWitnessDigest:'e'.repeat(64),finalWitnessDigest:'f'.repeat(64),weeklyAssignmentsDigest:digest(decision.assignments),
  metricsDigest:digest(decision.metrics),lunchFactsDigest:digest(decision.fixedLunch),openWorkDigest:digest(decision.gaps.open),
  shiftEndDerivationDigest:digest(null),lunchLoanCount:decision.fixedLunch.loans.length,openWorkCount:decision.gaps.open.length,reviewWorkCount:0,assignmentCount:raw.version.assignments.length,
  compilerVersion:decision.compilerVersion,decision,decisionDigest:digest(decision),changes:[],
  registrationRequired:true,managerConfirmationRequired:true};
 const reportKey=digest({sourceDigest:digest(raw),decisionDigest:candidate.decisionDigest,revision:basis.expectedRevision});
 if(!reportCache.has(reportKey))reportCache.set(reportKey,createOpeningCoverageReport({source:raw,assignments:decision.assignments,lunch:actual.result.lunch,
  context:{publicationId:oldPublication,authorityRevision:basis.expectedRevision},decisionDigest:candidate.decisionDigest}));
 candidate.openingCoverageReport=structuredClone(reportCache.get(reportKey));
 return candidate;
}
function harness({failAt=null,mutatePrivate=null,commitUnknown=false}={}){
 let state={revision:7,generation:2,publication:oldPublication,projection:null,receipt:null,writes:[]};
 let backup,connections=0,checkedOut=0,privateCompiles=0,draftCompiles=0,projectionCompiles=0,beginRequest=null;
 const queries=[];let clientSerial=0;
 const database={async connect(){connections++;checkedOut++;assert.equal(checkedOut,1,'only ONE checked-out client');
  const clientId=++clientSerial;
  return{async query(sql,args=[]){queries.push({sql,args:structuredClone(args),clientId});
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
    publication_id:oldPublication,authority_revision:state.revision,compiler_input:structuredClone(raw)});
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
  },release(){checkedOut--;}};
 },async end(){assert.equal(checkedOut,0);}};
 const plane=createStaticWeeklyControlPlane({database,shutdownCompiler:async()=>{},
  recurringCandidatePreparer:async basis=>candidateFor(basis),
  recurringAdmissionPreparer:async basis=>{privateCompiles++;const reply={schema:'static-weekly.recurring-admission-candidate.v1',
   candidate:candidateFor(basis),canonicalSource:structuredClone(raw)};mutatePrivate?.(reply);return reply;},
  compilerPreparer:async(input,options)=>{
   if(options.kind==='draft'){draftCompiles++;assert.deepEqual(input.versions[0].assignments,raw.version.assignments);
    return{effectiveStart:week,objectiveVersion:'synthetic',objective:{},inputProvenance:{},document:{versionId:input.versions[0].id},expectedRevision:options.expectedRevision};}
   projectionCompiles++;return{publicationId:options.publicationId,serviceDate:week,exceptionSetDigest:'exceptions',compilerVersion:'synthetic',
    objective:{},metrics:{},replayDigest:'replay',envelope:{authority_digest:'authority'},expectedRevision:options.expectedRevision,
    idempotencyKey:options.actor.idempotencyKey,lunchDocument:{document_identity:'lunch-id',base_replay_digest:'replay',base_authority_digest:'authority'}};
  }});
 return{plane,queries,state:()=>state,connections:()=>connections,counts:()=>[privateCompiles,draftCompiles,projectionCompiles],
  changeRevision:()=>{state.revision++;},changeGeneration:()=>{state.generation++;},
  setCommitUnknown:value=>{commitUnknown=value;}};
}
let checks=0;
const check=(label,actual,expected)=>{assert.deepEqual(actual,expected,label);checks++;};
const requestFor=async h=>{const preview=await h.plane.previewRecurringStaffing({manager,effectiveStart:week,expectedRevision:7});
 return{manager,effectiveStart:week,expectedRevision:7,confirmationKey:key,previewDigest:preview.previewDigest};};
const h=harness(),request=await requestFor(h),before=h.connections(),start=h.queries.length;
const receipt=await h.plane.confirmRecurringStaffing(request);
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
 r=>r.candidate.publishedSourceDigest='0'.repeat(64),r=>r.candidate.decision.fixedLunch.loans.push({forged:true})]){
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
console.log(JSON.stringify({status:'PASS',checks,scope:'mock single-client recurring confirmation ordering, rollback, exact retry and hostile inputs; not SQL/HTTP/phone proof'}));
