// Regression: the production general middleware must preserve each owning original-byte parser.
// Real loopback HTTP and current route composition; authentication/SQL ports are synthetic.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=process.argv[2];
const require=createRequire(root+'/package.json');
const express=require('express');
const {createGeneralJsonMiddleware,createGeneralUrlencodedMiddleware}=await import(pathToFileURL(root+'/src/request-json-parser.js'));
const {deferJsonParserErrors}=await import(pathToFileURL(root+'/src/offline-authority-http.js'));
const {readOriginalScanCompletion,SCAN_COMPLETION_READBACK_PATH}=await import(pathToFileURL(root+'/src/scan-completion-readback.js'));
const source=fs.readFileSync(root+'/src/index.js','utf8');
const start=source.indexOf('const MAX_SCAN_RPC_BYTES = '),end=source.indexOf('\nasync function rejectInvalidAuthenticatedScanAuthorityJson',start);
if(start<0||end<0)throw Error('Exact owning scan parser declaration missing');
const parserSource=source.slice(start,end);
const parseScan=new Function('express','deferJsonParserErrors',parserSource+'\nreturn parseScanAuthorityJsonBeforeAuthentication;')(express,deferJsonParserErrors);
const app=express();app.use(createGeneralJsonMiddleware());app.use(createGeneralUrlencodedMiddleware());
const ids={device:'11111111-1111-4111-8111-111111111111',employee:'22222222-2222-4222-8222-222222222222',credential:'33333333-3333-4333-8333-333333333333',request:'44444444-4444-4444-8444-444444444444'};
let authCalls=0,sqlCalls=0;
app.post(SCAN_COMPLETION_READBACK_PATH,parseScan,async(req,res)=>{
 const observed={rawCaptured:Buffer.isBuffer(req.scanAuthorityRawBody),raw:req.scanAuthorityRawBody?.toString('utf8'),deferredParseError:Boolean(req.scanAuthorityJsonError)};
 if(req.scanAuthorityJsonError)return res.status(400).json({observed,code:'scan_completion_request_invalid'});
 try{
  const data=await readOriginalScanCompletion({request:req,completionPayload:req.body?.completion_payload,
   revalidateCurrentRequest:async r=>{
    authCalls++;
    r.memphisNativeRequestAttestation={version:'custodial-native-request.v1',request_id:ids.request,method:'POST',path:SCAN_COMPLETION_READBACK_PATH,
     device_id:'KIOSK_02',credential_id:ids.credential,body_sha256:createHash('sha256').update(r.scanAuthorityRawBody).digest('hex'),signature:'a'.repeat(64)};
    return {ok:true,credentialed:true,device:{canonical_device_pk:ids.device,canonical_device_id:'KIOSK_02',device_active:true,employee_active:true,assigned_employee_id:ids.employee,assignment_epoch:7},
     credential:{credential_id:ids.credential,device_id:ids.device,confirmed_at:'2026-10-12T09:00:00Z',expires_at:'2027-10-12T09:00:00Z',revoked_at:null}};
   },runReadOnlySql:async()=>{sqlCalls++;throw Error('No database access permitted');}});
  res.json({data,observed});
 }catch(e){res.status(e.status||500).json({code:e.code||e.message,observed});}
});
app.post('/scan-api/rpc',parseScan,(req,res)=>res.json({rawCaptured:Buffer.isBuffer(req.scanAuthorityRawBody),raw:req.scanAuthorityRawBody?.toString('utf8'),deferredParseError:Boolean(req.scanAuthorityJsonError)}));
app.post('/feedback-api/probe',(req,res)=>res.json({body:req.body,rawCaptured:Buffer.isBuffer(req.scanAuthorityRawBody)}));
app.use((e,req,res,next)=>res.status(e.status||500).json({generalParserError:true,type:e.type}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port;
const cases=[];
async function run(name,path,body,expected,verify){
 const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body});const actual={status:response.status,body:await response.json()};
 cases.push({name,expected,actual,pass:verify(actual)});
}
try{
 const raw='{ "completion_payload" : {} }\n';
 await run('original-completion preserves exact original bytes through production middleware order',SCAN_COMPLETION_READBACK_PATH,raw,'200 with found:false for absent original and exact preserved bytes; synthetic current authentication boundary',a=>a.status===200&&a.body.data?.found===false&&a.body.observed?.raw===raw);
 await run('existing scan RPC control retains exact bytes','/scan-api/rpc','{ "fn":"fixture", "args":{} }\n','Existing dedicated scan RPC behavior unchanged',a=>a.status===200&&a.body.rawCaptured===true&&a.body.raw==='{ "fn":"fixture", "args":{} }\n');
 await run('original-completion malformed JSON reaches its owning deferred parser',SCAN_COMPLETION_READBACK_PATH,'{"completion_payload":','400 with dedicated deferred error; no general parser short circuit',a=>a.status===400&&a.body.observed?.deferredParseError===true);
 await run('unrelated general JSON route remains general','/feedback-api/probe','{"value":1.5}','200 parsed general object, no scan raw-buffer claim',a=>a.status===200&&a.body.body?.value===1.5&&a.body.rawCaptured===false);
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
const result={scope:'Actual Express general middleware and exact production scan parser declaration plus actual original-completion reader; current authentication return is explicitly synthetic. No database/provider/live server.',cases,passed:cases.filter(x=>x.pass).length,failed:cases.filter(x=>!x.pass).length,synthetic_auth_calls:authCalls,sql_calls:sqlCalls,server_closed:!server.listening};
if(out)fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exitCode=result.failed?1:0;
