import {removeCurrentRestoreGuardCohort} from './immutable-current-restore-guard-cohort.mjs';
import {removeCurrentLegacyDailyFence as undoDailyFence,currentLegacyDailyFenceRecipe as dailyFenceRecipe} from './immutable-current-legacy-daily-fence-source.mjs';
import {removeCurrentAbsenceRestoreSource as undoAbsence,currentAbsenceRestoreRecipe as absenceRecipe} from './immutable-current-absence-restore-source.mjs';
import {removeCurrentScanGuard} from './immutable-current-scan-guard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {separationGuardClause,verifyOriginalSeparationGuardSource,extendCurrentSeparationGuard,removeCurrentSeparationGuard} from './immutable-current-separation-guard-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const shippingProgram=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'));
const program=removeCurrentRestoreGuardCohort(shippingProgram);
{ assert.deepEqual(program.recipes.pop(),dailyFenceRecipe());const s=program.statements.find(x=>x.sourcePath==='proposals/immutable-private-owner-context.sql');s.sql=undoDailyFence(s.sql);s.sourceSha256=sha(s.sql); }
{ assert.deepEqual(program.recipes.pop(),absenceRecipe());const s=program.statements.find(x=>x.sourcePath==='proposals/immutable-private-owner-context.sql');s.sql=undoAbsence(s.sql);s.sourceSha256=sha(s.sql); }
const statement=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
statement.sql=removeCurrentScanGuard(statement.sql);statement.sourceSha256=sha(statement.sql);
test('full previous program is byte-exact and original rejection function still executes',()=>{
 const prior=structuredClone(program),s=prior.statements.find(s=>s.sourcePath===statement.sourcePath);s.sql=removeCurrentSeparationGuard(s.sql);s.sourceSha256=sha(s.sql);
 assert.equal(extendCurrentSeparationGuard(s.sql),statement.sql);
 const bytes=JSON.stringify(prior,null,2)+'\n';assert.equal(Buffer.byteLength(bytes),537412);assert.equal(sha(bytes),'d93e9bccc14afc033fea9e4b7844d85b3f67baa0cc776aab38cf74f0f1e54096');
 assert.equal(program.recipes.length,28);assert.equal(program.statements.length,13);
 const original=verifyOriginalSeparationGuardSource();assert.ok(original.includes("f.state='PENDING_RECONCILIATION'"));assert.ok(original.includes('new.started_at>=f.separated_at'));assert.ok(original.includes("raise exception using errcode='42501'"));
 assert.doesNotMatch(separationGuardClause.replace(/^\s*--.*$/gm,''),/immutable_import_matches|RETURN NEW|DISABLE|session_replication_role|EXECUTE|CREATE|GRANT|ALTER|UPDATE|DELETE/i);
});
test('only two original consumers with exact actor, metadata, body are allowed',()=>{
 for(const text of ["session_user='postgres'","guard_relation.relname='sessions'","guard_relation.relname='custodial_offline_actor_contexts'","t.tgtype=7 AND t.tgenabled='O'",'NOT t.tgisinternal','t.tgconstraint=0','t.tgattr=','guard_function.prosecdef','guard_function.proowner=',"t.tgfoid=to_regprocedure(",'0e37d1004b44dd283556e665002a917a6a7f525cdf70851303c9510220d3272d'])assert.ok(separationGuardClause.includes(text),text);
 const before=removeCurrentSeparationGuard(statement.sql);assert.throws(()=>extendCurrentSeparationGuard(before+'\n'));
 for(const [a,b] of [["t.tgtype=7","t.tgtype=23"],["t.tgenabled='O'","t.tgenabled='A'"],['guard_function.prosecdef','true'],["session_user='postgres'","true"]])assert.throws(()=>removeCurrentSeparationGuard(statement.sql.replace(a,b)));
});
