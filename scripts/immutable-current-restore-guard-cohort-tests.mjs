import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentRestoreGuardCohortSources,currentOriginalStorageGuards,extendCurrentRestoreGuardCohort,removeCurrentRestoreGuardCohort,deferredOriginalMatcherSql} from './immutable-current-restore-guard-cohort.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url)));
const sources=currentRestoreGuardCohortSources();
test('entire last native-attempt program survives, with no changed ordinary behavior or historical pin',()=>{
 const previous=removeCurrentRestoreGuardCohort(program),bytes=JSON.stringify(previous,null,2)+'\n';
 assert.equal(Buffer.byteLength(bytes),566690);assert.equal(sha(bytes),'952d9dabdcf4c219c513f0137340a37318376ac7fd46dec760f6addc29ae6bf6');
 assert.deepEqual(extendCurrentRestoreGuardCohort(previous),program);assert.equal(program.recipes.length,49);assert.equal(program.statements.length,13);
 for(const f of sources){
  if(f.identity==='public.static_weekly_v15_lock_recurring_mutation()'){assert.ok(f.definition.includes("pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0))"));continue;}
  const r=program.recipes.find(r=>r.identity===f.identity);assert.equal(r.before,f.definition);
  let at=0;while(r.before[at]===r.after[at])at++;
  assert.equal(r.after.slice(0,at)+r.after.slice(at+r.after.length-r.before.length),r.before,r.identity);
 }
});
test('all24 original definitions and every consumer are closed fixed Source, never runtime-selected recipes',()=>{
 assert.equal(sources.length,24);assert.equal(new Set(sources.map(f=>f.identity)).size,24);
 assert.throws(()=>currentRestoreGuardCohortSources('caller'));
 const current=program.statements[0].sql,last=program.statements.at(-1).sql;
 for(const f of sources){assert.equal(sha(f.definition),f.definition_sha256);assert.equal(f.owner,'postgres');
  for(const t of f.triggers.filter(t=>(t.type&4)!==0)){assert.ok(current.includes(JSON.stringify(t.name)));assert.ok(current.includes(JSON.stringify(t.table)));}
 }
 for(const x of ["current_user<>session_user OR current_user<>'postgres'",'Original cohort requires fresh DATA',"normalized_triggers IS DISTINCT FROM p->'triggers'",'after_triggers IS DISTINCT FROM original_triggers',"to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'"])assert.ok(last.includes(x),x);
});
test('shipping bootstrap recipe projection accepts every current recipe and refuses an unknown private callback',()=>{
 const source=readFileSync(new URL('./immutable-private-source-bootstrap.mjs',import.meta.url),'utf8');
 const a=source.indexOf(' const recipes=allRecipes.map(recipe=>{'),z=source.indexOf(" sourcePhase='ORIGINAL_REGISTRY';",a);assert.ok(a>0&&z>a);
 const closed=(v,keys)=>assert.deepEqual(Object.keys(v).sort(),[...keys].sort());
 const bodyOf=s=>s.split('AS $function$')[1].slice(0,-'$function$\n'.length);
 const run=new Function('allRecipes','postgresProgram','assert','closed','sha','bodyOf',source.slice(a,z)+'return recipes;');
 assert.equal(run(program.recipes,true,assert,closed,sha,bodyOf).length,49);
 const altered=structuredClone(program.recipes);altered[0].identity='custodial_coverall.unselected_callback()';
 assert.throws(()=>run(altered,true,assert,closed,sha,bodyOf));
 assert.throws(()=>run(program.recipes,false,assert,closed,sha,bodyOf));
});
test('release bootstrap preserves all authenticated history while requiring one deployed release and the unchanged final identity',()=>{
 const s=program.statements[0].sql;
 for(const x of ["IF count_value=0 OR count_value<>(item->>'row_count')::bigint","(SELECT count(*) FROM public.release_deployment_manifest WHERE status='deployed')<>1","target->'release' IS DISTINCT FROM jsonb_build_array(original_manifest->'target_release_identity')"])assert.ok(s.includes(x),x);
 const changed=structuredClone(program);changed.statements[0].sql=changed.statements[0].sql.replace("WHERE status='deployed')<>1","WHERE status='deployed')<>2");assert.throws(()=>removeCurrentRestoreGuardCohort(changed));
});
test('vendor bucket validators execute unchanged with exact owner, service-role argument and trigger columns',()=>{
 const rows=currentOriginalStorageGuards();assert.throws(()=>currentOriginalStorageGuards('caller'));
 assert.equal(rows.length,2);assert.deepEqual(rows.map(g=>g.security_definer),[false,true]);
 assert.equal(rows[0].args_hex,'736572766963655f726f6c6500');assert.equal(rows[0].nargs,1);
 assert.deepEqual(rows[1].columns,['lifecycle_configuration_generation']);
 const sql=program.statements[0].sql,a=sql.indexOf('     -- Two exact unchanged official Storage bucket INSERT consumers.');assert.ok(a>0);
 const z=sql.indexOf('     -- Original taxonomy checks',a);assert.ok(z>a);const clause=sql.slice(a,z);
 for(const g of rows){assert.equal(sha(g.definition),g.definition_sha256);assert.ok(clause.includes(g.definition_sha256));assert.ok(!program.recipes.some(r=>r.identity===g.function));}
 for(const x of ["rolname='supabase_storage_admin'","t.tgnargs=(g->>'nargs')::smallint AND encode(t.tgargs,'hex')=g->>'args_hex'","guard_function.prosecdef=(g->>'security_definer')::boolean","t.tgtype=(g->>'type')::smallint","t.tgqual IS NULL"])assert.ok(clause.includes(x),x);
 assert.doesNotMatch(clause,/\b(?:ALTER|CREATE|GRANT|REVOKE|DISABLE|INSERT INTO|SET ROLE)\b/);
 const changed=structuredClone(program);changed.statements[0].sql=changed.statements[0].sql.replace("rolname='supabase_storage_admin'","rolname='postgres'");assert.throws(()=>removeCurrentRestoreGuardCohort(changed));
});
for(const id of sources.filter(f=>f.identity!=='public.static_weekly_v15_lock_recurring_mutation()').map(f=>f.identity))test('only exact archived INSERT branch for '+id,()=>{
 const r=program.recipes.find(r=>r.identity===id),a=r.after.indexOf('-- Exact authenticated archived INSERT only.'),z=r.after.indexOf('  END IF;\n',a)+'  END IF;\n'.length;assert.ok(a>0&&z>a);
 const branch=r.after.slice(a,z);
 for(const x of ["TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_NARGS=0","current_user=session_user AND current_user='postgres'",'custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE'])assert.ok(branch.includes(x));
 assert.doesNotMatch(branch,/set_config|session_replication_role|\b(?:UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|EXCEPTION)\b/);
});
test('only two deferred originals can match after full native finish, without changing constraint timing',()=>{
 for(const x of ["pg_catalog.pg_trigger_depth()<>1", "ctx.phase<>'FINISHED'",'ctx.active_table_oid IS NOT NULL','ctx.active_row_sha256 IS NOT NULL',"'public.static_weekly_approved_initial_confirmations'::regclass,'public.weekly_schedule_lunch_documents'::regclass",'c.reltype=pg_typeof(p_new_row)::oid','staged.ordinal IS DISTINCT FROM observed','observed IS DISTINCT FROM expected_count OR matches<>1','original_projection IS DISTINCT FROM staged.typed_original_text','actual_matches<>1','checked IS DISTINCT FROM ctx','s.table_oid=p_table_oid'])assert.ok(deferredOriginalMatcherSql.includes(x),x);
 assert.doesNotMatch(deferredOriginalMatcherSql,/SET CONSTRAINTS|DISABLE TRIGGER|session_replication_role|SECURITY DEFINER|jsonb_populate_record|WHEN OTHERS/i);
 assert.ok(deferredOriginalMatcherSql.includes('REVOKE ALL ON FUNCTION custodial_dr.immutable_import_matches_deferred_original_record'));
 assert.ok(deferredOriginalMatcherSql.includes('a.grantee<>p.proowner OR a.grantor<>p.proowner'));
});
for(const mutation of [p=>p.recipes.at(-1).after+=' ',p=>p.statements[0].sql=p.statements[0].sql.replace("guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)",'true'),p=>p.statements.at(-1).sql=p.statements.at(-1).sql.replace('checked IS DISTINCT FROM ctx','false'),p=>p.recipes.pop()])test('complete inverse refuses changed cohort, owner or deferred evidence',()=>assert.throws(()=>{const p=structuredClone(program);mutation(p);removeCurrentRestoreGuardCohort(p);}));
test('the last predecessor cannot be substituted or expanded by a caller',()=>{
 const p=removeCurrentRestoreGuardCohort(program);p.recipes[0].before+=' ';assert.throws(()=>extendCurrentRestoreGuardCohort(p));
});
