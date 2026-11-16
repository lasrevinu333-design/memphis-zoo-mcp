import {createHash} from 'node:crypto';import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,unlinkSync,renameSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,basename} from 'node:path';import {spawnSync} from 'node:child_process';
import {withHistoricalFinalClosureSource,originalFinalClosureSource} from './fixtures/final-closure-historical-source.mjs';
import {withGpsSessionOwnedSource,deriveGpsClosureRunner} from './gps-session-owned-source-view.mjs';
const root=resolve(new URL('../',import.meta.url).pathname);
test('complete selected historical closure routes explicit candidate, syntax checks only, originals retained',async()=>{
 await withHistoricalFinalClosureSource(root,async(fixture,proof)=>{
  assert.equal(proof.protected_source_refs,345);assert.equal(proof.genuine_predecessors,66);
  const before=readFileSync(resolve(fixture,'scripts/empty-database-rebuild-check.mjs'));let paths;
  await withGpsSessionOwnedSource(fixture,async(entrypoint,p)=>{
   paths=p.ownedCandidates.map(x=>x.path);assert.equal(paths.length,2);assert.equal(p.SQLExecuted,false);assert.equal(p.rebuild.completeInverse,true);assert.equal(p.runner.completeInverse,true);
   for(const path of paths){const r=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
   const runner=readFileSync(entrypoint,'utf8');assert.ok(runner.includes(basename(paths[0])));assert.ok(runner.includes('remove: true'));
   assert.deepEqual(readFileSync(resolve(fixture,'scripts/empty-database-rebuild-check.mjs')),before);
  });for(const path of paths)assert.equal(existsSync(path),false);
 });
});
function scratch(){const r=mkdtempSync(resolve(tmpdir(),'gps-source-lifecycle-'));mkdirSync(resolve(r,'scripts'));writeFileSync(resolve(r,'scripts/empty-database-rebuild-check.mjs'),readFileSync(resolve(root,'scripts/empty-database-rebuild-check.mjs')));writeFileSync(resolve(r,'scripts/final-closure-database-isolated-tests.mjs'),originalFinalClosureSource(root));return r;}
test('callback refusal preserves error and removes only original owned candidate files',async()=>{const r=scratch();let paths;try{await assert.rejects(()=>withGpsSessionOwnedSource(r,async(_,p)=>{paths=p.ownedCandidates.map(x=>x.path);throw new Error('consumer refusal');}),/consumer refusal/);for(const p of paths)assert.equal(existsSync(p),false);assert.ok(existsSync(resolve(r,'scripts/empty-database-rebuild-check.mjs')));}finally{rmSync(r,{recursive:true});}});
test('same-byte candidate replacement is rejected and not unlinked by owner',async()=>{const r=scratch();let target;try{await assert.rejects(()=>withGpsSessionOwnedSource(r,async(_,p)=>{target=p.ownedCandidates[0].path;const b=readFileSync(target);renameSync(target,target+'.original');writeFileSync(target,b,{mode:0o400});}));assert.ok(existsSync(target));}finally{rmSync(r,{recursive:true});}});
test('runner successor refuses changed original and arbitrary execution path',()=>{const o=originalFinalClosureSource(root);assert.throws(()=>deriveGpsClosureRunner(Buffer.concat([o,Buffer.from('\n')]),'scripts/.gps-rebuild-'+'a'.repeat(24)+'.mjs'));for(const p of ['scripts/evil.mjs','../scripts/.gps-rebuild-'+'a'.repeat(24)+'.mjs'])assert.throws(()=>deriveGpsClosureRunner(o,p));});

test('current entrypoint routes only explicit successor and reverses to exact prior wrapper',()=>{
 let s=readFileSync(resolve(root,'scripts/final-closure-database-isolated-tests.mjs'),'utf8');
 const edits=[
 ["import {withGpsSessionOwnedSource} from './gps-session-owned-source-view.mjs';\n",''],
 [" await withGpsSessionOwnedSource(fixture,async(entrypoint,successor)=>{\n console.log(JSON.stringify({status:'EXACT_GPS_SESSION_FIXTURE_SUCCESSOR',...successor}));\n const result=spawnSync(process.execPath,[entrypoint]"," const result=spawnSync(process.execPath,['scripts/final-closure-database-isolated-tests.mjs']"],
 ["Complete original closure SQL checks failed; no acceptance');\n });\n","Complete original closure SQL checks failed; no acceptance');\n"]];
 for(const[a,b]of edits){assert.equal(s.split(a).length,2);s=s.replace(a,b);}
 assert.equal(createHash('sha256').update(s).digest('hex'),'8f98b512440c564d2a05abff9dbe87720c3b840028083fbbc40742369acb5339');
});
