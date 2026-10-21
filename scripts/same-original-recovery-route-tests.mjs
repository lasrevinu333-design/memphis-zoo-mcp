import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Only new actual loopback HTTP caller cases. Private auth/source/issue ports
// below are explicitly recording SYNTHETIC fixtures, not a server auth/store.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const backend=process.argv[2];assert.ok(backend&&path.isAbsolute(backend));
const sha=value=>createHash('sha256').update(value).digest('hex');
function pinned(file,digest){assert.equal(sha(fs.readFileSync(file)),digest,file);return file;}
const wireFile=pinned(backend+'/src/same-original-recovery-wire.js','dc79e4f3a7f137c5ea159b1f2b909e864378497c67259f862c27cc9e233335cb');
pinned(backend+'/src/native-provider-json.js','8599daf5faec77242649dd6a863731e32ba4193872efe546029777c87f785294');
const frontend=path.dirname(backend)+'/frontend';
pinned(frontend+'/mobile/plugins/custodial-native-vault/android/src/main/java/org/memphiszoo/custodial/vault/NativeSameOriginalRecoveryPreparationWire.java',
  'b11134e9f35ad1c7a10f4d00a53e2416879617d296e0055530d9de2cd5bf1daa');
pinned(frontend+'/same-original-recovery-client.js','4258f569d9417a6b3a4b0e1153b753409ee2b387499c5dcd4bf9491a187270dc');
const mainHandler=backend+'/src/manager-original-recovery-approval.js';
const handlerFile=pinned(fs.existsSync(mainHandler)?mainHandler:
  '/home/eric/Documents/Codex/2026-10-09/task-9/g08-manager-preparation-handlers-20261014-v1/src/manager-original-recovery-approval.js',
  '622571d4ac00dc850b3aaac86d815fcaf00fbd2fe3967869a2cdeab1deec115d');
const routeUrl=pathToFileURL(root+'/src/same-original-recovery-routes.js').href,handlerUrl=pathToFileURL(handlerFile).href;
const hook=registerHooks({resolve(specifier,context,next){
  if(context.parentURL===routeUrl&&specifier==='./manager-original-recovery-approval.js')return next(handlerUrl,context);
  if([routeUrl,handlerUrl].includes(context.parentURL)&&specifier==='./same-original-recovery-wire.js')return next(pathToFileURL(wireFile).href,context);
  return next(specifier,context);
}});
const {installSameOriginalRecoveryRoutes}=await import(routeUrl);
const wire=await import(pathToFileURL(wireFile));hook.deregister();
const express=createRequire(backend+'/package.json')('express');
const id=n=>'95000000-0000-4000-8000-'+String(n).padStart(12,'0');
const base='/admin-api/device-security/same-original-recovery',confirm=base+'/approvals',status=confirm+'/original-status',review=base+'/challenges/'+id(2);
const actor=Object.freeze({manager_id:id(40),manager_credential_id:id(41),manager_device_id:'SYNTHETIC_MANAGER_ONLY'});
const target=Object.fromEntries(wire.recoveryTargetFields.map(key=>[key,
  ['operation_id','separation_id','canonical_device_pk','employee_id','credential_id','original_generation_id'].includes(key)?id(1):
  ['assignment_epoch','separation_authority_revision'].includes(key)?'7':key==='engine_revision'?'0':key==='canonical_device_id'?'KIOSK_08':'a'.repeat(64)]));
const preview={schema:'custodial.same-original-recovery-review.v1',state:'ORIGINAL_BINDING_REVIEW_ONLY',purpose:wire.recoveryPreparationPurpose,
  challenge_id:id(2),challenge_sha256:'b'.repeat(64),preview_sha256:'a'.repeat(64),original_target:target,
  expires_at:'2026-10-14T00:05:00.000000Z',limits:{...wire.recoveryDeniedEffects}};
preview.preview_sha256=wire.recoveryDocumentSha256('preview',preview);
const original={schema:'custodial.same-original-recovery-approval-request.v1',request_id:id(3),challenge_id:id(2),
  expected_challenge_sha256:preview.challenge_sha256,expected_preview_sha256:preview.preview_sha256,
  expected_manager_id:actor.manager_id,expected_manager_credential_id:actor.manager_credential_id,
  expected_manager_device_id:actor.manager_device_id,decision:wire.recoveryPreparationPurpose,manager_confirmation:'CONFIRM_THIS_SAME_ORIGINAL_ONLY'};
function receipt(request){const value={schema:'custodial.same-original-recovery-approval-receipt.v1',state:'APPROVAL_RECORDED_ONLY',approval_id:id(4),
  original_request:request,original_request_sha256:wire.recoveryDocumentSha256('request',request),issuer:actor,
  challenge_sha256:preview.challenge_sha256,preview_sha256:preview.preview_sha256,original_target:target,
  purpose_admission_id:wire.recoveryPreparationAdmission,issued_at:'2026-10-14T00:00:00.000000Z',expires_at:preview.expires_at,
  receipt_sha256:'a'.repeat(64),retry_safe:false,limits:{...wire.recoveryDeniedEffects}};
  value.receipt_sha256=wire.recoveryDocumentSha256('receipt',value);return value;}
const authRecords=[],reads=[],issues=[],statuses=[],parserErrors=[],serverSockets=new Set(),clientRequests=new Set();
let saved=null,lost=false,portGate=null,foreign=null,issueEntered=null,releasePort=null;
const ports={
  async authenticateCurrentManager(req,options){authRecords.push({req,raw:req.scanAuthorityRawBody,options});return actor;},
  async readVerifiedChallenge(args){reads.push(args);return preview;},
  async issueOriginalApprovalOnce(args){issues.push(args);saved={utf8:args.originalRequestUtf8,receipt:receipt(args.originalRequest)};
    issueEntered?.();if(portGate)await portGate;
    if(foreign)authRecords.at(-1).req.scanAuthorityRawBody=foreign;
    if(lost)throw Error('SYNTHETIC_COMMIT_LOST_REPLY');return saved.receipt;},
  async readOriginalApproval(args){statuses.push(args);return args.originalRequestUtf8===saved?.utf8?saved.receipt:null;},
};
const app=express();
// Test-only preexisting framework observation records parsed-request cleanup,
// but no replacement guards, body parser, lock or auth implementation.
const incoming=[];app.use((req,res,next)=>{incoming.push({req,res,dataBefore:req.listenerCount('data'),abortBefore:req.listenerCount('aborted')});next();});
const installed=installSameOriginalRecoveryRoutes(app,ports);
assert.equal(installed.maxRequestBytes,8192);assert.equal(installed.receiveDeadlineMs,30000);
app.use(express.json());app.use((req,res)=>res.status(404).json({ok:false}));
const server=http.createServer(app);server.on('connection',socket=>{serverSockets.add(socket);socket.once('close',()=>serverSockets.delete(socket));});
server.on('clientError',(error,socket)=>{parserErrors.push(error.code??'client_error');socket.destroy();});
const cases=[],controls={source_pins:true,actual_loopback_HTTP:false,listen_attempts:1};let listenError=null;
async function request(method,url,body=Buffer.from(JSON.stringify(original)),headers={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,method,path:url,agent:false,
      headers:{authorization:'SYNTHETIC_SESSION_ONLY',cookie:'SYNTHETIC_SECURITY_COOKIE',
        ...(method==='POST'?{'content-type':'application/json','content-length':body.length}:{}),...headers}},res=>{
      const parts=[];res.on('data',part=>parts.push(part));res.once('error',reject);res.once('end',()=>{
        const bytes=Buffer.concat(parts);resolve({status:res.statusCode,headers:res.headers,body:bytes.length?JSON.parse(bytes):null});});
    });clientRequests.add(req);req.once('close',()=>clientRequests.delete(req));req.once('error',reject);
    req.setTimeout(35000,()=>req.destroy(Error('TEST_HTTP_BOUND')));req.end(method==='POST'?body:undefined);
  });
}
function zero(raw){assert.ok(Buffer.isBuffer(raw));assert.ok(raw.every(value=>value===0));}
function clean(record){assert.equal(record.req.scanAuthorityRawBody,undefined);assert.equal(record.req.body,undefined);
  assert.equal(record.req.listenerCount('data'),record.dataBefore);assert.equal(record.req.listenerCount('aborted'),record.abortBefore);
  assert.ok(!record.req.listeners('end').some(fn=>fn.name==='onEnd'));
  assert.ok(!record.res.listeners('close').some(fn=>fn.name==='onResponseClose'));}
async function test(name,body){try{await body();cases.push({name,passed:true});console.log('PASS '+name);}
  catch(error){cases.push({name,passed:false,error:error.code??error.name});console.error('FAIL '+name+' '+(error.code??error.name));process.exitCode=1;}}
try{
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});}
  catch(error){listenError={code:error.code??error.name,address:'127.0.0.1',port:0};process.exitCode=2;
    console.error('NOT_RUN first normal listen '+listenError.code);}
  if(!listenError){controls.actual_loopback_HTTP=true;
    await test('ROUTE_NEW exact whitespace original confirm and original-status use actual parser/handler',async()=>{
      const body=Buffer.from('\n '+JSON.stringify(Object.fromEntries(Object.entries(original).reverse()),null,2)+'\t');
      const result=await request('POST',confirm,body);assert.equal(result.status,200);assert.equal(issues.length,1);
      assert.equal(issues[0].originalRequestUtf8,body.toString('utf8'));assert.deepEqual(result.body.data,saved.receipt);
      const read=await request('POST',status,body);assert.equal(read.status,200);assert.equal(issues.length,1);assert.equal(statuses.length,1);
      assert.equal(statuses[0].originalRequestUtf8,body.toString('utf8'));zero(authRecords[0].raw);clean(incoming[0]);
    });
    await test('ROUTE_NEW preview is read-only no POST or issue side effect',async()=>{
      const before=issues.length,seen=authRecords.length,res=await request('GET',review);assert.equal(res.status,200);
      assert.deepEqual(res.body.data,preview);assert.equal(issues.length,before);assert.ok(authRecords.slice(seen).every(row=>row.options.requireCsrf===false));
    });
    await test('ROUTE_NEW malformed duplicate UTF8 empty and oversize bodies refuse before ports',async()=>{
      const before=authRecords.length,issued=issues.length;
      for(const body of [Buffer.from('{'),Buffer.from(JSON.stringify(original).replace('{','{"request_id":"'+id(3)+'",')),
        Buffer.from([0xff]),Buffer.alloc(0),Buffer.alloc(8193,32)]){
        const res=await request('POST',confirm,body);assert.ok([400,413].includes(res.status));
      }assert.equal(authRecords.length,before);assert.equal(issues.length,issued);
    });
    await test('ROUTE_NEW exact URL method content-type and compression refuse before ports',async()=>{
      const before=authRecords.length;
      for(const url of [confirm+'?x=1',confirm+'/',confirm+'/extra',confirm.replace('/admin','/%61dmin'),confirm.toUpperCase()])
        assert.equal((await request('POST',url)).status,400);
      for(const [method,url] of [['GET',confirm],['POST',review],['HEAD',review],['OPTIONS',confirm]])
        assert.equal((await request(method,url)).status,405);
      assert.equal((await request('POST',confirm,undefined,{'content-type':'text/plain'})).status,415);
      assert.equal((await request('POST',confirm,undefined,{'content-encoding':'gzip'})).status,415);
      assert.equal(authRecords.length,before);
    });
    await test('ROUTE_NEW one lost reply exact original readback has zero writer retry',async()=>{
      const before=issues.length;lost=true;const body=Buffer.from(JSON.stringify(original,null,2));
      const result=await request('POST',confirm,body);lost=false;assert.equal(result.status,503);
      assert.equal(result.body.outcome,'UNKNOWN');assert.equal(result.body.retry_safe,false);assert.equal(issues.length,before+1);
      assert.equal((await request('POST',status,body)).status,200);assert.equal(issues.length,before+1);
      assert.equal((await request('POST',status)).status,503);assert.equal(issues.length,before+1);
    });
    await test('ROUTE_NEW raw remains owned during await and foreign replacement never wiped',async()=>{
      const entered=new Promise(resolve=>{issueEntered=resolve;});portGate=new Promise(resolve=>{releasePort=resolve;});
      foreign=Buffer.from('FOREIGN_BORROWED_ONLY');const copy=Buffer.from(foreign);const waiting=request('POST',confirm);
      let timer;
      try{
        await Promise.race([entered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TEST_PORT_ENTER_BOUND')),2000);})]);
        const raw=authRecords.at(-1).raw;assert.ok(raw.some(value=>value!==0));releasePort();const result=await waiting;
        assert.equal(result.status,503);zero(raw);assert.deepEqual(foreign,copy);
      }finally{clearTimeout(timer);releasePort?.();await waiting.catch(()=>{});issueEntered=null;releasePort=null;foreign=null;portGate=null;}
    });
    await test('ROUTE_NEW receive abort performs no auth and removes parser listeners',async()=>{
      const before=authRecords.length,count=incoming.length;
      await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,method:'POST',path:confirm,agent:false,
        headers:{'content-type':'application/json','content-length':100}},()=>reject(Error('ABORT_UNEXPECTED_RESPONSE')));
        clientRequests.add(req);req.on('error',()=>{});req.once('close',()=>{clientRequests.delete(req);resolve();});
        req.write('{');setTimeout(()=>req.destroy(),25);});
      await new Promise(resolve=>setTimeout(resolve,25));assert.equal(authRecords.length,before);
      assert.ok(incoming.length>count);clean(incoming.at(-1));
    });
    await test('ROUTE_NEW absolute receive deadline cannot be renewed by partial body',async()=>{
      const before=authRecords.length,start=Date.now();
      const result=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,method:'POST',path:confirm,agent:false,
        headers:{'content-type':'application/json','content-length':100}},res=>{const parts=[];res.on('data',part=>parts.push(part));res.once('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(parts))}));});
        clientRequests.add(req);req.once('close',()=>clientRequests.delete(req));req.once('error',reject);req.setTimeout(35000,()=>req.destroy(Error('TEST_DEADLINE_BOUND')));req.write('{');});
      assert.equal(result.status,408);assert.equal(result.body.code,'same_original_recovery_receive_timeout');
      assert.ok(Date.now()-start>=29000&&Date.now()-start<34000);assert.equal(authRecords.length,before);clean(incoming.at(-1));
    });
  }
}finally{
  releasePort?.();portGate=null;foreign=null;
  for(const req of clientRequests)req.destroy();
  const closed=[...serverSockets].map(socket=>new Promise(resolve=>socket.once('close',resolve)));
  if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await Promise.all(closed);assert.equal(serverSockets.size,0);
  console.log(JSON.stringify({scope:'ACTUAL_LOOPBACK_HTTP_SYNTHETIC_PRIVATE_PORTS_ONLY',controls,listenError,
    cases,cleanup:{server_closed:!server.listening,server_sockets:serverSockets.size,client_requests:clientRequests.size},
    actual_manager_auth:false,SQL:false,native:false,genuine_browser:false,permission_or_G08_claim:false}));
}
