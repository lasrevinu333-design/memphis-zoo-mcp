import assert from 'node:assert/strict';
import {nativeNotificationReceiptArguments} from '../src/native-notification-receipt.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const req={memphisDeviceCredential:{credential_id:id(1)},body:{notification_key:'lunch:exact',notification_type:'lunch_coverage',action:'received',
 receipt_binding:{credential_id:id(1),employee_id:id(2),job_id:id(3),assignment_epoch:7,device_id:'KIOSK_08'}}};
assert.equal(nativeNotificationReceiptArguments(req,'KIOSK_08').p_credential_id,id(1));
for(const mutation of [r=>r.memphisDeviceCredential=null,r=>r.memphisDeviceCredential.credential_id=id(4),
 r=>r.body.receipt_binding.device_id='KIOSK_03',r=>r.body.receipt_binding.assignment_epoch='7',
 r=>r.body.receipt_binding.assignment_epoch=-1,r=>r.body.receipt_binding.employee_id='invalid',r=>r.body.receipt_binding.job_id=null]){
 const bad=structuredClone(req);mutation(bad);assert.throws(()=>nativeNotificationReceiptArguments(bad,'KIOSK_08'),/authenticated credential and assignment/);
}
console.log('Native notification receipt authenticated API binding tests passed.');
