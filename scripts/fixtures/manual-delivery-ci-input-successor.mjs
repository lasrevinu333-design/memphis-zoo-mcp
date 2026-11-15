// Exact CI bookkeeping successor for the already reviewed diagnostic test.
// These views preserve genuine prior source oracles; they grant no runtime,
// SQL, release or phone authority and never accept an unknown source hash.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
export const manualDeliveryPackagePins=Object.freeze({
 current:'fda67843739193dded328d2ff03a01559b15e6f1a835dd0a7ffd137ac58ace4d',
 previous:'89bf67b3f9850321356b657bcfb17ae697a6a65f19f841ebf6c5bf1a32266542',
});
const workflows=Object.freeze({
 'foundation-security-gate.yml':['7d3b6cd5e5f8992f625e0ea12a3432c83099f8bb4c8192c494362552bd3ae61e','976b0c6889783c5c0b90f02d87f841e78dc368ae3d9b84484c9442b762db1295'],
 'custodial-production-repair.yml':['a08a53a6f914808e409acfe9d91fccc255d4ba849ce4b56d59e79fe9348d2fad','73b2cbe4d240c6b9b6181b0cae28d15b2ff7be46863293f64293b0466786c77a'],
});
export function restoreManualDeliveryPackage(bytes){
 if(sha(bytes)!==manualDeliveryPackagePins.current)return bytes;
 const added=' && node scripts/manual-schedule-delivery-diagnostic-tests.mjs';
 const source=bytes.toString('utf8');assert.equal(source.split(added).length,2);
 const prior=Buffer.from(source.replace(added,''));
 assert.equal(sha(prior),manualDeliveryPackagePins.previous);
 return prior;
}
export function isManualDeliveryWorkflow(source,name){
 return Object.hasOwn(workflows,name)&&sha(source)===workflows[name][0];
}
export function restoreManualDeliveryWorkflow(source,name){
 if(!isManualDeliveryWorkflow(source,name))return source;
 const from=manualDeliveryPackagePins.current+'  package.json';
 assert.equal(source.split(from).length,2);
 const prior=source.replace(from,manualDeliveryPackagePins.previous+'  package.json');
 assert.equal(sha(prior),workflows[name][1]);
 return prior;
}
