import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Historical source-text comparisons only. Executing tests still import the
// actual current product; no runtime, SQL, replay or receipt uses these bytes.
const sha=value=>createHash('sha256').update(value).digest('hex');
const bytes=readFileSync(new URL('./full-hour-source-predecessors.json',import.meta.url));
assert.ok(bytes.length<=256*1024);
assert.equal(sha(bytes),'dcd5e9743bf3e84aef72c056da2be0925dd79fc78a9c51b62ed4da73b407d700');
const document=JSON.parse(bytes);
assert.equal(document.schema,'custodial.full-hour-retained-source-predecessors.v1');
assert.equal(document.profiles.length,4);
export function restoreFullHourProofSource(path,source){
 const row=document.profiles.find(value=>value.path===path);
 assert.ok(row,'explicit full-hour historical source path required');
 assert.equal(typeof source,'string');
 if(sha(source)===row.prior_sha256)return source;
 assert.equal(sha(source),row.current_sha256,'exact whole current source required');
 assert.ok(row.hunks.length>0&&row.hunks.length<=16);
 for(const hunk of row.hunks){
  assert.ok(hunk.current.length>0&&Buffer.byteLength(hunk.current)<=64*1024&&Buffer.byteLength(hunk.prior)<=64*1024);
  assert.equal(source.split(hunk.current).length,2,'one complete reviewed source delta');
  source=source.replace(hunk.current,hunk.prior);
 }
 assert.equal(sha(source),row.prior_sha256,'complete authentic predecessor source required');
 return source;
}
