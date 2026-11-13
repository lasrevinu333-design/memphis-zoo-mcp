import { hasManagerPermission } from './auth/manager-permissions.js';

export const PHONE_POSITION_PATH = '/scan-api/phone-position';
export const PHONE_LOCATION_PATH = '/dashboard-api/phone-locations';
export const PHONE_LOCATION_CONTRACT = 'custodial.assigned-phone-location.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
const principal=req=>req.memphisAuth?.role==='ops_manager'
  &&UUID.test(req.memphisAuth.manager_id||'')&&UUID.test(req.memphisAuth.credential_id||'')
  &&hasManagerPermission(req.memphisAuth,'read')
  ? JSON.stringify([req.memphisAuth.manager_id,req.memphisAuth.credential_id,req.memphisAuth.device_id]):null;

export function positionArguments(req,now=Date.now()) {
  const b=req.body,d=req.memphisDevice,c=req.memphisDeviceCredential;
  if(req.memphisDeviceAuth?.credentialed!==true||req.memphisDeviceAuth?.offline_recovery_only
    ||!UUID.test(d?.canonical_device_pk||'')||!UUID.test(c?.credential_id||''))fail(403,'current_phone_authority_required');
  const keys=['schema','employee_id','assignment_epoch','sample_id','observed_at','latitude','longitude','accuracy_m'];
  if(!b||Array.isArray(b)||Object.keys(b).sort().join()!==keys.sort().join()
    ||b.schema!==PHONE_LOCATION_CONTRACT||!UUID.test(b.employee_id||'')||!UUID.test(b.sample_id||'')
    ||!Number.isSafeInteger(b.assignment_epoch)||b.assignment_epoch<1
    ||b.employee_id!==d.assigned_employee_id||b.assignment_epoch!==Number(d.assignment_epoch))fail(422,'phone_position_identity_invalid');
  const observed=typeof b.observed_at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(b.observed_at)?Date.parse(b.observed_at):NaN;
  if(!Number.isFinite(observed)||new Date(observed).toISOString()!==b.observed_at||observed>now
    ||![b.latitude,b.longitude,b.accuracy_m].every(finite)||Math.abs(b.latitude)>90
    ||Math.abs(b.longitude)>180||b.accuracy_m<=0)fail(422,'phone_position_measurement_invalid');
  return {p_device_id:d.canonical_device_pk,p_employee_id:b.employee_id,p_assignment_epoch:b.assignment_epoch,
    p_credential_id:c.credential_id,p_sample_id:b.sample_id,p_observed_at:b.observed_at,
    p_latitude:b.latitude,p_longitude:b.longitude,p_accuracy_m:b.accuracy_m};
}

export function phoneLocations(rows,now=Date.now()) {
  if(!Array.isArray(rows)||!Number.isFinite(now))throw new Error('phone_locations_unavailable');
  const seen=new Set();
  return rows.map(row=>{
    if(!row||typeof row.device_id!=='string'||!row.device_id||seen.has(row.device_id)
      ||!UUID.test(row.employee_id||'')||!Number.isSafeInteger(Number(row.assignment_epoch)))throw new Error('phone_identity_unavailable');
    seen.add(row.device_id);
    const observed=Date.parse(row.observed_at),received=Date.parse(row.received_at);
    const measured=UUID.test(row.sample_id||'')&&Number.isFinite(observed)&&Number.isFinite(received)
      &&observed<=now&&observed<=received&&received<=now
      &&[row.latitude,row.longitude,row.accuracy_m].every(finite)
      &&Math.abs(row.latitude)<=90&&Math.abs(row.longitude)<=180&&row.accuracy_m>0;
    return {deviceIdentifier:row.device_id,employeeId:row.employee_id,employeeName:String(row.employee_name||row.device_id),
      assignmentEpoch:Number(row.assignment_epoch),state:measured?(now-observed<=120000?'live':'stale'):'unavailable',
      // Existing map freshness window; receipt time never refreshes a capture.
      position:measured?{sampleId:row.sample_id,observedAt:new Date(observed).toISOString(),
        receivedAt:new Date(received).toISOString(),latitude:row.latitude,longitude:row.longitude,accuracyM:row.accuracy_m}:null};
  });
}

export function installAssignedPhoneLocationRoutes(app,{parseJson,requireDevice,requireManager,rateLimit,verifyNative,runRpc,now=Date.now}) {
  app.post(PHONE_POSITION_PATH,parseJson,requireDevice,rateLimit,async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    try{
      if(req.scanAuthorityJsonError||Object.keys(req.query||{}).length)fail(400,'phone_position_request_invalid');
      verifyNative(req); // Same credential signature over original bytes as existing native requests.
      const args=positionArguments(req,now());
      const data=await runRpc('custodial_record_phone_position',args);
      if(data?.ok!==true)throw new Error('phone_position_not_recorded');
      res.status(200).json({ok:true,data});
    }catch(error){res.status(error.status||503).json({ok:false,code:error.code||'phone_position_unavailable'});}
  });
  app.get(PHONE_LOCATION_PATH,requireManager,async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const before=principal(req);
    if(!before)return res.status(403).json({ok:false,code:'named_manager_read_required'});
    if(Object.keys(req.query||{}).length||Object.keys(req.body||{}).length)
      return res.status(422).json({ok:false,code:'phone_location_filters_refused'});
    try{
      const rows=await runRpc('custodial_read_phone_positions',{}),instant=now();
      const phones=phoneLocations(rows,instant);
      if(principal(req)!==before)return res.status(403).json({ok:false,code:'manager_authority_changed'});
      return res.status(200).json({ok:true,data:{phones},meta:{contract:PHONE_LOCATION_CONTRACT,generated_at:new Date(instant).toISOString()}});
    }catch{return res.status(503).json({ok:false,code:'phone_locations_unavailable'});}
  });
}
