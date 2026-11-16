import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentLeadershipRestoreRecipe,leadershipRestoreIdentity,extendCurrentLeadershipRestoreSource,removeCurrentLeadershipRestoreSource} from './immutable-current-leadership-restore-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex'),recipe=currentLeadershipRestoreRecipe();
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'));
const statement=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
test('leadership original-row Source preserves the complete exact previous program and normal generation guard',()=>{
 assert.equal(recipe.identity,leadershipRestoreIdentity);assert.equal(program.recipes.length,25);assert.deepEqual(program.recipes.at(-1),recipe);
 const before=removeCurrentLeadershipRestoreSource(statement.sql);assert.equal(extendCurrentLeadershipRestoreSource(before),statement.sql);
 const prior=structuredClone(program);prior.recipes.pop();const s=prior.statements.find(s=>s.sourcePath===statement.sourcePath);s.sql=before;s.sourceSha256=sha(before);
 const original=JSON.stringify(prior,null,2)+'\n';assert.equal(Buffer.byteLength(original),491606);
 assert.equal(sha(original),'fff4fb59c5a89c88b82d7925fc8aa54e97c6660bbf9afd266effbd2ae6567540');
 const at=recipe.before.indexOf('\nBEGIN\n')+'\nBEGIN\n'.length,added=recipe.after.slice(at,at+recipe.after.length-recipe.before.length);
 assert.equal(recipe.after.slice(0,at)+recipe.after.slice(at+added.length),recipe.before);
 for(const v of ["TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='BEFORE' AND TG_NARGS=0",
  "TG_TABLE_SCHEMA='custodial_leadership_private' AND TG_TABLE_NAME='registrations'","current_user=session_user AND current_user='postgres'",
  'custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE'])assert.ok(added.includes(v));
 assert.ok(recipe.after.includes("WHERE singleton AND NOT mutations_paused AND state IN('READY','COMPLETE') FOR SHARE"));
 assert.ok(recipe.after.includes('NEW.authority_generation:=generation;'));
 assert.doesNotMatch(added,/\b(?:insert into|update |delete |truncate |grant |revoke |exception when|set role|replica)\b/i);
});
test('changed predecessors, weakened metadata checks and unknown consumers cannot masquerade as reviewed Source',()=>{
 const before=removeCurrentLeadershipRestoreSource(statement.sql);
 for(const changed of [before+'\n',before.replace('ACCESS EXCLUSIVE','ACCESS SHARE')])assert.throws(()=>extendCurrentLeadershipRestoreSource(changed));
 for(const changed of [statement.sql+'\n',statement.sql.replace('leadership_inventory.object_kind=\'function\'','true'),
  statement.sql.replace('original_trigger.tgtype<>7','original_trigger.tgtype<>5')])assert.throws(()=>removeCurrentLeadershipRestoreSource(changed));
});
test('current registration installer preserves original owner, full metadata, single trigger and matching registered definition',()=>{
 const added=statement.sql.slice(statement.sql.indexOf('DO $immutable_current_leadership_original$'));
 for(const v of ['immutable_import_owner_fence()',"current_user<>session_user OR current_user<>'postgres'",'requires fresh DATA',
  "pg_get_functiondef(original.oid) IS DISTINCT FROM p->>'before'","to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'",
  'to_jsonb(after_trigger) IS DISTINCT FROM to_jsonb(original_trigger)','original_trigger.tgtype<>7',
  'original_trigger.tgconstraint<>0 OR original_trigger.tgdeferrable'])assert.ok(added.includes(v));
 assert.ok(statement.sql.includes("leadership_inventory.object_identity='custodial_leadership_private.bind_registration_generation()'"));
 assert.ok(statement.sql.includes("MESSAGE='IMMUTABLE_MIXED_INSERT_GUARD_UNSUPPORTED'"));
 assert.doesNotMatch(added,/\b(?:insert into|update public|delete from|truncate |grant |revoke |alter role|disable trigger|session_replication_role)\b/i);
});
