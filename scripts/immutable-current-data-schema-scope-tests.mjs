import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentDataSchemaScopeStatements,extendCurrentPostgresDataSchemaScope} from './immutable-current-data-schema-scope.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const oldFull="('public','auth','storage','custodial_release_identity')",oldOrdinary="('public','auth','storage')";
const full="('public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private')";
const ordinary="('public','auth','storage','custodial_employment','custodial_coverall','custodial_leadership_private')";
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'));
test('all authenticated data schemas are included in exact current import, codec and readback predicates',()=>{
 const prior=structuredClone(program);let count=0;
 for(const statement of prior.statements){
  const name=statement.sourcePath.slice('proposals/'.length);
  if(!currentDataSchemaScopeStatements.includes(name))continue;
  assert.ok(!statement.sql.includes(oldFull)&&!statement.sql.includes(oldOrdinary));
  const original=statement.sql.replaceAll(full,oldFull).replaceAll(ordinary,oldOrdinary);
  assert.equal(extendCurrentPostgresDataSchemaScope(name,original),statement.sql);
  statement.sql=original;statement.sourceSha256=sha(original);count++;
 }
 assert.equal(count,3);
 // The complete former program, including every guard recipe, ACL, actor,
 // fence, typed codec, original-data comparison and all remaining statements.
 const originalBytes=JSON.stringify(prior,null,2)+'\n';
 assert.equal(Buffer.byteLength(originalBytes),470843);
 assert.equal(sha(originalBytes),'18d9b6a69326b6a3e9e7adb775c94b331b5f16c355dab858acd5a2c0e3b3759d');
});
test('modified predecessors, unrecognized schemas and unknown scope selectors cannot compile',()=>{
 for(const statement of program.statements){
  const name=statement.sourcePath.slice('proposals/'.length);if(!currentDataSchemaScopeStatements.includes(name))continue;
  const original=statement.sql.replaceAll(full,oldFull).replaceAll(ordinary,oldOrdinary);
  for(const changed of [original+'\n',original.replace('custodial_release_identity','unknown_private'),original.replace('FOR UPDATE','FOR SHARE')]){
   if(changed!==original)assert.throws(()=>extendCurrentPostgresDataSchemaScope(name,changed));
  }
  assert.throws(()=>extendCurrentPostgresDataSchemaScope('unknown.sql',original));
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
