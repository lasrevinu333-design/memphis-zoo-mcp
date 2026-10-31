import assert from 'node:assert/strict';
import {fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const PREDECESSOR='5094a272dcc9f01ccbf043f3de7012e12bdb542606089a0a818629c1ecf86b26';
const SUCCESSOR='c163c4018512ca66189effbb750c22b89ae0760909e5b067593652e357bbb65e';
const NAME='20261028224728_full_scheduled_lunch_source_policy.sql';
const NAME299='20261030031200_approved_manual_full_hour_coverers.sql';
const SUCCESSOR299='aacbb20c43419718fce0b4fbf1d5845a45c48700fb1a2a51b1b07ad184327de8';
const NAME300='20261030050235_compact_approved_initial_confirmation.sql';
const SUCCESSOR300='6c72ea5ddc4587d21ac9464f71126ad7c5b77c9b72768247d6b8394125b5e078';
const NAME301='20261030155202_approved_manual_current_day_activation.sql';
const SUCCESSOR301='dacdeccb363fd648660f5a47cac7ae96d5f5d8793a37ed449c2ec312c7f3ba0e';

// One exact appended source migration. The selected297 manifest, bootstrap,
// overrides, no-auto choices and all prior SQL bytes retain their own identity.
// This selector grants no populated-target, production or runtime admission.
function selectHistoricalFreshOnlySourceRows(manifest,names,read){
 const predecessorBytes=read('release/fresh-only-replay/MANIFEST.json');
 assert.equal(sha(predecessorBytes),PREDECESSOR);
 assert.deepEqual(manifest,JSON.parse(predecessorBytes));
 assert.equal(manifest.entries.length,297);
 const predecessorNames=manifest.entries.map(row=>row.name);
 if(names.length===297){assert.deepEqual(names,predecessorNames);return {rows:manifest.entries,successor:null};}
 const source301=names.length===301,source300=names.length===300||source301,source299=names.length===299||source300;
 assert.deepEqual(names,[...predecessorNames,NAME,...(source299?[NAME299]:[]),...(source300?[NAME300]:[]),...(source301?[NAME301]:[])],'only the exact source298/source299/source300/source301 successor is admitted');
 const bytes=read('release/fresh-only-replay/SOURCE298_SUCCESSOR.json',{bytes:1535,sha256:SUCCESSOR});
 assert.equal(sha(bytes),SUCCESSOR);
 const successor=JSON.parse(bytes);
 assert.equal(successor.schema,'custodial.ci-fresh-only-exact-source-successor.v1');
 assert.deepEqual(successor.predecessor_manifest,{path:'release/fresh-only-replay/MANIFEST.json',sha256:PREDECESSOR,migrations:297,overrides:22});
 assert.equal(successor.source_migrations,298);
 assert.equal(successor.append.name,NAME);
 assert.deepEqual(successor.append.selected,successor.append.original);
 read(successor.append.original.path,successor.append.original);
 let next=null;
 if(source299){
  const nextBytes=read('release/fresh-only-replay/SOURCE299_SUCCESSOR.json',{bytes:2012,sha256:SUCCESSOR299});
  assert.equal(sha(nextBytes),SUCCESSOR299);next=JSON.parse(nextBytes);
  assert.equal(next.schema,successor.schema);assert.equal(next.scope,successor.scope);
  assert.deepEqual(next.predecessor_manifest,successor.predecessor_manifest);
  assert.deepEqual(next.predecessor_successor,{path:'release/fresh-only-replay/SOURCE298_SUCCESSOR.json',sha256:SUCCESSOR,bytes:1535,source_migrations:298});
  assert.deepEqual(next.preserved_predecessor_replay,{...successor.replay_manifest,path:'release/fresh-only-replay/SOURCE298_REPLAY_ORDER.json'});
  read(next.preserved_predecessor_replay.path,next.preserved_predecessor_replay);
  assert.equal(next.source_migrations,299);assert.equal(next.append.name,NAME299);
  assert.deepEqual(next.append.selected,next.append.original);read(next.append.original.path,next.append.original);
  if(!source300)read(next.replay_manifest.path,next.replay_manifest);
  assert.equal(next.full_vendor_NORMAL,false);assert.equal(next.expected_fingerprint_authority,null);
 }else read(successor.replay_manifest.path,successor.replay_manifest);
 let last=null;
 if(source300){
  const lastBytes=read('release/fresh-only-replay/SOURCE300_SUCCESSOR.json',{bytes:2054,sha256:SUCCESSOR300});
  assert.equal(sha(lastBytes),SUCCESSOR300);last=JSON.parse(lastBytes);
  assert.equal(last.schema,next.schema);assert.equal(last.scope,next.scope);
  assert.deepEqual(last.predecessor_manifest,next.predecessor_manifest);
  assert.deepEqual(last.predecessor_successor,{path:'release/fresh-only-replay/SOURCE299_SUCCESSOR.json',sha256:SUCCESSOR299,bytes:2012,source_migrations:299});
  assert.deepEqual(last.preserved_predecessor_replay,{...next.replay_manifest,path:'release/fresh-only-replay/SOURCE299_REPLAY_ORDER.json'});
  read(last.preserved_predecessor_replay.path,last.preserved_predecessor_replay);
  assert.equal(last.source_migrations,300);assert.equal(last.append.name,NAME300);
  assert.deepEqual(last.append.selected,last.append.original);read(last.append.original.path,last.append.original);
  if(!source301)read(last.replay_manifest.path,last.replay_manifest);
  assert.equal(last.full_vendor_NORMAL,false);assert.equal(last.expected_fingerprint_authority,null);
 }
 let final=null;
 if(source301){
  const finalBytes=read('release/fresh-only-replay/SOURCE301_SUCCESSOR.json',{bytes:2169,sha256:SUCCESSOR301});
  assert.equal(sha(finalBytes),SUCCESSOR301);final=JSON.parse(finalBytes);
  assert.equal(final.schema,last.schema);assert.equal(final.scope,last.scope);
  assert.deepEqual(final.predecessor_manifest,last.predecessor_manifest);
  assert.deepEqual(final.predecessor_successor,{path:'release/fresh-only-replay/SOURCE300_SUCCESSOR.json',sha256:SUCCESSOR300,bytes:2054,source_migrations:300});
  assert.deepEqual(final.preserved_predecessor_replay,{...last.replay_manifest,path:'release/fresh-only-replay/SOURCE300_REPLAY_ORDER.json'});
  read(final.preserved_predecessor_replay.path,final.preserved_predecessor_replay);
  assert.equal(final.source_migrations,301);assert.equal(final.append.name,NAME301);
  assert.deepEqual(final.append.selected,final.append.original);read(final.append.original.path,final.append.original);
  read(final.replay_manifest.path,final.replay_manifest);
  assert.equal(final.full_vendor_NORMAL,false);assert.equal(final.expected_fingerprint_authority,null);
 }
 assert.equal(successor.full_vendor_NORMAL,false);assert.equal(successor.expected_fingerprint_authority,null);
 return {rows:[...manifest.entries,successor.append,...(next?[next.append]:[]),...(last?[last.append]:[]),...(final?[final.append]:[])],successor:final
  ?{sha256:SUCCESSOR301,predecessor_manifest_sha256:PREDECESSOR,predecessor_successor_sha256:SUCCESSOR300,appended_migration:NAME301}
  :last
  ?{sha256:SUCCESSOR300,predecessor_manifest_sha256:PREDECESSOR,predecessor_successor_sha256:SUCCESSOR299,appended_migration:NAME300}
  :next
  ?{sha256:SUCCESSOR299,predecessor_manifest_sha256:PREDECESSOR,predecessor_successor_sha256:SUCCESSOR,appended_migration:NAME299}
  :{sha256:SUCCESSOR,predecessor_manifest_sha256:PREDECESSOR,appended_migration:NAME}};
}

// Source302 is ONE exact append to the fully preserved301 chain. Metadata is
// versioned Source input, not a populated-target/capture/production authority.
// Main issues its actual name/ref/replay only after the maintained CLI output.
// No filename, final SQL hash or observed catalog is invented here.
// A measured append-on301 catalog is not an observed empty/fresh302 result.
// This source-only scope grants no expected fingerprint authority or target PASS.
export function assert302SourceCaptureScope(next,read){
 assert.equal(next.full_vendor_NORMAL,false);assert.equal(next.expected_fingerprint_authority,null);
 if(next.source_capture_scope==='MEASURED_CURRENT_APPEND_ON301_NOT_FRESH302'){
  assert.equal(next.observed_empty_source_fingerprint,null,'Current fixture capture must not be mislabeled empty/fresh302');return;
 }
 if(next.source_capture_scope==='ACTUAL_FRESH302_SCOPED_NORMAL_CONSTRUCTION_AND_READ_ONLY_CATALOG'){
  assert.equal(typeof read,'function','Actual fresh302 scope requires its exact construction evidence');
  const refs={"RESULT.json":{"path":"release/fresh-only-replay/source302-normal-evidence/RESULT.json","sha256":"d74c68af20baf1b7fe27fd137399258ca5f99d792659d2bab4289e1957829dc8","bytes":5608},"PARENT_WAIT.json":{"path":"release/fresh-only-replay/source302-normal-evidence/PARENT_WAIT.json","sha256":"693e5696f82daee5ddc35ced4b571cf70951b96394e930f294712f68ca173062","bytes":331},"CONSTRUCTED_SOURCE302_SUCCESSOR.json":{"path":"release/fresh-only-replay/source302-normal-evidence/CONSTRUCTED_SOURCE302_SUCCESSOR.json","sha256":"dbb6372350215d5e7c969d667056700ead4f06c5c9ab23db85ce0235caae43a0","bytes":1792},"CATALOG_RAW.json":{"path":"release/fresh-only-replay/source302-normal-evidence/CATALOG_RAW.json","sha256":"2b9bb58567ba06616416c5de62c75cd2e5e7eac9134ae63a434ced483952d487","bytes":7865195},"CATALOG_NORMALIZED.json":{"path":"release/fresh-only-replay/source302-normal-evidence/CATALOG_NORMALIZED.json","sha256":"42cb5274f2e5335050fb2db0617e5a01cc8041b5b6fa3700689cd6ef02fb495c","bytes":7831931},"FINGERPRINT.txt":{"path":"release/fresh-only-replay/source302-normal-evidence/FINGERPRINT.txt","sha256":"264147acd88039a20856fceb59c49e62d6356fa4286b3256178c12358b7ec63c","bytes":65}};
  const bytes=name=>{const ref=refs[name],value=read(ref.path,ref);assert.equal(value.length,ref.bytes);assert.equal(sha(value),ref.sha256);return value;};
  const actual=JSON.parse(bytes('RESULT.json')),wait=JSON.parse(bytes('PARENT_WAIT.json')),constructedBytes=bytes('CONSTRUCTED_SOURCE302_SUCCESSOR.json'),constructed=JSON.parse(constructedBytes);
  assert.equal(actual.state,'PASS_FRESH302_NORMAL_CONSTRUCTION_AND_ACTUAL_CANONICAL_CATALOG');assert.equal(actual.scope,'ACTUAL_FRESH302_NORMAL_CONSTRUCTION');assert.equal(actual.actualFresh302Fingerprint,next.observed_empty_source_fingerprint);assert.equal(actual.sourceFullBytesAndIdentitiesPreserved,true);assert.equal(actual.catalogReadOnlyRepeatableRead,true);assert.equal(actual.catalogRolledBack,true);assert.equal(actual.clientEndReturned,true);assert.deepEqual(actual.connectionErrors,[]);
  assert.equal(actual.fullSuitePASS,false);assert.equal(actual.functionalAppAcceptance,false);assert.equal(actual.productionWritten,false);assert.equal(actual.finalAudit,false);assert.equal(actual.finalBuild,false);assert.equal(actual.deployment,false);
  const receipt=actual.actualReceipt;assert.equal(receipt.schema,'custodial.ci-fresh-only-migrations-construction.v1');assert.equal(receipt.state,'CONSTRUCTED_NOT_FUNCTIONALLY_QUALIFIED');assert.equal(receipt.container,'1c3fa16e433a89d193381fb64fe41a6b55f4a6e3039dbe9c8148c04d4d272a8d');assert.equal(receipt.no_auto_table_grants,false);assert.equal(receipt.selected_replay.migrations,302);assert.equal(receipt.selected_replay.overrides,22);assert.equal(receipt.selected_replay.full_vendor_NORMAL,false);assert.equal(receipt.selected_replay.expected_fingerprint_authority,null);assert.equal(receipt.selected_replay.source_successor.sha256,sha(constructedBytes));assert.equal(receipt.selected_replay.source_successor.appended_migration,next.append.name);assert.equal(receipt.selected_replay.manifest_sha256,next.predecessor_manifest.sha256);assert.equal(receipt.selected_replay.source_successor.predecessor_successor_sha256,next.predecessor_successor.sha256);
  const child=receipt.original_child;assert.equal(child.actual_wait_returned,true);assert.equal(child.exit,0);assert.equal(child.signal,null);assert.equal(child.timed_out,false);assert.equal(child.stream_limit_exceeded,false);assert.equal(child.fresh_PID_PGID_proc_absent,true);assert.equal(wait.actualWaitReturned,true);assert.equal(wait.exit,0);assert.deepEqual(wait.absence,{pid:true,pgid:true,proc:true});assert.equal(wait.positiveSignals,0);
  assert.equal(constructed.source_capture_scope,'MEASURED_CURRENT_APPEND_ON301_NOT_FRESH302');assert.equal(constructed.observed_empty_source_fingerprint,null);const relabeled={...next,source_capture_scope:constructed.source_capture_scope,observed_empty_source_fingerprint:null};assert.deepEqual(relabeled,constructed,'Actual construction must bind the identical SQL/301 prefix and replay, with only capture metadata advanced');
  for(const[name,key]of [['CATALOG_RAW.json','raw'],['CATALOG_NORMALIZED.json','normalized'],['FINGERPRINT.txt','fingerprint']]){assert.equal(refs[name].sha256,actual.artifacts[key].sha256);assert.equal(refs[name].bytes,actual.artifacts[key].bytes);bytes(name);}
  const captured=fingerprintSchemaCatalog(JSON.parse(bytes('CATALOG_RAW.json'))),normalized=JSON.parse(bytes('CATALOG_NORMALIZED.json')),canonical=fingerprintSchemaCatalog(JSON.parse(read('supabase/canonical/schema-fingerprint-input.json')));
  assert.equal(captured.fingerprint,next.observed_empty_source_fingerprint);assert.deepEqual(captured.normalized,normalized);assert.deepEqual(canonical.normalized,normalized);assert.equal(bytes('FINGERPRINT.txt').toString('utf8').trim(),captured.fingerprint);assert.equal(read('supabase/canonical/schema-fingerprint.txt').toString('utf8').trim(),captured.fingerprint);assert.deepEqual(Object.fromEntries(Object.entries(normalized).map(([key,rows])=>[key,rows.length])),actual.actualFresh302Counts);return;
 }
 assert.ok(['SYNTHETIC_SOURCE_FIXTURE_ONLY_NOT_A_CAPTURE','SYNTHETIC_SOURCE_FIXTURE_ONLY_NOT_CAPTURE'].includes(next.source_capture_scope),'Unproved or unknown fresh302 capture scope');assert.match(next.observed_empty_source_fingerprint,/^[a-f0-9]{64}$/);
}
export function selectFreshOnlySourceRows(manifest,names,read){
 if(names.length!==302)return selectHistoricalFreshOnlySourceRows(manifest,names,read);
 assert.ok(Array.isArray(names),'Exact302 migration name array required');
 const priorBytes=read('release/fresh-only-replay/SOURCE301_SUCCESSOR.json',{bytes:2169,sha256:SUCCESSOR301});
 assert.equal(priorBytes.length,2169);assert.equal(sha(priorBytes),SUCCESSOR301);
 const prior=JSON.parse(priorBytes),nextBytes=read('release/fresh-only-replay/SOURCE302_SUCCESSOR.json'),next=JSON.parse(nextBytes);
 assert.deepEqual(Object.keys(next).sort(),Object.keys(prior).sort(),'Source302 keeps the closed maintained successor schema');
 assert.equal(next.schema,prior.schema);assert.equal(next.scope,prior.scope);
 assert.deepEqual(next.predecessor_manifest,prior.predecessor_manifest);
 assert.deepEqual(next.predecessor_successor,{path:'release/fresh-only-replay/SOURCE301_SUCCESSOR.json',sha256:SUCCESSOR301,bytes:2169,source_migrations:301});
 assert.deepEqual(next.preserved_predecessor_replay,{...prior.replay_manifest,path:'release/fresh-only-replay/SOURCE301_REPLAY_ORDER.json'});
 assert.equal(next.source_migrations,302);assert.equal(next.full_vendor_NORMAL,false);assert.equal(next.expected_fingerprint_authority,null);
 assert302SourceCaptureScope(next,read);
 const exactKeys=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),'Closed Source302 source ref required');
 exactKeys(next.append,['atomic_mode','name','original','selected']);
 assert.match(next.append.name,/^[0-9]{14}_[a-z0-9_]+\.sql$/);
 assert.equal(next.append.atomic_mode,'exact-Source-BEGIN-COMMIT');
 assert.deepEqual(next.append.selected,next.append.original);
 exactKeys(next.append.original,['bytes','path','sha256']);
 assert.equal(next.append.original.path,'supabase/migrations/'+next.append.name);
 assert.ok(Number.isSafeInteger(next.append.original.bytes)&&next.append.original.bytes>0&&next.append.original.bytes<=16*1024*1024);
 assert.match(next.append.original.sha256,/^[a-f0-9]{64}$/);
 const appended=read(next.append.original.path,next.append.original);
 assert.equal(appended.length,next.append.original.bytes);assert.equal(sha(appended),next.append.original.sha256);
 const preserved=read(next.preserved_predecessor_replay.path,next.preserved_predecessor_replay);
 assert.equal(preserved.length,prior.replay_manifest.bytes);assert.equal(sha(preserved),prior.replay_manifest.sha256);
 const previous=JSON.parse(preserved),currentBytes=read('supabase/canonical/migration-replay-order.json'),current=JSON.parse(currentBytes);
 assert.deepEqual(next.replay_manifest,{path:'supabase/canonical/migration-replay-order.json',sha256:sha(currentBytes),bytes:currentBytes.length});
 const prefix=JSON.parse(JSON.stringify(current));
 assert.deepEqual(prefix.phases.at(-1).files.pop(),{name:next.append.name,sha256:next.append.original.sha256});
 assert.deepEqual(prefix,previous,'Every Source301 replay field/member remains literal');
 const predecessorNames=names.slice(0,-1);
 assert.equal(names.at(-1),next.append.name);assert.ok(!predecessorNames.includes(next.append.name));
 const priorResult=selectHistoricalFreshOnlySourceRows(manifest,predecessorNames,(path,expected)=>{
  if(path!==prior.replay_manifest.path)return read(path,expected);
  // The one historical301 role is supplied its original bytes/hash, never
  // relabeled302. All other historical selected/override reads stay literal.
  assert.ok(expected);assert.equal(expected.bytes,preserved.length);assert.equal(expected.sha256,sha(preserved));return preserved;
 });
 const previousNames=previous.phases.flatMap(phase=>phase.files.map(row=>row.name));
 assert.equal(previousNames.length,301);assert.deepEqual([...previousNames].sort(),[...predecessorNames].sort());
 return {rows:[...priorResult.rows,next.append],successor:{sha256:sha(nextBytes),predecessor_manifest_sha256:PREDECESSOR,
  predecessor_successor_sha256:SUCCESSOR301,appended_migration:next.append.name}};
}
