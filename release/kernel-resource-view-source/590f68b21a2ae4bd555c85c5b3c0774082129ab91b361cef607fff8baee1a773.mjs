// Exact current resource-observer successor; original frozen Source/SQL stays.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync,writeFileSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const originalSha='fbf7fce4da266a3dd07cae3c1fc9edc6fdaef3a8c2836a0034dab6e01a67da51';
const contractSha='6809f2075d489359a35af840db0bf09ae58a0995d6d3b93b6ab0e3fd352e8d86';
const sha=x=>createHash('sha256').update(x).digest('hex');
const importLine="import {assertFixtureCgroupMemory} from './fixture-cgroup-memory-contract.mjs';\n";
const validation=" assert.equal(snapshot.memoryMax,536870912);assert.ok(Number.isFinite(snapshot.memoryPeak)&&snapshot.memoryPeak<=536870912);";
export function deriveCanonical304KernelResourceDriver(bytes){
 assert.ok(Buffer.isBuffer(bytes));assert.equal(bytes.length,16351);assert.equal(sha(bytes),originalSha,'Exact frozen canonical304 driver required');
 const original=bytes.toString('utf8'),marker="import pg from 'pg';\n";
 assert.equal(original.split(marker).length,2);assert.equal(original.split(validation).length,2);
 const start=original.indexOf(validation),end=original.indexOf('\n assert.ok(snapshot.dataKiB',start);assert.ok(end>start);
 const before=original.slice(start,end),record=before.slice(validation.length+1);
 assert.ok(record.startsWith(' fs.writeFileSync(')&&!record.includes('\n'));
 const after=" snapshot.kernelSwapMax=Number(read('memory.swap.max'));\n"
  +" snapshot.interpretation+='; cgroup v2 memory.max is the enforced limit; recorded peak can include documented transient charges. No absolute peak ceiling claimed.';\n"
  +record+'\n assertFixtureCgroupMemory(snapshot,{requireNoOom});';
 const driver=original.replace(marker,importLine+marker).replace(before,after);
 assert.equal(driver.replace(importLine,'').replace(after,before),original,'Whole frozen driver must be exactly recoverable');
 return {driver:Buffer.from(driver),proof:Object.freeze({schema:'custodial.canonical304-kernel-cgroup-source-view.v1',
  original_driver_sha256:originalSha,derived_driver_sha256:sha(driver),memory_contract_sha256:contractSha,
  frozen_driver_rewritten:false,historical_driver_executed_verbatim:false,resource_observer_only_successor:true,
  original_SQL_and_OOM_checks_unchanged:true,configured_cap_bytes:536870912,SQL_executed:false,production_admission:false})};
}
function regular(root,path){const file=resolve(root,path);assert.ok(file.startsWith(root+'/'));
 for(let p=file;p!==root;p=dirname(p))assert.equal(lstatSync(p).isSymbolicLink(),false);
 assert.ok(lstatSync(file).isFile());return file;}
export async function withCanonical304KernelResourceDriver(root,run){
 root=resolve(root);assert.equal(realpathSync(root),root);assert.equal(typeof run,'function');
 const original=regular(root,'scripts/sealed-repair-canonical-database-tests.mjs'),contract=regular(root,'scripts/fixture-cgroup-memory-contract.mjs');
 const originalBytes=readFileSync(original);assert.equal(sha(readFileSync(contract)),contractSha,'Exact current memory contract required');
 const {driver,proof}=deriveCanonical304KernelResourceDriver(originalBytes);
 const path=resolve(root,'scripts/.canonical304-kernel-cgroup-'+randomBytes(12).toString('hex')+'.mjs');
 writeFileSync(path,driver,{flag:'wx',mode:0o400});const identity=lstatSync(path,{bigint:true});
 const owned=()=>{const st=lstatSync(path,{bigint:true});assert.ok(st.isFile()&&!st.isSymbolicLink());
  assert.deepEqual([st.dev,st.ino,st.uid,st.mode&0o777n,st.birthtimeNs,st.ctimeNs],
   [identity.dev,identity.ino,BigInt(process.getuid()),0o400n,identity.birthtimeNs,identity.ctimeNs]);
  assert.equal(sha(readFileSync(path)),proof.derived_driver_sha256);};
 const current=()=>{owned();assert.deepEqual(readFileSync(original),originalBytes);
  assert.equal(sha(readFileSync(contract)),contractSha);};
 try{current();const value=await run(path,proof);current();return value;}
 finally{owned();unlinkSync(path);}
}
