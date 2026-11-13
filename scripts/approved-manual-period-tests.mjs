import {withApprovedManualFixtureCapacities} from './fixtures/approved-manual-capacity-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {solveApprovedManualAbsencePeriod,readApprovedManualAbsenceObjective} from '../src/approved-manual-absence.js';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const args=process.argv.slice(2);assert.ok(!args.length||(args.length===2&&['--evidence-dir','--native-evidence-dir'].includes(args[0])&&isAbsolute(args[1])));
const out=args[0]==='--evidence-dir'?args[1]:null;if(out)fs.mkdirSync(out,{mode:0o700});
const save=(file,value)=>{if(out)fs.writeFileSync(resolve(out,file),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});};
const week=readApprovedManualWeek(),draft=prepareApprovedManualSourceDraft({week,referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))}),
 source=withApprovedManualFixtureCapacities(draft.sourceDraft),frameStart='2026-11-02';delete source.publicationAuthority;source.serviceDate=frameStart;
Object.assign(source.version,{id:'00000000-0000-4000-8000-000000001001',publicationId:'00000000-0000-4000-8000-000000001002',status:'published',effectiveStart:frameStart});
const original=JSON.stringify({week,source,ownerConfig:draft.ownerConfig}),id=name=>week.referenceBindings.people.find(p=>p.approvedName.startsWith(name+' ')).employeeId,
 run=(changes=[],priorDays=[],options={})=>solveApprovedManualAbsencePeriod({week,source,ownerConfig:draft.ownerConfig,frameStart,changes,priorDays},options);
save('INTENT.json',{scope:'LOCAL_DATED_PERIOD_COMPOSITION_ONLY',production:false,SQL:false,genuineBrowser:false,frameIsFixtureData:true,files:['src/approved-manual-absence.js','scripts/approved-manual-period-tests.mjs'].map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(new URL('../'+path,import.meta.url))).digest('hex')}))});
const normal=await run();assert.equal(normal.status,'COMPLETE_VALIDATED_DATED_DRAFTS');assert.equal(normal.days.length,7);assert.equal(normal.solverInvoked,false);
for(const day of normal.days){assert.equal(day.kind,'NORMAL');assert.deepEqual(day.approvedDay,week.days.find(d=>d.weekday===new Date(day.serviceDate+'T12:00Z').getUTCDay()));}
const dates=normal.days.map(d=>d.serviceDate);assert.equal(dates[0],'2026-11-02');assert.equal(dates[6],'2026-11-08');
const fact={serviceDate:'2026-11-03',absentPersonIds:[id('Jada'),id('Derrick')]},adjusted=await run([fact]);
assert.equal(adjusted.status,'COMPLETE_VALIDATED_DATED_DRAFTS');assert.deepEqual(adjusted.solvedDates,[fact.serviceDate]);assert.equal(adjusted.days.filter(d=>d.kind==='NORMAL').length,6);
const accepted=adjusted.days.find(d=>d.serviceDate===fact.serviceDate);assert.equal(accepted.kind,'ABSENCE');
const replay=await run([fact],[accepted]);assert.equal(replay.solverInvoked,false);assert.deepEqual(replay.reusedDates,[fact.serviceDate]);
assert.equal(replay.days.find(d=>d.serviceDate===fact.serviceDate).plan.planDigest,accepted.plan.planDigest);
const karen=accepted.input.roster.find(p=>p.personId===id('Karen')),capacity=source.slots.find(s=>s.contractorCapacity),
 substitute={slotId:capacity.id,serviceDate:fact.serviceDate,managerConfirmed:true,actualHoursConfirmed:true,
  confirmationReference:'LOCAL_PERIOD_FIXTURE_NOT_A_BOOKING',shift:structuredClone(karen.shift),lunch:structuredClone(karen.lunch)},
 third={...fact,absentPersonIds:[...fact.absentPersonIds,id('Karen')],substitute},withThird=await run([third],[accepted]);
assert.equal(withThird.status,'COMPLETE_VALIDATED_DATED_DRAFTS');assert.equal(withThird.solverInvoked,false);
const replacement=withThird.days.find(d=>d.serviceDate===fact.serviceDate);assert.equal(replacement.kind,'COVERALL');
assert.equal(replacement.overlay.otherNormalOwnersChanged,false);assert.equal(replacement.overlay.scoringRerun,false);
assert.equal(replacement.plan.planDigest,accepted.plan.planDigest);assert.equal(replacement.overlay.absentPersonIds.length,3);
// Confirmed later hours carry all inherited areas after the last employee
// leaves, with no extension to any employee or early global-custody invention.
const extendedThird=structuredClone(third);extendedThird.substitute.shift={start:'05:00',end:'18:00'};
const extended=await run([extendedThird],[accepted]);assert.equal(extended.status,'COMPLETE_VALIDATED_DATED_DRAFTS');
const late=extended.days.find(d=>d.kind==='COVERALL').overlay;
assert.equal(late.checkedWindow.start,accepted.input.checkedWindow.start);assert.equal(late.checkedWindow.end,'18:00');
assert.equal(late.confirmedCoverageExtension.beforeNormalMinutes,0);
assert.equal(late.confirmedCoverageExtension.afterNormalMinutes,60);
for(const slice of late.coverage.filter(c=>c.window.start>='17:00')){
 assert.equal(slice.zooWideCoverage,true);assert.deepEqual([...new Set(Object.values(slice.owners))],[capacity.id]);
}
for(const original of accepted.input.roster.filter(p=>p.personId!==id('Karen')))
 assert.deepEqual(late.roster.find(p=>p.slotId===original.slotId).shift,original.shift);
const unconfirmed=structuredClone(third);unconfirmed.substitute.actualHoursConfirmed=false;
assert.equal((await run([unconfirmed],[accepted])).status,'COVERAGE_CONSTRAINTS_UNRESOLVED');
const missing=await run([third]);assert.equal(missing.status,'COVERAGE_CONSTRAINTS_UNRESOLVED');assert.equal(missing.solverInvoked,false);
const short=structuredClone(third);short.substitute.shift.end='13:00';const shortResult=await run([short],[accepted]);
assert.equal(shortResult.status,'COVERAGE_CONSTRAINTS_UNRESOLVED');assert.equal(shortResult.solverInvoked,false);
const impossible=await run([{serviceDate:'2026-11-08',absentPersonIds:[id('Derrick'),id('Jada')]},fact]);
assert.equal(impossible.status,'COVERAGE_CONSTRAINTS_UNRESOLVED');assert.equal(impossible.solverInvoked,false);
assert.deepEqual(impossible.solvedDates,[],'A known invalid day must prevent every weighted solve in that period');
const tampered=structuredClone(accepted);tampered.plan.phaseOwners[0].owners.CHINA='stale-owner';await assert.rejects(()=>run([fact],[tampered]));
const changed=structuredClone(readApprovedManualAbsenceObjective());changed.weights.proximity=100;await assert.rejects(()=>run([fact],[],{proposal:changed}));
await assert.rejects(()=>run([fact,fact]));
const badSource=structuredClone(source);badSource.serviceDate='2026-11-03';await assert.rejects(()=>solveApprovedManualAbsencePeriod({week,source:badSource,ownerConfig:draft.ownerConfig,frameStart:'2026-11-03'}));
const ending=structuredClone(source);ending.version.effectiveEnd='2026-11-08';await assert.rejects(()=>solveApprovedManualAbsencePeriod({week,source:ending,ownerConfig:draft.ownerConfig,frameStart}));
const controller=new AbortController();controller.abort();await assert.rejects(()=>run([],[],{signal:controller.signal}),e=>e.code==='approved_manual_period_deadline_exceeded');
assert.equal(JSON.stringify({week,source,ownerConfig:draft.ownerConfig}),original);
for(const result of [normal,adjusted,replay,withThird,missing,shortResult,impossible])for(const flag of ['normalWeekChanged','publicationEligible','productionWritten','contractorBooked'])assert.equal(result[flag],false);
save('NORMAL.json',normal);save('TWO_ABSENCE.json',adjusted);save('THIRD_COVERALL.json',withThird);
const result={status:'PASS',scope:'Existing approved day engine composed over seven dates, DATA only; no SQL/publication/runtime qualification',
 sevenNormalDaysExact:true,oneChangedDaySixUntouched:true,reusedAcceptedDayWithoutSolver:true,thirdUsesExactAcceptedTwoAbsenceBasis:true,
 invalidHoursMissingBasisStalePlanAndWrongFormulaRefused:true,knownInvalidPeriodRejectedBeforeScoring:true,
 sourceAndPriorDataUnchanged:true,productionWritten:false};save('RESULT.json',result);console.log(JSON.stringify(result));

export {week,source,draft,normal,adjusted,withThird,extended};
