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
assert.throws(()=>restoreSchedulerProofSource('UNKNOWN',''));checks++;
console.log(JSON.stringify({status:'PASS',checks,profiles:document.profiles.length,scope:'Source-only exact whole-image prior reconstruction, unknown/missing/duplicate/drift refusals',sql:false}));
