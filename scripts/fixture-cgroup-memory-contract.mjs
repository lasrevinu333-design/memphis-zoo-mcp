// cgroup v2 configured-limit verification, not an absolute RSS/peak promise.
// Kernel memory.max explicitly permits temporary over-limit accounting:
// https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files
import assert from 'node:assert/strict';
import {types} from 'node:util';
export function assertFixtureCgroupMemory(snapshot,{requireNoOom=false}={}){
 assert.ok(snapshot&&typeof snapshot==='object'&&!types.isProxy(snapshot));
 const field=(object,key)=>{assert.ok(object&&typeof object==='object'&&!types.isProxy(object));
  const d=Object.getOwnPropertyDescriptor(object,key);assert.ok(d&&Object.hasOwn(d,'value'));return d.value;};
 const number=(object,key)=>{const n=field(object,key);assert.ok(Number.isSafeInteger(n)&&n>=0,key+' must be exact nonnegative bytes/count');return n;};
 const limit=number(snapshot,'memoryMax'),current=number(snapshot,'memoryCurrent'),peak=number(snapshot,'memoryPeak');
 assert.equal(limit,536870912,'Fixed512MiB cgroup memory.max required');
 assert.equal(number(snapshot,'memorySwap'),536870912,'Combined Docker memory+swap cap must remain512MiB');
 assert.equal(number(snapshot,'kernelSwapMax'),0,'Kernel swap must remain disabled');
 assert.ok(peak>=current,'Recorded lifetime peak cannot be below observed current usage');
 const events=field(snapshot,'memoryEvents'),maxEvents=number(events,'max'),oom=number(events,'oom'),kills=number(events,'oom_kill');
 // An over-limit peak with no recorded limit intervention is inconsistent
 // evidence, not a license to raise the cap or assume an unobserved history.
 if(peak>limit)assert.ok(maxEvents>0,'Over-limit peak needs actual recorded memory.max intervention');
 if(requireNoOom){assert.equal(oom,0,'Memory cgroup reported OOM');assert.equal(kills,0,'A local backend was OOM-killed');}
 return Object.freeze({schema:'custodial.fixture-cgroup-memory-contract.v1',configuredLimitBytes:limit,observedCurrentBytes:current,
  observedPeakBytes:peak,observedPeakOverLimitBytes:Math.max(0,peak-limit),limitInterventions:maxEvents,
  swapDisabled:true,noOomVerified:requireNoOom,absolutePeakCeilingClaimed:false,productionOrRuntimeAcceptance:false});
}
