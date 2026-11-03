import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {selectFreshOnlySourceRows} from './ci-fresh-only-source-successor.mjs';
import {loadCiFreshOnlyReplay} from './ci-fresh-only-replay.mjs';
import {readTargetCaptureSourceClosure,assertTargetCapturePendingPlan} from './release-migration-target-capture.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
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
