import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Importing the test implementation does not run its guarded CLI. Call each
// bounded owning proof; neither an oracle nor a single-package result stands
// in for the current day's full selected set.
// Each guarded entry installs the one-time accelerator. Isolate their module
// state just like the other real solver CI cases; do not relax that guard.
function run(args){
  const output=execFileSync(process.execPath,['--max-old-space-size=256',
    '--wasm-max-mem-pages=1536','--max-semi-space-size=4',
    fileURLToPath(new URL('./static-weekly-recurring-morning-solver-tests.mjs',import.meta.url)),
    ...args],{encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024,
      env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
  process.stdout.write(output);
  return JSON.parse(output.trim().split('\n').at(-1));
}
const pure=run([]);
assert.equal(pure.status,'PASS');
assert.equal(pure.checks,32);
assert.equal(pure.solver,false);
assert.equal(pure.canonicalOptimumClaim,false);
const small=run(['--engine']);
assert.equal(small.status,'PASS');
assert.equal(small.checks,18);
assert.equal(small.tierCount,7);
assert.equal(small.canonicalRows,644);
const day=run(['--current-day']);
assert.equal(day.status,'PASS');
assert.equal(day.checks,5);
assert.equal(day.selectedPackages,23);
assert.equal(day.canonicalRows,644);
assert.equal(day.wholeWeekMorningProof,false);
for(const result of [small,day]){
  assert.equal(result.syntheticLocalSource,true);
  for(const key of ['workerIpc','sql','published'])assert.equal(result[key],false);
  assert.match(result.proofDigest,/^[a-f0-9]{64}$/);
}
console.log(JSON.stringify({suite:'recurring-morning-called-ci',passed:true,
  pureChecks:pure.checks,twoPackageChecks:small.checks,currentDayChecks:day.checks,
  wholeWeek:false,workerIpc:false,sql:false,published:false}));
