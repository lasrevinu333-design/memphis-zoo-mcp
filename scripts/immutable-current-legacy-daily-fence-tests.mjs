// Source and closure tests; native restore qualification remains a separate gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentLegacyDailyFenceRecipe,extendCurrentLegacyDailyFence,removeCurrentLegacyDailyFence} from './immutable-current-legacy-daily-fence-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url)));
const recipe=currentLegacyDailyFenceRecipe(),statement=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
test('entire last reviewed program survives the new layer exactly',()=>{
 const prior=structuredClone(program);assert.deepEqual(prior.recipes.pop(),recipe);
 const s=prior.statements.find(s=>s.sourcePath===statement.sourcePath);s.sql=removeCurrentLegacyDailyFence(s.sql);s.sourceSha256=sha(s.sql);
 assert.equal(extendCurrentLegacyDailyFence(s.sql),statement.sql);
 const bytes=JSON.stringify(prior,null,2)+'\n';assert.equal(Buffer.byteLength(bytes),550120);assert.equal(sha(bytes),'0001a67f54351b41069016c72d62eadd67611c213713f2e75c4a8d4407d88678');
 assert.throws(()=>currentLegacyDailyFenceRecipe('caller'));
});
test('original body including governed-date INSERT UPDATE DELETE rejection is preserved byte-for-byte',()=>{
 const at=recipe.before.indexOf('\nbegin\n')+'\nbegin\n'.length,branch=recipe.after.slice(at,at+recipe.after.length-recipe.before.length);
 assert.equal(recipe.after.slice(0,at)+recipe.after.slice(at+branch.length),recipe.before);
 for(const x of ["TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='BEFORE' AND TG_NARGS=0","TG_TABLE_SCHEMA='public'","TG_NAME='trg_static_weekly_fence_'||TG_TABLE_NAME","current_user=session_user AND current_user='postgres'",'custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE'])assert.ok(branch.includes(x));
 for(const table of ['daily_absence_overrides','daily_group_assignments','daily_schedule_assignments','daily_work_roster'])assert.ok(branch.includes("'"+table+"'"));
 assert.doesNotMatch(branch,/set_config|skip_absence_regen|session_replication_role|\b(?:update|delete|grant|revoke|exception)\b/i);
 for(const x of ["if tg_op <> 'INSERT' then","if tg_op <> 'DELETE' then",'if v_authority.governed then',"message='legacy daily schedule writes are retired for static-weekly governed dates'",'static_weekly_v6_schedule_authority_state(v_date)'])assert.ok(recipe.after.includes(x));
});
test('installer requires original owner fresh data exact function and all four unaltered consumers',()=>{
 for(const x of ['immutable_import_owner_fence()',"current_user<>session_user OR current_user<>'postgres'",'requires fresh DATA','OR NOT original.prosecdef',"pg_get_functiondef(original.oid) IS DISTINCT FROM p->>'before'",'jsonb_array_length(original_triggers) IS DISTINCT FROM 4',"t.tgtype=31 AND t.tgenabled='O'",'AND t.tgattr=\'\'::int2vector',"to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'",'after_triggers IS DISTINCT FROM original_triggers'])assert.ok(statement.sql.includes(x),x);
 const added=statement.sql.slice(statement.sql.indexOf('DO $immutable_current_legacy_daily_fence$'));
 assert.doesNotMatch(added,/\b(?:alter role|grant |revoke |disable trigger|session_replication_role|insert into|update public|delete from|truncate )\b/i);
});
for(const [a,b] of [["daily_fence_inventory.object_kind='function'",'true'],["t.tgtype=31 AND t.tgenabled='O'","t.tgtype=7 AND t.tgenabled='O'"],['OR NOT original.prosecdef','OR original.prosecdef'],['jsonb_array_length(original_triggers) IS DISTINCT FROM 4','jsonb_array_length(original_triggers) IS DISTINCT FROM 3'],['after_triggers IS DISTINCT FROM original_triggers','false']])test('closed inverse refuses altered binding '+a,()=>assert.throws(()=>removeCurrentLegacyDailyFence(statement.sql.replace(a,b))));
test('unknown predecessor is refused without a runtime substitution',()=>{
 const prior=removeCurrentLegacyDailyFence(statement.sql);
 for(const bad of [prior+'\n',prior.replace('ACCESS EXCLUSIVE','ACCESS SHARE')])assert.throws(()=>extendCurrentLegacyDailyFence(bad));
});
