import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {prepareApprovedManualEmploymentAdmission} from '../src/approved-manual-employment-admission.js';
import {approvedManualEmploymentPeriod,assertApprovedManualEmploymentProjection} from '../src/approved-manual-employment-integration.js';
import {withApprovedManualFixtureCapacities} from './fixtures/approved-manual-capacity-source.mjs';
import {createStaticWeeklyCompilerRuntime} from '../src/static-weekly-schedule-compiler-runtime.js';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const frameStart='2026-10-30',revision=5,managerId='00000000-0000-4000-8000-000000001099',
 week=readApprovedManualWeek(),draft=prepareApprovedManualSourceDraft({week,referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))}),
 source=withApprovedManualFixtureCapacities(draft.sourceDraft);
delete source.publicationAuthority;source.serviceDate=frameStart;
Object.assign(source.version,{id:'00000000-0000-4000-8000-000000001001',publicationId:'00000000-0000-4000-8000-000000001002',status:'published',effectiveStart:frameStart});
// Synthetic earlier-frame fixture only: use the approved person's captured
// identity, not the reference's old incumbent. This never edits roster history.
// Real admission remains the private current-date roster transaction.
for(const slot of source.slots.filter(s=>s.kind!=='CONTRACTOR_CAPACITY')){
 const person=week.referenceBindings.people.find(p=>p.slotId===slot.id);
 if(!person){assert.equal(slot.incumbencies.length,0);continue;}
 const incumbent=slot.incumbencies.find(i=>i.personId===person.employeeId);assert.ok(incumbent);
 slot.incumbencies=[{...incumbent,effectiveStart:frameStart,effectiveEnd:null}];
}
const ids=['1318b295-fd70-4e78-8828-62c29302f96f','d5fecc86-659b-464a-bc99-f0d914385db4'],
 commands=ids.map((employeeId,n)=>prepareApprovedManualEmploymentAdmission({employeeId,requestId:'00000000-0000-4000-8000-00000000110'+n,
  managerId,expectedAuthorityRevision:revision,expectedEmploymentRevision:0}).command),
 employmentByDate=Array.from({length:7},(_,n)=>({schema:'custodial.employment-admission-read.v1',
  serviceDate:new Date(Date.parse(frameStart+'T12:00Z')+n*86400000).toISOString().slice(0,10),authorityRevision:revision,
  employees:commands.map(command=>({employeeId:command.employeeId,employmentRevision:1,acceptedByManagerId:managerId,command:structuredClone(command)}))})),
 input={schema:'custodial.approved-manual-period-worker-input.v2',source,ownerConfig:draft.ownerConfig,frameStart,changes:[],priorDays:[],acceptedExceptions:[],
  priorProjection:null,actor:{managerId,managerName:'Synthetic employment component fixture'},expectedRevision:revision,
  idempotencyKey:'local-employment-period-DATA-not-an-accepted-operation',employmentByDate},before=digest({week,source,input}),runtime=createStaticWeeklyCompilerRuntime();
let result;
try{
 const prepared=await runtime.compileAndPrepare(input,{kind:'approved-manual-period'},{deadlineAtMilliseconds:performance.now()+60000});
 assert.equal(prepared.period.status,'COMPLETE_VALIDATED_DATED_DRAFTS',JSON.stringify(prepared.period.issues));
 assert.equal(prepared.nativeProjection.authority.employmentRevisionVector.length,14);
 assert.equal(input.acceptedExceptions.length,0,'Pre-start creates no PTO/absence facts');
 assert.equal(prepared.nativeProjection.authority.acceptedExceptionsDigest,digest([]));
 const p=prepared.nativeProjection,context=approvedManualEmploymentPeriod({frameStart,expectedRevision:revision,employmentByDate});
 assertApprovedManualEmploymentProjection({employment:context,projection:p});
 const xavier=ids[0],jada=ids[1],sat=p.authority.projectionAvailability.filter(a=>a.serviceDate==='2026-10-31'&&a.incumbentPersonId===xavier);
 assert.equal(sat.length,1);assert.equal(sat[0].status,'absent');assert.equal(sat[0].unavailabilityClassification,'PRE_START_NOT_PTO');
 assert.ok(!p.projectionAssignments.some(a=>a.service_date==='2026-10-31'&&a.owner_person_id===xavier));
 assert.ok(!p.projectionAssignments.some(a=>a.owner_person_id===jada));
 const sunday=p.authority.projectionAvailability.find(a=>a.serviceDate==='2026-11-01'&&a.incumbentPersonId===xavier);
 assert.equal(sunday.status,'working');assert.deepEqual(sunday.lunch,{start:'12:30',end:'13:30'});
 const bad=structuredClone(p);bad.projectionAssignments[0].owner_person_id=jada;
 assert.throws(()=>assertApprovedManualEmploymentProjection({employment:context,projection:bad}));
 const helper=structuredClone(p),loan=helper.lunchDocument.responsibilities.find(a=>a.service_date==='2026-10-31');
 assert.ok(loan);loan.coverer_slot_id=sat[0].slotId;
 assert.throws(()=>assertApprovedManualEmploymentProjection({employment:context,projection:helper}));
 assert.throws(()=>assertApprovedManualEmploymentProjection({employment:structuredClone(context),projection:p}));
 assert.equal(digest({week,source,input}),before,'Approved source/input changed');
 result={status:'PASS',scope:'Actual isolated compiler and dated employment guards with synthetic admission DATA; not SQL or production acceptance',
  frameStart,frameEnd:prepared.period.frameEnd,employmentBindings:14,preStartCreatesPto:false,preStartOwnersAndLunchHelpersExcluded:true,
  xavierWorkingFromNovember1:true,approvedLunchPreserved:true,forgedOwnerAndHelperRefused:true,serializedContextRefused:true,
  normalSourceChanged:false,productionWritten:false,providerCalls:0};
}finally{await runtime.shutdown();}
assert.equal(runtime.getReadiness().state,'closed');console.log(JSON.stringify(result));
