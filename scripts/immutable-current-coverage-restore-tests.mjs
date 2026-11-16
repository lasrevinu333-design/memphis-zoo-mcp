import {removeCurrentScanGuard} from './immutable-current-scan-guard-source.mjs';
import {removeCurrentSeparationGuard} from './immutable-current-separation-guard-source.mjs';
import {removeCurrentRestrictedCoverageRestoreSource,restrictedCoverageRestoreIdentity} from './immutable-current-restricted-coverage-restore-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentCoverageRestoreRecipe,coverageRestoreIdentity,extendCurrentCoverageRestoreSource,removeCurrentCoverageRestoreSource} from './immutable-current-coverage-restore-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex'),recipe=currentCoverageRestoreRecipe();
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'));
const statement=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
statement.sql=removeCurrentScanGuard(statement.sql);statement.sourceSha256=sha(statement.sql);
statement.sql=removeCurrentSeparationGuard(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,restrictedCoverageRestoreIdentity);
statement.sql=removeCurrentRestrictedCoverageRestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
test('exact archived coverage template branch preserves every operational gift-shop rule and the complete previous program',()=>{
 assert.equal(recipe.identity,coverageRestoreIdentity);assert.equal(recipe.registry_identity,'sch_guard_operational_coverage_template()');assert.equal(program.recipes.length,27);assert.deepEqual(program.recipes.at(-1),recipe);
 const before=removeCurrentCoverageRestoreSource(statement.sql);assert.equal(extendCurrentCoverageRestoreSource(before),statement.sql);
 const prior=structuredClone(program);prior.recipes.pop();const s=prior.statements.find(s=>s.sourcePath===statement.sourcePath);s.sql=before;s.sourceSha256=sha(before);
 const bytes=JSON.stringify(prior,null,2)+'\n';assert.equal(Buffer.byteLength(bytes),516611);assert.equal(sha(bytes),'04a835ab262acc395e49c28657ed151895488ec95bfc46ed40de483cdb33e14a');
 const at=recipe.before.indexOf('\nbegin\n')+'\nbegin\n'.length,branch=recipe.after.slice(at,at+recipe.after.length-recipe.before.length);
 assert.equal(recipe.after.slice(0,at)+recipe.after.slice(at+branch.length),recipe.before);
 for(const text of ["TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='BEFORE' AND TG_NARGS=0", "TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='coverage_templates'", "current_user=session_user AND current_user='postgres'",'custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE'])assert.ok(branch.includes(text));
 for(const text of ['new.active := false;','new.assigned_employee_id := null;',"new.owner_type := 'OPEN';","v_group_code like '%GIFT_SHOP'","new.coverage_end <= time '09:45'"])assert.ok(recipe.after.includes(text));
 assert.doesNotMatch(branch,/\b(?:insert into|update |delete |truncate |grant |revoke |exception when|set role|replica)\b/i);
});
test('unknown predecessor, changed metadata or registry alias cannot enter the reviewed source view',()=>{
 const before=removeCurrentCoverageRestoreSource(statement.sql);
 for(const sql of [before+'\n',before.replace('ACCESS EXCLUSIVE','ACCESS SHARE')])assert.throws(()=>extendCurrentCoverageRestoreSource(sql));
 for(const sql of [statement.sql+'\n',statement.sql.replace("coverage_inventory.object_kind='function'",'true'),statement.sql.replace('HAVING count(*)=6','HAVING count(*)=5'),statement.sql.replace('original.prosecdef','NOT original.prosecdef')])assert.throws(()=>removeCurrentCoverageRestoreSource(sql));
});
test('installer preserves invoker and full metadata, ordered six-column trigger and exact original registered definition',()=>{
 const added=statement.sql.slice(statement.sql.indexOf('DO $immutable_current_coverage_original$'));
 for(const text of ['immutable_import_owner_fence()',"current_user<>session_user OR current_user<>'postgres'",'requires fresh DATA','original.prosecdef',
  "pg_get_functiondef(original.oid) IS DISTINCT FROM p->>'before'","to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'",'to_jsonb(after_trigger) IS DISTINCT FROM to_jsonb(original_trigger)',
  'original_trigger.tgtype<>23',"original_trigger.tgenabled<>'O'",'HAVING count(*)=6',"ARRAY['location_group_id','day_of_week','coverage_start','coverage_end','coverage_purpose','active']",'NOT a.attisdropped'])assert.ok(added.includes(text));
 assert.ok(statement.sql.includes("coverage_inventory.object_identity='sch_guard_operational_coverage_template()'"));
 assert.doesNotMatch(added,/\b(?:insert into|update public|delete from|truncate |grant |revoke |alter role|disable trigger|session_replication_role)\b/i);
});
