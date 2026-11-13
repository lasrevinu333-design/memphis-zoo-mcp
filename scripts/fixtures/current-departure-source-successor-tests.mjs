import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readCurrentDepartureProofInputs,validateCurrentDepartureProofInputs,restoreCurrentDepartureProofSource} from './current-departure-source-successor.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),files=readCurrentDepartureProofInputs(root);
const receipt=validateCurrentDepartureProofInputs(files);let rejected=0;
for(const path of Object.keys(files)){
 const omitted={...files};delete omitted[path];assert.throws(()=>validateCurrentDepartureProofInputs(omitted));rejected++;
 assert.throws(()=>validateCurrentDepartureProofInputs({...files,[path]:files[path]+'\n// unreviewed drift\n'}));rejected++;
}
assert.throws(()=>restoreCurrentDepartureProofSource('src/unknown.js',''));rejected++;
const wrapper='scripts/native-schedule-source-ci-tests.mjs',call='await runNativeDepartureCurrentCiTests()';
const changes=[
 [call,'runNativeDepartureCurrentCiTests()'],
 [call,"await runNativeDepartureCurrentCiTests().catch(()=>({status:'PASS'}))"],
 [call,"{status:'PASS',checks:390,retained_sql_cases:37,actual_current_modules:true,actual_HTTP_cases:37,retained_SQL_evidence_only:true,new_SQL:false,provider_dispatch:false,clock_qualified:false,audio_qualified:false,worker_activated:false,phone:false}"],
 [call,'await runNativeDepartureCurrentCiTests(); await runNativeDepartureCurrentCiTests()'],
 ["import {runNativeDepartureCurrentCiTests} from './native-departure-current-ci-tests.mjs';",'// removed owning import'],
 ["assert.equal(departureReceipt.status,'PASS');",'// removed status guard'],
 ['departureReceipt.checks,390','departureReceipt.checks,0'],
 ['departureReceipt.actual_current_modules,true','departureReceipt.actual_current_modules,false'],
 ['departureReceipt.retained_SQL_evidence_only,true','departureReceipt.retained_SQL_evidence_only,false'],
 ["for(const field of ['new_SQL','provider_dispatch','clock_qualified','audio_qualified','worker_activated','phone'])assert.equal(departureReceipt[field],false);",'// removed admission scope'],
];
for(const[from,to]of changes){const changed=files[wrapper].replace(from,to);assert.notEqual(changed,files[wrapper]);assert.throws(()=>validateCurrentDepartureProofInputs({...files,[wrapper]:changed}));rejected++;}
console.log(JSON.stringify({suite:'current-departure-source-successor',...receipt,rejected,old_pins_rewritten:false,SQL_executed:false,build:false,phone:false}));
