import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {prepareApprovedManualAbsenceDay,solveApprovedManualAbsenceAdjustment,validateApprovedManualAbsenceProposal,readApprovedManualAbsenceObjective} from '../src/approved-manual-absence.js';

// Finite, local review of every actual weekday roster. No publication, database,
// contractor fixture, synthetic employee availability, or changed solver budget.
assert.equal(process.argv.length,3);const out=process.argv[2];assert.ok(isAbsolute(out));
fs.mkdirSync(out,{recursive:true,mode:0o700});
const hash=x=>createHash('sha256').update(x).digest('hex'),minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const save=(name,value)=>fs.writeFileSync(resolve(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const week=readApprovedManualWeek(),source=prepareApprovedManualSourceDraft({week,referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))}),proposal=readApprovedManualAbsenceObjective();
const runtime=fs.readdirSync(new URL('../src/',import.meta.url)).filter(n=>n.endsWith('.js')).sort().map(name=>({name,sha256:hash(fs.readFileSync(new URL('../src/'+name,import.meta.url)))}));
const intent={schema:'custodial.all-absence-review.v1',weekDigest:week.dataDigest,formula:proposal.weights,runtime,sourceDigest:hash(JSON.stringify(source)),solverBudgetMilliseconds:25000,contractorFixture:false,production:false,publication:false,build:false,install:false};
const ip=resolve(out,'INTENT.json');if(fs.existsSync(ip))assert.deepEqual(JSON.parse(fs.readFileSync(ip)),intent);else save('INTENT.json',intent);
const cases=[];
for(const day of week.days){
 const date=`2026-11-${String(day.weekday===0?8:day.weekday+1).padStart(2,'0')}`,roster=day.employees;
 for(let i=0;i<roster.length;i++){
  cases.push({day,date,names:[roster[i].name]});
  for(let j=i+1;j<roster.length;j++)cases.push({day,date,names:[roster[i].name,roster[j].name]});
 }
}
assert.equal(cases.length,136);assert.equal(cases.filter(c=>c.names.length===1).length,40);
const results=[];
for(const [index,c]of cases.entries()){
 const file=`CASE_${String(index+1).padStart(3,'0')}.json`,path=resolve(out,file);
 let result;
 if(fs.existsSync(path)){result=JSON.parse(fs.readFileSync(path));assert.equal(result.weekDigest,week.dataDigest);assert.deepEqual(result.absent,c.names);}
 else{
  const started=performance.now();
  const input=prepareApprovedManualAbsenceDay({week,source:source.sourceDraft,ownerConfig:source.ownerConfig,serviceDate:c.date,absentPersonIds:c.names.map(name=>week.referenceBindings.people.find(p=>p.approvedName===name).employeeId)});
  const plan=await solveApprovedManualAbsenceAdjustment(input,{proposal});let validation=null,ownershipChecks=0;
  if(plan.status==='COMPLETE_APPROVED_FORMULA_ADJUSTMENT_DRAFT'){
   validation=validateApprovedManualAbsenceProposal({plan,input,proposal});
   assert.equal(validation.fullHourLunches,input.roster.length);
   for(let at=minute(input.checkedWindow.start);at<minute(input.checkedWindow.end);at++){
    const rows=plan.coverage.filter(p=>minute(p.window.start)<=at&&at<minute(p.window.end));assert.equal(rows.length,1);assert.equal(Object.keys(rows[0].owners).length,23);
    for(const g of input.groups){const p=input.roster.find(p=>p.slotId===rows[0].owners[g.code]);assert.ok(p);assert.ok(!c.names.includes(p.name));assert.ok(minute(p.shift.start)<=at&&at<minute(p.shift.end));assert.ok(!(minute(p.lunch.start)<=at&&at<minute(p.lunch.end)));ownershipChecks++;}
   }
  }
  const baselineWindow=c.day.checkedWindow,checkedWindow=input.checkedWindow,baselineWindowGaps=[];
  if(checkedWindow.start>baselineWindow.start)baselineWindowGaps.push({start:baselineWindow.start,end:checkedWindow.start});
  if(checkedWindow.end<baselineWindow.end)baselineWindowGaps.push({start:checkedWindow.end,end:baselineWindow.end});
  result={case:index+1,day:c.day.day,date:c.date,absent:c.names,weekDigest:week.dataDigest,status:plan.status,elapsedMs:performance.now()-started,baselineWindow,checkedWindow,baselineWindowGaps,fullBaselineWindowCovered:plan.status==='COMPLETE_APPROVED_FORMULA_ADJUSTMENT_DRAFT'&&!baselineWindowGaps.length,ownershipChecks,validation,reason:plan.reason||null,issues:plan.issues||[],solverStatus:plan.solverStatus||null,failedStage:plan.failedStage||null,input,plan,production:false,publication:false};
  save(file,result);
 }
 results.push({file,...Object.fromEntries(['case','day','absent','status','elapsedMs','baselineWindow','checkedWindow','baselineWindowGaps','fullBaselineWindowCovered','ownershipChecks','reason','issues','solverStatus','failedStage'].map(k=>[k,result[k]]))});
 console.log(JSON.stringify(results.at(-1)));
}
for(const r of runtime)assert.equal(hash(fs.readFileSync(new URL('../src/'+r.name,import.meta.url))),r.sha256,'Runtime changed during review');
assert.equal(readApprovedManualWeek().dataDigest,week.dataDigest);
const summary={schema:'custodial.all-absence-review-results.v1',weekDigest:week.dataDigest,total:results.length,singles:results.filter(r=>r.absent.length===1).length,pairs:results.filter(r=>r.absent.length===2).length,byStatus:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),baselineWindowGapCases:results.filter(r=>r.baselineWindowGaps.length).length,allFullBaselineWindowsCovered:results.every(r=>r.fullBaselineWindowCovered),results,production:false,publication:false,contractorBooked:false,appBuild:false,phone:false};
save('RESULT.json',summary);console.log(JSON.stringify({...summary,results:undefined}));
