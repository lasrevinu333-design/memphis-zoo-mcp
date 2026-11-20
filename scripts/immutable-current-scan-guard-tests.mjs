import {removeCurrentLegacyDailyFence as undoDailyFence,currentLegacyDailyFenceRecipe as dailyFenceRecipe} from './immutable-current-legacy-daily-fence-source.mjs';
import {removeCurrentAbsenceRestoreSource as undoAbsence,currentAbsenceRestoreRecipe as absenceRecipe} from './immutable-current-absence-restore-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {scanGuardClause,verifyOriginalScanGuardSource,extendCurrentScanGuard,removeCurrentScanGuard} from './immutable-current-scan-guard-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'));
{ assert.deepEqual(program.recipes.pop(),dailyFenceRecipe());const s=program.statements.find(x=>x.sourcePath==='proposals/immutable-private-owner-context.sql');s.sql=undoDailyFence(s.sql);s.sourceSha256=sha(s.sql); }
{ assert.deepEqual(program.recipes.pop(),absenceRecipe());const s=program.statements.find(x=>x.sourcePath==='proposals/immutable-private-owner-context.sql');s.sql=undoAbsence(s.sql);s.sourceSha256=sha(s.sql); }
const statement=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
test('complete predecessor remains exact and canonical validation is not bypassed',()=>{
 const prior=structuredClone(program),s=prior.statements.find(s=>s.sourcePath===statement.sourcePath);s.sql=removeCurrentScanGuard(s.sql);s.sourceSha256=sha(s.sql);
 assert.equal(extendCurrentScanGuard(s.sql),statement.sql);const bytes=JSON.stringify(prior,null,2)+'\n';assert.equal(Buffer.byteLength(bytes),538523);assert.equal(sha(bytes),'242e4a8f0e306e81bf935753cecbafecff2bda3bc90b919c455ce1b5cc0c5b5c');
 assert.equal(program.recipes.length,28);assert.equal(program.statements.length,13);
 const [guard,check]=verifyOriginalScanGuardSource();assert.ok(guard.includes("raise exception using errcode='22023'"));assert.ok(guard.includes('not public.custodial_scan_evidence_is_canonical(new.event_payload)'));
 for(const text of ["jsonb_typeof(p_event)='object'","'client_event_id','event_type','result','notes','scanned_at','payload_json'","('native-nfc','manual-qr-fallback')"])assert.ok(check.includes(text));
 assert.doesNotMatch(scanGuardClause.replace(/^\s*--.*$/gm,''),/immutable_import_matches|RETURN NEW|DISABLE|session_replication_role|EXECUTE|CREATE|GRANT|ALTER|UPDATE|DELETE/i);
});
test('exact consumer and helper owner/body/security metadata remain closed',()=>{
 for(const text of ["session_user='postgres'","guard_relation.relname='custodial_offline_scan_event_evidence'","t.tgtype=7 AND t.tgenabled='O'",'NOT guard_function.prosecdef','NOT scan_check.prosecdef','scan_check.proowner=','scan_check.oid=to_regprocedure','afb309c3d2afdaf85d2127be244582ec9d2ac8bc63767aa3ccb31ddd8961a5bd'])assert.ok(scanGuardClause.includes(text),text);
 const before=removeCurrentScanGuard(statement.sql);assert.throws(()=>extendCurrentScanGuard(before+'\n'));
 for(const [a,b] of [['NOT scan_check.prosecdef','true'],['scan_check.proowner=','scan_check.proowner<>'],['afb309c3d2afdaf85d2127be244582ec9d2ac8bc63767aa3ccb31ddd8961a5bd','wrong'],['t.tgtype=7','t.tgtype=23']])assert.throws(()=>removeCurrentScanGuard(statement.sql.replace(a,b)));
});
