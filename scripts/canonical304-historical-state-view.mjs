// Explicit source-only successor after the recorded Monday historical assertion
// failure. Original plan, callback, frozen driver, SQL and all resource gates stay.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync,lstatSync,openSync,closeSync,fstatSync,fsyncSync,writeFileSync,unlinkSync,constants} from 'node:fs';
import {resolve} from 'node:path';
import {deriveCanonical304KernelResourceDriver} from './canonical304-kernel-resource-view.mjs';
import {deriveManualPeriodHistoricalStateSource} from './manual-period-historical-state-successor.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const loaded="const loaded=[];for(const r of manifest.modules)loaded.push({ref:r,module:await import(pathToFileURL(resolve(B,r.path)))});";
const extensions="const extensionSources=[manifestPath,fileURLToPath(import.meta.url),...new Set(refs.map(r=>resolve(B,r.path)))];";
export function deriveHistoricalStateDriver({frozenDriver,kernelDriver,callback,candidateName,helperSha}){
 assert.match(candidateName,/^\.manual-period-history-[a-f0-9]{24}\.mjs$/);assert.match(helperSha,/^[a-f0-9]{64}$/);
 const expected=deriveCanonical304KernelResourceDriver(frozenDriver).driver;assert.equal(Buffer.from(kernelDriver).toString(),Buffer.from(expected).toString());
 const selected=deriveManualPeriodHistoricalStateSource(callback),source=Buffer.from(kernelDriver).toString();
 assert.equal(source.split(loaded).length,2);assert.equal(source.split(extensions).length,2);
 const candidatePath='scripts/'+candidateName;
 const injected=`const historySuccessorPaths=[resolve(B,'${candidatePath}'),resolve(B,'scripts/manual-period-historical-state-successor.mjs')];
for(const [path,pin] of [[historySuccessorPaths[0],'${selected.candidateSha}'],[historySuccessorPaths[1],'${helperSha}']]){
 assert.equal(fs.realpathSync(path),path);assert.ok(fs.lstatSync(path).isFile()&&!fs.lstatSync(path).isSymbolicLink());
 const bytes=fs.readFileSync(path);assert.equal(sha(bytes),pin);frozen.set(path,bytes);
}
const loaded=[];for(const r of manifest.modules){
 if(r.id==='manual_period'){
  assert.equal(r.path,'scripts/manual-period-repair-database-extension.mjs');assert.equal(r.sha256,'${selected.originalSha}');assert.equal(r.bytes,${selected.originalBytes});
  loaded.push({ref:r,module:await import(pathToFileURL(historySuccessorPaths[0]))});
 }else loaded.push({ref:r,module:await import(pathToFileURL(resolve(B,r.path)))});
}`;
 const afterExtensions="const extensionSources=[manifestPath,fileURLToPath(import.meta.url),...historySuccessorPaths,...new Set(refs.map(r=>resolve(B,r.path)))];";
 const driver=source.replace(loaded,injected).replace(extensions,afterExtensions);
 assert.equal(driver.replace(injected,loaded).replace(afterExtensions,extensions),source);
 return {driver,callback:selected.source,proof:{schema:'custodial.canonical304-historical-state-source-successor.v1',original_callback_sha256:selected.originalSha,candidate_callback_sha256:selected.candidateSha,kernel_driver_sha256:sha(source),derived_driver_sha256:sha(driver),helper_sha256:helperSha,original_plan_unchanged:true,SQL_changed:false,clock_overridden:false,fixture_replay:false}};
}
function createOwned(path,bytes){
 const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o400);
 try{writeFileSync(fd,bytes);fsyncSync(fd);const original=fstatSync(fd,{bigint:true}),pin=sha(bytes);
 const assertOwned=()=>{const held=fstatSync(fd,{bigint:true}),s=lstatSync(path,{bigint:true});assert.ok(held.isFile()&&s.isFile()&&!s.isSymbolicLink()&&held.nlink===1n);
  for(const x of [held,s])for(const k of ['dev','ino','uid','mode','size','birthtimeNs','ctimeNs'])assert.equal(x[k],original[k]);assert.equal(sha(readFileSync(path)),pin);};
 return {assertOwned,remove(){assertOwned();unlinkSync(path);},close(){closeSync(fd);}};
 }catch(e){closeSync(fd);throw e;}
}
export async function withCanonical304HistoricalStateDriver(root,kernelPath,run){
 root=resolve(root);assert.equal(typeof run,'function');
 const paths=['scripts/sealed-repair-canonical-database-tests.mjs','scripts/manual-period-repair-database-extension.mjs','scripts/manual-period-historical-state-successor.mjs'];
 const originals=paths.map(p=>{const path=resolve(root,p),s=lstatSync(path);assert.ok(s.isFile()&&!s.isSymbolicLink());return {path,bytes:readFileSync(path)};});
 const kernelBytes=readFileSync(kernelPath),tag=randomBytes(12).toString('hex'),candidateName='.manual-period-history-'+tag+'.mjs';
 const d=deriveHistoricalStateDriver({frozenDriver:originals[0].bytes,kernelDriver:kernelBytes,callback:originals[1].bytes,candidateName,helperSha:sha(originals[2].bytes)});
 const callbackPath=resolve(root,'scripts',candidateName),driverPath=resolve(root,'scripts/.canonical304-history-'+tag+'.mjs');
 const owned=[];
 try{owned.push(createOwned(callbackPath,d.callback));owned.push(createOwned(driverPath,d.driver));
  const current=()=>{for(const o of owned)o.assertOwned();for(const p of originals)assert.deepEqual(readFileSync(p.path),p.bytes);assert.deepEqual(readFileSync(kernelPath),kernelBytes);};
  current();const result=await run(driverPath,d.proof);current();return result;
 }finally{let failure;for(const o of owned.reverse()){try{o.remove();}catch(e){failure??=e;}finally{o.close();}}if(failure)throw failure;}
}
