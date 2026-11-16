import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadCiFreshOnlyReplay} from './ci-fresh-only-replay.mjs';
import {originalFinalClosureSha,originalFinalClosureBytes,originalFinalClosureSource,withHistoricalFinalClosureSource} from './fixtures/final-closure-historical-source.mjs';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const names=r=>readdirSync(resolve(r,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort();
const image=JSON.parse(readFileSync(resolve(root,'release/fresh-only-replay/MANIFEST.json'))).image;
test('the current migration directory cannot be silently admitted as the retained closure database',()=>{
 assert.ok(names(root).length>=319);
 assert.throws(()=>loadCiFreshOnlyReplay(root,image,names(root)),/only the exact source298\/source299\/source300\/source301 successor is admitted/);
});
test('complete original closure bytes, constructor and both downstream suites survive exact source selection',async()=>{
 let selected;
 await withHistoricalFinalClosureSource(root,async(fixture,proof)=>{
  selected=fixture;assert.equal(names(fixture).length,304);
  const bytes=readFileSync(resolve(fixture,'scripts/final-closure-database-isolated-tests.mjs'));
  assert.equal(bytes.length,originalFinalClosureBytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),originalFinalClosureSha);
  for(const command of ['scripts/empty-database-rebuild-check.mjs','scripts/release-canary-recovery-database-tests.mjs','scripts/final-uncertainty-closure-database-tests.mjs'])assert.ok(bytes.includes(Buffer.from(command)));
  assert.ok(bytes.includes(Buffer.from('remove: true')));assert.ok(bytes.includes(Buffer.from('await assertCiFreshOnlyRetainedFixture(retainedIdentity)')));
  assert.equal(proof.current319_or_production_admission,false);assert.equal(proof.original_suite_sha256,originalFinalClosureSha);
  const selection=loadCiFreshOnlyReplay(fixture,image,names(fixture));assert.equal(selection.receipt.migrations,304);
 });
 assert.equal(existsSync(selected),false);
});
test('an interrupted consumer keeps its failure and removes only the owned source fixture',async()=>{
 let selected;
 await assert.rejects(()=>withHistoricalFinalClosureSource(root,fixture=>{selected=fixture;throw new Error('original consumer refused');}),/original consumer refused/);
 assert.equal(existsSync(selected),false);
});
test('changed or truncated original test source cannot run under the historical identity',()=>{
 const scratch=mkdtempSync(resolve(tmpdir(),'custodial-closure-source-refusal-'));
 try{
  const target=resolve(scratch,'release/final-closure-historical-source/'+originalFinalClosureSha+'.mjs');mkdirSync(dirname(target),{recursive:true});
  for(const value of [Buffer.concat([originalFinalClosureSource(root),Buffer.from('\n')]),Buffer.alloc(originalFinalClosureBytes,32)]){
   writeFileSync(target,value);assert.throws(()=>originalFinalClosureSource(scratch));
  }
 }finally{rmSync(scratch,{recursive:true});}
});
