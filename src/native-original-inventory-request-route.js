import {createHash} from 'node:crypto';
import {types,isDeepStrictEqual} from 'node:util';
import {nativeOriginalInventoryRequestWire as originalWire,decodeNativeOriginalInventoryRequest,captureAuthenticatedNativeOriginalInventoryRequest,
  inspectAuthenticatedNativeOriginalInventoryRequest,closeAuthenticatedNativeOriginalInventoryRequest} from './native-original-inventory-request.js';
import {nativeOriginalInventoryStatusWire,captureAuthenticatedNativeOriginalInventoryStatus,
 inspectAuthenticatedNativeOriginalInventoryStatus,closeAuthenticatedNativeOriginalInventoryStatus,
 nativeOriginalInventorySeparationApprovalStatusWire,captureAuthenticatedNativeOriginalInventorySeparationApprovalStatus,
 inspectAuthenticatedNativeOriginalInventorySeparationApprovalStatus,closeAuthenticatedNativeOriginalInventorySeparationApprovalStatus} from './native-original-inventory-status.js';
import {validateInventorySeparationReceipt} from './original-inventory-separation-wire.js';
import {parseNativeProviderJson} from './native-provider-json.js';
import {recoveryInstantMicros,recoveryDeniedEffects} from './same-original-recovery-wire.js';

export const nativeOriginalInventoryRegistrationWire=Object.freeze({
  schema:'custodial.native-original-inventory-request-registration.v1',state:'REGISTERED_REQUEST_ONLY_NOT_ACK',
  rpc:'custodial_register_native_original_inventory_request_v1',
  digestVersion:'custodial.native-original-inventory-request-registration-digest.v1',
});
const R=nativeOriginalInventoryRegistrationWire,sha=v=>createHash('sha256').update(v).digest('hex');
const fields=['schema','state','native_request_id','operation_id','original_generation_id','request_body_sha256',
  'intent_document_sha256','intent_disk_sha256','registered_at','receipt_sha256','limits'];
function fail(code='native_original_inventory_registration_unknown',status=503){
  throw Object.assign(new Error(code),{code,status,outcome:'UNKNOWN',retry_safe:false});
}
function value(object,name){
  if(!object||types.isProxy(object))fail();const d=Object.getOwnPropertyDescriptor(object,name);
  if(!d||!Object.hasOwn(d,'value'))fail();return d.value;
}
function method(object,name,expressApp=false){
  if(!object||(typeof object!=='object'&&!(expressApp&&typeof object==='function'))||types.isProxy(object))fail();
  for(let p=object;p;p=Object.getPrototypeOf(p)){
    if(types.isProxy(p))fail();const d=Object.getOwnPropertyDescriptor(p,name);
    if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail();return d.value;}
  }fail();
}
function exact(object,keys){
  if(!object||types.isProxy(object)||Object.getPrototypeOf(object)!==Object.prototype
    ||Reflect.ownKeys(object).length!==keys.length)fail();
  for(const k of Reflect.ownKeys(object))if(!keys.includes(k))fail();
}
function receipt(result,parameters){
  const error=value(result,'error');if(error){
    if(value(error,'code')==='42501')fail('native_original_inventory_current_authority_denied',403);fail();
  }
  const text=value(result,'data');
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>65536)fail();
  const bytes=Buffer.from(text,'utf8');let r,body;
  try{r=parseNativeProviderJson(bytes);body=parseNativeProviderJson(Buffer.from(parameters.p_original_request_utf8,'utf8'));}
  finally{bytes.fill(0);}
  exact(r,fields);exact(r.limits,Object.keys(recoveryDeniedEffects));
  if(r.schema!==R.schema||r.state!==R.state||r.native_request_id!==parameters.p_native_request
    ||r.operation_id!==parameters.p_operation||r.original_generation_id!==parameters.p_generation
    ||r.request_body_sha256!==parameters.p_native_request_body_sha256
    ||r.intent_document_sha256!==body.original_intent_document_sha256||r.intent_disk_sha256!==body.original_intent_disk_sha256
    ||Object.keys(recoveryDeniedEffects).some(k=>r.limits[k]!==false))fail();
  const issued=parameters.p_native_request_timestamp.replace(/Z$/,'000Z'),registered=recoveryInstantMicros(r.registered_at),start=recoveryInstantMicros(issued);
  if(registered<start-30000000n||registered>start+120000000n)fail();
  const transcript=[R.digestVersion,r.native_request_id,r.operation_id,r.original_generation_id,r.request_body_sha256,
    r.intent_document_sha256,r.intent_disk_sha256,r.registered_at].join('\n');
  if(r.receipt_sha256!==sha(transcript))fail();
  return Object.freeze({...r,limits:recoveryDeniedEffects});
}
function dependencies(input){
  if(!input||types.isProxy(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))fail();
  const required=['env','store','runReadOnlySql','db'],keys=Reflect.ownKeys(input);
  if(keys.some(k=>![...required,'now'].includes(k))||required.some(k=>!keys.includes(k)))fail();
  const d={};for(const k of keys)d[k]=value(input,k);
  if(!d.env||types.isProxy(d.env)||typeof d.runReadOnlySql!=='function'||types.isProxy(d.runReadOnlySql)
    ||(d.now!==undefined&&typeof d.now!=='function'))fail();
  method(d.store,'findCredential');return {...d,rpc:method(d.db,'rpc')};
}
function approvalReceipt(result,parameters,currentMicros){
 if(value(result,'error'))fail();const text=value(result,'data');
 if(typeof text!=='string'||!text.length||Buffer.byteLength(text,'utf8')>24576)fail();
 let bytes,original;
 try{
  bytes=Buffer.from(text,'utf8');
  const receipt=validateInventorySeparationReceipt(parseNativeProviderJson(bytes));
  original=Buffer.from(parameters.p_original_request_utf8,'utf8');
  const archived=decodeNativeOriginalInventoryRequest(original);
  if(receipt.original_request.native_request_id!==parameters.p_native_request
   ||!isDeepStrictEqual(receipt.original_target,archived.intent.original_target))fail();
  if(recoveryInstantMicros(receipt.approved_at)>currentMicros
   ||recoveryInstantMicros(receipt.expires_at)<=currentMicros)fail();
  // The wire binds the command's manager triple, manifest/registration pins,
  // revision and exact six limits. Its digests are shape-only here: the raw
  // original manager command is NOT present and must be checked by owning SQL.
  // This returned receipt remains server-reported DATA, not effect admission.
  return receipt;
 }catch{fail();}finally{bytes?.fill(0);original?.fill(0);}
}

/** The fixed composition supplies the real private DB client, never a caller
 * inspector/SQL/body/role callback. This path registers an original request;
 * even an exact registration receipt confers NONE of the six effect rights.
 * The SQL function must implement current transactional checks; absent/denied
 * SQL remains UNKNOWN. There is no fallback writer or automatic retry. */
const REGISTRATION=Object.freeze({}),STATUS=Object.freeze({}),APPROVAL_STATUS=Object.freeze({});
export function installNativeOriginalInventoryRequestRoute(app,input){return installFixedOriginalInventoryRoute(app,input,REGISTRATION);}
export function installNativeOriginalInventoryStatusRoute(app,input){return installFixedOriginalInventoryRoute(app,input,STATUS);}
export function installNativeOriginalInventorySeparationApprovalStatusRoute(app,input){return installFixedOriginalInventoryRoute(app,input,APPROVAL_STATUS);}
function statusSql(p,approval){
  const fields=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation','p_separation',
    'p_authority_revision','p_native_request','p_native_request_timestamp','p_native_request_body_sha256','p_native_attestation_digest','p_original_request_utf8'];
  const kinds=['uuid','uuid','uuid','text','text','uuid','uuid','text','uuid','timestamptz','text','text','text'];
  if(Reflect.ownKeys(p).length!==fields.length)fail();
  const argumentsSql=fields.map((key,i)=>{
    const v=value(p,key);if(typeof v!=='string')fail();
    return "'"+v.replaceAll("'","''")+"'::"+kinds[i];
  }).join(',');
  return (approval?'select public.custodial_read_native_original_inventory_separation_approval_v1(':
    'select public.custodial_read_native_original_inventory_request_v1(')+argumentsSql+') as data';
}
function installFixedOriginalInventoryRoute(app,input,mode){
  const status=mode!==REGISTRATION,approval=mode===APPROVAL_STATUS;
  const wire=approval?nativeOriginalInventorySeparationApprovalStatusWire:status?nativeOriginalInventoryStatusWire:originalWire;
  const captureRequest=approval?captureAuthenticatedNativeOriginalInventorySeparationApprovalStatus:
    status?captureAuthenticatedNativeOriginalInventoryStatus:captureAuthenticatedNativeOriginalInventoryRequest;
  const inspectRequest=approval?inspectAuthenticatedNativeOriginalInventorySeparationApprovalStatus:
    status?inspectAuthenticatedNativeOriginalInventoryStatus:inspectAuthenticatedNativeOriginalInventoryRequest;
  const closeRequest=approval?closeAuthenticatedNativeOriginalInventorySeparationApprovalStatus:
    status?closeAuthenticatedNativeOriginalInventoryStatus:closeAuthenticatedNativeOriginalInventoryRequest;
  const d=dependencies(input),use=method(app,'use',true),post=method(app,'post',true),attempted=new WeakSet();
  const send=(res,status,body)=>{if(!res.destroyed&&!res.headersSent&&!res.writableEnded)res.status(status).json(body);};
  const unknown=(res,status=503,code='native_original_inventory_registration_unknown')=>send(res,status,
    {ok:false,outcome:'UNKNOWN',retry_safe:false,code,limits:recoveryDeniedEffects});
  Reflect.apply(use,app,[(req,res,next)=>{
    let decoded=req.path;try{decoded=decodeURIComponent(decoded);}catch{}
    if(![req.path,decoded].some(p=>typeof p==='string'&&(p.toLowerCase()===wire.path||p.toLowerCase().startsWith(wire.path+'/'))))return next();
    res.setHeader('Cache-Control','private, no-store');
    if(req.originalUrl!==wire.path||req.url!==wire.path||req.path!==wire.path)return unknown(res,400,'native_original_inventory_exact_path_required');
    if(req.method!=='POST')return unknown(res,405,'native_original_inventory_method_invalid');
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')
      ||req.headers['content-encoding']!==undefined&&req.headers['content-encoding']!=='identity')
      return unknown(res,415,'native_original_inventory_content_type_invalid');
    const size=req.headers['content-length'];
    if(size!==undefined&&(!/^[0-9]+$/.test(size)||Number(size)<1))return unknown(res,400,'native_original_inventory_body_invalid');
    if(size!==undefined&&Number(size)>wire.maxRequestBytes)return unknown(res,413,'native_original_inventory_body_too_large');
    next();
  }]);
  Reflect.apply(post,app,[wire.path,(req,res)=>{
    if(req.readableEnded||Object.hasOwn(req,'body')||Object.hasOwn(req,'scanAuthorityRawBody'))
      return unknown(res,400,'native_original_inventory_parser_order_invalid');
    let ended=false,active=false,withdrawn=false,settled=false,size=0,raw=null,capture=null,timer;
    const parts=[];
    const live=()=>!withdrawn&&!req.aborted&&!res.destroyed&&!res.writableEnded;
    const stop=()=>{req.off('data',onData);req.off('end',onEnd);};
    function cleanup(){
      clearTimeout(timer);stop();req.off('aborted',onAbort);req.off('close',onClose);req.off('error',onAbort);res.off('close',onResponseClose);
      for(const p of parts)p.fill(0);parts.length=0;
      closeRequest(capture);capture=null;
      const slot=Object.getOwnPropertyDescriptor(req,'scanAuthorityRawBody');
      if(slot&&Object.hasOwn(slot,'value')&&slot.value===raw&&slot.configurable)delete req.scanAuthorityRawBody;
      raw?.fill(0);raw=null;
    }
    function withdraw(status=503,code='native_original_inventory_registration_unknown'){
      if(settled)return;withdrawn=true;stop();unknown(res,status,code);
      // A request timeout/disconnect cannot cancel or compensate a transaction
      // already in flight. Its original owner is retained until it settles.
      if(!active){settled=true;cleanup();}
    }
    function onAbort(){withdraw(400,'native_original_inventory_receive_aborted');}
    function onClose(){if(!ended)onAbort();}
    function onResponseClose(){if(!settled)withdraw();}
    function onData(chunk){
      if(ended||withdrawn)return;
      if(types.isProxy(chunk)||!Buffer.isBuffer(chunk)||Object.getPrototypeOf(chunk)!==Buffer.prototype)return withdraw(400,'native_original_inventory_body_invalid');
      size+=chunk.length;if(size>wire.maxRequestBytes)return withdraw(413,'native_original_inventory_body_too_large');
      parts.push(Buffer.from(chunk));
    }
    async function onEnd(){
      if(ended||withdrawn||settled)return;ended=true;active=true;stop();
      try{
        raw=Buffer.concat(parts);for(const p of parts)p.fill(0);parts.length=0;
        const declared=req.headers['content-length'];
        if(!raw.length||(declared!==undefined&&Number(declared)!==raw.length))fail('native_original_inventory_body_invalid',400);
        Object.defineProperty(req,'scanAuthorityRawBody',{value:raw,writable:true,enumerable:true,configurable:true});
        if(!live())fail();
        const captureNow=d.now?d.now():new Date(),approvalStarted=process.hrtime.bigint();
        const approvalBase=approval?Date.prototype.getTime.call(captureNow):null;
        if(approval&&!Number.isSafeInteger(approvalBase))fail();
        capture=await captureRequest(req,{env:d.env,store:d.store,
          runReadOnlySql:d.runReadOnlySql,now:captureNow});
        if(!live()||attempted.has(capture))fail();attempted.add(capture);
        const bound=inspectRequest(capture),parameters=bound.rpc_parameters;
        if(bound.transaction_authority!==false||status&&bound.write_authority!==false||!status&&method(d.db,'rpc')!==d.rpc)fail();
        let result;
        if(status){
          // Fixed READ ONLY port, never the registration writer or caller SQL.
          // Missing status stays UNKNOWN; it is not proof a resend is safe.
          let rows;try{rows=await d.runReadOnlySql(statusSql(parameters,approval));}catch{fail();}
          if(types.isProxy(rows)||!Array.isArray(rows)||rows.length!==1)fail();
          const row=value(rows,'0');exact(row,['data']);result={error:null,data:value(row,'data')};
        }else{
          try{result=await Reflect.apply(d.rpc,d.db,[R.rpc,parameters]);}catch{fail();}
        }
        if(!live()||!status&&method(d.db,'rpc')!==d.rpc)fail();
        // Exact same raw request/current input after possible commit. A late
        // changed/unknown result is retained as UNKNOWN, never a new RPC.
        const terminal=inspectRequest(capture);
        if(terminal.rpc_parameters.p_original_request_utf8!==parameters.p_original_request_utf8
          ||terminal.rpc_parameters.p_native_attestation_digest!==parameters.p_native_attestation_digest)fail();
        // Same captured server clock, advanced only by elapsed monotonic time
        // through the awaited READ. Do not renew an original approval's dates.
        const observed=approval?approvalReceipt(result,parameters,recoveryInstantMicros(
          new Date(approvalBase+Number((process.hrtime.bigint()-approvalStarted)/1000000n)).toISOString().replace(/Z$/,'000Z'))):
          receipt(result,parameters);if(!live())fail();
        settled=true;send(res,200,{ok:true,data:observed});
      }catch(error){settled=true;unknown(res,error?.status===400||error?.status===403?error.status:503,
        typeof error?.code==='string'&&error.code.startsWith('native_original_inventory_')?error.code:'native_original_inventory_registration_unknown');}
      finally{active=false;cleanup();}
    }
    req.on('data',onData);req.once('end',onEnd);req.once('aborted',onAbort);req.once('close',onClose);req.once('error',onAbort);res.once('close',onResponseClose);
    timer=setTimeout(()=>withdraw(503,'native_original_inventory_request_deadline_unknown'),30000);timer.unref?.();
  }]);
  return Object.freeze({path:wire.path,maxRequestBytes:wire.maxRequestBytes,receiveDeadlineMs:30000});
}
