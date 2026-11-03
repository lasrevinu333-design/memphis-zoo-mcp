import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreFullHourProofSource} from './full-hour-source-predecessors.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const document=JSON.parse(readFileSync(new URL('./full-hour-source-predecessors.json',import.meta.url)));
let checks=0;
for(const row of document.profiles){
 const current=readFileSync(new URL('../../'+row.path,import.meta.url),'utf8');
 const prior=restoreFullHourProofSource(row.path,current);
 assert.equal(sha(prior),row.prior_sha256);checks++;
 assert.equal(restoreFullHourProofSource(row.path,prior),prior);checks++;
 for(const bad of [current+'\n',current.replace(row.hunks[0].current,''),current.replace(row.hunks[0].current,row.hunks[0].current+row.hunks[0].current)]){
  assert.throws(()=>restoreFullHourProofSource(row.path,bad));checks++;
 }
 const other=document.profiles.find(value=>value.path!==row.path);
 assert.throws(()=>restoreFullHourProofSource(other.path,current));checks++;
}
assert.throws(()=>restoreFullHourProofSource('src/unknown.js',''));checks++;
console.log(JSON.stringify({status:'PASS',checks,profiles:4,scope:'Exact current and predecessor text bindings only; mutated or unknown source refused',runtime:false,sql:false}));
