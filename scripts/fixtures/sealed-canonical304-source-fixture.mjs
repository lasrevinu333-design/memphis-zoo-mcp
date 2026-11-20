// Execute the genuine historical304 source, never a normalized comparison of
// different current code. Current-runtime qualification remains a separate lane.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve,sep} from 'node:path';
import {withCurrentMigrationSourceFixture} from './current-migration-source-fixtures.mjs';
import {restoreAcceptedSevenHistoricalSource} from './accepted-seven-source-successor.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const PLAN_SHA='4d0ce42a8777bb6493e14ed43207cacd03a80463204c3f9e98182d487c7c4c2d';
const PREDECESSORS_SHA='fb4ce1a406eb82c7cf619d695847aa42505207ff9f64858e8558efdbb2b933f3';
function regular(root,path){
 assert.equal(root,resolve(root));const file=resolve(root,path),rel=relative(root,file);
 assert.ok(rel&&!rel.startsWith('..'+sep)&&!rel.startsWith(sep));
 for(let p=file;p!==root;p=dirname(p))assert.equal(lstatSync(p).isSymbolicLink(),false,'No source symlink: '+path);
 assert.ok(lstatSync(file).isFile());return file;
}
function rows(plan){
 const refs=[plan.freshCapture,plan.atomicBatch,plan.postAtomicCapture,...plan.originals,...plan.proposals,
  ...plan.regressions,...plan.afterSignedSql,...plan.modules,...plan.protectedSources,
  ...(plan.frontendSources||[]).map(r=>({...r,path:'release/sealed-repair-frontend-source/'+r.path}))];
 const unique=new Map();
 for(const r of refs){if(unique.has(r.path))assert.deepEqual([r.bytes,r.sha256],[unique.get(r.path).bytes,unique.get(r.path).sha256]);unique.set(r.path,r);}
 return unique;
}
export function verifyCanonical304Predecessors(root){
 root=resolve(root);assert.equal(realpathSync(root),root);
 const planBytes=readFileSync(regular(root,'scripts/fixtures/sealed-repair/CANONICAL304_PLAN.json'));
 assert.equal(sha(planBytes),PLAN_SHA,'Genuine original canonical304 plan required');
 const plan=JSON.parse(planBytes);assert.equal(plan.constructor_migrations,304);
 const bytes=readFileSync(regular(root,'scripts/fixtures/sealed-repair/CANONICAL304_PREDECESSORS.json'));
 assert.equal(sha(bytes),PREDECESSORS_SHA,'Unknown historical source inventory refused');
 const p=JSON.parse(bytes);assert.equal(p.schema,'custodial.sealed-canonical304-genuine-predecessors.v1');
 assert.equal(p.original_plan_sha256,PLAN_SHA);assert.equal(p.historical_pins_rewritten,false);assert.equal(p.runtime_admission,false);
 assert.equal(p.files.length,66);assert.equal(new Set(p.files.map(r=>r.path)).size,66);
 const refs=rows(plan),base='scripts/fixtures/sealed-repair/canonical304-predecessor',observed=[];
 function walk(dir){for(const name of readdirSync(resolve(root,dir)).sort()){
  const path=dir+'/'+name,st=lstatSync(resolve(root,path));assert.equal(st.isSymbolicLink(),false);
  if(st.isDirectory())walk(path);else{assert.ok(st.isFile());observed.push(path.slice(base.length+1));}
 }}walk(base);
 assert.deepEqual(observed.sort(),p.files.map(r=>r.path).sort(),'Complete predecessor set; no unlisted input');
 for(const r of p.files){
  const ref=refs.get(r.path);assert.ok(ref);assert.deepEqual([r.bytes,r.sha256],[ref.bytes,ref.sha256]);
  assert.match(r.git_commit,/^[a-f0-9]{40}$/);const value=readFileSync(regular(root,base+'/'+r.path));
  assert.equal(value.length,r.bytes);assert.equal(sha(value),r.sha256,'Exact genuine predecessor: '+r.path);
 }
 return {plan,predecessors:p,refs};
}
export async function withSealedCanonical304SourceFixture(root,run){
 root=resolve(root);assert.equal(typeof run,'function');const selected=verifyCanonical304Predecessors(root);
 const tracked=execFileSync('git',['ls-files','-z'],{cwd:root}).toString('utf8').split('\0').filter(Boolean);
 // The existing source selector owns the exact SQL/catalog selection and the
 // fixture dev/inode/uid cleanup. It also rechecks original inputs afterward.
 return withCurrentMigrationSourceFixture(root,304,async fixture=>{
  try{
   for(const path of tracked){
    if(path.startsWith('supabase/migrations/')||path.startsWith('scripts/fixtures/sealed-repair/canonical304-predecessor/'))continue;
    const source=regular(root,path),target=resolve(fixture,path);
    assert.ok(target.startsWith(fixture+'/'));
    if(existsSync(target))continue; // Already-selected genuine304 closure wins.
    mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);
    if(path.startsWith('src/')&&path.endsWith('.js')){
     const current=readFileSync(source,'utf8'),historical=restoreAcceptedSevenHistoricalSource(path,current);
     if(historical!==current)writeFileSync(target,historical);
    }
   }
   // Never execute current bytes while merely comparing their historical view.
   for(const r of selected.predecessors.files){
    const source=regular(root,'scripts/fixtures/sealed-repair/canonical304-predecessor/'+r.path),target=resolve(fixture,r.path);
    assert.ok(target.startsWith(fixture+'/'));mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);
   }
   for(const r of selected.refs.values()){
    const value=readFileSync(regular(fixture,r.path));
    assert.equal(value.length,r.bytes,'Original plan length: '+r.path);assert.equal(sha(value),r.sha256,'Original plan source: '+r.path);
   }
   const deps=resolve(root,'node_modules');assert.ok(lstatSync(deps).isDirectory()&&!lstatSync(deps).isSymbolicLink());
   assert.equal(existsSync(resolve(fixture,'node_modules')),false);symlinkSync(deps,resolve(fixture,'node_modules'),'dir');
   return await run(fixture,Object.freeze({historical_migrations:304,original_plan_sha256:PLAN_SHA,
    protected_source_refs:selected.refs.size,genuine_predecessors:66,current319_or_production_admission:false}));
  }finally{verifyCanonical304Predecessors(root);}
 });
}
