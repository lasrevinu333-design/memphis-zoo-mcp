import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {loadCurrentEightEmployeeTarget} from './static-weekly-target-plan-validation.mjs';
const config=JSON.parse(readFileSync(new URL('../config/custodial-eight-person-static-20261102.json',import.meta.url)));
const original=JSON.parse(readFileSync(config.fullHourLunchPlan.path));
const directory=mkdtempSync(join(tmpdir(),'custodial-target-'));
let rejected=0;
try{
  const accepted=loadCurrentEightEmployeeTarget(config,process.cwd());
  assert.equal(accepted.checks.lunches,40);
  const malformed=[
    plan=>{delete plan.days['1'].segments.find(s=>s.start>=480).owners.TETON;},
    plan=>{plan.days['1'].fullHourLunchLoans[0].end-=15;},
    plan=>{const loan=plan.days['1'].fullHourLunchLoans[0];loan.areas[Object.keys(loan.areas)[0]]=loan.from;},
    plan=>{plan.days['5'].segments.find(s=>s.start>=480).owners.HERPETARIUM='ALIJAH';},
    plan=>{plan.days['6'].segments.find(s=>s.start===840).owners.CAT_COUNTRY='KATHY';},
    plan=>{plan.days['1'].stages.find(s=>s.kind==='regular').owners.TETON='DERRICK';},
    plan=>{plan.days['1'].segments.at(-1).end+=1;},
  ];
  for(const mutate of malformed){
    const plan=structuredClone(original);mutate(plan);
    const path=join(directory,'target.json'),bytes=JSON.stringify(plan);writeFileSync(path,bytes);
    const candidate=structuredClone(config);candidate.fullHourLunchPlan={...candidate.fullHourLunchPlan,path,sha256:createHash('sha256').update(bytes).digest('hex')};
    assert.throws(()=>loadCurrentEightEmployeeTarget(candidate,process.cwd()));rejected++;
  }
  console.log(JSON.stringify({status:'PASS',...accepted.checks,malformedPlansRejected:rejected}));
}finally{rmSync(directory,{recursive:true,force:true});}
