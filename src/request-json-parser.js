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
  return (req, res, next) => {
    if (dedicatedPath.test(req.path)) return next();
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
    if (req.method === 'POST' && legacyPath.test(req.path)) return legacyParser(req, res, next);
    return parser(req, res, next);
  };
}
