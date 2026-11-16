import {deriveHistoricalStateDriver} from './canonical304-historical-state-view.mjs';
import {deriveCanonical304KernelResourceDriver} from './canonical304-kernel-resource-view.mjs';
// Offline-only explicit parent/child routing derivation. Does not construct,
// adopt, clean or execute a database fixture. No original pin is rewritten.
import assert from 'node:assert/strict';import {readFileSync,lstatSync} from 'node:fs';import {createHash} from 'node:crypto';import {deriveOffdayChildSources} from './manual-offday-child-source-view.mjs';import {deriveManualPeriodHistoricalStateSource} from './manual-period-historical-state-successor.mjs';import {verifyCanonical304Predecessors} from './fixtures/sealed-canonical304-source-fixture.mjs';import {fileURLToPath} from 'node:url';
const sha=x=>createHash('sha256').update(x).digest('hex');const root=new URL('../',import.meta.url),manifestBytes=readFileSync(new URL('../release/offday-historical304-source-closure.json',import.meta.url));
assert.equal(sha(manifestBytes),'184c5b11df2b715a77b0d9f05f4cd6c49cfb619b4ab76badbc8e030e282b4aff');const manifest=JSON.parse(manifestBytes);
export function readOffdayHistoricalClosure(){verifyCanonical304Predecessors(fileURLToPath(root).replace(/\/$/,''));const files=new Map();for(const r of manifest.files){const path=new URL(r.source,root);assert.ok(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink());const b=readFileSync(path);assert.equal(b.length,r.bytes);assert.equal(sha(b),r.sha256);files.set(r.path,b);}return files;}
export function deriveOffdayHistoricalRouting({files,tag}){
 assert.match(tag,/^[a-f0-9]{24}$/);assert.equal(files.size,manifest.files.length);
 for(const r of manifest.files){const b=files.get(r.path);assert.ok(b);assert.equal(b.length,r.bytes);assert.equal(sha(b),r.sha256,'Exact historical dependency: '+r.path);}
 const get=p=>files.get(p).toString(),child=deriveOffdayChildSources({projection:get('src/approved-manual-period-projection.js'),periodWorker:get('src/approved-manual-period-worker.js'),worker:get('src/static-weekly-schedule-compiler-worker.js'),tag});
 const names={runtime:'.offday-runtime-'+tag+'.mjs',plane:'.offday-plane-'+tag+'.mjs',activation:'.offday-activation-'+tag+'.mjs',history:'.manual-period-history-'+tag+'.mjs'};const out=child.files.map(f=>({path:'src/'+f.name,source:f.source})),inverses=[];
 function rewrite(path,source,edits){let next=source;for(const [a,b]of edits){assert.equal(next.split(a).length,2,'Unique closed import: '+a);next=next.replace(a,b);}let back=next;for(const [a,b]of [...edits].reverse())back=back.replace(b,a);assert.equal(back,source);out.push({path,source:next});inverses.push({path,originalSha:sha(source),candidateSha:sha(next)});}
 rewrite('src/'+names.runtime,get('src/static-weekly-schedule-compiler-runtime.js'),[['new URL("./static-weekly-schedule-compiler-worker.js", import.meta.url)','new URL("./'+child.files[2].name+'", import.meta.url)']]);
 rewrite('src/'+names.plane,get('src/static-weekly-control-plane.js'),[['from "./static-weekly-schedule-compiler-runtime.js"','from "./'+names.runtime+'"']]);
 rewrite('scripts/'+names.activation,get('scripts/approved-manual-activation-database-tests.mjs'),[["from '../src/static-weekly-control-plane.js'","from '../src/"+names.plane+"'"],["from '../src/static-weekly-schedule-compiler-runtime.js'","from '../src/"+names.runtime+"'"]]);
 const history=deriveManualPeriodHistoricalStateSource(files.get('scripts/manual-period-repair-database-extension.mjs'));
 rewrite('scripts/'+names.history,history.source,[["from '../src/static-weekly-control-plane.js'","from '../src/"+names.plane+"'"]]);
 return {files:out,names,proof:{schema:'custodial.offday-historical-explicit-routing.v1',closureSha:sha(manifestBytes),closureFiles:files.size,originalPlanSha:manifest.originalPlanSha,inverses,child:child.proof,historyOriginalSha:history.originalSha,historyPredecessorSha:history.candidateSha,SQLChanged:false,nativeDriverRouted:false}};
}
export function deriveOffdayHistoricalDriver({routing}){
 const tag=routing.names.history.match(/^\.manual-period-history-([a-f0-9]{24})\.mjs$/)?.[1];assert.ok(tag);
 const originals=readOffdayHistoricalClosure();assert.deepEqual(routing,deriveOffdayHistoricalRouting({files:originals,tag}));
 const frozenDriver=readFileSync(new URL('../scripts/sealed-repair-canonical-database-tests.mjs',import.meta.url));
 const historyDriver=deriveHistoricalStateDriver({frozenDriver,kernelDriver:deriveCanonical304KernelResourceDriver(frozenDriver).driver,callback:originals.get('scripts/manual-period-repair-database-extension.mjs'),candidateName:routing.names.history,helperSha:'052090bdfa009fa3bfd79720c98f7dd770a95444c0bd038bfc865746e73f4ce2'}).driver;
 assert.equal(routing.proof.closureSha,sha(manifestBytes));const original=Buffer.from(historyDriver).toString(),history=routing.files.find(f=>f.path==='scripts/'+routing.names.history);assert.ok(history);
 // Caller supplies the exact existing history driver derivation for this name.
 const replacements=[["from './approved-manual-activation-database-tests.mjs'","from './"+routing.names.activation+"'"],["'"+routing.proof.historyPredecessorSha+"'","'"+sha(history.source)+"'"]];
 let candidate=original;for(const[a,b]of replacements){assert.equal(candidate.split(a).length,2);candidate=candidate.replace(a,b);}
 const paths=routing.files.filter(f=>f!==history).map(f=>({path:f.path,sha256:sha(f.source)}));
 const marker='const loaded=[];for(const r of manifest.modules){';assert.equal(candidate.split(marker).length,2);
 const binding=`const offdaySourceRefs=${JSON.stringify(paths)};\nfor(const r of offdaySourceRefs){const p=resolve(B,r.path);assert.equal(fs.realpathSync(p),p);assert.ok(fs.lstatSync(p).isFile()&&!fs.lstatSync(p).isSymbolicLink());const b=fs.readFileSync(p);assert.equal(sha(b),r.sha256);frozen.set(p,b);}\n`;
 candidate=candidate.replace(marker,binding+marker);
 const before='...historySuccessorPaths,...new Set(refs.map(r=>resolve(B,r.path)))',after='...historySuccessorPaths,...offdaySourceRefs.map(r=>resolve(B,r.path)),...new Set(refs.map(r=>resolve(B,r.path)))';assert.equal(candidate.split(before).length,2);candidate=candidate.replace(before,after);
 let inverse=candidate.replace(after,before).replace(binding,'');for(const[a,b]of [...replacements].reverse())inverse=inverse.replace(b,a);assert.equal(inverse,original);
 return {driver:candidate,proof:{originalDriverSha:sha(original),candidateDriverSha:sha(candidate),completeByteInverse:true,originalPlanUnchanged:true,SQLChanged:false,executed:false}};
}
