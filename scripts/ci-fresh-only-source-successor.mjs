import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const PREDECESSOR='5094a272dcc9f01ccbf043f3de7012e12bdb542606089a0a818629c1ecf86b26';
const SUCCESSOR='c163c4018512ca66189effbb750c22b89ae0760909e5b067593652e357bbb65e';
const NAME='20261028224728_full_scheduled_lunch_source_policy.sql';

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
 assert.deepEqual(names,[...predecessorNames,NAME],'only the exact source298 successor is admitted');
 const bytes=read('release/fresh-only-replay/SOURCE298_SUCCESSOR.json',{bytes:1535,sha256:SUCCESSOR});
 assert.equal(sha(bytes),SUCCESSOR);
 const successor=JSON.parse(bytes);
 assert.equal(successor.schema,'custodial.ci-fresh-only-exact-source-successor.v1');
 assert.deepEqual(successor.predecessor_manifest,{path:'release/fresh-only-replay/MANIFEST.json',sha256:PREDECESSOR,migrations:297,overrides:22});
 assert.equal(successor.source_migrations,298);
 assert.equal(successor.append.name,NAME);
 assert.deepEqual(successor.append.selected,successor.append.original);
 read(successor.append.original.path,successor.append.original);
 read(successor.replay_manifest.path,successor.replay_manifest);
 assert.equal(successor.full_vendor_NORMAL,false);assert.equal(successor.expected_fingerprint_authority,null);
 return {rows:[...manifest.entries,successor.append],successor:{sha256:SUCCESSOR,predecessor_manifest_sha256:PREDECESSOR,appended_migration:NAME}};
}
