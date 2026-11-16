import {removeCurrentRestrictedCoverageRestoreSource,restrictedCoverageRestoreIdentity} from './immutable-current-restricted-coverage-restore-source.mjs';
import {removeCurrentCoverageRestoreSource,coverageRestoreIdentity} from './immutable-current-coverage-restore-source.mjs';
import {removeCurrentOc24RestoreSource,oc24RestoreIdentity} from './immutable-current-oc24-restore-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {completionSourceFenceClause,taxonomyGuardClause,taxonomyGuardPredecessorSha,verifyOriginalTaxonomySource,extendCurrentTaxonomyGuard,removeCurrentTaxonomyGuard} from './immutable-current-taxonomy-guard-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'));
const statement=program.statements.find(s=>s.sourcePath==='proposals/immutable-private-owner-context.sql');
assert.equal(program.recipes.pop().identity,restrictedCoverageRestoreIdentity);
statement.sql=removeCurrentRestrictedCoverageRestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,coverageRestoreIdentity);
statement.sql=removeCurrentCoverageRestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
assert.equal(program.recipes.pop().identity,oc24RestoreIdentity);
statement.sql=removeCurrentOc24RestoreSource(statement.sql);statement.sourceSha256=sha(statement.sql);
test('only the unchanged completion validator is admitted and the entire previous Source program is recoverable',()=>{
 assert.equal(verifyOriginalTaxonomySource(),true);
 const previous=removeCurrentTaxonomyGuard(statement.sql);assert.equal(sha(previous),taxonomyGuardPredecessorSha);
 assert.equal(extendCurrentTaxonomyGuard(previous),statement.sql);
 const before=structuredClone(program),s=before.statements.find(s=>s.sourcePath===statement.sourcePath);s.sql=previous;s.sourceSha256=sha(previous);
 const bytes=JSON.stringify(before,null,2)+'\n';assert.equal(Buffer.byteLength(bytes),501535);assert.equal(sha(bytes),'431e227d0fcca20f8b41079f152cca8789ab05aae16aa7828145c4761eab0213');
 assert.equal(program.recipes.length,25);assert.equal(program.statements.length,13);
 assert.ok(!program.recipes.some(r=>r.identity.includes('taxonomy')));
});
test('unknown, altered or duplicated predecessor clauses refuse instead of expanding historical admission',()=>{
 const before=removeCurrentTaxonomyGuard(statement.sql);
 for(const sql of [before+'\n',before.replace('ACCESS EXCLUSIVE','ACCESS SHARE')])assert.throws(()=>extendCurrentTaxonomyGuard(sql));
 for(const sql of [statement.sql+taxonomyGuardClause,statement.sql.replace('t.tgtype=23','t.tgtype=7'),statement.sql.replace('AND taxonomy_check.prosecdef','AND true'),before])assert.throws(()=>removeCurrentTaxonomyGuard(sql));
});
test('trigger columns, enabled mode, both Source definitions and original owners stay pinned with validation active',()=>{
 for(const text of ["session_user='postgres'","guard_relation_namespace.nspname='public'","guard_relation.relname='completion_responses'",
  "t.tgname='custodial_completion_taxonomy_response_guard'","t.tgtype=23 AND t.tgenabled='A'",'t.tgconstraint=0',"a.attname='response_json'",'NOT a.attisdropped',
  't.tgattr::text=', 'NOT guard_function.prosecdef','taxonomy_check.prosecdef',"guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)",
  "taxonomy_check.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)",
  'e0da75066209d8b7152140baa52845c20e3c71827ce9acc3fda89e979fba758d','7369d77aaa54ad7d064c02b848d770b6fdf1e6570e8c48a7dd477a0b8bc895a8'])assert.ok(taxonomyGuardClause.includes(text),text);
 assert.doesNotMatch(taxonomyGuardClause,/\b(?:create|alter|drop|insert|update|delete|truncate|grant|revoke|disable|replica)\b/i);
 assert.ok(statement.sql.includes("MESSAGE='IMMUTABLE_MIXED_INSERT_GUARD_UNSUPPORTED'"));
});

test('the exact retained completion-source fence keeps its shared lock and rejects changed consumer metadata',()=>{
 for(const text of ["guard_relation_namespace.nspname='public'","guard_relation.relname='completion_responses'",
  "t.tgname='custodial_recurring_notification_plan_source_fence'","t.tgtype=62 AND t.tgenabled='A'", "t.tgattr=''::int2vector",'guard_function.prosecdef',
  '4fc0ef22db650c17c5d98a35ef62ba165c6fe7301408bd9aab454e875a724fff'])assert.ok(completionSourceFenceClause.includes(text));
 assert.doesNotMatch(completionSourceFenceClause,/\b(?:create|alter|drop|insert|update|delete|truncate|grant|revoke|disable|replica)\b/i);
 for(const changed of [statement.sql.replace(completionSourceFenceClause,''),statement.sql.replace("t.tgtype=62 AND t.tgenabled='A'","t.tgtype=62 AND t.tgenabled='O'")])assert.throws(()=>removeCurrentTaxonomyGuard(changed));
});

test('the completion fence successor also preserves the entire preceding taxonomy-only program',()=>{
 const before=structuredClone(program),s=before.statements.find(s=>s.sourcePath===statement.sourcePath);
 s.sql=s.sql.replace(completionSourceFenceClause,'');s.sourceSha256=sha(s.sql);
 const bytes=JSON.stringify(before,null,2)+'\n';assert.equal(Buffer.byteLength(bytes),503136);
 assert.equal(sha(bytes),'5b171d6a35ab4776e4f4ca764cff78fbfbc5aee26184c79bfada9c0818471e25');
});
