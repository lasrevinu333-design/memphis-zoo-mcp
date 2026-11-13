import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {withApprovedManualFixtureCapacities} from './fixtures/approved-manual-capacity-source.mjs';
import {solveApprovedManualAbsencePeriod} from '../src/approved-manual-absence.js';
import {prepareApprovedManualPeriodProjection} from '../src/approved-manual-period-projection.js';
import {approvedManualInheritedEligibility} from '../src/approved-manual-inherited-eligibility.js';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
assert.ok(process.argv.length===2||(process.argv.length===3&&isAbsolute(process.argv[2])));
const out=process.argv[2];if(out)fs.mkdirSync(out,{mode:0o700});
const save=(name,x)=>{if(out)fs.writeFileSync(resolve(out,name),JSON.stringify(x,null,2)+'\n',{flag:'wx',mode:0o600});};
const week=readApprovedManualWeek(),draft=prepareApprovedManualSourceDraft({week,
 referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))}),
 source=withApprovedManualFixtureCapacities(draft.sourceDraft),config=draft.ownerConfig,alijah=config.slots.ALIJAH;
delete source.publicationAuthority;source.serviceDate='2026-11-02';
Object.assign(source.version,{id:'00000000-0000-4000-8000-000000001001',publicationId:'00000000-0000-4000-8000-000000001002',effectiveStart:source.serviceDate,status:'published'});
const original=digest({week,source,config}),work=source.version.assignments.find(w=>w.dayOfWeek===4&&w.locationCodeSnapshot==='HERPETARIUM'&&w.restrictedSlotIds.includes(alijah.slotId));
assert.ok(work);assert.equal(approvedManualInheritedEligibility(work,config,'NORMAL_AREA_OWNERSHIP'),work);
const scoped=approvedManualInheritedEligibility(work,config,'INHERITED_ALERTS_AND_ISSUES_ONLY');
assert.ok(!scoped.restrictedSlotIds.includes(alijah.slotId));assert.ok(scoped.normalAssignmentRestrictedSlotIds.includes(alijah.slotId));
for(const field of ['requiredQualifications','qualificationProvenance','restrictions','includedLocations'])assert.deepEqual(scoped[field],work[field]);
assert.deepEqual(scoped.restrictedSlotIds,work.restrictedSlotIds.filter(id=>id!==alijah.slotId));
const hard=structuredClone(config);hard.slots.ALIJAH.hardForbiddenFamilies=['HERPETARIUM'];
assert.equal(approvedManualInheritedEligibility(work,hard,'INHERITED_ALERTS_AND_ISSUES_ONLY'),work);
const cases=[];
for(const [serviceDate,name]of [['2026-11-05','Tammy'],['2026-11-06','Kathy'],['2026-11-08','Derrick']]){
 const person=week.referenceBindings.people.find(p=>p.approvedName.startsWith(name+' ')),
  period=await solveApprovedManualAbsencePeriod({week,source,ownerConfig:config,frameStart:source.serviceDate,
   changes:[{serviceDate,absentPersonIds:[person.employeeId]}]}),
  acceptedExceptions=[{id:'scope-fixture-'+serviceDate,type:'pto',serviceDate,status:'accepted',
   actorId:'00000000-0000-4000-8000-000000001099',reason:'LOCAL_SCOPE_DATA_NOT_A_REAL_APPROVAL',expectedRevision:0,sequence:1,
   idempotencyKey:'scope-fixture-'+serviceDate,baseVersionId:source.version.id,publicationId:source.version.publicationId,payload:{slotId:person.slotId}}];
 assert.equal(period.status,'COMPLETE_VALIDATED_DATED_DRAFTS');
 const day=period.days.find(d=>d.serviceDate===serviceDate),native=prepareApprovedManualPeriodProjection({week,source,ownerConfig:config,period,acceptedExceptions}),
  first=day.plan.phaseOwners[0];assert.notEqual(first.owners.HERPETARIUM,alijah.slotId);
 const inherited=day.plan.phaseOwners.slice(1).filter(p=>p.owners.HERPETARIUM===alijah.slotId).length,
  lunches=day.plan.lunchPlans.filter(l=>l.covererSlotId===alijah.slotId&&l.areas.includes('HERPETARIUM')).length;
 cases.push({serviceDate,absent:name,normalHerpetariumNeverAlijah:true,inheritedPhases:inherited,alijahHerpetariumLunches:lunches,
  nativeAssignments:native.projectionAssignments.length,fullHourLunches:native.lunchDocument.loans.length});
 save('CASE_'+serviceDate+'.json',{period,native});console.log(JSON.stringify(cases.at(-1)));
}
assert.ok(cases.some(c=>c.inheritedPhases||c.alijahHerpetariumLunches),'Exercise an actual newly selected non-Monday inheritance/relief');
assert.equal(digest({week,source,config}),original);
const result={status:'PASS',scope:'Real bounded dated solves and native DATA lowering; no SQL/publication/device authority',
 normalMondayOnlyRulePreserved:true,otherHardRestrictionsAndQualificationsUnchanged:true,cases,sourceAndSevenDaysUnchanged:true,productionWritten:false};
save('RESULT.json',result);console.log(JSON.stringify(result));
