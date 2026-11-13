// Execute current owning regressions before allowing the old auth wiring view.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyCurrentDepartureProofInputs} from './fixtures/current-departure-source-successor.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
verifyCurrentDepartureProofInputs(root);
const tests=['scripts/employee-events-bigint-auth-tests.mjs','scripts/local-enrollment-retention-tests.mjs','scripts/separation-auth-admission-source-tests.mjs','scripts/request-json-parser-native-inventory-tests.mjs','scripts/request-json-parser-scan-completion-tests.mjs','scripts/request-json-parser-inventory-manager-tests.mjs'];
const result=spawnSync(process.execPath,['--test',...tests],{cwd:root,env:{PATH:process.env.PATH,LANG:'C.UTF-8'},encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});
assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stdout+result.stderr);
assert.match(result.stdout,/# fail 0\b/);
console.log(JSON.stringify({suite:'current-device-auth-and-parser-owning',status:'PASS',current_suites:6,actual_current_auth:true,synthetic_SQL_and_stores:true,SQL_executed:false,runtime_admission:false,phone:false}));
