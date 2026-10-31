#!/usr/bin/env node
// OPERATIONAL RELEASE PREPARATION ONLY. Default is a real read-only dry run.
// Eric/Main must decide/admit any future --apply. Never activates or publishes.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,openSync,closeSync,writeSync,fsyncSync,mkdirSync,lstatSync,fstatSync,realpathSync,constants} from 'node:fs';
import {resolve,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {PRODUCTION_DATABASE_IDENTITY,validateProductionDatabaseUrl,assertProductionDatabaseIdentity} from './production-database-identity.mjs';
import {catalogConnectionOptions} from './schema-catalog-readonly-client.mjs';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {prepareApprovedManualCoverAllActivation} from '../src/approved-manual-coverall-workflow.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sha=v=>createHash('sha256').update(v).digest('hex'),
 fail=code=>{throw Object.assign(new Error(code),{code});};
export const PREPARATION_SQL=Object.freeze({
 profile:`select current_user actor,session_user original_actor,current_database() database_name,
  (select pg_get_userbyid(relowner) from pg_class where oid='supabase_migrations.schema_migrations'::regclass) ledger_owner,
  pg_has_role(current_user,'static_weekly_release_operator','MEMBER') release_membership,
  current_setting('session_replication_role') replication_role,
  (select ssl from pg_stat_ssl where pid=pg_backend_pid()) tls,
  (select version from pg_stat_ssl where pid=pg_backend_pid()) tls_version,pg_backend_pid() backend_pid`,
 target:`select p.enabled,p.cohort_principal_id,p.policy_version,p.security_epoch,p.permissions,p.approved_by,p.approved_at,p.approval_ref,
  m.active,m.revoked_at,m.is_system_principal from custodial_leadership_private.policy p
  left join public.ops_manager_managers m on m.manager_id=p.cohort_principal_id where p.singleton`,
 snapshot:'select public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp())) as snapshot',
 lock:"select pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0))",
 exists:`select exists(select 1 from custodial_coverall.activation_packets where packet_id=$1 or source_id=$2 or template_id=$3) packet_exists,
  exists(select 1 from public.static_weekly_authority_source_documents where source_id=$2) source_exists`,
 prepare:'select public.static_weekly_prepare_coverall_activation($1::jsonb) as receipt',
 readback:`select packet_id::text,source_id::text,manager_id::text,service_date::text,expected_revision::text,source_digest,preview_digest,roster_digest
  from custodial_coverall.activation_packets where packet_id=$1 and source_id=$2 and manager_id=$3`
});
export function parsePreparationArgs(argv){
 const values={apply:false};const names=new Map([['--expected-project','project'],['--ca-file','caFile'],['--out','out'],['--expected-date','date'],['--expected-revision','revision']]);
 for(let n=0;n<argv.length;n++){
  const key=argv[n];if(key==='--apply'){if(values.apply)fail('DUPLICATE_APPLY_FLAG');values.apply=true;continue;}
  const prop=names.get(key);if(!prop||Object.hasOwn(values,prop)||n+1>=argv.length||argv[n+1].startsWith('--'))fail('INVALID_PACKET_PREPARATION_ARGUMENT');values[prop]=argv[++n];
 }
 assert.equal(values.project,PRODUCTION_DATABASE_IDENTITY.project_ref,'Exact expected project argument required');
 assert.ok(isAbsolute(values.caFile??'')&&isAbsolute(values.out??''),'Absolute CA/output paths required');
 assert.match(values.date??'',/^\d{4}-\d{2}-\d{2}$/);assert.equal(new Date(values.date+'T12:00Z').toISOString().slice(0,10),values.date);
 assert.match(values.revision??'',/^(0|[1-9]\d*)$/);values.revision=Number(values.revision);assert.ok(Number.isSafeInteger(values.revision)&&values.revision<Number.MAX_SAFE_INTEGER);
 return values;
}
export function validatePreparationTarget(row){
 if(!row||row.enabled!==true||!UUID.test(row.cohort_principal_id??'')||!Array.isArray(row.permissions)||!row.permissions.includes('custodialManagementAdmin')
  ||row.active!==true||row.revoked_at!==null||row.is_system_principal!==true||!row.approved_by||!row.approved_at||!row.approval_ref
  ||!Number.isSafeInteger(row.policy_version)||row.policy_version<1||!Number.isSafeInteger(row.security_epoch)||row.security_epoch<1)
  fail('APPROVED_ENABLED_COHORT_PREPARATION_TARGET_REQUIRED');
 // A packet target, not a chosen name/actor, owner assertion or browser token.
 return {managerId:row.cohort_principal_id,policyVersion:row.policy_version,securityEpoch:row.security_epoch,permission:'custodialManagementAdmin'};
}
export function createPacketPreparationIds(draft){
 const legacy=draft.sourceDraft.slots.filter(s=>s.contractorCapacity===true);assert.equal(legacy.length,8);assert.ok(legacy.every(s=>s.kind!=='CONTRACTOR_CAPACITY'));
 const packetId=randomUUID();return {packetId,sourceId:randomUUID(),versionId:randomUUID(),templatePublicationId:randomUUID(),templateId:'approved-manual-coverall-'+packetId,
  selection:legacy.map((s,n)=>({legacy_slot_id:s.id,new_capacity_id:randomUUID(),capacity_code:`CoverAll${String(n+1).padStart(2,'0')}`}))};
}
const identity=s=>[s.dev,s.ino,s.mode,s.nlink,s.uid,s.gid,s.size,s.mtimeNs.toString(),s.ctimeNs.toString()];
function sourceRef(path){
 const p=resolve(path),a=lstatSync(p,{bigint:true});assert.ok(a.isFile()&&!a.isSymbolicLink()&&a.nlink===1n);
 const fd=openSync(p,constants.O_RDONLY|constants.O_NOFOLLOW);let v,b;
 try{const held=fstatSync(fd,{bigint:true});assert.deepEqual(identity(a),identity(held));v=readFileSync(fd);b=fstatSync(fd,{bigint:true});
  assert.deepEqual(identity(a),identity(b));assert.deepEqual(identity(a),identity(lstatSync(p,{bigint:true})));}finally{closeSync(fd);}
 return{path:p,sha256:sha(v),bytes:v.length,identity9:identity(b).map(x=>typeof x==='bigint'?x.toString():x)};
}
export function createPrivatePacketIntent(out,intent){
 assert.ok(isAbsolute(out));assert.equal(realpathSync(dirname(out)),dirname(out),'Output parent must be a real existing directory');
 mkdirSync(out,{mode:0o700});assert.equal(lstatSync(out).mode&0o777,0o700);
 const parentFd=openSync(dirname(out),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(parentFd);}finally{closeSync(parentFd);} // Existing path/intent is never adopted/retried.
 const write=(name,value)=>{
  assert.match(name,/^[A-Z0-9_.-]+\.json$/);const path=resolve(out,name),v=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{let pos=0;while(pos<v.length){const n=writeSync(fd,v,pos);assert.ok(n>0);pos+=n;}fsyncSync(fd);}finally{closeSync(fd);}
  const dfd=openSync(out,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(dfd);}finally{closeSync(dfd);}
  const current=readFileSync(path);assert.equal(sha(current),sha(v));return{path,sha256:sha(v),bytes:v.length};
 };
 write('INTENT.json',intent);return write;
}
export function buildApprovedManualReleasePacket({week,draft,snapshot,target,ids,expectedDate,expectedRevision}){
 assert.equal(snapshot.schema,'custodial.manual-live-roster-readback.v1');assert.equal(snapshot.serviceDate,expectedDate);assert.equal(snapshot.authorityRevision,expectedRevision);
 assert.equal(snapshot.rosterSlots.length,22);assert.ok(UUID.test(target.managerId));
 const allIds=[ids.packetId,ids.sourceId,ids.versionId,ids.templatePublicationId,...ids.selection.map(s=>s.new_capacity_id)];
 assert.equal(new Set(allIds).size,12);for(const id of allIds)assert.match(id,UUID);
 assert.ok(ids.selection.every(x=>!snapshot.rosterSlots.some(s=>s.slotId===x.new_capacity_id)&&!snapshot.employees.some(e=>e.employeeId===x.new_capacity_id)));
 const data=prepareApprovedManualCoverAllActivation({week,draft,snapshot,selection:ids.selection,sourceId:ids.sourceId,versionId:ids.versionId,
  templatePublicationId:ids.templatePublicationId,templateId:ids.templateId,packetId:ids.packetId,managerId:target.managerId});
 assert.equal(data.feasibility.solverInvoked,false);assert.equal(data.feasibility.projectionAssignments.length,346);assert.equal(data.feasibility.lunchDocument.loans.length,40);
 assert.equal(data.newEmployees,0);assert.equal(data.registered,false);assert.equal(data.published,false);return data;
}
export function validatePacketPreparationProfile(profile,client){
 assert.deepEqual([profile.actor,profile.original_actor,profile.database_name,profile.ledger_owner,profile.release_membership,profile.replication_role,profile.tls],
  ['postgres','postgres','postgres','postgres',true,'origin',true],'Actual original postgres ledger owner, release membership and TLS required');
 assert.ok(['TLSv1.2','TLSv1.3'].includes(profile.tls_version));assert.ok(Number.isSafeInteger(profile.backend_pid)&&profile.backend_pid>0);
 assert.equal(client.connection?.stream?.encrypted,true);assert.equal(client.connection?.stream?.authorized,true,'Verified certificate chain required');return profile;
}
export function packetPreparationLocalSourceClosure(paths){
 const seen=new Set(paths.map(p=>resolve(p))),queue=[...seen];
 while(queue.length){const path=queue.pop();if(!/\.(?:js|mjs)$/.test(path))continue;
  for(const match of readFileSync(path,'utf8').matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
   if(!match[1].startsWith('.'))continue;const child=resolve(dirname(path),match[1]);
   assert.ok(child.startsWith(root+'/'),'Local import escaped the reviewed backend source root');
   if(!seen.has(child)){seen.add(child);queue.push(child);}
  }
 }
 return [...seen].sort();
}
export async function runPacketPreparation(argv){
 const options=parsePreparationArgs(argv),week=readApprovedManualWeek(),catalogPath=resolve(root,'config/schedules/manual-approved-20261030/catalog.json'),
  catalog=JSON.parse(readFileSync(catalogPath,'utf8')),reference=readFileSync(resolve(root,week.referenceBindings.reference.path)),
  draft=prepareApprovedManualSourceDraft({week,referenceBytes:reference}),ids=createPacketPreparationIds(draft),sourcePaths=packetPreparationLocalSourceClosure([fileURLToPath(import.meta.url),
   resolve(root,'src/approved-manual-coverall-workflow.js'),resolve(root,'src/approved-manual-roster-transition.js'),resolve(root,'src/static-weekly-contractor-source-transition.js'),
   resolve(root,'proposals/approved-manual-release-packet-preparation.sql'),resolve(root,week.referenceBindings.reference.path),resolve(root,'config/schedules/manual-approved-20261030/catalog.json'),
   resolve(root,'config/schedules/manual-approved-20261030',catalog.policyDelta.path),resolve(root,'config/schedules/manual-approved-20261030',catalog.referenceBindings.path),
   ...catalog.files.map(r=>resolve(root,'config/schedules/manual-approved-20261030',catalog.packetDirectory,r.path)),resolve(root,'package.json'),resolve(root,'package-lock.json')]),sourceBefore=sourcePaths.map(sourceRef),
  write=createPrivatePacketIntent(options.out,{schema:'custodial.approved-manual-release-packet-intent.v1',mode:options.apply?'APPLY_PACKET_PREPARATION_ONLY':'READ_ONLY_DRY_RUN',
   startedAt:new Date().toISOString(),expectedProject:options.project,expectedDate:options.date,expectedRevision:options.revision,ids,sourceBefore,
   target:'SQL_DERIVED_EXACT_ENABLED_COHORT',normalPublication:false,activation:false,EricDecisionRequiredBeforeApply:true});
 let client,transaction=false,knownCommit=false,phase='CONFIGURATION',dispatched=false,connectionFault=false;
 try{
  // This is the ONLY environment variable consumed by this executable. CA,
  // project/date/revision/output come from explicit nonsecret arguments.
  const database=validateProductionDatabaseUrl(process.env.SUPABASE_MIGRATION_DB_URL,options.project),ca=readFileSync(options.caFile,'utf8'),
   connection=catalogConnectionOptions({connectionString:database.connectionString,caPem:ca});
  client=new pg.Client({...connection,options:'',application_name:'custodial-approved-manual-packet-preparation'});
  client.on('error',()=>{connectionFault=true;});
  phase='CONNECT_AND_IDENTITY';await client.connect();const identity=await assertProductionDatabaseIdentity(client,{migrationAuthority:true});
  await client.query('begin isolation level repeatable read read only');transaction=true;
  const profile=validatePacketPreparationProfile((await client.query(PREPARATION_SQL.profile)).rows[0],client),targetRows=(await client.query(PREPARATION_SQL.target)).rows;assert.equal(targetRows.length,1);
  const target=validatePreparationTarget(targetRows[0]),snapshotRows=(await client.query(PREPARATION_SQL.snapshot)).rows;assert.equal(snapshotRows.length,1);const snapshot=snapshotRows[0].snapshot;
  write('ACTUAL_READ_ONLY_BASIS.json',{identity,profile,target,snapshot});
  await client.query('rollback');transaction=false;phase='BUILD_FIXED_PACKET_DATA';
  const data=buildApprovedManualReleasePacket({week,draft,snapshot,target,ids,expectedDate:options.date,expectedRevision:options.revision});
  const packetRef=write('PREPARED_PACKET_DATA.json',data);assert.deepEqual(sourcePaths.map(sourceRef),sourceBefore);
  if(!options.apply){
   const result={state:'READ_ONLY_DRY_RUN_PACKET_DATA_ONLY',packetId:ids.packetId,sourceId:ids.sourceId,target,packet:packetRef,expectedDate:options.date,expectedRevision:options.revision,
    preparedInDatabase:false,registered:false,published:false,activated:false,sourcePreserved:true};write('RESULT.json',result);return result;
  }
  phase='FRESH_PREPARATION_TRANSACTION';await client.query('begin isolation level serializable');transaction=true;
  await client.query("set local lock_timeout='5s'");await client.query("set local statement_timeout='120s'");await client.query(PREPARATION_SQL.lock);
  const freshProfile=validatePacketPreparationProfile((await client.query(PREPARATION_SQL.profile)).rows[0],client);assert.equal(freshProfile.backend_pid,profile.backend_pid);
  const rows=(await client.query(PREPARATION_SQL.target+' for share of p')).rows;assert.equal(rows.length,1);assert.deepEqual(validatePreparationTarget(rows[0]),target);
  const fresh=(await client.query(PREPARATION_SQL.snapshot)).rows[0].snapshot;assert.equal(digest(fresh),digest(snapshot),'Current date/revision/22history/parent changed');
  const exists=(await client.query(PREPARATION_SQL.exists,[ids.packetId,ids.sourceId,ids.templateId])).rows[0];assert.equal(exists.packet_exists,false);assert.equal(exists.source_exists,false);
  assert.deepEqual(sourcePaths.map(sourceRef),sourceBefore);write('PREPARE_DISPATCH_INTENT.json',{phase,packet:packetRef,ids,target,sourcePreserved:true,commitKnown:false});
  await client.query('set local role static_weekly_release_operator');phase='PACKET_PREPARATION_DISPATCH';dispatched=true;
  const receipt=(await client.query(PREPARATION_SQL.prepare,[JSON.stringify(data)])).rows[0].receipt;
  assert.equal(receipt.packetId,ids.packetId);assert.equal(receipt.sourceId,ids.sourceId);assert.equal(receipt.managerId,target.managerId);assert.equal(receipt.expectedRevision,options.revision);
  assert.equal(receipt.serviceDate,options.date);assert.equal(receipt.registered,false);assert.equal(receipt.published,false);
  write('UNCOMMITTED_PREPARATION_RECEIPT.json',{receipt,committed:false});await client.query('reset role');
  if(connectionFault)fail('PACKET_CONNECTION_OUTCOME_UNKNOWN');
  phase='COMMIT_ORIGINAL_PACKET_PREPARATION';write('COMMIT_ATTEMPT.json',{ids,phase,originalRequestOnly:true});await client.query('commit');transaction=false;knownCommit=true;
  phase='ORIGINAL_PACKET_READBACK';const readback=(await client.query(PREPARATION_SQL.readback,[ids.packetId,ids.sourceId,target.managerId])).rows;assert.equal(readback.length,1);
  assert.equal(readback[0].source_digest,data.sourceDigest);assert.equal(readback[0].preview_digest,receipt.previewDigest);assert.equal(readback[0].expected_revision,String(options.revision));
  assert.deepEqual(sourcePaths.map(sourceRef),sourceBefore);
  const result={state:'PACKET_PREPARED_COMMIT_KNOWN_READBACK_EXACT',ids,target,receipt,readback:readback[0],packet:packetRef,sourcePreserved:true,
   registered:false,published:false,activated:false,activationRequiresActualCurrentManagerPreviewAndSameOriginalConfirmation:true};write('RESULT.json',result);return result;
 }catch(error){
  let rollback='NOT_REQUIRED';if(transaction){try{await client.query('rollback');rollback='RETURNED';}catch{rollback='UNKNOWN';}}
  const failure={state:knownCommit?'PREPARATION_COMMIT_KNOWN_READBACK_UNKNOWN':dispatched?'ORIGINAL_PREPARATION_OUTCOME_REQUIRES_RECONCILIATION':'REFUSED_BEFORE_PACKET_WRITE',
   phase,ids,knownCommit,dispatched,rollback,code:/^[A-Z0-9_]{1,64}$/.test(String(error?.code??''))?error.code:'PACKET_PREPARATION_REFUSED',
   noAutomaticRetry:true,registered:false,published:false,activated:false};write('FAILED_OR_UNKNOWN.json',failure);throw Object.assign(Error('Packet preparation refused or requires original-ID reconciliation; inspect private evidence.'),{code:failure.code});
 }finally{if(client)await client.end().catch(()=>{});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
 runPacketPreparation(process.argv.slice(2)).then(r=>console.log(JSON.stringify({state:r.state,packetId:r.ids?.packetId??r.packetId,registered:false,published:false,activated:false})))
  .catch(e=>{console.error(JSON.stringify({state:'REFUSED_OR_ORIGINAL_OUTCOME_UNKNOWN',code:/^[A-Z0-9_]{1,64}$/.test(String(e.code??''))?e.code:'PACKET_PREPARATION_REFUSED',noAutomaticRetry:true}));process.exitCode=1;});
}
