import {removeCurrentScanGuard} from './immutable-current-scan-guard-source.mjs';
import {removeCurrentSeparationGuard} from './immutable-current-separation-guard-source.mjs';
import {removeCurrentRestrictedCoverageRestoreSource,restrictedCoverageRestoreIdentity} from './immutable-current-restricted-coverage-restore-source.mjs';
import {removeCurrentCoverageRestoreSource,coverageRestoreIdentity} from './immutable-current-coverage-restore-source.mjs';
import {removeCurrentOc24RestoreSource,oc24RestoreIdentity} from './immutable-current-oc24-restore-source.mjs';
import {removeCurrentTaxonomyGuard} from './immutable-current-taxonomy-guard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentDataSchemaScopeStatements,extendCurrentPostgresDataSchemaScope,currentDataSchemaDependencyStatements,rebindCurrentDataSchemaDependencies} from './immutable-current-data-schema-scope.mjs';
import {immutableTextCodecSourceHashes} from './immutable-text-codec-profile.mjs';
import {removeCurrentDeferredReceiptGuards} from './immutable-current-deferred-guard-source.mjs';
import {removeCurrentCoverallRestoreSource,coverallRestoreIdentity} from './immutable-current-coverall-restore-source.mjs';
import {removeCurrentLeadershipRestoreSource,leadershipRestoreIdentity} from './immutable-current-leadership-restore-source.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const oldFull="('public','auth','storage','custodial_release_identity')",oldOrdinary="('public','auth','storage')";
const full="('public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private')";
const ordinary="('public','auth','storage','custodial_employment','custodial_coverall','custodial_leadership_private')";
const pairs=[
 ['030a130aa642d5517aa4acc154de267c16034d94a6ead01b299f7653fdff1fcb','4833f9a0e02e3dd180221ef09f7240dd4511c5d406456e78401e538e377c2363'],
 ['814c1bfe130b62bbd6ffbd278b6b7b1b23546d4942a2dccbec29083d1a65c3b8','3b33effac412985b3f137d458960ae382387659f4f87ed9372335dde6589596b'],
 ['884485499c6f2c893407e809f5a32200c5b4abe48c8eca944130babdff9d5b15','e89263e58487fc1dcbc08c31f5428130bc05cce726cd15ae162f03a3bc6aae36'],
];
const originalSql=sql=>pairs.reduce((s,[old,next])=>s.replaceAll(next,old),sql).replaceAll(full,oldFull).replaceAll(ordinary,oldOrdinary);
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'));
const leadershipContext=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
leadershipContext.sql=removeCurrentScanGuard(leadershipContext.sql);leadershipContext.sourceSha256=sha(leadershipContext.sql);
leadershipContext.sql=removeCurrentSeparationGuard(leadershipContext.sql);leadershipContext.sourceSha256=sha(leadershipContext.sql);
assert.equal(program.recipes.pop().identity,restrictedCoverageRestoreIdentity);
leadershipContext.sql=removeCurrentRestrictedCoverageRestoreSource(leadershipContext.sql);leadershipContext.sourceSha256=sha(leadershipContext.sql);
assert.equal(program.recipes.pop().identity,coverageRestoreIdentity);
leadershipContext.sql=removeCurrentCoverageRestoreSource(leadershipContext.sql);leadershipContext.sourceSha256=sha(leadershipContext.sql);
assert.equal(program.recipes.pop().identity,oc24RestoreIdentity);
leadershipContext.sql=removeCurrentOc24RestoreSource(leadershipContext.sql);leadershipContext.sourceSha256=sha(leadershipContext.sql);
leadershipContext.sql=removeCurrentTaxonomyGuard(leadershipContext.sql);leadershipContext.sourceSha256=sha(leadershipContext.sql);
assert.equal(program.recipes.pop().identity,leadershipRestoreIdentity);
leadershipContext.sql=removeCurrentLeadershipRestoreSource(leadershipContext.sql);leadershipContext.sourceSha256=sha(leadershipContext.sql);
// Review the unchanged predecessor contracts through the complete inverse;
// the actual new callback/installer has its own affected tests.
assert.equal(program.recipes.pop().identity,coverallRestoreIdentity);
const context=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
context.sql=removeCurrentCoverallRestoreSource(context.sql);context.sourceSha256=sha(context.sql);
test('all authenticated data schemas are included in exact current import, codec and readback predicates',()=>{
 const prior=structuredClone(program);let count=0;
 for(const statement of prior.statements){
  const name=statement.sourcePath.slice('proposals/'.length);
  if(!currentDataSchemaScopeStatements.includes(name)&&!currentDataSchemaDependencyStatements.includes(name))continue;
  assert.ok(!statement.sql.includes(oldFull)&&!statement.sql.includes(oldOrdinary));
  const admitted=name==='immutable-private-owner-context.sql'?removeCurrentDeferredReceiptGuards(statement.sql):statement.sql;
  const original=originalSql(admitted);
  let compiled=currentDataSchemaScopeStatements.includes(name)?extendCurrentPostgresDataSchemaScope(name,original):original;
  if(currentDataSchemaDependencyStatements.includes(name))compiled=rebindCurrentDataSchemaDependencies(name,compiled);
  assert.equal(compiled,admitted);
  statement.sql=original;statement.sourceSha256=sha(original);count++;
 }
 assert.equal(count,4);
 // The complete former program, including every guard recipe, ACL, actor,
 // fence, typed codec, original-data comparison and all remaining statements.
 const originalBytes=JSON.stringify(prior,null,2)+'\n';
 assert.equal(Buffer.byteLength(originalBytes),470843);
 assert.equal(sha(originalBytes),'18d9b6a69326b6a3e9e7adb775c94b331b5f16c355dab858acd5a2c0e3b3759d');
});
test('modified predecessors, unrecognized schemas and unknown scope selectors cannot compile',()=>{
 for(const statement of program.statements){
  const name=statement.sourcePath.slice('proposals/'.length);if(!currentDataSchemaScopeStatements.includes(name))continue;
  const original=originalSql(name==='immutable-private-owner-context.sql'?removeCurrentDeferredReceiptGuards(statement.sql):statement.sql);
  for(const changed of [original+'\n',original.replace('custodial_release_identity','unknown_private'),original.replace('FOR UPDATE','FOR SHARE')]){
   if(changed!==original)assert.throws(()=>extendCurrentPostgresDataSchemaScope(name,changed));
  }
  assert.throws(()=>extendCurrentPostgresDataSchemaScope('unknown.sql',original));
 }
});
function functionBody(sql,name){
 const marker='CREATE FUNCTION custodial_dr.'+name+'(';assert.equal(sql.split(marker).length,2);
 const start=sql.indexOf('AS $fn$',sql.indexOf(marker))+'AS $fn$'.length,end=sql.indexOf('$fn$;',start);
 assert.ok(start>=marker.length&&end>start);return sql.slice(start,end);
}
test('all dependent SQL and both native readback consumers bind the actual derived helper bodies',()=>{
 const current=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql').sql;
 const legacy=readFileSync(new URL('../proposals/immutable-private-owner-context.sql',import.meta.url),'utf8');
 for(const [profile,source] of [[{id:'immutable-private-current-postgres',actor:'postgres'},current],
  [{id:'immutable-private-legacy-supabase-admin',actor:'supabase_admin'},legacy]]){
  const hashes=immutableTextCodecSourceHashes(profile);
  assert.equal(hashes.projection,sha(functionBody(source,'immutable_import_text_projection')));
  assert.equal(hashes.record,sha(functionBody(source,'immutable_import_text_record')));
 }
 assert.equal(sha(functionBody(current,'immutable_import_matches_ordinary_staged')),pairs[2][1]);
 const dependencies=program.statements.filter(s=>currentDataSchemaDependencyStatements.includes(s.sourcePath.slice('proposals/'.length)));
 for(const [old,next] of pairs){assert.equal(dependencies.filter(s=>s.sql.includes(next)).length,1);assert.ok(dependencies.every(s=>!s.sql.includes(old)));}
 for(const filename of ['immutable-private-data-import.mjs','disaster-recovery-storage.mjs']){
  const source=readFileSync(new URL('./'+filename,import.meta.url),'utf8');
  assert.match(source,/immutableTextCodecSourceHashes\(/);
  assert.ok(!source.includes(pairs[0][0])&&!source.includes(pairs[1][0]),'no stale literal native codec pins');
 }
});
test('profile and dependency mismatches refuse rather than accepting both current and historical bodies',()=>{
 for(const value of [{id:'unknown',actor:'postgres'},{id:'immutable-private-current-postgres',actor:'supabase_admin'},
  {id:'immutable-private-legacy-supabase-admin',actor:'postgres'},{id:'immutable-private-current-postgres',actor:'postgres',extra:true}])assert.throws(()=>immutableTextCodecSourceHashes(value));
 let traps=0;const value={id:'immutable-private-current-postgres'};Object.defineProperty(value,'actor',{get(){traps++;return 'postgres';}});
 assert.throws(()=>immutableTextCodecSourceHashes(value));assert.equal(traps,0);assert.throws(()=>immutableTextCodecSourceHashes(new Proxy({},{})));
 for(const statement of program.statements){const name=statement.sourcePath.slice('proposals/'.length);
  if(!currentDataSchemaDependencyStatements.includes(name))continue;
  const previous=pairs.reduce((s,[old,next])=>s.replaceAll(next,old),statement.sql);
  assert.throws(()=>rebindCurrentDataSchemaDependencies(name,previous+'\n'));assert.throws(()=>rebindCurrentDataSchemaDependencies('unknown.sql',previous));
 }
});
test('historical SQL stays pinned and the two identity originals keep their dedicated guard path',()=>{
 const original=readFileSync(new URL('../proposals/immutable-private-owner-context.sql',import.meta.url),'utf8');
 assert.equal(sha(original),'9624907a8e154e07f266597c23d7052739931d634115b68434dd712c346cc007');
 const current=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql').sql;
 assert.ok(current.includes("private_names IS DISTINCT FROM ARRAY['employee_message_original_outcomes','group_original_creations']::text[]"));
 assert.ok(current.includes("MESSAGE='IMMUTABLE_MIXED_INSERT_GUARD_UNSUPPORTED'"));
 assert.ok(current.includes("MESSAGE='Immutable import full target catalog mismatch'"));
});
