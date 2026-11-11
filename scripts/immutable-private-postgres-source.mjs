// Fixed current-source PostgreSQL program. No caller-supplied SQL or actor.
import assert from 'node:assert/strict';
import {openSync,closeSync,readFileSync,fstatSync,lstatSync,constants} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const path=fileURLToPath(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url));
const pin='1cdeae22cd680805a819500a20b70f8f1297bf3acf52ecf8476429c55c6ea1f9',size=471931;
const sha=s=>createHash('sha256').update(s).digest('hex');
const identity=s=>[s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs];
function snapshot(pathname=path,expectedPin=pin,expectedSize=size){
 const path=pathname,pin=expectedPin,size=expectedSize;
 const parents=[];for(let p=dirname(path);;p=dirname(p)){const s=lstatSync(p,{bigint:true});assert.ok(s.isDirectory()&&!s.isSymbolicLink());parents.push([p,s.dev,s.ino,s.mode,s.uid,s.gid]);if(dirname(p)===p)break;}
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.size===BigInt(size));
  const bytes=readFileSync(fd);assert.deepEqual(identity(fstatSync(fd,{bigint:true})),identity(before));assert.equal(bytes.length,size);assert.equal(sha(bytes),pin);
  assert.deepEqual(identity(lstatSync(path,{bigint:true})),identity(before));
  for(const [p,...ids] of parents){const s=lstatSync(p,{bigint:true});assert.deepEqual([s.dev,s.ino,s.mode,s.uid,s.gid],ids);assert.ok(s.isDirectory()&&!s.isSymbolicLink());}
  return {bytes,identity:identity(before),parents};
 }finally{closeSync(fd);}
}
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function loadImmutableCurrentPostgresSource(){
 assert.equal(arguments.length,0);const original=snapshot();
 const provenancePath=fileURLToPath(new URL('../release/installed-source/20261031225210_custodial_sealed_repairs_current_eight.sql',import.meta.url));
 const provenance=()=>snapshot(provenancePath,'f4e3dc5be9a465e2099bd9b23488f99b3f9e4c1d9d969844b2fa06b1fbdc7a73',211245);
 const installed=provenance();
 const program=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original.bytes));
 assert.equal(program.format,'custodial.immutable-private-current-postgres-program.v1');
 assert.deepEqual(program.profile,{id:'immutable-private-current-postgres',actor:'postgres'});
 assert.equal(program.recipes.length,23);assert.equal(program.statements.length,13);
 assert.equal(new Set(program.recipes.map(r=>r.identity)).size,23);
 for(const r of program.recipes){assert.equal(sha(r.before),r.beforeHash);assert.equal(sha(r.after),r.afterHash);}
 for(const s of program.statements)assert.equal(sha(s.sql),s.sourceSha256);
 const assertCurrent=function(){assert.equal(arguments.length,0);const now=snapshot();assert.deepEqual(now.identity,original.identity);assert.deepEqual(now.parents,original.parents);assert.ok(now.bytes.equals(original.bytes));const current=provenance();assert.deepEqual(current.identity,installed.identity);assert.deepEqual(current.parents,installed.parents);assert.ok(current.bytes.equals(installed.bytes));};
 return Object.freeze({...freeze(program),assertCurrent});
}
