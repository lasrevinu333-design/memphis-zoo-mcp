// Test-only source loading. Original module remains unchanged. No native fixture.
import assert from 'node:assert/strict';import {readFileSync,openSync,writeFileSync,closeSync,fstatSync,lstatSync,unlinkSync,constants} from 'node:fs';import {randomBytes,createHash} from 'node:crypto';import {deriveManualOffdaySource} from '../manual-offday-source-successor.mjs';
export async function loadOffdayCandidateForTests(){
 const original=new URL('../../src/approved-manual-period-projection.js',import.meta.url),bytes=readFileSync(original),d=deriveManualOffdaySource(bytes),path=new URL('../../src/.offday-test-'+randomBytes(12).toString('hex')+'.mjs',import.meta.url);
 const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o400);let identity;
 try{writeFileSync(fd,d.source);identity=fstatSync(fd,{bigint:true});const verify=()=>{const s=lstatSync(path,{bigint:true}),held=fstatSync(fd,{bigint:true});assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n);for(const x of [s,held])for(const k of ['dev','ino','uid','mode','size','ctimeNs','birthtimeNs'])assert.equal(x[k],identity[k]);assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),d.proof.candidateSha);assert.deepEqual(readFileSync(original),bytes);};
 verify();const module=await import(path.href);verify();unlinkSync(path);return module;
 }finally{closeSync(fd);}
}
