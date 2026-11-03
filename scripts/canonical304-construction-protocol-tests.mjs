import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('./sealed-repair-canonical-database-tests.mjs',import.meta.url),'utf8');
const a=source.indexOf('const constructFixture=async options=>{'),b=source.indexOf('const afterInitial=async context=>{',a);assert.ok(a>0&&b>a);const executable=source.slice(a,b);
const name='20261031225210_custodial_sealed_repairs_current_eight.sql';let passed=0;
async function check(mode){
 const counts={factory:0,pools:0,close:0,capture:0,cleanup:0},saved=new Map(),observations=[];const original=Error('synthetic '+mode);
 const fixture={receipt:{selected_replay:{migrations:mode==='wrong-count'?303:304,source_successor:{appended_migration:name}}},async cleanup(){counts.cleanup++;if(mode==='cleanup-fail')throw Error('synthetic cleanup unresolved');return {exact:true}}};
 class Pool{constructor(options){counts.pools++;assert.equal(options.max,1)}on(){return this}async end(){counts.close++;if(mode==='pool-close-fail')throw original;}}
 const context=vm.createContext({observedFixture:null,freshConstructionCapture:null,manifest:{atomicBatch:{migrationName:name}},pg:{Pool},
  createCiFreshOnlyFixture:async options=>{counts.factory++;assert.equal(options.dataStorage,'owned-disk');if(mode==='birth-fail')throw original;return fixture},
  observeResources:async(stage,options)=>{observations.push([stage,options]);if(mode==='observe-fail')throw original},
  freshCapture:{async run(){counts.capture++;if(['capture-fail','cleanup-fail'].includes(mode))throw original;return {status:'PASS',actualFresh304:mode!=='false-fresh'}}},
  saveConstruction:(n,v)=>saved.set(n,v),unchanged(){},assert});
 vm.runInContext(executable+'\nglobalThis.construct=constructFixture;',context);
 if(mode==='success'){const returned=await context.construct({name:'mz_schema_rebuild_protocol',hostSocket:true});assert.equal(counts.close,1);assert.equal(counts.cleanup,0);assert.ok(saved.has('CANONICAL304_ORIGINAL_CONSTRUCTION_RECEIPT.json'));await returned.cleanup();assert.equal(counts.cleanup,1);assert.equal(observations.at(-1)[1].requireNoOom,true);}
 else{let failure;try{await context.construct({name:'mz_schema_rebuild_protocol',hostSocket:true})}catch(e){failure=e}assert.ok(failure);
  if(mode==='birth-fail')assert.deepEqual(counts,{factory:1,pools:0,close:0,capture:0,cleanup:0});
  else if(mode==='wrong-count'){assert.equal(counts.pools,0);assert.equal(counts.capture,0);assert.equal(counts.cleanup,1)}
  else if(mode==='observe-fail'){assert.equal(counts.pools,0);assert.equal(counts.cleanup,1)}
  else if(mode==='pool-close-fail'){assert.equal(counts.close,1);assert.equal(counts.cleanup,0);assert.equal(failure.name,'AggregateError');assert.equal(saved.get('CANONICAL304_PRE_INITIAL_FAILURE_CLEANUP.json').originalOwnedCleanupReturned,false)}
  else{assert.equal(counts.close,1);assert.equal(counts.cleanup,1);if(mode==='cleanup-fail')assert.equal(failure.name,'AggregateError')}
 }
 assert.equal(counts.factory,1);passed++;
}
for(const mode of ['success','birth-fail','wrong-count','observe-fail','capture-fail','false-fresh','pool-close-fail','cleanup-fail'])await check(mode);
assert.ok(!source.includes("runSql(manifest.atomicBatch,'ATOMIC_BATCH')"));assert.ok(!source.includes("for(const ref of manifest.originals)await runSql"));assert.ok(source.includes("for(const ref of manifest.regressions)"));assert.ok(source.includes("for(const ref of manifest.afterSignedSql)"));assert.ok(source.includes('for(const {ref,module}of loaded)'));
console.log(JSON.stringify({status:'PASS',checks:passed,scope:'Actual construction-wrapper lifecycle with offline factory/pool/capture ports. No database, constructor, successful schema measurement, provider or full workflow acceptance.'}));
