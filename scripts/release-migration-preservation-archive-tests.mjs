import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const original=readFileSync(new URL('./release-migration-isolated-preservation-archive.mjs',import.meta.url),'utf8');
const source=original.replace(/^import\s[\s\S]*?;\s*$/gm,'').replace('export function ','function ')+'\nreturn openIsolatedPreservationArchive;';
const candidateCommit='c'.repeat(40),candidateTree='d'.repeat(40),ledger=[{UNIT:'original'}],sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
let checks=0;
function fixture({target=true,mutate=()=>{},deny=null}={}){
 const events=[],archive={cleanup(){events.push('cleanup');}},binding={summary:{project_ref:'rqquvtjdmugpigbndmne'},source_identity:{migration_ledger_sha256:sha(ledger),backup_tool_commit:candidateCommit,backup_tool_tree:candidateTree}};
 const sourceData={sourceBinding:binding,ledger};
 const env={GITHUB_ACTIONS:'true',GITHUB_RUN_ID:'123',RUNNER_TEMP:'/UNIT',RESTORE_SOURCE_DIR:'/UNIT/production-backup',SCHEMA_FINGERPRINT_DOCKER_CONTAINER:'mz_schema_rebuild_123',RESTORE_ARCHIVE_VERIFY_KEY:'UNIT_ONLY',RESTORE_ARCHIVE_VERIFY_KEY_ID:'UNIT'};
 const args={backendRoot:'/UNIT/backend',databaseUrl:'postgres://postgres@127.0.0.1/mz_schema_rebuild_123',rehearsal:true,apply:true,targetCapture:target,candidateCommit,candidateTree,sourceLedgerSha256:sha(ledger),captureContext:target?{archive,assertSourceCurrent(){events.push('current');if(deny==='current')throw Error('UNIT current refusal');}}:null,env};
 const git={HEAD:candidateCommit,'HEAD^{tree}':candidateTree,status:''};
 mutate({args,env,binding,sourceData,git});
 const deps={assert,resolve,execFileSync:(command,argv)=>{
  events.push(command+':'+argv.join(' '));
  if(command==='git'){if(argv[0]==='status')return git.status;return git[argv[1]];}
  assert.equal(command,'docker');if(deny==='docker')throw Error('UNIT Docker inspection refused');return '{}';
 },materializeVerifiedArchive:opts=>{events.push('materialize');assert.equal(opts.archiveVerifyKey,'UNIT_VERIFIED_KEY');assert.deepEqual(opts.supportedFormats,['memphis-zoo-disaster-recovery.v4']);assert.equal(opts.requiredEntries.length,4);return archive;},
 readVerifiedArchiveSourceBinding:a=>{assert.equal(a,archive);return binding;},readVerifiedMigrationTargetCaptureSource:a=>{assert.equal(a,archive);return sourceData;},requireSigningKey:(key,name)=>{assert.equal(key,'UNIT_ONLY');assert.equal(name,'RESTORE_ARCHIVE_VERIFY_KEY');events.push('verifyKey');return 'UNIT_VERIFIED_KEY';},stableJsonFileSha256:sha,
 assertTargetCaptureBoundary:opts=>{events.push('boundary');assert.equal(opts.rehearsal,true);assert.equal(opts.apply,true);if(deny==='boundary')throw Error('UNIT boundary refused');},assertOwnedTargetMetadata:()=>{events.push('ownedTarget');if(deny==='ownedTarget')throw Error('UNIT owned target refused');}};
 const open=new Function(...Object.keys(deps),source)(...Object.values(deps));let value,error;try{value=open(args);}catch(e){error=e;}return{events,value,error};
}
async function check(name,fn){await fn();checks++;}
await check('target capture borrows exact verified archive and leaves cleanup to its existing owner',()=>{const r=fixture();assert.ifError(r.error);assert.ok(r.events.includes('current'));assert.equal(r.events.includes('materialize'),false);r.value.close();assert.equal(r.events.includes('cleanup'),false);assert.throws(()=>r.value.close());});
await check('full isolated rehearsal authenticates its own exact provided archive and cleans once',()=>{const r=fixture({target:false});assert.ifError(r.error);assert.ok(r.events.includes('verifyKey'));assert.ok(r.events.includes('materialize'));r.value.close();assert.equal(r.events.filter(x=>x==='cleanup').length,1);assert.throws(()=>r.value.close());});
for(const target of [true,false])for(const [name,mutate] of [
 ['outsideGHA',x=>x.env.GITHUB_ACTIONS='false'],['runId',x=>x.env.GITHUB_RUN_ID='0'],['sourcePath',x=>x.env.RESTORE_SOURCE_DIR='/other'],['container',x=>x.env.SCHEMA_FINGERPRINT_DOCKER_CONTAINER='OTHER'],['dirty',x=>x.git.status=' M UNIT'],['head',x=>x.git.HEAD='e'.repeat(40)],['tree',x=>x.git['HEAD^{tree}']='e'.repeat(40)],['project',x=>x.binding.summary.project_ref='OTHER'],['ledger',x=>x.binding.source_identity.migration_ledger_sha256='e'.repeat(64)],['ledgerRows',x=>x.sourceData.ledger=[]],['bindingIdentity',x=>x.sourceData.sourceBinding={...x.binding}],...(!target?[
 ['backupCommit',x=>x.binding.source_identity.backup_tool_commit='e'.repeat(40)],['backupTree',x=>x.binding.source_identity.backup_tool_tree='e'.repeat(40)],['borrowedCapture',x=>x.args.captureContext={}]]:[])])await check('refuses '+name+' target='+target,()=>{const r=fixture({target,mutate});assert.ok(r.error,name);if(!target&&r.events.includes('materialize'))assert.equal(r.events.filter(x=>x==='cleanup').length,1);assert.equal(r.value,undefined);});
for(const deny of ['boundary','docker','ownedTarget','current'])await check('admission failure '+deny+' cannot materialize a replacement archive',()=>{const r=fixture({deny});assert.ok(r.error);assert.equal(r.events.includes('materialize'),false);assert.equal(r.events.includes('cleanup'),false);});
console.log(JSON.stringify({status:'PASS_RECORDING_ARCHIVE_ADMISSION_ONLY',checks,source_sha256:createHash('sha256').update(original).digest('hex'),actual_SQL:false,actual_Docker:false,actual_archive:false}));
