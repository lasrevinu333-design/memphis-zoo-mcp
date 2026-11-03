import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Explicit called source/calendar regressions. Actual fresh private 6/7/8
// solver/publication gates remain separate; these cannot stand in for them.
const script=fileURLToPath(new URL('./static-weekly-recurring-morning-integration-tests.mjs',import.meta.url));
function run(args,expected){
 const out=execFileSync(process.execPath,[script,...args],{encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024,
  env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
 process.stdout.write(out);
 const result=JSON.parse(out.trim().split('\n').at(-1));
 assert.equal(result.status,'PASS');assert.equal(result.checks,expected);
 assert.equal(result.sourceOnly,true);assert.equal(result.solver,false);
 return result;
}
const pure=run([],14),calendar=run(['--target-calendar'],31);
assert.equal(pure.wholeWeekProof,false);assert.equal(calendar.wholeWeekOptimum,false);
assert.deepEqual(calendar.targetWeeks,['2026-10-12','2026-10-19']);
assert.equal(calendar.originalDatedEvidenceRetained,true);
console.log(JSON.stringify({status:'PASS',suite:'recurring-morning-called-source-calendar',checks:45,
 solver:false,privateIpc:false,sql:false,publication:false}));
