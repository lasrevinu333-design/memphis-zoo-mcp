// Offline qualification of an explicit child entrypoint. No loader hooks,
// NODE_OPTIONS, original file replacement, native SQL or production routing.
import assert from 'node:assert/strict';import {createHash,randomBytes} from 'node:crypto';import {readFileSync,openSync,writeFileSync,closeSync,fstatSync,lstatSync,unlinkSync,constants} from 'node:fs';import {deriveManualOffdaySource} from './manual-offday-source-successor.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
export function deriveOffdayChildSources({projection,periodWorker,worker,tag}){
 assert.match(tag,/^[a-f0-9]{24}$/);const p=deriveManualOffdaySource(projection);
 const source=Buffer.from(periodWorker).toString(),entry=Buffer.from(worker).toString();
 assert.equal(sha(source),'fdae3609b4b9b085dfedc9b6117645587c8fd068d47173426408f76545929fb9');
 assert.equal(sha(entry),'086e385abab4729be8148e82c8948c9049cadfcc48cbda318c533b36293f1ea5');
 const names={projection:'.offday-projection-'+tag+'.mjs',period:'.offday-period-'+tag+'.mjs',worker:'.offday-worker-'+tag+'.mjs'};
 const a="from './approved-manual-period-projection.js'",b="from './"+names.projection+"'",c="from './approved-manual-period-worker.js'",d="from './"+names.period+"'";
 assert.equal(source.split(a).length,2);assert.equal(entry.split(c).length,2);
 const period=source.replace(a,b),child=entry.replace(c,d);assert.equal(period.replace(b,a),source);assert.equal(child.replace(d,c),entry);
 return {files:[{name:names.projection,source:p.source},{name:names.period,source:period},{name:names.worker,source:child}],proof:{...p.proof,periodWorkerOriginal:sha(source),workerOriginal:sha(entry),periodCandidate:sha(period),childCandidate:sha(child),explicitChildEntrypoint:true,resourcePolicyChanged:false,SQLChanged:false}};
}
function verifyClosure(){
 const bytes=readFileSync(new URL('../release/offday-child-source-closure.json',import.meta.url));assert.equal(sha(bytes),'e63d8eb506c7cdd919bd92b84599fecfdfa5ebc3a24d34ec231e51b69c95e6d2');
 const m=JSON.parse(bytes);assert.equal(m.files.length,296);assert.equal(new Set(m.files.map(r=>r.path)).size,296);
 for(const r of m.files){assert.match(r.path,/^src\/[A-Za-z0-9_./-]+$/);assert.ok(!r.path.split('/').includes('..'));const p=new URL('../'+r.path,import.meta.url),st=lstatSync(p);assert.ok(st.isFile()&&!st.isSymbolicLink());assert.equal(sha(readFileSync(p)),r.sha256,'Exact original dependency: '+r.path);}
}
export async function withOffdayChildSourceView(run){
 assert.equal(typeof run,'function');verifyClosure();const root=new URL('../src/',import.meta.url),paths=['approved-manual-period-projection.js','approved-manual-period-worker.js','static-weekly-schedule-compiler-worker.js'];
 const originals=paths.map(n=>({path:new URL(n,root),bytes:readFileSync(new URL(n,root))}));
 const d=deriveOffdayChildSources({projection:originals[0].bytes,periodWorker:originals[1].bytes,worker:originals[2].bytes,tag:randomBytes(12).toString('hex')}),owned=[];
 const check=()=>{verifyClosure();for(const o of originals)assert.deepEqual(readFileSync(o.path),o.bytes);for(const o of owned){const held=fstatSync(o.fd,{bigint:true}),s=lstatSync(o.path,{bigint:true});assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n);for(const x of [s,held])for(const k of ['dev','ino','uid','mode','size','ctimeNs','birthtimeNs'])assert.equal(x[k],o.identity[k]);assert.equal(sha(readFileSync(o.path)),o.sha);}};
 try{for(const f of d.files){const path=new URL(f.name,root),fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o400);writeFileSync(fd,f.source);owned.push({path,fd,identity:fstatSync(fd,{bigint:true}),sha:sha(f.source)});}check();const result=await run(owned[2].path,d.proof);check();return result;
 }finally{let err;try{check();for(const o of owned)unlinkSync(o.path);}catch(e){err=e;}finally{for(const o of owned)closeSync(o.fd);}if(err)throw err;}
}
