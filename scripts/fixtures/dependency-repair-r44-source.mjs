// Exact dependency successor; prior workflow/package oracles stay unchanged.
import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import{createHash}from'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const packageHashes=["89bf67b3f9850321356b657bcfb17ae697a6a65f19f841ebf6c5bf1a32266542", "08d6de7172c505d5f604f747b8ade0193c2180e4af75fce89b5c21171d234377"];
const lockHashes=["3b9f30421adbcd7261d37756b533df03372403e633ed7073a9e7703c03ab4204", "d8c17d9e50b99b641dfd44722b2f6000d015f702a9c18719813bfaba2b2476f3"];
const workflows={"foundation-security-gate.yml": ["084f7dd577cdda069fd378316853782f08e1c1887bd948cb4ccda15c5e943c19", "d85836fcc0cefadcd3d22751ba44080a9ef94915ec33b46c1233327f61e8239a"], "custodial-production-repair.yml": ["89cf70364a7fab63a9abf956b935e3d4079a768be955513d063b69ea1e7183ab", "3082d5c835c9b7ef499d69f845d2b87b6abb6864b406e64c8c0410b9d36afa67"]};
export function restoreDependencyPackage(bytes){
 if(sha(bytes)!==packageHashes[0])return bytes;
 const p=JSON.parse(bytes);assert.equal(p.overrides['@hono/node-server'],'2.1.6');assert.equal(p.overrides.hono,'4.13.16');assert.equal(p.overrides['fast-uri'],'3.1.9');assert.equal(p.overrides['ip-address'],'10.7.4');
 p.overrides['@hono/node-server']='2.0.12';p.overrides['fast-uri']='3.1.8';p.overrides['ip-address']='10.7.1';delete p.overrides.hono;
 const prior=Buffer.from(JSON.stringify(p,null,2)+'\n');assert.equal(sha(prior),packageHashes[1]);return prior;
}
export function restoreDependencyWorkflow(source,name){
 const pair=workflows[name];assert.ok(pair);assert.equal(sha(source),pair[0]);
 for(const [current,prior,path]of [[...packageHashes,'package.json'],[...lockHashes,'package-lock.json']]){const from=current+'  '+path;assert.equal(source.split(from).length,2);source=source.replace(from,prior+'  '+path);}
 assert.equal(sha(source),pair[1]);
 const priorLock=readFileSync(new URL('../../release/dependency-repair-r44/predecessor-package-lock.json',import.meta.url));assert.equal(sha(priorLock),lockHashes[1]);
 return source;
}
