import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const statement="await import('./static-weekly-operation-deadline-ci-tests.mjs');";
const pins={
 'scripts/static-weekly-operation-deadline-tests.mjs':'56adda352e4cd0ace45b8379da563d875a2c1d5765a9e2fc095072c929399eaf',
 'scripts/static-weekly-recurring-morning-integration-tests.mjs':'9a904f68f802ffc62569c197c82b76522d1d258621fd8104b6be4518182f97ff',
 'src/static-weekly-schedule-program.js':'b2e70ef652ec4aef05252d1890136f9fa66a5fa2ac97aba40d6b76d0815be068',
};
function validate(source,wrapper,files){
 const lines=source.split('\n');assert.equal(lines.filter(x=>x===statement).length,1);
 assert.equal(lines.filter(x=>/^await import\(/.test(x)).length,52);
 const prior=lines.filter(x=>x!==statement).join('\n').replace('52 explicit owning suites','51 explicit owning suites');
 assert.equal(sha(prior),'d6541e8727b85687aaa7ac974ad550c2a1cefa5136f2772342af00d6cf64b0cf','exact prior51 sequence and terminal retained');
 assert.deepEqual(Object.keys(files).sort(),Object.keys(pins).sort());for(const[name,pin]of Object.entries(pins))assert.equal(sha(files[name]),pin,name);
 assert.equal(wrapper,"import assert from 'node:assert/strict';\nimport {runStaticWeeklyOperationDeadlineTests} from './static-weekly-operation-deadline-tests.mjs';\nconst receipt=await runStaticWeeklyOperationDeadlineTests();\nassert.equal(receipt.status,'PASS');\nassert.equal(receipt.checks,65);\nassert.equal(receipt.absoluteMilliseconds,60000);\nassert.equal(receipt.actual_solver,false);\nassert.equal(receipt.actual_private_preview,false);\nassert.equal(receipt.correctness_or_optimality_changed,false);\nconsole.log(JSON.stringify({suite:'static-weekly-operation-deadline',...receipt}));\n");
 return prior;
}
export function verifyOperationDeadlineWiring(source,root){
 const wrapper=readFileSync(resolve(root,'scripts/static-weekly-operation-deadline-ci-tests.mjs'),'utf8');
 const files=Object.fromEntries(Object.keys(pins).map(p=>[p,readFileSync(resolve(root,p),'utf8')]));
 const prior=validate(source,wrapper,files);let hostile=0;
 for(const replacement of ['',`// ${statement}`,statement+'\n'+statement,`if(false){${statement}}`,statement.replace('await ',''),statement.replace(');',').catch(()=>{});')]){assert.throws(()=>validate(source.replace(statement,replacement),wrapper,files));hostile++;}
 for(const[from,to]of [['await runStaticWeeklyOperationDeadlineTests()','{}'],['receipt.checks,65','receipt.checks,0'],['receipt.absoluteMilliseconds,60000','receipt.absoluteMilliseconds,315000'],['receipt.actual_solver,false','receipt.actual_solver,true']]){assert.throws(()=>validate(source,wrapper.replace(from,to),files));hostile++;}
 for(const p of Object.keys(files)){assert.throws(()=>validate(source,wrapper,{...files,[p]:files[p]+'\n// unbound\n'}));hostile++;}
 assert.equal(hostile,13);console.log('Absolute operation deadline wiring PASS: 13 omission/execution/source mutants rejected; prior51 guards preserved');return prior;
}
