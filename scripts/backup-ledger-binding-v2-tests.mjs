import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {bindBackupSchemaExtension,verifyArchivedSchemaExtension} from './backup-release-schema-binding.mjs';
import {ledgerMetadataDigest,validateBackupLedgerDeclarationV2} from './backup-ledger-binding-v2.mjs';
import {SCHEMA_CATALOG_QUERIES,fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const candidate=JSON.parse(fs.readFileSync(new URL('../release/production-backup-source-extension-v2.candidate.json',import.meta.url),'utf8'));
const source=(file,location)=>{assert.equal(location,'retained_installed');return fs.readFileSync(new URL('../release/installed-source/'+file,import.meta.url));};
// Source/component fixture: 189 exact retained installed statements; remaining
// historical statements are synthetic, not a claimed connected live capture.
const fixture=structuredClone(candidate);fixture.activation_status='active';
const ledger=fixture.ledger.map(r=>{const sources=fixture.source_bindings.filter(s=>s.ledger_version===r.version);const statements=sources.length?sources.map(s=>source(s.source_file,s.source_location).toString('utf8')):r.statement_sha256.map((_,i)=>`select '${r.version}:${i}' AS synthetic_historical_fixture;`);return{version:r.version,name:r.name,statements};});
fixture.ledger=ledger.map(r=>({version:r.version,name:r.name,statement_sha256:r.statements.map(sha)}));fixture.ledger_sha256=ledgerMetadataDigest(fixture.ledger);
const catalog=Object.fromEntries(Object.keys(SCHEMA_CATALOG_QUERIES).map(k=>[k,[]]));fixture.observed_catalog_fingerprint=fingerprintSchemaCatalog(catalog).fingerprint;
function input(){return {projectRef:fixture.project_ref,releaseIdentity:structuredClone(fixture.deployed_release),migrationLedger:structuredClone(ledger),catalog:structuredClone(catalog),declaration:structuredClone(fixture),readSource:source};}
function archive(){const x=input(),binding=bindBackupSchemaExtension(x);return{summary:{project_ref:x.projectRef,source_identity:{release:x.releaseIdentity,migration_head:binding.captured_migration_head,migration_ledger_count:x.migrationLedger.length}},binding:structuredClone(binding),catalog:x.catalog,ledger:x.migrationLedger};}
test('actual candidate metadata and 189 exact installed source bytes validate without activation',()=>{assert.equal(validateBackupLedgerDeclarationV2(candidate),true);assert.equal(candidate.activation_status,'candidate');assert.equal(candidate.ledger_sha256,'a7737fec14656694c4daa2e94bb980dcc57b7da7a5c5fb74725123a76ea611d5');for(const s of candidate.source_bindings)assert.equal(sha(source(s.source_file,s.source_location)),s.sql_sha256);});
test('candidate cannot authorize runtime backup binding',()=>{const x=input();x.declaration.activation_status='candidate';assert.throws(()=>bindBackupSchemaExtension(x),/not active/);});
test('v2 binds entire 419-row fixture and archives unchanged full deployed release tuple',()=>{const a=archive();assert.equal(verifyArchivedSchemaExtension(a),true);assert.equal(a.binding.captured_ledger_count,419);assert.equal(a.binding.runtime_backend_commit,'fc2b989d19246ffd447c4c7cfb2590ac19bbcd27');assert.equal(a.binding.application_upgrade_claimed,false);assert.equal(a.binding.production_mutation_authorized,false);});
test('membership classifies backdated additions without a timestamp cutoff',()=>{const baseline=new Set(candidate.historical_baseline.map(r=>r.version));const additions=candidate.ledger.filter(r=>!baseline.has(r.version));assert.equal(additions.length,184);assert.equal(additions.filter(r=>r.version<=candidate.historical_baseline.at(-1).version).length,154);for(const r of additions)assert.ok(candidate.source_bindings.some(s=>s.ledger_version===r.version));});
test('GPS exact installed bytes retained outside migration discovery with documented newline transform',()=>{const s=candidate.source_bindings.at(-1);assert.equal(s.ledger_version,'20261111161430');assert.equal(s.sql_sha256,'6bc39e329941413b3487834e2a88f08d5d0cbbca77750983e4da71b5cdf48360');assert.equal(fs.existsSync(new URL('../supabase/migrations/'+s.source_file,import.meta.url)),false);const p=JSON.parse(fs.readFileSync(new URL('../release/backup-installed-source-provenance.json',import.meta.url)));assert.match(p.statement_source_bindings.at(-1).transformation,/trailing LF/);});
const cases=[
 ['extra row',x=>x.migrationLedger.push({...x.migrationLedger.at(-1),version:'20261111161431'})],['missing row',x=>x.migrationLedger.shift()],['reorder',x=>[x.migrationLedger[0],x.migrationLedger[1]]=[x.migrationLedger[1],x.migrationLedger[0]]],['duplicate',x=>x.migrationLedger[1].version=x.migrationLedger[0].version],
 ['historical bytes',x=>x.migrationLedger[0].statements[0]+='\n'],['backdated added bytes',x=>{const historical=new Set(candidate.historical_baseline.map(r=>r.version));x.migrationLedger.find(r=>!historical.has(r.version)).statements[0]+='\n';}],['old name',x=>x.migrationLedger[0].name+='x'],['source bytes',x=>x.readSource=()=>Buffer.from('altered')],['source traversal',x=>x.declaration.source_bindings[0].source_file='../private.sql'],['source valid path mutation',x=>x.declaration.source_bindings[0].source_file='20261111161430_alternate.sql'],['source location',x=>x.declaration.source_bindings[0].source_location='migration'],
 ['catalog',x=>x.catalog.functions.push({schema_name:'public',function_name:'surprise'})],['project',x=>x.projectRef='a'.repeat(20)],['release identity',x=>x.releaseIdentity.backend_commit='0'.repeat(40)],['manifest identity',x=>x.releaseIdentity.migration_manifest_sha256='0'.repeat(64)],['missing release tuple field',x=>delete x.declaration.deployed_release.frontend_commit],
 ['mutation flag',x=>x.declaration.production_mutation_authorized=true],['upgrade flag',x=>x.declaration.application_upgrade_claimed=true],['unknown version',x=>x.declaration.schema='custodial.backup-schema-extension-declaration.v3'],['null array',x=>x.migrationLedger[0].statements=null],['scalar array',x=>x.migrationLedger[0].statements='x'],['non-string statement',x=>x.migrationLedger[0].statements=[{}]],['empty array',x=>x.migrationLedger[0].statements=[]],['sparse array',x=>x.migrationLedger[0].statements=Array(1)],['extra statement',x=>x.migrationLedger[0].statements.push('select 1')],['bad metadata hashes',x=>x.declaration.ledger[0].statement_sha256=[null]],['bad version',x=>x.migrationLedger[0].version=20260514224806],['null name',x=>x.migrationLedger[0].name=null],['dynamic count',x=>{x.declaration.observed_ledger_count=420;x.migrationLedger.push({...x.migrationLedger.at(-1),version:'20261111161431'});}],['missing v1 source',x=>x.declaration.original_v1_extensions.pop()],['old v1 source rewrite',x=>x.declaration.original_v1_extensions[0].sql_sha256='0'.repeat(64)],['changed baseline membership',x=>x.declaration.historical_baseline[0].name+='x']
];
for(const [name,mutate] of cases)test('binding rejects '+name,()=>{const x=input();mutate(x);assert.throws(()=>bindBackupSchemaExtension(x));});
const archiveCases=[['old bytes',x=>x.ledger[0].statements[0]+='\n'],['old name',x=>x.ledger[0].name+='x'],['extra row',x=>x.ledger.push({...x.ledger.at(-1),version:'20261111161431'})],['missing row',x=>x.ledger.pop()],['reorder',x=>x.ledger.reverse()],['duplicate',x=>x.ledger[1].version=x.ledger[0].version],['malformed array',x=>x.ledger[0].statements=[1]],['wrong project',x=>x.summary.project_ref='a'.repeat(20)],['wrong release',x=>x.summary.source_identity.release.release_id='other'],['wrong manifest',x=>x.summary.source_identity.release.migration_manifest_sha256='0'.repeat(64)],['catalog',x=>x.binding.catalog_fingerprint='0'.repeat(64)],['upgrade flag',x=>x.binding.application_upgrade_claimed=true],['mutation flag',x=>x.binding.production_mutation_authorized=true],['unknown version',x=>x.binding.schema='custodial.backup-schema-extension.v3'],['source path',x=>x.binding.ledger_contract.source_bindings[0].source_file='../x'],['digest',x=>x.binding.ledger_sha256='0'.repeat(64)],['candidate contract',x=>x.binding.ledger_contract.activation_status='candidate']];
for(const[name,mutate]of archiveCases)test('archive rejects '+name,()=>{const x=archive();mutate(x);assert.throws(()=>verifyArchivedSchemaExtension(x));});
test('reviewed active declaration differs from inactive candidate only in activation status',()=>{
 const active=JSON.parse(fs.readFileSync(new URL('../release/production-backup-source-extension-v2.ledger419.active.json',import.meta.url),'utf8'));
 assert.equal(validateBackupLedgerDeclarationV2(active),true);assert.equal(active.activation_status,'active');
 assert.equal(active.observed_catalog_fingerprint,'53cb0b65c062a0e1334ef19cc669f0a0731168b38c37830245b3dea4585316fc');
 assert.deepEqual({...active,activation_status:'candidate'},candidate);
 assert.equal(active.application_upgrade_claimed,false);assert.equal(active.production_mutation_authorized,false);
});
test('publishable provenance uses only source basenames and repo-relative retained paths with exact hashes',()=>{
 const text=fs.readFileSync(new URL('../release/backup-installed-source-provenance.json',import.meta.url),'utf8'),p=JSON.parse(text);
 assert.doesNotMatch(text,/\/mnt\/|\/home\/|evidence\/|live-catalog|live-source/);assert.equal(p.replay_authorized,false);assert.equal(p.statement_source_bindings.length,189);
 for(const [i,r]of p.statement_source_bindings.entries()){
  const s=candidate.source_bindings[i];assert.match(r.source_filename,/^[0-9]{14}_[a-z][a-z0-9_]*\.sql$/);assert.equal(r.retained_path,'release/installed-source/'+s.source_file);assert.equal(r.ledger_version,s.ledger_version);assert.equal(r.statement_index,s.statement_index);assert.equal(r.installed_sha256,s.sql_sha256);
  const bytes=source(s.source_file,s.source_location);assert.equal(sha(bytes),r.installed_sha256);
  if(r.ledger_version==='20261111161430'){assert.equal(r.transformation,'strip one trailing LF to match installed statement');assert.equal(sha(Buffer.concat([bytes,Buffer.from('\n')])),r.source_raw_sha256);}
  else {assert.equal(r.transformation,'none');assert.equal(sha(bytes),r.source_raw_sha256);}
 }
});

const current=JSON.parse(fs.readFileSync(new URL('../release/production-backup-source-extension-v2.events420.active.json',import.meta.url),'utf8'));
const currentCandidate=JSON.parse(fs.readFileSync(new URL('../release/production-backup-source-extension-v2.events420.candidate.json',import.meta.url),'utf8'));
function currentInput(selected=current){
 const x=input();x.declaration=structuredClone(selected);x.releaseIdentity=structuredClone(selected.deployed_release);
 x.migrationLedger=selected.ledger.map(r=>({version:r.version,name:r.name,statements:r.statement_sha256.map((_,i)=>{
  const s=selected.source_bindings.find(s=>s.ledger_version===r.version&&s.statement_index===i);
  return s?source(s.source_file,s.source_location).toString('utf8'):`select '${r.version}:${i}' AS synthetic_historical_fixture;`;
 })}));
 x.declaration.ledger=x.migrationLedger.map(r=>({version:r.version,name:r.name,statement_sha256:r.statements.map(sha)}));x.declaration.ledger_sha256=ledgerMetadataDigest(x.declaration.ledger);
 x.declaration.observed_catalog_fingerprint=fingerprintSchemaCatalog(x.catalog).fingerprint;return x;
}
test('current exact 420 declaration adds only the applied Events statement and keeps historical identity',()=>{
 assert.equal(validateBackupLedgerDeclarationV2(current),true);assert.equal(validateBackupLedgerDeclarationV2(currentCandidate),true);
 assert.deepEqual({...current,activation_status:'candidate'},currentCandidate);assert.equal(current.observed_ledger_count,420);assert.equal(current.observed_ledger_head,'20261113221252');
 assert.deepEqual(current.deployed_release,candidate.deployed_release);assert.deepEqual(current.ledger.slice(0,419),candidate.ledger);assert.deepEqual(current.source_bindings.slice(0,189),candidate.source_bindings);
 assert.equal(current.observed_catalog_fingerprint,'afb1cd060e0f5a67833c5f15730010acadc6f737899ef955f6b0d2c8b6bedea5');
 assert.equal(current.ledger_sha256,'ece44ce3b2f0c4cceceef589783fae73f5ad342630765c6460ab083b0515543e');
 for(const s of current.source_bindings)assert.equal(sha(source(s.source_file,s.source_location)),s.sql_sha256);
 assert.equal(current.source_bindings.at(-1).sql_sha256,'0b3967d4feab8329f98bfe56007048f2417e6f9592cbe923a9565893518732ab');
});
test('current 420 synthetic fixture binds and verifies archives without invalidating the old 419 archive',()=>{
 const x=currentInput(),binding=bindBackupSchemaExtension(x);
 assert.equal(binding.captured_ledger_count,420);assert.equal(binding.application_upgrade_claimed,false);
 assert.equal(verifyArchivedSchemaExtension({summary:{project_ref:x.projectRef,source_identity:{release:x.releaseIdentity,migration_head:binding.captured_migration_head,migration_ledger_count:420}},binding,catalog:x.catalog,ledger:x.migrationLedger}),true);
 assert.equal(verifyArchivedSchemaExtension(archive()),true);
});
const currentCases=[
 ['unreviewed 421',x=>{x.declaration.observed_ledger_count=421;x.migrationLedger.push({...x.migrationLedger.at(-1),version:'20261113221253'});}],
 ['419 count with 420 source',x=>x.declaration.observed_ledger_count=419],['unreviewed head',x=>x.declaration.observed_ledger_head='20261113221253'],
 ['changed Events SQL',x=>x.migrationLedger.at(-1).statements[0]+='\n'],['missing Events source',x=>x.declaration.source_bindings.pop()],
 ['419 source pin on 420',x=>x.declaration.source_bindings_sha256=candidate.source_bindings_sha256],
 ['retained source mutation',x=>{const read=x.readSource;x.readSource=(file,where)=>file.startsWith('20261113221252')?Buffer.from('select 1;'):read(file,where);}],
 ['missing previous migration',x=>x.migrationLedger.splice(300,1)],['wrong runtime release',x=>x.releaseIdentity.backend_commit='0'.repeat(40)],
 ['catalog drift',x=>x.catalog.functions.push({schema_name:'public',function_name:'undeclared'})],['inactive candidate',x=>x.declaration.activation_status='candidate'],
 ['mutation flag',x=>x.declaration.production_mutation_authorized=true],['upgrade flag',x=>x.declaration.application_upgrade_claimed=true],
];
for(const [name,mutate]of currentCases)test('current 420 binding rejects '+name,()=>{const x=currentInput();mutate(x);assert.throws(()=>bindBackupSchemaExtension(x));});

const latest=JSON.parse(fs.readFileSync(new URL('../release/production-backup-source-extension-v2.v80-424.active.json',import.meta.url),'utf8'));
const latestCandidate=JSON.parse(fs.readFileSync(new URL('../release/production-backup-source-extension-v2.v80-424.candidate.json',import.meta.url),'utf8'));
test('current exact 424 boundary preserves all 420 rows and 190 sources, adding only four qualified migrations',()=>{
 assert.equal(validateBackupLedgerDeclarationV2(latest),true);assert.equal(validateBackupLedgerDeclarationV2(latestCandidate),true);assert.deepEqual({...latest,activation_status:'candidate'},latestCandidate);
 assert.equal(latest.observed_ledger_count,424);assert.equal(latest.observed_ledger_head,'20261113225746');assert.deepEqual(latest.ledger.slice(0,420),current.ledger);assert.deepEqual(latest.source_bindings.slice(0,190),current.source_bindings);assert.deepEqual(latest.deployed_release,current.deployed_release);
 assert.equal(latest.source_bindings.length,194);assert.equal(latest.observed_catalog_fingerprint,'5a423172d0911422cff099200ba600e0fcd5d806e836745208d368afc61fa8af');assert.equal(latest.ledger_sha256,'e316ee105ac1f8b0d82785b832e34356c785310340421fe17a763370006c2c47');
 assert.deepEqual(latest.source_bindings.slice(190).map(s=>s.sql_sha256),['1e4054e0957f6b4fa3e1eda5a3dcf9b42ec33e8eabd9db4a9579c0e8d6763c70','c92c06fd99e141a758846dfb69f045fd26415ef84f4a3f49d298f1f77c1aa5bc','6bbbf5492f9e33a850935118feec0cdab4ac8e80218df934371e454b04875ca6','07f9e9b3fd84273578cee74fcfde65b4babb7195614d1a2a2850863c46ed132a']);
 for(const s of latest.source_bindings)assert.equal(sha(source(s.source_file,s.source_location)),s.sql_sha256);
});
function archiveFor(x){const binding=bindBackupSchemaExtension(x);return {summary:{project_ref:x.projectRef,source_identity:{release:x.releaseIdentity,migration_head:binding.captured_migration_head,migration_ledger_count:x.migrationLedger.length}},binding,catalog:x.catalog,ledger:x.migrationLedger};}
test('424 synthetic fixture capture and archive verification preserve both previous archive formats',()=>{
 for(const x of [input(),currentInput(),currentInput(latest)])assert.equal(verifyArchivedSchemaExtension(archiveFor(x)),true);
 assert.equal(bindBackupSchemaExtension(currentInput(latest)).captured_ledger_count,424);
});
for(const [name,mutate]of [
 ['425 count on 424 contents',x=>x.declaration.observed_ledger_count=425],['intermediate 423',x=>x.declaration.observed_ledger_count=423],['old head',x=>x.declaration.observed_ledger_head=current.observed_ledger_head],
 ['changed departure SQL',x=>x.migrationLedger[420].statements[0]+='\n'],['changed timing SQL',x=>x.migrationLedger[421].statements[0]+='\n'],['changed phone SQL',x=>x.migrationLedger[422].statements[0]+='\n'],['changed count SQL',x=>x.migrationLedger[423].statements[0]+='\n'],
 ['missing new binding',x=>x.declaration.source_bindings.pop()],['old source pin',x=>x.declaration.source_bindings_sha256=current.source_bindings_sha256],['changed retained source',x=>x.readSource=()=>Buffer.from('changed')],['extra statement',x=>x.migrationLedger[423].statements.push('select 1;')],
 ['catalog drift',x=>x.catalog.tables.push({schema_name:'public',table_name:'unexpected'})],['wrong release identity',x=>x.releaseIdentity.backend_commit='0'.repeat(40)],['inactive candidate',x=>x.declaration.activation_status='candidate'],['application upgrade flag',x=>x.declaration.application_upgrade_claimed=true],['mutation flag',x=>x.declaration.production_mutation_authorized=true],
])test('424 binding rejects '+name,()=>{const x=currentInput(latest);mutate(x);assert.throws(()=>bindBackupSchemaExtension(x));});

const messenger=JSON.parse(fs.readFileSync(new URL('../release/production-backup-source-extension-v2.active.json',import.meta.url),'utf8'));
const messengerCandidate=JSON.parse(fs.readFileSync(new URL('../release/production-backup-source-extension-v2.messenger425.candidate.json',import.meta.url),'utf8'));
test('exact 425 declaration adds only the applied contact migration while preserving 424 and the deployed identity',()=>{
 assert.equal(validateBackupLedgerDeclarationV2(messenger),true);assert.equal(validateBackupLedgerDeclarationV2(messengerCandidate),true);
 assert.deepEqual({...messenger,activation_status:'candidate'},messengerCandidate);
 assert.equal(messenger.observed_ledger_count,425);assert.equal(messenger.observed_ledger_head,'20261114005000');
 assert.deepEqual(messenger.ledger.slice(0,424),latest.ledger);assert.deepEqual(messenger.source_bindings.slice(0,194),latest.source_bindings);
 assert.deepEqual(messenger.deployed_release,latest.deployed_release);assert.deepEqual(messenger.historical_baseline,latest.historical_baseline);
 assert.equal(messenger.source_bindings.length,195);assert.equal(messenger.observed_catalog_fingerprint,'819f49a7c344f973e409513355bd76156dd16379ff7dcf9f7b6a71d432febe0f');
 assert.equal(messenger.ledger_sha256,'9717ff9a954ac7d7554cd43350cfcf65a0a454d60e838065fb4a34364337cc85');
 assert.equal(messenger.source_bindings_sha256,'1b2e54986b803d3efb90847af65186597472dee7aabed1831996994cd19fcd2c');
 assert.equal(messenger.source_bindings.at(-1).sql_sha256,'a65e6e8baff42fc5e1427b7c66f181c3f23ea5b17b671894f4bf94acc6093d82');
 for(const s of messenger.source_bindings)assert.equal(sha(source(s.source_file,s.source_location)),s.sql_sha256);
});
test('425 synthetic capture and archive verification keep all three prior finite formats valid',()=>{
 for(const x of [input(),currentInput(),currentInput(latest),currentInput(messenger)])assert.equal(verifyArchivedSchemaExtension(archiveFor(x)),true);
 assert.equal(bindBackupSchemaExtension(currentInput(messenger)).captured_ledger_count,425);
});
for(const [name,mutate]of [
 ['unknown 426',x=>x.declaration.observed_ledger_count=426],['unknown 421',x=>x.declaration.observed_ledger_count=421],['unknown 422',x=>x.declaration.observed_ledger_count=422],['unknown 423',x=>x.declaration.observed_ledger_count=423],
 ['old head',x=>x.declaration.observed_ledger_head=latest.observed_ledger_head],['changed contact SQL',x=>x.migrationLedger[424].statements[0]+='\n'],
 ['missing contact binding',x=>x.declaration.source_bindings.pop()],['old source pin',x=>x.declaration.source_bindings_sha256=latest.source_bindings_sha256],
 ['changed retained contact source',x=>{const prior=x.readSource;x.readSource=(file,where)=>file.startsWith('20261114005000')?Buffer.from('changed'):prior(file,where);}],
 ['extra statement',x=>x.migrationLedger[424].statements.push('select 1;')],['changed earlier ledger',x=>x.migrationLedger[420].statements[0]+='\n'],
 ['catalog drift',x=>x.catalog.functions.push({schema_name:'public',function_name:'unexpected'})],['wrong release identity',x=>x.releaseIdentity.frontend_commit='0'.repeat(40)],
 ['inactive candidate',x=>x.declaration.activation_status='candidate'],['application upgrade flag',x=>x.declaration.application_upgrade_claimed=true],['mutation flag',x=>x.declaration.production_mutation_authorized=true],
])test('425 binding rejects '+name,()=>{const x=currentInput(messenger);mutate(x);assert.throws(()=>bindBackupSchemaExtension(x));});
