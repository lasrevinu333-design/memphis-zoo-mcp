// Actual retained catalog bytes and strict refusal checks; no SQL or production writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {resolveReleaseSchemaTarget,validateProductionTargetSchemaProfile} from '../production-target-schema-profile.mjs';
import {fingerprintSchemaCatalog} from '../schema-fingerprint-catalog.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),read=n=>fs.readFileSync(resolve(root,n)),json=n=>JSON.parse(read(n));
const report=json('release/schema-evidence/SOURCE304_SEALED_POPULATED_TARGET_CAPTURE.json');
const canonical=json('supabase/canonical/schema-fingerprint-input.json'),profile=json('release/production-target-schema-profile.json');
const result=resolveReleaseSchemaTarget(root);
assert.equal(report.candidate_commit,'d3b8bbc1ed9a0a90e55da4756713d57475f704c8');
assert.equal(report.rollback_verified,true);assert.equal(report.committed,false);
for(const key of ['production_authorized','candidate_migration_admission','runtime_admission','full_rehearsal_attestation'])assert.equal(report[key],false);
assert.equal(report.source_ledger_count,235);assert.equal(report.target_ledger_count,405);assert.equal(report.applied.length,170);
assert.equal(report.target_ledger_head,'20261031225210');
assert.deepEqual(result.deploymentCatalog,fingerprintSchemaCatalog(report.catalog).normalized);
assert.equal(result.canonicalFingerprint,'ff233923ac21cd46b70985a9eaeb20dbb2a4c0bdc6f69f527159d437ed893440');
assert.equal(result.deploymentFingerprint,'c2c92fe0711ff89fef66430feec40eaf6f93cff7254db4fbfdebbf7816722549');
assert.equal(result.canonicalCounts.role_memberships,10);assert.equal(result.deploymentCounts.role_memberships,25);
assert.equal(report.source_data_preservation.original_tables,217);
const renamed=report.source_data_preservation.tables.find(x=>x.table==='public.location_groups');
assert.equal(renamed.source_eligible,'1');assert.equal(renamed.current_eligible,'1');assert.equal(renamed.invalid_transformation,'0');
for(const row of report.source_data_preservation.tables){assert.equal(row.missing_rows,'0');if(row.table!=='public.events_app_event_history')assert.equal(row.extra_rows,'0');}
const state=json('release/production-migration-state.json');assert.equal(state.target.production_ledger_count,405);assert.equal(state.pending_migrations.length,170);
assert.deepEqual(state.pending_migrations.slice(0,169),json('release/schema-evidence/SOURCE303_PREDECESSOR_PRODUCTION_MIGRATION_STATE.json').pending_migrations);
assert.equal(state.target.canonical_source_schema_fingerprint,result.deploymentFingerprint);
const edits=[p=>p.source_migrations=303,p=>p.capture.pending_count=169,p=>p.capture.target_ledger_count=404,p=>p.capture.report_sha256='0'.repeat(64),p=>p.capture.candidate_commit='0'.repeat(40),p=>p.archive_digest='0'.repeat(64),p=>p.deployment_fingerprint=p.canonical_fingerprint,p=>p.catalog_delta.role_memberships.add.pop(),p=>p.catalog_delta.functions.remove.pop(),p=>p.catalog_delta.columns.order[0]=p.catalog_delta.columns.order[1],p=>p.qualification='PRODUCTION_ACCEPTED',p=>p.ignore_rls=true];
for(const edit of edits){const changed=structuredClone(profile);edit(changed);assert.throws(()=>validateProductionTargetSchemaProfile(canonical,changed));}
for(const row of profile.evidence){const b=read(row.path);assert.equal(b.length,row.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),row.sha256);}
console.log(JSON.stringify({status:'PASS_ACTUAL304_RETAINED_FRESH_AND_POPULATED_CATALOGS',originalTables:217,pending:170,ledger:405,refusals:edits.length,liveSQL:false,productionAuthorized:false,fullRehearsalAttestation:false}));
