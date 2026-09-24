import assert from 'node:assert/strict';
import {encryptAssignedActivationToken as encrypt,decryptAssignedActivationToken as decrypt,
 installAssignedActivationTransportRoutes} from '../src/assigned-activation-transport.js';
const id=n=>`11000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={DEVICE_CREDENTIAL_SECRET:'synthetic-test-only-not-production-'.repeat(2)};
const serial='fa6f399149812d6f91684e5371ca56ce4a65710e82a49cf3fca64003e41ded0e';
const station='CUSTODIAL-MAINTENANCE-11000000-0000-4000-8000-000000000003';
const binding={operation_id:id(1),device_id:'KIOSK_08',employee_id:id(2),assignment_epoch:7,
 claimant_credential_id:id(3),workstation_device_id:station,serial_sha256:serial};
const token='T'.repeat(43),envelope=encrypt(env,binding,token);
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
check('actual AES256GCM exact token roundtrip',()=>assert.equal(decrypt(env,binding,envelope),token));
for(const [field,value] of Object.entries({operation_id:id(90),device_id:'KIOSK_09',employee_id:id(91),assignment_epoch:8,
 claimant_credential_id:id(92),workstation_device_id:station.replace(/003$/,'004'),serial_sha256:'a'.repeat(64)}))
 check('ciphertext binds '+field,()=>assert.throws(()=>decrypt(env,{...binding,[field]:value},envelope),/envelope_unavailable/));
check('no plaintext persisted in envelope',()=>assert.ok(!JSON.stringify(envelope).includes(token)));
check('wrong encryption root rejects',()=>assert.throws(()=>decrypt({DEVICE_CREDENTIAL_SECRET:'x'.repeat(64)},binding,envelope),/unavailable/));
check('extra envelope field rejected',()=>assert.throws(()=>decrypt(env,binding,{...envelope,token}),/unavailable/));
const routes=new Map(),app={post:(p,...h)=>routes.set('POST '+p,h.at(-1)),get:(p,...h)=>routes.set('GET '+p,h.at(-1))};
let calls=[],savedEnvelope,firstHash;
const status={operation_id:id(1),device_id:'KIOSK_08',employee_id:id(2),assignment_epoch:7,state:'prepared',state_version:2};
const db={rpc:async(name,args)=>{calls.push({name,args});
 if(name==='custodial_activation_claim'){savedEnvelope??=args.p_token_envelope;firstHash??=args.p_code_hash;return{data:{status,token_envelope:savedEnvelope}};}
 return{data:status};}};
installAssignedActivationTransportRoutes(app,{env,db,configured:()=>{},requireManager:()=>{},
 resolveNativeDevice:async()=>({id:id(5),device_id:'KIOSK_08'}),isNativeCustodialRequest:r=>r.native===true,
 nativeCredentialParts:r=>r.credential||null,tokenHash:(_,s)=>'hash-'+s,assignedActivationTokenHash:(_,s)=>'hash-'+s});
const session={trusted_device:true,manager_id:id(6),credential_id:id(3),device_id:station,access_level:'full_access',roles:['CUSTODIAL_MANAGER']};
async function invoke(path,patch={}){let result={status:200,headers:{}};const res={setHeader:(k,v)=>result.headers[k]=v,
 status:n=>{result.status=n;return res;},json:v=>{result.body=v;return res;}};
 await routes.get(path)({headers:{},params:{operationId:id(1),deviceId:'KIOSK_08'},body:{},memphisAuth:session,...patch},res);return result;}
const claim='POST /custodial-admin-api/assigned-activation-operations/:operationId/claim';
const claimBody={adb_serial_sha256:serial,client_version:'custodial-maintenance-v1'};
let response=await invoke(claim,{body:claimBody});
check('workstation route retrieves authenticated token',()=>assert.equal(response.status,200));
const actualToken=response.body.data.activation_token;
response=await invoke(claim,{body:claimBody});
check('lost-response retry returns original token not new random candidate',()=>assert.equal(response.body.data.activation_token,actualToken));
check('returned token binds first enrollment hash',()=>assert.equal(firstHash,'hash-'+actualToken));
check('claim response is no-store',()=>assert.equal(response.headers['Cache-Control'],'no-store'));
response=await invoke(claim,{headers:{origin:'https://lasrevinu333-design.github.io'},body:claimBody});
check('browser origin cannot retrieve token',()=>assert.equal(response.status,403));
response=await invoke(claim,{body:claimBody,memphisAuth:{...session,device_id:'normal-browser'}});
check('browser trusted identity cannot retrieve token',()=>assert.equal(response.status,403));
response=await invoke(claim,{body:{...claimBody,adb_serial_sha256:'b'.repeat(64)}});
check('physical serial mismatch rejected',()=>assert.equal(response.status,409));
response=await invoke(claim,{body:claimBody,memphisAuth:{...session,read_only:true,access_level:'read_only'}});
check('readonly manager cannot claim',()=>assert.equal(response.status,403));
response=await invoke('POST /leadership-api/phone-assignments/:deviceId/activation-operations',{
 headers:{'idempotency-key':id(1)},body:{operation_id:id(1),expected_employee_id:id(2),expected_assignment_epoch:7,action:'activate_or_recover'}});
check('browser request returns status only',()=>{assert.equal(response.status,200);assert.ok(!JSON.stringify(response.body).includes(actualToken));});
const native='POST /custodial-device-auth/assigned-activation-operations/:operationId/native-result';
const receipt={operation_id:id(1),device_id:'KIOSK_08',credential_id:id(8),flow:'recovery',outcome:'active',changed:true,
 journal_schema:'native-assigned-activation.v1',journal_binding_sha256:'c'.repeat(64),lineage_operation_id:id(9)};
response=await invoke(native,{native:true,credential:{credentialId:id(8),secret:'synthetic-secret'},body:receipt});
check('native exact receipt uses actual credential hash',()=>{assert.equal(response.status,200);assert.equal(calls.at(-1).args.p_token_hash,'hash-synthetic-secret');});
const before=calls.length;response=await invoke(native,{native:true,credential:{credentialId:id(7),secret:'synthetic-secret'},body:receipt});
check('body cannot impersonate a different native credential',()=>{assert.equal(response.status,401);assert.equal(calls.length,before);});
db.rpc=async()=>({error:{code:'XX000',message:actualToken,details:envelope}});
response=await invoke(claim,{body:claimBody});
check('provider errors cannot echo sensitive payloads',()=>{assert.equal(response.status,503);assert.ok(!JSON.stringify(response).includes(actualToken));});
console.log(JSON.stringify({status:'PASS',checks,realCrypto:true,routeHandlers:true,actualHttpMiddleware:false,production:false,independentAudit:false}));
