const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export function nativeNotificationReceiptArguments(req,deviceId){
 const binding=req.body?.receipt_binding;
 const credential=req.memphisDeviceCredential?.credential_id;
 if(!binding||typeof binding!=='object'||Array.isArray(binding)
  ||!uuid(credential)||binding.credential_id!==credential||!uuid(binding.employee_id)||!uuid(binding.job_id)
  ||!Number.isSafeInteger(binding.assignment_epoch)||binding.assignment_epoch<1
  ||binding.device_id!==deviceId){
  throw Object.assign(new Error('Native notification receipt must retain its authenticated credential and assignment.'),{status:403});
 }
 return {p_device_identifier:deviceId,p_credential_id:credential,p_employee_id:binding.employee_id,
  p_assignment_epoch:binding.assignment_epoch,p_job_id:binding.job_id,
  p_notification_key:req.body.notification_key,p_notification_type:req.body.notification_type,p_action:req.body.action};
}
