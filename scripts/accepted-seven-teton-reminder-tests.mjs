import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {readAcceptedSevenManualWeek} from '../src/accepted-seven-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {acceptedSevenOnCallLunchAuthority} from '../src/accepted-seven-on-call-lunch.js';
import {withAcceptedSevenTetonReminder,acceptedSevenTetonReminderAuthority} from '../src/accepted-seven-teton-reminder.js';
import {prepareApprovedStaticTemplateProjection} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {canonicalAuthorityInput} from '../src/static-weekly-schedule-program.js';
import {contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const eight=readApprovedManualWeek(),week=readAcceptedSevenManualWeek(eight),weekBefore=JSON.stringify(week);
const draft=prepareApprovedManualSourceDraft({week,referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))});
const raw=structuredClone(draft.sourceDraft);delete raw.publicationAuthority;
raw.serviceDate='2026-11-16';Object.assign(raw.version,{id:'00000000-0000-4000-8000-000000009101',publicationId:'00000000-0000-4000-8000-000000009102',status:'published',effectiveStart:raw.serviceDate});
const kiltra='7044faec-4bbd-57ca-a898-ddd719503113';raw.slots.find(s=>s.id===kiltra).incumbencies=[];
raw.version.vacantSlotIds=[...new Set([...raw.version.vacantSlotIds,kiltra])].sort();
Object.assign(raw.version.manualGroupRatingAuthority,{acceptedCandidateSha256:week.acceptedStaticPattern.artifactSha256,
 acceptedManualDataDigest:week.dataDigest,acceptedSevenOnCallLunch:acceptedSevenOnCallLunchAuthority()});
const before=JSON.stringify(raw),amended=withAcceptedSevenTetonReminder({week,version:raw.version}),authority=acceptedSevenTetonReminderAuthority();
let checks=0;const check=fn=>{fn();checks++;};
check(()=>assert.equal(JSON.stringify(raw),before));check(()=>assert.equal(JSON.stringify(week),weekBefore));
const selected=amended.assignments.filter(r=>r.locationCodeSnapshot==='TETON');
check(()=>assert.equal(selected.length,raw.version.assignments.filter(r=>r.locationCodeSnapshot==='TETON').length));
check(()=>assert.deepEqual([...new Set(selected.map(r=>r.dayOfWeek))].sort(),[0,1,2,3,4,5,6]));
for(const [i,row]of amended.assignments.entries())check(()=>{
 const prior=raw.version.assignments[i],expected=structuredClone(prior);
 if(row.locationCodeSnapshot==='TETON')expected.locationNameSnapshot+=' (Grizzly Underwater Viewing)';
 assert.deepEqual(row,expected,'Only the Teton display label may change; all owners/times/members/workload must stay exact');
});
check(()=>assert.deepEqual(amended.assignments.flatMap(r=>r.includedLocations),raw.version.assignments.flatMap(r=>r.includedLocations)));
check(()=>assert.equal(authority.newLocation,false));check(()=>assert.equal(authority.newNfcTag,false));
for(const mutate of [v=>{v.assignments.find(r=>r.locationCodeSnapshot==='TETON').locationId='wrong';},
 v=>{v.assignments.find(r=>r.locationCodeSnapshot==='TETON').includedLocations.push({locationId:'invented-tag',locationNameSnapshot:'Grizzly Underwater Viewing'});},
 v=>{v.assignments.find(r=>r.locationCodeSnapshot==='TETON').locationNameSnapshot='already changed';},
 v=>{v.assignments.find(r=>r.locationCodeSnapshot==='TETON').serviceMode='reminder_only';},
 v=>{v.assignments=v.assignments.filter(r=>r.locationCodeSnapshot!=='TETON'||r.dayOfWeek!==0);}
])check(()=>{const v=structuredClone(raw.version);mutate(v);assert.throws(()=>withAcceptedSevenTetonReminder({week,version:v}));});
check(()=>assert.throws(()=>withAcceptedSevenTetonReminder({week:eight,version:raw.version})));
check(()=>assert.throws(()=>withAcceptedSevenTetonReminder({week,version:amended})));
const source=canonicalAuthorityInput(amended,raw.slots,[],raw.proximity,raw.serviceDate),config=structuredClone(draft.ownerConfig);config.effectiveDate=raw.serviceDate;
const templateId='accepted-seven-teton-reminder-fixture',roleSlotIds=week.referenceBindings.people.map(p=>p.slotId).sort(),template={templateId,staffingCount:7,source,roleSlotIds};
const binding={schema:'custodial.approved-static-template-binding.v1',templateId,staffingCount:7,sourceDigest:contentDigest(source),roleSlotIdsDigest:contentDigest(roleSlotIds),
 patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:week.acceptedStaticPattern.artifactSha256,ownerConfigDigest:contentDigest(config),patternPublicationStatus:'UNPUBLISHED_LOCAL_CANDIDATE'};
const result=prepareApprovedStaticTemplateProjection({templates:[template],admittedBindings:[binding],currentSource:source,currentOwnerConfig:config,
 selection:{schema:'custodial.static-template-selection.v1',kind:'INITIAL_BASELINE',templateId,serviceDate:source.serviceDate,availablePersonIds:week.referenceBindings.people.map(p=>p.employeeId)}});
const assignments=result.initialBaseline.projection.assignments,projected=assignments.filter(r=>r.work_snapshot.locationCodeSnapshot==='TETON');
check(()=>assert.equal(assignments.length,323));check(()=>assert.equal(result.lunch.lunches.length,35));check(()=>assert.equal(projected.length,selected.length));
for(const row of projected)check(()=>assert.equal(row.work_snapshot.locationNameSnapshot,'Teton and restrooms (Grizzly Underwater Viewing)'));
check(()=>assert.equal(result.solverInvoked,false));check(()=>assert.equal(result.mapping.unchanged,true));
console.log(JSON.stringify({status:'PASS_EXACT_TETON_REMINDER_SOURCE_AND_PROJECTION',checks,pairedAssignments:projected.length,normalRows:323,lunches:35,
 otherAssignmentsHistoryAndNfcUnchanged:true,actualSql:false,actualPublicationReadback:false,productionWritten:false,appBuildOrInstall:false}));
