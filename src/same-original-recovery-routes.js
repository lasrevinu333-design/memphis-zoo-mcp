import {createManagerOriginalRecoveryApprovalHandlers,
  managerOriginalRecoveryApprovalPaths as paths} from './manager-original-recovery-approval.js';
import {decodeRecoveryApprovalRequest,recoveryDeniedEffects} from './same-original-recovery-wire.js';

const base='/admin-api/device-security/same-original-recovery';
const preview=/^\/admin-api\/device-security\/same-original-recovery\/challenges\/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const maxRequestBytes=8192,receiveDeadlineMs=30_000;
const contentType=/^application\/json(?:\s*;\s*charset=utf-8)?$/i;
function refuse(res,status,code){
  if(res.destroyed||res.headersSent||res.writableEnded)return;
  res.setHeader('Cache-Control','private, no-store');
  res.status(status).json({ok:false,outcome:'UNKNOWN',retry_safe:false,code,limits:recoveryDeniedEffects});
}

// Main installs on the top-level app BEFORE any generic parser. This owns only
// ingress bytes/lifetime, not provenance, CORS, authentication, SQL or native
// preparation authority. Private ports are consumed by the actual handler.
export function installSameOriginalRecoveryRoutes(app,privatePorts){
  if(typeof app?.use!=='function'||typeof app?.get!=='function'||typeof app?.post!=='function')
    throw new TypeError('same_original_recovery_app_required');
  const handlers=createManagerOriginalRecoveryApprovalHandlers(privatePorts);
  app.use((req,res,next)=>{
    const url=req.originalUrl,path=req.path;let classified=typeof path==='string'?path:'';
    try{classified=decodeURIComponent(classified);}catch{/* Exact comparisons still reject. */}
    if(![path,classified].some(value=>typeof value==='string'
      &&(value.toLowerCase()===base||value.toLowerCase().startsWith(base+'/'))))return next();
    res.setHeader('Cache-Control','private, no-store');
    if(typeof url!=='string'||url!==path||req.url!==url
      ||(!preview.test(url)&&url!==paths.confirm&&url!==paths.originalStatus))
      return refuse(res,400,'same_original_recovery_exact_path_required');
    const isPreview=preview.test(url);
    if(req.method!==(isPreview?'GET':'POST'))return refuse(res,405,'same_original_recovery_method_invalid');
    const encoding=req.headers['content-encoding'];
    if(encoding!==undefined&&encoding!=='identity')return refuse(res,415,'same_original_recovery_encoding_invalid');
    if(isPreview){
      if(req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))
        return refuse(res,400,'same_original_recovery_preview_body_invalid');
    }else{
      if(typeof req.headers['content-type']!=='string'||!contentType.test(req.headers['content-type']))
        return refuse(res,415,'same_original_recovery_content_type_invalid');
      const declared=req.headers['content-length'];
      if(declared!==undefined&&(!/^[0-9]+$/.test(declared)||Number(declared)<1))
        return refuse(res,400,'same_original_recovery_body_invalid');
      if(declared!==undefined&&Number(declared)>maxRequestBytes)
        return refuse(res,413,'same_original_recovery_body_too_large');
    }
    next();
  });
  app.get(paths.preview,async(req,res)=>{
    try{await handlers.preview(req,res);}catch{refuse(res,503,'same_original_recovery_unknown');}
  });
  function receive(handler){return(req,res)=>{
    // Never treat an already-consumed/parsed body as the original HTTP bytes.
    if(req.readableEnded||req.body!==undefined||req.scanAuthorityRawBody!==undefined)
      return refuse(res,400,'same_original_recovery_parser_order_invalid');
    if(req.aborted)return refuse(res,400,'same_original_recovery_receive_aborted');
    let received=0,ended=false,settled=false,raw=null,timer;const parts=[];
    function clearParts(){for(const part of parts)part.fill(0);parts.length=0;received=0;}
    function stopReceive(){clearTimeout(timer);timer=undefined;req.off('data',onData);req.off('end',onEnd);}
    function cleanup(){
      stopReceive();req.off('aborted',onAbort);req.off('close',onClose);req.off('error',onError);res.off('close',onResponseClose);
      clearParts();if(raw){raw.fill(0);delete req.scanAuthorityRawBody;delete req.body;raw=null;}
    }
    function early(status,code,respond=true){
      if(settled||ended)return;settled=true;cleanup();
      if(respond&&!res.destroyed){res.setHeader('Connection','close');refuse(res,status,code);}
      else if(!res.destroyed&&!res.writableEnded)res.end();
    }
    function onData(chunk){
      if(settled||ended)return;
      if(!Buffer.isBuffer(chunk))return early(400,'same_original_recovery_body_invalid');
      received+=chunk.length;
      if(received>maxRequestBytes)return early(413,'same_original_recovery_body_too_large');
      if(chunk.length)parts.push(Buffer.from(chunk));
    }
    function onAbort(){if(!ended)early(400,'same_original_recovery_receive_aborted',false);}
    function onClose(){if(!ended)onAbort();}
    function onError(){if(!ended)early(400,'same_original_recovery_receive_aborted',false);}
    function onResponseClose(){
      // While the handler awaits a private port, leave original bytes alive
      // until it settles. Its own req/res currentness guards refuse promotion
      // or later dispatch on closure; there is no cancellation of SQL outcome.
      if(!ended)early(400,'same_original_recovery_receive_aborted',false);
    }
    async function onEnd(){
      if(settled||ended)return;
      stopReceive();raw=Buffer.concat(parts);clearParts();
      try{
        if(!raw.length)throw new TypeError('empty_original');
        req.body=decodeRecoveryApprovalRequest(raw);req.scanAuthorityRawBody=raw;
      }catch{
        raw.fill(0);raw=null;delete req.body;
        return early(400,'same_original_recovery_body_invalid');
      }
      ended=true;
      try{await handler(req,res);}catch{refuse(res,503,'same_original_recovery_unknown');}
      finally{settled=true;cleanup();}
    }
    timer=setTimeout(()=>early(408,'same_original_recovery_receive_timeout'),receiveDeadlineMs);timer.unref();
    req.on('data',onData);req.once('end',onEnd);req.once('aborted',onAbort);req.once('close',onClose);
    req.once('error',onError);res.once('close',onResponseClose);
  };}
  app.post(paths.confirm,receive(handlers.confirm));
  app.post(paths.originalStatus,receive(handlers.originalStatus));
  return Object.freeze({paths,maxRequestBytes,receiveDeadlineMs});
}
