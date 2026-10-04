// Test-only boundary between an accepted isolated publication and a later
// operation-owned confirmation. A shape check is not a database readback.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {assertCurrentManager219MigrationSet} from './fixtures/current-manager-219-source.mjs';
import {loadCurrentManagerPublicationFixture} from './fixtures/current-manager-publication-source.mjs';
import {assertMatchingRecurringOperationSource,recurringOperationSourceManifest}
 from '../src/static-weekly-recurring-operation-source.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const DIGEST=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const IMAGE='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const CURRENT_MANAGER='10000000-0000-4000-8000-000000000131';
const SECOND_MANAGER='10000000-0000-4000-8000-000000000273';
const ROOT=new URL('../',import.meta.url);
const requiredFiles=['scripts/run-isolated-shift-end-tests.mjs',
 'scripts/static-weekly-current-roster-publication-tests.mjs',
 'scripts/fixtures/current-manager-publication-source.mjs',
 'scripts/fixtures/current-manager-219-source.mjs',
 'scripts/static-weekly-current-manager-owned-checkpoint.mjs',
 'scripts/static-weekly-current-manager-owned-checkpoint-child.mjs',
 'scripts/static-weekly-current-manager-owned-stage.mjs',
 'scripts/static-weekly-recurring-confirmation-http-integration.mjs',
 'scripts/static-weekly-recurring-http-boundary.mjs'];

function closed(value,keys,label){
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value),`${label} must be an object`);
 assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),`${label} must have exact fields`);
 for(const key of keys)assert.ok(Object.hasOwn(value,key)&&Object.getOwnPropertyDescriptor(value,key)?.value!==undefined,
  `${label}.${key} must be a data field`);
 return value;
}
function match(value,pattern,label){assert.match(value??'',pattern,label);return value;}
function exactCheckpoint(checkpoint){
 closed(checkpoint,['schema','classification','basis','publication','environment','digest'],'checkpoint');
 assert.equal(checkpoint.schema,'custodial.synthetic-current-manager-219-owned-checkpoint.v1');
 assert.equal(checkpoint.classification,'SOURCE_BOUND_SQL_READBACK_CLAIM_NOT_INDEPENDENT_PROOF');
 match(checkpoint.digest,DIGEST,'checkpoint digest');
 assert.equal(checkpoint.digest,sha(JSON.stringify({schema:checkpoint.schema,classification:checkpoint.classification,
  basis:checkpoint.basis,publication:checkpoint.publication,environment:checkpoint.environment})));
 closed(checkpoint.basis,['migrationManifestDigest','operationSource','fixtureSha256','fixtureFiles'],'basis');
 assert.equal(checkpoint.basis.migrationManifestDigest,sha(JSON.stringify(assertCurrentManager219MigrationSet())));
 assertMatchingRecurringOperationSource(checkpoint.basis.operationSource);
 assert.equal(checkpoint.basis.fixtureSha256,sha(loadCurrentManagerPublicationFixture().bytes));
 assert.deepEqual(checkpoint.basis.fixtureFiles,requiredFiles.map(path=>({path,
  sha256:sha(readFileSync(new URL(`../${path}`,import.meta.url)))})));
 return checkpoint;
}

// The caller must obtain `publication` from persisted SQL under the existing
// service-only readers. This function cannot certify that the caller did so.
export function createCurrentManager219OwnedCheckpoint({publication,environment}){
 const {packet,bytes}=loadCurrentManagerPublicationFixture();
 const migrations=assertCurrentManager219MigrationSet();
 const operationSource=recurringOperationSourceManifest();
 assertMatchingRecurringOperationSource(operationSource);
 const fixtureFiles=requiredFiles.map(path=>({path,sha256:sha(readFileSync(new URL(`../${path}`,import.meta.url)))}));
 closed(environment,['containerName','containerId','image','network','socket','socketMount','database'],'environment');
 match(environment.containerName,/^mz_schema_shift_end_[0-9]+$/,'owned isolated container');
 match(environment.containerId,DIGEST,'exact Docker container ID');
 assert.equal(environment.image,IMAGE);
 assert.equal(environment.network,'none');
 match(environment.socket,/^\/tmp\/mz-shift-socket-[A-Za-z0-9]+$/,'owned Unix socket');
 assert.equal(environment.socketMount,'/test-socket');
 assert.equal(environment.database,'postgres');
 closed(publication,['managerId','secondManagerId','week','currentSourceId','currentSourceDigest',
  'originalSourceId','originalSourceDigest','versionId','publicationId','projectionId',
  'authorityRevision','projectionStatus','acceptedRows','relationalDigest','lunchIdentity',
  'lunchLoans','dates','defaultApiGrants','confirmationStatus'],'publication');
 assert.equal(publication.managerId,CURRENT_MANAGER);
 assert.equal(publication.secondManagerId,SECOND_MANAGER);
 assert.equal(publication.week,'2026-10-05');
 assert.equal(publication.currentSourceId,packet.sourceId);
 assert.equal(publication.currentSourceDigest,packet.sourceDigest);
 assert.equal(publication.originalSourceId,packet.original.sourceId);
 assert.equal(publication.originalSourceDigest,packet.original.sourceDigest);
 for(const field of ['versionId','publicationId','projectionId'])match(publication[field],UUID,field);
 assert.ok(Number.isSafeInteger(publication.authorityRevision)&&publication.authorityRevision>0);
 assert.equal(publication.projectionStatus,'current');
 assert.equal(publication.acceptedRows,packet.expectedDerivedRows);
 match(publication.relationalDigest,/^[a-f0-9]{32}$/,'accepted relational MD5');
 match(publication.lunchIdentity,DIGEST,'accepted lunch identity');
 assert.equal(publication.lunchLoans,packet.expectedLunchLoans);
 assert.equal(publication.defaultApiGrants,0);
 assert.equal(publication.confirmationStatus,'NOT_YET_ATTEMPTED');
 assert.ok(Array.isArray(publication.dates)&&publication.dates.length===7);
 for(let i=0;i<7;i++){
  const date=new Date(Date.parse('2026-10-05T12:00:00Z')+i*86400000).toISOString().slice(0,10);
  closed(publication.dates[i],['date','projectionId','projectionStatus','lunchIdentity','rosterCount','loanCount'],'date readback');
  assert.equal(publication.dates[i].date,date);
  assert.equal(publication.dates[i].projectionId,publication.projectionId);
  assert.equal(publication.dates[i].projectionStatus,'current');
  assert.equal(publication.dates[i].lunchIdentity,publication.lunchIdentity);
  const staff=packet.rosterSlots.filter(s=>s.days.includes(new Date(`${date}T12:00:00Z`).getUTCDay()));
  assert.equal(publication.dates[i].rosterCount,staff.length);
  assert.equal(publication.dates[i].loanCount,staff.filter(s=>s.personId).length);
 }
 const basis={migrationManifestDigest:sha(JSON.stringify(migrations)),operationSource,
  fixtureSha256:sha(bytes),fixtureFiles};
 const body={schema:'custodial.synthetic-current-manager-219-owned-checkpoint.v1',
  classification:'SOURCE_BOUND_SQL_READBACK_CLAIM_NOT_INDEPENDENT_PROOF',basis,publication,environment};
 return Object.freeze({...body,digest:sha(JSON.stringify(body))});
}

// This is a closed argv/URL recipe, not a clone or an availability receipt.
// A future runner must verify zero source sessions, execute on the exact owned
// container, then query and compare every checkpoint fact in the clone.
export function planCurrentManager219RehearsalClone(checkpoint,{suffix,sourceSessions}){
 exactCheckpoint(checkpoint);
 assertMatchingRecurringOperationSource(checkpoint.basis.operationSource);
 assert.equal(checkpoint.basis.migrationManifestDigest,sha(JSON.stringify(assertCurrentManager219MigrationSet())));
 match(suffix,/^[a-z0-9]{8,24}$/,'owned rehearsal suffix');
 assert.equal(sourceSessions,0,'clone requires no live source database sessions');
 const database=`mz_schema_rebuild_operation_${suffix}`;
 const source=checkpoint.environment;
 const statement=`CREATE DATABASE ${database} TEMPLATE postgres`;
 const url=new URL(`postgresql://supabase_admin:postgres@127.0.0.1/${database}`);
 url.searchParams.set('host',source.socket);
 const body={schema:'custodial.synthetic-current-manager-219-clone-plan.v1',
  classification:'PLAN_ONLY_NO_CLONE_OR_SQL_READBACK',checkpointDigest:checkpoint.digest,
  containerId:source.containerId,image:source.image,network:source.network,
  sourceDatabase:'postgres',database,socket:source.socket,
  argv:['docker','exec','-i',source.containerName,'psql','-X','-q','-v','ON_ERROR_STOP=1',
   '-U','supabase_admin','-d','template1','-c',statement],
  rehearsalUrl:url.toString(),allowInsecureLoopbackRehearsal:'1'};
 return Object.freeze({...body,digest:sha(JSON.stringify(body))});
}

// Only an exact independent SQL readback may promote a clone to an adapter.
// Even this function checks a caller-supplied receipt; actual persisted-query
// provenance belongs to the later invoked, network-none runner.
export function assertCurrentManager219CloneReadback(checkpoint,plan,readback){
 exactCheckpoint(checkpoint);
 closed(plan,['schema','classification','checkpointDigest','containerId','image','network',
  'sourceDatabase','database','socket','argv','rehearsalUrl','allowInsecureLoopbackRehearsal','digest'],'clone plan');
 assert.equal(plan.checkpointDigest,checkpoint.digest);
 assert.equal(plan.containerId,checkpoint.environment.containerId);
 assert.equal(plan.digest,sha(JSON.stringify(Object.fromEntries(Object.entries(plan).filter(([k])=>k!=='digest')))));
 const suffix=match(plan.database,/^mz_schema_rebuild_operation_([a-z0-9]{8,24})$/,'exact rehearsal DB').split('operation_')[1];
 assert.deepEqual(plan,planCurrentManager219RehearsalClone(checkpoint,{suffix,sourceSessions:0}),
  'complete clone command, socket URL and source boundary must match');
 closed(readback,['database','containerId','migrationManifestDigest','operationSourceDigest',
  'fixtureSha256','publication','defaultApiGrants'],'clone readback');
 assert.equal(readback.database,plan.database);
 assert.equal(readback.containerId,plan.containerId);
 assert.equal(readback.migrationManifestDigest,checkpoint.basis.migrationManifestDigest);
 assert.equal(readback.operationSourceDigest,checkpoint.basis.operationSource.digest);
 assert.equal(readback.fixtureSha256,checkpoint.basis.fixtureSha256);
 assert.deepEqual(readback.publication,checkpoint.publication);
 assert.equal(readback.defaultApiGrants,0);
 return Object.freeze({schema:'custodial.synthetic-current-manager-219-owned-adapter.v1',
  classification:'CALLER_READBACK_MATCHED_NOT_SQL_EXECUTION_PROOF',checkpointDigest:checkpoint.digest,
  clonePlanDigest:plan.digest,database:plan.database,
  STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL:plan.rehearsalUrl,
  STATIC_WEEKLY_CONTROL_PLANE_ALLOW_INSECURE_LOOPBACK_REHEARSAL:'1'});
}
