import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
import {makeDeviceCredentialMiddleware,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';
import {installNativeProviderRoutes} from '../src/native-provider-api.js';
const id=n=>`55000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'synthetic-provider-route-root-long-enough'};
const secret='syntheticProviderNativeSecret-abcdefghijklmnopqrstuvwxyz1234567890',cid=id(1),pk=id(3),employee=id(4);
const device={requested_device_id:'KIOSK_08',canonical_device_id:'KIOSK_08',canonical_device_pk:pk,device_id:'KIOSK_08',device_name:'Synthetic',
 device_active:true,assignment_valid:true,employee_active:true,employee_code:'EMP998',role:'staff',assignment_epoch:7,assigned_employee_id:employee,assigned_employee_name:'Synthetic'};
const base={credential_id:cid,device_id:pk,token_hash:deviceCredentialInternals.tokenHash(secret,env),created_at:'2026-01-01T00:00:00.000Z',
 confirmed_at:'2026-01-01T00:00:00.000Z',last_used_at:new Date().toISOString(),expires_at:'2099-01-01T00:00:00.000Z',revoked_at:null,
 metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)};
let row=structuredClone(base),calls=0,lastArgs,lastFunction,checks=0,dbError=null;
const app=express();app.use(createGeneralJsonMiddleware());
installNativeProviderRoutes(app,{env,db:{rpc:async(fn,args)=>{calls++;lastArgs=args;lastFunction=fn;return dbError?{error:dbError}:{data:{synthetic:true}};}},
 requireCurrentCredential:makeDeviceCredentialMiddleware({env,store:{getPolicy:async()=>({mode:'enforce'}),findCredential:async n=>n===cid?row:null,touchCredential:async()=>{},audit:async()=>{}},
  runReadOnlySql:async()=>[device],requireEnrolledCredential:true})});
app.use((err,_req,res,_next)=>res.status(err.status||500).json({code:'synthetic_error'}));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
console.log('OWNED_HTTP_SERVER',server.address().port,'cleanup=server.close in finally');
const origin='http://127.0.0.1:'+server.address().port,prefix='/employee-notifications-api/native-provider',path=prefix+'/register';
const token='synthetic-fcm-token-0000000000000';
const body={schema:'custodial.native-provider-register.v1',operation_id:id(5),generation_id:id(6),credential_id:cid,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:7,
 principal_digest:'a'.repeat(64),token_digest:crypto.createHash('sha256').update(token).digest('hex'),token,
 native_app:{package_name:'org.memphiszoo.custodial',version_name:'synthetic',version_code:53,build_id:'synthetic.custodial.df36d32368b6'}};
function headers(bytes,p=path,t=new Date().toISOString()){
 const proof=['custodial-native-request.v1',cid,'KIOSK_08','POST',p,crypto.createHash('sha256').update(bytes).digest('hex'),id(9),t,'custodial'].join('\n');
 return {'content-type':'application/json',authorization:`Device ${cid}.${secret}`,'x-device-id':'KIOSK_08',origin:'https://localhost','x-memphis-app-edition':'custodial',
  'x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':id(9),'x-memphis-native-request-timestamp':t,
  'x-memphis-native-request-attestation':crypto.createHmac('sha256',secret).update(proof).digest('hex')};
}
async function send(value=body,p=path,edit=()=>{},method='POST'){
 const bytes=typeof value==='string'?value:JSON.stringify(value),h=headers(bytes,p);edit(h);
 return fetch(origin+p,{method,headers:h,...(!['GET','HEAD'].includes(method)?{body:bytes}:{}),signal:AbortSignal.timeout(5000)});
}
const check=(name,value)=>{assert.ok(value,name);checks++;console.log('PASS',name);};
async function refused(name,value=body,p=path,edit=()=>{},method='POST'){
 const count=calls,r=await send(value,p,edit,method);await r.text();check(name,r.status>=400&&calls===count);
}
try{
 let r=await send();await r.text();check('actual current credential plus HMAC reaches typed registration',r.status===200&&lastFunction==='custodial_native_provider_registration');
 check('no raw credential secret goes to SQL',lastArgs.p_credential_hash===base.token_hash&&!JSON.stringify(lastArgs).includes(secret));
 check('actual verified original request identity forwarded',lastArgs.p_native_request===id(9)&&/^[a-f0-9]{64}$/.test(lastArgs.p_attestation_digest));
 const status={...body,schema:'custodial.native-provider-status.v1'};delete status.token;
 r=await send(status,prefix+'/status');await r.text();check('same typed status owner',r.status===200&&lastArgs.p_status===true&&!Object.hasOwn(lastArgs.p_body,'token'));
 for(const key of ['x-memphis-native-attestation-version','x-memphis-native-request-id','x-memphis-native-request-timestamp','x-memphis-native-request-attestation'])
  await refused('missing native proof '+key,body,path,h=>delete h[key]);
 await refused('wrong signed body',body,path,h=>Object.assign(h,headers(JSON.stringify({...body,principal_digest:'f'.repeat(64)}))));
 await refused('wrong signed path',body,path,h=>Object.assign(h,headers(JSON.stringify(body),prefix+'/status')));
 for(const delta of [-300000,60000])await refused('stale/future attestation '+delta,body,path,h=>Object.assign(h,headers(JSON.stringify(body),path,new Date(Date.now()+delta).toISOString())));
 await refused('browser origin cannot claim native',body,path,h=>h.origin='https://example.invalid');
 await refused('wrong edition',body,path,h=>h['x-memphis-app-edition']='manager');
 for(const change of [{extra:true},{employee_id:id(8)},{credential_id:id(8)},{device_id:'KIOSK_09'},{assignment_epoch:8},{assignment_epoch:'7'},
  {operation_id:null},{generation_id:1},{principal_digest:[]},{token_digest:'f'.repeat(64)},{token:'short'},
  {native_app:{...body.native_app,version_code:'53'}},{native_app:{...body.native_app,package_name:'org.memphiszoo.infrastructure'}}])
  await refused('strict binding '+JSON.stringify(change),{...body,...change});
 await refused('duplicate signed authority still rejected','{"schema":"wrong",'+JSON.stringify(body).slice(1));
 await refused('decimal signed integer rejected',JSON.stringify(body).replace('"assignment_epoch":7','"assignment_epoch":7.0'));
 for(const p of [path+'/',path+'?x=1',path.toUpperCase(),prefix+'//register',prefix+'/register/extra','/employee-notifications-api/%6eative-provider/register',prefix+'/%72egister',prefix+'/unknown'])
  await refused('route alias/unknown rejected '+p,body,p);
 for(const method of ['GET','PUT','PATCH','DELETE'])await refused('method denied '+method,body,path,()=>{},method);
 for(const state of ['expired','revoked','unknown','unconfirmed','wrong_device','wrong_secret']){
  row=structuredClone(base);if(state==='expired')row.expires_at='2020-01-01T00:00:00.000Z';if(state==='revoked')row.revoked_at=new Date().toISOString();
  if(state==='unknown')row=null;if(state==='unconfirmed'){row.confirmed_at=null;row.metadata_json.enrollment_operation_id=id(10);row.metadata_json.enrollment_flow='recovery';}
  if(state==='wrong_device')row.device_id=id(99);if(state==='wrong_secret')row.token_hash='f'.repeat(64);
  await refused('noncurrent credential '+state);
 }row=structuredClone(base);
 for(const suffix of ['events','inventory'])await refused('unfinished '+suffix+' cannot relay to generic SQL',body,prefix+'/'+suffix);
 const raw=' \n'+JSON.stringify(body,null,2)+'\n';r=await send(raw);await r.text();check('whitespace original bytes actually authenticate',r.status===200);
 await refused('reserialized signature cannot replace original bytes',raw,path,h=>Object.assign(h,headers(JSON.stringify(body))));
 for(const [code,expected] of [['42501',403],['23505',409],['22023',400],['XX000',503]]){
  dbError={code,message:'SYNTHETIC_PRIVATE_DIAGNOSTIC',details:secret};r=await send();const txt=await r.text();
  check('bounded SQL error '+code,r.status===expected&&!txt.includes('SYNTHETIC_PRIVATE')&&!txt.includes(secret));
 }dbError=null;
 console.log(JSON.stringify({status:'PASS',checks,actualHTTP:true,actualCredentialMiddleware:true,actualHmac:true,syntheticRpc:true,
  productionMounted:false,independentAudit:false,providerClock:false,delivery:false}));
}finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));console.log('OWNED_HTTP_SERVER_CLOSED');}
