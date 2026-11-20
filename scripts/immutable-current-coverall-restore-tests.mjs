import {removeCurrentLegacyDailyFence as undoDailyFence,currentLegacyDailyFenceRecipe as dailyFenceRecipe} from './immutable-current-legacy-daily-fence-source.mjs';
import {removeCurrentAbsenceRestoreSource as undoAbsence,currentAbsenceRestoreRecipe as absenceRecipe} from './immutable-current-absence-restore-source.mjs';
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
import {currentCoverallRestoreRecipe,coverallRestoreIdentity,extendCurrentCoverallRestoreSource,removeCurrentCoverallRestoreSource,currentManualPlanSourceFenceGuard} from './immutable-current-coverall-restore-source.mjs';
import {removeCurrentLeadershipRestoreSource,leadershipRestoreIdentity} from './immutable-current-leadership-restore-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex'),recipe=currentCoverallRestoreRecipe();
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'));
{ assert.deepEqual(program.recipes.pop(),dailyFenceRecipe());const s=program.statements.find(x=>x.sourcePath==='proposals/immutable-private-owner-context.sql');s.sql=undoDailyFence(s.sql);s.sourceSha256=sha(s.sql); }
{ assert.deepEqual(program.recipes.pop(),absenceRecipe());const s=program.statements.find(x=>x.sourcePath==='proposals/immutable-private-owner-context.sql');s.sql=undoAbsence(s.sql);s.sourceSha256=sha(s.sql); }
const statement=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
statement.sql=removeCurrentScanGuard(statement.sql);statement.sourceSha256=sha(statement.sql);
statement.sql=removeCurrentSeparationGuard(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,restrictedCoverageRestoreIdentity);
statement.sql=removeCurrentRestrictedCoverageRestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,coverageRestoreIdentity);
statement.sql=removeCurrentCoverageRestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,oc24RestoreIdentity);
statement.sql=removeCurrentOc24RestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
statement.sql=removeCurrentTaxonomyGuard(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,leadershipRestoreIdentity);
statement.sql=removeCurrentLeadershipRestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
test('four exact unchanged source-lock consumers preserve the complete previous callback program and all guard behavior',()=>{
 const guard=currentManualPlanSourceFenceGuard();assert.equal(statement.sql.split(guard).length,2);
 const prior=structuredClone(program),s=prior.statements.find(s=>s.sourcePath===statement.sourcePath);
 s.sql=s.sql.replace(guard,'');s.sourceSha256=sha(s.sql);
 const original=JSON.stringify(prior,null,2)+'\n';assert.equal(Buffer.byteLength(original),490088);
 assert.equal(sha(original),'5838994653d2a6be0ae47b25d66959399b52c181c7340b73e0f1c493ede7b2a9');
 assert.equal((guard.match(/\('manual_/g)||[]).length,4);
 for(const value of ["t.tgtype=62 AND t.tgenabled='A'","guard_relation_namespace.nspname='custodial_coverall'",
  't.tgqual IS NULL AND t.tgnargs=0',"t.tgattr=''::int2vector",'t.tgconstraint=0 AND NOT t.tgdeferrable',
  "guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)",
  "pg_get_functiondef(guard_function.oid))='4fc0ef22db650c17c5d98a35ef62ba165c6fe7301408bd9aab454e875a724fff'"])assert.ok(guard.includes(value));
 assert.doesNotMatch(guard,/\b(?:create|alter|drop|insert|update|delete|truncate|grant|revoke|disable|replica)\b/i);
 assert.ok(program.recipes.every(r=>!r.identity.includes('notification_plan_source_write_fence')),'lock function stays unchanged');
});
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
