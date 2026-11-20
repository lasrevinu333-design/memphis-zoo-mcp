import assert from 'node:assert/strict';
import {projectApprovedManualRosterSnapshot} from './approved-manual-roster-transition.js';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {prepareAcceptedManualPatternData} from './accepted-manual-pattern-preparation.js';
import {prepareAcceptedSevenSqlPolicy} from './accepted-seven-sql-policy.js';
const employeeId='06228c5d-5123-4b8b-b730-e01114bdc971',slotId='7044faec-4bbd-57ca-a898-ddd719503113';
const uuid=v=>assert.match(v,/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
// Predict ONLY the six-field snapshot effects of the supported v8 vacancy and
// its protected v12 separation. This is a model, never an observed DB result.
// The atomic writer must call v8 and compare the complete actual post-snapshot.
export function modelAcceptedSevenSupportedVacancy(value){
 const before=projectApprovedManualRosterSnapshot(value),at=before.serviceDate;
 assert.equal(before.schema,'custodial.manual-live-roster-readback.v1');
 assert.match(at,/^\d{4}-\d{2}-\d{2}$/);assert.equal(new Date(at+'T12:00Z').toISOString().slice(0,10),at);
 assert.ok(Number.isSafeInteger(before.authorityRevision)&&before.authorityRevision>=0&&before.authorityRevision<Number.MAX_SAFE_INTEGER);
 const people=before.employees.filter(p=>p.employeeId===employeeId),slots=before.rosterSlots.filter(s=>s.slotId===slotId);
 assert.equal(people.length,1);assert.equal(slots.length,1);
 const person=people[0],slot=slots[0];
 assert.equal(person.displayName,'Kiltra Horton');assert.equal(person.active,true);assert.equal(person.hasMessenger,true);
 assert.match(person.employeeCode,/^EMP\d+$/);
 const active=r=>r.effectiveStart<=at&&(r.effectiveEnd===null||at<r.effectiveEnd),current=slot.incumbencies.filter(active);
 assert.equal(current.length,1);const predecessor=current[0];
 uuid(predecessor.incumbencyId);assert.equal(predecessor.personId,employeeId);assert.equal(predecessor.displayName,person.displayName);
 assert.ok(predecessor.effectiveStart<at,'The supported vacancy cannot replace a same-day incumbency');
 assert.ok(!slot.incumbencies.some(r=>r.effectiveStart>=at),'Future incumbency requires reconciliation');
 for(const other of before.rosterSlots)if(other.slotId!==slotId)
  assert.ok(!other.incumbencies.some(r=>r.personId===employeeId&&(r.effectiveEnd===null||at<r.effectiveEnd)),
   'The former employee has another current or future position');
 const post=structuredClone(before);post.authorityRevision++;
 const p=post.employees.find(p=>p.employeeId===employeeId);p.active=false;p.hasMessenger=false;
 post.rosterSlots.find(s=>s.slotId===slotId).incumbencies.find(r=>r.incumbencyId===predecessor.incumbencyId).effectiveEnd=at;
 return {schema:'custodial.accepted-seven-supported-vacancy-model.v1',beforeRosterDigest:digest(before),
  expectedPostRosterDigest:digest(post),expectedPostSnapshot:post,employeeId,slotId,
  predecessorIncumbencyId:predecessor.incumbencyId,effectiveDate:at,expectedRevision:before.authorityRevision,
  expectedPostRevision:post.authorityRevision,actualSqlExecuted:false,liveVacancyObserved:false};
}
export function prepareAcceptedSevenUpdateData(input){
 prepareAcceptedSevenSqlPolicy(input.week); // complete accepted-week digest guard
 for(const v of [input.packetId,input.managerId,input.operationId])uuid(v);
 const before=projectApprovedManualRosterSnapshot(input.snapshot),vacancy=modelAcceptedSevenSupportedVacancy(before);
 const data=prepareAcceptedManualPatternData({...input,snapshot:vacancy.expectedPostSnapshot});
 assert.equal(data.profile.staff,7);assert.equal(data.newCapacityPositions,0);
 assert.equal(data.transition.transfers.length,0,'Do not combine other employee transfers with this accepted update');
 assert.equal(data.transition.unchanged.length,7);
 assert.equal(data.expectedRevision,vacancy.expectedPostRevision);
 const capacityIds=data.source.slots.filter(s=>s.kind==='CONTRACTOR_CAPACITY').map(s=>s.id).sort();
 const body={...data,schema:'custodial.accepted-seven-pattern-update-data.v1',sourceDigest:digest(data.source),packetId:input.packetId,
  managerId:input.managerId,operationId:input.operationId,expectedRevision:before.authorityRevision,
  beforeRosterDigest:digest(before),vacancy,
  capacityTransition:{schema:'custodial.reuse-existing-native-capacity.v1',newCapacityIds:[],
   reusedCapacityIds:capacityIds,newPositionsCreated:0,expectedRosterPositions:before.rosterSlots.length},
  approvalEvidence:{classification:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:data.acceptedArtifactSha256,
   sourceReference:'config/schedules/accepted-seven-20261115/seven-person-static-candidate-current-review.json',
   ownerDecisionReference:'OWNER_ACCEPTANCE.json:Sentinel_67736ae6296c81918ce277aabb5e2d84; later trusted owner LIVE NOW direction; on-call-herpetarium-lunch-decision.json; teton-grizzly-reminder-decision.json',
   operationKind:'ACCEPTED_SEVEN_UPDATE_REUSE_EXISTING_CAPACITY',vacancy},
  weeklyBaselineChanged:false,historyRewrite:false,newEmployees:0,actualSqlRehearsal:false};
 return {...body,updateDataDigest:digest(body)};
}
