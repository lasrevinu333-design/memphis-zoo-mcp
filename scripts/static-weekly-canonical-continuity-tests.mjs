import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareStaticWeeklySchedulingProblem,postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {createShiftEndContinuityPolicy} from '../src/static-weekly-shift-end-derivation.js';
import {compileStaticWeeklySchedule} from '../src/static-weekly-schedule-compiler.js';
import {verifyStaticWeeklyScheduleResult} from '../src/static-weekly-schedule-verifier.js';
import {createStaticWeeklyDraftRpcInput} from '../src/static-weekly-schedule-database-adapter.js';

const templatePath=process.env.STATIC_WEEKLY_CONTINUITY_TEMPLATE;
assert.ok(templatePath,'explicit full template required; no production access');
const templatePacket=JSON.parse(readFileSync(templatePath,'utf8'));
const source=structuredClone(templatePacket.compilerInput);
const configBytes=readFileSync(new URL('../config/custodial-recurring-schedule-20260924.json',import.meta.url));
const config=JSON.parse(configBytes),digest=postgresJsonbContentDigest;
assert.deepEqual(source.version.shiftEndContinuityPolicy,createShiftEndContinuityPolicy(config.weights,createHash('sha256').update(configBytes).digest('hex'),digest),'consume exact source policy without replacing it in the test');
const original=JSON.stringify(source);
const asInput=s=>{const x=structuredClone(s);x.versions=[x.version];delete x.version;return x;};
const prepare=s=>{const p=prepareStaticWeeklySchedulingProblem(asInput(s));assert.equal(p.error,undefined,JSON.stringify(p.error));return p;};
const time=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
const physical=r=>r.includedLocations?.length?r.includedLocations.map(l=>l.locationId):[r.locationId];
function independentCoverage(problem){
 let checks=0;
 for(let day=0;day<7;day++){
  const expected=new Set(source.version.assignments.filter(r=>r.dayOfWeek===day&&r.window.start==='09:45').flatMap(physical));
  const close=time(problem.shiftEndDerivation.staffedDepartureByDay[day]);
  const rows=problem.work.filter(r=>r.dayOfWeek===day&&time(r.window.start)>=585);
  for(let at=585;at<close;at++){
   const counts=new Map();
   for(const row of rows.filter(r=>time(r.window.start)<=at&&at<time(r.window.end)))for(const id of physical(row))counts.set(id,(counts.get(id)||0)+1);
   assert.equal(counts.size,expected.size,`missing responsibility day=${day} minute=${at}`);
   for(const id of expected){assert.equal(counts.get(id),1);checks++;}
  }
  assert.ok(rows.every(r=>time(r.window.end)<=close));
 }
 return checks;
}
function fill(s,slotId,effectiveStart=s.serviceDate){
 const slot=s.slots.find(r=>r.id===slotId);
 const hex=createHash('sha256').update(`SYNTHETIC_CANONICAL_CONTINUITY:${slotId}`).digest('hex');
 slot.incumbencies.push({personId:`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`,
  displayName:'SYNTHETIC TEST ONLY',effectiveStart,effectiveEnd:null});
 s.version.vacantSlotIds=s.version.vacantSlotIds.filter(id=>id!==slotId);
 for(const a of s.version.slotAvailability.filter(a=>a.slotId===slotId)){
  const d=new Date(`${s.serviceDate}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+(a.dayOfWeek-d.getUTCDay()+7)%7);
  if(d.toISOString().slice(0,10)>=effectiveStart)a.status='working';
 }
}
const current=prepare(source);
assert.equal(current.baselineCanonicalInput.version.assignments.length,313);
assert.equal(current.work.length,458);
assert.equal(independentCoverage(current),131625);
assert.equal(current.shiftEndDerivation.parentChains.reduce((n,c)=>n+c.workloadAfter,0),7857);
assert.ok(current.work.some(r=>r.dayOfWeek===5&&r.locationCodeSnapshot==='HERPETARIUM'&&r.window.start==='15:00'&&r.vacantBaseline));
const late=structuredClone(source);fill(late,config.slots.OPTION1.slotId);
const later=prepare(late);
assert.equal(later.shiftEndDerivation.staffedDepartureByDay[4],'17:00');
assert.equal(later.shiftEndDerivation.staffedDepartureByDay[5],'17:00');
assert.deepEqual(late.version.assignments,source.version.assignments);
const laterChecks=independentCoverage(later);
const herpTail=later.work.find(r=>r.dayOfWeek===5&&r.locationCodeSnapshot==='HERPETARIUM'&&r.window.end==='17:00');
assert.ok(herpTail&&!herpTail.vacantBaseline&&herpTail.required);
assert.ok(later.candidates.some(c=>c.item.key===herpTail.key&&c.slot.id===config.slots.OPTION1.slotId));
const dated=structuredClone(source);fill(dated,config.slots.OPTION1.slotId,'2026-10-02');
const transition=prepare(dated);
assert.equal(transition.shiftEndDerivation.staffedDepartureByDay[4],'16:00');
assert.equal(transition.shiftEndDerivation.staffedDepartureByDay[5],'17:00');
independentCoverage(transition);
const full=structuredClone(source);for(const id of source.version.vacantSlotIds)fill(full,id);
const fully=prepare(full);independentCoverage(fully);
assert.ok(fully.work.every(r=>!r.vacantBaseline));
assert.deepEqual(prepare(source).shiftEndDerivation,current.shiftEndDerivation,'deterministic receipt');
// Manager day changes must not regenerate or rewrite the recurring baseline.
// A contractor exists as registered capacity, but is never activated merely
// because staff are absent. These probes use the exact current full template.
const serviceDay=new Date(`${source.serviceDate}T12:00:00Z`).getUTCDay();
const present=current.roster.filter(r=>r.availability==='working'&&!source.slots.find(s=>s.id===r.slotId)?.contractorCapacity);
assert.ok(present.length>=2,'two actual currently staffed positions required');
const contractor=source.slots.find(s=>s.contractorCapacity===true);
assert.ok(contractor?.contractorAvailability?.some(a=>a.dayOfWeek===serviceDay));
const absentIds=present.slice(0,2).map(r=>r.slotId);
const exception=(id,type,payload,sequence)=>({id,type,payload,sequence,serviceDate:source.serviceDate,
 baseVersionId:source.version.id,publicationId:source.version.publicationId,actorId:'SYNTHETIC_MANAGER',
 reason:'Synthetic explicit manager day change',idempotencyKey:id,expectedRevision:1});
const absent=structuredClone(source);
absent.exceptions=absentIds.map((slotId,i)=>exception(`synthetic-absence-${i}`,i?'daily_absence':'pto',{slotId},i+1));
const absencePrepared=prepare(absent);
assert.deepEqual(absencePrepared.baselineCanonicalInput,current.baselineCanonicalInput,'absences preserve the immutable canonical baseline');
assert.deepEqual(absencePrepared.shiftEndDerivation,current.shiftEndDerivation,'absences do not silently change dated roster-derived responsibility');
assert.deepEqual(absencePrepared.derivedBaselineCanonicalInput,current.derivedBaselineCanonicalInput);
assert.equal(absencePrepared.applied.length,2);
for(const id of absentIds)assert.equal(absencePrepared.states.get(serviceDay).availability.get(id).status,'absent');
assert.ok(!absencePrepared.candidates.some(c=>c.item.dayOfWeek===serviceDay&&(absentIds.includes(c.slot.id)||c.slot.contractorCapacity)),'neither absent people nor unrequested CoverAll become candidates');
const withCover=structuredClone(absent);
const availability=structuredClone(contractor.contractorAvailability.find(a=>a.dayOfWeek===serviceDay));
delete availability.dayOfWeek;availability.slotId=contractor.id;
withCover.exceptions.push(exception('synthetic-requested-coverall','cover_all',{availability},3));
const covered=prepare(withCover);
assert.deepEqual(covered.baselineCanonicalInput,current.baselineCanonicalInput,'explicit CoverAll preserves immutable canonical baseline');
assert.deepEqual(covered.derivedBaselineCanonicalInput,current.derivedBaselineCanonicalInput);
assert.equal(covered.applied.length,3);
assert.ok(covered.candidates.some(c=>c.item.dayOfWeek===serviceDay&&c.slot.id===contractor.id),'explicitly requested registered CoverAll creates eligible capacity');
for(const day of [0,1,2,3,4,5,6].filter(d=>d!==serviceDay))assert.deepEqual(covered.states.get(day),current.states.get(day),'day change does not leak to another day');
assert.deepEqual(absent.version,source.version);assert.deepEqual(withCover.version,source.version);
for(const [name,mutate] of [
 ['policy digest',s=>{s.version.shiftEndContinuityPolicy.weights.EXPO=4;}],
 ['missing weight',s=>{delete s.version.shiftEndContinuityPolicy.weights.HERPETARIUM;const {policyDigest,...body}=s.version.shiftEndContinuityPolicy;s.version.shiftEndContinuityPolicy.policyDigest=digest(body);} ],
 ['truncated source',s=>{s.version.assignments.find(r=>r.dayOfWeek===4&&r.window.end==='17:00').window.end='16:00';}],
 ['already derived',s=>{s.version.shiftEndDerivationApplied=s.version.shiftEndContinuityPolicy.policyDigest;}],
 ['unverified routes',s=>{s.proximity=[];}],
]){
 const bad=structuredClone(source);mutate(bad);assert.ok(prepareStaticWeeklySchedulingProblem(asInput(bad)).error,name);
}
assert.equal(JSON.stringify(source),original,'immutable template unchanged by every derivation');
let compileEvidence=null;
if(process.argv.includes('--compile')){
 const input=asInput(source),result=await compileStaticWeeklySchedule(input);
 assert.equal(result.status,'FEASIBLE',JSON.stringify(result.fatal||result.verifier));assert.equal(result.verifier.ok,true);
 assert.equal(result.canonicalAuthority.schema,'memphis-zoo.static-weekly-authority.v4');
 assert.equal(result.canonicalAuthority.compilerInput.version.assignments.length,313);
 assert.equal(result.canonicalAuthority.overlayCompilerInput.version.assignments.length,458);
 assert.equal(verifyStaticWeeklyScheduleResult(input,result).ok,true,'full assembled authority independently verified');
 const draft=createStaticWeeklyDraftRpcInput({result,expectedRevision:0,actor:{managerId:'10000000-0000-4000-8000-000000000001',managerName:'SYNTHETIC REVIEW',idempotencyKey:'synthetic-continuity-v9'}});
 assert.ok(draft.document?.authority);
 const forged=structuredClone(result);forged.canonicalAuthority.shiftEndDerivation.parentChains[0].workloadAfter++;
 assert.equal(verifyStaticWeeklyScheduleResult(input,forged).ok,false,'forged parent receipt rejected');
 compileEvidence={status:result.status,replayDigest:result.replayDigest,documentIdentity:draft.document.validation.database_document_identity};
 if(process.env.STATIC_WEEKLY_CONTINUITY_RESULT)writeFileSync(process.env.STATIC_WEEKLY_CONTINUITY_RESULT,
  JSON.stringify({classification:'SYNTHETIC_LOCAL_NOT_ADMITTED',compilerInput:source,input,result,draft})+'\n',{flag:'wx'});
}
console.log(JSON.stringify({passed:true,currentRows:current.work.length,currentChecks:131625,laterRows:later.work.length,laterChecks,
 templateRows:source.version.assignments.length,immutablePolicyDigest:source.version.shiftEndContinuityPolicy.policyDigest,
 managerExceptions:{absences:2,explicitCoverAll:1,unchangedBaseline:true,unrequestedContractorCapacity:false},
 compileEvidence,databaseProof:false,releaseAcceptance:false},null,2));
