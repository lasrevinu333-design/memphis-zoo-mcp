import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const root=process.argv[2]||process.cwd();const {partitionCustodialAbsences}=await import(pathToFileURL(root+'/src/custodial-coverage-policy.js'));
const program=fs.readFileSync(root+'/src/static-weekly-schedule-program.js','utf8');
const verifier=fs.readFileSync(root+'/src/static-weekly-schedule-verifier.js','utf8');
const compilerSource=program.slice(program.indexOf('function applyCustodialAbsenceCoveragePolicy('),program.indexOf('function proximityIndex('));
const verifierSource=verifier.slice(verifier.indexOf('function applyCustodialAbsenceCoveragePolicy('),verifier.indexOf('function validWork('));
const results=[];function test(name,fn){try{fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}
for(let count=0;count<=6;count++){
 const absent=Array.from({length:count},(_,i)=>'employee-'+i),contractors=Array.from({length:Math.max(0,count-2)},(_,i)=>'coverall-'+i);
 test('policy '+count+' absences',()=>{const actual=partitionCustodialAbsences(absent);assert.equal(actual.internallyRedistributedEmployeeIds.length,Math.min(count,2));assert.equal(actual.coverAllEmployeeIds.length,Math.max(0,count-2));});
 for(const [name,source] of [['compiler',compilerSource],['verifier',verifierSource]])test(name+' '+count+' absences',()=>{
   const state={fullDayAbsenceSlotIds:absent,contractorCoverageSlotIds:contractors,work:[...absent,'working'].map(originSlotId=>({originSlotId}))};
   const slots=new Map([...absent,'working'].map(id=>[id,{contractorCapacity:false}]));for(const id of contractors)slots.set(id,{contractorCapacity:true});
   const violations=[];const c={push:(a,code,details)=>a.push({code,details})};vm.createContext(c);vm.runInContext(source,c);
   c.applyCustodialAbsenceCoveragePolicy(state,slots,violations,'2026-09-21');assert.equal(violations.length,0);
   for(let i=0;i<count;i++){assert.equal(state.work[i].custodialCoverageMode,i<2?'internal_even':'contractor_exact');assert.equal(state.work[i].custodialCoverageSlotId,i<2?null:contractors[i-2]);}
 });
}
test('duplicate absence IDs do not add capacity',()=>{const a=partitionCustodialAbsences(['a','b','a','c','b']);assert.equal(a.absentCount,3);assert.equal(a.coverAllEmployeeIds.length,1);});
console.log(JSON.stringify({scope:'Actual partition/compiler/verifier functions with independent synthetic capacity oracle; not roster publication or route feasibility',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results},null,2));process.exitCode=results.some(r=>!r.passed)?1:0;
