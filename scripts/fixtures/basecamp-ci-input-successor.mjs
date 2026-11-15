import{restoreResourceObservationWorkflow}from'./resource-observation-r44-source.mjs';
import{restoreManualDeliveryWorkflow,isManualDeliveryWorkflow,manualDeliveryPackagePins}from'./manual-delivery-ci-input-successor.mjs';
import {restoreDependencyPackage,restoreDependencyWorkflow} from './dependency-repair-r44-source.mjs';
// Exact test-wiring successor only. Historical workflow oracles stay intact.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
const previousPackage='edf046bfee522838fc0d4a48fef82862865debf705e3d96a4d04e89d29506bcc';
const currentPackage='08d6de7172c505d5f604f747b8ade0193c2180e4af75fce89b5c21171d234377';
const workflows={'foundation-security-gate.yml': ['d85836fcc0cefadcd3d22751ba44080a9ef94915ec33b46c1233327f61e8239a', '50ff473e92806741673452014374bfc4b84623ae03dcb09e25d8e3417e7ff774'], 'custodial-production-repair.yml': ['3082d5c835c9b7ef499d69f845d2b87b6abb6864b406e64c8c0410b9d36afa67', '2eab0ed3a7b838b3fa592332cb7738034643b41e2b5048952e3ecce7954c1ea7']};
const ownedFoundationChanges=[["          ci_sql_parent=\"/mnt/custodial-sql-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}\"\n          test ! -e \"$ci_sql_parent\"\n          stat -c 'CI_SQL_PATH=%n device=%d mount=%m' /mnt /\n          if [ \"$(stat -c %d /mnt)\" = \"$(stat -c %d /)\" ]; then\n            printf '%s\\n' '::error::Foundation database qualification requires an existing secondary disk. This runner exposes /mnt on its root disk; the guarded local fixture remains available. No root-disk or tmpfs fallback is permitted.' >&2\n            exit 1\n          fi\n          if ! command -v bwrap; then\n            sudo apt-get update -qq\n            sudo apt-get install -y --no-install-recommends bubblewrap\n          fi\n          command -v bwrap\n          sudo install -d -m 0700 -o \"$(id -u)\" -g \"$(id -g)\" \"$ci_sql_parent\"\n", ""], ["          python3 scripts/current-owned-sql-ci-entry.py --consumer manager --runtime \"$ci_sql_parent/manager-runtime\" --evidence \"$RUNNER_TEMP/owned-manager-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}\"\n", "          node scripts/manager-scheduler-database-tests.mjs\n"], ["          npm run --silent test:manager-auth\n          node scripts/map-owner-session-http-tests.mjs\n          node scripts/feedback-acknowledgment-auth-tests.mjs\n          node scripts/static-weekly-control-plane-tests.mjs\n          node scripts/static-weekly-control-plane-runtime-tests.mjs\n          python3 scripts/current-owned-sql-ci-entry.py --consumer owner --runtime \"$ci_sql_parent/owner-runtime\" --evidence \"$RUNNER_TEMP/owned-owner-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}\"\n          node scripts/release-attestation-path-tests.mjs\n          npm run --silent test:custodial-employee-phones\n          node scripts/proxy-address-regression-tests.mjs\n", "          npm run --silent test:owner-access\n"], ["          python3 scripts/current-owned-sql-ci-entry.py --consumer read-only --runtime \"$ci_sql_parent/read-only-runtime\" --evidence \"$RUNNER_TEMP/owned-read-only-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}\"\n", "          npm run --silent test:readonly-database-authority\n"]];
export function currentBasecampCiRegressionView(source){
 const currentPin=isManualDeliveryWorkflow(source,'foundation-security-gate.yml');
 source=restoreManualDeliveryWorkflow(source,'foundation-security-gate.yml');
 source=restoreResourceObservationWorkflow(source);
 for(const [from,to] of ownedFoundationChanges){assert.equal(source.split(from).length,2);source=source.replace(from,()=>to);}
 if(currentPin){const from=manualDeliveryPackagePins.previous+'  package.json';assert.equal(source.split(from).length,2);source=source.replace(from,manualDeliveryPackagePins.current+'  package.json');}
 return source;
}
export function restoreBasecampCiWorkflow(source,name){
 source=restoreDependencyWorkflow(source,name);
 const pair=workflows[name];assert.ok(pair);assert.equal(sha(source),pair[0],'exact Basecamp CI successor workflow');
 const from=currentPackage+'  package.json';assert.equal(source.split(from).length,2);
 let prior=source.replace(from,previousPackage+'  package.json');if(name==='foundation-security-gate.yml')prior=currentBasecampCiRegressionView(prior);assert.equal(sha(prior),pair[1]);return prior;
}
export function verifyBasecampCiPackage(bytes){
 bytes=restoreDependencyPackage(bytes);
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
 const currentWorkflow=readFileSync(resolve(root,'.github/workflows/foundation-security-gate.yml'),'utf8');
 restoreBasecampCiWorkflow(currentWorkflow,'foundation-security-gate.yml');
 const ownerCommands=JSON.parse(bytes).scripts['test:owner-access'].split(' && ');
 const beginning='          '+ownerCommands[0]+'\n',end='          '+ownerCommands.at(-1)+'\n';
 const first=currentWorkflow.indexOf(beginning),last=currentWorkflow.indexOf(end,first)+end.length;
 assert.ok(first>=0&&last>first);
 const actual=currentWorkflow.slice(first,last).trim().split('\n').map(line=>line.trim());
 assert.equal(actual.length,ownerCommands.length);
 assert.equal(actual.filter(line=>line.includes('--consumer owner ')).length,1);
 const projected=actual.map(line=>line.includes('--consumer owner ')?'node scripts/owner-actions-database-tests.mjs':line);
 assert.deepEqual(projected,ownerCommands,'every owning test remains called once in the original order');

 assert.equal(sha(readFileSync(resolve(root,'scripts/current-owned-sql-ci-entry.py'))),'0b04fcd18011062f2c940dcf675fcb4d34466e09dc7b68d0b44428b559b0c989','exact existing owned fixture entry with three admitted Foundation consumers');
 assert.equal(sha(readFileSync(resolve(root,'scripts/basecamp-birthday-work-tests.mjs'))),'cca99c59bc8c64b933d5d4f30b5688947ed3c96d4513d5ba6a55c27da4b36a19');
 for(const change of [p=>{p.scripts['test:reviewed-source-regressions']='true';},p=>{delete p.scripts['test:basecamp-birthday'];},p=>{p.dependencies={};}]){
  const p=JSON.parse(bytes);change(p);assert.throws(()=>verifyBasecampCiPackage(Buffer.from(JSON.stringify(p,null,2)+'\n')));
 }
 console.log(JSON.stringify({suite:'basecamp-ci-input-successor',status:'PASS',rejected:3,dependency_changes:true,dependency_successor:'r44',historical_oracles_preserved:true}));
}

// Historical inventory views retain the entire prior verifier, including every
// prior checksum, suite, negative mutation and shell guard. Only this exact
// additive qualification successor may be projected for that comparison.
export function restoreBasecampCiProofSource(path,source){
 if(path!=='scripts/fixtures/current-foundation-source-successor.mjs')return source;
 if(sha(source)!=='479a66108e16da5e0162e5437d29c1a3d67d65d0d1a7bc89b12fe58ed99ff520')return source; // Unknown bytes stay unknown to the original exact guard.
 for(const hunk of [
  "import {restoreBasecampCiWorkflow,verifyBasecampCiInputs,currentBasecampCiRegressionView} from './basecamp-ci-input-successor.mjs';\n",
  " source=restoreBasecampCiWorkflow(source,'foundation-security-gate.yml');\n",
  " source=restoreBasecampCiWorkflow(source,'custodial-production-repair.yml');\n",
  " verifyBasecampCiInputs(root);\n",
  "  'scripts/basecamp-birthday-work-tests.mjs':'cca99c59bc8c64b933d5d4f30b5688947ed3c96d4513d5ba6a55c27da4b36a19',\n",
 ]){assert.equal(source.split(hunk).length,2);source=source.replace(hunk,'');}
 source=source.replace("return currentBasecampCiRegressionView(source).replace(added,'');","return source.replace(added,'');");
 assert.equal(source.split('current_source_suites:4').length,2);source=source.replace('current_source_suites:4','current_source_suites:3');
 assert.equal(sha(source),'5bae72c4ba761556ff06b177e64bd293affd5fbebe51d8d464e15453c59fdd66');return source;
}
