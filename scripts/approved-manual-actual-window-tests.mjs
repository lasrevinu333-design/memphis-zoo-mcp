import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {withApprovedManualFixtureCapacities} from './fixtures/approved-manual-capacity-source.mjs';
import {solveApprovedManualAbsencePeriod} from '../src/approved-manual-absence.js';
import {prepareApprovedManualPeriodProjection} from '../src/approved-manual-period-projection.js';
import {approvedManualManagerView} from '../src/approved-manual-manager-view.js';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
assert.ok(process.argv.length===2||(process.argv.length===3&&isAbsolute(process.argv[2])));
const out=process.argv[2];if(out)fs.mkdirSync(out,{mode:0o700});
const save=(name,x)=>{if(out)fs.writeFileSync(resolve(out,name),JSON.stringify(x,null,2)+'\n',{flag:'wx',mode:0o600});};
const week=readApprovedManualWeek(),draft=prepareApprovedManualSourceDraft({week,
 referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))}),
 source=withApprovedManualFixtureCapacities(draft.sourceDraft),serviceDate='2026-11-09',frameStart='2026-11-06';
delete source.publicationAuthority;source.serviceDate=frameStart;
Object.assign(source.version,{id:'00000000-0000-4000-8000-000000001001',publicationId:'00000000-0000-4000-8000-000000001002',effectiveStart:frameStart,status:'published'});
const xavier=week.referenceBindings.people.find(p=>p.approvedName.startsWith('Xavier ')),original=digest({week,source,draft}),
 period=await solveApprovedManualAbsencePeriod({week,source,ownerConfig:draft.ownerConfig,frameStart,
  changes:[{serviceDate,absentPersonIds:[xavier.employeeId]}]}),
 fact={id:'actual-window-pto-fixture',type:'pto',serviceDate,status:'accepted',actorId:'00000000-0000-4000-8000-000000001099',
  reason:'LOCAL_DATA_ONLY_NOT_A_REAL_APPROVAL',idempotencyKey:'actual-window-pto-fixture',sequence:1,expectedRevision:0,
  baseVersionId:source.version.id,publicationId:source.version.publicationId,payload:{slotId:xavier.slotId}};
assert.equal(period.status,'COMPLETE_VALIDATED_DATED_DRAFTS');
const day=period.days.find(d=>d.serviceDate===serviceDate);assert.deepEqual(day.input.checkedWindow,{start:'07:00',end:'16:00'});
assert.deepEqual(day.plan.checkedWindow,day.input.checkedWindow);
const native=prepareApprovedManualPeriodProjection({week,source,ownerConfig:draft.ownerConfig,period,acceptedExceptions:[fact]}),
 rows=native.projectionAssignments.filter(r=>r.service_date===serviceDate);
assert.ok(rows.every(r=>r.work_snapshot.window.end<='16:00'));assert.ok(rows.every(r=>r.owner_person_id!==xavier.employeeId));
let checks=0;for(let minute=7*60;minute<16*60;minute++){
 const t=`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`,
  actual=rows.filter(r=>r.work_snapshot.window.start<=t&&t<r.work_snapshot.window.end);
 assert.equal(actual.length,23);assert.equal(new Set(actual.map(r=>r.work_snapshot.locationCodeSnapshot)).size,23);
 const expected=day.plan.coverage.find(c=>c.window.start<=t&&t<c.window.end);
 for(const row of actual){
  let owner=row.owner_slot_id;
  for(const loan of native.lunchDocument.loans.filter(l=>l.service_date===serviceDate&&l.normal_owner_slot_id===owner&&l.coverage_start<=t&&t<l.coverage_end)){
   const responsibility=native.lunchDocument.responsibilities.find(r=>r.loan_id===loan.loan_id&&r.segments.some(s=>s.workId===row.work_id));
   assert.ok(responsibility);owner=responsibility.coverer_slot_id;
  }
  assert.equal(owner,expected.owners[row.work_snapshot.locationCodeSnapshot]);checks++;
 }
}
const projectionId='00000000-0000-4000-8000-000000001003',view=approvedManualManagerView({source,
 snapshot:{projection_status:'current',current_publication:{publication_id:source.version.publicationId},latest_projection:{projection_id:projectionId,assignments:native.projectionAssignments}},
 projectionAvailability:native.authority.projectionAvailability,lunchDocument:{...native.lunchDocument,projection_id:projectionId,persistence_status:'PERSISTED'}}),
 atSeven=view.days.find(d=>d.serviceDate===serviceDate).phases.find(p=>p.start<='07:00'&&p.end>'07:00');
assert.equal(atSeven.completeSiteCoverageRequired,true);assert.equal(atSeven.totalPoints,136);
assert.equal(digest({week,source,draft}),original);
save('PERIOD.json',period);save('NATIVE.json',native);save('MANAGER_VIEW_DATA.json',view);
const result={status:'PASS',scope:'Real bounded absence solve, native DATA and manager rendering; no SQL/publication/device claim',
 rollingFrame:frameStart,serviceDate,actualCoverageWindow:day.plan.checkedWindow,areaMinuteChecks:checks,
 noEmployeeShiftExtensions:true,allSevenNormalDaysUnchanged:true,productionWritten:false};save('RESULT.json',result);console.log(JSON.stringify(result));
