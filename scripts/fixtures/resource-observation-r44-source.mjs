// Read-only host observation only; the actual secondary-disk refusal is unchanged.
import assert from 'node:assert/strict';import{createHash}from'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const current="976b0c6889783c5c0b90f02d87f841e78dc368ae3d9b84484c9442b762db1295",previous="084f7dd577cdda069fd378316853782f08e1c1887bd948cb4ccda15c5e943c19";
const observation="          findmnt --json --output TARGET,SOURCE,FSTYPE,MAJ:MIN\n          lsblk --json --output NAME,TYPE,FSTYPE,SIZE,MOUNTPOINTS\n";
export function restoreResourceObservationWorkflow(source){
 if(sha(source)!==current)return source;
 assert.equal(source.split(observation).length,2);const prior=source.replace(observation,'');assert.equal(sha(prior),previous);return prior;
}
