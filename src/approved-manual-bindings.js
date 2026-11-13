import assert from 'node:assert/strict';
import {canonicalJson} from './static-weekly-schedule-model.js';
import {postgresJsonbContentDigest} from './static-weekly-schedule-program.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const equalSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length
  &&canonicalJson([...a].sort())===canonicalJson([...b].sort());

// Identity references only. A retained candidate's incumbency dates and
// physical members are not a fresh live-roster or publication admission.
export function validateApprovedManualBindings({binding,reference,referenceSha256,manual}) {
  assert.equal(binding.schema,'custodial.manual-reference-bindings.v1');
  assert.equal(binding.packetManifestSha256,manual.manifestSha256);
  assert.equal(binding.reference.sha256,referenceSha256);
  assert.equal(reference.schema,'custodial.approved-static-template-registration.v1');
  assert.equal(binding.reference.sourceId,reference.sourceId);
  assert.equal(binding.reference.classification,'RETAINED_CANDIDATE_IDENTITY_REFERENCES_NOT_LIVE_ROSTER_ADMISSION');
  assert.equal(binding.bindingStatus,'CANDIDATE_REFERENCES_ONLY');
  assert.equal(binding.liveRosterReadbackRequired,true);
  assert.equal(binding.canonicalRegistrationSource,false);assert.equal(binding.productionPublished,false);
  const source=reference.template.source,version=source.version||source.versions?.[0];
  const names=[...new Set(manual.days.flatMap(d=>d.employees.map(e=>e.name)))];
  assert.ok(equalSet(binding.people.map(p=>p.approvedName),names),'Every approved person needs one retained identity');
  assert.equal(new Set(binding.people.map(p=>p.employeeId)).size,names.length,'Employee identity was reused');
  assert.equal(new Set(binding.people.map(p=>p.slotId)).size,names.length,'Slot identity was reused');
  for(const person of binding.people){
    assert.match(person.employeeId,UUID);assert.match(person.slotId,UUID);
    const matches=source.slots.flatMap(slot=>(slot.incumbencies||[]).filter(i=>i.displayName===person.approvedName).map(i=>({slot,incumbency:i})));
    assert.equal(matches.length,1,'Person reference is absent or ambiguous');
    const {slot,incumbency}=matches[0];
    assert.equal(slot.id,person.slotId);assert.equal(incumbency.personId,person.employeeId);
    assert.equal(incumbency.effectiveStart,person.referenceEffectiveStart);
    assert.equal(incumbency.effectiveEnd??null,person.referenceEffectiveEnd);
  }
  assert.ok(equalSet(binding.groups.map(g=>g.approvedGroup),manual.ratings.map(r=>r.group)),'Every combined group needs one canonical parent reference');
  assert.equal(new Set(binding.groups.map(g=>g.referenceCode)).size,binding.groups.length);
  assert.equal(new Set(binding.groups.map(g=>g.primaryLocationId)).size,binding.groups.length,'Parent location identity was reused');
  for(const group of binding.groups){
    assert.match(group.primaryLocationId,UUID);
    const rows=version.assignments.filter(a=>a.locationCodeSnapshot===group.referenceCode);
    assert.ok(rows.length>0,'Unknown canonical family reference');
    for(const row of rows){
      assert.equal(row.locationId,group.primaryLocationId,'Parent location identity changed');
      assert.equal(row.locationNameSnapshot,group.referenceLabel);
      assert.equal(canonicalJson(row.includedLocations||[]),canonicalJson(group.includedLocations),'Physical members changed or disappeared');
    }
    assert.ok(equalSet(group.retainedServiceModes,[...new Set(rows.map(r=>r.serviceMode))]),'Retained scan/response-only capability changed');
  }
  assert.equal(binding.unresolvedLegacyDuties.length,1);
  const duty=binding.unresolvedLegacyDuties[0];
  assert.equal(duty.referenceCode,'ELEPHANT_TRUNK_RESTROOMS');
  assert.ok(version.assignments.some(a=>a.locationCodeSnapshot===duty.referenceCode&&a.locationId===duty.primaryLocationId));
  assert.equal(duty.approvedOwner,null);assert.equal(duty.weeklyDecision,null);assert.equal(duty.score,null);
  assert.equal(duty.status,'UNRESOLVED_NOT_SILENTLY_REMOVED');
  assert.ok(!binding.groups.some(g=>g.referenceCode===duty.referenceCode),'Weekly unresolved duty became a scored current group');
  assert.equal(canonicalJson(binding.approvedEducationScope),canonicalJson(manual.educationScope),'Approved Education umbrella scope changed');
  return {...structuredClone(binding),bindingDigest:postgresJsonbContentDigest(binding)};
}
