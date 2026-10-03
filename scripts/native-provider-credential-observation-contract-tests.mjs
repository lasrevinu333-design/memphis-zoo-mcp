import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {serialize} from 'node:v8';
import {authenticateNativeProviderCredentialObservationRequest as authenticate,authenticateDeviceCredentialRequest as ordinary,deviceCredentialInternals as internals} from '../src/auth/device-credential-auth.js';
import {CREDENTIAL_OBSERVATION_QUERY as QUERY,CREDENTIAL_OBSERVATION as OBSERVATION,
 validateNativeProviderCredentialObservationQuery as query,validateNativeProviderCredentialObservation as validate,
 lookupNativeProviderCredentialObservation as lookup,createNativeProviderCredentialObservationHandler as handler} from '../src/native-provider-credential-observation.js';
import {runCredentialObservationSqlContractTests} from './native-provider-credential-observation-sql-contract-tests.mjs';

// Actual existing HMAC implementation; synthetic data, no network/server/SQL.
const id=n=>`78000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sha=x=>createHash('sha256').update(x).digest('hex');
const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_credential_observation_server_key'};
const secret='SYNTHETIC_ONLY_credentialObservationabcdefghijklmnopqrstuvwxyz0123456789';
const at='2026-10-03T18:00:00.000Z',now=()=>new Date(at),cid=id(1),employee=id(2),devicePk=id(3),nonce=id(4);
const route='/employee-notifications-api/native-provider/credential-observation';
const requester={current_generation_id:id(5),credential_id:cid,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:7,principal_digest:'a'.repeat(64),token_digest:'b'.repeat(64)};
const body={schema:QUERY,requester};
const device={canonical_device_id:'KIOSK_08',canonical_device_pk:devicePk,device_id:'KIOSK_08',device_active:true,
 employee_active:true,employee_code:'EMP998',assigned_employee_id:employee,assignment_epoch:7};
const credential={credential_id:cid,device_id:devicePk,token_hash:internals.tokenHash(secret,env),confirmed_at:'2026-01-01T00:00:00.000Z',
 expires_at:'2027-01-01T00:00:00.000Z',revoked_at:null,metadata_json:internals.deviceCredentialSecretMetadata(env)};
function request({value=body,raw=JSON.stringify(value),timestamp=at,path=route,requestId=nonce}={}){
 const bytes=Buffer.from(raw),headers={origin:'https://localhost','x-device-id':'KIOSK_08','x-memphis-app-edition':'custodial',
  authorization:`Device ${cid}.${secret}`,'x-memphis-native-attestation-version':'custodial-native-request.v1',
  'x-memphis-native-request-id':requestId,'x-memphis-native-request-timestamp':timestamp};
 headers['x-memphis-native-request-attestation']=createHmac('sha256',secret).update(['custodial-native-request.v1',cid,'KIOSK_08','POST',path,sha(bytes),requestId,timestamp,'custodial'].join('\n')).digest('hex');
 return{method:'POST',originalUrl:path,headers,body:structuredClone(value),scanAuthorityRawBody:bytes};
}
const response=(p,decision='EXPIRED_AS_OF')=>({ok:true,data:{schema:OBSERVATION,native_request_id:p.nativeRequestId,request_body_sha256:p.rawBodySha256,
 requester:structuredClone(p.body.requester),decision,observed_at:decision==='UNRESOLVED'?null:'2026-10-03T18:00:00.123456Z',
 credential_expires_at:decision==='UNRESOLVED'?null:decision==='CURRENT_AS_OF'?'2027-01-01T00:00:00.000000Z':'2026-10-03T17:59:59.999999Z',
 credential_revoked_at:decision==='REVOKED_AS_OF'?'2026-10-03T18:00:00.000001Z':null}});
const proofFromArgs=a=>({purpose:'NATIVE_CREDENTIAL_OBSERVATION_ONLY',body:a.p_body,credentialId:a.p_credential,credentialHash:a.p_credential_hash,
 credentialSecretKeyId:a.p_credential_secret_key_id,nativeRequestId:a.p_native_request,attestationDigest:a.p_attestation_digest,rawBodySha256:a.p_raw_body_sha256});
function fixture({row=structuredClone(credential),found=structuredClone(device),readHook,findHook,dbHook}={}){
 const protectedRecords={cleaning:Buffer.from('SYNTHETIC_PENDING_FINISH'),queue:[{original:'unchanged',state:'PENDING'}],receipts:['immutable-original']};
 const before=serialize(protectedRecords),calls={read:0,find:0,rpc:0,write:0};
 const forbidden=async()=>{calls.write++;throw new Error('SYNTHETIC_PRIVATE_WRITE_FORBIDDEN');};
 const store={findCredential:async n=>{calls.find++;assert.equal(n,cid);if(findHook)await findHook();return row;},
  getPolicy:forbidden,touchCredential:forbidden,audit:forbidden,confirmCredential:forbidden,revokeCredential:forbidden};
 const runReadOnlySql=async sql=>{calls.read++;assert.match(sql,/from public\.devices/);if(readHook)await readHook();return found?[found]:[];};
 const db={rpc:async(fn,args)=>{calls.rpc++;assert.equal(fn,'custodial_native_provider_credential_observation');
  assert(Object.isFrozen(args)&&Object.isFrozen(args.p_body)&&Object.isFrozen(args.p_body.requester));
  return dbHook?await dbHook(args):{data:response(proofFromArgs(args))};}};
 const intact=()=>{assert.deepEqual(serialize(protectedRecords),before);assert.equal(calls.write,0);};
 return{store,runReadOnlySql,db,calls,intact,env:{...env},now:now()};
}
async function call(req,f){
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
 await handler({...f,now:()=>f.now})(req,res);return res;
}
export async function runCredentialObservationContractTests(){
 let checks=0;const check=(name,v)=>{assert(v,name);checks++;console.log('PASS',name);};
 const req=request(),original=serialize(req),f=fixture();
 const p=await authenticate(req,f);f.intact();
 check('actual raw HMAC yields only dedicated immutable proof',p.purpose==='NATIVE_CREDENTIAL_OBSERVATION_ONLY'&&Object.isFrozen(p)&&Object.isFrozen(p.body.requester));
 assert.deepEqual(serialize(req),original);checks++;
 check('request receives no credentialed or authority flags',!Object.hasOwn(req,'memphisDeviceAuth')&&!Object.hasOwn(p,'credentialed')&&!Object.hasOwn(p,'ok'));
 check('proof exact current requester/body/nonce/hash',p.rawBodySha256===sha(req.scanAuthorityRawBody)&&p.nativeRequestId===nonce&&p.credentialHash===credential.token_hash&&p.credentialSecretKeyId===credential.metadata_json.credential_secret_key_id);
 const expectedTranscript=JSON.stringify(['custodial-native-request.v1',cid,'KIOSK_08','POST',route,sha(req.scanAuthorityRawBody),nonce,at,req.headers['x-memphis-native-request-attestation']]);
 check('existing HMAC transcript digest is unchanged',p.attestationDigest===sha(expectedTranscript));
 for(const decision of ['CURRENT_AS_OF','EXPIRED_AS_OF','REVOKED_AS_OF','UNRESOLVED']){
  const value=response(p,decision),out=validate(value,p);assert.deepEqual(out,value);checks++;
  check('finite response '+decision,Object.isFrozen(out)&&Object.isFrozen(out.data)&&Object.isFrozen(out.data.requester)&&!Object.hasOwn(out.data,'effect_permission'));
 }
 for(const state of ['expired','revoked']){
  const row=structuredClone(credential);if(state==='expired')row.expires_at='2020-01-01T00:00:00.000Z';else row.revoked_at='2026-10-03T17:59:00.000Z';
  const proofFixture=fixture({row});const out=await authenticate(request(),proofFixture);proofFixture.intact();
  check('proof-only HMAC remains possible for '+state,out.purpose==='NATIVE_CREDENTIAL_OBSERVATION_ONLY');
  const observationFixture=fixture({row,dbHook:async args=>({data:response(proofFromArgs(args),state==='expired'?'EXPIRED_AS_OF':'REVOKED_AS_OF')})});
  const observed=await call(request(),observationFixture);observationFixture.intact();
  check('dedicated handler can observe '+state+' without general auth',observed.statusCode===200&&observationFixture.calls.rpc===1&&observed.body.data.decision===(state==='expired'?'EXPIRED_AS_OF':'REVOKED_AS_OF'));
  const denyFixture=fixture({row});const result=await ordinary(request(),{...denyFixture,requireEnrolledCredential:true,
   store:{...denyFixture.store,getPolicy:async()=>({mode:'enforce'}),audit:async()=>{}}});
  check('ordinary authentication still DENIES '+state,result.ok===false&&result.status===401&&!result.credentialed);
 }
 const deny=async(name,r,options={})=>{const f=fixture(options),before=serialize(r),out=await call(r,f);f.intact();
  assert.deepEqual(serialize(r),before);check(name,out.statusCode>=400&&f.calls.rpc===0&&out.headers['Cache-Control']==='no-store'&&!JSON.stringify(out.body).includes(secret));};
 for(const key of ['authorization','origin','x-device-id','x-memphis-app-edition','x-memphis-native-attestation-version','x-memphis-native-request-id','x-memphis-native-request-timestamp','x-memphis-native-request-attestation']){
  const r=request();delete r.headers[key];await deny('missing '+key,r);
  const array=request();array.headers[key]=[array.headers[key]];await deny('no header coercion '+key,array);
 }
 for(const[path,method]of [[route+'?x=1','POST'],[route+'/','POST'],[route.toUpperCase(),'POST'],[route.replace('credential','%63redential'),'POST'],[route,'GET'],[route,'PUT']]){
  const r=request({path});r.method=method;await deny('exact path/method '+path+' '+method,r);
 }
 for(const header of ['cookie','x-device-credential']){const r=request();delete r.headers.authorization;r.headers[header]=header==='cookie'?`memphis_device_credential=${cid}.${secret}`:`${cid}.${secret}`;await deny('no alternate credential fallback '+header,r);}
 for(const[key,value]of [['origin','https://example.invalid'],['x-device-id','kiosk_08'],['x-memphis-app-edition','manager'],['authorization','Bearer wrong'],['x-memphis-native-request-attestation','f'.repeat(64)],['x-memphis-native-request-id',id(90)]]){
  const r=request();r.headers[key]=value;await deny('crossed header '+key,r);
 }
 for(const timestamp of ['2026-10-03T17:57:59.999Z','2026-10-03T18:00:15.001Z','2026-02-30T18:00:00.000Z'])await deny('invalid freshness '+timestamp,request({timestamp}));
 for(const mutation of [r=>r.body.requester.assignment_epoch=8,r=>r.scanAuthorityRawBody[0]=32,r=>r.scanAuthorityRawBody=null,r=>r.scanAuthorityRawBody=Uint8Array.from(r.scanAuthorityRawBody)]){
  const r=request();mutation(r);await deny('raw/parsed identity mismatch',r);
 }
 for(const raw of ['{"schema":"duplicate",'+JSON.stringify(body).slice(1),JSON.stringify(body).replace('"assignment_epoch":7','"assignment_epoch":7.0'),JSON.stringify(body).replace('"assignment_epoch":7','"assignment_epoch":7e0'),'[]','null','{','{"__proto__":{},'+JSON.stringify(body).slice(1)])await deny('strict raw parser rejects hostile shape',request({raw}));
 const raw=' \n'+JSON.stringify(body,null,2)+'\n',whitespace=request({raw}),wf=fixture(),wp=await authenticate(whitespace,wf);wf.intact();
 check('signed original whitespace retained',wp.rawBodySha256===sha(raw)&&wp.rawBodySha256!==p.rawBodySha256);
 const rebound=request({raw});rebound.headers['x-memphis-native-request-attestation']=request().headers['x-memphis-native-request-attestation'];await deny('no reserialized HMAC substitute',rebound);
 for(const[key,value]of [['credential_id',id(90)],['employee_id',id(90)],['device_id','KIOSK_09'],['assignment_epoch',8]]){
  await deny('exact current identity '+key,request({value:{...body,requester:{...requester,[key]:value}}}));
 }
 for(const[key,value]of [['current_generation_id',null],['principal_digest','A'.repeat(64)],['token_digest',['b'.repeat(64)]],['assignment_epoch',Number.MAX_SAFE_INTEGER+1],['assignment_epoch','7'],['assignment_epoch',0],['device_id','KIOSK_01']]){
  const valueBody={...body,requester:{...requester,[key]:value}};assert.throws(()=>query(valueBody));checks++;await deny('typed requester '+key,request({value:valueBody}));
 }
 for(const value of [null,[],{...body,extra:true},{...body,requester:{...requester,extra:true}},{...body,schema:'wrong'}]){assert.throws(()=>query(value));checks++;await deny('finite query',request({value}));}
 for(const row of [null,{...credential,credential_id:id(90)},{...credential,device_id:id(90)},{...credential,confirmed_at:null},{...credential,token_hash:'f'.repeat(64)},
  {...credential,metadata_json:[]},{...credential,metadata_json:{credential_secret_key_id:''}},{...credential,metadata_json:{credential_secret_key_id:'f'.repeat(64)}}])await deny('credential lineage denial',request(),{row});
 for(const found of [null,{...device,device_active:false},{...device,employee_active:false},{...device,assigned_employee_id:id(90)},
  {...device,assignment_epoch:8},{...device,canonical_device_id:'KIOSK_09'},{...device,canonical_device_pk:'not-uuid'},{...device,employee_code:'MANAGER'}])await deny('current owner denial',request(),{found});
 for(const metadata_json of [null,undefined,{}]){const f=fixture({row:{...credential,metadata_json}});await authenticate(request(),f);f.intact();check('existing legacy absent key marker stays supported',true);}
 // Inputs may mutate while device/store/RPC awaits. Captured identity/raw bytes,
 // server hash and time must not follow those changes. SQL rechecks live facts later.
 for(const phase of ['device','credential']){
  const r=request(),f=fixture(),mutate=()=>{r.body.requester.assignment_epoch=99;r.headers.authorization='Device changed';r.headers['x-memphis-native-request-id']=id(99);r.scanAuthorityRawBody.fill(0);f.env.DEVICE_CREDENTIAL_SECRET='changed';f.now.setUTCFullYear(2099);};
  if(phase==='device'){const read=f.runReadOnlySql;f.runReadOnlySql=async sql=>{mutate();return read(sql);};}
  else{const find=f.store.findCredential;f.store.findCredential=async n=>{mutate();return find(n);};}
  const out=await authenticate(r,f);f.intact();assert.deepEqual(out,p);check('immutable before '+phase+' await',true);
 }
 for(const options of [{store:null},{runReadOnlySql:null},{env:{}},{now:new Date(NaN)}])await assert.rejects(authenticate(request(),{...fixture(),...options}));checks+=4;
 for(const phase of ['read','find','rpc']){
  const f=fixture(),oops=async()=>{throw new Error('SYNTHETIC_PRIVATE_FAILURE');};if(phase==='read')f.runReadOnlySql=oops;else if(phase==='find')f.store.findCredential=oops;else f.db.rpc=oops;
  const out=await call(request(),f);f.intact();check('ambiguous '+phase+' failure has no negative observation',out.statusCode===503&&!JSON.stringify(out.body).includes('PRIVATE')&&!Object.hasOwn(out.body,'data'));
  if(phase!=='rpc'){await assert.rejects(authenticate(request(),f),e=>e.status===503&&e.message==='native_credential_observation_unavailable');checks++;}
 }
 const mutable=structuredClone(p);let release;const delayed=lookup({context:mutable,db:{rpc:async(_fn,args)=>{await new Promise(r=>release=r);return{data:response(proofFromArgs(args))};}}});
 mutable.body.requester.assignment_epoch=99;mutable.nativeRequestId=id(99);release();assert.deepEqual(await delayed,response(p));check('RPC await cannot rebind captured proof',true);
 for(const bad of [null,{}, {...p,extra:true},{...p,purpose:'AUTHENTICATED'},{...p,credentialId:id(99)},
  ...['nativeRequestId','attestationDigest','credentialHash','rawBodySha256','credentialSecretKeyId'].map(k=>({...p,[k]:null}))]){
  await assert.rejects(lookup({context:bad,db:{rpc:()=>assert.fail('invalid proof reached RPC')}}));checks++;
 }
 await assert.rejects(lookup({context:p,db:null}),e=>e.status===503);checks++;
 for(const decision of ['CURRENT_AS_OF','EXPIRED_AS_OF','REVOKED_AS_OF','UNRESOLVED']){
  const f=fixture({dbHook:async args=>({data:response(proofFromArgs(args),decision)})}),out=await call(request(),f);f.intact();
  check('actual handler '+decision,out.statusCode===200&&out.body.data.decision===decision&&f.calls.rpc===1);
 }
 for(const value of [null,undefined,{},[],{ok:true,data:null},{ok:true,data:[]}]){
  const f=fixture({dbHook:async()=>({data:value})}),out=await call(request(),f);f.intact();check('missing response never means credential revoked',out.statusCode===503&&!Object.hasOwn(out.body,'data'));
 }
 for(const mutate of [x=>x.extra=true,x=>x.ok=false,x=>x.data.extra=true,x=>x.data.native_request_id=id(99),x=>x.data.request_body_sha256='f'.repeat(64),
  x=>x.data.requester.current_generation_id=id(99),x=>x.data.requester.credential_id=id(99),x=>x.data.requester.employee_id=id(99),x=>x.data.requester.assignment_epoch=8,
  x=>x.data.requester.device_id='KIOSK_09',x=>x.data.requester.principal_digest='f'.repeat(64),x=>x.data.requester.token_digest='f'.repeat(64),
  x=>x.data.decision='PERMANENT_REVOKED',x=>x.data.decision='CURRENT_AS_OF',x=>x.data.credential_revoked_at='2026-10-03T17:59:00.000000Z',
  x=>x.data.credential_expires_at='2026-10-03T18:00:00.123457Z',x=>x.data.observed_at=null,x=>x.data.observed_at='2026-02-30T18:00:00.123456Z',
  x=>x.data.observed_at='0000-01-01T00:00:00.000000Z',x=>x.data.observed_at='2026-10-03T18:00:00.123Z',x=>x.data.credential_expires_at='infinity']){
  const value=response(p);mutate(value);assert.throws(()=>validate(value,p));checks++;
  const f=fixture({dbHook:async()=>({data:value})}),out=await call(request(),f);f.intact();check('malformed/crossed response cannot synthesize decision',out.statusCode===503&&!Object.hasOwn(out.body,'data'));
 }
 for(const t of ['2026-10-03T18:00:00.123457Z',null,'2025-02-29T00:00:00.000000Z']){const v=response(p,'REVOKED_AS_OF');v.data.credential_revoked_at=t;assert.throws(()=>validate(v,p));checks++;}
 const exact=response(p);exact.data.credential_expires_at=exact.data.observed_at;assert.equal(validate(exact,p).data.decision,'EXPIRED_AS_OF');checks++;
 const leap=response(p);leap.data.credential_expires_at='2024-02-29T00:00:00.000000Z';validate(leap,p);checks++;
 for(const field of ['observed_at','credential_expires_at','credential_revoked_at']){const v=response(p,'UNRESOLVED');v.data[field]='2026-10-03T18:00:00.000000Z';assert.throws(()=>validate(v,p));checks++;}
 for(const code of ['42501','22023','XX000']){const f=fixture({dbHook:async()=>({error:{code,message:secret,details:'PRIVATE'}})}),out=await call(request(),f);f.intact();
  check('RPC '+code+' is not credential revocation',out.statusCode===({'42501':403,'22023':400,XX000:503}[code])&&!JSON.stringify(out.body).includes(secret)&&!Object.hasOwn(out.body,'data'));
 }
 const prior=response(p),next=fixture({dbHook:async()=>({data:prior})}),out=await call(request({requestId:id(77)}),next);next.intact();
 check('fresh nonce cannot reuse prior cached observation',out.statusCode===503);
 const sqlChecks=runCredentialObservationSqlContractTests();
 console.log(JSON.stringify({status:'PASS',hmac_handler_contract_checks:checks,sql_source_checks:sqlChecks,sql_executed:false,network:false,mounted:false,
  limitations:['SQL proposal and race/recovery cases not executed','native caller/credential stop not implemented','CURRENT_AS_OF grants no future authority']}));
 return{checks,sqlChecks};
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runCredentialObservationContractTests();
