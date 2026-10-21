import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const statement="await import('./native-schedule-source-ci-tests.mjs');";
const hashes={
  'src/manager-notifications.js':'327a2bcd9dd77a2588342ce425623c14bc4562c17a637038c72d291d588446dd',
  'scripts/native-schedule-sender-factory-tests.mjs':'1b5ea8649cbc2d8919f8b612fa2aa44c19841a9dcb58dc626393ef6c3ff55183',
  'src/native-schedule-source-producer.js':'a5ffbb3f816ba32e8bf2e2ab8583786a2983cb0ea7cb43eddaa970c9250828bb',
  'scripts/native-schedule-source-producer-tests.mjs':'c3ffbedf1b27f74ff571df7062d8a5b52118bcf9b517420ceb83b9c0fdf58410',
  'scripts/native-schedule-source-producer-sdk-tests.mjs':'22aed6fba9d43079783e362954473953779bbf4baa3406ef7728309835e7e460',
  'scripts/native-schedule-source-producer-sql-tests.mjs':'4b93034742f1811d76420b598bbd5d0be209f45293a7880fccc4d4d139e31b05',
  'src/native-schedule-source-orchestration.js':'6d68683bf89bb3505ca82a297365d5c6cfac53957f99715fcc9c17bd6109446c',
  'scripts/native-schedule-source-orchestration-tests.mjs':'ebe81f43604ed5ff664ca6a5585befc9333d35f54c8f4e1075176d83edab24ea',
  'scripts/native-schedule-source-orchestration-sql-tests.mjs':'6edd650667af2d6ae61720bae3b237efb5c79b256470f062c286a76032a1476f',
  'supabase/migrations/20261008142316_native_schedule_preparation_source.sql':'266cfdb8e28f87ec5bfe2aa5d62d8cb70375fc219df13602043fe0c0a5d64df0',
  'src/native-schedule-source-discovery.js':'d486ee71f4ca00d6e12a80120dc48664d1339578785a5a20cf4271c0afd7d481',
  'scripts/native-schedule-source-discovery-tests.mjs':'0fad49db213b5a2f94d82d76dd02bc48a0d49268f9460fcbdbb74385d2a6f1a5',
  'scripts/native-schedule-source-discovery-sql-tests.mjs':'1ea3b20a89123b970348b63ab00ae767ac22f412d8820de37f04647bf891af3b',
  'supabase/migrations/20261008135429_native_schedule_source_discovery.sql':'cacc3ca2a86e0028bee8c8013f9e65ee68e96edf78ab0ee0005b2cfdbdb121ce',
  'src/native-schedule-dispatch.js':'80ec4199f56f3cf1de4eeac86057480f7db370d33fb1acf186eb2b3a88e04dab',
  'scripts/native-schedule-dispatch-tests.mjs':'c95dd163de140b86a3daea84c970970e93f2889e7e54a3e29ac17bb3ec02cd62',
  'scripts/native-schedule-sender-sql-tests.mjs':'64384396a5b0df829596365260f3b0c6b6eb7170d8664b172731b97037d1fa72',
  'supabase/migrations/20261008124644_native_schedule_sender_inventory.sql':'5ffae3607b44915187e06a33517b7423965588267eac7927b31e9c53ca02dd6c',
  'src/native-schedule-attempt-lifecycle.js':'5280582d7c954a22f39dfb0d0cd5ac29726ae02686eb19bba4e050f0dec7c572',
  'scripts/native-schedule-attempt-lifecycle-tests.mjs':'37992c39e13b3564cd135075ba21145425a8cb61b397c0571aff45d1ce6775a7',
  'scripts/native-schedule-attempt-sql-tests.mjs':'66585e257722deb9733cb0cd3b15565e9d7ebe9f2f61a5e9600fa0d96398cb19',
  'supabase/migrations/20261008122247_native_schedule_attempt_outcome.sql':'2b547c771f90d95e5fbe68c3f14d787e4115a93311812b61f432e056f12b126e',
  'src/native-schedule-job-preparation.js':'04f41b8d3fe7cb57285ed0b33fa3e84e8ed8a68c8924b77cfce8b28654e6dbec',
  'src/employee-notifications.js':'e2a76f19c8b7c09b1cf95ed9bb0446a7aeee3f18b8edeb23d6d649aaed553c80',
  'scripts/fixtures/qualified-alert-dispatcher.mjs':'7ce56120fd96b73e65e2e4f65406d2ddbc0163a637c0d5fb50f12092ab863379',
  'scripts/native-schedule-job-preparation-tests.mjs':'c6f2218690007002feeeb4756d5bbbbc42964a995f8b757abc9f6c1cc6c62338',
  'scripts/native-schedule-job-sql-tests.mjs':'e360fd2a6b12157191df8325ffcdd7bd23e9dd0b8473ccfa1ca31dd0b55a8e9e',
  'supabase/migrations/20261008115557_native_schedule_job_preparation.sql':'d8e60a063312022b4f44c6479c83b1ce70a4dc19008ec50686815756b4c318a7',
  'scripts/native-provider-credential-observation-http-tests.mjs':'abb058c957ffb5041659be0120b25976e8a8757acdd77c5f80319c3713083196',
  'scripts/native-provider-credential-observation-ci-wiring.mjs':'65bdddcdbcecd53491a79e00afbdaead25016a8f67f3ad47a530af2637bb0d64',
  'src/native-provider-events.js':'9f06bc44c02f6e65fc1a638b33c5f7b0707bdca6483fe6838d0837f8936e0359',
  'src/native-provider-event-decisions.js':'e4d579a4b11d117ed51c31bd0a54953a43e431fb3cb2d38b16b4477678b26cbf',
  'src/native-provider-api.js':'4cf987c8b601308c9379219e6f1e3e798d9746ba5f996f57fb062bc9e68c24ee',
  'src/native-schedule-event-originals.js':'b8cf98e419185bb9a6f38fee95a911f9d3e9e615556994e0d3a748af7c69b398',
  'scripts/native-schedule-event-originals-tests.mjs':'f1ab61da279cf870fecb9bf9cd51c807009f56b2acbbf1cf4cfe8a657db18c00',
  'scripts/native-schedule-observation-http-tests.mjs':'1f63f419fe18d41fe5f873841f0df56a9b27bd35bc70b4e1dcdeb04ecb5c2d9b',
  'scripts/native-schedule-observation-sql-tests.mjs':'45c7c558e3f460f14a09da6690b13c555de8476f35dc5f51ecd4c9b8c509c8f2',
  'supabase/migrations/20261008111355_native_schedule_observation_binding.sql':'e5e843e965c273ad5104e5549453f153389054585c7f2125f21f8256fe8e46e8',
  'src/native-provider-inventory-payload.js':'0994ae2f5ef507bfd90c574a097042a17602290d550e21c15be433992db7edba',
  'src/native-location-lifecycle.js':'52f6e6c3d415da5214f91b3f633e26152dbb6cf3c06897e509302ee915eb0c67',
  'scripts/native-provider-inventory-payload-tests.mjs':'503773d1fb5db6bddb43e45aead36bbd78ab54eaa45721d67418700d1e33a5c1',
  'scripts/native-provider-inventory-http-tests.mjs':'69df1d0fb463c980f349d40105fd17aeaeb5991275326715f26b81ab4896b235',
  'scripts/native-schedule-inventory-sql-tests.mjs':'f073319ef643c99f4c0820b07f429a609c85bfed8c6a0111692b2474d9b84627',
  'supabase/migrations/20261008102957_native_schedule_inventory.sql':'1dc56786eb5783df203bb11264b0d3ad24ee7144e12a137b28c651b5d21fd4ea',
  'scripts/fixtures/native-location-lifecycle-before-inventory.js':'75db8e179f5d8de18f56352815d143383bd2c0ec0e331322198df6df992cff3e',
  'scripts/native-schedule-finalization-source-tests.mjs':'33affc2fee9a16880ea0000ccce222eb668838cba6c25eb19c330ac487f1f415',
  'scripts/native-schedule-finalization-sql-tests.mjs':'d0345858c7cf076d5ea9bb4d8df443659e8c85ad31f072a050842c825e6e2184',
  'scripts/migration-replay-order-tests.mjs':'7c7f23e6d3fbfb07b195354e21b61e025889a640465014abf43a9d7c1723ba88',
  'supabase/migrations/20261008095837_native_schedule_server_finalization.sql':'546e266027a5d881660717e6d47a6889a2a5754fdfb2c50b4f566d8a1dabdd1b',
  'supabase/canonical/migration-replay-order.json':'e5867270c2509b986708caf32109956bedf0703363dcc1d775f1737f502c5c68',
  'src/native-schedule-payload.js':'d48c5204a6b277c57013d7b8affa67977822b33064d85b1abc2bbe017624fff2',
  'scripts/native-schedule-payload-tests.mjs':'83eeb7e991e97890aced89993dfa3dd4ef378593a5c76bff0d1f897f1ccfd712',
  'scripts/fixtures/native-schedule-wire.json':'f9c81355bd4c47ef21470d60b1da83913df796ac6e3db6de4fa048b71e5ef967',
  'src/native-schedule-delivery-preparation.js':'71b2bed9fc70b2cd6a2d57517fade21ded08f52e09fed460f211c1b1239baa78',
  'scripts/native-schedule-delivery-preparation-tests.mjs':'25aab0dd8e754f3b348a6a317c62b9cbd17d3458c91789b25065ddc7578b67d1',
  'scripts/fixtures/native-schedule-source-original.json':'b8a150dab14ce8995c47d43e86d5677611b60f915a9431f450056677c8792236',
  'scripts/native-schedule-lunch-recipient-tests.mjs':'e973f3f5c53e75def3d6379261d4f968518a34462188a15fb637a5247a354ed0',
  'src/native-schedule-validity-source.js':'78d96e7cf5dabb30ec709562366b07a2dc6b111a10ae76889783cb826e8807ac',
  'scripts/native-schedule-validity-source-tests.mjs':'f760d595520d94a6136e1480dfeb6c06dcaba36f255d6b75e4a339bb92be1f49',
  'scripts/native-schedule-source-ci-tests.mjs':'5d3395cab057c115d836d3971f59580629404666cb856fb443f34b1bf5028f98',
  'src/native-schedule-occurrence.js':'06681f19d3d7f8aa9403f8a7455c9b97ea65543f5f9611f67a8bdf8ba8e1d3bf',
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
  for(const [from,to] of [
    ['await runNativeScheduleSenderFactoryTests()','{status:"PASS",checks:44,actual_runtime_factory:true,actual_strict_sender:true,synthetic_OAuth_and_fetch:true,SQL_executed:false,real_key_access:false,provider_dispatch:false,native_qualified:false,phone:false}'],
    ["assert.equal(factoryReceipt.status,'PASS');",'// suppressed factory status'],
    ['factoryReceipt.checks,44','factoryReceipt.checks,0'],
    ['factoryReceipt.actual_runtime_factory,true','factoryReceipt.actual_runtime_factory,false'],
    ['factoryReceipt.actual_strict_sender,true','factoryReceipt.actual_strict_sender,false'],
    ['factoryReceipt.synthetic_OAuth_and_fetch,true','factoryReceipt.synthetic_OAuth_and_fetch,false'],
    ["for(const field of ['SQL_executed','real_key_access','provider_dispatch','native_qualified','phone'])assert.equal(factoryReceipt[field],false);",'// suppressed factory proof scope'],
    ["import {runNativeScheduleSenderFactoryTests} from './native-schedule-sender-factory-tests.mjs';",'// suppressed factory import'],
  ]){
    const changed=files[wrapper].replace(from,to);assert.notEqual(changed,files[wrapper]);
    assert.throws(()=>validate(source,{...files,[wrapper]:changed}));rejected++;
  }
  assert.equal(rejected,158);
  console.log('Native SCHEDULE called-source wiring PASS: 158 omission/execution/receipt/source mutations rejected; no SQL or delivery proof');
  return predecessor;
}
