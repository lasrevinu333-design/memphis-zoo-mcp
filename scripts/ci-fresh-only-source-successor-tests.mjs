import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {selectFreshOnlySourceRows} from './ci-fresh-only-source-successor.mjs';
import {loadCiFreshOnlyReplay} from './ci-fresh-only-replay.mjs';
const root=new URL('../',import.meta.url),sha=value=>createHash('sha256').update(value).digest('hex');
const manifest=JSON.parse(readFileSync(new URL('release/fresh-only-replay/MANIFEST.json',root)));
const names=readdirSync(new URL('supabase/migrations',root)).filter(x=>x.endsWith('.sql')).sort();
const read=(path,expected)=>{const bytes=readFileSync(new URL(path,root));if(expected){assert.equal(bytes.length,expected.bytes);assert.equal(sha(bytes),expected.sha256);}return bytes;};
let checks=0;
assert.throws(()=>loadCiFreshOnlyReplay(resolve(fileURLToPath(root))+'/',manifest.image,names));checks++;
const previous=selectFreshOnlySourceRows(manifest,manifest.entries.map(row=>row.name),read);
assert.deepEqual(previous.rows,manifest.entries);assert.equal(previous.successor,null);checks++;
for(const noAutoTableGrants of [false,true]){
 const selected=loadCiFreshOnlyReplay(resolve(fileURLToPath(root)),manifest.image,names,{noAutoTableGrants});
 assert.equal(selected.entries.length,298);assert.equal(selected.receipt.migrations,298);checks++;
 assert.equal(selected.receipt.manifest_sha256,'5094a272dcc9f01ccbf043f3de7012e12bdb542606089a0a818629c1ecf86b26');checks++;
 assert.equal(selected.entries.at(-1).selected.sha256,'a47387ddf244a04df646c9bb2d60eef86a769b96baf9106759f1c2a703248514');checks++;
 assert.equal(selected.receipt.full_vendor_NORMAL,false);assert.equal(selected.receipt.expected_fingerprint_authority,null);checks++;
 selected.assertPreserved();checks++;
}
for(const changed of [names.slice(0,-2),[...names,names.at(-1)],[...names.slice(0,-1),'20990101000000_unknown.sql'],names.slice().reverse()]){
 assert.throws(()=>selectFreshOnlySourceRows(manifest,changed,read));checks++;
}
for(const path of ['release/fresh-only-replay/MANIFEST.json','release/fresh-only-replay/SOURCE298_SUCCESSOR.json','supabase/canonical/migration-replay-order.json','supabase/migrations/20261028224728_full_scheduled_lunch_source_policy.sql']){
 assert.throws(()=>selectFreshOnlySourceRows(manifest,names,(p,expected)=>{if(p!==path)return read(p,expected);const b=Buffer.concat([read(p),Buffer.from(' ')]);if(expected){assert.equal(b.length,expected.bytes);assert.equal(sha(b),expected.sha256);}return b;}));checks++;
}
console.log(JSON.stringify({status:'PASS',checks,predecessorMigrations:297,currentMigrations:298,frozenPredecessorUnchanged:true,profiles:['selected','no-auto'],SQL_executed:false}));
