#!/usr/bin/env node
import assert from 'node:assert/strict';
import { compileStaticWeeklySchedule, postgresJsonbContentDigest } from '../src/static-weekly-schedule-compiler.js';
import { createStaticWeeklyLunchCoverageCandidate } from '../src/static-weekly-lunch-coverage.js';
import {
  createStaticWeeklyLunchAuthorityDocument,
  verifyStaticWeeklyLunchAuthorityDocument,
} from '../src/static-weekly-lunch-authority-adapter.js';

const clone = value => structuredClone(value);
function fixture() {
  const slots=['a','b','c','d'], locations=['W','E','B','B2','C','C2','D','D2'];
  const ownership=[['west','W','a'],['east','E','a'],['helper-b','B','b'],['helper-b2','B2','b'],['helper-c','C','c'],['helper-c2','C2','c'],['helper-d','D','d'],['helper-d2','D2','d']];
  return {
    serviceDate:'2026-09-21', timezone:'America/Chicago', exceptions:[],
    slots:slots.map(slot=>({id:slot,label:slot,incumbencies:[{personId:`person-${slot}`,displayName:`Fixture ${slot}`,effectiveStart:'2020-01-01',effectiveEnd:null}]})),
    proximity:locations.flatMap(from=>locations.filter(to=>to!==from).map(to=>({from,to,
      minutes:(from==='B'&&to==='W')||(from==='C'&&to==='E')?1:10,verified:true,provenance:'synthetic-directed-proximity'}))),
    versions:[{
      id:'week',publicationId:'publication',status:'published',effectiveStart:'2026-09-21',effectiveEnd:null,
      objective:{requireVerifiedProximity:true},
      slotAvailability:slots.map((slot,i)=>({
        slotId:slot,dayOfWeek:1,status:'working',shift:{start:'07:00',end:'17:00'},
        lunch:{a:{start:'12:00',end:'13:00'},b:{start:'10:00',end:'11:00'},c:{start:'14:00',end:'15:00'},d:{start:'15:00',end:'16:00'}}[slot],
        productiveCapacityProvenance:'fixture-shift',maxServiceEffortMinutes:300,
        maxServiceEffortProvenance:'fixture-capacity',qualifications:['general'],
        qualificationProvenance:'fixture-qualification',restrictions:[],restrictionProvenance:'fixture-restriction',
        acceptedRouteAnchorLocationId:['W','B','C','D'][i],acceptedRouteProvenance:'fixture-anchor',
      })),
      assignments:ownership.map(([workId,locationId,ownerSlotId])=>({
        workId,locationId,ownerSlotId,dayOfWeek:1,schedulingMode:'flexible_coverage_ownership',
        window:{start:'09:45',end:'16:00'},serviceEffortMinutes:20,serviceEffortProvenance:'fixture-workload',
        priority:2,priorityProvenance:'fixture-priority',requiredQualifications:['general'],
        qualificationProvenance:'fixture-work-qualification',restrictions:[],restrictionProvenance:'fixture-work-restriction',
      })),
    }],
  };
}

const input=fixture();
const result=await compileStaticWeeklySchedule(input);
assert.equal(result.status,'FEASIBLE',JSON.stringify(result.fatal||result.verifier));
assert.equal(result.publicationAuthority,'ACCEPTABLE');
const before=postgresJsonbContentDigest(result.weeklyAssignments);
const candidate=createStaticWeeklyLunchCoverageCandidate(input,result);
assert.equal(candidate.status,'PLANNED');
const document=createStaticWeeklyLunchAuthorityDocument({input,result,candidate});
assert.equal(document.schema,'memphis-zoo.static-weekly-lunch-authority-document.v1');
assert.equal(document.persistence_authority,'NOT_PERSISTED');
assert.equal(document.verification_status,'VERIFIED');
assert.equal(document.base_authority_digest,result.authorityDigest);
assert.equal(document.base_replay_digest,result.replayDigest);
assert.equal(document.candidate_digest,candidate.candidateDigest);
assert.ok(document.responsibilities.length>0);
assert.ok(document.notification_intents.length>0);
assert.equal(document.notification_intents.every(row=>['start','end'].includes(row.event)),true);
assert.equal(document.notification_intents.every(row=>row.delivery_state==='NOT_ENQUEUED'),true);
assert.equal(document.responsibilities.every(row=>row.coverage_purpose==='lunch_coverage'),true);
assert.equal(document.responsibilities.every(row=>row.check_deadline_policy==='inherit_existing_90_minute_deadline'),true);
assert.equal(document.responsibilities.every(row=>row.creates_deep_clean===false),true);
assert.equal(postgresJsonbContentDigest(result.weeklyAssignments),before,'authority adaptation never rewrites normal schedule ownership');
assert.equal(verifyStaticWeeklyLunchAuthorityDocument({input,result,document}).ok,true);

const second=createStaticWeeklyLunchAuthorityDocument({input,result});
assert.deepEqual(second,document,'authority document is deterministic when recomputed from verified source');
assert.equal(document.document_identity,second.document_identity);
const tampered=clone(candidate);
tampered.lunches[0].window.end='13:30';
assert.throws(
  ()=>createStaticWeeklyLunchAuthorityDocument({input,result,candidate:tampered}),
  /lunch_authority_candidate_verification_failed/,
  'caller-tampered lunch coverage cannot cross the authority adapter',
);
const forgedDocument=clone(document);
forgedDocument.responsibilities[0].coverer_person_id='person-attacker';
assert.equal(
  verifyStaticWeeklyLunchAuthorityDocument({input,result,document:forgedDocument}).ok,
  false,
  'persisted lunch authority tampering is detected by deterministic recomputation',
);

const missingLunch=fixture();
delete missingLunch.versions[0].slotAvailability.find(row=>row.slotId==='b').lunch;
const missingLunchResult=await compileStaticWeeklySchedule(missingLunch);
assert.equal(missingLunchResult.status,'FEASIBLE');
const unresolved=createStaticWeeklyLunchCoverageCandidate(missingLunch,missingLunchResult);
assert.equal(unresolved.status,'REVIEW_REQUIRED');
assert.throws(
  ()=>createStaticWeeklyLunchAuthorityDocument({input:missingLunch,result:missingLunchResult,candidate:unresolved}),
  /lunch_authority_candidate_not_publishable/,
  'missing lunch facts fail closed before a persistence authority document can be created',
);

console.log('static weekly lunch authority adapter tests: PASS');
