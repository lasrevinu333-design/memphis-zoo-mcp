import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as C from './schema-fingerprint-catalog.mjs';
import {captureCatalogFromSnapshot} from './schema-catalog-readonly-client.mjs';
import {productionBackupDataSchemas,productionBackupAllowedDataSchemas,productionBackupOptionalPrivateSchemas,requireProductionBackupDataScope} from './production-backup-pg-dump-command.mjs';
import {compareVerifiedImmutableOrdinaryTableData} from './immutable-private-data-import.mjs';
import {selectVerifiedRestoreTables} from './disaster-recovery-archive.mjs';
import * as Old from '../release/worker1-source302-private-schema-backup-20261030/before/schema-fingerprint-catalog.mjs';
const checks=[],test=async(n,f)=>{await f();checks.push(n);},copy=structuredClone,
 names=C.APPLICATION_PRIVATE_SCHEMAS,base=()=>Object.fromEntries(C.SCHEMA_CATALOG_NAMES.map(n=>[n,[]])),owner=n=>({schema_name:n,owner_name:'migration_owner'});
function fixture({schemas=names,rows=base(),owners=schemas.map(owner),unsupported=[],types=[],privateDefaults=[],domains=[]}={}){
 const calls=[],result={...rows};
 const query=async sql=>{calls.push(sql);if(sql===C.APPLICATION_PRIVATE_SCHEMA_OWNERS_QUERY)return{rows:owners};if(sql===C.RECOVERY_SCHEMA_OWNERS_QUERY)return{rows:[]};
  if(sql===C.APPLICATION_PRIVATE_DEFAULT_PRIVILEGES_QUERY)return{rows:privateDefaults};if(sql===C.APPLICATION_PRIVATE_DOMAIN_CONSTRAINTS_QUERY)return{rows:domains};
  if(sql===C.UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY)return{rows:unsupported};if(sql===C.UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY)return{rows:types};
  const key=Object.keys(C.SCHEMA_CATALOG_QUERIES).find(k=>C.SCHEMA_CATALOG_QUERIES[k]===sql);assert.ok(key,'Source-controlled exact query only');return{rows:result[key]};};
 return{calls,query};
}
await test('Historical public/recovery section keys and default-privilege SQL remain exact',()=>{
 assert.deepEqual(C.SCHEMA_CATALOG_NAMES,Old.SCHEMA_CATALOG_NAMES);assert.equal(C.SCHEMA_CATALOG_QUERIES.default_privileges,Old.SCHEMA_CATALOG_QUERIES.default_privileges);
 assert.equal(C.RECOVERY_SCHEMA_OWNERS_QUERY,Old.RECOVERY_SCHEMA_OWNERS_QUERY);
});
await test('Absent private schemas emit no owner section and preserve complete archived catalog JSON/hash',async()=>{
 const historical=JSON.parse(readFileSync(new URL('../supabase/canonical/schema-fingerprint-input.json',import.meta.url))),f=fixture({schemas:[],rows:copy(historical),owners:[]});
 // Canonical historical capture may include recovery owner metadata.
 f.query=async sql=>{if(sql===C.RECOVERY_SCHEMA_OWNERS_QUERY)return{rows:historical.recovery_schema_owners||[]};if(sql===C.APPLICATION_PRIVATE_SCHEMA_OWNERS_QUERY)return{rows:[]};
  if(sql===C.UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY||sql===C.UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY)return{rows:[]};const key=Object.keys(C.SCHEMA_CATALOG_QUERIES).find(k=>C.SCHEMA_CATALOG_QUERIES[k]===sql);assert.ok(key);return{rows:copy(historical[key])};};
 const captured=await C.captureSchemaCatalog(f);assert.equal(Object.hasOwn(captured,'private_schema_owners'),false);assert.deepEqual(captured,historical);
 assert.equal(C.fingerprintSchemaCatalog(captured).fingerprint,Old.fingerprintSchemaCatalog(historical).fingerprint);
});
await test('Every fixed object/ACL catalog query includes all3 private namespaces, with no caller scope',()=>{
 for(const name of ['types','sequences','tables','columns','constraints','indexes','functions','views','triggers','policies','table_grants','column_grants','sequence_grants','routine_grants','type_grants','schema_grants'])
  for(const schema of names)assert.ok(C.SCHEMA_CATALOG_QUERIES[name].includes("'"+schema+"'"),name+' '+schema);
 for(const q of [C.APPLICATION_PRIVATE_SCHEMA_OWNERS_QUERY,C.APPLICATION_PRIVATE_DEFAULT_PRIVILEGES_QUERY,C.APPLICATION_PRIVATE_DOMAIN_CONSTRAINTS_QUERY]){
  for(const schema of names)assert.ok(q.includes("'"+schema+"'"));assert.ok(!q.includes('$1'));
 }
 assert.match(C.APPLICATION_PRIVATE_DEFAULT_PRIVILEGES_QUERY,/left join lateral aclexplode/);assert.match(C.APPLICATION_PRIVATE_DEFAULT_PRIVILEGES_QUERY,/d.defaclnamespace=0/);assert.match(C.APPLICATION_PRIVATE_DEFAULT_PRIVILEGES_QUERY,/is not true/,'empty global ACL records must not vanish through SQL NULL logic');
});
await test('New actual namespace owner rows and every table/constraint/index/trigger/function/grant remain in capture',async()=>{
 const rows=base();for(const name of ['tables','columns','constraints','indexes','functions','views','triggers','policies','table_grants','column_grants','sequence_grants','routine_grants','type_grants','schema_grants','sequences','types'])rows[name]=names.map(schema=>({schema_name:schema,object_name:'same_name'}));
 const defaults=names.map(schema=>({schema_name:schema,owner_role:'migration_owner',object_type:'f',grantee:'PUBLIC',grantor:'migration_owner',privilege_type:'EXECUTE',is_grantable:false})),
  domain={schema_name:names[0],table_name:'private_domain',constraint_name:'check_private',definition:'CHECK ((VALUE > 0))',validated:true,constraint_type:'c'},captured=await C.captureSchemaCatalog(fixture({rows,privateDefaults:defaults,domains:[domain]}));
 assert.deepEqual(captured.private_schema_owners,names.map(owner));for(const k of Object.keys(rows))if(!['default_privileges','constraints'].includes(k))assert.deepEqual(captured[k],rows[k]);
 assert.deepEqual(captured.default_privileges,defaults);assert.deepEqual(captured.constraints,[...rows.constraints,domain]);
 const fingerprint=C.fingerprintSchemaCatalog(captured).fingerprint;
 for(const key of ['private_schema_owners','tables','columns','constraints','indexes','functions','triggers','policies','table_grants','column_grants','sequence_grants','routine_grants','schema_grants','default_privileges']){
  const x=copy(captured);if(key==='private_schema_owners')x[key][0].owner_name='different_owner';else x[key][0].changed='hostile';assert.notEqual(C.fingerprintSchemaCatalog(x).fingerprint,fingerprint,key);
 }
});
await test('Actually empty private schemas retain owner metadata rather than disappear',async()=>{
 const catalog=await C.captureSchemaCatalog(fixture({schemas:[names[1]],owners:[owner(names[1])]}));assert.deepEqual(catalog.private_schema_owners,[owner(names[1])]);assert.deepEqual(catalog.tables,[]);
});
await test('Unknown/duplicate/missing/invalid owner metadata and malformed dense arrays refuse',async()=>{
 for(const bad of [null,{},[null],[{}],[owner('unrelated_schema')],[owner(names[0]),owner(names[0])],[{...owner(names[0]),extra:1}],[{schema_name:names[0],owner_name:''}],[{schema_name:names[0],owner_name:'a\0b'}],[{schema_name:names[0],owner_name:'\ud800'}],[{schema_name:names[0],owner_name:'x'.repeat(64)}]])await assert.rejects(C.captureSchemaCatalog(fixture({owners:bad})));
 const rows=base();rows.tables=[{schema_name:names[0],table_name:'original'}];await assert.rejects(C.captureSchemaCatalog(fixture({owners:[],rows})),/Missing private_schema_owners/);
 const x=base();x.private_schema_owners=[];assert.throws(()=>C.fingerprintSchemaCatalog(x),/private_schema_owners/);
});
await test('Owner metadata getters/proxies are rejected without getter execution',async()=>{
 let calls=0;const getter=()=>{calls++;throw Error('getter must not execute');},row=owner(names[0]);Object.defineProperty(row,'owner_name',{enumerable:true,get:getter});
 await assert.rejects(C.captureSchemaCatalog(fixture({owners:[row]})));assert.equal(calls,0);
 const array=[owner(names[0])];Object.defineProperty(array,'0',{enumerable:true,get:getter});await assert.rejects(C.captureSchemaCatalog(fixture({owners:array})));assert.equal(calls,0);
 const catalog=base();Object.defineProperty(catalog,'private_schema_owners',{enumerable:true,get:getter});assert.throws(()=>C.fingerprintSchemaCatalog(catalog));assert.equal(calls,0);
 await assert.rejects(C.captureSchemaCatalog(fixture({owners:new Proxy([],{get:getter})})));assert.equal(calls,0);
});
await test('Foreign/partitioned/unsupported private type metadata refuses, never silently omitted',async()=>{
 for(const schema of names){await assert.rejects(C.captureSchemaCatalog(fixture({unsupported:[{schema_name:schema,relation_name:'foreign_original',relation_kind:'f'}]})),/Unsupported/);
  await assert.rejects(C.captureSchemaCatalog(fixture({types:[{schema_name:schema,type_name:'opaque_range',type_kind:'r'}]})),/Unsupported/);}
});
await test('Readonly snapshot adapter executes the same closed extra query paths',async()=>{
 const f=fixture(),client={query:async sql=>{if(sql==='set local row_security = off')return{rows:[]};const prefix="select coalesce(json_agg(row_to_json(q)),'[]'::json) as catalog_rows from (",suffix=') q';assert.ok(sql.startsWith(prefix)&&sql.endsWith(suffix));let q=sql.slice(prefix.length,-suffix.length);if(q===C.SCHEMA_CATALOG_QUERIES.cron_jobs.replace('custodial_release_identity.custodial_schema_identity_cron_jobs()','cron.job'))q=C.SCHEMA_CATALOG_QUERIES.cron_jobs;return{rows:[{catalog_rows:(await f.query(q)).rows}]};}};
 assert.deepEqual((await captureCatalogFromSnapshot(client)).private_schema_owners,names.map(owner));
});
const namespaces=schemas=>schemas.map(schema_name=>({schema_name,usage_allowed:true})),table=(schema_name,name='same_original')=>({schema_name,table_name:name,primary_key:['id'],columns:[{name:'id',generated:'',identity:'',data_type:'uuid'}]}),
 privateRow=(schema_name,name='same_original')=>({schema_name,table_name:name,relation_kind:'r',is_partition:false,select_allowed:true});
await test('Legacy4 DATA schemas stay literal; new capture chooses only actual present optional schemas',()=>{
 assert.deepEqual(productionBackupDataSchemas,['public','auth','storage','custodial_release_identity']);assert.deepEqual(productionBackupOptionalPrivateSchemas,names);
 assert.deepEqual(requireProductionBackupDataScope(namespaces(productionBackupDataSchemas),[],[table('public')]),productionBackupDataSchemas);
 const selected=requireProductionBackupDataScope(namespaces(productionBackupAllowedDataSchemas),names.map(n=>privateRow(n)),[table('public'),...names.map(n=>table(n))]);assert.deepEqual(selected,productionBackupAllowedDataSchemas);
});
await test('Namespace/table permission denial is refusal, no grant or filtered empty fallback',()=>{
 const ns=namespaces(productionBackupAllowedDataSchemas),catalog=[table('public'),...names.map(n=>table(n))],census=names.map(n=>privateRow(n));
 for(const n of names){const denied=copy(ns);denied.find(r=>r.schema_name===n).usage_allowed=false;assert.throws(()=>requireProductionBackupDataScope(denied,census,catalog),/accessible/);
  const rows=copy(census);rows.find(r=>r.schema_name===n).select_allowed=false;assert.throws(()=>requireProductionBackupDataScope(ns,rows,catalog),/inaccessible/);}
 assert.throws(()=>requireProductionBackupDataScope(ns,[],catalog));assert.throws(()=>requireProductionBackupDataScope([...ns,{schema_name:'unrelated',usage_allowed:true}],census,catalog));
});
await test('Namespaced duplicate table names are preserved; true duplicate/missing/partition census refuses',()=>{
 const ns=namespaces(productionBackupAllowedDataSchemas),catalog=[table('public'),...names.map(n=>table(n))],rows=names.map(n=>privateRow(n));
 assert.equal(requireProductionBackupDataScope(ns,rows,catalog).length,7);
 assert.throws(()=>requireProductionBackupDataScope(ns,[...rows,rows[0]],catalog));const partition=copy(rows);partition[0].is_partition=true;assert.throws(()=>requireProductionBackupDataScope(ns,partition,catalog));
});
function archiveFixture(){const schemas=productionBackupAllowedDataSchemas,catalog=schemas.map(n=>({...table(n),row_count:'0',data_file:`database/${n}.same_original.jsonl`}));return{summary:{format:'memphis-zoo-disaster-recovery.v4',backed_up_schemas:schemas,table_count:catalog.length,database_row_count:0},catalog,checksumPaths:new Set(catalog.map(t=>t.data_file)),databaseOnly:true};}
await test('Authenticated restore selection retains all3 new private ordinary DATA members, leaving original ledger special',()=>{
 const f=archiveFixture(),selection=selectVerifiedRestoreTables(f);assert.equal(selection.databaseTables.length,7);assert.equal(selection.privateTables.length,1);for(const schema of names)assert.ok(selection.databaseTables.some(t=>t.schema_name===schema));
});
await test('Restore refuses omitted checksummed private members and unrelated namespaces',()=>{
 for(const schema of names){const f=archiveFixture();f.catalog=f.catalog.filter(t=>t.schema_name!==schema);f.summary.table_count--;assert.throws(()=>selectVerifiedRestoreTables(f),/Private original files/);}
 const f=archiveFixture();f.summary.backed_up_schemas=[...f.summary.backed_up_schemas,'unrelated'];assert.throws(()=>selectVerifiedRestoreTables(f));
});
await test('Shipping original namespace coverage keeps absent-schema archives valid and refuses missing/duplicate owner scope',()=>{
 const source=readFileSync(new URL('production-backup-original-metadata.mjs',import.meta.url),'utf8'),start=source.indexOf('function requireOriginalNamespaceCoverage('),end=source.indexOf('   async function captureOriginalNamespaceColumnAcls',start);
 assert.ok(start>=0&&end>start);const check=new Function('assert','SCHEMAS',source.slice(start,end)+';return requireOriginalNamespaceCoverage;')(assert,productionBackupAllowedDataSchemas);
 const schemaRows=ns=>ns.map(schema_name=>({kind:'SCHEMA',schema_name}));
 assert.deepEqual(check([],[],[],schemaRows(productionBackupDataSchemas)),productionBackupDataSchemas);
 assert.deepEqual(check(names.map(schema_name=>({schema_name})),[],[],schemaRows(productionBackupAllowedDataSchemas)),productionBackupAllowedDataSchemas);
 for(const schema_name of names)assert.throws(()=>check([],[{schema_name}],[],schemaRows(productionBackupDataSchemas)),/no captured namespace/);
 assert.throws(()=>check([],[],[],[...schemaRows(productionBackupDataSchemas),schemaRows(productionBackupDataSchemas)[0]]),/Duplicate/);
 assert.throws(()=>check([],[],[],[...schemaRows(productionBackupDataSchemas),{kind:'SCHEMA',schema_name:'unrelated'}]),/fixed backup scope/);
});
await test('Ordinary immutable readback has one fixed private scope across declared DATA/catalog/result validation; synthetic connection refuses',async()=>{
 const source=readFileSync(new URL('immutable-private-data-import.mjs',import.meta.url),'utf8').split('export async function compareVerifiedImmutableOrdinaryTableData(options)')[1];
 for(const schema of names){
  assert.ok(source.slice(source.indexOf('const catalogSql='),source.indexOf('  try {')).includes("'"+schema+"'"));
  assert.ok(source.slice(source.indexOf('const declared='),source.indexOf('selected=declared.slice')).includes("'"+schema+"'"));
  assert.ok(source.slice(source.indexOf('const catalog=await read(catalogSql'),source.indexOf('if(new Set(catalog')).includes("'"+schema+"'"));
 }
 let calls=0;const db={query(){calls++;throw Error('synthetic SQL must not run');}};
 const result=await compareVerifiedImmutableOrdinaryTableData({db,verifiedArchive:{}});assert.equal(result.state,'UNSUPPORTED');assert.equal(calls,0);
});
await test('Existing raw metadata capture, exact owner/ACL verifier, importer, target census and preservation readers include all3',()=>{
 for(const file of ['production-backup-original-metadata.mjs','immutable-private-source-acl.mjs','immutable-private-source-initializer.mjs','immutable-private-data-import.mjs','production-restore.mjs','isolated-release-data-preservation.mjs']){
  const src=readFileSync(new URL(file,import.meta.url),'utf8');for(const schema of names)assert.ok(src.includes(schema),file+' '+schema);
 }
 const producer=readFileSync(new URL('production-backup.mjs',import.meta.url),'utf8');assert.match(producer,/has_table_privilege\(current_user,c.oid,'SELECT'\)/);assert.match(producer,/schemas=requireProductionBackupDataScope/);
});
console.log(JSON.stringify({status:'PASS',groups:checks.length,checks,scope:'Pure catalog/readonly-adapter/DATA-scope/restore-selection cases only; NO PostgreSQL, backup, restore, credentials, deployment or canonical capture execution'}));
