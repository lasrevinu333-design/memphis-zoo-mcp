import {removeCurrentRestrictedCoverageRestoreSource,restrictedCoverageRestoreIdentity} from './immutable-current-restricted-coverage-restore-source.mjs';
import {removeCurrentCoverageRestoreSource,coverageRestoreIdentity} from './immutable-current-coverage-restore-source.mjs';
import {removeCurrentOc24RestoreSource,oc24RestoreIdentity} from './immutable-current-oc24-restore-source.mjs';
import {removeCurrentTaxonomyGuard} from './immutable-current-taxonomy-guard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deferredReceiptGuardClause,extendCurrentDeferredReceiptGuards,removeCurrentDeferredReceiptGuards,deferredGuardPredecessorSha} from './immutable-current-deferred-guard-source.mjs';
import {removeCurrentCoverallRestoreSource,coverallRestoreIdentity} from './immutable-current-coverall-restore-source.mjs';
import {removeCurrentLeadershipRestoreSource,leadershipRestoreIdentity} from './immutable-current-leadership-restore-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const bytes=readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'),program=JSON.parse(bytes);
const statement=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
assert.equal(program.recipes.pop().identity,restrictedCoverageRestoreIdentity);
statement.sql=removeCurrentRestrictedCoverageRestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,coverageRestoreIdentity);
statement.sql=removeCurrentCoverageRestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,oc24RestoreIdentity);
statement.sql=removeCurrentOc24RestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
statement.sql=removeCurrentTaxonomyGuard(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,leadershipRestoreIdentity);
statement.sql=removeCurrentLeadershipRestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,coverallRestoreIdentity);
statement.sql=removeCurrentCoverallRestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
test('only exact two unchanged receipt validators are admitted and complete prior program remains recoverable',()=>{
 const previous=removeCurrentDeferredReceiptGuards(statement.sql);assert.equal(sha(previous),deferredGuardPredecessorSha);
 assert.equal(extendCurrentDeferredReceiptGuards('immutable-private-owner-context.sql',previous),statement.sql);
 const prior=structuredClone(program),s=prior.statements.find(s=>s.sourcePath===statement.sourcePath);s.sql=previous;s.sourceSha256=sha(previous);
 const original=JSON.stringify(prior,null,2)+'\n';assert.equal(Buffer.byteLength(original),471818);
 assert.equal(sha(original),'9a829cc898dc304a6363543908af5c4124cd41e2fe151fd5ed833d1ee26174be');
 assert.equal(program.recipes.length,23);assert.equal(program.statements.length,13);
});
test('changed predecessors, unknown sources and missing or duplicate clauses refuse source admission',()=>{
 const previous=removeCurrentDeferredReceiptGuards(statement.sql);
 for(const source of [previous+'\n',previous.replace('FOR UPDATE','FOR SHARE'),previous.replace('ACCESS EXCLUSIVE','ACCESS SHARE')])
  if(source!==previous)assert.throws(()=>extendCurrentDeferredReceiptGuards('immutable-private-owner-context.sql',source));
 assert.throws(()=>extendCurrentDeferredReceiptGuards('unknown.sql',previous));
 for(const changed of [previous,statement.sql+deferredReceiptGuardClause,statement.sql.replace('t.tgtype=5','t.tgtype=7')])assert.throws(()=>removeCurrentDeferredReceiptGuards(changed));
});
test('admission preserves exact owners, installed Source, full trigger and deferred-constraint shape without changing database objects',()=>{
 for(const value of ["current_user=session_user AND session_user='postgres'","receipt_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)",
  "t.tgtype=5","t.tgdeferrable AND t.tginitdeferred","receipt_constraint.contype='t'",'receipt_constraint.conrelid=t.tgrelid',
  'receipt_constraint.condeferrable AND receipt_constraint.condeferred',"t.tgattr=''::int2vector",'t.tgqual IS NULL AND t.tgnargs=0',
  't.tgoldtable IS NULL AND t.tgnewtable IS NULL','public.static_weekly_digest_text(pg_get_functiondef(receipt_function.oid))=receipt_guard.definition_sha256',
  "'complete_coverall_activation','O'","'complete_recurring_receipt','A'"])assert.ok(deferredReceiptGuardClause.includes(value),value);
 assert.doesNotMatch(deferredReceiptGuardClause,/\b(?:create|alter|drop|insert|update|delete|truncate|grant|revoke|disable|replica)\b/i);
 assert.ok(statement.sql.includes("MESSAGE='IMMUTABLE_MIXED_INSERT_GUARD_UNSUPPORTED'"));
 // The two original definitions still run; no replacement recipe or bypass branch.
 assert.ok(program.recipes.every(r=>!r.identity.includes('require_activation_receipt')&&!r.identity.includes('manual_recurring_require_receipt')));
 // Native run43792688434 proved this real Source has no matching registry
 // definition. Do not fabricate registry DATA or alter its original count.
 assert.ok(!deferredReceiptGuardClause.includes('receipt_inventory'));
 const predecessor=removeCurrentDeferredReceiptGuards(statement.sql);
 assert.equal((statement.sql.match(/i\.definition_sha256=fixed\.definition_sha256/g)||[]).length,
  (predecessor.match(/i\.definition_sha256=fixed\.definition_sha256/g)||[]).length,'all existing registry gates retained');
});
