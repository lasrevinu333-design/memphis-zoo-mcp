import express from 'express';
import {parseNativeProviderJson} from './native-provider-json.js';

// Shared production mount: scan authority and OAuth registration retain their
// existing dedicated parser/limit/error-order contracts.
export function createGeneralJsonMiddleware() {
  const parser = express.json({limit: '10mb'});
  const dedicatedPath = /^\/(?:scan-api\/rpc|oauth\/register)\/?$/i;
  // Express route parameters consume one path segment, with optional trailing
  // slash and case-insensitive routing by default. Preserve the ORIGINAL bytes
  // only for the two typed, fully attested native legacy POST endpoints.
  const legacyPath = /^\/custodial-device-auth\/assigned-activation-operations\/[^/]+\/(?:legacy-lineage-binding|native-legacy-result)\/?$/i;
  const legacyParser = express.json({
    limit: 2048,
    verify(req, _res, bytes) { req.scanAuthorityRawBody = Buffer.from(bytes); },
  });
  const nativeProviderPath=/^\/employee-notifications-api\/native-provider(?:\/|$)/i;
  const nativeProviderParser=express.raw({limit:65536,type:()=>true,inflate:false});
  const retainedEvidenceParser=express.raw({limit:393216,type:()=>true,inflate:false});
  // The edition selects parsing only, never credential/native admission. Keep
  // ordinary manager/guest metadata JSON (including floats) on its old parser.
  const messengerPath=/^\/messaging-api\/thread\/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/(?:message|read|delete)(?:\/original-outcome)?$/;
  const messengerCandidatePath=/^\/+messaging-api\/+thread\/+[^/]+\/+(?:message|read|delete)(?:\/|$)/i;
  const messengerParser=express.raw({limit:65536,type:()=>true,inflate:false});
  return (req, res, next) => {
    if (dedicatedPath.test(req.path)) return next();
    // This exact native custody route owns its bounded original-byte parser.
    // Case/trailing/query aliases are refused by that owning route, never
    // admitted as alternate signed URLs or general-parser/auth fallbacks.
    if(req.method==='POST'&&req.path==='/device-auth/private-custody')return next();
    if(req.method==='POST'&&req.path==='/device-auth/private-custody-current-read')return next();
    // These literal new-purpose handlers own original bytes and bounded
    // receive lifetimes. Classification grants no authentication or effects.
    if(req.method==='POST'&&[
      '/device-auth/same-original-recovery/target',
      '/device-auth/same-original-recovery/challenge',
      '/device-auth/same-original-recovery/challenge-status',
      '/device-auth/same-original-recovery/manager-preparation',
      '/device-auth/private-custody-original-completion-read',
      '/admin-api/device-security/same-original-recovery/approvals',
      '/admin-api/device-security/same-original-recovery/approvals/original-status',
    ].includes(req.path))return next();
    if(req.method==='POST'&&req.path==='/device-auth/separation-evidence'){
      res.setHeader('Cache-Control','no-store');
      if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')
        ||(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity'))
        return res.status(415).json({ok:false,code:'native_evidence_content_type_invalid'});
      return retainedEvidenceParser(req,res,error=>{
        if(error)return res.status(error.status===413?413:400).json({ok:false,code:'native_evidence_request_invalid'});
        try{req.scanAuthorityRawBody=Buffer.from(req.body);req.body=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(req.scanAuthorityRawBody));}
        catch{return res.status(400).json({ok:false,code:'native_evidence_request_invalid'});}
        return next();
      });
    }
    if(req.method==='POST'&&nativeProviderPath.test(req.path)){
      if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')
        ||(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity'))
        return res.status(415).json({ok:false,code:'native_provider_content_type_invalid'});
      return nativeProviderParser(req,res,error=>{
        if(error)return res.status(error.status===413?413:400).json({ok:false,code:'native_provider_json_invalid'});
        try{req.scanAuthorityRawBody=Buffer.from(req.body);req.body=parseNativeProviderJson(req.scanAuthorityRawBody);}
        catch{return res.status(400).json({ok:false,code:'native_provider_json_invalid'});}
        return next();
      });
    }
    const edition=req.headers['x-memphis-app-edition'];
    if(typeof edition==='string'&&edition.trim().toLowerCase()==='custodial'){
      // Decoding is classification only: NEVER replace signed URL/header/body
      // bytes. Catch aliases Express might otherwise route case-insensitively
      // or decode as parameters, rather than falling through to general JSON.
      let classifiedPath=req.path;
      try{classifiedPath=decodeURIComponent(req.path);}catch{/* Exact path below still refuses malformed parameters. */}
      if(messengerCandidatePath.test(req.path)||messengerCandidatePath.test(classifiedPath)){
        res.setHeader('Cache-Control','no-store');
        if(req.method!=='POST'||!messengerPath.test(req.path)||req.originalUrl!==req.path||req.url!==req.originalUrl)
          return res.status(400).json({ok:false,code:'native_messenger_request_invalid'});
        if(typeof req.headers['content-type']!=='string'
          ||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'])
          ||(req.headers['content-encoding']!==undefined&&req.headers['content-encoding']!=='identity'))
          return res.status(415).json({ok:false,code:'native_messenger_content_type_invalid'});
        return messengerParser(req,res,error=>{
          if(error)return res.status(error.status===413?413:400).json({ok:false,code:'native_messenger_json_invalid'});
          try{
            const original=Buffer.from(req.body),body=parseNativeProviderJson(original);
            req.scanAuthorityRawBody=original;req.body=body;
          }catch{return res.status(400).json({ok:false,code:'native_messenger_json_invalid'});}
          return next();
        });
      }
    }
    if (req.method === 'POST' && legacyPath.test(req.path)) return legacyParser(req, res, next);
    return parser(req, res, next);
  };
}
