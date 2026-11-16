// Explicit test-data successor inside the separately verified historical304 closure.
// No database creation, permission change or source-loader overrides here.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {readFileSync,realpathSync,lstatSync,openSync,writeFileSync,fsyncSync,fstatSync,closeSync,unlinkSync,constants} from 'node:fs';
import {deriveGpsSessionRebuildSource} from './gps-session-rebuild-source-successor.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
export function deriveGpsClosureRunner(original,rebuildPath){
 assert.equal(sha(original),'eab515c5a2d81cffe7787fa8cfedd9b99197e4f38281037ad4637bd96ce8f508');
 assert.match(rebuildPath,/^scripts\/\.gps-rebuild-[a-f0-9]{24}\.mjs$/);
 const source=original.toString(),from='"scripts/empty-database-rebuild-check.mjs"',to=JSON.stringify(rebuildPath);
 assert.equal(source.split(from).length,2);
 const candidate=source.replace(from,to);assert.equal(candidate.split(to).length,2);
 assert.equal(candidate.replace(to,from),source,'Complete original lifecycle and downstream suites retained');
 return {source:candidate,proof:{originalSha:sha(original),candidateSha:sha(candidate),completeInverse:true}};
}
export async function withGpsSessionOwnedSource(root,run){
 assert.equal(resolve(root),root);assert.equal(realpathSync(root),root);assert.equal(typeof run,'function');
 const paths=['scripts/empty-database-rebuild-check.mjs','scripts/final-closure-database-isolated-tests.mjs'];
 const originals=paths.map(p=>({path:resolve(root,p),bytes:readFileSync(resolve(root,p))}));
 const tag=randomBytes(12).toString('hex'),rebuildPath='scripts/.gps-rebuild-'+tag+'.mjs',runnerPath='scripts/.gps-closure-'+tag+'.mjs';
 const rebuild=deriveGpsSessionRebuildSource(originals[0].bytes),runner=deriveGpsClosureRunner(originals[1].bytes,rebuildPath),owned=[];
 const verify=()=>{for(const o of originals)assert.deepEqual(readFileSync(o.path),o.bytes,'Selected original changed');for(const o of owned){const held=fstatSync(o.fd,{bigint:true}),s=lstatSync(o.path,{bigint:true});assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n);for(const x of [held,s])for(const k of ['dev','ino','uid','mode','size','ctimeNs','birthtimeNs'])assert.equal(x[k],o.identity[k]);assert.equal(sha(readFileSync(o.path)),o.sha);}};
 try{
  for(const [p,source]of [[rebuildPath,rebuild.source],[runnerPath,runner.source]]){const path=resolve(root,p);assert.ok(path.startsWith(root+'/scripts/'));const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o400);try{writeFileSync(fd,source);fsyncSync(fd);owned.push({path,fd,identity:fstatSync(fd,{bigint:true}),sha:sha(source)});}catch(e){closeSync(fd);throw e;}}
  verify();const result=await run(resolve(root,runnerPath),{rebuild:rebuild.proof,runner:runner.proof,ownedCandidates:owned.map(o=>({path:o.path,sha256:o.sha})),SQLExecuted:false});verify();return result;
 }finally{let error;try{verify();for(const o of [...owned].reverse())unlinkSync(o.path);}catch(e){error=e;}finally{for(const o of owned)closeSync(o.fd);}if(error)throw error;}
}
