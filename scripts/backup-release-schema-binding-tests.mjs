import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import{bindBackupSchemaExtension,verifyArchivedSchemaExtension}from'./backup-release-schema-binding.mjs';
import{catalogConnectionOptions,readCatalogReadOnly,NATIVE_CRON_CATALOG_SQL}from'./schema-catalog-readonly-client.mjs';
import{SCHEMA_CATALOG_QUERIES,captureSchemaCatalog,fingerprintSchemaCatalog,UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY,UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY}from'./schema-fingerprint-catalog.mjs';
import * as CatalogSource from './schema-fingerprint-catalog.mjs';
const declaration=JSON.parse(fs.readFileSync(new URL('../release/production-backup-source-extension.json',import.meta.url),'utf8'));
// Pure tests use a synthetic empty catalog; actual connected capture is a separate required workflow.
const catalog=Object.fromEntries(Object.keys(SCHEMA_CATALOG_QUERIES).map(key=>[key,[]]));
const declaredSourceFingerprint=declaration.observed_catalog_fingerprint;
declaration.observed_catalog_fingerprint=fingerprintSchemaCatalog(catalog).fingerprint;
test('source declaration is the exact independently observed predeployment boundary',()=>{assert.equal(declaredSourceFingerprint,'0096e7c488aca86f1d38b061561696b2d4ac409036f063ffc9f196625b9ee9c2');assert.equal(declaration.observed_ledger_count,235);assert.equal(declaration.observed_ledger_head,'20261021111917');assert.equal(declaration.extensions.length,5);});
const source=(name,location='migration')=>fs.readFileSync(new URL((location==='retained_installed'?'../release/installed-source/':'../supabase/migrations/')+name,import.meta.url));
const prefix=Array.from({length:229},(_,i)=>({version:String(10000000000000+i),name:'synthetic-history',statements:['select 1;']}));
prefix.push({version:'20260920010000',name:'event_reminder_static_weekly_authority',statements:['select 1;']});
const ledger=[...prefix,...declaration.extensions.map(r=>({version:r.ledger_version,name:r.ledger_name,statements:[source(r.source_file,r.source_location).toString('utf8')]}))];
const input=()=>({projectRef:declaration.project_ref,releaseIdentity:structuredClone(declaration.deployed_release),migrationLedger:structuredClone(ledger),catalog:structuredClone(catalog),declaration:structuredClone(declaration),readSource:source});
let binding;
test('exact known installed extension is archived without pretending application deployment',()=>{binding=bindBackupSchemaExtension(input());assert.equal(binding.runtime_migration_head,'20260920010000');assert.equal(binding.captured_migration_head,'20261021111917');assert.equal(binding.application_upgrade_claimed,false);assert.equal(binding.production_mutation_authorized,false);assert.equal(binding.extensions.length,5);});
const mutations=[['wrong project',x=>x.projectRef='aaaaaaaaaaaaaaaaaaaa'],['different runtime',x=>x.releaseIdentity.backend_commit='1'.repeat(40)],['wrong release head',x=>x.releaseIdentity.migration_head='20261001000000'],['missing ledger row',x=>x.migrationLedger.pop()],['extra migration',x=>x.migrationLedger.push({version:'20261007000000'})],['duplicate ledger version',x=>x.migrationLedger[1].version=x.migrationLedger[0].version],['rewritten source SQL',x=>x.migrationLedger.at(-1).statements[0]+='\nselect 1;'],['multiple source statements',x=>x.migrationLedger.at(-1).statements.push('select 1;')],['different source bytes',x=>x.readSource=()=>Buffer.from('not the source')],['unexpected privilege',x=>x.catalog.routine_grants.push({...x.catalog.routine_grants[0],grantee:'anon'})],['wrong target fingerprint',x=>x.declaration.observed_catalog_fingerprint='0'.repeat(64)],['mutation authority flag',x=>x.declaration.production_mutation_authorized=true],['source path traversal',x=>x.declaration.extensions[0].source_file='../private.pem']];
for(const[label,change]of mutations)test(label+' fails before backup acceptance',()=>{const x=input();change(x);assert.throws(()=>bindBackupSchemaExtension(x));});
function archive(){const x=input(),b=bindBackupSchemaExtension(x);return{summary:{project_ref:x.projectRef,source_identity:{release:x.releaseIdentity,migration_head:b.captured_migration_head,migration_ledger_count:ledger.length}},binding:b,catalog:x.catalog,ledger:x.migrationLedger};}
test('signed archive retains independently checked runtime and schema identities',()=>assert.equal(verifyArchivedSchemaExtension(archive()),true));
for(const[label,change]of [['mismatched runtime',x=>x.summary.source_identity.release.backend_commit='0'.repeat(40)],['mismatched schema',x=>x.binding.catalog_fingerprint='0'.repeat(64)],['lost extension',x=>x.ledger.pop()],['altered migration bytes',x=>x.ledger.at(-1).statements[0]+='\n'],['false upgrade claim',x=>x.binding.application_upgrade_claimed=true]])test('archive '+label+' rejected',()=>{const x=archive();x.binding={...x.binding};change(x);assert.throws(()=>verifyArchivedSchemaExtension(x));});
const ca='-----BEGIN CERTIFICATE-----\nsynthetic-certificate\n-----END CERTIFICATE-----',url='postgresql://fixture:fixture-secret@db.fixture.supabase.co:5432/postgres?sslmode=disable&application_name=bad';
test('TLS verification cannot be overridden in the configured URL',()=>{const options=catalogConnectionOptions({connectionString:url,caPem:ca});assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.ssl.ca,ca);assert.equal(new URL(options.connectionString).searchParams.has('sslmode'),false);assert.equal(options.statement_timeout,15000);});
for(const [label,value]of [['missing certificate',{connectionString:url,caPem:''}],['not postgres',{connectionString:'https://example.invalid',caPem:ca}],['missing credentials',{connectionString:'postgres://example.invalid/db',caPem:ca}]])test(label+' refused',()=>assert.throws(()=>catalogConnectionOptions(value)));
function fake({fail=false,readOnly='on'}={}){const calls=[];let ended=false;class Client{constructor(options){assert.equal(options.ssl.rejectUnauthorized,true);}async connect(){calls.push('connect');}async query(sql){calls.push(sql);if(sql.startsWith('select current_setting'))return{rows:[{read_only:readOnly}]};if(sql.startsWith('begin')||sql==='rollback'||sql==='set local row_security = off')return{rows:[]};const queries=[...Object.values(SCHEMA_CATALOG_QUERIES).filter(q=>q!==SCHEMA_CATALOG_QUERIES.cron_jobs),NATIVE_CRON_CATALOG_SQL,UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY,UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY,CatalogSource.RECOVERY_SCHEMA_OWNERS_QUERY,CatalogSource.APPLICATION_PRIVATE_SCHEMA_OWNERS_QUERY].filter(q=>typeof q==='string');assert.ok(queries.some(q=>sql==="select coalesce(json_agg(row_to_json(q)),'[]'::json) as catalog_rows from ("+q+") q"),'only source-controlled complete catalog queries may run');if(fail)throw Object.assign(Error('fixture-secret may not escape'),{code:'XX000'});return{rows:[{catalog_rows:[]}]};}async end(){ended=true;}}return{Client,calls,ended:()=>ended};}
test('all catalog queries execute in one verified read-only snapshot and rollback',async()=>{const f=fake();const rows=await readCatalogReadOnly({connectionString:url,caPem:ca,Client:f.Client});assert.deepEqual(Object.keys(rows),Object.keys(SCHEMA_CATALOG_QUERIES));assert.equal(f.calls[1],'begin isolation level repeatable read read only deferrable');assert.equal(f.calls.at(-1),'rollback');assert.equal(f.ended(),true);});
test('failure still rolls back and closes without leaking connection text',async()=>{const f=fake({fail:true});await assert.rejects(readCatalogReadOnly({connectionString:url,caPem:ca,Client:f.Client}),e=>e.code==='XX000'&&!String(e.stack).includes('fixture-secret')&&!e.cause);assert.equal(f.calls.at(-1),'rollback');assert.equal(f.ended(),true);});
test('read-write transaction is refused before catalog data is requested',async()=>{const f=fake({readOnly:'off'});await assert.rejects(readCatalogReadOnly({connectionString:url,caPem:ca,Client:f.Client}));assert.equal(f.calls.length,4);assert.equal(f.ended(),true);});

test('native cron capture is the exact same six-field ordered metadata projection',()=>{assert.equal(NATIVE_CRON_CATALOG_SQL,SCHEMA_CATALOG_QUERIES.cron_jobs.replace('custodial_release_identity.custodial_schema_identity_cron_jobs()','cron.job'));assert.match(NATIVE_CRON_CATALOG_SQL,/case when username in \('postgres','supabase_admin'\) then 'migration_owner'/);});

// SOURCE/component fixtures only: these catalog rows are synthetic PostgreSQL
// projections, not an executed SQL catalog or a restore authorization.
function recoveryCatalogRows(){
 const rows=structuredClone(catalog);
 const fn=(schema,args)=>({schema_name:schema,function_name:'same_name',identity_arguments:args,
  owner_name:'migration_owner',definition:`CREATE FUNCTION ${schema}.same_name(${args}) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$`,object_comment:null});
 rows.functions=[fn('public','v text'),fn('custodial_recovery','v text'),fn('custodial_recovery','v integer')];
 rows.routine_grants=[
  {schema_name:'custodial_recovery',function_name:'same_name',identity_arguments:'v text',grantee:'service_role',grantor:'migration_owner',privilege_type:'EXECUTE',is_grantable:false},
  {schema_name:'custodial_recovery',function_name:'same_name',identity_arguments:'v text',grantee:'migration_owner',grantor:'migration_owner',privilege_type:'EXECUTE',is_grantable:false}];
 rows.schema_grants=[{schema_name:'custodial_recovery',grantee:'migration_owner',grantor:'migration_owner',privilege_type:'USAGE',is_grantable:false}];
 return rows;
}
function recoveryCatalogFixture({rows=recoveryCatalogRows(),relations=[],types=[],schemaOwners,schemaOwnerError}={}){
 const calls=[];let ended=false;
 // Deliberately limited recording of the fixed SQL projections. The absence
 // of the private-schema predicate in the old source omits the private rows.
 function queryRows(sql){
  if(sql===CatalogSource.APPLICATION_PRIVATE_SCHEMA_OWNERS_QUERY)return [];
  if(sql===CatalogSource.RECOVERY_SCHEMA_OWNERS_QUERY){
   if(schemaOwnerError)throw schemaOwnerError;
   // Synthetic namespace rows model the fixed SQL projection, independently
   // of function owners/ACL. Old fixtures need only this new query adapter.
   if(schemaOwners!==undefined)return structuredClone(schemaOwners);
   return ['functions','routine_grants','schema_grants'].some(key=>rows[key].some(row=>row.schema_name==='custodial_recovery'))
    ?[{schema_name:'custodial_recovery',owner_name:'migration_owner'}]:[];
  }
  const privateScope=sql.includes("'custodial_recovery'");
  const included=row=>row.schema_name==='public'||(privateScope&&row.schema_name==='custodial_recovery');
  if(sql===UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY)return structuredClone(relations.filter(row=>included(row)&&(row.schema_name==='custodial_recovery'||row.relation_kind==='f')));
  if(sql===UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY)return structuredClone(types.filter(row=>included(row)&&(row.schema_name==='custodial_recovery'||row.type_kind==='c')));
  const entry=Object.entries(SCHEMA_CATALOG_QUERIES).find(([,text])=>text===sql);
  assert.ok(entry,'only the existing fixed catalog queries may execute');
  const [name]=entry;
  const selected=structuredClone(rows[name].filter(row=>!row.schema_name||included(row)));
  const keys=name==='functions'?['function_name','identity_arguments']:
   name==='routine_grants'?['function_name','identity_arguments','grantee','grantor','privilege_type']:
   name==='schema_grants'?['grantee','grantor','privilege_type']:[];
  if(sql.includes('order by n.nspname,'))keys.unshift('schema_name');
  selected.sort((a,b)=>{for(const key of keys){if(a[key]<b[key])return -1;if(a[key]>b[key])return 1;}return 0;});
  return selected;
 }
 class Client{
  constructor(options){assert.equal(options.ssl.rejectUnauthorized,true);}
  async connect(){calls.push('connect');}
  async query(sql){
   calls.push(sql);
   if(sql.startsWith('select current_setting'))return{rows:[{read_only:'on'}]};
   if(sql.startsWith('begin')||sql==='rollback'||sql==='set local row_security = off')return{rows:[]};
   const prefix="select coalesce(json_agg(row_to_json(q)),'[]'::json) as catalog_rows from (";
   assert.ok(sql.startsWith(prefix)&&sql.endsWith(') q'));
   let original=sql.slice(prefix.length,-3);
   if(original===NATIVE_CRON_CATALOG_SQL)original=SCHEMA_CATALOG_QUERIES.cron_jobs;
   return{rows:[{catalog_rows:queryRows(original)}]};
  }
  async end(){ended=true;}
 }
 return{Client,calls,ended:()=>ended,direct:{query:async sql=>({rows:queryRows(sql)})}};
}
async function readRecoveryCatalog(f){
 return readCatalogReadOnly({connectionString:url,caPem:ca,Client:f.Client});
}
test('PRIVATE_RECOVERY_capture includes exact private overloads owners and ACL rows',async()=>{
 const f=recoveryCatalogFixture(),captured=await readRecoveryCatalog(f);
 assert.equal(captured.functions.filter(row=>row.schema_name==='custodial_recovery').length,2,'private function definitions must be captured, not silently absent');
 assert.deepEqual(captured.functions.map(row=>[row.schema_name,row.identity_arguments,row.owner_name]),
  [['custodial_recovery','v integer','migration_owner'],['custodial_recovery','v text','migration_owner'],['public','v text','migration_owner']]);
 assert.deepEqual(captured.routine_grants.map(row=>row.grantee),['migration_owner','service_role']);
 assert.equal(captured.schema_grants[0].schema_name,'custodial_recovery');
 assert.equal(f.calls[1],'begin isolation level repeatable read read only deferrable');
 assert.equal(f.calls.at(-1),'rollback');assert.equal(f.ended(),true);
 for(const name of ['functions','routine_grants','schema_grants']){
  assert.match(SCHEMA_CATALOG_QUERIES[name],/n\.nspname in \('public','custodial_recovery','custodial_employment','custodial_coverall','custodial_leadership_private'\)/);
  assert.match(SCHEMA_CATALOG_QUERIES[name],/order by n\.nspname,/);
 }
 // Owner ACL entries are real aclexplode rows, not fabricated owner markers.
 assert.match(SCHEMA_CATALOG_QUERIES.routine_grants,/and \(n\.nspname<>'public' or coalesce/);
 assert.match(SCHEMA_CATALOG_QUERIES.routine_grants,/aclexplode\(coalesce\(p\.proacl,acldefault\('f',p\.proowner\)\)\)/);
});
test('PRIVATE_RECOVERY_drift changes fingerprint and refuses original archive verification',async()=>{
 const rows=recoveryCatalogRows(),base=await readRecoveryCatalog(recoveryCatalogFixture({rows}));
 const x=input();x.catalog=base;x.declaration.observed_catalog_fingerprint=fingerprintSchemaCatalog(base).fingerprint;
 const bound=bindBackupSchemaExtension(x),saved={summary:{project_ref:x.projectRef,source_identity:{release:x.releaseIdentity,migration_head:bound.captured_migration_head,migration_ledger_count:x.migrationLedger.length}},binding:bound,catalog:base,ledger:x.migrationLedger};
 assert.equal(verifyArchivedSchemaExtension(saved),true);
 const changes=[
  ['body',v=>v.functions[1].definition+=' -- changed original body'],
  ['signature',v=>v.functions[1].identity_arguments='v bigint'],
  ['owner',v=>v.functions[1].owner_name='unexpected_owner'],
  ['execute grantee',v=>v.routine_grants[0].grantee='PUBLIC'],
  ['execute grant option',v=>v.routine_grants[0].is_grantable=true],
  ['owner execute ACL',v=>v.routine_grants.pop()],
  ['namespace ACL',v=>v.schema_grants[0].privilege_type='CREATE']];
 for(const [label,change]of changes){
  const changed=structuredClone(rows);change(changed);
  const actual=await readRecoveryCatalog(recoveryCatalogFixture({rows:changed}));
  assert.notEqual(fingerprintSchemaCatalog(actual).fingerprint,bound.catalog_fingerprint,label);
  assert.throws(()=>verifyArchivedSchemaExtension({...saved,catalog:actual}),undefined,label);
 }
});
test('PRIVATE_RECOVERY_relations refuse through capture and normal readonly rollback',async()=>{
 assert.match(UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY,/\(n\.nspname in \('public','custodial_employment','custodial_coverall','custodial_leadership_private'\) and c\.relkind in \('f'\)\) or n\.nspname='custodial_recovery'/);
 for(const kind of ['r','p','S','v','m','f','c','i','I']){
  const f=recoveryCatalogFixture({relations:[{schema_name:'custodial_recovery',relation_name:'unexpected_original',relation_kind:kind}]});
  await assert.rejects(captureSchemaCatalog(f.direct),/Unsupported custodial_recovery relation class/);
  await assert.rejects(readRecoveryCatalog(f),error=>error.code==='CATALOG_READ_FAILED');
  assert.equal(f.calls.at(-1),'rollback');assert.equal(f.ended(),true);
 }
 const publicForeign=recoveryCatalogFixture({relations:[{schema_name:'public',relation_name:'foreign_original',relation_kind:'f'}]});
 await assert.rejects(captureSchemaCatalog(publicForeign.direct),/Unsupported public foreign table/);
});
test('PRIVATE_RECOVERY_types including noncomposites refuse without relation dependency',async()=>{
 assert.match(UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY,/left join pg_class c/);
 assert.match(UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY,/\(n\.nspname='public' and t\.typtype='c' and c\.relkind='c'\) or n\.nspname='custodial_recovery'/);
 for(const kind of ['b','c','d','e','r','m','p']){
  const f=recoveryCatalogFixture({types:[{schema_name:'custodial_recovery',type_name:'unexpected_type',type_kind:kind}]});
  await assert.rejects(captureSchemaCatalog(f.direct),/Unsupported custodial_recovery type class/);
  await assert.rejects(readRecoveryCatalog(f),error=>error.code==='CATALOG_READ_FAILED');
  assert.equal(f.calls.at(-1),'rollback');assert.equal(f.ended(),true);
 }
 const publicComposite=recoveryCatalogFixture({types:[{schema_name:'public',type_name:'composite_original',type_kind:'c'}]});
 await assert.rejects(captureSchemaCatalog(publicComposite.direct),/Unsupported public composite type/);
});
test('PRIVATE_RECOVERY_historical fixed rows retain exact original hash and format',async()=>{
 const rows=structuredClone(catalog);
 rows.functions=[{schema_name:'public',function_name:'historical',identity_arguments:'v integer',owner_name:'migration_owner',definition:'CREATE FUNCTION public.historical(v integer) RETURNS integer LANGUAGE sql AS $$ SELECT v $$',object_comment:null}];
 rows.schema_grants=[{schema_name:'public',grantee:'PUBLIC',grantor:'migration_owner',privilege_type:'USAGE',is_grantable:false}];
 // Recorded with the original 6fed4619 catalog implementation, before edits.
 const originalHash='63e017cbf003621c2496755685aa463efdcbf28d26a039fd168ba4d1707837d0';
 assert.equal(fingerprintSchemaCatalog(rows).fingerprint,originalHash);
 const captured=await readRecoveryCatalog(recoveryCatalogFixture({rows}));
 assert.equal(fingerprintSchemaCatalog(captured).fingerprint,originalHash);
 assert.deepEqual(Object.keys(captured),Object.keys(catalog));
 assert.equal(declaredSourceFingerprint,'0096e7c488aca86f1d38b061561696b2d4ac409036f063ffc9f196625b9ee9c2');
});

// Only the new RECOVERY_OWNER_ members are selected for this product leaf.
// These are fixed-query RECORDING fixtures and unchanged binding consumers,
// not executed PostgreSQL, genuine archive signatures or restore authority.
const recoveryOwner=(owner_name='custodial_schema_owner_fixture')=>({schema_name:'custodial_recovery',owner_name});
function ownerBoundArchive(captured){
 const x=input();x.catalog=captured;x.declaration.observed_catalog_fingerprint=fingerprintSchemaCatalog(captured).fingerprint;
 const bound=bindBackupSchemaExtension(x);
 return {x,bound,saved:{summary:{project_ref:x.projectRef,source_identity:{release:x.releaseIdentity,
  migration_head:bound.captured_migration_head,migration_ledger_count:x.migrationLedger.length}},
  binding:bound,catalog:captured,ledger:x.migrationLedger}};
}
test('RECOVERY_OWNER_capture is independent of function owners and namespace ACL in one readonly snapshot',async()=>{
 const f=recoveryCatalogFixture({schemaOwners:[recoveryOwner()]}),captured=await readRecoveryCatalog(f);
 if(!Object.hasOwn(captured,'recovery_schema_owners'))console.log('RECOVERY_OWNER_ORIGINAL_CAPTURE '+JSON.stringify({fingerprint:fingerprintSchemaCatalog(captured).fingerprint}));
 assert.deepEqual(captured.recovery_schema_owners,[recoveryOwner()],'actual namespace owner must not be omitted or inferred from function owners/ACL');
 assert(captured.functions.every(row=>row.owner_name==='migration_owner'));
 assert.equal(captured.schema_grants[0].grantee,'migration_owner');
 assert.equal(captured.schema_grants.length,1,'no fabricated ACL owner row');
 const sql=CatalogSource.RECOVERY_SCHEMA_OWNERS_QUERY;
 assert.match(sql,/pg_get_userbyid\(n\.nspowner\)/);
 assert.match(sql,/where n\.nspname='custodial_recovery' order by n\.nspname$/);
 assert.match(sql,/in \('postgres','supabase_admin'\) then 'migration_owner'/);
 assert.equal(f.calls.filter(query=>query.includes(sql)).length,1);
 assert.equal(f.calls[1],'begin isolation level repeatable read read only deferrable');assert.equal(f.calls.at(-1),'rollback');assert.equal(f.ended(),true);
});
test('RECOVERY_OWNER_drift alone changes fingerprint and both original binding consumers refuse',async()=>{
 const original=await readRecoveryCatalog(recoveryCatalogFixture({schemaOwners:[recoveryOwner()]}));
 const changed=await readRecoveryCatalog(recoveryCatalogFixture({schemaOwners:[recoveryOwner('different_schema_owner_fixture')]}));
 assert.deepEqual(original.functions,changed.functions);assert.deepEqual(original.routine_grants,changed.routine_grants);assert.deepEqual(original.schema_grants,changed.schema_grants);
 const {x,bound,saved}=ownerBoundArchive(original);assert.equal(verifyArchivedSchemaExtension(saved),true);
 assert.notEqual(fingerprintSchemaCatalog(changed).fingerprint,bound.catalog_fingerprint);
 assert.throws(()=>bindBackupSchemaExtension({...x,catalog:changed}),/Undeclared database schema or privilege drift/);
 assert.throws(()=>verifyArchivedSchemaExtension({...saved,catalog:changed}));
 const withoutOwner=structuredClone(original);delete withoutOwner.recovery_schema_owners;
 assert.throws(()=>verifyArchivedSchemaExtension({...saved,catalog:withoutOwner}),'new signed catalog cannot silently lose its owner field');
 assert.equal(bound.production_mutation_authorized,false);assert.equal(bound.application_upgrade_claimed,false);
});
test('RECOVERY_OWNER_empty namespace and unexpected named owner are retained exactly without defaults',async()=>{
 for(const owner_name of ['migration_owner','Unexpected owner 🌿']){
  const rows=structuredClone(catalog),captured=await readRecoveryCatalog(recoveryCatalogFixture({rows,schemaOwners:[recoveryOwner(owner_name)]}));
  assert.deepEqual(captured.recovery_schema_owners,[recoveryOwner(owner_name)]);
  assert.equal(captured.functions.length,0);assert.equal(captured.schema_grants.length,0);
  assert.deepEqual(Object.keys(captured.recovery_schema_owners[0]).sort(),['owner_name','schema_name']);
 }
});
test('RECOVERY_OWNER_missing malformed duplicate or unavailable owner refuses rather than claiming absence',async()=>{
 const bad=[[],null,{},[null],[{}],[{schema_name:'custodial_recovery'}],
  [{schema_name:'public',owner_name:'migration_owner'}],
  [recoveryOwner('')],[recoveryOwner(null)],[recoveryOwner(4)],[recoveryOwner('bad\u0000role')],[recoveryOwner('\ud800')],
  [{...recoveryOwner(),invented:true}],[recoveryOwner(),recoveryOwner()]];
 for(const schemaOwners of bad){
  const f=recoveryCatalogFixture({schemaOwners});
  await assert.rejects(captureSchemaCatalog(f.direct),undefined,JSON.stringify(schemaOwners));
  const expectedCode=Array.isArray(schemaOwners)?'CATALOG_READ_FAILED':'ERR_ASSERTION';
  await assert.rejects(readRecoveryCatalog(f),e=>e.code===expectedCode);
  assert.equal(f.calls.at(-1),'rollback');assert.equal(f.ended(),true);
 }
 const denied=recoveryCatalogFixture({schemaOwnerError:Object.assign(Error('owner read denied'),{code:'42501'})});
 await assert.rejects(readRecoveryCatalog(denied),e=>e.code==='42501');assert.equal(denied.calls.at(-1),'rollback');assert.equal(denied.ended(),true);
});
test('RECOVERY_OWNER_absent private namespace preserves the exact public historical fingerprint and format',async()=>{
 const rows=structuredClone(catalog);
 rows.functions=[{schema_name:'public',function_name:'historical',identity_arguments:'v integer',owner_name:'migration_owner',definition:'CREATE FUNCTION public.historical(v integer) RETURNS integer LANGUAGE sql AS $$ SELECT v $$',object_comment:null}];
 rows.schema_grants=[{schema_name:'public',grantee:'PUBLIC',grantor:'migration_owner',privilege_type:'USAGE',is_grantable:false}];
 const captured=await readRecoveryCatalog(recoveryCatalogFixture({rows,schemaOwners:[]}));
 assert.equal(Object.hasOwn(captured,'recovery_schema_owners'),false);assert.deepEqual(Object.keys(captured),Object.keys(catalog));
 assert.equal(fingerprintSchemaCatalog(captured).fingerprint,'63e017cbf003621c2496755685aa463efdcbf28d26a039fd168ba4d1707837d0');
 assert.equal(declaredSourceFingerprint,'0096e7c488aca86f1d38b061561696b2d4ac409036f063ffc9f196625b9ee9c2');
});
test('RECOVERY_OWNER_historical private catalog remains its original hash not new owner admission',()=>{
 // Same synthetic rows as the retained pre-change capture, ordered by its
 // existing fixed SQL. This is historical DATA, never a fresh capture.
 const historical=recoveryCatalogRows();
 historical.functions.sort((a,b)=>a.schema_name.localeCompare(b.schema_name)||a.identity_arguments.localeCompare(b.identity_arguments));
 historical.routine_grants.sort((a,b)=>a.grantee.localeCompare(b.grantee));
 assert.equal(Object.hasOwn(historical,'recovery_schema_owners'),false);
 assert.equal(fingerprintSchemaCatalog(historical).fingerprint,'b1ee20255061eba16aa9c9dff4784e9693cdd56aac65fde76931100e1494eef2');
 const {saved,bound}=ownerBoundArchive(historical);assert.equal(verifyArchivedSchemaExtension(saved),true);
 assert.equal(bound.application_upgrade_claimed,false);assert.equal(bound.production_mutation_authorized,false);
});


test('installed operational-day source is byte-bound and excluded from both replay selectors',()=>{
 const extension=declaration.extensions.at(-1),name=extension.source_file;
 assert.equal(extension.source_location,'retained_installed');
 assert.equal(source(name,extension.source_location).byteLength,4184);
 assert.equal(fs.existsSync(new URL('../supabase/migrations/'+name,import.meta.url)),false);
 const discovered=fs.readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(file=>file.endsWith('.sql'));
 assert.equal(discovered.includes(name),false);
 // Four declared installed extensions also retain their exact canonical SQL.
 const sharedCanonicalNames=[
  '20261006031304_custodial_owner_delegated_actions.sql',
  '20261006113610_custodial_shared_events_outlook.sql',
  '20261006162427_custodial_shared_events_recovery_binding.sql',
  '20261006203931_custodial_delegated_coverall.sql',
 ];
 assert.deepEqual(declaration.extensions.filter(installed=>discovered.includes(installed.source_file)).map(installed=>installed.source_file),sharedCanonicalNames);
 for(const installed of declaration.extensions){
  assert.equal(discovered.includes(installed.source_file),sharedCanonicalNames.includes(installed.source_file));
  if(sharedCanonicalNames.includes(installed.source_file))
   assert.deepEqual(source(installed.source_file,'migration'),source(installed.source_file,installed.source_location));
 }
 const pending=JSON.parse(fs.readFileSync(new URL('../release/production-migration-state.json',import.meta.url),'utf8')).pending_migrations;
 assert.equal(pending.some(row=>row.file===name||row.source_migration_version===extension.ledger_version),false);
});
test('unknown retained source location refuses before a source file can be borrowed',()=>{
 const x=input();x.declaration.extensions.at(-1).source_location='other';let opened=false;
 const read=x.readSource;x.readSource=(name,location)=>{if(name===x.declaration.extensions.at(-1).source_file)opened=true;return read(name,location);};
 assert.throws(()=>bindBackupSchemaExtension(x),/Unknown installed source location/);assert.equal(opened,false);
 const a=archive();a.binding={...a.binding,extensions:a.binding.extensions.map(row=>({...row}))};a.binding.extensions.at(-1).source_location='other';
 assert.throws(()=>verifyArchivedSchemaExtension(a),/Unknown installed source location/);
});
