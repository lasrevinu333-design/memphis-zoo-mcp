import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {nativeOriginalInventoryManifestChunkWire as originalWire,captureAuthenticatedNativeOriginalInventoryManifestChunk,
 inspectAuthenticatedNativeOriginalInventoryManifestChunk,closeAuthenticatedNativeOriginalInventoryManifestChunk} from './native-original-inventory-manifest-chunk.js';
import {nativeOriginalInventoryManifestChunkStatusWire,captureAuthenticatedNativeOriginalInventoryManifestChunkStatus,
 inspectAuthenticatedNativeOriginalInventoryManifestChunkStatus,closeAuthenticatedNativeOriginalInventoryManifestChunkStatus} from './native-original-inventory-manifest-chunk-status.js';
import {parseNativeProviderJson} from './native-provider-json.js';
import {recoveryInstantMicros,recoveryDeniedEffects} from './same-original-recovery-wire.js';

export const nativeOriginalInventoryManifestChunkRegistrationWire=Object.freeze({
 schema:'custodial.native-original-inventory-manifest-chunk-registration.v1',state:'CHUNK_RETAINED_NOT_ACK',
 rpc:'custodial_register_original_inventory_manifest_chunk_v1',
 digestVersion:'custodial.native-original-inventory-manifest-chunk-receipt.v1',
});
const R=nativeOriginalInventoryManifestChunkRegistrationWire,sha=v=>createHash('sha256').update(v).digest('hex');
const fields=['schema','state','inventory_native_request_id','manifest_sha256','manifest_chunk_index','chunk_sha256',
 'native_request_id','request_body_sha256','registered_at','receipt_sha256','limits'];
function fail(code='native_original_inventory_manifest_chunk_unknown',status=503){
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
    ||r.request_body_sha256!==parameters.p_native_request_body_sha256
    ||r.inventory_native_request_id!==body.inventory_native_request_id||r.manifest_sha256!==body.manifest_sha256
    ||r.manifest_chunk_index!==body.manifest_chunk_index||r.chunk_sha256!==body.chunk_sha256
    ||Object.keys(recoveryDeniedEffects).some(k=>r.limits[k]!==false))fail();
  const issued=parameters.p_native_request_timestamp.replace(/Z$/,'000Z'),registered=recoveryInstantMicros(r.registered_at),start=recoveryInstantMicros(issued);
  if(registered<start-30000000n||registered>start+120000000n)fail();
  const transcript=[R.digestVersion,r.inventory_native_request_id,r.manifest_sha256,r.manifest_chunk_index,
    r.chunk_sha256,r.native_request_id,r.request_body_sha256,r.registered_at].join('\n');
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

/** The fixed composition supplies the real private DB client, never a caller
 * inspector/SQL/body/role callback. This path retains one exact original manifest chunk;
 * even an exact registration receipt confers NONE of the six effect rights.
 * The SQL function must implement current transactional checks; absent/denied
 * SQL remains UNKNOWN. There is no fallback writer or automatic retry. */
export function installNativeOriginalInventoryManifestChunkRoute(app,input){return installFixedChunkRoute(app,input,false);}
export function installNativeOriginalInventoryManifestChunkStatusRoute(app,input){return installFixedChunkRoute(app,input,true);}
function originalStatusSql(parameters){
  const names=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation','p_separation',
    'p_authority_revision','p_native_request','p_native_request_timestamp','p_native_request_body_sha256','p_native_attestation_digest','p_original_request_utf8'];
  const kinds=['uuid','uuid','uuid','text','text','uuid','uuid','text','uuid','timestamptz','text','text','text'];
  if(Reflect.ownKeys(parameters).length!==names.length)fail();
  const args=names.map((key,i)=>{const original=value(parameters,key);if(typeof original!=='string')fail();
    return "'"+original.replaceAll("'","''")+"'::"+kinds[i];}).join(',');
  return 'select public.custodial_read_original_inventory_manifest_chunk_v1('+args+') as data';
}
function installFixedChunkRoute(app,input,status){
  const wire=status?nativeOriginalInventoryManifestChunkStatusWire:originalWire,
    captureRequest=status?captureAuthenticatedNativeOriginalInventoryManifestChunkStatus:captureAuthenticatedNativeOriginalInventoryManifestChunk,
    inspectRequest=status?inspectAuthenticatedNativeOriginalInventoryManifestChunkStatus:inspectAuthenticatedNativeOriginalInventoryManifestChunk,
    closeRequest=status?closeAuthenticatedNativeOriginalInventoryManifestChunkStatus:closeAuthenticatedNativeOriginalInventoryManifestChunk;
  const d=dependencies(input),use=method(app,'use',true),post=method(app,'post',true),attempted=new WeakSet();
  const send=(res,status,body)=>{if(!res.destroyed&&!res.headersSent&&!res.writableEnded)res.status(status).json(body);};
  const unknown=(res,status=503,code='native_original_inventory_manifest_chunk_unknown')=>send(res,status,
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
    function withdraw(status=503,code='native_original_inventory_manifest_chunk_unknown'){
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
      let writeInvoked=false;
      try{
        raw=Buffer.concat(parts);for(const p of parts)p.fill(0);parts.length=0;
        const declared=req.headers['content-length'];
        if(!raw.length||(declared!==undefined&&Number(declared)!==raw.length))fail('native_original_inventory_body_invalid',400);
        Object.defineProperty(req,'scanAuthorityRawBody',{value:raw,writable:true,enumerable:true,configurable:true});
        if(!live())fail();
        capture=await captureRequest(req,{env:d.env,store:d.store,
          runReadOnlySql:d.runReadOnlySql,now:d.now?d.now():new Date()});
        if(!live()||attempted.has(capture))fail();attempted.add(capture);
        const bound=inspectRequest(capture),parameters=bound.rpc_parameters;
        if(bound.transaction_authority!==false||status&&bound.write_authority!==false||!status&&method(d.db,'rpc')!==d.rpc)fail();
        let result;
        if(status){
          let rows;try{rows=await d.runReadOnlySql(originalStatusSql(parameters));}catch{fail();}
          if(types.isProxy(rows)||!Array.isArray(rows)||rows.length!==1)fail();
          const row=value(rows,'0');exact(row,['data']);result={data:value(row,'data'),error:null};
        }else{
          writeInvoked=true;
          try{result=await Reflect.apply(d.rpc,d.db,[R.rpc,parameters]);}catch{fail();}
        }
        if(!live()||!status&&method(d.db,'rpc')!==d.rpc)fail();
        // Exact same raw request/current input after possible commit. A late
        // changed/unknown result is retained as UNKNOWN, never a new RPC.
        const terminal=inspectRequest(capture);
        if(terminal.rpc_parameters.p_original_request_utf8!==parameters.p_original_request_utf8
          ||terminal.rpc_parameters.p_native_attestation_digest!==parameters.p_native_attestation_digest)fail();
        const observed=receipt(result,parameters);if(!live())fail();
        settled=true;send(res,200,{ok:true,data:observed});
      }catch(error){settled=true;unknown(res,writeInvoked?503:error?.status===400||error?.status===403?error.status:503,
        typeof error?.code==='string'&&error.code.startsWith('native_original_inventory_')?error.code:'native_original_inventory_manifest_chunk_unknown');}
      finally{active=false;cleanup();}
    }
    req.on('data',onData);req.once('end',onEnd);req.once('aborted',onAbort);req.once('close',onClose);req.once('error',onAbort);res.once('close',onResponseClose);
    timer=setTimeout(()=>withdraw(503,'native_original_inventory_request_deadline_unknown'),30000);timer.unref?.();
  }]);
  return Object.freeze({path:wire.path,maxRequestBytes:wire.maxRequestBytes,receiveDeadlineMs:30000});
}
