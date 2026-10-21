import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {productionForwardSourceManifest,releaseMigrationPlanIdentity,resolveReleaseMigrationSource,bindExistingPostgresForwardSources} from './production-forward-source.mjs';
import {stableJson} from './disaster-recovery-crypto.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));const sha=x=>createHash('sha256').update(x).digest('hex');
let checks=0;const test=(name,fn)=>{fn();checks++;};
const manifest=productionForwardSourceManifest(root),state=JSON.parse(fs.readFileSync(join(root,'release/production-migration-state.json')));
const oldIdentity=state.pending_migrations.map(({order,source_migration_version,file,sha256})=>({order,source_migration_version,file,sha256}));
test('old signed identity byte shape unchanged',()=>assert.equal(stableJson(releaseMigrationPlanIdentity(state.pending_migrations)),stableJson(oldIdentity)));
for(const item of state.pending_migrations)test('actual legacy source admission '+item.file,()=>{if(manifest.migrations.some(x=>x.canonical_file===item.file))assert.throws(()=>resolveReleaseMigrationSource(root,item),/Exact production forward-source binding required/);else resolveReleaseMigrationSource(root,item);});
const canonical=manifest.migrations.map((x,index)=>({order:index+1,file:x.canonical_file,source_migration_version:x.canonical_file.slice(0,14),phase:x.canonical_file.slice(15,-4),sha256:x.canonical_sha256}));
const produced=bindExistingPostgresForwardSources(root,canonical);
for(const [index,item] of produced.entries()){
 test('actual produced source DTO reaches resolver '+index,()=>{const actual=resolveReleaseMigrationSource(root,item);assert.equal(sha(actual.sql),item.sha256);assert.equal(actual.canonical_sha256,canonical[index].sha256);});
 test('both hashes enter actual producer-consumer identity '+index,()=>{const identity=releaseMigrationPlanIdentity([item])[0];assert.equal(identity.sha256,item.sha256);assert.equal(identity.forward_source.canonical_sha256,canonical[index].sha256);assert.notEqual(identity.sha256,identity.forward_source.canonical_sha256);});
 const original=fs.readFileSync(join(root,'supabase/migrations',item.file),'utf8'),variant=resolveReleaseMigrationSource(root,item).sql;
 function bodies(sql){if(['20261010193211_native_private_custody_chunk_retention.sql','20261011000206_native_private_custody_complete_frame_readback.sql'].includes(item.file))sql=sql.replace(/\$(existing_profile(?:253)?_json)\$([\s\S]*?)\$\1\$/g,(_literal,tag,json)=>{assert.equal(JSON.parse(json).schema,item.file.startsWith('20261010193211')?'custodial.source252-existing-original-postgres.v1':'custodial.source253-existing-original-postgres.v1');return '$'+tag+'${}$'+tag+'$';});const output=[];const regex=/\bcreate\s+(?:or\s+replace\s+)?function\s+([\s\S]*?)\bas\s+(\$[a-z0-9_]*\$)([\s\S]*?)\2/gi;let m;while((m=regex.exec(sql)))output.push({header:m[1],body:m[3]});return output;}
 test('all existing canonical routine bodies and signatures exact '+index,()=>{const before=bodies(original),after=bodies(variant);assert.ok(before.length>=1||['20261002120000_october_dated_recovery_inventory_rebind.sql','20261003220000_current_release_authority_completion.sql','20261006190426_manager_scheduler_recovery_binding.sql'].includes(item.file));assert.deepEqual(after,before);});
 test('fixed project/current owner/origin guards remain exact '+index,()=>{assert.ok(variant.includes("current_user<>'postgres' OR session_user<>current_user"));assert.ok(variant.includes("'rqquvtjdmugpigbndmne'"));assert.ok(variant.includes("AND NOT rolsuper AND rolbypassrls"));assert.ok(variant.includes("relowner='postgres'::regrole"));});
 for(const mutate of [x=>delete x.forward_source,x=>x.forward_source.profile='supabase_admin',x=>x.forward_source.canonical_sha256='0'.repeat(64),x=>x.forward_source.file='../outside.sql',x=>x.sha256='0'.repeat(64),x=>x.forward_source.sha256='0'.repeat(64),x=>x.forward_source.extra='not-admitted',x=>x.forward_source.schema='unknown'])test('changed exact binding refused '+index,()=>{const changed=structuredClone(item);mutate(changed);assert.throws(()=>resolveReleaseMigrationSource(root,changed));});
}
for(const name of ['apply-release-migration-plan.mjs','create-release-migration-authorization.mjs'])test('shipping producer and consumer use same actual source identity '+name,()=>{const source=fs.readFileSync(join(root,'scripts',name),'utf8');assert.ok(source.includes('releaseMigrationPlanIdentity('));assert.ok(source.includes('resolveReleaseMigrationSource('));});
// Deliberately alter only copied task-local preimages; never the Source tree.
const owned=fs.mkdtempSync(new URL('../../forward-negative-',import.meta.url));fs.mkdirSync(join(owned,'supabase/migrations'),{recursive:true});fs.mkdirSync(join(owned,'release/production-forward-source'),{recursive:true});fs.copyFileSync(join(root,'release/production-forward-source/manifest.json'),join(owned,'release/production-forward-source/manifest.json'));
for(const item of manifest.migrations){fs.copyFileSync(join(root,'supabase/migrations',item.canonical_file),join(owned,'supabase/migrations',item.canonical_file));fs.copyFileSync(join(root,item.forward_file),join(owned,item.forward_file));}
const item=produced[0],forwardPath=join(owned,item.forward_source.file),canonicalPath=join(owned,'supabase/migrations',item.file),forward=fs.readFileSync(forwardPath),preimage=fs.readFileSync(canonicalPath);
test('changed executed SQL refused',()=>{fs.appendFileSync(forwardPath,'\n-- altered\n');assert.throws(()=>resolveReleaseMigrationSource(owned,item));fs.writeFileSync(forwardPath,forward);});
test('changed canonical preimage refused',()=>{fs.appendFileSync(canonicalPath,'\n-- altered\n');assert.throws(()=>resolveReleaseMigrationSource(owned,item));fs.writeFileSync(canonicalPath,preimage);});
// The real locked-transaction adapter reads the same fixed native cron
// projection even when original production has NO private metadata helper.
const {captureCatalogFromSnapshot,NATIVE_CRON_CATALOG_SQL}=await import('./schema-catalog-readonly-client.mjs');
const {SCHEMA_CATALOG_QUERIES,UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY,UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY,RECOVERY_SCHEMA_OWNERS_QUERY,fingerprintSchemaCatalog}=await import('./schema-fingerprint-catalog.mjs');
const data=JSON.parse(fs.readFileSync(join(root,'supabase/canonical/schema-fingerprint-input.json')));
const lookup=new Map(Object.entries(SCHEMA_CATALOG_QUERIES).map(([name,sql])=>[sql===SCHEMA_CATALOG_QUERIES.cron_jobs?NATIVE_CRON_CATALOG_SQL:sql,data[name]]));
lookup.set(UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY,[]);lookup.set(UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY,[]);lookup.set(RECOVERY_SCHEMA_OWNERS_QUERY,data.recovery_schema_owners||[]);
const prefix="select coalesce(json_agg(row_to_json(q)),'[]'::json) as catalog_rows from (",suffix=') q';let nativeCronReads=0;
function client(deny=false){return {async query(sql){
 if(sql==='set local row_security = off')return {rows:[]};
 assert.ok(sql.startsWith(prefix)&&sql.endsWith(suffix));const statement=sql.slice(prefix.length,-suffix.length);
 assert.ok(lookup.has(statement),'Only existing exact catalog queries may execute');
 assert.ok(!statement.includes('custodial_schema_identity_cron_jobs()'),'No private helper substituted into original source');
 if(statement===NATIVE_CRON_CATALOG_SQL){nativeCronReads++;if(deny)throw Object.assign(Error('source recording denial'),{code:'42501'});}
 return {rows:[{catalog_rows:structuredClone(lookup.get(statement))}]};
}};}
const captured=await captureCatalogFromSnapshot(client());assert.equal(fingerprintSchemaCatalog(captured).fingerprint,fingerprintSchemaCatalog(data).fingerprint);assert.equal(nativeCronReads,1);checks++;
await assert.rejects(captureCatalogFromSnapshot(client(true)),error=>error.code==='42501');checks++;
const application=fs.readFileSync(join(root,'scripts/apply-release-migration-plan.mjs'),'utf8');assert.equal((application.match(/await captureCatalogFromSnapshot\(db\)/g)||[]).length,4);assert.ok(!application.includes('await captureSchemaCatalog('));checks++;
console.log(JSON.stringify({status:'PASS_SOURCE_ONLY',checks,old_pending:state.pending_migrations.length,actual_manifest_producer_consumer_join:true,canonical_routine_bodies_unchanged:true,SQL_executed:false,populated_real_owner_rehearsal:'PENDING',production:false}));
