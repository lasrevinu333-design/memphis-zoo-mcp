import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {assertFixtureCgroupMemory} from './fixture-cgroup-memory-contract.mjs';
import {deriveCanonical304KernelResourceDriver,withCanonical304KernelResourceDriver} from './canonical304-kernel-resource-view.mjs';
const snapshot=()=>({memoryMax:536870912,memorySwap:536870912,kernelSwapMax:0,memoryCurrent:287305728,memoryPeak:536875008,
 memoryEvents:{max:316,oom:0,oom_kill:0}});
test('kernel-accounted over-limit peak remains visible while fixed cap, no swap and no OOM are verified',()=>{
 const s=snapshot(),before=JSON.stringify(s),r=assertFixtureCgroupMemory(s,{requireNoOom:true});
 assert.equal(r.observedPeakBytes,536875008);assert.equal(r.observedPeakOverLimitBytes,4096);assert.equal(r.configuredLimitBytes,536870912);
 assert.equal(r.absolutePeakCeilingClaimed,false);assert.equal(r.noOomVerified,true);assert.equal(JSON.stringify(s),before);
 const ordinary=snapshot();ordinary.memoryPeak=ordinary.memoryCurrent;ordinary.memoryEvents.max=0;assert.doesNotThrow(()=>assertFixtureCgroupMemory(ordinary,{requireNoOom:true}));
});
test('resource checks still refuse changed limits, swap, OOM, malformed counts and inconsistent peak history',()=>{
 for(const edit of [s=>s.memoryMax=1073741824,s=>s.memorySwap=1073741824,s=>s.kernelSwapMax=1,
  s=>s.memoryPeak=NaN,s=>s.memoryPeak=-1,s=>s.memoryCurrent=-1,s=>s.memoryPeak=s.memoryCurrent-1,
  s=>s.memoryEvents.max=0,s=>s.memoryEvents.oom=1,s=>s.memoryEvents.oom_kill=1,s=>s.memoryEvents.max='316']){
  const s=snapshot();edit(s);assert.throws(()=>assertFixtureCgroupMemory(s,{requireNoOom:true}));
 }
 let traps=0;const s=snapshot();Object.defineProperty(s,'memoryPeak',{get(){traps++;return 1;}});assert.throws(()=>assertFixtureCgroupMemory(s));assert.equal(traps,0);
 assert.throws(()=>assertFixtureCgroupMemory(new Proxy(snapshot(),{})));
});
const original=readFileSync(new URL('./sealed-repair-canonical-database-tests.mjs',import.meta.url));
test('whole original frozen driver is digest-bound and only resource observation has an explicit successor',()=>{
 const {driver,proof}=deriveCanonical304KernelResourceDriver(original),text=driver.toString();
 assert.equal(proof.original_driver_sha256,'fbf7fce4da266a3dd07cae3c1fc9edc6fdaef3a8c2836a0034dab6e01a67da51');
 assert.equal(proof.historical_driver_executed_verbatim,false);assert.equal(proof.original_SQL_and_OOM_checks_unchanged,true);
 assert.match(text,/snapshot\.kernelSwapMax=Number\(read\('memory.swap.max'\)\)/);
 assert.ok(text.indexOf("fs.writeFileSync(resolve(args[1],'RESOURCE_")<text.indexOf('assertFixtureCgroupMemory(snapshot,'),'retain actual raw evidence before refusing a validation');
 assert.match(text,/snapshot\.memoryEvents\.oom_kill,0/);assert.match(text,/snapshot\.memoryEvents\.oom,0/);
 for(const changed of [Buffer.concat([original,Buffer.from('\n')]),Buffer.from(original.toString().replace('536870912','1073741824'))])assert.throws(()=>deriveCanonical304KernelResourceDriver(changed));
});
async function world(run){
 const root=mkdtempSync(resolve(tmpdir(),'custodial-kernel-source-view-'));mkdirSync(resolve(root,'scripts'));
 for(const name of ['sealed-repair-canonical-database-tests.mjs','fixture-cgroup-memory-contract.mjs'])cpSync(new URL('./'+name,import.meta.url),resolve(root,'scripts',name));
 try{return await run(root);}finally{rmSync(root,{recursive:true});}
}
test('owned driver view is source-only, leaves original bytes intact and removes only its own temporary file',async()=>world(async root=>{
 let path;const result=await withCanonical304KernelResourceDriver(root,async(file,proof)=>{
  path=file;assert.equal(lstatSync(file).mode&0o777,0o400);assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),proof.derived_driver_sha256);
  return{fixtureOnly:true};
 });assert.equal(result.fixtureOnly,true);assert.equal(existsSync(path),false);assert.deepEqual(readFileSync(resolve(root,'scripts/sealed-repair-canonical-database-tests.mjs')),original);
}));
test('callback refusal closes its owned source view without running or claiming any SQL',async()=>world(async root=>{
 let path;await assert.rejects(()=>withCanonical304KernelResourceDriver(root,async file=>{path=file;throw Error('OFFLINE_SENTINEL');}),/OFFLINE_SENTINEL/);assert.equal(existsSync(path),false);
}));
test('original or contract drift refuses but can still clean the exact owned derived file',async()=>{
 for(const name of ['sealed-repair-canonical-database-tests.mjs','fixture-cgroup-memory-contract.mjs'])await world(async root=>{
  let path;await assert.rejects(()=>withCanonical304KernelResourceDriver(root,async file=>{path=file;writeFileSync(resolve(root,'scripts',name),'changed');}));assert.equal(existsSync(path),false);
 });
});
test('same-byte derived-file replacement cannot be adopted or deleted as the original owned file',async()=>world(async root=>{
 let path;await assert.rejects(()=>withCanonical304KernelResourceDriver(root,async file=>{path=file;const bytes=readFileSync(file);unlinkSync(file);writeFileSync(file,bytes,{flag:'wx',mode:0o400});}));
 assert.equal(existsSync(path),true,'uncertain replaced input retained for its enclosing test owner');
}));
