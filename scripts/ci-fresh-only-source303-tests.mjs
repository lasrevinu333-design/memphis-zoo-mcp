import {source252RoleOrderPredecessorPlan} from './source252-production-role-order-proof.mjs';
import {withCurrentMigrationSourceFixture,historical304ForwardBytes} from './fixtures/current-migration-source-fixtures.mjs';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {selectFreshOnlySourceRows} from './ci-fresh-only-source-successor.mjs';
import {loadCiFreshOnlyReplay} from './ci-fresh-only-replay.mjs';
import {readTargetCaptureSourceClosure,assertTargetCapturePendingPlan} from './release-migration-target-capture.mjs';

const actualRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await withCurrentMigrationSourceFixture(actualRoot,304,async root=>{
const read=name=>readFileSync(resolve(root,name));
const manifest=JSON.parse(read('release/fresh-only-replay/MANIFEST.json'));
const currentNames=readdirSync(resolve(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
assert.equal(currentNames.length,304);
const names=currentNames.slice(0,-1);
const aliases={'supabase/canonical/migration-replay-order.json':'release/fresh-only-replay/SOURCE303_REPLAY_ORDER.json','supabase/canonical/schema-fingerprint-input.json':'release/fresh-only-replay/source303-ticket-normal-evidence/CATALOG_NORMALIZED.json','supabase/canonical/schema-fingerprint.txt':'release/fresh-only-replay/source303-ticket-normal-evidence/FINGERPRINT.txt'};
const retained303Read=p=>read(aliases[p]??p);
assert.equal(selectFreshOnlySourceRows(manifest,names,retained303Read).rows.length,303);

const successorPath='release/fresh-only-replay/SOURCE303_SUCCESSOR.json';
const successor=JSON.parse(read(successorPath));
const encode=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const hash=b=>createHash('sha256').update(b).digest('hex');
let passed=0;
function refuses(change,changedNames=names){
 const replacements=new Map();change(replacements);
 assert.throws(()=>selectFreshOnlySourceRows(manifest,changedNames,p=>replacements.get(p)??retained303Read(p)));
 passed++;
}
for(const noAutoTableGrants of [false,true]){
 const selected=loadCiFreshOnlyReplay(root,manifest.image,currentNames,{noAutoTableGrants});
 assert.equal(selected.entries.length,304);selected.assertPreserved();passed++;
}
const mutateNext=change=>map=>{const next=structuredClone(successor);change(next);map.set(successorPath,encode(next));};
refuses(mutateNext(n=>{n.full_vendor_NORMAL=true;}));
refuses(mutateNext(n=>{n.expected_fingerprint_authority='production';}));
refuses(mutateNext(n=>{n.source_capture_scope='CALLER_ASSERTED_PASS';}));
refuses(mutateNext(n=>{n.observed_empty_source_fingerprint='0'.repeat(64);}));
refuses(mutateNext(n=>{n.runtime_admission=true;}));
refuses(mutateNext(n=>{n.append.atomic_mode='none';}));
refuses(map=>{
 const next=structuredClone(successor),bytes=Buffer.from(read(next.append.original.path));bytes[bytes.length-2]^=1;
 next.append.original.sha256=hash(bytes);next.append.selected={...next.append.original};map.set(next.append.original.path,bytes);map.set(successorPath,encode(next));
});


refuses(map=>{const p='release/fresh-only-replay/SOURCE302_SUCCESSOR.json';const n=JSON.parse(read(p));n.full_vendor_NORMAL=true;map.set(p,encode(n));});
refuses(map=>{const p='supabase/canonical/migration-replay-order.json';const n=JSON.parse(retained303Read(p));[n.phases[0].files[0],n.phases[0].files[1]]=[n.phases[0].files[1],n.phases[0].files[0]];map.set(p,encode(n));});
refuses(map=>{const p='release/fresh-only-replay/source303-ticket-normal-evidence/RESULT.json';const n=JSON.parse(read(p));n.actualReceipt.original_child.exit=1;map.set(p,encode(n));});
refuses(()=>{},[...names,'20261031180632_unapproved.sql']);
const closure=readTargetCaptureSourceClosure(root),state=JSON.parse(read('release/production-migration-state.json'));
assert.equal(closure.pending.length,170);assertTargetCapturePendingPlan(closure.pending,state.pending_migrations,closure);passed++;
const reordered=structuredClone(closure.pending);[reordered[0],reordered[1]]=[reordered[1],reordered[0]];
assert.throws(()=>assertTargetCapturePendingPlan(reordered,state.pending_migrations,closure));passed++;
assert.throws(()=>assertTargetCapturePendingPlan(closure.pending,state.pending_migrations,structuredClone(closure)));passed++;
console.log(JSON.stringify({passed,scope:'Source selection and rollback-only target-plan boundaries; no SQL execution, production admission or physical acceptance'}));

});

// Separate exact current311 source plan. The historical170 checks above remain
// literal; this does not claim a current311 SQL execution or catalog acceptance.
await withCurrentMigrationSourceFixture(actualRoot,311,async root=>{
 const closure=readTargetCaptureSourceClosure(root);
 const state=JSON.parse(readFileSync(resolve(root,'release/production-migration-state.json')));
 const historical=JSON.parse(readFileSync(resolve(root,'release/schema-evidence/SOURCE304_PREDECESSOR_PRODUCTION_MIGRATION_STATE.json')));
 assert.equal(closure.canonical_source_count,311);assert.equal(closure.pending.length,177);
 assert.equal(closure.source304_pending_count,170);
 assertTargetCapturePendingPlan(closure.pending,state.pending_migrations,closure);
 assert.deepEqual(source252RoleOrderPredecessorPlan(closure.pending.slice(0,170)),historical.pending_migrations);
 assert.throws(()=>assertTargetCapturePendingPlan(closure.pending,historical.pending_migrations,closure));
 const changed=structuredClone(closure.pending);[changed[0],changed[1]]=[changed[1],changed[0]];
 assert.throws(()=>assertTargetCapturePendingPlan(changed,state.pending_migrations,closure));
 assert.throws(()=>assertTargetCapturePendingPlan(closure.pending,state.pending_migrations,structuredClone(closure)));
 assert.throws(()=>assertTargetCapturePendingPlan(closure.pending,closure.pending.slice(0,-1),closure));
 const tail=structuredClone(state.pending_migrations);tail.at(-1).sha256='0'.repeat(64);
 assert.throws(()=>assertTargetCapturePendingPlan(closure.pending,tail,closure));
 console.log(JSON.stringify({status:'PASS',current_plan:177,preserved_plan:170,negative_controls:5,SQL_executed:false,runtime_admission:false}));
});

// A changed byte inside the removed ownership block must fail before reversal.
const forwardPath='release/production-forward-source/20261010193211_native_private_custody_chunk_retention.sql';
const forward=readFileSync(resolve(actualRoot,forwardPath),'utf8');
const marker='  -- BEGIN FINITE PRODUCTION SOURCE252 ROLE ORDER';
assert.ok(forward.includes(marker));
assert.throws(()=>historical304ForwardBytes(forwardPath,forward.replace(marker,marker+' CHANGED')));
const forwardManifestPath='release/production-forward-source/manifest.json';
const forwardManifest=JSON.parse(readFileSync(resolve(actualRoot,forwardManifestPath)));
for(const field of ['canonical_file','canonical_sha256','profile','forward_sha256']){
 const bad=structuredClone(forwardManifest);bad.migrations.find(x=>x.forward_file===forwardPath)[field]='unknown';
 assert.throws(()=>historical304ForwardBytes(forwardManifestPath,JSON.stringify(bad,null,2)+'\n'));
}
console.log(JSON.stringify({status:'PASS',historical_forward_input_mutations_rejected:5,SQL_executed:false}));
