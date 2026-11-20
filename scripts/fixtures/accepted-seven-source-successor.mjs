// Test-only exact inverse. It cannot admit or execute the seven-person update.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
const sha=x=>createHash('sha256').update(x).digest('hex');
const raw=readFileSync(new URL('./accepted-seven-source-successor.json',import.meta.url));
assert.equal(sha(raw),'ce26e9f890377f865ac66bd1cb589db19a7bb44cc4cb7f6685d017e1fc94bedc');
const doc=JSON.parse(raw);assert.equal(doc.historical_pins_rewritten,false);assert.equal(doc.runtime_admission,false);
export function restoreAcceptedSevenHistoricalSource(path,source){
 const row=doc.modified.find(r=>r.path===path);if(!row||sha(source)!==row.current_sha256)return source;
 assert.equal(source.split(row.current).length,2);source=source.replace(row.current,()=>row.prior);
 assert.equal(sha(source),row.prior_sha256);return source;
}
export function verifyAcceptedSevenCurrentSource(root){
 root=resolve(root);
 for(const row of doc.modified){const file=resolve(root,row.path);assert.ok(file.startsWith(root+'/'));
  for(let p=file;p!==root;p=dirname(p))assert.equal(lstatSync(p).isSymbolicLink(),false);
  assert.equal(sha(readFileSync(file)),row.current_sha256);}
 return {files:doc.modified.length,sqlExecuted:false,runtimeAdmission:false};
}
