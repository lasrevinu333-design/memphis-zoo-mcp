import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {verifyNativeDeviceRequestAttestation} from './auth/device-credential-auth.js';

const policy=JSON.parse(readFileSync(new URL('../config/custodial-maintenance-recipients.json',import.meta.url),'utf8'));
const VERSION='assigned-activation.aes-256-gcm.v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const exactKeys=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype
 &&Object.keys(v).sort().join('\0')===[...keys].sort().join('\0');
function key(env){
 const secret=String(env?.DEVICE_CREDENTIAL_SECRET||'');
 if(secret.length<32)deny('activation_encryption_unavailable',503);
 return Buffer.from(crypto.hkdfSync('sha256',Buffer.from(secret),Buffer.from('custodial-assigned-activation-transport'),Buffer.from(VERSION),32));
}
function aad(binding){
 if(!UUID.test(binding.operation_id)||!UUID.test(binding.employee_id)||!UUID.test(binding.claimant_credential_id)
  ||!Number.isSafeInteger(binding.assignment_epoch)||binding.assignment_epoch<1||!/^KIOSK_(0[2-9]|10)$/.test(binding.device_id)
  ||!/^CUSTODIAL-MAINTENANCE-[A-Z0-9-]{36}$/.test(binding.workstation_device_id)
  ||!/^[a-f0-9]{64}$/.test(binding.serial_sha256))deny('activation_envelope_binding_invalid');
 return Buffer.from(JSON.stringify([VERSION,binding.operation_id,binding.device_id,binding.employee_id,
  binding.assignment_epoch,binding.claimant_credential_id,binding.workstation_device_id,binding.serial_sha256]));
}
export function encryptAssignedActivationToken(env,binding,token){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))deny('activation_token_invalid');
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(env),iv);
 cipher.setAAD(aad(binding));
 return {version:VERSION,ciphertext:Buffer.concat([cipher.update(token,'utf8'),cipher.final()]).toString('base64url'),
  iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url')};
}
export function decryptAssignedActivationToken(env,binding,envelope){
 try{
  if(!exactKeys(envelope,['version','ciphertext','iv','tag'])||envelope.version!==VERSION
   ||!/^[A-Za-z0-9_-]{58}$/.test(envelope.ciphertext)||!/^[A-Za-z0-9_-]{16}$/.test(envelope.iv)
   ||!/^[A-Za-z0-9_-]{22}$/.test(envelope.tag))throw new Error('invalid');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key(env),Buffer.from(envelope.iv,'base64url'));
  decipher.setAAD(aad(binding));decipher.setAuthTag(Buffer.from(envelope.tag,'base64url'));
  const token=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64url')),decipher.final()]).toString('utf8');
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('invalid');return token;
 }catch{deny('activation_envelope_unavailable',503);}
}
function manager(req,workstation=false){
 const s=req.memphisAuth;
 if(!s?.trusted_device||!UUID.test(s.manager_id)||!UUID.test(s.credential_id)||s.access_level!=='full_access'
  ||!Array.isArray(s.roles)||!s.roles.includes('CUSTODIAL_MANAGER'))deny('named_custodial_manager_required',403);
 if(workstation&&(req.headers?.origin||req.headers?.['sec-fetch-site']
  ||!/^CUSTODIAL-MAINTENANCE-[A-Z0-9-]{36}$/.test(s.device_id)))deny('maintenance_workstation_required',403);
 return s;
}
function op(req){
 const id=String(req.params?.operationId||req.body?.operation_id||'');
 if(!UUID.test(id))deny('activation_operation_id_required');return id;
}
async function rpc(db,name,args){
 const result=await db.rpc(name,args);
 if(result.error){
  const status=result.error.code==='42501'?403:['40001','23505','P0001','P0002'].includes(result.error.code)?409:503;
  // Never echo SQL/HTTP diagnostics: claim arguments include ciphertext and
  // native calls contain credential hashes. A bounded code is sufficient.
  deny(status===403?'activation_access_denied':status===409?'activation_state_conflict':'activation_service_unavailable',status);
 }
 if(!result.data||typeof result.data!=='object'||Array.isArray(result.data))deny('activation_response_invalid',503);
 return result.data;
}
export function installAssignedActivationTransportRoutes(app,{db,env,configured,requireManager,resolveNativeDevice,
 isNativeCustodialRequest,nativeCredentialParts,tokenHash,assignedActivationTokenHash,requireCurrentCredential}){
 const route=handler=>async(req,res)=>{res.setHeader('Cache-Control','no-store');try{res.json({ok:true,data:await handler(req)});}
  catch(e){res.status(e.status||503).json({ok:false,code:e.status?e.code:'activation_service_unavailable',
   error:e.status?e.code:'activation_service_unavailable'});}};
 const read=(id,s)=>rpc(db,'custodial_activation_read',{p_operation:id,p_manager:s.manager_id,p_requester:s.credential_id});
 for(const prefix of ['/leadership-api/phone-assignments','/custodial-admin-api/devices']){
  app.post(prefix+'/:deviceId/activation-operations',configured,requireManager,route(async req=>{
   const s=manager(req),body=req.body;
   if(!exactKeys(body,['operation_id','expected_employee_id','expected_assignment_epoch','action'])
    ||body.operation_id!==req.headers?.['idempotency-key']||!UUID.test(body.operation_id)||!UUID.test(body.expected_employee_id)
    ||!Number.isSafeInteger(body.expected_assignment_epoch)||body.expected_assignment_epoch<1||body.action!=='activate_or_recover')deny('activation_request_invalid');
   const device=String(req.params.deviceId).toUpperCase(),recipient=policy.recipients[device];
   if(!recipient)deny('activation_physical_recipient_not_configured',409);
   return rpc(db,'custodial_activation_request',{p_operation:body.operation_id,p_device:device,p_employee:body.expected_employee_id,
    p_epoch:body.expected_assignment_epoch,p_manager:s.manager_id,p_requester:s.credential_id,p_serial_sha256:recipient.adbSerialSha256});
  }));
 }
 app.get('/custodial-admin-api/assigned-activation-operations',configured,requireManager,route(req=>{
  const s=manager(req);return rpc(db,'custodial_activation_list',{p_manager:s.manager_id,p_requester:s.credential_id});
 }));
 app.get('/custodial-admin-api/assigned-activation-operations/:operationId',configured,requireManager,route(req=>read(op(req),manager(req))));
 app.post('/custodial-admin-api/assigned-activation-operations/:operationId/claim',configured,requireManager,route(async req=>{
  const s=manager(req,true),id=op(req),body=req.body;
  if(!exactKeys(body,['adb_serial_sha256','client_version'])||body.client_version!==policy.clientVersion)deny('activation_claim_invalid');
  const status=await read(id,s),recipient=policy.recipients[status.device_id];
  if(!recipient||body.adb_serial_sha256!==recipient.adbSerialSha256)deny('activation_physical_recipient_mismatch',409);
  const binding={...status,claimant_credential_id:s.credential_id,workstation_device_id:s.device_id,serial_sha256:recipient.adbSerialSha256};
  const token=crypto.randomBytes(32).toString('base64url'),envelope=encryptAssignedActivationToken(env,binding,token);
  // device UUID is resolved server-side; the client cannot select a different
  // hash namespace for the frozen canonical kiosk.
  const device=await resolveNativeDevice(db,status.device_id);
  if(!device)deny('activation_device_unavailable',409);
  const response=await rpc(db,'custodial_activation_claim',{p_operation:id,p_manager:s.manager_id,p_claimant:s.credential_id,
   p_workstation:s.device_id,p_serial_sha256:recipient.adbSerialSha256,p_client_version:body.client_version,
   p_code_hash:assignedActivationTokenHash(device.id,token),p_token_envelope:envelope});
  if(!response.token_envelope)return {status:response.status};
  return {status:response.status,activation_token:decryptAssignedActivationToken(env,binding,response.token_envelope)};
 }));
 app.post('/custodial-admin-api/assigned-activation-operations/:operationId/delivery',configured,requireManager,route(req=>{
  const s=manager(req,true),body=req.body;
  if(!exactKeys(body,['state_version','outcome','error_code'])||!Number.isSafeInteger(body.state_version)||body.state_version<1
   ||!['delivered','delivery_unknown'].includes(body.outcome)||(body.error_code!==null&&!/^[a-z0-9_]{1,80}$/.test(body.error_code)))deny('activation_delivery_report_invalid');
  return rpc(db,'custodial_activation_delivery',{p_operation:op(req),p_manager:s.manager_id,p_claimant:s.credential_id,
   p_workstation:s.device_id,p_expected_version:body.state_version,p_outcome:body.outcome,p_error_code:body.error_code});
 }));
 app.post('/custodial-device-auth/assigned-activation-operations/:operationId/native-result',configured,route(async req=>{
  if(!isNativeCustodialRequest(req))deny('native_custodial_app_required',403);
  const id=op(req),credential=nativeCredentialParts(req),body=req.body;
  if(!credential||!exactKeys(body,['operation_id','device_id','credential_id','flow','outcome','changed','journal_schema','journal_binding_sha256','lineage_operation_id'])
   ||body.operation_id!==id||body.credential_id!==credential.credentialId)deny('activation_native_identity_required',401);
  const device=await resolveNativeDevice(db,body.device_id);
  if(!device||device.device_id!==body.device_id)deny('activation_native_identity_required',401);
  return rpc(db,'custodial_activation_native_result',{p_operation:id,p_device:device.id,p_credential:credential.credentialId,
   p_token_hash:tokenHash(env,credential.secret),p_receipt:body});
 }));
 // Only the existing current-credential middleware can establish this context.
 // Origin/edition alone and the restricted old-work recovery lane cannot mint it.
 const current=requireCurrentCredential||((_req,res)=>res.status(503).json({ok:false,code:'activation_auth_unavailable'}));
 const bindKeys=['schema_version','operation_id','device_id','credential_id','installation_binding_sha256','migrated_from_credential_only_state'];
 const receiptKeys=['operation_id','device_id','credential_id','outcome','changed','transition','journal_schema',
  'journal_binding_sha256','legacy_binding_id','legacy_binding_kind','installation_binding_sha256'];
 for(const [suffix,keys] of [['legacy-lineage-binding',bindKeys],['native-legacy-result',receiptKeys]]){
  app.post('/custodial-device-auth/assigned-activation-operations/:operationId/'+suffix,configured,current,route(async req=>{
   const body=req.body,id=op(req),credential=nativeCredentialParts(req);
   if(!isNativeCustodialRequest(req)||req.memphisDeviceAuth?.credentialed!==true
    ||req.memphisDeviceAuth?.offline_recovery_only||!credential
    ||req.memphisDeviceCredential?.credential_id!==credential.credentialId)deny('activation_current_native_credential_required',403);
   if(!Buffer.isBuffer(req.scanAuthorityRawBody)||req.scanAuthorityRawBody.length>2048||!exactKeys(body,keys)
    ||body.operation_id!==id||body.credential_id!==credential.credentialId
    ||body.device_id!==req.memphisDevice?.canonical_device_id
    ||JSON.stringify(JSON.parse(req.scanAuthorityRawBody))!==JSON.stringify(body))deny('activation_legacy_request_invalid');
   const attestation=verifyNativeDeviceRequestAttestation(req);
   const args={p_operation:id,p_device:req.memphisDevice.canonical_device_pk,p_credential:credential.credentialId,
    p_token_hash:tokenHash(env,credential.secret)};
   if(suffix==='native-legacy-result')return rpc(db,'custodial_legacy_activation_result',{...args,p_receipt:body});
   if(body.schema_version!=='custodial-legacy-lineage-binding-request.v1'||body.migrated_from_credential_only_state!==true
    ||!/^[a-f0-9]{64}$/.test(body.installation_binding_sha256))deny('activation_legacy_request_invalid');
   const proof=JSON.stringify([attestation.version,attestation.credential_id,attestation.device_id,attestation.method,
    attestation.path,attestation.body_sha256,attestation.request_id,attestation.timestamp,attestation.signature]);
   return rpc(db,'custodial_legacy_activation_bind',{...args,p_installation_digest:body.installation_binding_sha256,
    p_native_request:attestation.request_id,p_attestation_digest:crypto.createHash('sha256').update(proof).digest('hex')});
  }));
 }
}
