import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectOriginalDeployedReleaseRow} from './immutable-private-source-bootstrap.mjs';
import {postgresTextColumnsLineEncoding,postgresJsonTextLineEncoding} from './disaster-recovery-archive.mjs';
import {originalRowsMetadataDiagnostics} from './run-private-backup-only-rehearsal.mjs';
const columns=[{name:'release_id',data_type:'text'},{name:'status',data_type:'text'},
  {name:'backend_commit',data_type:'text'},{name:'details_json',data_type:'jsonb'},{name:'deployed_at',data_type:'timestamp with time zone'}];
const signed={release_id:'current',status:'deployed',backend_commit:'a'.repeat(40),details_json:{version:1},deployed_at:'2026-11-11T00:00:00+00:00'};
function fixture(encoding=postgresTextColumnsLineEncoding){
  const rows=Array.from({length:5},(_,i)=>({...signed,release_id:i===2?'current':'historical-'+i,status:i===2?'deployed':'superseded'}));
  if(encoding===postgresTextColumnsLineEncoding)for(const row of rows){row.details_json='{"version":1}';row.deployed_at='2026-11-11 00:00:00+00';}
  return {releaseRows:rows.map(row=>JSON.stringify(row)),releaseTable:{row_count:'5',data_encoding:encoding,columns},signedRelease:signed};
}
test('five original native TEXT rows retained; deployed selector returns unchanged raw bytes, not first row',()=>{
  const input=fixture(),before=[...input.releaseRows];Object.freeze(input.releaseRows);
  assert.equal(selectOriginalDeployedReleaseRow(input),input.releaseRows[2]);assert.deepEqual(input.releaseRows,before);
});
test('legacy JSON history also identifies exactly one deployed original without dropping history',()=>{
  const input=fixture(postgresJsonTextLineEncoding);assert.equal(selectOriginalDeployedReleaseRow(input),input.releaseRows[2]);assert.equal(input.releaseRows.length,5);
});
test('zero, multiple, identity-mismatched deployed rows and duplicate historical IDs refuse',()=>{
  for(const mutate of [
    x=>x.releaseRows=x.releaseRows.map(r=>r.replace('"deployed"','"superseded"')),
    x=>x.releaseRows[0]=x.releaseRows[0].replace('"superseded"','"deployed"'),
    x=>x.signedRelease={...signed,release_id:'not-current'},
    x=>x.signedRelease={...signed,backend_commit:'b'.repeat(40)},
    x=>x.signedRelease={...signed,status:'superseded'},
    x=>x.releaseRows[0]=x.releaseRows[1],
    x=>x.releaseRows.pop(),x=>x.releaseRows=[],
    x=>x.releaseRows[0]=JSON.stringify({...JSON.parse(x.releaseRows[0]),unexpected:'x'}),
    x=>x.releaseRows[0]=JSON.stringify({...JSON.parse(x.releaseRows[0]),details_json:{unsafe:'native coercion'}}),
  ]){const x=fixture();mutate(x);assert.throws(()=>selectOriginalDeployedReleaseRow(x));}
});
test('single-release historical compatibility remains',()=>{
  const x=fixture();x.releaseRows=[x.releaseRows[2]];x.releaseTable={...x.releaseTable,row_count:'1'};
  assert.equal(selectOriginalDeployedReleaseRow(x),x.releaseRows[0]);
});
test('native initializer retains all originals and separately checks deployed identity/full multiset',()=>{
  const sql=readFileSync(new URL('./immutable-private-source-initializer.mjs',import.meta.url),'utf8');
  assert.match(sql,/source\.releaseRows\.join\(','\)/);
  assert.match(sql,/released\.rowCount,source\.releaseRows\.length/);
  assert.match(sql,/metadataCounts,\{releases:source\.releaseRows\.length/);
  assert.match(sql,/releaseCompared[\s\S]*except all[\s\S]*except all/);
  assert.match(sql,/status='deployed'[\s\S]*source\.deployedReleaseRow/);
  assert.doesNotMatch(sql,/source\.releaseRows\[0\]|releases:1/);
  const source=readFileSync(new URL('./immutable-private-source-bootstrap.mjs',import.meta.url),'utf8');
  assert.match(source,/\['release_deployment_manifest',source\.releaseRows,Object\.freeze\(\{\}\)\]/);
  const readback=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
  assert.match(readback,/original_rows[\s\S]*except all[\s\S]*counts\.original_rows!==table\.row_count/);
});
test('diagnostic reports only authenticated fixed counts and equality booleans',()=>{
  const catalog=[{schema_name:'public',table_name:'release_deployment_manifest',row_count:'5'},
    {schema_name:'public',table_name:'custodial_release_authority_restore_inventory',row_count:'7701'}];
  const source={selection:{databaseTables:catalog},sourceBinding:{source_identity:{migration_ledger_count:1,migration_head:'20261111161430'}}};
  const inventory={'inventory/table-catalog.json':JSON.stringify(catalog),'inventory/migration-ledger.json':JSON.stringify([{version:'20261111161430'}])};
  assert.deepEqual(originalRowsMetadataDiagnostics({source,inventory}),{release_manifest_rows:'5',restore_registry_rows:'7701',
    catalog_matches_original_selection:true,ledger_count_matches:true,ledger_head_matches:true});
});
