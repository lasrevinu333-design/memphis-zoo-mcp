import {isRuntimeSuccessorPath,restoreRuntimeCurrentSource,verifyRuntimeSuccessorInputs} from './scheduler-runtime-source-successor.mjs';
import {restoreReminderHistoricalSource} from './reminder-timing-source-successor.mjs';
// Test-only exact successor projection for the retained historical CI proofs.
// Current behavior is executed separately by the mandatory current owning suite.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {resolve,dirname,relative,sep} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=readFileSync(new URL('./current-departure-source-successor.json',import.meta.url));
assert.ok(bytes.length<=256*1024);assert.equal(sha(bytes),'8ed168f39c3685f73c9d8aa4bd0547125635bc5d6cd6ebbf5fc93bb96760547c');
const document=JSON.parse(bytes);
assert.equal(document.schema,'custodial.current-departure-source-proof-successor.v1');
for(const key of ['runtime_admission','sql_execution','clock_qualification','audio_qualification','worker_activation','historical_pins_rewritten'])assert.equal(document[key],false);
assert.equal(document.profiles.length,27);
const profiles=new Map(document.profiles.map(row=>[row.path,row]));assert.equal(profiles.size,27);
export const isCurrentDepartureProofPath=path=>profiles.has(path);
export function restoreCurrentDepartureProofSource(path,source){
 source=restoreReminderHistoricalSource(path,source);
 assert.equal(typeof source,'string');const row=profiles.get(path);assert.ok(row,'explicit current departure proof path required');
 assert.equal(sha(source),row.current_sha256,'unrecognized current departure source: '+path);
 assert.ok(row.hunks.length>0&&row.hunks.length<=16);
 for(const change of row.hunks){
  assert.equal(typeof change.current,'string');assert.equal(typeof change.prior,'string');
  assert.ok(change.current.length>0&&Buffer.byteLength(change.current)<=256*1024&&Buffer.byteLength(change.prior)<=256*1024);
  assert.equal(source.split(change.current).length,2,'unique complete departure successor hunk');
  source=source.replace(change.current,change.prior);
 }
 assert.equal(sha(source),row.prior_sha256,'entire preserved departure predecessor required');return source;
}
export function restoreRecognizedCurrentDepartureSource(path,source){
 source=restoreReminderHistoricalSource(path,source);
 const row=profiles.get(path);assert.ok(row);return sha(source)===row.current_sha256?restoreCurrentDepartureProofSource(path,source):source;
}
export function restoreCurrentCanonicalForHistoricalProof(source){
 const path='supabase/canonical/migration-replay-order.json';
 return sha(source)===profiles.get(path).current_sha256?restoreCurrentDepartureProofSource(path,source):source;
}
const allPaths=[...profiles.keys(),...document.current_owning_inputs.map(row=>row.path)];
assert.equal(new Set(allPaths).size,allPaths.length);
export function validateCurrentDepartureProofInputs(files){
 assert.deepEqual(Object.keys(files).sort(),allPaths.slice().sort());
 for(const row of document.profiles)restoreCurrentDepartureProofSource(row.path,files[row.path]);
 for(const row of document.current_owning_inputs){const actual=restoreReminderHistoricalSource(row.path,files[row.path]);const source=isRuntimeSuccessorPath(row.path)?restoreRuntimeCurrentSource(row.path,actual):actual;assert.equal(Buffer.byteLength(source),row.bytes);assert.equal(sha(source),row.sha256,'current departure owning input: '+row.path);}
 return Object.freeze({status:'PASS',profiles:27,current_inputs:document.current_owning_inputs.length,SQL_executed:false,runtime_admission:false});
}
export function readCurrentDepartureProofInputs(root){
 root=resolve(root);verifyRuntimeSuccessorInputs(root);return Object.fromEntries(allPaths.map(path=>{
  const file=resolve(root,path),rel=relative(root,file);assert.ok(rel&&!rel.startsWith('..'+sep)&&!rel.startsWith(sep));
  for(let part=file;part!==root;part=dirname(part))assert.equal(lstatSync(part).isSymbolicLink(),false);
  assert.ok(lstatSync(file).isFile());return[path,readFileSync(file,'utf8')];
 }));
}
export function verifyCurrentDepartureProofInputs(root){return validateCurrentDepartureProofInputs(readCurrentDepartureProofInputs(root));}
