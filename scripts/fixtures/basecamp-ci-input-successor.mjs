// Exact test-wiring successor only. Historical workflow oracles stay intact.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
const previousPackage='edf046bfee522838fc0d4a48fef82862865debf705e3d96a4d04e89d29506bcc';
const currentPackage='08d6de7172c505d5f604f747b8ade0193c2180e4af75fce89b5c21171d234377';
const workflows={'foundation-security-gate.yml': ['7d1c0af6dfd18e1cd5f35f601932b5c4ed2edb4bfa14fb23ebc644752039fce3', '50ff473e92806741673452014374bfc4b84623ae03dcb09e25d8e3417e7ff774'], 'custodial-production-repair.yml': ['3082d5c835c9b7ef499d69f845d2b87b6abb6864b406e64c8c0410b9d36afa67', '2eab0ed3a7b838b3fa592332cb7738034643b41e2b5048952e3ecce7954c1ea7']};
export function restoreBasecampCiWorkflow(source,name){
 const pair=workflows[name];assert.ok(pair);assert.equal(sha(source),pair[0],'exact Basecamp CI successor workflow');
 const from=currentPackage+'  package.json';assert.equal(source.split(from).length,2);
 const prior=source.replace(from,previousPackage+'  package.json');assert.equal(sha(prior),pair[1]);return prior;
}
export function verifyBasecampCiPackage(bytes){
 assert.equal(sha(bytes),currentPackage,'current package is exact reviewed Basecamp test wiring');
 const p=JSON.parse(bytes),scripts=p.scripts;
 assert.equal(scripts['test:basecamp-birthday'],'node --test scripts/basecamp-birthday-work-tests.mjs');
 const suffix=' && npm run --silent test:basecamp-birthday';
 assert.ok(scripts['test:static-weekly-scheduler:fast'].endsWith(suffix));
 scripts['test:static-weekly-scheduler:fast']=scripts['test:static-weekly-scheduler:fast'].slice(0,-suffix.length);
 delete scripts['test:basecamp-birthday'];
 assert.equal(sha(JSON.stringify(p,null,2)+'\n'),previousPackage,'all previous dependencies and commands remain exact');
}
export function verifyBasecampCiInputs(root){
 const bytes=readFileSync(resolve(root,'package.json'));verifyBasecampCiPackage(bytes);
 assert.equal(sha(readFileSync(resolve(root,'scripts/basecamp-birthday-work-tests.mjs'))),'cca99c59bc8c64b933d5d4f30b5688947ed3c96d4513d5ba6a55c27da4b36a19');
 for(const change of [p=>{p.scripts['test:reviewed-source-regressions']='true';},p=>{delete p.scripts['test:basecamp-birthday'];},p=>{p.dependencies={};}]){
  const p=JSON.parse(bytes);change(p);assert.throws(()=>verifyBasecampCiPackage(Buffer.from(JSON.stringify(p,null,2)+'\n')));
 }
 console.log(JSON.stringify({suite:'basecamp-ci-input-successor',status:'PASS',rejected:3,dependency_changes:false,historical_oracles_preserved:true}));
}

// Historical inventory views retain the entire prior verifier, including every
// prior checksum, suite, negative mutation and shell guard. Only this exact
// additive qualification successor may be projected for that comparison.
export function restoreBasecampCiProofSource(path,source){
 if(path!=='scripts/fixtures/current-foundation-source-successor.mjs')return source;
 if(sha(source)!=='63b0bc1846c7a7742e0eb4374b0c34da9a36586fc27c8bf8eb9ba0dcaad50dea')return source; // Unknown bytes stay unknown to the original exact guard.
 for(const hunk of [
  "import {restoreBasecampCiWorkflow,verifyBasecampCiInputs} from './basecamp-ci-input-successor.mjs';\n",
  " source=restoreBasecampCiWorkflow(source,'foundation-security-gate.yml');\n",
  " source=restoreBasecampCiWorkflow(source,'custodial-production-repair.yml');\n",
  " verifyBasecampCiInputs(root);\n",
  "  'scripts/basecamp-birthday-work-tests.mjs':'cca99c59bc8c64b933d5d4f30b5688947ed3c96d4513d5ba6a55c27da4b36a19',\n",
 ]){assert.equal(source.split(hunk).length,2);source=source.replace(hunk,'');}
 assert.equal(source.split('current_source_suites:4').length,2);source=source.replace('current_source_suites:4','current_source_suites:3');
 assert.equal(sha(source),'5bae72c4ba761556ff06b177e64bd293affd5fbebe51d8d464e15453c59fdd66');return source;
}
