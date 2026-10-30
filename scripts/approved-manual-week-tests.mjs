import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readApprovedManualWeek,previewApprovedManualDay} from '../src/approved-manual-week.js';

const week=readApprovedManualWeek(),pointByGroup=new Map(week.ratings.map(r=>[r.group,r.score]));
assert.deepEqual(week.days.map(d=>d.employees.length),[7,6,5,5,6,6,5]);
assert.equal(week.days.reduce((n,d)=>n+d.lunches.length,0),40);
assert.equal(week.ratings.reduce((n,r)=>n+r.score,0),136);
assert.equal(pointByGroup.get('Bonobos restrooms'),8);
assert.deepEqual(week.objective,{proximityPercent:75,loadPercent:25,normalizedFormula:null,formulaApproved:false});
assert.equal(week.runtimeBinding.registeredSourceId,null);
assert.equal(week.activation.published,false);assert.equal(week.receiptEligible,false);
assert.throws(()=>week.days[0].employees[0].baseGroups.push('invented'));
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3)),clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
let minuteSamples=0,ownerSamples=0,reliefSamples=0;
for(const day of week.days){
  for(let n=minute(day.checkedWindow.start);n<minute(day.checkedWindow.end);n++){
    const view=previewApprovedManualDay(week,{day:day.day,time:clock(n)});
    assert.equal(view.owners.length,23);assert.equal(new Set(view.owners.map(o=>o.group)).size,23);
    assert.equal(view.status,'APPROVED_PLANNING_PREVIEW_ONLY');assert.equal(view.published,false);assert.equal(view.receiptEligible,false);
    assert.equal(view.owners.reduce((s,o)=>s+pointByGroup.get(o.group),0),136);
    for(const loan of day.lunches.filter(l=>minute(l.start)<=n&&n<minute(l.end))){
      for(const group of loan.groups){const owner=view.owners.find(o=>o.group===group);assert.equal(owner.employee,loan.coverer);assert.equal(owner.reason,'FULL_HOUR_LUNCH_RELIEF');reliefSamples++;}
      assert.ok(!view.owners.some(o=>o.employee===loan.recipient));
    }
    const remaining=day.employees.filter(p=>minute(p.shift.start)<=n&&n<minute(p.shift.end));
    assert.equal(view.zooWideCoverage,remaining.length===1);
    assert.equal(view.createsMandatoryInheritedCleaningRoutes,false);
    minuteSamples++;ownerSamples+=view.owners.length;
  }
  assert.equal(previewApprovedManualDay(week,{day:day.day,time:'05:00'}).status,'PREARRIVAL_POLICY_UNRESOLVED');
  assert.deepEqual(previewApprovedManualDay(week,{day:day.day,time:day.checkedWindow.end}).owners,[]);
}
const phase=(day,time)=>week.days.find(d=>d.day===day).phases.find(p=>p.start===time);
assert.deepEqual(phase('friday','15:00').points,{'Kiltra Horton':67,'Alijah Collins':69});
assert.deepEqual(phase('saturday','15:00').points,{'Alijah Collins':45,'Kiltra Horton':52,'Xavier Green':39});
assert.deepEqual(phase('sunday','15:00').points,{'Alijah Collins':36,'Kiltra Horton':35,'Derrick Henderson':36,'Xavier Green':29});
for(const day of ['thursday','friday'])assert.equal(previewApprovedManualDay(week,{day,time:'16:00'}).status,'OUTSIDE_STAFFED_COVERAGE');
assert.equal(previewApprovedManualDay(week,{day:'monday',time:'09:45'}).owners.find(o=>o.group==='Zambezi and restrooms').employee,'Alijah Collins');
assert.throws(()=>previewApprovedManualDay(week,{day:'monday',serviceDate:'2026-11-03',time:'10:00'}),/weekday differs/);
for(const d of week.days)assert.equal(d.policy0945,d.day==='monday'?'OWNER_APPROVED_NO_CHANGEOVER':'UNRESOLVED');

const root=mkdtempSync(join(tmpdir(),'custodial-manual-packet-test-'));
try{
  const original=fileURLToPath(new URL('../config/schedules/manual-approved-20261030/',import.meta.url)),copy=join(root,'copy');
  cpSync(original,copy,{recursive:true});const catalogPath=join(copy,'catalog.json');
  const source=join(copy,'packet/sources/custodial_manual_monday_working_draft.json'),bytes=readFileSync(source);
  writeFileSync(source,Buffer.concat([bytes,Buffer.from(' ')]));
  assert.throws(()=>readApprovedManualWeek({catalogPath}),/Packet length changed/);writeFileSync(source,bytes);
  const catalog=JSON.parse(readFileSync(catalogPath));catalog.publication.published=true;writeFileSync(catalogPath,JSON.stringify(catalog));
  assert.throws(()=>readApprovedManualWeek({catalogPath}));catalog.publication.published=false;
  catalog.unresolvedPolicies=[];writeFileSync(catalogPath,JSON.stringify(catalog));assert.throws(()=>readApprovedManualWeek({catalogPath}));
}finally{rmSync(root,{recursive:true});}
console.log(JSON.stringify({marker:'APPROVED_MANUAL_WEEK_DATA_PASS',days:7,groups:23,fullHourReliefs:40,minuteSamples,ownerSamples,reliefSamples,
  activation:'HELD',published:false,engineRecalculationQualified:false,physicalAcceptance:false}));
