import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {withApprovedManualFixtureCapacities} from './fixtures/approved-manual-capacity-source.mjs';
import {createStaticWeeklyCompilerRuntime} from '../src/static-weekly-schedule-compiler-runtime.js';
import {captureApprovedManualPeriodWorkerResult} from '../src/approved-manual-period-worker.js';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
assert.ok(process.argv.length===2||(process.argv.length===3&&isAbsolute(process.argv[2])));
const out=process.argv[2];if(out)fs.mkdirSync(out,{mode:0o700});
const save=(name,x)=>{if(out)fs.writeFileSync(resolve(out,name),JSON.stringify(x,null,2)+'\n',{flag:'wx',mode:0o600});};
const week=readApprovedManualWeek(),draft=prepareApprovedManualSourceDraft({week,
 referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))}),
 source=withApprovedManualFixtureCapacities(draft.sourceDraft),frameStart='2026-11-02';
delete source.publicationAuthority;source.serviceDate=frameStart;
Object.assign(source.version,{id:'00000000-0000-4000-8000-000000001001',publicationId:'00000000-0000-4000-8000-000000001002',status:'published',effectiveStart:frameStart});
const base={schema:'custodial.approved-manual-period-worker-input.v1',source,ownerConfig:draft.ownerConfig,frameStart,
 changes:[],priorDays:[],acceptedExceptions:[],actor:{managerId:'00000000-0000-4000-8000-000000001099',managerName:'DISPOSABLE_DATA_FIXTURE_NOT_A_REAL_MANAGER'},
 expectedRevision:0,idempotencyKey:'local-native-period-worker-not-an-accepted-request'},runtime=createStaticWeeklyCompilerRuntime();
const startedAt=new Date().toISOString();save('INTENT.json',{startedAt,scope:'Existing owned isolated compiler queue, DATA only; typed capacity fixture has no production registration',
 production:false,SQL:false,genuineBrowser:false,physical:false});
let pulses=0,maxGap=0,prior=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-prior);prior=now;pulses++;},25);
let result;
try{
 const getter=structuredClone(base);let getterCalls=0;
 Object.defineProperty(getter,'ownerConfig',{enumerable:true,get(){getterCalls++;throw Error('must not run');}});
 await assert.rejects(()=>runtime.compileAndPrepare(getter,{kind:'approved-manual-period'},{deadlineAtMilliseconds:performance.now()+60000}));assert.equal(getterCalls,0);
 const normal=await runtime.compileAndPrepare(base,{kind:'approved-manual-period'},{deadlineAtMilliseconds:performance.now()+60000});
 assert.equal(normal.period.solverInvoked,false);assert.equal(normal.nativeProjection.projectionAssignments.length,346);
 const changed=structuredClone(base),absent=['Jada','Derrick'].map(name=>week.referenceBindings.people.find(p=>p.approvedName.startsWith(name+' ')));
 changed.changes=[{serviceDate:'2026-11-03',absentPersonIds:absent.map(p=>p.employeeId)}];
 changed.acceptedExceptions=absent.map((p,i)=>({id:`local-pto-fixture-${i}`,type:'pto',status:'accepted',serviceDate:'2026-11-03',
  baseVersionId:source.version.id,publicationId:source.version.publicationId,actorId:base.actor.managerId,reason:'LOCAL_DATA_FIXTURE_NOT_REAL_APPROVAL',
  idempotencyKey:`local-pto-fixture-${i}`,expectedRevision:0,sequence:i+1,payload:{slotId:p.slotId}}));
 const detached=structuredClone(changed),original=digest(detached),pending=runtime.compileAndPrepare(changed,{kind:'approved-manual-period'},
  {deadlineAtMilliseconds:performance.now()+60000});
 changed.changes[0].absentPersonIds[0]='late-mutated-invalid-person';
 const prepared=await pending;
 assert.equal(prepared.requestDigest,original);assert.equal(prepared.period.solverInvoked,true);
 assert.deepEqual(prepared.period.solvedDates,['2026-11-03']);assert.equal(prepared.nativeProjection.lunchDocument.loans.length,38);
 assert.equal(prepared.productionWritten,false);assert.equal(prepared.publicationEligible,false);
 const tampered=structuredClone(prepared);tampered.nativeProjection.projectionAssignments[0].owner_person_id='altered';
 assert.throws(()=>captureApprovedManualPeriodWorkerResult(tampered,detached));
 assert.ok(pulses>20);assert.ok(maxGap<2000,`Parent event loop stalled ${maxGap}ms`);
 save('NORMAL.json',normal);save('ADJUSTED.json',prepared);
 result={status:'PASS',startedAt,scope:'Real existing isolated compiler process, bounded IPC, native hard constraints and lunch DATA; no database/publication claim',
 normalSolverBypassed:true,oneDatedTwoAbsenceSolve:true,normalAssignments:346,adjustedLunches:38,
 parentPulses:pulses,maxParentGapMilliseconds:Math.round(maxGap),originalInputDetachedBeforeAwait:true,
 gettersNotExecuted:true,tamperedResultRefused:true,productionWritten:false};
}finally{clearInterval(timer);await runtime.shutdown();}
assert.equal(runtime.getReadiness().state,'closed');result.ownedRuntimeCleanup='SUPPORTED_SHUTDOWN_RETURNED';result.finishedAt=new Date().toISOString();
save('RESULT.json',result);console.log(JSON.stringify(result));
