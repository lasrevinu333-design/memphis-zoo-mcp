import assert from 'node:assert/strict';
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
export function selectFreshOnlySourceRows(manifest,names,read){
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
