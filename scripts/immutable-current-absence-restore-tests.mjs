import {removeCurrentLegacyDailyFence as undoDailyFence,currentLegacyDailyFenceRecipe as dailyFenceRecipe} from './immutable-current-legacy-daily-fence-source.mjs';
import {removeCurrentAbsenceRestoreSource as undoAbsence,currentAbsenceRestoreRecipe as absenceRecipe} from './immutable-current-absence-restore-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentAbsenceRestoreRecipe,extendCurrentAbsenceRestoreSource,removeCurrentAbsenceRestoreSource} from './immutable-current-absence-restore-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url)));
{ assert.deepEqual(program.recipes.pop(),dailyFenceRecipe());const s=program.statements.find(x=>x.sourcePath==='proposals/immutable-private-owner-context.sql');s.sql=undoDailyFence(s.sql);s.sourceSha256=sha(s.sql); }
{ assert.deepEqual(program.recipes.pop(),absenceRecipe());const s=program.statements.find(x=>x.sourcePath==='proposals/immutable-private-owner-context.sql');s.sql=undoAbsence(s.sql);s.sourceSha256=sha(s.sql); }
const predecessor=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql').sql;
test('exact absence source recipe retains all ordinary insert/update/delete regeneration bytes',()=>{
 const r=currentAbsenceRestoreRecipe();assert.equal(r.beforeHash,'96223ea8ba30558296eab9cdb2581774c603f8cf8fb6cce7ca6b1c4fd5a0ad95');
 const at=r.before.indexOf('\nbegin\n')+7,branch=r.after.slice(at,at+r.after.length-r.before.length);
 assert.equal(r.after.slice(0,at)+r.after.slice(at+branch.length),r.before);
 for(const x of ["TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='AFTER' AND TG_NARGS=0","TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='daily_absence_overrides'","TG_RELID=pg_catalog.to_regclass('public.daily_absence_overrides')","current_user=session_user AND current_user='postgres'",'custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE'])assert.ok(branch.includes(x));
 assert.doesNotMatch(branch,/set_config|skip_absence_regen|disable trigger|session_replication_role|\b(?:update|delete|grant|revoke)\b/i);
 assert.ok(r.after.includes('perform public.sch_regenerate_existing_schedules_for_absence_range(v_start, v_end);'));
});
test('full predecessor inverse and exact AFTER INSERT DELETE UPDATE consumer retained',()=>{
 const next=extendCurrentAbsenceRestoreSource(predecessor);assert.equal(removeCurrentAbsenceRestoreSource(next),predecessor);assert.equal(sha(predecessor),'9d4e8c96cb47cc8841db3999cd6560a8ab4386693aa7ebebdadf99565f43b7f4');
 for(const x of ["t.tgname='daily_absence_overrides_regenerate_schedule' AND t.tgtype=29",'original_trigger.tgtype<>29',"original_trigger.tgattr<>''::int2vector",'requires fresh DATA',"to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'",'to_jsonb(after_trigger) IS DISTINCT FROM to_jsonb(original_trigger)'])assert.ok(next.includes(x));
});
test('unknown predecessor and altered exact owner/trigger/registration bindings rejected',()=>{
 assert.throws(()=>extendCurrentAbsenceRestoreSource(predecessor+'\n'));const next=extendCurrentAbsenceRestoreSource(predecessor);
 for(const [a,b] of [["t.tgtype=29","t.tgtype=5"],["absence_inventory.object_kind='function'",'true'],['original.prosecdef','NOT original.prosecdef'],['ACCESS EXCLUSIVE','ACCESS SHARE']])assert.throws(()=>removeCurrentAbsenceRestoreSource(next.replace(a,b)));
});
