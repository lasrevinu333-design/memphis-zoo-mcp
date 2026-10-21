import assert from 'node:assert/strict';
import {runBoundedNodeProof} from './bounded-node-proof.mjs';
let checks=0;
const receipts=[],small={absoluteMilliseconds:1000,cleanupReserveMilliseconds:250,termGraceMilliseconds:40,onReceipt:r=>receipts.push(r)};
const success=await runBoundedNodeProof({...small,args:['-e','process.stdout.write(JSON.stringify({passed:true}))']});
assert.deepEqual(JSON.parse(success.stdout),{passed:true});checks++;
assert(success.receipt.groupAbsent&&success.receipt.passed);checks++;
for(const entry of [
 {args:['-e','process.exit(7)'],pattern:/7/},
 {args:['-e','process.stdout.write("X".repeat(4096));setInterval(()=>{},1000)'],maxBuffer:32,pattern:/stdout_limit/},
 {args:['-e','process.stderr.write("X".repeat(4096));setInterval(()=>{},1000)'],maxBuffer:32,pattern:/stderr_limit/},
 {args:['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],pattern:/absolute_work_cutoff/},
 {args:['-e','setInterval(()=>process.stdout.write("heartbeat\\n"),20)'],pattern:/absolute_work_cutoff/},
]){
 let failure;try{await runBoundedNodeProof({...small,...entry});}catch(e){failure=e;}
 assert.equal(failure?.code,'bounded_node_proof_failed');checks++;assert.match(failure.message,entry.pattern);checks++;
 assert(failure.receipt.groupAbsent&&!failure.receipt.passed);checks++;assert(failure.receipt.elapsedMs<=1000);checks++;
}
const controller=new AbortController();const abortTimer=setTimeout(()=>controller.abort(),60);
try{await assert.rejects(runBoundedNodeProof({...small,args:['-e','setInterval(()=>{},1000)'],signal:controller.signal}),e=>{
 assert(e.receipt.groupAbsent&&e.receipt.aborted&&!e.receipt.passed);checks++;return true;});checks++;}finally{clearTimeout(abortTimer);}
const before=receipts.length,already=new AbortController();already.abort();
await assert.rejects(runBoundedNodeProof({...small,args:['-e','throw Error("must not execute")'],signal:already.signal}),e=>{
 assert.equal(e.receipt.pid,null);checks++;assert.equal(e.receipt.reason,'aborted_before_spawn');checks++;return true;});checks++;
assert.equal(receipts.length,before+1);checks++;
for(const mutate of [{absoluteMilliseconds:60001},{cleanupReserveMilliseconds:1000},{termGraceMilliseconds:250}]){
 await assert.rejects(runBoundedNodeProof({...small,...mutate,args:[]}));checks++;
}
assert.equal(receipts.every(r=>r.groupAbsent),true);checks++;
const large=await runBoundedNodeProof({...small,args:['-e','process.stdout.write("x".repeat(128*1024)+"FINAL_MARKER")'],maxBuffer:256*1024});
assert.equal(large.stdout.length,128*1024+12);checks++;
assert(large.stdout.endsWith('FINAL_MARKER'));checks++;
console.log(JSON.stringify({status:'PASS',checks,actualEngine:false,actualChildCases:receipts.length,
 allGroupsAbsent:true,absoluteUserMaximum:60000,timeoutRemainsFailure:true}));
