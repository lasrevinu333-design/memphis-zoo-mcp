import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreSchedulerProofSource} from './current-scheduler-source-profiles.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const document=JSON.parse(readFileSync(new URL('./current-scheduler-source-profile-deltas.json',import.meta.url)));
let checks=0;
for(const row of document.profiles){
 const current=readFileSync(new URL('../../'+row.path,import.meta.url),'utf8');
 const prior=restoreSchedulerProofSource(row.profile,current);assert.equal(sha(prior),row.prior_sha256);checks++;
 assert.throws(()=>restoreSchedulerProofSource(row.profile,current+'\n// unrelated drift\n'));checks++;
 assert.throws(()=>restoreSchedulerProofSource(row.profile,current.replace(row.hunks[0].current,'// missing delta')));checks++;
 assert.throws(()=>restoreSchedulerProofSource(row.profile,current.replace(row.hunks[0].current,row.hunks[0].current+row.hunks[0].current)));checks++;
 assert.throws(()=>restoreSchedulerProofSource(row.profile,prior));checks++;
}
// The fixture document and all15 historical endpoints remain immutable.
const nativeProfile='NATIVE_CURRENT_REPLAY_MANIFEST_RETAINED_WIRING',manifestPath=new URL('../../supabase/canonical/migration-replay-order.json',import.meta.url),current298=readFileSync(manifestPath,'utf8');
assert.equal(sha(current298),'aca06e305ff4c5918e83045acf4d739fcb8746e41dcc89ceb59fcd0f98ab20ba');checks++;
const predecessor297=JSON.parse(current298);
assert.deepEqual(predecessor297.phases[2].files.pop(),{name:'20261028224728_full_scheduled_lunch_source_policy.sql',sha256:'a47387ddf244a04df646c9bb2d60eef86a769b96baf9106759f1c2a703248514'});checks++;
const current297=JSON.stringify(predecessor297,null,2)+'\n';
assert.equal(restoreSchedulerProofSource(nativeProfile,current298),restoreSchedulerProofSource(nativeProfile,current297));checks++;
for(const mutate of [d=>d.phases[2].files.at(-1).sha256='f'.repeat(64),d=>d.phases[0].files[0].sha256='f'.repeat(64),d=>d.phases[2].files.push({...d.phases[2].files.at(-1)})]){const changed=JSON.parse(current298);mutate(changed);assert.throws(()=>restoreSchedulerProofSource(nativeProfile,JSON.stringify(changed,null,2)+'\n'));checks++;}
assert.throws(()=>restoreSchedulerProofSource(nativeProfile,current298+' '));checks++;

assert.equal(sha(current297),'e37cf98ffde8165797069595b45d84fdaf89871a719c31a839905e9e6317d54c');checks++;
const old=JSON.parse(current297);old.phases[2].files=old.phases[2].files.slice(0,-3);const retained294=JSON.stringify(old,null,2)+'\n';
assert.equal(sha(retained294),'5a0ac3a398d25f59a0a7f6e045d0db1c4d59b28924a18ec479f01bbe5a710121');checks++;
assert.equal(restoreSchedulerProofSource(nativeProfile,current297),restoreSchedulerProofSource(nativeProfile,retained294));checks++;
for(const mutate of [
 doc=>doc.phases[2].files.pop(),
 doc=>doc.phases[2].files.push({name:'20990101000000_unknown.sql',sha256:'f'.repeat(64)}),
 doc=>doc.phases[2].files[0].sha256='f'.repeat(64),
 doc=>doc.phases[0].files[0].sha256='f'.repeat(64),
 doc=>doc.phases[2].files.at(-1).sha256='f'.repeat(64),
 doc=>doc.phases[2].files.at(-2).name='20990101000000_unknown.sql',
 doc=>doc.phases[2].files.reverse(),
 doc=>doc.phases.push({kind:'unknown',files:[]}),
]) {const changed=JSON.parse(current297);mutate(changed);assert.throws(()=>restoreSchedulerProofSource(nativeProfile,JSON.stringify(changed,null,2)+'\n'));checks++;}
assert.throws(()=>restoreSchedulerProofSource(nativeProfile,current297+' '));checks++;
assert.throws(()=>restoreSchedulerProofSource('NATIVE_CURRENT_HTTP_SELECTED_DEVICE_PIN',current297));checks++;
assert.throws(()=>restoreSchedulerProofSource('UNKNOWN',''));checks++;
console.log(JSON.stringify({status:'PASS',checks,profiles:document.profiles.length,scope:'Source-only exact whole-image prior reconstruction, unknown/missing/duplicate/drift refusals',sql:false}));
