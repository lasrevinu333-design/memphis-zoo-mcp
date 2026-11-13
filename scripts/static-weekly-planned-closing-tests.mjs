import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createShiftEndContinuityPolicy,deriveDatedShiftEndCoverage,deriveApprovedDatedMappedShiftEndCoverage} from '../src/static-weekly-shift-end-derivation.js';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest,normalizeStaticWeeklyAuthority} from '../src/static-weekly-schedule-program.js';
const read=path=>JSON.parse(readFileSync(path));
const config=read(new URL('../config/custodial-eight-person-static-20261102.json',import.meta.url));
const plan=read(config.fullHourLunchPlan.path),packet=read(process.argv[2]??new URL('./fixtures/current-eight-schedule-source.json',import.meta.url));
assert.equal(digest(packet.compilerInput),packet.sourceDigest,'test source input digest');
installStaticWeeklySha256HexAccelerator(s=>createHash('sha256').update(s).digest('hex'));
const time=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const phases=Object.fromEntries(Object.entries(plan.days).map(([day,d])=>[day,d.stages.filter(s=>s.kind==='closing').map(s=>({
  start:time(s.start),end:time(s.end),owners:Object.fromEntries(Object.entries(s.owners).map(([f,k])=>[f,plan.positions[k].slotId]))}))]));
const source=structuredClone(packet.compilerInput);
const bind=s=>{const {policyDigest,...body}=s.version.shiftEndContinuityPolicy;s.version.shiftEndContinuityPolicy={...body,policyDigest:digest(body)};};
source.version.shiftEndContinuityPolicy=createShiftEndContinuityPolicy(config.weights,'a'.repeat(64),digest,config.namedShiftEndHandoffs,phases);
const before=JSON.stringify(source),derived=deriveDatedShiftEndCoverage(source,digest);
assert.equal(JSON.stringify(source),before);assert.equal(derived.validation.coverageGaps,0);assert.equal(derived.validation.duplicateLocations,0);
let familyIntervals=0;
for(const [day,stages]of Object.entries(phases))for(const stage of stages)for(const [family,owner]of Object.entries(stage.owners)){
  const rows=derived.input.version.assignments.filter(r=>r.dayOfWeek===Number(day)&&r.locationCodeSnapshot===family&&r.window.start<=stage.start&&r.window.end>=stage.end);
  assert.equal(rows.length,1);assert.equal(rows[0].ownerSlotId,owner);familyIntervals++;
}
let rejected=0;
for(const mutate of [
  s=>{delete s.version.shiftEndContinuityPolicy.plannedClosingOwnership['1'][0].owners.TETON;},
  s=>{s.version.shiftEndContinuityPolicy.plannedClosingOwnership['1'][0].owners.TETON=config.slots.TAMMY.slotId;},
  s=>{s.version.shiftEndContinuityPolicy.plannedClosingOwnership['1'][0].end='14:15';},
  s=>{s.version.shiftEndContinuityPolicy.plannedClosingOwnership['6'][0].owners.CAT_COUNTRY=config.slots.KATHY.slotId;},
  s=>{s.version.shiftEndContinuityPolicy.plannedClosingOwnership['5'][0].owners.HERPETARIUM=config.slots.ALIJAH.slotId;},
]){const changed=structuredClone(source);mutate(changed);bind(changed);assert.throws(()=>deriveDatedShiftEndCoverage(changed,digest));rejected++;}
// Dated manager path must preserve the same planned baseline, independently
// of the weekly source materializer, before applying an accepted exception.
let datedDays=0;
for(let day=0;day<7;day++){
 const operation=new Date(source.serviceDate+'T12:00:00Z');operation.setUTCDate(operation.getUTCDate()+(day-operation.getUTCDay()+7)%7);
 const current=normalizeStaticWeeklyAuthority(source.version,source.slots,[],source.proximity,source.serviceDate);
 const parents=source.version.assignments.filter(r=>r.dayOfWeek===day);
 const people=new Map(Object.values(config.slots).filter(s=>s.personId).map(s=>[s.slotId,s.personId]));
 const result=deriveApprovedDatedMappedShiftEndCoverage({originalWeekSource:structuredClone(current),currentWeekSource:current,
   approvedTemplateSource:structuredClone(source),operationDate:operation.toISOString().slice(0,10),mappedParents:structuredClone(parents),
   parentMappings:parents.map(r=>({dayOfWeek:day,parentWorkId:r.workId,patternSlotId:r.ownerSlotId,actualSlotId:r.ownerSlotId,actualPersonId:people.get(r.ownerSlotId)})),ownerConfig:structuredClone(config)},digest);
 assert.notEqual(result.status,'UNRESOLVED');
 for(const stage of phases[String(day)])for(const [family,owner]of Object.entries(stage.owners)){
  const rows=result.effectiveInput.version.assignments.filter(r=>r.dayOfWeek===day&&r.locationCodeSnapshot===family&&r.window.start<=stage.start&&r.window.end>=stage.end);
  assert.equal(rows.length,1);assert.equal(rows[0].ownerSlotId,owner);
 }
 datedDays++;
}
console.log(JSON.stringify({status:'PASS',familyIntervals,datedDays,malformedPoliciesRejected:rejected,sourceMutated:false,publication:false}));
