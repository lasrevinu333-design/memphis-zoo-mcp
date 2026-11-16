import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentCoverallRestoreRecipe,coverallRestoreIdentity,extendCurrentCoverallRestoreSource,removeCurrentCoverallRestoreSource} from './immutable-current-coverall-restore-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex'),recipe=currentCoverallRestoreRecipe();
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'));
const statement=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
test('current callback Source extension recovers the complete exact former program and every original callback byte',()=>{
 assert.equal(recipe.identity,coverallRestoreIdentity);assert.equal(program.recipes.length,24);assert.deepEqual(program.recipes.at(-1),recipe);
 const before=removeCurrentCoverallRestoreSource(statement.sql);assert.equal(extendCurrentCoverallRestoreSource(before),statement.sql);
 const prior=structuredClone(program);prior.recipes.pop();const s=prior.statements.find(s=>s.sourcePath===statement.sourcePath);s.sql=before;s.sourceSha256=sha(before);
 const original=JSON.stringify(prior,null,2)+'\n';assert.equal(Buffer.byteLength(original),475884);
 assert.equal(sha(original),'2319e1390c160e927efea90c169bda35412fb5ada327d7c8e1f6f53c790e1b94');
 const at=recipe.before.indexOf('\nBEGIN\n')+'\nBEGIN\n'.length,added=recipe.after.slice(at,at+recipe.after.length-recipe.before.length);
 assert.equal(recipe.after.slice(0,at)+recipe.after.slice(at+added.length),recipe.before);
 assert.equal(sha(recipe.before),'716454f3b23c064fa54b2c7ea64fcb906ab3954d127e181aa794fd5829f06b7c');
 for(const guard of ["TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='AFTER' AND TG_NARGS=0",
  "TG_TABLE_SCHEMA='custodial_coverall' AND TG_TABLE_NAME='activation_receipts'","current_user=session_user AND current_user='postgres'",
  'custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE'])assert.ok(added.includes(guard));
 assert.doesNotMatch(added,/\b(?:insert into|update |delete |truncate |grant |revoke |exception when|set role|set session|replica)\b/i);
});
test('unknown predecessors, altered guard/installer and omitted integration cannot become a reviewed Source view',()=>{
 const before=removeCurrentCoverallRestoreSource(statement.sql);
 for(const changed of [before+'\n',before.replace('ACCESS EXCLUSIVE','ACCESS SHARE')])assert.throws(()=>extendCurrentCoverallRestoreSource(changed));
 for(const changed of [statement.sql+'\n',statement.sql.replace('manual_operational_delivery_complete','unknown'),
  statement.sql.replace('to_jsonb(after_row)-\'prosrc\'','to_jsonb(after_row)-\'proacl\'')])assert.throws(()=>removeCurrentCoverallRestoreSource(changed));
});
test('Source installer is fresh-target fenced and preserves full callback metadata, both consumers and all prior import guards',()=>{
 const before=removeCurrentCoverallRestoreSource(statement.sql),added=statement.sql.slice(statement.sql.indexOf('DO $immutable_current_coverall_original$'));
 for(const value of ['immutable_import_owner_fence()',"current_user<>session_user OR current_user<>'postgres'",'requires fresh DATA',
  "pg_get_functiondef(original.oid) IS DISTINCT FROM p->>'before'","to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'",
  'after_triggers IS DISTINCT FROM original_triggers','manual_initial_delivery_complete','t.tgconstraint<>0 AND t.tgdeferrable AND t.tginitdeferred'])assert.ok(added.includes(value));
 assert.doesNotMatch(added,/\b(?:insert into|update public|delete from|truncate |grant |revoke |alter role|disable trigger|session_replication_role)\b/i);
 for(const refusal of ["MESSAGE='IMMUTABLE_MIXED_INSERT_GUARD_UNSUPPORTED'","MESSAGE='Immutable import full target catalog mismatch'"])
  assert.equal(statement.sql.split(refusal).length,before.split(refusal).length);
 const bootstrap=readFileSync(new URL('./immutable-private-source-bootstrap.mjs',import.meta.url),'utf8');
 assert.ok(bootstrap.includes("assert.equal(found.length,0,'Fixed current unregistered callback must not rewrite original registry DATA')"));
});
