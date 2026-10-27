import assert from 'node:assert/strict';
import express from 'express';
import {createHash} from 'node:crypto';
import {parseNativeProviderJson} from '../src/native-provider-json.js';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
import {Readable} from 'node:stream';
async function messengerOriginalParserCases(){
 const parser=createGeneralJsonMiddleware(),id='77a00000-0000-4000-8000-000000000001';let checks=0;
 const check=(name,fn)=>{fn();checks++;console.log('MESSENGER_PARSER_CASE',name);};
 // Exercise actual production Express raw/json middleware from ORIGINAL input
 // streams. Never populate scanAuthorityRawBody or replace the strict parser.
 // This is an in-process HTTP-stream fixture, not real auth/HMAC/socket proof.
 async function invoke(url,body,{method='POST',headers={},chunked=false}={}){
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(body);
  const req=Readable.from([bytes.subarray(0,3),bytes.subarray(3)]);
  req.method=method;req.url=url;req.originalUrl=url;
  req.headers={'content-type':'application/json','x-memphis-app-edition':'custodial',
   ...(chunked?{'transfer-encoding':'chunked'}:{'content-length':String(bytes.length)}),...headers};
  Object.defineProperty(req,'path',{get(){return Reflect.get(express.request,'path',req);}});
  const responseHeaders={};
  return new Promise((resolve,reject)=>{
   let settled=false;const timer=setTimeout(()=>finish(new Error('owning parser did not settle')),5000);
   function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);req.destroy();if(error)reject(error);else resolve(value);}
   const res={statusCode:200,setHeader(k,v){responseHeaders[k]=v;},status(n){this.statusCode=n;return this;},
    json(value){finish(null,{req,status:this.statusCode,value,responseHeaders,next:false});return this;}};
   req.on('error',error=>finish(error));
   try{parser(req,res,error=>finish(error,error?undefined:{req,status:200,next:true,responseHeaders}));}catch(error){finish(error);}
  });
 }
 const raw=' { "device_id": "KIOSK_02", "body": "Español \\uD83D\\uDC18", "metadata_json": {}, "message_type": "text", "expected_assignment_epoch": "53" }\n';
 const paths=['message','read','delete'].flatMap(action=>['','/original-outcome'].map(tail=>'/messaging-api/thread/'+id+'/'+action+tail));
 for(const path of paths){const r=await invoke(path,raw);check('original byte retention '+path,()=>{
  assert.equal(r.next,true);assert.equal(r.status,200);assert.ok(Buffer.isBuffer(r.req.scanAuthorityRawBody));
  assert.deepEqual(r.req.scanAuthorityRawBody,Buffer.from(raw));assert.deepEqual(r.req.body,JSON.parse(raw));
  assert.equal(createHash('sha256').update(r.req.scanAuthorityRawBody).digest('hex'),createHash('sha256').update(raw).digest('hex'));
  assert.equal(r.req.method,'POST');assert.equal(r.req.url,path);assert.equal(r.req.originalUrl,path);
  for(const key of ['memphisDeviceAuth','memphisDevice','memphisDeviceCredential','memphisAuth','acknowledged','finalizer_allowed','key_removal'])assert.equal(r.req[key],undefined);
 });}
 const chunked=await invoke(paths[0],raw,{chunked:true});check('chunked input same exact original bytes',()=>assert.deepEqual(chunked.req.scanAuthorityRawBody,Buffer.from(raw)));
 for(const [name,bad] of Object.entries({duplicate:'{"body":"one","body":"two"}',escapedDuplicate:'{"a":1,"\\u0061":2}',nestedDuplicate:'{"metadata_json":{"n":1,"n":2}}',
  decimal:'{"metadata_json":{"n":1.5}}',exponent:'{"n":1e0}',negativeZero:'{"n":-0}',unsafeInteger:'{"n":9007199254740992}',
  trailing:'{} {}',arrayRoot:'[]',scalarRoot:'true',BOM:'\ufeff{}',loneSurrogate:'{"a":"\\ud800"}',empty:'',
  depth:'{"a":'.repeat(25)+'null'+'}'.repeat(25),invalidUtf8:Buffer.from([123,34,97,34,58,34,0xff,34,125])})){
  const r=await invoke(paths[0],bad);check('strict refusal '+name,()=>{assert.equal(r.status,400);assert.equal(r.next,false);assert.equal(r.value.code,'native_messenger_json_invalid');});
 }
 for(const headers of [{'content-type':'text/plain'},{'content-type':'application/json; charset=latin1'},
  {'content-type':'application/json; charset=utf-16le'},{'content-encoding':'gzip'},{'content-encoding':'deflate'},{'content-encoding':'identity, gzip'}]){
  const r=await invoke(paths[0],'{}',{headers});check('type/encoding refusal '+JSON.stringify(headers),()=>{assert.equal(r.status,415);assert.equal(r.next,false);});
 }
 const tooBig=await invoke(paths[0],'{"body":"'+'x'.repeat(65536)+'"}');check('original bytes resource bound',()=>{assert.equal(tooBig.status,413);assert.equal(tooBig.next,false);});
 const aliases=[paths[0]+'/',paths[0]+'?x=1',paths[0]+'?',paths[0]+'/extra',paths[1]+'/',paths[1].replace('original-outcome','Original-Outcome'),
  paths[0].replace('/messaging-api/','/MESSAGING-API/'),paths[0].replace(id,id.toUpperCase()),paths[0].replace(id,'not-a-uuid'),
  paths[0].replace(id,'%37'+id.slice(1)),paths[0].replace('/message','/%6dessage'),paths[0].replace('/messaging-api/','/messaging%2Dapi/'),
  '/'+paths[0],paths[0].replace(id,'%FF'),paths[0].replace(id,'%ZZ'),'http://localhost'+paths[0]];
 for(const path of aliases){const r=await invoke(path,'{}');check('native alias cannot fall back '+path,()=>{assert.equal(r.status,400);assert.equal(r.next,false);assert.equal(r.value.code,'native_messenger_request_invalid');});}
 for(const method of ['GET','PUT','DELETE']){const r=await invoke(paths[0],'{}',{method});check('signed original verb '+method,()=>{assert.equal(r.status,400);assert.equal(r.next,false);});}
 for(const edition of ['manager','guest'])for(const path of paths){const r=await invoke(path,'{"metadata_json":{"decimal":1.5,"exponent":1e2},"n":1,"n":2}',{headers:{'x-memphis-app-edition':edition}});
  check('unchanged ordinary '+edition+' '+path,()=>{assert.equal(r.next,true);assert.deepEqual(r.req.body,{metadata_json:{decimal:1.5,exponent:100},n:2});assert.equal(r.req.scanAuthorityRawBody,undefined);});}
 const ordinary=await invoke(paths[0],'{"n":1.5}',{headers:{'x-memphis-app-edition':undefined}});
 check('missing edition keeps ordinary parser',()=>{assert.equal(ordinary.next,true);assert.deepEqual(ordinary.req.body,{n:1.5});assert.equal(ordinary.req.scanAuthorityRawBody,undefined);});
 const outside=await invoke('/unrelated-json','{"n":1.5,"n":2.5}');check('unrelated custodial route unchanged',()=>{assert.equal(outside.next,true);assert.deepEqual(outside.req.body,{n:2.5});assert.equal(outside.req.scanAuthorityRawBody,undefined);});
 console.log(JSON.stringify({status:'PASS',checks,actualProductionMiddleware:true,originalStreamInput:true,synthetic:true,actualHTTP:false,authOrHmac:false,SQL:false,production:false}));
}
if(process.argv.includes('--messenger-original-parser-only')){
 await messengerOriginalParserCases();
}else{
let checks=0;
const pass=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const refuse=(name,value)=>pass(name,()=>assert.throws(()=>parseNativeProviderJson(Buffer.isBuffer(value)?value:Buffer.from(value)),/native_provider_json_invalid/));
for(const [name,value] of Object.entries({duplicate:'{"a":1,"a":2}',escapedDuplicate:'{"a":1,"\\u0061":2}',nestedDuplicate:'{"a":{"x":true,"x":false}}',
 decimal:'{"n":1.0}',exponent:'{"n":1e0}',negativeZero:'{"n":-0}',leadingZero:'{"n":01}',unsafeInteger:'{"n":9007199254740992}',
 trailing:'{} true',trailingComma:'{"a":1,}',arrayRoot:'[]',scalarRoot:'true',comment:'{/*x*/"a":1}',singleQuote:"{'a':1}",
 loneHigh:'{"a":"\\ud800"}',loneLow:'{"a":"\\udc00"}',incompleteEscape:'{"a":"\\',depth:'{"a":'.repeat(25)+'null'+'}'.repeat(25),
 excessiveValues:'{"a":['+'null,'.repeat(2048)+'null]}',BOM:'\ufeff{}'}))refuse(name,value);
refuse('invalid original UTF8',Buffer.from([123,34,97,34,58,34,0xff,34,125]));refuse('oversize',Buffer.from('{"a":"'+'x'.repeat(65536)+'"}'));
pass('Unicode null boolean and exact safe integer preserved',()=>assert.deepEqual(parseNativeProviderJson(Buffer.from('{"a":"Español 🐘","b":null,"c":false,"d":9007199254740991,"e":0,"f":-1}')),{a:'Español 🐘',b:null,c:false,d:9007199254740991,e:0,f:-1}));
pass('literal prototype field is data not prototype mutation',()=>{const v=parseNativeProviderJson(Buffer.from('{"__proto__":{"x":true}}'));assert.equal(Object.getPrototypeOf(v),Object.prototype);assert.equal({}.x,undefined);assert.deepEqual(v.__proto__,{x:true});});
const app=express();app.use(createGeneralJsonMiddleware());
for(const suffix of ['register','status','events','inventory'])app.post('/employee-notifications-api/native-provider/'+suffix,(req,res)=>res.json({body:req.body,raw:Buffer.isBuffer(req.scanAuthorityRawBody),sha256:createHash('sha256').update(req.scanAuthorityRawBody).digest('hex')}));
app.post('/unrelated-json',(req,res)=>res.json({body:req.body,raw:Buffer.isBuffer(req.scanAuthorityRawBody)}));
app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:'synthetic_error'}));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
console.log('OWNED_HTTP_SERVER',server.address().port,'cleanup=server.close in finally');
const origin='http://127.0.0.1:'+server.address().port;
async function send(path,body,headers={'content-type':'application/json'}){return fetch(origin+path,{method:'POST',body,headers,signal:AbortSignal.timeout(5000)});}
try{
 const raw=' { "schema": "synthetic", "n": 53, "unicode": "Español 🐘" }\n',expected=JSON.parse(raw);
 for(const suffix of ['register','status','events','inventory']){
  const p='/employee-notifications-api/native-provider/'+suffix,r=await send(p,raw),b=await r.json();
  pass('actual shared parser preserves exact '+suffix+' raw bytes',()=>{assert.equal(r.status,200);assert.deepEqual(b.body,expected);assert.equal(b.raw,true);assert.equal(b.sha256,createHash('sha256').update(raw).digest('hex'));});
  for(const bad of ['{"a":1,"a":2}','{"n":1.0}',Buffer.from([123,34,97,34,58,34,0xff,34,125])]){
   const invalid=await send(p,bad);await invalid.text();pass(suffix+' malformed body rejected before handler',()=>assert.equal(invalid.status,400));
  }
 }
 for(const headers of [{'content-type':'text/plain'},{'content-type':'application/json; charset=latin1'},{'content-type':'application/json','content-encoding':'gzip'}]){
  const r=await send('/employee-notifications-api/native-provider/register','{}',headers);await r.text();pass('unsupported type/encoding fails closed',()=>assert.equal(r.status,415));
 }
 const tooBig=await send('/employee-notifications-api/native-provider/register','{"a":"'+'x'.repeat(65536)+'"}');await tooBig.text();pass('actual socket cap65536',()=>assert.equal(tooBig.status,413));
 const unrelated=await send('/unrelated-json','{"n":1.5,"n":2.5}'),outside=await unrelated.json();
 pass('unrelated existing JSON semantics unchanged',()=>assert.deepEqual(outside,{body:{n:2.5},raw:false}));
 console.log(JSON.stringify({status:'PASS',checks,actualHTTP:true,synthetic:true,production:false,independentAudit:false,routeAuthorization:false}));
}finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));console.log('OWNED_HTTP_SERVER_CLOSED');}
}
