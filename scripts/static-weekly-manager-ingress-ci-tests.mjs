// One bounded owning attempt from this Node process's start, including module
// imports and every child teardown. Each child gets only the original remainder.
import assert from 'node:assert/strict';
import {runBoundedNodeProof} from './bounded-node-proof.mjs';
const origin=0,deadline=origin+60000,receipts=[];
const entries=[
 ['scripts/static-weekly-manager-operation-tests.mjs',28],
 ['scripts/static-weekly-manager-auth-deadline-tests.mjs',9],
 ['scripts/static-weekly-manager-ingress-http-tests.mjs',70],
 ['scripts/restore-mutation-gate-tests.mjs','RESTORE_MUTATION_GATE_TESTS_PASS'],
 ['scripts/static-weekly-control-plane-runtime-tests.mjs','static weekly control-plane runtime trusted-device fail-closed tests: PASS'],
 ['scripts/static-weekly-recurring-operation-owner-tests.mjs','static weekly recurring operation-owned custody tests: PASS'],
 ['scripts/static-weekly-recurring-operation-child-tests.mjs','static-weekly recurring private child/source/envelope checks PASS'],
 ['scripts/static-weekly-recurring-operation-handler-tests.mjs','static-weekly recurring restore-custody handler checks PASS'],
 ['scripts/static-weekly-recurring-shared-admission-tests.mjs','static-weekly recurring shared authority admission checks PASS'],
 ['scripts/static-weekly-recurring-owned-http-tests.mjs','static-weekly recurring operation-owned authenticated loopback checks PASS'],
];
for(const[file,expected]of entries){
 const absoluteMilliseconds=Math.floor(deadline-performance.now())-1000;
 assert.ok(absoluteMilliseconds>5000,'original manager proof attempt expired; no stage reset');
 const result=await runBoundedNodeProof({args:['--max-old-space-size=128','--max-semi-space-size=8',file],
  absoluteMilliseconds,cleanupReserveMilliseconds:5000,maxBuffer:1024*1024});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);
 if(typeof expected==='number'){
  const proof=JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(proof.status,'PASS');assert.equal(proof.checks,expected);
 }else assert.equal(result.stdout.trim().split('\n').filter(x=>x===expected).length,1);
 receipts.push({file,pid:result.receipt.pid,groupAbsent:result.receipt.groupAbsent,elapsedMs:result.receipt.elapsedMs});
}
assert.equal(receipts.length,10);assert.ok(performance.now()<deadline);
console.log(JSON.stringify({suite:'manager-ingress-called-ci',status:'PASS',entries:10,checks:[28,9,70],
 elapsedMs:performance.now()-origin,absoluteMilliseconds:60000,receipts,solver:false,sql:false,browser:false,managerE2E:false}));
