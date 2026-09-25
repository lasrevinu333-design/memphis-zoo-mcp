import {createHash} from 'node:crypto';
import {verifyNativeDeviceRequestAttestation,deviceCredentialInternals} from './auth/device-credential-auth.js';
import {parseNativeProviderJson} from './native-provider-json.js';

const PREFIX='/employee-notifications-api/native-provider';
const PATHS=new Set(['register','status','events','inventory'].map(s=>PREFIX+'/'+s));
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const deny=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
function binding(body,status){
 const keys=['schema','operation_id','generation_id','principal_digest','token_digest','native_app','device_id','credential_id','employee_id','assignment_epoch'];
 if(!status)keys.push('token');
 if(!exact(body,keys)||body.schema!==`custodial.native-provider-${status?'status':'register'}.v1`
  ||!['operation_id','generation_id','credential_id','employee_id'].every(k=>typeof body[k]==='string'&&UUID.test(body[k]))
  ||!['principal_digest','token_digest'].every(k=>typeof body[k]==='string'&&SHA.test(body[k]))
  ||typeof body.device_id!=='string'||!body.device_id||body.device_id.length>200
  ||!Number.isSafeInteger(body.assignment_epoch)||body.assignment_epoch<1)deny('native_provider_binding_invalid');
 const a=body.native_app;
 if(!exact(a,['package_name','version_name','version_code','build_id'])||a.package_name!=='org.memphiszoo.custodial'
  ||typeof a.version_name!=='string'||!a.version_name||a.version_name.length>64||a.version_name!==a.version_name.trim()||/[\u0000-\u001f\u007f-\u009f]/u.test(a.version_name)
  ||!Number.isSafeInteger(a.version_code)||a.version_code<1||a.version_code>2100000000||typeof a.build_id!=='string'
  ||!/^[A-Za-z0-9._-]{1,200}$/.test(a.build_id)||!/[.]custodial[.][0-9a-f]{12}$/.test(a.build_id))deny('native_provider_app_invalid');
 if(!status&&(typeof body.token!=='string'||Buffer.byteLength(body.token)<20||Buffer.byteLength(body.token)>4096
  ||/[\u0000-\u001f\u007f-\u009f]/u.test(body.token)||createHash('sha256').update(body.token).digest('hex')!==body.token_digest))deny('native_provider_token_invalid');
}
/** Partial route owner; NOT mounted in production until events/inventory/clock and
 * the complete implementation review pass. No optional custom signer/host/handler. */
export function installNativeProviderRoutes(app,{db,env=process.env,requireCurrentCredential}={}){
 const current=requireCurrentCredential||((_req,res)=>res.status(503).json({ok:false,code:'native_provider_auth_unavailable'}));
 app.use((req,res,next)=>{
  let decoded;try{decoded=decodeURIComponent(req.path);}catch{decoded=req.path;}
  if(![decoded,req.path].some(p=>p.toLowerCase()===PREFIX||p.toLowerCase().startsWith(PREFIX+'/')))return next();
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,code:'native_provider_method_invalid'});
  if(!PATHS.has(req.originalUrl))return res.status(400).json({ok:false,code:'native_provider_path_invalid'});
  return next();
 });
 for(const suffix of ['register','status'])app.post(PREFIX+'/'+suffix,current,async(req,res)=>{
  try{
   if(req.headers.origin!=='https://localhost'||req.headers['x-memphis-app-edition']!=='custodial'
    ||req.memphisDeviceAuth?.credentialed!==true||req.memphisDeviceAuth?.offline_recovery_only)
    deny('native_provider_current_credential_required',403);
   const authorization=/^Device (\S+)$/.exec(req.headers.authorization||'');
   const credential=authorization&&deviceCredentialInternals.credentialTokenParts(authorization[1]);
   if(!credential||credential.credentialId!==req.memphisDeviceCredential?.credential_id)deny('native_provider_current_credential_required',403);
   const body=parseNativeProviderJson(req.scanAuthorityRawBody);
   if(JSON.stringify(body)!==JSON.stringify(req.body))deny('native_provider_raw_body_changed');
   binding(body,suffix==='status');
   if(body.credential_id!==credential.credentialId||body.device_id!==req.memphisDevice?.canonical_device_id
    ||body.employee_id!==req.memphisDevice?.assigned_employee_id||body.assignment_epoch!==Number(req.memphisDevice?.assignment_epoch))
    deny('native_provider_recipient_mismatch',403);
   const a=verifyNativeDeviceRequestAttestation(req);
   if(!db||typeof db.rpc!=='function')deny('native_provider_service_unavailable',503);
   const proof=JSON.stringify([a.version,a.credential_id,a.device_id,a.method,a.path,a.body_sha256,a.request_id,a.timestamp,a.signature]);
   const result=await db.rpc('custodial_native_provider_registration',{
    p_credential:credential.credentialId,p_credential_hash:deviceCredentialInternals.tokenHash(credential.secret,env),
    p_native_request:a.request_id,p_attestation_digest:createHash('sha256').update(proof).digest('hex'),p_body:body,p_status:suffix==='status',
   });
   if(result.error){const status=result.error.code==='42501'?403:result.error.code==='22023'?400:['23505','40001','P0001','P0002'].includes(result.error.code)?409:503;
    deny(status===403?'native_provider_access_denied':status===409?'native_provider_state_conflict':status===400?'native_provider_request_invalid':'native_provider_service_unavailable',status);}
   if(!result.data||typeof result.data!=='object'||Array.isArray(result.data))deny('native_provider_response_invalid',503);
   res.json({ok:true,data:result.data});
  }catch(error){res.status(error.status||503).json({ok:false,code:error.status?error.code:'native_provider_service_unavailable'});}
 });
 // Until their owning SQL/protocol is implemented there is no generic relay or
 // permissive fallback for these exact reserved paths.
 for(const suffix of ['events','inventory'])app.post(PREFIX+'/'+suffix,current,(_req,res)=>res.status(503).json({ok:false,code:'native_provider_route_not_ready'}));
}
