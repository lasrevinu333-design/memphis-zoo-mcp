import {removeCurrentRestoreGuardCohort} from './immutable-current-restore-guard-cohort.mjs';
import {removeCurrentLegacyDailyFence as undoDailyFence,currentLegacyDailyFenceRecipe as dailyFenceRecipe} from './immutable-current-legacy-daily-fence-source.mjs';
import {removeCurrentAbsenceRestoreSource as undoAbsence,currentAbsenceRestoreRecipe as absenceRecipe} from './immutable-current-absence-restore-source.mjs';
import {removeCurrentScanGuard} from './immutable-current-scan-guard-source.mjs';
import {removeCurrentSeparationGuard} from './immutable-current-separation-guard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentRestrictedCoverageRestoreRecipe,restrictedCoverageRestoreIdentity,extendCurrentRestrictedCoverageRestoreSource,removeCurrentRestrictedCoverageRestoreSource} from './immutable-current-restricted-coverage-restore-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex'),recipe=currentRestrictedCoverageRestoreRecipe();
const shippingProgram=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'));
const program=removeCurrentRestoreGuardCohort(shippingProgram);
{ assert.deepEqual(program.recipes.pop(),dailyFenceRecipe());const s=program.statements.find(x=>x.sourcePath==='proposals/immutable-private-owner-context.sql');s.sql=undoDailyFence(s.sql);s.sourceSha256=sha(s.sql); }
{ assert.deepEqual(program.recipes.pop(),absenceRecipe());const s=program.statements.find(x=>x.sourcePath==='proposals/immutable-private-owner-context.sql');s.sql=undoAbsence(s.sql);s.sourceSha256=sha(s.sql); }
const statement=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
statement.sql=removeCurrentScanGuard(statement.sql);statement.sourceSha256=sha(statement.sql);
statement.sql=removeCurrentSeparationGuard(statement.sql);statement.sourceSha256=sha(statement.sql);
test('exact archived coverage template branch preserves every operational restriction rule and the complete previous program',()=>{
 assert.equal(recipe.identity,restrictedCoverageRestoreIdentity);assert.equal(recipe.registry_identity,'sch_guard_restricted_coverage_template()');assert.equal(program.recipes.length,28);assert.deepEqual(program.recipes.at(-1),recipe);
 const before=removeCurrentRestrictedCoverageRestoreSource(statement.sql);assert.equal(extendCurrentRestrictedCoverageRestoreSource(before),statement.sql);
 const prior=structuredClone(program);prior.recipes.pop();const s=prior.statements.find(s=>s.sourcePath===statement.sourcePath);s.sql=before;s.sourceSha256=sha(before);
 const bytes=JSON.stringify(prior,null,2)+'\n';assert.equal(Buffer.byteLength(bytes),527603);assert.equal(sha(bytes),'52e8a18627da3483b764ef420fcc804c7f0eaabb9aa11de4fe75895c841744ad');
 const at=recipe.before.indexOf('\nbegin\n')+'\nbegin\n'.length,branch=recipe.after.slice(at,at+recipe.after.length-recipe.before.length);
 assert.equal(recipe.after.slice(0,at)+recipe.after.slice(at+branch.length),recipe.before);
 for(const text of ["TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='BEFORE' AND TG_NARGS=0", "TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='coverage_templates'", "current_user=session_user AND current_user='postgres'",'custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE'])assert.ok(branch.includes(text));
 for(const text of ['new.assigned_employee_id := null;',"new.owner_type := 'OPEN';",'public.sch_is_employee_location_group_restricted(new.assigned_employee_id, new.location_group_id, new.day_of_week)','new.notes := trim(concat_ws('])assert.ok(recipe.after.includes(text));
 assert.doesNotMatch(branch,/\b(?:insert into|update |delete |truncate |grant |revoke |exception when|set role|replica)\b/i);
});
test('unknown predecessor, changed metadata or registry alias cannot enter the reviewed source view',()=>{
 const before=removeCurrentRestrictedCoverageRestoreSource(statement.sql);
 for(const sql of [before+'\n',before.replace('ACCESS EXCLUSIVE','ACCESS SHARE')])assert.throws(()=>extendCurrentRestrictedCoverageRestoreSource(sql));
 for(const sql of [statement.sql+'\n',statement.sql.replace("restricted_coverage_inventory.object_kind='function'",'true'),statement.sql.replace('HAVING count(*)=3','HAVING count(*)=2'),statement.sql.replace('original.prosecdef','NOT original.prosecdef')])assert.throws(()=>removeCurrentRestrictedCoverageRestoreSource(sql));
});
test('installer preserves invoker and full metadata, ordered three-column trigger and exact original registered definition',()=>{
 const added=statement.sql.slice(statement.sql.indexOf('DO $immutable_current_restricted_coverage_original$'));
 for(const text of ['immutable_import_owner_fence()',"current_user<>session_user OR current_user<>'postgres'",'requires fresh DATA','original.prosecdef',
  "pg_get_functiondef(original.oid) IS DISTINCT FROM p->>'before'","to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'",'to_jsonb(after_trigger) IS DISTINCT FROM to_jsonb(original_trigger)',
  'original_trigger.tgtype<>23',"original_trigger.tgenabled<>'O'",'HAVING count(*)=3',"ARRAY['location_group_id','day_of_week','assigned_employee_id']",'NOT a.attisdropped'])assert.ok(added.includes(text));
 assert.ok(statement.sql.includes("restricted_coverage_inventory.object_identity='sch_guard_restricted_coverage_template()'"));
 assert.doesNotMatch(added,/\b(?:insert into|update public|delete from|truncate |grant |revoke |alter role|disable trigger|session_replication_role)\b/i);
});
