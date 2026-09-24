import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createShiftEndContinuityPolicy} from '../src/static-weekly-shift-end-derivation.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {compileAndPrepareStaticWeeklyScheduleIsolated,shutdownStaticWeeklyCompiler,
 STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS} from '../src/static-weekly-schedule-compiler-runtime.js';

const file=process.env.STATIC_WEEKLY_CONTINUITY_TEMPLATE;
assert.ok(file,'explicit reviewed full-template fixture required; no production access');
const source=structuredClone(JSON.parse(readFileSync(file,'utf8')).compilerInput);
const bytes=readFileSync(new URL('../config/custodial-recurring-schedule-20260924.json',import.meta.url)),config=JSON.parse(bytes);
assert.deepEqual(source.version.shiftEndContinuityPolicy,createShiftEndContinuityPolicy(config.weights,createHash('sha256').update(bytes).digest('hex'),digest),'test consumes exact generated policy; never substitutes a different source');
const original=digest(source),actor={managerId:'10000000-0000-4000-8000-000000000101',managerName:'Synthetic Runtime Proof',idempotencyKey:'synthetic-full-runtime'};
try {
 for(const full of [false,true]){
  const s=structuredClone(source);
  if(full)for(const [i,id] of s.version.vacantSlotIds.entries()){
   s.slots.find(slot=>slot.id===id).incumbencies=[{personId:`40000000-0000-4000-8000-00000000020${i}`,
    displayName:`Synthetic Runtime Hire ${i}`,effectiveStart:s.serviceDate,effectiveEnd:null}];
   for(const a of s.version.slotAvailability.filter(a=>a.slotId===id))a.status='working';
  }
  if(full)s.version.vacantSlotIds=[];
  const {version,...rest}=s,input={...rest,versions:[version]},start=performance.now();
  const projection=await compileAndPrepareStaticWeeklyScheduleIsolated(input,{kind:'projection',publicationId:s.version.publicationId,expectedRevision:0,actor});
  assert.equal(projection.envelope.authority.schema,'memphis-zoo.static-weekly-authority.v4');
  assert.equal(projection.envelope.authority.compilerInput.version.assignments.length,313);
  assert.equal(projection.envelope.authority.shiftEndDerivation.staffedDepartureByDay[4],full?'17:00':'16:00');
  assert.equal(projection.envelope.authority.shiftEndDerivation.staffedDepartureByDay[5],full?'17:00':'16:00');
  assert.equal(projection.lunchDocument.verification_status,'VERIFIED');
  assert.equal(projection.lunchDocument.base_replay_digest,projection.replayDigest);
  assert.equal(projection.lunchDocument.base_authority_digest,projection.envelope.authority_digest);
  assert.equal(projection.lunchDocument.loans.filter(l=>l.status==='REVIEW_REQUIRED').length,0);
  const loans=projection.lunchDocument.loans;
  assert.equal(loans.length,full?45:30,'exact owner workdays and filled positions');
  console.log(JSON.stringify({status:'PASS',case:full?'three-later-fills':'current-six-incumbents',
   sourceDigest:digest(s),replayDigest:projection.replayDigest,derivedRows:projection.envelope.authority.overlayCompilerInput.version.assignments.length,
   lunchIdentity:projection.lunchDocument.document_identity,loans:loans.length,
   elapsedMilliseconds:Math.round(performance.now()-start),limits:STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS,
   productionWorkerCompilerAdapterLunch:true,production:false,independentAudit:false}));
 }
 assert.equal(digest(source),original);
} finally {await shutdownStaticWeeklyCompiler();}
