import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentCyclicCohortSql,extendCurrentCyclicCohorts,removeCurrentCyclicCohorts,extendCurrentCyclicStatementFence} from './immutable-current-cyclic-cohort-source.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url)));
const previous=removeCurrentCyclicCohorts(program);
test('hosted prerequisite selectors retain exact predecessor bytes through repository relative fixtures',()=>{
 const source=readFileSync(new URL('./immutable-private-source-bootstrap-tests.mjs',import.meta.url),'utf8');
 for(const [path,pin]of [
  ['20261018_typed_text_import_01370197.mjs.source','01370197f83806262d0412dfeaa8adbf532ba5d044657f7c657eb34abb97b902'],
  ['20261018_safe_ordinary_set_679bc8cd.mjs.source','679bc8cdf5270b1cbbe2ffb565c4ced56050cb1d95079aa749652709835c48ab']]){
  assert.equal(sha(readFileSync(new URL('../release/installed-source/'+path,import.meta.url))),pin);
  assert.ok(source.includes("readFileSync(new URL('../release/installed-source/"+path+"',import.meta.url),'utf8')"));
 }
 for(const [start,end]of [["if(process.argv.includes('--immutable-safe-ordinary-set-only')){","if(process.argv.includes('--immutable-source-row-reuse-only')){"],
  ["if(process.argv.includes('--immutable-text-columns-import-only')){","if(process.argv.includes('--immutable-safe-ordinary-set-only')){"]]){
  const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>0&&b>a);const part=source.slice(a,b),privateOriginal=part.indexOf(" if(want('original-reader')){");assert.doesNotMatch(privateOriginal<0?part:part.slice(0,privateOriginal),/\/home\/eric\//);
 }
});
test('complete genuine previous program survives fixed original cyclic cohort composition',()=>{
 assert.equal(sha(JSON.stringify(previous,null,2)+'\n'),'ba07026628726ae35f12522520c31a19bd1883cdbae9326fa711b9f551a0297a');
 assert.deepEqual(extendCurrentCyclicCohorts(previous),program);assert.deepEqual(program.recipes,previous.recipes);
 assert.deepEqual(program.statements.slice(1),previous.statements.slice(1));
 assert.equal(program.statements[0].originalSourceSha256,previous.statements[0].originalSourceSha256);
 assert.equal(program.statements.length,13);assert.equal(program.recipes.length,49);
});
test('only two literal fixed groups and private invoker functions are composed',()=>{
 const sql=currentCyclicCohortSql();assert.throws(()=>currentCyclicCohortSql('caller'));
 assert.equal((sql.match(/CREATE FUNCTION custodial_dr\./g)||[]).length,5);
 assert.equal((sql.match(/RETURNS (?:oid\[\]|text|boolean|jsonb) LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog/g)||[]).length,5);
 for(const anchor of ['public.custodial_release_canary_controls','public.ops_manager_enrollment_codes'])assert.ok(sql.includes("anchor_oid=to_regclass('"+anchor+"')"));
 assert.ok(sql.includes('ELSE RETURN NULL;END IF;'));assert.ok(sql.includes("current_user<>'postgres'"));
 assert.doesNotMatch(sql,/SECURITY DEFINER|SET CONSTRAINTS|DISABLE TRIGGER|session_replication_role|ALTER (?:ROLE|TABLE)|\bGRANT\b|UPDATE public|DELETE FROM|TRUNCATE/i);
 for(const field of ['staged.ordinal IS DISTINCT FROM observed','staged.original_row_sha256 IS DISTINCT FROM',
  'projection IS DISTINCT FROM staged.typed_original_text',"observed<>(member->>'row_count')::bigint",'checked IS DISTINCT FROM ctx',
  'expected_context IS DISTINCT FROM witness','mismatches<>0','EXCEPT ALL','OVERRIDING SYSTEM VALUE',
  "ctx.phase<>'STAGING'",'pg_catalog.pg_trigger_depth()<>1','WHERE grantee<>f.proowner'])assert.ok(sql.includes(field),field);
});
test('only the exact original application INSERT table predicate gains the fixed group alternative',()=>{
 const prior='CREATE OR REPLACE FUNCTION custodial_dr.guard_application_mutation()\nUNIT c.active_table_oid = TG_RELID\nORIGINAL NORMAL BODY';
 const next=extendCurrentCyclicStatementFence(prior);
 assert.equal(next.replace('(c.active_table_oid = TG_RELID OR custodial_dr.immutable_import_active_cohort_relation(TG_RELID))','c.active_table_oid = TG_RELID'),prior);
 assert.throws(()=>extendCurrentCyclicStatementFence(prior+prior));assert.throws(()=>extendCurrentCyclicStatementFence(prior.replace('custodial_dr.guard_application_mutation','public.foreign_guard')));
});
for(const mutate of [
 p=>p.recipes[0].after+=' ',p=>p.statements[1].sql+=' ',p=>p.statements[0].sql=p.statements[0].sql.replace('AND s.table_oid=$1 AND s.typed_original_text=original_row::text','AND true'),
 p=>p.statements[0].sql=p.statements[0].sql.replace('current_user<>session_user OR current_user<>\'postgres\'','false'),
 p=>p.statements[0].sql=p.statements[0].sql.replace('pg_catalog.pg_trigger_depth()<>1','false'),
 p=>p.statements[0].sql=p.statements[0].sql.replace('mismatches<>0','mismatches<0'),
])test('whole predecessor identity rejects changed source or weaker cohort evidence',()=>{
 const p=structuredClone(program);mutate(p);assert.notDeepEqual(p,program);assert.throws(()=>removeCurrentCyclicCohorts(p));
});
