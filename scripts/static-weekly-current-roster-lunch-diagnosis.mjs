import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {generateStaticWeeklySchedulingProgram,STATIC_WEEKLY_FLEXIBLE_COVERAGE_MODE} from '../src/static-weekly-schedule-program.js';
import {deriveLunchCoverageFromPreparedProblem} from '../src/static-weekly-lunch-coverage.js';

const filename=process.env.STATIC_WEEKLY_CONTINUITY_RESULT;
assert.ok(filename,'explicit local synthetic compiler evidence required');
const bytes=readFileSync(filename),artifact=JSON.parse(bytes);
assert.equal(artifact.classification,'SYNTHETIC_LOCAL_NOT_ADMITTED');
const result=artifact.result,{version,...rest}=result.canonicalAuthority.compilerInput;
const {problem,error}=generateStaticWeeklySchedulingProgram({...rest,versions:[version]});
assert.equal(error,undefined);
assert.equal(problem.inputDigest,result.inputDigest,'diagnosis uses the exact compiled source');
const candidate=deriveLunchCoverageFromPreparedProblem(problem,result.weeklyAssignments);
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const overlap=(a,b)=>minute(a.start)<minute(b.end)&&minute(b.start)<minute(a.end);
const works=new Map(problem.work.map(w=>[w.key,w]));
const failures=candidate.lunches.filter(l=>l.status==='REVIEW_REQUIRED').map(loan=>({loan,
  workingPeople:problem.slots.flatMap(slot=>{
    const a=problem.states.get(loan.dayOfWeek).availability.get(slot.id);
    const person=problem.incumbencyByDaySlot.get(`${loan.dayOfWeek}\0${slot.id}`);
    if(!person?.personId||a?.status!=='working')return [];
    return [{slotId:slot.id,person,availability:a,normalWork:result.weeklyAssignments
      .filter(w=>w.dayOfWeek===loan.dayOfWeek&&w.slotId===slot.id&&w.status==='ASSIGNED'&&overlap(w.window,loan.window))
      .map(w=>works.get(w.planWorkId)).filter(w=>w.schedulingMode===STATIC_WEEKLY_FLEXIBLE_COVERAGE_MODE&&w.serviceMode!=='reminder_only')
      .map(w=>({key:w.key,locationId:w.locationId,includedLocations:w.includedLocations,restrictedSlotIds:w.restrictedSlotIds,
        requiredQualifications:w.requiredQualifications,window:w.window}))}];
  })}));
console.log(JSON.stringify({classification:'READ_ONLY_LOCAL_DIAGNOSIS_NOT_A_PASS',
  artifactSha256:createHash('sha256').update(bytes).digest('hex'),sourceInputDigest:problem.inputDigest,
  totalLunches:candidate.lunches.length,status:candidate.status,failures,production:false,independentAudit:false},null,2));
