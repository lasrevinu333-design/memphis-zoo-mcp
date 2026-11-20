import {removeCurrentLiveDataSnapshot} from './immutable-current-live-data-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {extendCurrentCatalogStability,removeCurrentCatalogStability} from './immutable-current-catalog-stability-source.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const serial=v=>JSON.stringify(v,null,2)+'\n';
const program=removeCurrentLiveDataSnapshot(JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url))));
const prior=removeCurrentCatalogStability(program);
const fn=(sql,name)=>{const m=sql.match(new RegExp('CREATE FUNCTION custodial_dr\\.'+name+'\\([\\s\\S]*?\\$fn\\$;'));assert.ok(m,name);return m[0];};
test('locked catalog successor recovers the complete genuine6f predecessor and changes only statement1',()=>{
 assert.equal(sha(serial(prior)),'6f35188dc390ec414f55270dbe6f472ea7887a7c028b777528916e6dff029661');
 assert.deepEqual(extendCurrentCatalogStability(prior),program);
 assert.deepEqual(removeCurrentCatalogStability(prior),prior);
 assert.deepEqual(program.recipes,prior.recipes);assert.equal(program.recipes.length,49);assert.equal(program.statements.length,13);
 assert.deepEqual(program.statements.slice(1),prior.statements.slice(1));
 assert.deepEqual({...program,statements:[]},{...prior,statements:[]});
 assert.equal(fn(program.statements[0].sql,'immutable_import_target_shape'),fn(prior.statements[0].sql,'immutable_import_target_shape'));
 assert.equal(fn(program.statements[0].sql,'immutable_import_owner_fence'),fn(prior.statements[0].sql,'immutable_import_owner_fence'));
});
test('catalog certificate is immutable original ancestry and preserves all phase, owner, expiry, witness and DATA assertions',()=>{
 const s=program.statements[0].sql,old=prior.statements[0].sql;
 const guard=fn(s,'immutable_import_context_source_immutable');
 assert.ok(guard.includes('NEW.target_shape,NEW.catalog_epoch'));assert.ok(guard.includes('OLD.target_shape,OLD.catalog_epoch'));
 const raw=guard.split('AS $fn$')[1].slice(0,-'$fn$;'.length);
 assert.equal(sha(raw),'0c21afd420913d3caa766942fd0df66f29dfe8e5a85bc070ca5802a20f3fbfe4');
 assert.ok(s.includes("='0c21afd420913d3caa766942fd0df66f29dfe8e5a85bc070ca5802a20f3fbfe4'"));
 const current=fn(s,'immutable_import_assert_context');
 const inverse=current.replace('custodial_dr.immutable_import_catalog_matches(ctx.target_shape,ctx.catalog_epoch) IS NOT TRUE',
  'ctx.target_shape IS DISTINCT FROM custodial_dr.immutable_import_target_shape()');
 assert.equal(inverse,fn(old,'immutable_import_assert_context'));
 for(const name of ['insert_immutable_ordinary_row','stage_immutable_ordinary_row','immutable_import_matches_ordinary_staged',
  'immutable_import_matches_ordinary_record','finish_immutable_private_import'])assert.equal(fn(s,name),fn(old,name));
});
test('begin acquires stable metadata before original guard qualification and seals only matching full-snapshot boundaries',()=>{
 const begin=fn(program.statements[0].sql,'begin_immutable_private_import');
 assert.ok(begin.indexOf('immutable_import_owner_fence()')<begin.indexOf('immutable_import_lock_catalogs()'));
 assert.ok(begin.indexOf('immutable_import_lock_catalogs()')<begin.indexOf('LOCK TABLE custodial_dr.application_mutation_leases'));
 assert.match(begin,/catalog_before:=custodial_dr\.immutable_import_catalog_epoch\(\);\n target:=custodial_dr\.immutable_import_target_shape\(\);\n catalog_after:=custodial_dr\.immutable_import_catalog_epoch\(\);/);
 assert.match(begin,/IF catalog_before IS NOT DISTINCT FROM catalog_after THEN catalog_certificate:=catalog_before;END IF;/);
 assert.ok(begin.includes("to_jsonb(ctl),target,'STAGING',NULL,NULL,catalog_certificate)"));
});
test('counter checks exact physical catalogs, actual transaction writer-conflicting locks and fresh own counters',()=>{
 const s=readFileSync(new URL('../proposals/immutable-current-catalog-stability.sql',import.meta.url),'utf8');
 for(const token of ['expected<>64','database IN(0,current_db)',"mode IN('ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock')",
  'pg_stat_get_xact_tuples_inserted','pg_stat_get_xact_tuples_updated','pg_stat_get_xact_tuples_deleted','pg_relation_filenode',
  "current_setting('track_counts')<>'on'","current_setting('session_replication_role')<>'origin'",'jsonb_object_agg(name,setting ORDER BY name)',
  'current_user<>session_user',"current_user<>'postgres'",'txid_current()::text'])assert.ok(s.includes(token),token);
 assert.doesNotMatch(s,/ShareUpdateExclusiveLock|pg_stat_get_tuples_(?:inserted|updated|deleted)|SECURITY DEFINER|DISABLE TRIGGER|\breplica\b/i);
 assert.match(s,/GRANT|granted/); // Only inspection/revocation of actual defaults; no privilege delegation.
 assert.doesNotMatch(s,/\bGRANT\s+(?:ALL|EXECUTE|MAINTAIN)\b/);
});
test('every stale or absent certificate uses the original full comparison and unchanged fast certificate still reads actual DATA',()=>{
 const s=readFileSync(new URL('../proposals/immutable-current-catalog-stability.sql',import.meta.url),'utf8');
 assert.equal(s.split('RETURN expected_shape IS NOT DISTINCT FROM custodial_dr.immutable_import_target_shape();').length,3);
 for(const token of ['expected_epoch IS NULL OR before_epoch IS DISTINCT FROM expected_epoch',
  'after_epoch IS DISTINCT FROM before_epoch OR after_epoch IS DISTINCT FROM expected_epoch',
  'custodial_dr.immutable_import_source_inventory_state()',"'migration_head',(SELECT max(version)::text",'FROM public.release_deployment_manifest WHERE status=\'deployed\'',
  'RETURN live_data IS NOT DISTINCT FROM expected_data'])assert.ok(s.includes(token),token);
 assert.doesNotMatch(s,/UPDATE|INSERT INTO|DELETE FROM|TRUNCATE/);
});
test('effective authority/type/codec shape is catalog-derived and remains fully present in the later unmodified statement',()=>{
 const effective=program.statements[10].sql;
 assert.equal(effective,prior.statements[10].sql);assert.ok(effective.includes('immutable_original_authority_scope_shape()'));
 const source=program.statements[9].sql;
 const a=source.indexOf('CREATE FUNCTION custodial_dr.immutable_original_authority_scope_shape()'),z=source.indexOf('$fn$;',a);
 assert.ok(a>0&&z>a);const scope=source.slice(a,z);
 assert.ok(scope.includes("'data_types'"));assert.ok(scope.includes("'text_codecs'"));assert.ok(scope.includes("'import_ancestry'"));
 assert.doesNotMatch(scope,/FROM public\.|FROM custodial_dr\./); // Metadata is all pg_catalog and role views.
});
test('any unrelated or omitted successor byte refuses the whole inverse',()=>{
 for(const mutate of [p=>p.statements[0].sql+=' ',p=>p.statements[1].sql+=' ',p=>p.recipes[0].before+=' ',
  p=>p.statements[0].sourceSha256='0'.repeat(64),p=>p.statements[0].sql=p.statements[0].sql.replace('catalog_epoch jsonb','catalog_epoch text')]){
  const value=structuredClone(program);mutate(value);assert.throws(()=>removeCurrentCatalogStability(value));
 }
 assert.throws(()=>extendCurrentCatalogStability(program));assert.throws(()=>extendCurrentCatalogStability(prior,'override'));
});
