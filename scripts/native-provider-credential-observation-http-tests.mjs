import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import {createHash,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {serialize} from 'node:v8';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
import {deviceCredentialInternals as internals} from '../src/auth/device-credential-auth.js';
import {createNativeProviderCredentialObservationHandler,CREDENTIAL_OBSERVATION_QUERY,CREDENTIAL_OBSERVATION} from '../src/native-provider-credential-observation.js';

// Actual loopback HTTP/parser/HMAC/handler. RPC and records are deliberately
// synthetic; this test does not mount the production installer/index or run SQL.
const root=new URL('../',import.meta.url),sha=x=>createHash('sha256').update(x).digest('hex');
const pins={
 'src/request-json-parser.js':'c7d44c3795c3642246fb7db8090958842bbb3de8ce9406b05a5849cf30993689',
 'src/auth/device-credential-auth.js':'6421105294f101041bdaaab2a6c2597107e87df9d099c1d656d446b64f5af1ea',
 'src/native-provider-credential-observation.js':'b55bb76b0a8c8f37575ae301de2635b740737a567be6cc761912349e9d7765a9',
 'src/native-provider-api.js':'d330398f959ca4c5682ca6195152b9d0d82d72704fc853af8fe5c3361e93b1e6',
};
const id=n=>`79000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const at='2026-10-03T18:00:00.000Z',route='/employee-notifications-api/native-provider/credential-observation';
const env=Object.freeze({NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_http_observation_server_key'});
const secret='SYNTHETIC_ONLY_httpObservationabcdefghijklmnopqrstuvwxyz0123456789';
const cid=id(1),employee=id(2),devicePk=id(3);
const requester={current_generation_id:id(5),credential_id:cid,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:7,principal_digest:'a'.repeat(64),token_digest:'b'.repeat(64)};
const body={schema:CREDENTIAL_OBSERVATION_QUERY,requester};
const device={canonical_device_id:'KIOSK_08',canonical_device_pk:devicePk,device_id:'KIOSK_08',device_active:true,
 employee_active:true,employee_code:'EMP998',assigned_employee_id:employee,assignment_epoch:7};
const credential={credential_id:cid,device_id:devicePk,token_hash:internals.tokenHash(secret,env),confirmed_at:'2026-01-01T00:00:00.000Z',
 expires_at:'2027-01-01T00:00:00.000Z',revoked_at:null,metadata_json:internals.deviceCredentialSecretMetadata(env)};
function receipt(args,decision){return{ok:true,data:{schema:CREDENTIAL_OBSERVATION,native_request_id:args.p_native_request,
 request_body_sha256:args.p_raw_body_sha256,requester:structuredClone(args.p_body.requester),decision,
 observed_at:decision==='UNRESOLVED'?null:'2026-10-03T18:00:00.123456Z',
 credential_expires_at:decision==='UNRESOLVED'?null:decision==='CURRENT_AS_OF'?'2027-01-01T00:00:00.000000Z':'2026-10-03T17:59:59.999999Z',
 credential_revoked_at:decision==='REVOKED_AS_OF'?'2026-10-03T18:00:00.000001Z':null}};}
function query({value=body,raw=Buffer.from(JSON.stringify(value)),path=route,method='POST',nonce=id(4),timestamp=at}={}){
 raw=Buffer.from(raw);const headers={'content-type':'application/json','content-length':String(raw.length),origin:'https://localhost',
  'x-device-id':'KIOSK_08','x-memphis-app-edition':'custodial',authorization:`Device ${cid}.${secret}`,
  'x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':nonce,'x-memphis-native-request-timestamp':timestamp};
 headers['x-memphis-native-request-attestation']=createHmac('sha256',secret).update(['custodial-native-request.v1',cid,'KIOSK_08',method,path,sha(raw),nonce,timestamp,'custodial'].join('\n')).digest('hex');
 return{raw,path,method,headers};
}
export async function runCredentialObservationHttpTests(){
 const started=Date.now(),deadline=started+25000,sockets=new Set(),requests=new Set();let checks=0,scenario=null,port=null,closed=false;
 const check=(name,value)=>{assert(value,name);checks++;console.log('PASS HTTP',name);};
 for(const[p,h]of Object.entries(pins)){assert.equal(sha(readFileSync(new URL(p,root))),h,p);checks++;}
 const protectedRecords={finish:Buffer.from('SYNTHETIC_PENDING_FINISH'),events:[{bytes:'original-event',status:'PENDING'}],navigation:['original-open']};
 const protectedBefore=serialize(protectedRecords);
 const app=express();app.disable('x-powered-by');
 app.use(createGeneralJsonMiddleware());
 app.use(async(req,res)=>{
  const s=scenario;assert(s);s.req=req;s.handlers++;
  const originalFlags={auth:req.memphisDeviceAuth,credential:req.memphisDeviceCredential,device:req.memphisDevice};
  const forbidden=()=>{s.writes++;throw new Error('SYNTHETIC_PRIVATE_WRITE_FORBIDDEN');};
  const store=s.missing==='store'?null:{findCredential:async n=>{
   s.find++;assert.equal(n,cid);if(s.failure==='find')throw new Error('SYNTHETIC_PRIVATE_STORE_FAILURE');
   if(s.mutateAwait==='find'){req.body.requester.assignment_epoch=99;req.scanAuthorityRawBody.fill(0);req.headers.authorization='Device changed';}
   return s.row;
  },getPolicy:forbidden,touchCredential:forbidden,audit:forbidden,confirmCredential:forbidden,revokeCredential:forbidden};
  const runReadOnlySql=s.missing==='read'?null:async sql=>{
   s.read++;assert.match(sql,/from public\.devices/);if(s.failure==='read')throw new Error('SYNTHETIC_PRIVATE_READ_FAILURE');
   if(s.mutateAwait==='read'){req.body.requester.assignment_epoch=99;req.scanAuthorityRawBody.fill(0);req.headers['x-memphis-native-request-id']=id(99);}
   return s.device?[s.device]:[];
  };
  const db=s.missing==='db'?null:{rpc:async(fn,args)=>{
   s.rpc++;assert.equal(fn,'custodial_native_provider_credential_observation');s.args=args;
   assert(Object.isFrozen(args)&&Object.isFrozen(args.p_body)&&Object.isFrozen(args.p_body.requester));
   if(s.failure==='rpc')throw new Error('SYNTHETIC_PRIVATE_RPC_FAILURE');
   if(s.rpcError)return{error:{code:s.rpcError,message:secret,details:'SYNTHETIC_PRIVATE'}};
   const value=s.response??receipt(args,s.decision);if(s.responseMutation)s.responseMutation(value);
   return{data:value};
  }};
  await createNativeProviderCredentialObservationHandler({env,store,runReadOnlySql,db,now:()=>new Date(at)})(req,res);
  assert.deepEqual({auth:req.memphisDeviceAuth,credential:req.memphisDeviceCredential,device:req.memphisDevice},originalFlags);
  s.returned=true;
 });
 app.use((error,_req,res,_next)=>res.status(500).json({ok:false,code:'test_fixture_failure'}));
 const server=http.createServer(app);
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.requestTimeout=2000;server.headersTimeout=2000;
 const timeout=setTimeout(()=>{for(const req of requests)req.destroy(new Error('whole_attempt_deadline'));for(const s of sockets)s.destroy();server.close();},25000);
 async function send(q,options={}){
  assert(Date.now()<deadline,'single HTTP attempt deadline');
  scenario={row:structuredClone(credential),device:structuredClone(device),decision:'EXPIRED_AS_OF',handlers:0,read:0,find:0,rpc:0,writes:0,...options};
  const captured=scenario;
  const response=await new Promise((resolve,reject)=>{
   const req=http.request({host:'127.0.0.1',port,path:q.path,method:q.method,headers:q.headers,agent:false},res=>{
    const chunks=[];let length=0;res.on('data',c=>{length+=c.length;if(length>65536)req.destroy(new Error('oversize response'));else chunks.push(c);});
    res.on('end',()=>{try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(chunks))});}catch(e){reject(e);}});
   });requests.add(req);req.on('close',()=>requests.delete(req));req.on('error',reject);req.setTimeout(1000,()=>req.destroy(new Error('request timeout')));req.end(q.raw);
  });
  assert.deepEqual(serialize(protectedRecords),protectedBefore);assert.equal(captured.writes,0);
  assert(!JSON.stringify(response.body).includes(secret)&&!JSON.stringify(response.body).includes('PRIVATE'));
  return{...response,scope:captured};
 }
 async function deny(name,q,options={},expected=null){
  const r=await send(q,options);check(name,r.status>=400&&(expected===null||r.status===expected)&&!Object.hasOwn(r.body,'data')&&r.scope.rpc===0);return r;
 }
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  assert.equal(server.address().address,'127.0.0.1');port=server.address().port;
  console.log(JSON.stringify({phase:'credential-http-listener',pid:process.pid,host:'127.0.0.1',port,synthetic_rpc:true}));
  for(const decision of ['CURRENT_AS_OF','EXPIRED_AS_OF','REVOKED_AS_OF','UNRESOLVED']){
   const row=structuredClone(credential);if(decision==='EXPIRED_AS_OF')row.expires_at='2020-01-01T00:00:00.000Z';if(decision==='REVOKED_AS_OF')row.revoked_at=at;
   const q=query(),r=await send(q,{row,decision});
   check('real raw transport finite '+decision,r.status===200&&r.body.data.decision===decision&&r.scope.rpc===1&&r.headers['cache-control']==='no-store');
   check('exact response request binding '+decision,r.body.data.request_body_sha256===sha(q.raw)&&r.body.data.native_request_id===id(4)&&JSON.stringify(r.body.data.requester)===JSON.stringify(requester));
   check('no positive effect or auth fields '+decision,Object.keys(r.body.data).length===8&&!Object.hasOwn(r.body.data,'effect_permission')&&r.scope.returned===true);
  }
  const whitespace=query({raw:Buffer.from(' \n'+JSON.stringify(body,null,2)+'\n')}),w=await send(whitespace);
  check('original whitespace reaches HMAC and RPC',w.status===200&&w.scope.args.p_raw_body_sha256===sha(whitespace.raw)&&w.scope.args.p_raw_body_sha256!==sha(JSON.stringify(body)));
  const rebound=query({raw:whitespace.raw});rebound.headers['x-memphis-native-request-attestation']=query().headers['x-memphis-native-request-attestation'];await deny('reserialized signature cannot replace original bytes',rebound);
  for(const[path,method]of [[route+'/','POST'],[route+'?x=1','POST'],[route.toUpperCase(),'POST'],[route.replace('credential','%63redential'),'POST'],[route,'GET'],[route,'PUT'],[route.replace('credential-observation','event-decisions'),'POST']])await deny('exact method/path '+path+' '+method,query({path,method}));
  for(const[key,value]of [['origin','https://example.invalid'],['x-device-id','KIOSK_09'],['x-memphis-app-edition','manager'],['x-memphis-native-request-id',id(90)],['x-memphis-native-request-attestation','f'.repeat(64)],['authorization','Bearer wrong']]){const q=query();q.headers[key]=value;await deny('crossed HTTP header '+key,q);}
  for(const key of ['authorization','origin','x-device-id','x-memphis-app-edition','x-memphis-native-attestation-version','x-memphis-native-request-id','x-memphis-native-request-timestamp','x-memphis-native-request-attestation']){
   const q=query();delete q.headers[key];await deny('missing HTTP header '+key,q);
   const d=query();d.headers[key]=[d.headers[key],d.headers[key]];
   if(key==='authorization'){
    // Node's actual default server retains the first Authorization value;
    // do not add joinDuplicateHeaders and misclaim production-wire rejection.
    const same=await send(d);check('actual Node first Authorization retains exact valid HMAC',same.status===200&&same.scope.args.p_credential===cid);
    d.headers[key]=['Device malformed',query().headers.authorization];await deny('later Authorization cannot rescue invalid first credential',d);
   }else await deny('joined duplicate HTTP header '+key,d);
  }
  for(const key of ['cookie','x-device-credential']){const q=query();delete q.headers.authorization;q.headers[key]=key==='cookie'?`memphis_device_credential=${cid}.${secret}`:`${cid}.${secret}`;await deny('no HTTP cookie/alternate authority '+key,q);}
  for(const timestamp of ['2026-10-03T17:57:59.999Z','2026-10-03T18:00:15.001Z'])await deny('fresh HTTP signature window '+timestamp,query({timestamp}));
  for(const raw of ['{"schema":"duplicate",'+JSON.stringify(body).slice(1),JSON.stringify(body).replace('"assignment_epoch":7','"assignment_epoch":7.0'),JSON.stringify(body).replace('"assignment_epoch":7','"assignment_epoch":7e0'),'null','[]','{','{"__proto__":{},'+JSON.stringify(body).slice(1),Buffer.from([123,34,120,34,58,34,255,34,125])])await deny('actual strict parser malformed/duplicate/UTF8/numeric',query({raw}),{},400);
  await deny('actual raw parser65536 cap',query({raw:Buffer.alloc(65537,32)}),{},413);
  for(const[key,value]of [['content-type','text/plain'],['content-type','application/json; charset=latin1'],['content-encoding','gzip']]){const q=query();q.headers[key]=value;await deny('actual parser transport '+key+':'+value,q,{},415);}
  for(const change of [x=>x.extra=true,x=>x.requester.extra=true,x=>x.requester.assignment_epoch='7',x=>x.requester.assignment_epoch=8,x=>x.requester.employee_id=id(99),x=>x.requester.device_id='KIOSK_09']){const v=structuredClone(body);change(v);await deny('closed query/current requester',query({value:v}));}
  for(const row of [null,{...credential,confirmed_at:null},{...credential,token_hash:'f'.repeat(64)},{...credential,device_id:id(90)}])await deny('current credential lineage',query(),{row});
  for(const found of [null,{...device,device_active:false},{...device,employee_active:false},{...device,assignment_epoch:8},{...device,assigned_employee_id:id(90)}])await deny('current principal/epoch',query(),{device:found});
  for(const phase of ['read','find','rpc']){const r=await send(query(),{failure:phase});check('throwing '+phase+' never means revoked',r.status===503&&!Object.hasOwn(r.body,'data'));}
  for(const missing of ['store','read','db']){const r=await send(query(),{missing});check('missing dependency '+missing+' fails closed',r.status===503&&!Object.hasOwn(r.body,'data'));}
  for(const mutateAwait of ['read','find']){const q=query(),r=await send(q,{mutateAwait});check('snapshot original HTTP evidence across '+mutateAwait,r.status===200&&r.scope.args.p_body.requester.assignment_epoch===7&&r.scope.args.p_raw_body_sha256===sha(q.raw)&&r.scope.args.p_native_request===id(4));}
  for(const responseMutation of [x=>x.extra=true,x=>x.data.extra=true,x=>x.data.native_request_id=id(99),x=>x.data.request_body_sha256='f'.repeat(64),
   ...Object.keys(requester).map(k=>x=>x.data.requester[k]=k==='assignment_epoch'?99:k==='device_id'?'KIOSK_09':k.endsWith('digest')?'f'.repeat(64):id(99)),
   x=>x.data.decision='REVOKED',x=>x.data.observed_at=null,x=>x.data.credential_expires_at='2026-10-03T18:00:00.999999Z']){
   const r=await send(query(),{responseMutation});check('exact SQL receipt mismatch never creates negative observation',r.status===503&&!Object.hasOwn(r.body,'data'));
  }
  for(const rpcError of ['42501','22023','XX000']){const r=await send(query(),{rpcError});check('generic RPC denial '+rpcError+' not revocation',r.status===({42501:403,22023:400,XX000:503}[rpcError])&&!Object.hasOwn(r.body,'data'));}
  const first=await send(query()),second=await send(query({nonce:id(77)}),{response:first.body});check('lost/cached old response cannot settle fresh nonce',second.status===503&&!Object.hasOwn(second.body,'data'));
 }finally{
  const closeEvents=[];
  // Response end/server close can precede the client-request close callback.
  // Await those actual lifecycle events; never erase sets to manufacture zero.
  for(const req of requests){closeEvents.push(new Promise(resolve=>req.once('close',resolve)));req.destroy();}
  for(const socket of sockets){closeEvents.push(new Promise(resolve=>socket.once('close',resolve)));socket.destroy();}
  await new Promise(resolve=>server.close(resolve));await Promise.all(closeEvents);
  clearTimeout(timeout);closed=!server.listening;assert(closed);assert.equal(sockets.size,0);
 }
 check('owned listener and all sockets closed',closed&&requests.size===0&&sockets.size===0);
 assert(Date.now()-started<30000,'bounded loopback attempt');
 const result={status:'PASS',checks,elapsed_ms:Date.now()-started,loopback_http:true,synthetic_rpc:true,sql_executed:false,
  production_mount:false,listener_closed:closed,remaining_sockets:sockets.size,limitations:['No SQL execution or ordinary auth expansion','CURRENT_AS_OF is not future/offline permission','Node default first-Authorization normalization explicitly observed, not raw duplicate-header rejection','No native stop/readback implementation or production route activation']};
 console.log(JSON.stringify(result));return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runCredentialObservationHttpTests();
