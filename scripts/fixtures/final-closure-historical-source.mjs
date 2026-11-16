// Select the exact historical304 closure suite; current forward admission is separate.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {withSealedCanonical304SourceFixture} from './sealed-canonical304-source-fixture.mjs';
export const originalFinalClosureSha='eab515c5a2d81cffe7787fa8cfedd9b99197e4f38281037ad4637bd96ce8f508';
export const originalFinalClosureBytes=4663;
export function originalFinalClosureSource(root){
 const bytes=readFileSync(resolve(root,'release/final-closure-historical-source/'+originalFinalClosureSha+'.mjs'));
 assert.equal(bytes.length,originalFinalClosureBytes);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),originalFinalClosureSha,'Complete original closure suite required');
 return bytes;
}
export async function withHistoricalFinalClosureSource(root,run){
 const original=originalFinalClosureSource(root);assert.equal(typeof run,'function');
 return withSealedCanonical304SourceFixture(root,async(fixture,proof)=>{
  writeFileSync(resolve(fixture,'scripts/final-closure-database-isolated-tests.mjs'),original);
  assert.deepEqual(readFileSync(resolve(fixture,'scripts/final-closure-database-isolated-tests.mjs')),original);
  return run(fixture,Object.freeze({...proof,original_suite_sha256:originalFinalClosureSha,original_suite_bytes:originalFinalClosureBytes}));
 });
}
