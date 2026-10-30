import assert from 'node:assert/strict';
import {canonicalJson} from './static-weekly-schedule-model.js';

// Explicit later directions supersede policy holds without changing the raw
// approved packet, its current assignments, or its historical provenance.
export function validateApprovedManualPolicyDelta(delta,base){
  assert.equal(delta?.schema_version,1);
  assert.equal(delta.delta_id,'custodial_policy_delta_20261030_022145');
  assert.equal(delta.base_snapshot.zip_sha256,base.zipSha256);
  assert.equal(delta.base_snapshot.bytes,66544);assert.equal(delta.base_snapshot.unchanged,true);
  assert.equal(delta.policy.global_0945.status,'RESOLVED: remove 09:45 changeovers on ALL SEVEN days');
  assert.equal(delta.policy.global_0945.effect,'Keep each approved daily base unchanged; lunch relief and departure handoffs continue at their approved times. No new 09:45 reassignment event.');
  const extra=delta.policy.elephant_trunk;
  assert.equal(extra.status,'ANSWERED: simple external weekly chore NOTE ONLY, NOT part of the program');
  assert.equal(extra.owner,'Kathy Phelps');assert.equal(extra.day,'Tuesday');
  assert.equal(canonicalJson(extra.excluded_from),canonicalJson(['23 daily assignment groups','136 daily base points',
    'Group scoring','Scheduler and absence engine','Lunch relief and departure-handoff engine']));
  assert.equal(extra.no_weight_or_reactivation_gate,'No score needed, no weight question or inactive-flag gate. No database reactivation, new mechanism, automation or engine integration.');
  assert.equal(delta.policy.activation_authority.status,'EXPLICITLY AUTHORIZED for the approved schedule-data scope; NOT yet verified live');
  assert.equal(delta.source_version_deltas.length,7);
  assert.equal(new Set(delta.source_version_deltas.map(d=>d.day)).size,7);
  for(const day of delta.source_version_deltas)assert.equal(day.core_schedule_unchanged,true);
  return {policy0945:'OWNER_APPROVED_NO_CHANGEOVER',excludedLegacyDuties:['ELEPHANT_TRUNK_RESTROOMS'],
    unresolvedPolicies:['prearrival_ownership'],activationOwnerApproved:true,
    publicationScope:'APPROVED_STATIC_SCHEDULE_DATA_THROUGH_SUPPORTED_PUBLICATION_PATH',effectiveStart:null};
}
