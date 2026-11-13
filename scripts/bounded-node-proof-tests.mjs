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
// Failure output is DATA retained on the same rejected result, never a pass.
// Use only synthetic bounded children; no solver/worker/SQL/network ports.
const retainedOut='native synthetic stdout α\n'+'O'.repeat(128*1024)+'\nOUT_FINAL';
const retainedErr='FIRST_SYNTHETIC_ASSERTION: wrong original\n'+'E'.repeat(96*1024)+'\nERR_FINAL';
for(const terminal of ['nonzero','signal','timeout']) {
 const end=terminal==='nonzero'?'process.exit(7)':terminal==='signal'?'process.kill(process.pid,"SIGTERM")':'setInterval(()=>{},1000)';
 const child=`process.stdout.write("native synthetic stdout α\\n"+"O".repeat(128*1024)+"\\nOUT_FINAL",()=>process.stderr.write("FIRST_SYNTHETIC_ASSERTION: wrong original\\n"+"E".repeat(96*1024)+"\\nERR_FINAL",()=>{${end}}));`;
 let failure;try{await runBoundedNodeProof({...small,args:['-e',child],maxBuffer:256*1024});}catch(error){failure=error;}
 assert.equal(failure?.code,'bounded_node_proof_failed');checks++;
 assert.equal(failure.stdout,retainedOut);checks++;
 assert.equal(failure.stderr,retainedErr);checks++;
 assert.deepEqual(failure.outputTruncated,{stdout:false,stderr:false});checks++;
 assert.equal(failure.receipt.outputBytes,Buffer.byteLength(retainedOut));checks++;
 assert.equal(failure.receipt.errorBytes,Buffer.byteLength(retainedErr));checks++;
 assert(failure.message.endsWith('child_stderr_first_4096_chars:\n'+retainedErr.slice(0,4096)));checks++;
 assert(failure.message.length<4200);checks++;
 assert(failure.receipt.groupAbsent&&!failure.receipt.passed&&failure.receipt.elapsedMs<=1000);checks++;
 if(terminal==='nonzero')assert.deepEqual(failure.receipt.terminal,{code:7,signal:null});
 else if(terminal==='signal')assert.deepEqual(failure.receipt.terminal,{code:null,signal:'SIGTERM'});
 else assert.equal(failure.receipt.reason,'absolute_work_cutoff');checks++;
}
let stdoutFailure;
try{await runBoundedNodeProof({...small,args:['-e','process.stdout.write("ONLY_STDOUT_ORIGINAL",()=>process.exit(9))']});}catch(error){stdoutFailure=error;}
assert.equal(stdoutFailure.stdout,'ONLY_STDOUT_ORIGINAL');checks++;
assert.equal(stdoutFailure.stderr,'');checks++;
assert.match(stdoutFailure.message,/child_stdout_first_4096_chars:\nONLY_STDOUT_ORIGINAL$/);checks++;
let overflowFailure;
try{await runBoundedNodeProof({...small,args:['-e','process.stdout.write("X".repeat(4096));setInterval(()=>{},1000)'],maxBuffer:32});}catch(error){overflowFailure=error;}
assert.equal(overflowFailure.receipt.reason,'stdout_limit');checks++;
assert.deepEqual(overflowFailure.outputTruncated,{stdout:true,stderr:false});checks++;
assert(Buffer.byteLength(overflowFailure.stdout)<=32);checks++;
assert(overflowFailure.receipt.groupAbsent&&!overflowFailure.receipt.passed);checks++;
const successPair=await runBoundedNodeProof({...small,args:['-e','process.stdout.write("SUCCESS_OUT",()=>process.stderr.write("SUCCESS_ERR"))']});
assert.deepEqual(Object.keys(successPair),['stdout','stderr','receipt']);checks++;
assert.equal(successPair.stdout,'SUCCESS_OUT');checks++;
assert.equal(successPair.stderr,'SUCCESS_ERR');checks++;
assert(successPair.receipt.passed&&successPair.receipt.groupAbsent);checks++;
console.log(JSON.stringify({status:'PASS',checks,actualEngine:false,actualChildCases:receipts.length,
 allGroupsAbsent:true,absoluteUserMaximum:60000,timeoutRemainsFailure:true}));
