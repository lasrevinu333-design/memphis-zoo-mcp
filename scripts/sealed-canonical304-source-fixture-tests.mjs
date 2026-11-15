import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyCanonical304Predecessors,withSealedCanonical304SourceFixture} from './fixtures/sealed-canonical304-source-fixture.mjs';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const {predecessors,refs}=verifyCanonical304Predecessors(root);let checks=1;
const scratch=mkdtempSync(resolve(tmpdir(),'custodial-304-source-hostile-'));
try{
 const dir='scripts/fixtures/sealed-repair',vendor=dir+'/canonical304-predecessor';mkdirSync(resolve(scratch,dir),{recursive:true});
 for(const file of ['CANONICAL304_PLAN.json','CANONICAL304_PREDECESSORS.json'])cpSync(resolve(root,dir,file),resolve(scratch,dir,file));
 cpSync(resolve(root,vendor),resolve(scratch,vendor),{recursive:true});verifyCanonical304Predecessors(scratch);checks++;
 for(const row of predecessors.files){
  const p=resolve(scratch,vendor,row.path),before=readFileSync(p);
  try{writeFileSync(p,Buffer.concat([before,Buffer.from('\n')]));assert.throws(()=>verifyCanonical304Predecessors(scratch),row.path);checks++;}
  finally{writeFileSync(p,before);}
 }
 for(const file of ['CANONICAL304_PLAN.json','CANONICAL304_PREDECESSORS.json']){
  const p=resolve(scratch,dir,file),before=readFileSync(p);
  try{writeFileSync(p,Buffer.concat([before,Buffer.from(' ')]));assert.throws(()=>verifyCanonical304Predecessors(scratch));checks++;}
  finally{writeFileSync(p,before);}
 }
 const p=resolve(scratch,vendor,predecessors.files[0].path),original=readFileSync(p);
 try{rmSync(p);assert.throws(()=>verifyCanonical304Predecessors(scratch));checks++;
  symlinkSync(resolve(root,vendor,predecessors.files[0].path),p);assert.throws(()=>verifyCanonical304Predecessors(scratch));checks++;
 }finally{if(existsSync(p))rmSync(p);writeFileSync(p,original);}
 const extra=resolve(scratch,vendor,'unknown-current-source.js');
 try{writeFileSync(extra,'unknown',{flag:'wx'});assert.throws(()=>verifyCanonical304Predecessors(scratch));checks++;}finally{rmSync(extra);}
 const source=resolve(scratch,vendor,'src'),moved=source+'-owned';renameSync(source,moved);symlinkSync(moved,source,'dir');
 try{assert.throws(()=>verifyCanonical304Predecessors(scratch));checks++;}finally{rmSync(source);renameSync(moved,source);}
 verifyCanonical304Predecessors(scratch);checks++;
}finally{rmSync(scratch,{recursive:true});}
let fixturePath;
await withSealedCanonical304SourceFixture(root,async(fixture,receipt)=>{
 fixturePath=fixture;assert.equal(receipt.historical_migrations,304);assert.equal(receipt.protected_source_refs,refs.size);
 assert.equal(receipt.genuine_predecessors,66);assert.equal(receipt.current319_or_production_admission,false);checks++;
});
assert.equal(existsSync(fixturePath),false);checks++;
await assert.rejects(()=>withSealedCanonical304SourceFixture(root,async fixture=>{
 fixturePath=fixture;throw new Error('owned child refused before any SQL');
}),/owned child refused/);checks++;
assert.equal(existsSync(fixturePath),false);checks++;
verifyCanonical304Predecessors(root);checks++;
console.log(JSON.stringify({status:'PASS_EXACT_HISTORICAL304_SOURCE_FIXTURE',checks,genuine_predecessors:66,
 original_plan_refs:refs.size,historical_pins_rewritten:false,actual_SQL:false,current319_or_production_admission:false,
 task_owned_fixtures_removed:true,app_build_install_or_phone:false}));
