// Source representation only: normalize the exact reviewed diagnostic tail
// and appended synthetic cases to the original pinned lifecycle proof. This
// never executes archived Source or accepts arbitrary helper/timer changes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const profiles={
  "bounded-node-proof.mjs": {
    "current_sha256": "0538d21de5325e9c8501d3fd941c929753ee3daa2f125e138ae0fc89f97c28b6",
    "prior_sha256": "fc0443523fa3d0a79c053ead70120126e17b5ca59d2170fba8103cf9006dd7a6",
    "changes": [
      {
        "current": " const stdout=Buffer.concat(output).toString('utf8'),stderr=Buffer.concat(errors).toString('utf8');\n if(!receipt.passed){\n  // Preserve all admitted bytes, including nonzero/timeout/signal failures.\n  // The existing maxBuffer still stops overflow; do not label dropped bytes\n  // complete. Keep only a bounded first diagnostic in the ordinary error log.\n  const stream=stderr?'stderr':stdout?'stdout':null;\n  const diagnostic=stream?`\\nchild_${stream}_first_4096_chars:\\n${(stderr||stdout).slice(0,4096)}`:'';\n  const error=new Error('bounded_node_proof_failed:'+String(reason||spawnError?.code||terminal?.signal||terminal?.code||'unsettled')+diagnostic);\n  error.code='bounded_node_proof_failed';error.receipt=receipt;\n  Object.defineProperties(error,{\n   stdout:{value:stdout},stderr:{value:stderr},\n   outputTruncated:{value:Object.freeze({stdout:outputBytes>maxBuffer,stderr:errorBytes>maxBuffer})},\n  });\n  throw error;\n }\n return{stdout,stderr,receipt};\n}\n",
        "prior": " if(!receipt.passed){const error=new Error('bounded_node_proof_failed:'+String(reason||spawnError?.code||terminal?.signal||terminal?.code||'unsettled'));\n  error.code='bounded_node_proof_failed';error.receipt=receipt;throw error;}\n return{stdout:Buffer.concat(output).toString('utf8'),stderr:Buffer.concat(errors).toString('utf8'),receipt};\n}\n"
      }
    ]
  },
  "bounded-node-proof-tests.mjs": {
    "current_sha256": "dc25571fc845501707e02e2b0fa516e160fb8946137ec0579c739568f8fe1632",
    "prior_sha256": "d70644f4e3453b6588fc14dde91acf33f5a7e294a9f361332049c199b09afea6",
    "changes": [
      {
        "current": "// Failure output is DATA retained on the same rejected result, never a pass.\n// Use only synthetic bounded children; no solver/worker/SQL/network ports.\nconst retainedOut='native synthetic stdout \u03b1\\n'+'O'.repeat(128*1024)+'\\nOUT_FINAL';\nconst retainedErr='FIRST_SYNTHETIC_ASSERTION: wrong original\\n'+'E'.repeat(96*1024)+'\\nERR_FINAL';\nfor(const terminal of ['nonzero','signal','timeout']) {\n const end=terminal==='nonzero'?'process.exit(7)':terminal==='signal'?'process.kill(process.pid,\"SIGTERM\")':'setInterval(()=>{},1000)';\n const child=`process.stdout.write(\"native synthetic stdout \u03b1\\\\n\"+\"O\".repeat(128*1024)+\"\\\\nOUT_FINAL\",()=>process.stderr.write(\"FIRST_SYNTHETIC_ASSERTION: wrong original\\\\n\"+\"E\".repeat(96*1024)+\"\\\\nERR_FINAL\",()=>{${end}}));`;\n let failure;try{await runBoundedNodeProof({...small,args:['-e',child],maxBuffer:256*1024});}catch(error){failure=error;}\n assert.equal(failure?.code,'bounded_node_proof_failed');checks++;\n assert.equal(failure.stdout,retainedOut);checks++;\n assert.equal(failure.stderr,retainedErr);checks++;\n assert.deepEqual(failure.outputTruncated,{stdout:false,stderr:false});checks++;\n assert.equal(failure.receipt.outputBytes,Buffer.byteLength(retainedOut));checks++;\n assert.equal(failure.receipt.errorBytes,Buffer.byteLength(retainedErr));checks++;\n assert(failure.message.endsWith('child_stderr_first_4096_chars:\\n'+retainedErr.slice(0,4096)));checks++;\n assert(failure.message.length<4200);checks++;\n assert(failure.receipt.groupAbsent&&!failure.receipt.passed&&failure.receipt.elapsedMs<=1000);checks++;\n if(terminal==='nonzero')assert.deepEqual(failure.receipt.terminal,{code:7,signal:null});\n else if(terminal==='signal')assert.deepEqual(failure.receipt.terminal,{code:null,signal:'SIGTERM'});\n else assert.equal(failure.receipt.reason,'absolute_work_cutoff');checks++;\n}\nlet stdoutFailure;\ntry{await runBoundedNodeProof({...small,args:['-e','process.stdout.write(\"ONLY_STDOUT_ORIGINAL\",()=>process.exit(9))']});}catch(error){stdoutFailure=error;}\nassert.equal(stdoutFailure.stdout,'ONLY_STDOUT_ORIGINAL');checks++;\nassert.equal(stdoutFailure.stderr,'');checks++;\nassert.match(stdoutFailure.message,/child_stdout_first_4096_chars:\\nONLY_STDOUT_ORIGINAL$/);checks++;\nlet overflowFailure;\ntry{await runBoundedNodeProof({...small,args:['-e','process.stdout.write(\"X\".repeat(4096));setInterval(()=>{},1000)'],maxBuffer:32});}catch(error){overflowFailure=error;}\nassert.equal(overflowFailure.receipt.reason,'stdout_limit');checks++;\nassert.deepEqual(overflowFailure.outputTruncated,{stdout:true,stderr:false});checks++;\nassert(Buffer.byteLength(overflowFailure.stdout)<=32);checks++;\nassert(overflowFailure.receipt.groupAbsent&&!overflowFailure.receipt.passed);checks++;\nconst successPair=await runBoundedNodeProof({...small,args:['-e','process.stdout.write(\"SUCCESS_OUT\",()=>process.stderr.write(\"SUCCESS_ERR\"))']});\nassert.deepEqual(Object.keys(successPair),['stdout','stderr','receipt']);checks++;\nassert.equal(successPair.stdout,'SUCCESS_OUT');checks++;\nassert.equal(successPair.stderr,'SUCCESS_ERR');checks++;\nassert(successPair.receipt.passed&&successPair.receipt.groupAbsent);checks++;\n",
        "prior": ""
      }
    ]
  }
};
export function restoreBoundedFailureOutputSource(source,file){
 const profile=profiles[file];assert(profile,'fixed bounded diagnostic Source only');
 assert.equal(sha(source),profile.current_sha256,'exact current diagnostic Source: '+file);
 let prior=source;
 for(const change of profile.changes){assert.equal(prior.split(change.current).length,2,'unique diagnostic-only reversal');prior=prior.replace(change.current,change.prior);}
 assert.equal(sha(prior),profile.prior_sha256,'whole original bounded lifecycle Source: '+file);
 return prior;
}
