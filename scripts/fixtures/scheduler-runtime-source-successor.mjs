// Test-only byte provenance. Runtime modules never import this helper.
import {restoreReminderHistoricalSource} from './reminder-timing-source-successor.mjs';
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative,sep} from 'node:path';
const sha=x=>createHash('sha256').update(x).digest('hex');
const bytes=readFileSync(new URL('./scheduler-runtime-source-successor.json',import.meta.url));
assert.ok(bytes.length<=1024*1024);assert.equal(sha(bytes),'b378d375b92726662154cc75f669d90750ccccad420caa069118ff1897cb248b');
const document=JSON.parse(bytes);
assert.equal(document.schema,'custodial.scheduler-runtime-proof-successor.v1');
assert.equal(document.profiles.length,9);
const profiles=new Map(document.profiles.map(row=>[row.path,row]));assert.equal(profiles.size,9);
export const isRuntimeSuccessorPath=path=>profiles.has(path);
export function restoreRuntimeCurrentSource(path,source){
 const row=profiles.get(path);assert.ok(row,'explicit runtime successor path required');assert.equal(typeof source,'string');
 assert.equal(sha(source),row.current_sha256,'whole qualified runtime successor required: '+path);
 assert.ok(row.hunks.length>0&&row.hunks.length<=16);
 for(const hunk of row.hunks){assert.ok(hunk.current.length>0&&Buffer.byteLength(hunk.current)<=256*1024&&Buffer.byteLength(hunk.prior)<=256*1024);assert.equal(source.split(hunk.current).length,2,'unique whole successor hunk');source=source.replace(hunk.current,hunk.prior);}
 assert.equal(sha(source),row.prior_sha256,'entire frozen predecessor required');return source;
}
export function restoreRecognizedRuntimeSource(path,source){
 const row=profiles.get(path);return row&&sha(source)===row.current_sha256?restoreRuntimeCurrentSource(path,source):source;
}
const paths=[...profiles.keys(),...document.owning_inputs.map(row=>row.path)];assert.equal(new Set(paths).size,paths.length);
export function validateRuntimeSuccessorInputs(files){
 assert.deepEqual(Object.keys(files).sort(),paths.slice().sort());
 for(const row of document.profiles)restoreRuntimeCurrentSource(row.path,files[row.path]);
 for(const row of document.owning_inputs){const source=restoreReminderHistoricalSource(row.path,files[row.path]);assert.equal(Buffer.byteLength(source),row.bytes);assert.equal(sha(source),row.sha256,'actual runtime owning input: '+row.path);}
 return {status:'PASS',profiles:9,owningInputs:document.owning_inputs.length,historicalPinsRewritten:false};
}
export function readRuntimeSuccessorInputs(root){
 root=resolve(root);return Object.fromEntries(paths.map(path=>{const file=resolve(root,path),rel=relative(root,file);assert.ok(rel&&!rel.startsWith('..'+sep)&&!rel.startsWith(sep));for(let part=file;part!==root;part=dirname(part))assert.equal(lstatSync(part).isSymbolicLink(),false);assert.ok(lstatSync(file).isFile());return[path,readFileSync(file,'utf8')];}));
}
export function verifyRuntimeSuccessorInputs(root){return validateRuntimeSuccessorInputs(readRuntimeSuccessorInputs(root));}
