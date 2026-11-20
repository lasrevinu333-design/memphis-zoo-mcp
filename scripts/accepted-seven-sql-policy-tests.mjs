import assert from 'node:assert/strict';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {readAcceptedSevenManualWeek} from '../src/accepted-seven-manual-week.js';
import {prepareAcceptedSevenSqlPolicy} from '../src/accepted-seven-sql-policy.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {prepareApprovedManualAbsenceDay} from '../src/approved-manual-absence.js';
import {readFileSync} from 'node:fs';
let checks=0;const check=fn=>{fn();checks++;};
const week=readAcceptedSevenManualWeek(readApprovedManualWeek()),before=JSON.stringify(week),policy=prepareAcceptedSevenSqlPolicy(week);
check(()=>assert.equal(policy.manualDataDigest,week.dataDigest));
check(()=>assert.equal(policy.days.flatMap(d=>d.employees).length,35));
check(()=>assert.equal(policy.days.flatMap(d=>d.lunches).length,35));
check(()=>assert.equal(policy.days.some(d=>d.employees.some(e=>e.name==='Kiltra Horton')),false));
check(()=>assert.equal(policy.groups.reduce((n,g)=>n+g.points,0),136));
for(const day of week.days)check(()=>{
 const sql=policy.days.find(d=>d.weekday===day.weekday);
 for(const key of Object.keys(sql))assert.deepEqual(sql[key],day[key]);
});
const draft=prepareApprovedManualSourceDraft({week,referenceBytes:readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))});
for(const day of week.days)check(()=>{
 const date=new Date('2026-11-16T12:00Z');date.setUTCDate(date.getUTCDate()+(day.weekday+6)%7);
 const person=week.referenceBindings.people.find(p=>p.approvedName===day.employees[0].name);
 const input=prepareApprovedManualAbsenceDay({week,source:draft.sourceDraft,ownerConfig:draft.ownerConfig,
  serviceDate:date.toISOString().slice(0,10),absentPersonIds:[person.employeeId]});
 assert.deepEqual(policy.groups,input.groups);assert.deepEqual(policy.access,input.access);
});
for(const mutate of [w=>w.days[0].lunches[0].coverer='Alijah Collins',w=>w.days[0].employees[0].shift.start='06:00',
 w=>w.referenceBindings.people[0].employeeId='different',w=>w.dataDigest='0'.repeat(64),
 w=>w.acceptedStaticPattern.artifactSha256='0'.repeat(64),w=>w.ratings[0].score++]){
 check(()=>{const w=structuredClone(week);mutate(w);assert.throws(()=>prepareAcceptedSevenSqlPolicy(w));});
}
check(()=>assert.throws(()=>prepareAcceptedSevenSqlPolicy(readApprovedManualWeek())));
check(()=>assert.equal(JSON.stringify(week),before));
check(()=>{policy.days[0].employees[0].shift.start='20:00';assert.equal(JSON.stringify(week),before);});
console.log(JSON.stringify({status:'PASS_EXACT_SEVEN_SQL_POLICY_DATA',checks,normalWeekChanged:false,
 actualSQL:false,liveDataChanged:false,buildOrInstall:false}));
