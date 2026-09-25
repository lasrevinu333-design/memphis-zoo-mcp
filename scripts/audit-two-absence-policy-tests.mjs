import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const root=process.argv[2]||process.cwd();const {partitionCustodialAbsences}=await import(pathToFileURL(root+'/src/custodial-coverage-policy.js'));
const program=fs.readFileSync(root+'/src/static-weekly-schedule-program.js','utf8');
const verifier=fs.readFileSync(root+'/src/static-weekly-schedule-verifier.js','utf8');
const compilerSource=program.slice(program.indexOf('function applyCustodialAbsenceCoveragePolicy('),program.indexOf('function proximityIndex('));
const verifierSource=verifier.slice(verifier.indexOf('function applyCustodialAbsenceCoveragePolicy('),verifier.indexOf('function validWork('));
let checks=0;
for(let count=0;count<=9;count++)for(const manuallyAdded of [0,1,3]){
 const absent=Array.from({length:count},(_,i)=>'employee-'+i),contractors=Array.from({length:manuallyAdded},(_,i)=>'coverall-'+i);
 const policy=partitionCustodialAbsences(absent);assert.equal(policy.triggered,false);assert.equal(policy.coverAllEmployeeIds.length,0);checks++;
 for(const [name,source] of [['compiler',compilerSource],['verifier',verifierSource]]){
  const state={availability:new Map(),fullDayAbsenceSlotIds:absent,contractorCoverageSlotIds:contractors,work:[...absent,'working'].map(originSlotId=>({originSlotId}))};
  const slots=new Map([...absent,'working'].map(id=>[id,{contractorCapacity:false}]));for(const id of contractors)slots.set(id,{contractorCapacity:true});
  const violations=[];const c={push:(a,code,details)=>a.push({code,details}),stableCompare:(a,b)=>a.localeCompare(b)};vm.createContext(c);vm.runInContext(source,c);
  c.applyCustodialAbsenceCoveragePolicy(state,slots,violations,'2026-09-28');assert.equal(violations.length,0,name);
  for(const work of state.work){assert.equal(work.custodialCoverageMode,manuallyAdded?'manager_added_coverage':absent.includes(work.originSlotId)?'internal_even':'zoo_employee_baseline');assert.deepEqual(Array.from(work.custodialCoverageSlotIds),contractors);}
  checks++;
 }
}
console.log(JSON.stringify({scope:'OC24 actual partition/compiler/verifier:0-9 absences independently crossed with0/1/3 MANUAL capacities; not publication or route feasibility',checks,failed:0}));
