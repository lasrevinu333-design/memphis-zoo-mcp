import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

// New recording-port handler cases ONLY. The single dependency relocation
// imports Main's exact wire implementation; it does not replace any product
// guard/authenticator or create runtime authority. No HTTP/SQL/native use.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const backend=process.argv[2];assert.ok(backend&&path.isAbsolute(backend),'absolute Main backend root required');
const wireFile=path.join(backend,'src/same-original-recovery-wire.js');
const sha=value=>createHash('sha256').update(value).digest('hex');
assert.equal(sha(fs.readFileSync(wireFile)),'dc79e4f3a7f137c5ea159b1f2b909e864378497c67259f862c27cc9e233335cb');
assert.equal(sha(fs.readFileSync(path.join(backend,'src/native-provider-json.js'))),'8599daf5faec77242649dd6a863731e32ba4193872efe546029777c87f785294');
const handlerUrl=pathToFileURL(path.join(root,'src/manager-original-recovery-approval.js')).href;
const hook=registerHooks({resolve(specifier,context,next){
  if(context.parentURL===handlerUrl&&specifier==='./same-original-recovery-wire.js')
    return next(pathToFileURL(wireFile).href,context);
  return next(specifier,context);
}});
const wire=await import(pathToFileURL(wireFile));
const {createManagerOriginalRecoveryApprovalHandlers,managerOriginalRecoveryApprovalPaths:paths}=await import(handlerUrl);
hook.deregister();
const id=n=>'95000000-0000-4000-8000-'+String(n).padStart(12,'0');
const issuer=()=>Object.freeze({manager_id:id(40),manager_credential_id:id(41),manager_device_id:'SYNTHETIC_MANAGER_ONLY'});
const target=Object.fromEntries(wire.recoveryTargetFields.map(key=>[key,
  ['operation_id','separation_id','canonical_device_pk','employee_id','credential_id','original_generation_id'].includes(key)?id(1):
  ['assignment_epoch','separation_authority_revision'].includes(key)?'7':
  key==='engine_revision'?'0':key==='canonical_device_id'?'KIOSK_08':'a'.repeat(64)]));
function preview(){const value={schema:'custodial.same-original-recovery-review.v1',state:'ORIGINAL_BINDING_REVIEW_ONLY',
  purpose:wire.recoveryPreparationPurpose,challenge_id:id(2),challenge_sha256:'b'.repeat(64),preview_sha256:'a'.repeat(64),
  original_target:structuredClone(target),expires_at:'2026-10-14T00:05:00.000000Z',limits:{...wire.recoveryDeniedEffects}};
  value.preview_sha256=wire.recoveryDocumentSha256('preview',value);return value;}
function request(p=preview()){return {schema:'custodial.same-original-recovery-approval-request.v1',
  request_id:id(3),challenge_id:p.challenge_id,expected_challenge_sha256:p.challenge_sha256,expected_preview_sha256:p.preview_sha256,
  expected_manager_id:id(40),expected_manager_credential_id:id(41),expected_manager_device_id:'SYNTHETIC_MANAGER_ONLY',
  decision:wire.recoveryPreparationPurpose,manager_confirmation:'CONFIRM_THIS_SAME_ORIGINAL_ONLY'};}
function sealReceipt(value){value.original_request_sha256=wire.recoveryDocumentSha256('request',value.original_request);
  value.receipt_sha256=wire.recoveryDocumentSha256('receipt',value);return value;}
function receipt(r=request(),p=preview()){return sealReceipt({schema:'custodial.same-original-recovery-approval-receipt.v1',
  state:'APPROVAL_RECORDED_ONLY',approval_id:id(4),original_request:structuredClone(r),original_request_sha256:'a'.repeat(64),
  issuer:issuer(),challenge_sha256:p.challenge_sha256,preview_sha256:p.preview_sha256,original_target:structuredClone(p.original_target),
  purpose_admission_id:wire.recoveryPreparationAdmission,issued_at:'2026-10-14T00:00:00.000000Z',
  expires_at:'2026-10-14T00:05:00.000000Z',receipt_sha256:'a'.repeat(64),retry_safe:false,limits:{...wire.recoveryDeniedEffects}});}
function ingress(kind='confirm',r=request()){
  return {method:kind==='preview'?'GET':'POST',originalUrl:kind==='preview'
    ?paths.preview.replace(':challengeId',id(2)):kind==='confirm'?paths.confirm:paths.originalStatus,
    headers:{authorization:'SYNTHETIC_SIGNED_SESSION_ONLY',cookie:'SYNTHETIC_SECURITY_COOKIE_ONLY','x-csrf-token':'SYNTHETIC_CSRF_ONLY'},
    params:{challengeId:id(2)},body:r,scanAuthorityRawBody:Buffer.from(JSON.stringify(r)),aborted:false};
}
function response(){return {headers:{},statusCode:null,payload:null,destroyed:false,writableEnded:false,
  setHeader(name,value){this.headers[name]=value;},status(value){this.statusCode=value;return this;},
  json(value){this.payload=value;this.writableEnded=true;return this;}};}
function recording(){
  const fixture={actor:issuer(),auth:[],reads:[],issues:[],statuses:[],saved:null,p:preview()};
  fixture.ports={
    async authenticateCurrentManager(req,options){fixture.auth.push(options);if(fixture.denied)throw Object.assign(new Error('SYNTHETIC_GATE_DENIED'),{status:403});return fixture.actor;},
    async readVerifiedChallenge(args){fixture.reads.push(args);assert.strictEqual(args.issuer,fixture.firstHandle??fixture.actor);return fixture.p;},
    async issueOriginalApprovalOnce(args){fixture.issues.push(args);assert.strictEqual(args.issuer,fixture.firstHandle??fixture.actor);
      assert.ok(Object.isFrozen(args.originalRequest)&&Object.isFrozen(args.verifiedPreview.original_target));
      fixture.saved=receipt(args.originalRequest,args.verifiedPreview);return fixture.saved;},
    async readOriginalApproval(args){fixture.statuses.push(args);assert.strictEqual(args.issuer,fixture.firstHandle??fixture.actor);return fixture.saved;},
  };return fixture;
}
async function invoke(f,kind='confirm',req=ingress(kind)){const res=response();
  await createManagerOriginalRecoveryApprovalHandlers(f.ports)[kind](req,res);return res;}
function unknown(res,status=503){assert.equal(res.statusCode,status);assert.equal(res.payload.outcome,'UNKNOWN');
  assert.equal(res.payload.retry_safe,false);assert.deepEqual(res.payload.limits,wire.recoveryDeniedEffects);}
const cases=[],rawOnly=process.argv[3]==='--raw-original-new',rawFailedOnly=process.argv[3]==='--raw-failed-new';
async function test(name,body){if(rawOnly&&!name.startsWith('RAW_ORIGINAL_NEW'))return;
  if(rawFailedOnly&&!name.startsWith('RAW_ORIGINAL_NEW invalid UTF8'))return;
  try{await body();cases.push({name,passed:true});console.log('PASS '+name);}
  catch(error){cases.push({name,passed:false,error:error.code??error.name});console.error('FAIL '+name+' '+(error.code??error.name));process.exitCode=1;}}

await test('exact one confirm retains original private issuer handle and immutable wire pins',async()=>{
  const f=recording(),first=f.actor;f.firstHandle=first;
  f.ports.authenticateCurrentManager=async(req,options)=>{f.auth.push(options);return issuer();};
  // First admitted object is the original handle; later equal objects are comparison only.
  let calls=0;const normal=f.ports.authenticateCurrentManager;
  f.ports.authenticateCurrentManager=async(...args)=>{if(++calls===1){f.auth.push(args[1]);return first;}return normal(...args);};
  const r=ingress(),before=Buffer.from(r.scanAuthorityRawBody),res=await invoke(f,'confirm',r);
  assert.equal(res.statusCode,200);assert.deepEqual(res.payload.data,f.saved);assert.equal(f.issues.length,1);
  assert.strictEqual(f.issues[0].issuer,first);assert.equal(f.auth.length,3);assert.ok(f.auth.every(value=>value.requireCsrf===true));
  assert.deepEqual(r.scanAuthorityRawBody,before);assert.equal(res.payload.data.limits.key_removal,false);
});
await test('preview reads only validated private source and requires current actor after read',async()=>{
  const f=recording(),res=await invoke(f,'preview');assert.equal(res.statusCode,200);assert.deepEqual(res.payload.data,f.p);
  assert.equal(f.issues.length,0);assert.equal(f.statuses.length,0);assert.deepEqual(f.auth,[{requireCsrf:false},{requireCsrf:false}]);
  assert.equal(res.headers['Cache-Control'],'private, no-store');
});
await test('revoked manager after challenge await refuses before issue',async()=>{
  const f=recording();f.ports.readVerifiedChallenge=async(args)=>{f.reads.push(args);f.denied=true;return f.p;};
  unknown(await invoke(f),403);assert.equal(f.issues.length,0);assert.equal(f.auth.length,2);
});
await test('changed credential or manager after challenge await cannot retarget issue',async()=>{
  for(const changed of [{manager_id:id(49)},{manager_credential_id:id(49)},{manager_device_id:'SUCCESSOR'}]){
    const f=recording();f.ports.readVerifiedChallenge=async()=>{f.actor=Object.freeze({...f.actor,...changed});return f.p;};
    unknown(await invoke(f),403);assert.equal(f.issues.length,0);
  }
});
await test('conflicting challenge and preview request pins cause no effect',async()=>{
  for(const changed of [{challenge_id:id(9)},{expected_challenge_sha256:'c'.repeat(64)},{expected_preview_sha256:'c'.repeat(64)}]){
    const f=recording();unknown(await invoke(f,'confirm',ingress('confirm',{...request(),...changed})),409);assert.equal(f.issues.length,0);
  }
});
await test('changed original target returned by writer is UNKNOWN even with valid representation hash',async()=>{
  const f=recording();f.ports.issueOriginalApprovalOnce=async(args)=>{f.issues.push(args);const value=receipt(args.originalRequest,args.verifiedPreview);
    value.original_target.frame_sha256='c'.repeat(64);return sealReceipt(value);};
  unknown(await invoke(f));assert.equal(f.issues.length,1);assert.equal(f.auth.length,3);
});
await test('commit then lost reply remains UNKNOWN never rejection or retry',async()=>{
  const f=recording();f.ports.issueOriginalApprovalOnce=async(args)=>{f.issues.push(args);f.saved=receipt(args.originalRequest,args.verifiedPreview);throw Error('SYNTHETIC_LOST_REPLY');};
  unknown(await invoke(f));assert.equal(f.issues.length,1);assert.ok(f.saved);assert.equal(f.auth.length,3);
});
await test('post-write revocation or changed actor keeps persisted original UNKNOWN',async()=>{
  for(const revoked of [true,false]){const f=recording();f.ports.issueOriginalApprovalOnce=async(args)=>{f.issues.push(args);f.saved=receipt(args.originalRequest,args.verifiedPreview);
      if(revoked)f.denied=true;else f.actor=Object.freeze({...f.actor,manager_credential_id:id(49)});return f.saved;};
    unknown(await invoke(f));assert.equal(f.issues.length,1);assert.ok(f.saved);}
});
await test('exact original-status recovery is readback only with saved original and same issuer',async()=>{
  const f=recording();f.saved=receipt();const res=await invoke(f,'originalStatus');assert.equal(res.statusCode,200);
  assert.deepEqual(res.payload.data,f.saved);assert.equal(f.statuses.length,1);assert.deepEqual(f.statuses[0].originalRequest,request());
  assert.equal(f.reads.length,0);assert.equal(f.issues.length,0);assert.ok(f.auth.every(value=>value.requireCsrf));
});
await test('null unknown malformed and foreign original-status never write or promote',async()=>{
  for(const result of [null,{outcome:'UNKNOWN'},false,receipt({...request(),request_id:id(9)})]){
    const f=recording();f.saved=result;unknown(await invoke(f,'originalStatus'));assert.equal(f.issues.length,0);assert.equal(f.reads.length,0);
  }
});
await test('revoked actor after original-status await refuses readback promotion',async()=>{
  const f=recording();f.ports.readOriginalApproval=async(args)=>{f.statuses.push(args);f.denied=true;return receipt();};
  unknown(await invoke(f,'originalStatus'),403);assert.equal(f.issues.length,0);
});
await test('each absent port returns fixed503 and no calls',async()=>{
  for(const missing of Object.keys(recording().ports)){const f=recording();delete f.ports[missing];
    for(const kind of ['preview','confirm','originalStatus'])unknown(await invoke(f,kind),503);
    assert.equal(f.auth.length+f.issues.length+f.reads.length+f.statuses.length,0);
  }
});
await test('read-only or delegate denial is trusted-port refusal not a role field on issuer',async()=>{
  for(const kind of ['preview','confirm','originalStatus']){const f=recording();f.denied=true;unknown(await invoke(f,kind),403);
    assert.equal(f.reads.length+f.issues.length+f.statuses.length,0);}
  const f=recording();f.actor=Object.freeze({...f.actor,read_only:false,owner:true});unknown(await invoke(f),403);assert.equal(f.issues.length,0);
});
await test('raw duplicate fields parsed disagreement and absent raw buffer refuse without auth',async()=>{
  for(const mode of ['duplicate','disagreement','absent']){const f=recording(),req=ingress();
    if(mode==='duplicate')req.scanAuthorityRawBody=Buffer.from(JSON.stringify(req.body).replace('{','{"request_id":"'+id(3)+'",'));
    if(mode==='disagreement')req.body={...req.body,request_id:id(9)};
    if(mode==='absent')delete req.scanAuthorityRawBody;
    unknown(await invoke(f,'confirm',req),400);assert.equal(f.auth.length+f.issues.length,0);
  }
});
await test('malicious body getter never runs and extra authority fields refuse',async()=>{
  for(const getter of [true,false]){const f=recording(),req=ingress();let effects=0;
    if(getter)Object.defineProperty(req.body,'request_id',{enumerable:true,get(){effects++;return id(3);}});else req.body.finalizer_allowed=true;
    unknown(await invoke(f,'confirm',req),400);assert.equal(effects,0);assert.equal(f.auth.length+f.issues.length,0);
  }
});
await test('body raw headers and route changes during authentication cannot dispatch',async()=>{
  for(const change of [req=>{req.body.request_id=id(9);},req=>{req.scanAuthorityRawBody.fill(32);},
    req=>{req.headers.authorization='SYNTHETIC_SUCCESSOR_TOKEN';},req=>{req.originalUrl=paths.originalStatus;}]){
    const f=recording(),req=ingress();f.ports.authenticateCurrentManager=async()=>{change(req);return f.actor;};
    const res=await invoke(f,'confirm',req);assert.notEqual(res.statusCode,200);assert.equal(f.issues.length+f.reads.length,0);
  }
});
await test('raw replacement or abort during awaited issue retains unknown original and borrowed bytes',async()=>{
  for(const abort of [true,false]){const f=recording(),req=ingress(),original=req.scanAuthorityRawBody,bytes=Buffer.from(original);
    f.ports.issueOriginalApprovalOnce=async(args)=>{f.issues.push(args);f.saved=receipt(args.originalRequest,args.verifiedPreview);
      if(abort)req.aborted=true;else req.scanAuthorityRawBody=Buffer.from(original);return f.saved;};
    unknown(await invoke(f,'confirm',req));assert.equal(f.issues.length,1);assert.deepEqual(original,bytes);assert.ok(f.saved);
  }
});
await test('receipt cannot extend challenge lifetime and status reads never renew original time',async()=>{
  const f=recording();f.p.expires_at='2026-10-14T00:04:00.000000Z';f.p.preview_sha256=wire.recoveryDocumentSha256('preview',f.p);
  unknown(await invoke(f,'confirm',ingress('confirm',request(f.p))));assert.equal(f.issues.length,1);
  const s=recording();s.saved=receipt();const before=structuredClone(s.saved);const res=await invoke(s,'originalStatus');
  assert.equal(res.statusCode,200);assert.deepEqual(res.payload.data,before);assert.equal(s.issues.length,0);
});
await test('malformed private preview remains unavailable after current-actor recheck',async()=>{
  const f=recording();f.p.original_target.assignment_epoch=7;unknown(await invoke(f));assert.equal(f.issues.length,0);assert.equal(f.auth.length,2);
});
await test('RAW_ORIGINAL_NEW exact differently ordered whitespace bytes reach issue and status unchanged',async()=>{
  const f=recording(),req=ingress();
  const raw='\n  '+JSON.stringify(Object.fromEntries(Object.entries(req.body).reverse()),null,2)+'\t\n';
  req.scanAuthorityRawBody=Buffer.from(raw);const before=Buffer.from(req.scanAuthorityRawBody);
  f.ports.issueOriginalApprovalOnce=async(args)=>{f.issues.push(args);assert.equal(args.originalRequestUtf8,raw);
    assert.notEqual(args.originalRequestUtf8,JSON.stringify(args.originalRequest));
    f.saved=receipt(args.originalRequest,args.verifiedPreview);return f.saved;};
  const confirmed=await invoke(f,'confirm',req);assert.equal(confirmed.statusCode,200);assert.equal(f.issues.length,1);
  const status=ingress('originalStatus');status.scanAuthorityRawBody=Buffer.from(raw);
  f.ports.readOriginalApproval=async(args)=>{f.statuses.push(args);assert.equal(args.originalRequestUtf8,raw);
    assert.deepEqual(args.originalRequest,req.body);return f.saved;};
  assert.equal((await invoke(f,'originalStatus',status)).statusCode,200);
  assert.equal(f.issues.length,1);assert.equal(f.statuses.length,1);assert.deepEqual(req.scanAuthorityRawBody,before);
});
await test('RAW_ORIGINAL_NEW lost reply exact-only status refuses reserialized request without resend',async()=>{
  const f=recording(),req=ingress(),raw=JSON.stringify(req.body,null,2);req.scanAuthorityRawBody=Buffer.from(raw);
  f.ports.issueOriginalApprovalOnce=async(args)=>{f.issues.push(args);assert.equal(args.originalRequestUtf8,raw);
    f.saved=receipt(args.originalRequest,args.verifiedPreview);throw Error('SYNTHETIC_COMMIT_THEN_LOST');};
  unknown(await invoke(f,'confirm',req));assert.equal(f.issues.length,1);
  f.ports.readOriginalApproval=async(args)=>{f.statuses.push(args);return args.originalRequestUtf8===raw?f.saved:null;};
  unknown(await invoke(f,'originalStatus',ingress('originalStatus')));
  const exact=ingress('originalStatus');exact.scanAuthorityRawBody=Buffer.from(raw);
  assert.equal((await invoke(f,'originalStatus',exact)).statusCode,200);assert.equal(f.issues.length,1);
  assert.equal(f.statuses.length,2);assert.deepEqual(req.scanAuthorityRawBody,Buffer.from(raw));
});
await test('RAW_ORIGINAL_NEW invalid UTF8 or post-capture byte replacement cannot grant issue or readback',async()=>{
  const f=recording(),bad=ingress();bad.scanAuthorityRawBody=Buffer.concat([Buffer.from([0xff]),bad.scanAuthorityRawBody]);
  unknown(await invoke(f,'confirm',bad),400);assert.equal(f.auth.length+f.issues.length,0);
  const g=recording(),req=ingress(),raw=req.scanAuthorityRawBody.toString('utf8');
  g.ports.issueOriginalApprovalOnce=async(args)=>{g.issues.push(args);assert.equal(args.originalRequestUtf8,raw);
    g.saved=receipt(args.originalRequest,args.verifiedPreview);req.scanAuthorityRawBody=Buffer.from(raw+' ');return g.saved;};
  unknown(await invoke(g,'confirm',req));assert.equal(g.issues.length,1);assert.equal(g.auth.length,2);
  assert.equal(g.issues[0].originalRequestUtf8,raw);assert.ok(g.saved);
});
console.log(JSON.stringify({scope:'SYNTHETIC_RECORDING_PORT_HANDLER_ONLY',new_cases:cases.length,
  passed:cases.filter(value=>value.passed).length,failed:cases.filter(value=>!value.passed),
  actual_manager_auth:false,SQL:false,HTTP:false,native:false,route_mounted:false,effects:false}));
