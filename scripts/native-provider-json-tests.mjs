import assert from 'node:assert/strict';
import express from 'express';
import {createHash} from 'node:crypto';
import {parseNativeProviderJson} from '../src/native-provider-json.js';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
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
