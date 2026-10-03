import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const statement="await import('./native-schedule-source-ci-tests.mjs');";
const hashes={
  'scripts/native-schedule-source-ci-tests.mjs':'ff2845915ed8d5af2bcf70c1e1bc44210372e2f941e5455eae11aa65b38640d6',
  'src/native-schedule-occurrence.js':'05f0a26add5a12f4318495a8ccac3a53727343c8a95d129f39f70a7393ffc1bd',
  'src/native-schedule-preparation.js':'c37f0185dfe25f5cf636515349f44819182637f5dd218445c50511c6e89ac96e',
  'scripts/native-schedule-occurrence-tests.mjs':'627e6708cd9fa0597d368e08e7e7c38955769a5161f167deec75e2ba29fd9618',
  'scripts/native-schedule-dated-reader-tests.mjs':'9e3d54dcbee270f1251862f05c8ebdf0c341d50ae7e9cee628194ad6266adaad',
  'scripts/fixtures/native-schedule-occurrence-source.mjs':'827395b7b2ddd850cee09741879d630adbf4f463de4f47fae08017da538af9d6',
  'scripts/fixtures/native-schedule-dated-reader-source.mjs':'f7fc3353db9bd5fb52a77a85abe0e45d232926464f12d3854c3fd4c19cb13422',
};
const sha=value=>createHash('sha256').update(value).digest('hex');

// Validate the new mandatory called proof, then reconstruct the exact retained
// 50-suite bytes for every pre-existing CI guard. No old guard is relaxed.
function validate(source,files) {
  const lines=source.split('\n');
  assert.equal(lines.filter(line=>line===statement).length,1);
  assert.equal(lines.filter(line=>/^await import\(/.test(line)).length,51);
  assert.equal(lines.filter(line=>line==="console.log('CURRENT_SYSTEM_SOURCE_CONTRACTS_PASS: 51 explicit owning suites; no database/provider/production/phone proof');").length,1);
  const predecessor=lines.filter(line=>line!==statement).join('\n')
    .replace('51 explicit owning suites','50 explicit owning suites');
  assert.equal(sha(predecessor),'c0b62553676a117963ef7e4446291c482e6bab404ea950c5c9ab0782085f40f2',
    'all prior50 owning statements, ordering and terminal bytes remain exact');
  assert.deepEqual(Object.keys(files).sort(),Object.keys(hashes).sort());
  for(const [name,hash] of Object.entries(hashes))assert.equal(sha(files[name]),hash,
    'exact native consumer/352-check fixtures and unsuppressed called wrapper required: '+name);
  return predecessor;
}

export function verifyNativeScheduleSourceWiring(source,root) {
  const files=Object.fromEntries(Object.keys(hashes).map(name=>[name,readFileSync(resolve(root,name),'utf8')]));
  const predecessor=validate(source,files);
  let rejected=0;
  for(const replacement of ['',`// ${statement}`,`${statement}\n${statement}`,
    `if(false) { ${statement} }`,statement.replace(');',').catch(() => {});'),
    statement.replace('await ',''),"await import('./native-schedule-occurrence-tests.mjs');"]){
    const mutant=source.replace(statement,replacement);assert.notEqual(mutant,source);
    assert.throws(()=>validate(mutant,files));rejected++;
  }
  for(const [from,to] of [
    ['51 explicit owning suites','50 explicit owning suites'],
    ["await import('./events-chicago-time-tests.mjs');","await import('./unknown-replacement-tests.mjs');"],
    ["await import('./events-chicago-time-tests.mjs');\nawait import('./messaging-durability-contract-tests.mjs');",
     "await import('./messaging-durability-contract-tests.mjs');\nawait import('./events-chicago-time-tests.mjs');"]]){
    const mutant=source.replace(from,to);assert.notEqual(mutant,source);
    assert.throws(()=>validate(mutant,files));rejected++;
  }
  const wrapper='scripts/native-schedule-source-ci-tests.mjs';
  for(const [from,to] of [
    ['await runNativeScheduleOccurrenceTests()','{status:"PASS",checks:352,original_checks:213,dated_checks:139,sql_executed:false,solver_executed:false,delivery_admitted:false}'],
    ["assert.equal(receipt.status,'PASS');",'// suppressed status'],
    ['receipt.checks,352','receipt.checks,0'],['receipt.original_checks,213','receipt.original_checks,0'],
    ['receipt.dated_checks,139','receipt.dated_checks,0'],['receipt.sql_executed,false','receipt.sql_executed,true'],
    ['receipt.solver_executed,false','receipt.solver_executed,true'],['receipt.delivery_admitted,false','receipt.delivery_admitted,true'],
  ]){
    const changed=files[wrapper].replace(from,to);assert.notEqual(changed,files[wrapper]);
    assert.throws(()=>validate(source,{...files,[wrapper]:changed}));rejected++;
  }
  for(const name of Object.keys(files)){
    assert.throws(()=>validate(source,{...files,[name]:files[name]+'\n// unbound change\n'}));rejected++;
    const missing={...files};delete missing[name];assert.throws(()=>validate(source,missing));rejected++;
  }
  assert.equal(rejected,32);
  console.log('Native SCHEDULE called-source wiring PASS: 32 omission/execution/receipt/source mutations rejected; no SQL or delivery proof');
  return predecessor;
}
