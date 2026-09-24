import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {assertExactFrontendPair} from './fixtures/exact-frontend-pair.mjs';
const input=JSON.parse(readFileSync(new URL('../release/schema-alignment-input.json',import.meta.url),'utf8'));
const current=JSON.parse(readFileSync(new URL('../release/frontend-release-manifest.json',import.meta.url),'utf8'));
const stale='6fae503111ef21c40a309913965c3b963043aa01';
let passed=0;
for(const [file,manifestName] of [
 ['custodial-repair-contract-tests.mjs','frontendReleaseManifest'],
 ['operations-leadership-mobile-contract-tests.mjs','releaseManifest'],
]){
 const source=readFileSync(new URL(file,import.meta.url),'utf8');
 assert.match(source,/import \{ assertExactFrontendPair \} from '\.\/fixtures\/exact-frontend-pair\.mjs'/);passed++;
 assert.match(source,/release\/schema-alignment-input\.json/);passed++;
 assert.ok(!source.includes(stale),'no positive stale literal in '+file);passed++;
 const call=source.match(new RegExp(`^assertExactFrontendPair\\(${manifestName}, releasePairInput\\);$`,'m'))?.[0];
 assert.ok(call,'actual owning consumer required: '+file);passed++;
 const execute=(manifest,authority)=>vm.runInNewContext(call,
  {assertExactFrontendPair,[manifestName]:manifest,releasePairInput:authority});
 execute(current,input);passed++;
 for(const sha of ['a'.repeat(40),'b'.repeat(40)]){
  const next={...input,frontend_commit_sha:sha};
  execute({...current,frontend_commit_sha:sha},next);passed++;
  assert.throws(()=>execute(current,next),/exact release-pair authority/);passed++;
  assert.throws(()=>execute({...current,frontend_commit_sha:stale},next),/exact release-pair authority/);passed++;
 }
 assert.throws(()=>execute({...current,frontend_commit_state:'draft'},input));passed++;
 assert.throws(()=>execute({...current,frontend_commit_sha:''},{...input,frontend_commit_sha:''}),/exact frontend commit/);passed++;
 assert.throws(()=>execute({...current,frontend_commit_state:'draft'},{...input,frontend_commit_state:'draft'}));passed++;
}
console.log(JSON.stringify({passed,failed:0,scope:'exact positive frontend-pair consumers',production_mutation:false}));
