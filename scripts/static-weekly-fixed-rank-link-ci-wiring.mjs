import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {reverseFixedRankLinks} from './static-weekly-fixed-rank-link-tests.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const statement="await import('./static-weekly-fixed-rank-link-ci-tests.mjs');";
const pins={
 'src/static-weekly-schedule-program.js':'1a5ef78107964d823f1a1eaf617b9d5e439339122730ac4691bd671199a4da52',
 'scripts/static-weekly-fixed-rank-link-tests.mjs':'99386765ad249eb7005dfd5c89e0bf8505a459a05835db40db79499eff635531',
};
// Only old representation-test inputs are reconstructed. The executing
// product retains the changed model and the current absolute60s deadline.
export function restoreFixedRankProgramForRetainedProof(source){return reverseFixedRankLinks(source);}
const expectedWrapper=`import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {runBoundedNodeProof} from './bounded-node-proof.mjs';
const deadline=performance.now()-process.uptime()*1000+60000;
const budget=Math.floor(deadline-performance.now())-1000;
assert.ok(budget>5000&&budget<=60000);
const result=await runBoundedNodeProof({args:['--max-old-space-size=128','--max-semi-space-size=8','--wasm-max-mem-pages=1536','--stack-size=4096','scripts/static-weekly-fixed-rank-link-tests.mjs'],absoluteMilliseconds:budget,cleanupReserveMilliseconds:5000});
const receipt=JSON.parse(result.stdout.trim().split('\\n').at(-1));
assert.equal(receipt.status,'PASS');
assert.equal(receipt.checks,79);
assert.equal(receipt.completeTruthCases,16584);
assert.equal(receipt.actualPrivateCaptureChecked,false);
for(const field of ['solver','engine','publication','independentlyProvesOptimality'])assert.equal(receipt[field],false);
assert.equal(receipt.allocationBenefitUnmeasured,true);
assert.ok(performance.now()<deadline);
console.log(JSON.stringify({suite:'static-weekly-fixed-rank-links',...receipt}));
`;
function validate(source,wrapper,files){
 const lines=source.split('\n');assert.equal(lines.filter(line=>line===statement).length,1);
 assert.equal(lines.filter(line=>/^await import\(/.test(line)).length,55);
 const prior=lines.filter(line=>line!==statement).join('\n').replace('55 explicit owning suites','54 explicit owning suites');
 assert.equal(sha(prior),'8004a8cc335a05b55f4974b97d32aae42a20be1d22c6b3e44211573aa31e80d3','exact prior54 entries and terminal');
 assert.equal(wrapper,expectedWrapper,'mandatory called79 proof with original process-origin deadline');
 assert.deepEqual(Object.keys(files).sort(),Object.keys(pins).sort());
 for(const[path,pin]of Object.entries(pins))assert.equal(sha(files[path]),pin,path);
 assert.equal(sha(restoreFixedRankProgramForRetainedProof(files['src/static-weekly-schedule-program.js'])),'b2e70ef652ec4aef05252d1890136f9fa66a5fa2ac97aba40d6b76d0815be068');
 return prior;
}
export function verifyFixedRankLinkWiring(source,root){
 const wrapper=readFileSync(resolve(root,'scripts/static-weekly-fixed-rank-link-ci-tests.mjs'),'utf8');
 const files=Object.fromEntries(Object.keys(pins).map(path=>[path,readFileSync(resolve(root,path),'utf8')]));
 const prior=validate(source,wrapper,files);let rejected=0;
 for(const replacement of ['',`// ${statement}`,statement+'\n'+statement,`if(false){${statement}}`,statement.replace('await ',''),statement.replace(');',').catch(()=>{});')]){assert.throws(()=>validate(source.replace(statement,replacement),wrapper,files));rejected++;}
 for(const[from,to]of [['process.uptime()*1000','0'],['+60000','+315000'],['receipt.checks,79','receipt.checks,0'],['receipt.completeTruthCases,16584','receipt.completeTruthCases,0'],['receipt.actualPrivateCaptureChecked,false','receipt.actualPrivateCaptureChecked,true'],['await runBoundedNodeProof','runBoundedNodeProof']]){
  const changed=wrapper.replace(from,to);assert.notEqual(changed,wrapper);assert.throws(()=>validate(source,changed,files));rejected++;
 }
 for(const path of Object.keys(files)){assert.throws(()=>validate(source,wrapper,{...files,[path]:files[path]+'\n// drift\n'}));rejected++;}
 assert.equal(rejected,14);console.log('Fixed-rank links wiring PASS:14 execution/deadline/source mutants; exact prior54 retained');return prior;
}
