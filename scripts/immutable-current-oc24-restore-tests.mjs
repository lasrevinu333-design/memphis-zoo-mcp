import {removeCurrentSeparationGuard} from './immutable-current-separation-guard-source.mjs';
import {removeCurrentRestrictedCoverageRestoreSource,restrictedCoverageRestoreIdentity} from './immutable-current-restricted-coverage-restore-source.mjs';
import {removeCurrentCoverageRestoreSource,coverageRestoreIdentity} from './immutable-current-coverage-restore-source.mjs';
import {originalPublicPlanFenceRelations,currentPublicPlanSourceFenceGuards} from './immutable-current-public-plan-fences.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentOc24RestoreRecipe,oc24RestoreIdentity,extendCurrentOc24RestoreSource,removeCurrentOc24RestoreSource} from './immutable-current-oc24-restore-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex'),recipe=currentOc24RestoreRecipe();
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'));
const statement=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
statement.sql=removeCurrentSeparationGuard(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,restrictedCoverageRestoreIdentity);
statement.sql=removeCurrentRestrictedCoverageRestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,coverageRestoreIdentity);
statement.sql=removeCurrentCoverageRestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
test('exact archived completion restoration preserves all normal OC24 checks and the entire preceding program',()=>{
 assert.equal(recipe.identity,oc24RestoreIdentity);assert.equal(program.recipes.length,26);assert.deepEqual(program.recipes.at(-1),recipe);
 const before=removeCurrentOc24RestoreSource(statement.sql);assert.equal(extendCurrentOc24RestoreSource(before),statement.sql);
 const prior=structuredClone(program);prior.recipes.pop();const s=prior.statements.find(s=>s.sourcePath===statement.sourcePath);s.sql=before;s.sourceSha256=sha(before);
 const bytes=JSON.stringify(prior,null,2)+'\n';assert.equal(Buffer.byteLength(bytes),504143);assert.equal(sha(bytes),'77e8877d0ca63aacb23e96f10b98888f896007bf530c8db54c102c5a1a6030fe');
 const at=recipe.before.indexOf('\nbegin\n')+'\nbegin\n'.length,branch=recipe.after.slice(at,at+recipe.after.length-recipe.before.length);
 assert.equal(recipe.after.slice(0,at)+recipe.after.slice(at+branch.length),recipe.before);
 for(const text of ["TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='BEFORE' AND TG_NARGS=0", "TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='completion_responses'", "current_user=session_user AND current_user='postgres'",'custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE'])assert.ok(branch.includes(text));
 assert.ok(recipe.after.includes('perform public.custodial_oc24_assert_completion_selection(new.response_json);'));
 assert.ok(recipe.after.includes("if tg_op='UPDATE' and new.response_json is not distinct from old.response_json then return new; end if;"));
 assert.doesNotMatch(branch,/\b(?:insert into|update |delete |truncate |grant |revoke |exception when|set role|replica)\b/i);
});
test('changed predecessor, altered column/owner/registry binding or extra original consumer cannot be accepted',()=>{
 const before=removeCurrentOc24RestoreSource(statement.sql);
 for(const sql of [before+'\n',before.replace('ACCESS EXCLUSIVE','ACCESS SHARE')])assert.throws(()=>extendCurrentOc24RestoreSource(sql));
 for(const sql of [statement.sql+'\n',statement.sql.replace("oc24_inventory.object_kind='function'",'true'),statement.sql.replace("attname='response_json'","attname='other'"),statement.sql.replace('original.prosecdef','NOT original.prosecdef')])assert.throws(()=>removeCurrentOc24RestoreSource(sql));
});
test('installer keeps original invoker, trigger column, full function metadata, owner and registered definition',()=>{
 const added=statement.sql.slice(statement.sql.indexOf('DO $immutable_current_oc24_original$'));
 for(const text of ['immutable_import_owner_fence()',"current_user<>session_user OR current_user<>'postgres'",'requires fresh DATA','original.prosecdef',
  "pg_get_functiondef(original.oid) IS DISTINCT FROM p->>'before'","to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'",'to_jsonb(after_trigger) IS DISTINCT FROM to_jsonb(original_trigger)',
  'original_trigger.tgtype<>23',"original_trigger.tgenabled<>'A'","attname='response_json'",'NOT attisdropped'])assert.ok(added.includes(text));
 assert.ok(statement.sql.includes("oc24_inventory.object_identity='public.custodial_oc24_completion_selection_guard()'"));
 assert.doesNotMatch(added,/\b(?:insert into|update public|delete from|truncate |grant |revoke |alter role|disable trigger|session_replication_role)\b/i);
});

test('all53 independently retained public consumers share only the unchanged Source-pinned lock',()=>{
 const names=originalPublicPlanFenceRelations(),clause=currentPublicPlanSourceFenceGuards();assert.equal(names.length,53);assert.equal(new Set(names).size,53);
 for(const name of names.filter(n=>n!=='public.completion_responses'))assert.ok(clause.includes("('"+name.slice(7)+"')"));
 assert.ok(!clause.includes("('completion_responses')"));assert.ok(!clause.includes('custodial_coverall'));
 assert.ok(statement.sql.includes(clause));assert.ok(clause.includes("t.tgtype=62 AND t.tgenabled='A'"));assert.ok(clause.includes("item->>'table_name'=original_public_fence.table_name"));
 assert.ok(clause.includes('4fc0ef22db650c17c5d98a35ef62ba165c6fe7301408bd9aab454e875a724fff'));
 assert.doesNotMatch(clause,/\b(?:create|alter|drop|insert|update|delete|truncate|grant|revoke|disable|replica)\b/i);
 assert.throws(()=>originalPublicPlanFenceRelations(['public.unknown']));
 assert.throws(()=>removeCurrentOc24RestoreSource(statement.sql.replace("('coverage_templates')","('unknown_table')")));
});
