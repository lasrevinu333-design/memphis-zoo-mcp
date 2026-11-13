import {withCurrentMigrationSourceFixture} from './fixtures/current-migration-source-fixtures.mjs';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {selectFreshOnlySourceRows} from './ci-fresh-only-source-successor.mjs';
import {loadCiFreshOnlyReplay} from './ci-fresh-only-replay.mjs';
const actualRoot=resolve(fileURLToPath(new URL('../',import.meta.url)));
await withCurrentMigrationSourceFixture(actualRoot,304,async fixtureRoot=>{
const root=new URL('file://'+fixtureRoot+'/'),sha=value=>createHash('sha256').update(value).digest('hex');
const manifest=JSON.parse(readFileSync(new URL('release/fresh-only-replay/MANIFEST.json',root)));
const names=readdirSync(new URL('supabase/migrations',root)).filter(x=>x.endsWith('.sql')).sort();
const read=(path,expected)=>{const bytes=readFileSync(new URL(path,root));if(expected){assert.equal(bytes.length,expected.bytes);assert.equal(sha(bytes),expected.sha256);}return bytes;};
let checks=0;
assert.throws(()=>loadCiFreshOnlyReplay(resolve(fileURLToPath(root))+'/',manifest.image,names));checks++;
const previous=selectFreshOnlySourceRows(manifest,manifest.entries.map(row=>row.name),read);
assert.deepEqual(previous.rows,manifest.entries);assert.equal(previous.successor,null);checks++;
for(const noAutoTableGrants of [false,true]){
 const selected=loadCiFreshOnlyReplay(resolve(fileURLToPath(root)),manifest.image,names,{noAutoTableGrants});
 assert.equal(selected.entries.length,304);assert.equal(selected.receipt.migrations,304);checks++;
 assert.equal(selected.receipt.manifest_sha256,'5094a272dcc9f01ccbf043f3de7012e12bdb542606089a0a818629c1ecf86b26');checks++;
 assert.equal(selected.entries.at(-1).selected.sha256,'f4e3dc5be9a465e2099bd9b23488f99b3f9e4c1d9d969844b2fa06b1fbdc7a73');checks++;
 assert.equal(selected.receipt.full_vendor_NORMAL,false);assert.equal(selected.receipt.expected_fingerprint_authority,null);checks++;
 selected.assertPreserved();checks++;
}
// Historical source298 through302 remain supported selections, each with its
// preserved original replay bytes. They must not be mistaken for truncation.
for(const [count,lastSha] of [[298,'a47387ddf244a04df646c9bb2d60eef86a769b96baf9106759f1c2a703248514'],[299,'de548422310c3369bac0560e14507e4022cc9d5b9effe898d4f24ae79156cf6a'],[300,'fa9373adcf48f8d13db1b8e4876a5f134b02f8a897f20f887987cbd384393469'],[301,'54d95f3ab7ffb088a7e72241c360fe22edb1a06a24a3f768f9adcc494ed69492'],[302,'10238c293dda15a52321fa670f3763dd772ab6d976665cf306f737c613696b6d'],[303,'063669e808c354d4f4498b13c7597b7603636badc9d2e5f9b5d819cdfeee179b']]){
 const aliases={'supabase/canonical/migration-replay-order.json':`release/fresh-only-replay/SOURCE${count}_REPLAY_ORDER.json`,...(count>=302?{'supabase/canonical/schema-fingerprint-input.json':`release/fresh-only-replay/${count===302?'source302-eight-active-normal-evidence':'source303-ticket-normal-evidence'}/CATALOG_NORMALIZED.json`,'supabase/canonical/schema-fingerprint.txt':`release/fresh-only-replay/${count===302?'source302-eight-active-normal-evidence':'source303-ticket-normal-evidence'}/FINGERPRINT.txt`}:{})};
 const historicalRead=(path,expected)=>read(aliases[path]??path,expected);
 const selected=selectFreshOnlySourceRows(manifest,names.slice(0,count),historicalRead);
 assert.equal(selected.rows.length,count);assert.equal(selected.rows.at(-1).selected.sha256,lastSha);checks++;
}
for(const changed of [names.slice(0,296),[...names.slice(0,-2),names.at(-1)],[...names,names.at(-1)],[...names.slice(0,-1),'20990101000000_unknown.sql'],names.slice().reverse()]){
 assert.throws(()=>selectFreshOnlySourceRows(manifest,changed,read));checks++;
}
for(const path of ['release/fresh-only-replay/MANIFEST.json',...['298','299','300','301','302','303','304'].map(n=>`release/fresh-only-replay/SOURCE${n}_SUCCESSOR.json`),
 ...['298','299','300','301','302','303'].map(n=>`release/fresh-only-replay/SOURCE${n}_REPLAY_ORDER.json`),'supabase/canonical/migration-replay-order.json',
 'supabase/migrations/20261028224728_full_scheduled_lunch_source_policy.sql','supabase/migrations/20261030031200_approved_manual_full_hour_coverers.sql',
 'supabase/migrations/20261030050235_compact_approved_initial_confirmation.sql','supabase/migrations/20261030155202_approved_manual_current_day_activation.sql',
 'supabase/migrations/20261031125902_approved_manual_native_operations.sql','supabase/migrations/20261031180631_cohort_ticket_transaction_context.sql','supabase/migrations/20261031225210_custodial_sealed_repairs_current_eight.sql','release/fresh-only-replay/source304-fresh-evidence/MAIN_FRESH304_CAPTURE_RESULT.json']){
 assert.throws(()=>selectFreshOnlySourceRows(manifest,names,(p,expected)=>{if(p!==path)return read(p,expected);const b=p==='release/fresh-only-replay/SOURCE302_SUCCESSOR.json'?Buffer.from(JSON.stringify({...JSON.parse(read(p)),source_migrations:303})):p==='release/fresh-only-replay/SOURCE303_SUCCESSOR.json'?Buffer.from(JSON.stringify({...JSON.parse(read(p)),source_migrations:304})):p==='release/fresh-only-replay/SOURCE304_SUCCESSOR.json'?Buffer.from(JSON.stringify({...JSON.parse(read(p)),source_migrations:305})):Buffer.concat([read(p),Buffer.from(' ')]);if(expected){assert.equal(b.length,expected.bytes);assert.equal(sha(b),expected.sha256);}return b;}),path);checks++;
}
console.log(JSON.stringify({status:'PASS',checks,predecessorMigrations:297,preservedSuccessors:[298,299,300,301,302,303],currentMigrations:304,frozenPredecessorUnchanged:true,profiles:['selected','no-auto'],SQL_executed:false}));

});
