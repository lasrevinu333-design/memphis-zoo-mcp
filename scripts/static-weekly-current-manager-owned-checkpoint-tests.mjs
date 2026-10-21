import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadCurrentManagerPublicationFixture} from './fixtures/current-manager-publication-source.mjs';
import {createCurrentManager219OwnedCheckpoint,planCurrentManager219RehearsalClone,
 assertCurrentManager219CloneReadback} from './static-weekly-current-manager-owned-checkpoint.mjs';

const {packet}=loadCurrentManagerPublicationFixture();
const uuid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const days=Array.from({length:7},(_,i)=>{
 const date=new Date(Date.parse('2026-10-05T12:00:00Z')+i*86400000),dow=date.getUTCDay();
 const slots=packet.rosterSlots.filter(s=>s.days.includes(dow));
 return {date:date.toISOString().slice(0,10),projectionId:uuid(3),projectionStatus:'current',
  lunchIdentity:'a'.repeat(64),rosterCount:slots.length,loanCount:slots.filter(s=>s.personId).length};
});
const publication={managerId:'10000000-0000-4000-8000-000000000131',
 secondManagerId:'10000000-0000-4000-8000-000000000273',week:'2026-10-05',
 currentSourceId:packet.sourceId,currentSourceDigest:packet.sourceDigest,
 originalSourceId:packet.original.sourceId,originalSourceDigest:packet.original.sourceDigest,
 versionId:uuid(1),publicationId:uuid(2),projectionId:uuid(3),authorityRevision:7,
 projectionStatus:'current',acceptedRows:494,relationalDigest:'b'.repeat(32),
 lunchIdentity:'a'.repeat(64),lunchLoans:30,dates:days,defaultApiGrants:0,
 confirmationStatus:'NOT_YET_ATTEMPTED'};
const environment={containerName:'mz_schema_shift_end_12345',containerId:'c'.repeat(64),
 image:'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed',
 network:'none',socket:'/tmp/mz-shift-socket-abc123',socketMount:'/test-socket',database:'postgres'};
let checks=0;
function pass(name,fn){fn();checks++;console.log('PASS',name);}
const checkpoint=createCurrentManager219OwnedCheckpoint({publication,environment});
pass('complete source-bound 219/current323/original314 checkpoint shape',()=>{
 assert.equal(checkpoint.publication.currentSourceDigest,packet.sourceDigest);
 assert.equal(checkpoint.publication.originalSourceDigest,packet.original.sourceDigest);
 assert.equal(checkpoint.basis.operationSource.files.length>150,true);
 assert.equal(checkpoint.classification,'SOURCE_BOUND_SQL_READBACK_CLAIM_NOT_INDEPENDENT_PROOF');
});
const plan=planCurrentManager219RehearsalClone(checkpoint,{suffix:'abc12345',sourceSessions:0});
pass('closed exact clone argv and Unix-socket rehearsal URL',()=>{
 assert.equal(plan.network,'none');
 assert.equal(plan.argv.at(-1),'CREATE DATABASE mz_schema_rebuild_operation_abc12345 TEMPLATE postgres');
 assert.deepEqual(new URL(plan.rehearsalUrl).searchParams.get('host'),environment.socket);
 assert.equal(plan.classification,'PLAN_ONLY_NO_CLONE_OR_SQL_READBACK');
});
const readback={database:plan.database,containerId:environment.containerId,
 migrationManifestDigest:checkpoint.basis.migrationManifestDigest,
 operationSourceDigest:checkpoint.basis.operationSource.digest,
 fixtureSha256:checkpoint.basis.fixtureSha256,publication,defaultApiGrants:0};
pass('exact later clone readback remains caller-claimed, not SQL proof',()=>{
 const adapter=assertCurrentManager219CloneReadback(checkpoint,plan,readback);
 assert.equal(adapter.classification,'CALLER_READBACK_MATCHED_NOT_SQL_EXECUTION_PROOF');
 assert.equal(adapter.STATIC_WEEKLY_CONTROL_PLANE_ALLOW_INSECURE_LOOPBACK_REHEARSAL,'1');
});
const changed=(object,path,value)=>{
 const next=structuredClone(object);let target=next;
 for(const key of path.slice(0,-1))target=target[key];
 target[path.at(-1)]=value;return next;
};
for(const [name,path,value] of [
 ['future/missing authority revision',['authorityRevision'],0],
 ['wrong original registered source',['originalSourceDigest'],'0'.repeat(64)],
 ['wrong current registered source',['currentSourceDigest'],'0'.repeat(64)],
 ['relabelled accepted rows',['acceptedRows'],493],
 ['unbound lunch',['lunchLoans'],29],
 ['API default grant',['defaultApiGrants'],1],
 ['already confirmed source',['confirmationStatus'],'ACCEPTED'],
 ['missing date',['dates'],days.slice(1)],
 ['stale day projection',['dates',2,'projectionId'],uuid(4)],
 ['altered day roster',['dates',3,'rosterCount'],99],
 ['extra caller field',['sourceOverride'],'browser'],
 ])pass(`deny ${name}`,()=>assert.throws(()=>createCurrentManager219OwnedCheckpoint({publication:changed(publication,path,value),environment})));
for(const [name,path,value] of [
 ['network bridge',['network'],'bridge'],['foreign image',['image'],'postgres:latest'],
 ['foreign socket',['socket'],'/tmp/foreign'],['non-owned DB',['database'],'production'],
 ['foreign container',['containerName'],'prod'],
 ])pass(`deny ${name}`,()=>assert.throws(()=>createCurrentManager219OwnedCheckpoint({publication,environment:changed(environment,path,value)})));
pass('deny active source session before clone',()=>assert.throws(()=>planCurrentManager219RehearsalClone(checkpoint,{suffix:'abc12345',sourceSessions:1})));
pass('deny unsafe rehearsal name',()=>assert.throws(()=>planCurrentManager219RehearsalClone(checkpoint,{suffix:'bad;drop',sourceSessions:0})));
pass('deny changed full source manifest even with new checkpoint digest',()=>{
 const forged=changed(checkpoint,['basis','operationSource','files',0,'sha256'],'0'.repeat(64));
 assert.throws(()=>planCurrentManager219RehearsalClone(forged,{suffix:'abc12345',sourceSessions:0}));
});
for(const [name,path,value] of [
 ['rehearsal database',['database'],'production'],
 ['lost original registration',['publication','originalSourceDigest'],'0'.repeat(64)],
 ['stale revision',['publication','authorityRevision'],8],
 ['unbound lunch',['publication','lunchIdentity'],'0'.repeat(64)],
 ['unexpected public grant',['defaultApiGrants'],1],
 ])pass(`deny clone ${name}`,()=>assert.throws(()=>assertCurrentManager219CloneReadback(checkpoint,plan,changed(readback,path,value))));
pass('deny changed clone argv even when attacker rehashes plan',()=>{
 const altered=changed(plan,['argv',plan.argv.length-1],'CREATE DATABASE production TEMPLATE postgres');
 altered.digest=createHash('sha256').update(JSON.stringify(Object.fromEntries(
  Object.entries(altered).filter(([key])=>key!=='digest')))).digest('hex');
 assert.throws(()=>assertCurrentManager219CloneReadback(checkpoint,altered,readback));
});
console.log('PASS current219 owned checkpoint pure contract',checks,'NO_SQL_NO_CLONE_NO_ENGINE');
