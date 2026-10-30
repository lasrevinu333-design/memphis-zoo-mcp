import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {prepareApprovedStaticTemplateProjection} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {assertNormalOwnerEligibility,validateOwnerEligibilityConfig} from '../src/static-weekly-owner-eligibility.js';

installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const week=readApprovedManualWeek(),draft=prepareApprovedManualSourceDraft({week,
  referenceBytes:fs.readFileSync(new URL('../release/static-schedules/custodial-eight-20261102-registration.json',import.meta.url))});
assert.deepEqual(draft.restrictionConflicts,[]);assert.equal(draft.restrictionClassifications.length,5);
const config=structuredClone(draft.ownerConfig);
validateOwnerEligibilityConfig(config);
assert.throws(()=>assertNormalOwnerEligibility(config.slots.ALIJAH,'HERPETARIUM',5),/normal-only/);
assert.doesNotThrow(()=>assertNormalOwnerEligibility(config.slots.ALIJAH,'HERPETARIUM',1));
assert.doesNotThrow(()=>assertNormalOwnerEligibility(config.slots.ALIJAH,'HERPETARIUM',5,'INHERITED_ALERTS_AND_ISSUES_ONLY'));
const hard={...config.slots.ALIJAH,hardForbiddenFamilies:['HERPETARIUM']};
assert.throws(()=>assertNormalOwnerEligibility(hard,'HERPETARIUM',5,'INHERITED_ALERTS_AND_ISSUES_ONLY'),/forbidden family/);
const malformed=structuredClone(config);malformed.manualNormalRestrictionAuthority.policyDeltaSha256='0'.repeat(64);
assert.throws(()=>validateOwnerEligibilityConfig(malformed),/Unknown manual/);

// A fixture-only future Monday and UUIDs exercise the normal adapter. They
// select no operational date, register nothing and create no signed receipt.
const source=structuredClone(draft.sourceDraft);delete source.publicationAuthority;
source.serviceDate='2026-11-02';Object.assign(source.version,{id:'00000000-0000-4000-8000-000000001001',
  publicationId:'00000000-0000-4000-8000-000000001002',status:'published',effectiveStart:source.serviceDate});
config.effectiveDate=source.serviceDate;
const templateId='approved-manual-fixture',roleSlotIds=week.referenceBindings.people.map(p=>p.slotId).sort(),
 template={templateId,staffingCount:8,source,roleSlotIds},binding={schema:'custodial.approved-static-template-binding.v1',
  templateId,staffingCount:8,sourceDigest:contentDigest(source),roleSlotIdsDigest:contentDigest(roleSlotIds),
  patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:week.zipSha256,ownerConfigDigest:contentDigest(config),
  patternPublicationStatus:'UNPUBLISHED_LOCAL_CANDIDATE'},
 args={templates:[template],admittedBindings:[binding],currentSource:source,currentOwnerConfig:config,
  selection:{schema:'custodial.static-template-selection.v1',kind:'INITIAL_BASELINE',templateId,
   serviceDate:source.serviceDate,availablePersonIds:week.referenceBindings.people.map(p=>p.employeeId)}};
const before=JSON.stringify(args),result=prepareApprovedStaticTemplateProjection(args);
assert.equal(JSON.stringify(args),before);assert.equal(result.solverInvoked,false);assert.equal(result.optimized,false);
assert.ok(result.initialBaseline);assert.equal(result.initialBaseline.projection.assignments.length,346);
assert.equal(result.lunch.lunches.length,40);
for(const loan of result.lunch.lunches){assert.equal(loan.status,'PLANNED');assert.equal(loan.helperSlotIds.length,1);assert.equal(loan.fallback,null);}
assert.deepEqual(result.mapping.slotMapping.map(m=>m.patternSlotId===m.actualSlotId),Array(8).fill(true));
const friday=result.initialBaseline.projection.assignments.find(a=>a.day_of_week===5&&a.work_snapshot.locationCodeSnapshot==='HERPETARIUM'&&a.work_snapshot.window.start==='15:00');
assert.equal(friday.owner_person_id,config.slots.ALIJAH.personId);
assert.equal(result.mapping.unchanged,true);
assert.ok(result.initialBaseline.projection.assignments.some(a=>a.work_snapshot.locationCodeSnapshot==='EDUCATION'
 &&a.work_snapshot.locationNameSnapshot==='Education (includes Volunteer, IT, Interpretation, and four classrooms)'));
console.log(JSON.stringify({marker:'APPROVED_MANUAL_NATIVE_TEMPLATE_PASS',normalFixedPatternAdapter:true,
 days:7,assignments:346,fullHourLoans:40,oneNamedCovererPerLoan:true,unchangedMapping:true,
 normalMondayOnlyRulePreserved:true,inheritedAlertCustodyAllowed:true,otherHardRestrictionsPreserved:true,
 solverInvoked:false,sqlQualified:false,registered:false,published:false,effectiveDateSelected:false}));
