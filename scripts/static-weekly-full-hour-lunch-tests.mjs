import assert from 'node:assert/strict';
import './approved-manual-week-tests.mjs';
import {fullHourLunchFixture} from './fixtures/full-hour-lunch-source.mjs';
import {compileStaticWeeklySchedule} from '../src/static-weekly-schedule-compiler.js';
import {generateStaticWeeklySchedulingProgram,postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {deriveLunchCoverageFromPreparedProblem,createStaticWeeklyLunchCoverageCandidate} from '../src/static-weekly-lunch-coverage.js';
import {createStaticWeeklyLunchAuthorityDocument,verifyStaticWeeklyLunchAuthorityDocument} from '../src/static-weekly-lunch-authority-adapter.js';
import {validateFullHourLunchPolicy} from '../src/static-weekly-lunch-policy.js';
import './approved-manual-native-template-tests.mjs';

async function assertOverlappingAreaRefused(){
  const {input,people}=fullHourLunchFixture(),version=input.versions[0];
  version.slotAvailability.find(a=>a.slotId===people.d.slotId).lunch={start:'09:45',end:'10:45'};
  const policy=version.lunchCoveragePolicy,loan=policy.loans.find(l=>l.normalOwnerSlotId===people.d.slotId);
  loan.window={start:'09:45',end:'10:45'};loan.areas.find(a=>a.locationCode==='W').covererSlotId=people.c.slotId;
  const {policyDigest,...body}=policy;policy.policyDigest=digest(body);
  const result=await compileStaticWeeklySchedule(input);assert.equal(result.status,'FEASIBLE');
  const candidate=createStaticWeeklyLunchCoverageCandidate(input,result);
  assert.equal(candidate.status,'REVIEW_REQUIRED');
  for(const slotId of [people.a.slotId,people.d.slotId])assert.equal(candidate.lunches.find(l=>l.normalOwnerSlotId===slotId).reason,'full_hour_lunch_conflicting_area');
  assert.throws(()=>createStaticWeeklyLunchAuthorityDocument({input,result,candidate}),/not_publishable/);
}
if(process.argv.includes('--overlap-only')){
  await assertOverlappingAreaRefused();console.log(JSON.stringify({status:'PASS',conflictingFullHourAreasRefusedBeforePublication:true}));process.exit(0);
}
if(process.argv.includes('--policy-shape-only')){
  const {input}=fullHourLunchFixture();input.versions[0].lunchCoveragePolicy=null;
  assert.equal(generateStaticWeeklySchedulingProgram(input).error.code,'full_hour_lunch_policy_invalid');
  console.log(JSON.stringify({status:'PASS',explicitNullSourcePolicyRefusedBeforeModel:true}));
  process.exit(0);
}

const {input,people}=fullHourLunchFixture(),before=JSON.stringify(input);
const result=await compileStaticWeeklySchedule(input);
assert.equal(result.status,'FEASIBLE',JSON.stringify(result.fatal||result.verifier));assert.equal(result.verifier.ok,true);
const candidate=createStaticWeeklyLunchCoverageCandidate(input,result),loan=candidate.lunches.find(l=>l.normalOwnerSlotId===people.a.slotId);
assert.equal(candidate.status,'PLANNED');assert.deepEqual(loan.helperSlotIds,[people.b.slotId,people.c.slotId]);
let segments=0;
for(const l of candidate.lunches)for(const r of l.responsibilities)for(const s of r.segments){
  assert.deepEqual(s.window,l.window);assert.ok(s.normalWindow.start>=s.window.start&&s.normalWindow.end<=s.window.end);segments++;
}
const west=loan.responsibilities.find(r=>r.covererSlotId===people.b.slotId).segments.find(s=>s.workId==='full-lunch-0');
assert.deepEqual(west.normalWindow,{start:'09:30',end:'09:45'});assert.deepEqual(west.window,{start:'09:30',end:'10:30'});
const east=loan.responsibilities.find(r=>r.covererSlotId===people.c.slotId);
assert.equal(east.segments.length,2);assert.deepEqual(east.segments.map(s=>s.normalWindow),[{start:'09:30',end:'09:45'},{start:'09:45',end:'10:30'}]);
const doc=createStaticWeeklyLunchAuthorityDocument({input,result,candidate});
assert.equal(verifyStaticWeeklyLunchAuthorityDocument({input,result,document:doc}).ok,true);
assert.equal(doc.persistence_authority,'NOT_PERSISTED');assert.ok(doc.responsibilities.every(r=>!r.creates_deep_clean));
assert.equal(JSON.stringify(input),before);

// A named single coverer is a source decision, even while another qualified
// employee is on duty. It must not manufacture a two-helper fallback.
const single=structuredClone(input),singlePolicy=single.versions[0].lunchCoveragePolicy;
for(const area of singlePolicy.loans.find(l=>l.normalOwnerSlotId===people.a.slotId).areas)area.covererSlotId=people.b.slotId;
const {policyDigest:discarded,...singleBody}=singlePolicy;singlePolicy.policyDigest=digest(singleBody);
const singleResult=await compileStaticWeeklySchedule(single);assert.equal(singleResult.status,'FEASIBLE');
const singleCandidate=createStaticWeeklyLunchCoverageCandidate(single,singleResult),singleLoan=singleCandidate.lunches.find(l=>l.normalOwnerSlotId===people.a.slotId);
assert.equal(singleCandidate.status,'PLANNED');assert.deepEqual(singleLoan.helperSlotIds,[people.b.slotId]);assert.equal(singleLoan.fallback,null);
assert.equal(verifyStaticWeeklyLunchAuthorityDocument({input:single,result:singleResult,
  document:createStaticWeeklyLunchAuthorityDocument({input:single,result:singleResult,candidate:singleCandidate})}).ok,true);

const program=generateStaticWeeklySchedulingProgram(input);assert.ok(!program.error);
for(const patch of [{shift:{start:'10:00',end:'17:00'}},{lunch:{start:'10:00',end:'11:00'}},{blockedWindows:[{start:'09:45',end:'10:00'}]},{restrictions:[west.includedLocations[0].locationId]}]){
  const p=structuredClone(program.problem);Object.assign(p.availabilityByDaySlot.get(`1\0${people.b.slotId}`).availability,patch);
  const refused=deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments).lunches.find(l=>l.normalOwnerSlotId===people.a.slotId);
  assert.equal(refused.status,'REVIEW_REQUIRED');assert.deepEqual(refused.responsibilities,[]);
}
const malformed=structuredClone(input);malformed.versions[0].lunchCoveragePolicy.loans[0].window.end='10:00';
assert.equal(generateStaticWeeklySchedulingProgram(malformed).error.code,'full_hour_lunch_policy_digest_mismatch');
const policy=structuredClone(input.versions[0].lunchCoveragePolicy);
policy.loans.push(structuredClone(policy.loans[0]));const {policyDigest,...body}=policy;policy.policyDigest=digest(body);
assert.throws(()=>validateFullHourLunchPolicy(policy,digest),/duplicate_owner/);
const changedRoster=structuredClone(program.problem),expanded=changedRoster.version.lunchCoveragePolicy;
expanded.loans.push({...structuredClone(expanded.loans[0]),dayOfWeek:0});
const {policyDigest:oldPolicyDigest,...expandedBody}=expanded;expanded.policyDigest=digest(expandedBody);
assert.equal(deriveLunchCoverageFromPreparedProblem(changedRoster,result.weeklyAssignments).status,'REVIEW_REQUIRED');

const legacy=structuredClone(input);delete legacy.versions[0].lunchCoveragePolicy;
const legacyResult=await compileStaticWeeklySchedule(legacy);assert.equal(legacyResult.status,'FEASIBLE');
const legacyLoan=createStaticWeeklyLunchCoverageCandidate(legacy,legacyResult).lunches.find(l=>l.normalOwnerSlotId===people.a.slotId);
assert.ok(legacyLoan.responsibilities.flatMap(r=>r.segments).every(s=>!Object.hasOwn(s,'normalWindow')));
assert.ok(legacyLoan.responsibilities.flatMap(r=>r.segments).some(s=>s.window.end==='09:45'));
await assertOverlappingAreaRefused();
console.log(JSON.stringify({status:'PASS',realCompilerAndVerifier:true,loans:candidate.lunches.length,segments,
  originalBoundaryRetained:true,wholeLunchWindow:true,exactPrintedHelpers:true,currentnessAndEligibilityRefusals:4,
  malformedSourceRefusals:2,changedRosterRefused:true,legacyContractPreserved:true,publication:false}));
