// Exact CI execution-layout successor. No command, SQL or resource check omitted.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const priorFoundationWorkflowSha='4ff403c1cc51c42224d6ab3807b7d9cea8f60d03b263262b4bdb216ea2232ad7';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function retainedFoundationWorkflow(){
 const source=readFileSync(new URL('../release/foundation-ci-workflow-source/'+priorFoundationWorkflowSha+'.yml',import.meta.url),'utf8');
 assert.equal(sha(source),priorFoundationWorkflowSha);return source;
}
export function splitFoundationWorkflow(source){
 assert.equal(typeof source,'string');assert.equal(sha(source),priorFoundationWorkflowSha,'Whole reviewed previous workflow required');
 const once=value=>{const start=source.indexOf(value);assert.ok(start>=0&&source.indexOf(value,start+value.length)<0);return start;};
 const tailStart=once('          # This starts only disposable worker-owned PostgreSQL containers and\n');
 const tailEnd=source.indexOf('      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1\n');assert.ok(tailEnd>tailStart);
 const tail=source.slice(tailStart,tailEnd);
 assert.ok(tail.includes('run-sealed-legacy-scheduler-database-tests.mjs --integrated-suite-order\n'));
 assert.ok(tail.includes('run-retained-release-provenance-tests.mjs\n'));
 assert.ok(tail.endsWith('          npm run --silent test:isolated-restore-lease-shim\n'));
 const stepsStart=once('    steps:\n')+'    steps:\n'.length;
 const stepsEnd=once('      - name: Reviewed phone, pair, and isolated recorder regressions\n');
 const initialSteps=source.slice(stepsStart,stepsEnd);
 const provisioning=source.slice(once('      - name: Provision exact selected fresh PostgreSQL image\n'),once('      - name: Authentication and integration contracts\n'));
 const scriptStart=once('      - name: Authentication and integration contracts\n        run: |\n')+'      - name: Authentication and integration contracts\n        run: |\n'.length;
 const scriptEnd=once('          npm run --silent test:ci-workflows\n');
 const parent='ci_sql_parent="/mnt/custodial-sql-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"';
 const prologue=source.slice(scriptStart,scriptEnd);assert.equal(prologue.split(parent).length,2);
 const distinctPrologue=prologue.replace(parent,'ci_sql_parent="/mnt/custodial-sql-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-remaining"');
 const failureName=once('          name: ci-fresh-only-failure-evidence-${{ github.run_id }}\n');
 const failureStart=source.lastIndexOf('      - uses:',failureName),failureEnd=source.indexOf('      - uses:',failureName);
 assert.ok(failureStart>tailEnd&&failureEnd>failureStart);
 const failureArtifact=source.slice(failureStart,failureEnd).replace('name: ci-fresh-only-failure-evidence-${{ github.run_id }}','name: ci-fresh-only-failure-evidence-${{ github.run_id }}-remaining');
 const routing=source.split('\n').find(line=>line.startsWith('    runs-on: '));assert.ok(routing);
 const layoutCheck='      - name: Verify exact Foundation phase layout\n        run: node scripts/foundation-ci-split-layout-tests.mjs\n';
 const addition='\n  remaining_contracts:\n    needs: validate\n'+routing+'\n    timeout-minutes: 60\n    steps:\n'+initialSteps+layoutCheck+provisioning+
  '      - name: Retained scheduler SQL and release closure contracts\n        run: |\n'+distinctPrologue+tail+failureArtifact;
 const main=(source.slice(0,tailStart)+source.slice(tailEnd)).replace('      - name: Reviewed phone, pair, and isolated recorder regressions\n',layoutCheck+'      - name: Reviewed phone, pair, and isolated recorder regressions\n');
 return (main+addition).trimEnd()+'\n';
}
export function restoreSplitFoundationWorkflow(source,name){
 if(name!=='foundation-security-gate.yml')return source;
 const prior=retainedFoundationWorkflow(),expected=splitFoundationWorkflow(prior);
 if(sha(source)!==sha(expected))return source;
 assert.equal(source,expected);return prior;
}
