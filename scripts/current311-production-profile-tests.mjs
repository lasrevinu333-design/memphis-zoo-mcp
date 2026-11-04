import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {resolveReleaseSchemaTarget,validateProductionTargetSchemaProfile} from './production-target-schema-profile.mjs';
import {fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';
import {stableJson} from './disaster-recovery-crypto.mjs';
const read=f=>JSON.parse(fs.readFileSync(new URL('../'+f,import.meta.url)));const root=new URL('..',import.meta.url).pathname;
const p=read('release/production-target-schema-profile.json'),canonical=read('supabase/canonical/schema-fingerprint-input.json'),capture=read('release/schema-evidence/SOURCE311_POPULATED_TARGET_CAPTURE.json'),fresh=read('release/schema-evidence/SOURCE311_AUDITED_FRESH_CATALOG.json'),target=resolveReleaseSchemaTarget(root);
assert.equal(target.canonicalFingerprint,fresh.schema_fingerprint);assert.equal(target.deploymentFingerprint,capture.target_catalog_fingerprint);
assert.deepEqual(target.canonicalCatalog,fingerprintSchemaCatalog(fresh.catalog).normalized);assert.deepEqual(target.deploymentCatalog,fingerprintSchemaCatalog(capture.catalog).normalized);
assert.equal(capture.rollback_verified,true);assert.equal(capture.committed,false);assert.equal(capture.applied.length,177);assert.equal(capture.source_data_preservation.original_tables,219);
for(const k of ['production_authorized','candidate_migration_admission','runtime_admission','full_rehearsal_attestation'])assert.equal(capture[k],false);
assert.deepEqual(Object.keys(p.catalog_delta).sort(),['default_privileges','functions','policies','table_grants']);
const defaults=p.catalog_delta.default_privileges;assert.equal(defaults.remove.length,0);assert.equal(defaults.add.length,11);assert.ok(defaults.add.every(x=>x.grantee==='service_role'&&!x.is_grantable));
const f=p.catalog_delta.functions;assert.equal(f.remove.length,1);assert.equal(f.add.length,1);assert.equal(f.add[0].function_name,'custodial_release_canary_authority_surface');
const {definition:before,...a}=f.remove[0],{definition:after,...b}=f.add[0];assert.deepEqual(a,b);assert.deepEqual(before.split('\n').sort(),after.split('\n').sort());
const policies=p.catalog_delta.policies;assert.equal(policies.remove.length,6);assert.equal(policies.add.length,6);
for(const row of policies.remove){assert.deepEqual(row.roles,['supabase_admin']);assert.ok(policies.add.some(x=>stableJson(x)===stableJson({...row,roles:['postgres']})));}
const grants=p.catalog_delta.table_grants;assert.equal(grants.remove.length,304);assert.equal(grants.add.length,459);
for(const row of grants.remove){assert.equal(row.grantee,'supabase_admin');assert.ok(grants.add.some(x=>stableJson(x)===stableJson({...row,grantee:'postgres'})));}
const service=grants.add.filter(x=>x.grantee==='service_role');assert.equal(service.length,155);assert.ok(service.every(x=>x.grantor==='migration_owner'&&!x.is_grantable));
for(const mutate of [x=>x.deployment_fingerprint='0'.repeat(64),x=>x.archive_digest='0'.repeat(64),x=>x.capture.plan_sha256='0'.repeat(64),x=>x.catalog_delta.policies.add[0].roles=['anon'],x=>x.catalog_delta.table_grants.add.push({...service[0],grantee:'anon'}),x=>x.catalog_delta.functions.add[0].definition+=' select 1;',x=>x.evidence.pop()]){const changed=structuredClone(p);mutate(changed);assert.throws(()=>validateProductionTargetSchemaProfile(canonical,changed));}
const old=read('release/schema-evidence/SOURCE304_PREDECESSOR_PRODUCTION_MIGRATION_STATE.json'),current=read('release/production-migration-state.json');assert.deepEqual(current.pending_migrations.slice(0,170),old.pending_migrations);assert.deepEqual(current.historical_304_170_target_preparation,{source_binding:old.source_binding,target:old.target,pending_migrations:old.pending_migrations});
assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../release/schema-evidence/SOURCE304_PREDECESSOR_PRODUCTION_TARGET_PROFILE.json',import.meta.url))).digest('hex'),'6e8fe3f4b1d326a05afe542a49a909e9830850379bff06b673bb75cf3f3c6869');
console.log(JSON.stringify({status:'PASS_CURRENT311_PROFILE_SOURCE_ONLY',exact_actual_catalogs:true,known_differences_only:true,original170_plan_preserved:true,negative_mutations:7,production:false}));
