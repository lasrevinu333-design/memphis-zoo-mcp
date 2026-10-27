// Owning Source/loopback CI ONLY. These two maintained wrappers measure their
// 60s interval from PROCESS START, so each owns a fresh process at its ordered
// aggregate entry. No product interval, internal deadline, or retry changes.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runBoundedNodeProof} from './bounded-node-proof.mjs';
const entries=new Map([
 ['static-weekly-fixed-rank-link-ci-tests.mjs',{suite:'static-weekly-fixed-rank-links',checks:79}],
 ['static-weekly-manager-ingress-ci-tests.mjs',{suite:'manager-ingress-called-ci',entries:10}],
]);
const attempted=new Set();
export async function runFreshCurrentOwningEntry(file){
 assert.equal(typeof file,'string');const expected=entries.get(file);
 assert.ok(expected,'only the two fixed process-origin owning entries are supported');
 assert.ok(!attempted.has(file),'an attempted original owning entry is never retried');
 attempted.add(file); // Consume before spawn; failure/UNKNOWN cannot resend.
 const abort=new AbortController(),stop=()=>abort.abort();
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  const result=await runBoundedNodeProof({args:['--max-old-space-size=128','--max-semi-space-size=8',
   '--input-type=module','-e',`await import(${JSON.stringify(new URL('./'+file,import.meta.url).href)});`],
   cwd:fileURLToPath(new URL('../',import.meta.url)),absoluteMilliseconds:60000,
   cleanupReserveMilliseconds:5000,maxBuffer:1024*1024,signal:abort.signal});
  process.stdout.write(result.stdout);process.stderr.write(result.stderr);
  const receipt=JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(receipt.suite,expected.suite);assert.equal(receipt.status,'PASS');
  if(expected.checks!==undefined)assert.equal(receipt.checks,expected.checks);
  if(expected.entries!==undefined)assert.equal(receipt.entries,expected.entries);
  assert.equal(result.receipt.groupAbsent,true);
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
