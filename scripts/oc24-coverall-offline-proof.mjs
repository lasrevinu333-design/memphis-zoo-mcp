import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileStaticWeeklySchedule} from '../src/static-weekly-schedule-compiler.js';
import {verifyStaticWeeklyScheduleResult} from '../src/static-weekly-schedule-verifier.js';
import {createStaticWeeklyLunchCoverageCandidate,verifyStaticWeeklyLunchCoverageCandidate} from '../src/static-weekly-lunch-coverage.js';
import {shutdownStaticWeeklyCompiler} from '../src/static-weekly-schedule-compiler-runtime.js';

// Exact synthetic input captured at the owning transaction before rollback.
// No database, production record, replacement projection or external service.
const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
try {
 const result=await compileStaticWeeklySchedule(input);
 console.log('COMPILER',JSON.stringify({status:result.status,fatal:result.fatal,verifier:result.verifier}));
 assert.equal(result.status,'FEASIBLE');
 assert.equal(verifyStaticWeeklyScheduleResult(input,result).ok,true);
 const roundoff=result.solver.tiers.filter(t=>t.attestation.objectPrimalObjective!==t.objectiveValue);
 assert.ok(roundoff.length,'captured case still exercises real worker floating roundoff');
 console.log('RAW_ROUNDOFF_RETAINED',JSON.stringify(roundoff.map(t=>({tier:t.name,exact:t.objectiveValue,raw:t.attestation.objectPrimalObjective,normalized:t.attestation.normalized}))));
 const lunch=createStaticWeeklyLunchCoverageCandidate(input,result);
 console.log('LUNCH',JSON.stringify({status:lunch.status,lunches:lunch.lunches.map(l=>({status:l.status,reason:l.reason,helpers:l.helperSlotIds,normalOwnerSlotId:l.normalOwnerSlotId}))}));
 assert.equal(lunch.status,'PLANNED');
 assert.equal(verifyStaticWeeklyLunchCoverageCandidate(input,result,lunch).ok,true);
 const index=result.solver.tiers.findIndex(t=>t===roundoff[0]),exact=roundoff[0].objectiveValue;
 let rejected=0;
 for(const bad of [NaN,Infinity,-Infinity]){
  const changed=structuredClone(result);changed.solver.tiers[index].attestation.objectPrimalObjective=bad;
  assert.throws(()=>verifyStaticWeeklyScheduleResult(input,changed),/postgres_jsonb_number_must_be_finite/);rejected++;
 }
 for(const bad of [null,true,false,String(exact),[],{},exact+2e-9,exact-2e-9,exact+0.1,exact+1]){
  const changed=structuredClone(result);
  changed.solver.tiers[index].attestation.objectPrimalObjective=bad;
  const checked=verifyStaticWeeklyScheduleResult(input,changed);
  assert.equal(checked.ok,false);
  // Check this owning numeric boundary, not just unrebound receipt hashes.
  assert.ok(checked.violations.some(v=>v.code==='solver_attestation_invalid'&&v.terminalErrors.includes('object_primal_objective_disagreement')),JSON.stringify(bad));
  rejected++;
 }
 for(const [pattern,line,error] of [
  [/^  Primal bound\s+/,'  Primal bound      '+(exact+1e-10),'report_bound_or_objective_disagreement'],
  [/^  Dual bound\s+/,'  Dual bound        '+(exact+1e-10),'report_bound_or_objective_disagreement'],
  [/^  Gap\s+/,'  Gap               0.0000000001%','report_gap_or_violation_nonzero'],
  [/\(row viol\.\)/,'                    0.0000000001 (row viol.)','report_gap_or_violation_nonzero'],
  [/\(bound viol\.\)/,'                    0.0000000001 (bound viol.)','report_gap_or_violation_nonzero'],
 ]){
  const changed=structuredClone(result),records=changed.solver.tiers[index].attestation.terminalReport.records;
  const row=records.find(r=>pattern.test(r.text));assert.ok(row);row.text=line;
  const checked=verifyStaticWeeklyScheduleResult(input,changed);
  assert.equal(checked.ok,false);
  assert.ok(checked.violations.some(v=>v.code==='solver_attestation_invalid'&&v.terminalErrors.includes(error)),line);
  rejected++;
 }
 console.log('PASS owning numeric rejection checks',rejected,'exact rows/bounds/gap unchanged');
 console.log('PASS exact synthetic compiler/verifier and lunch candidate; not independent audit or production proof');
}finally{await shutdownStaticWeeklyCompiler();}
