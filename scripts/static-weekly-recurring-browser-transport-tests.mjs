import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {recurringBrowserLoopbackOrigin,recurringBrowserRouteAllowed,createRecurringBrowserTransport,
 runRecurringBrowserTransportSqlFixture} from './static-weekly-recurring-browser-transport.mjs';

const origin='http://127.0.0.1:48123';
assert.equal(recurringBrowserLoopbackOrigin(origin),origin);
for(const bad of ['https://127.0.0.1:48123','http://localhost:48123','http://127.0.0.1',
 'http://127.0.0.1:48123/healthz','http://user:pass@127.0.0.1:48123','http://127.0.0.1:48123?x=1',
 'http://192.0.2.2:48123'])assert.throws(()=>recurringBrowserLoopbackOrigin(bad));
const uuid='30000000-0000-4000-8000-000000000273';
for(const path of ['/healthz','/static-weekly/recurring-adaptation/preview',
 '/static-weekly/recurring-adaptation/confirm',
 `/static-weekly/recurring-adaptation/confirmations/${uuid}`,
 '/static-weekly/recurring-adaptation/delivery?service_date=2026-10-05'])
 assert.equal(recurringBrowserRouteAllowed(origin,path),true,path);
for(const path of ['https://outside.invalid/healthz','//outside.invalid/healthz','/favicon.ico',
 '/static-weekly/recurring-adaptation/confirm?extra=1',
 '/static-weekly/recurring-adaptation/confirmations/not-a-key',
 '/static-weekly/recurring-adaptation/delivery?service_date=2026-10-05&extra=1',
 '/static-weekly/recurring-adaptation/%2e%2e/confirm','/healthz#fragment',
 '/healthz\\evil'])assert.equal(recurringBrowserRouteAllowed(origin,path),false,path);

let callback=null,pageClosed=0,unrouted=0,navigated='',observed=null;
const page={url:()=>navigated||'about:blank',
 async route(pattern,fn){assert.equal(pattern,'**/*');callback=fn;},
 async unroute(pattern,fn){assert.equal(pattern,'**/*');assert.equal(fn,callback);unrouted++;},
 async goto(url){assert.equal(url,origin+'/healthz');navigated=url;return{status:()=>200};},
 async evaluate(fn,input){
  return runInNewContext(`(${fn.toString()})(input)`,{input,
   fetch:async(url,options)=>{observed={url,options};return{status:200,json:async()=>({ok:true,data:{state:'NOT_FOUND'}})};}});
 },
 async close(){pageClosed++;}};
let newPages=0;
const context={pages:()=>[],browser:()=>({browserType:()=>({name:()=> 'chromium'})}),
 async newPage(){newPages++;return page;}};
const adapter=await createRecurringBrowserTransport({context,origin});
assert.equal(newPages,1);
let allowed=0,blocked=0;
await callback({request:()=>({url:()=>origin+'/healthz'}),continue:async()=>{allowed++;},abort:async()=>{blocked++;}});
await callback({request:()=>({url:()=> 'https://outside.invalid/private'}),continue:async()=>{allowed++;},abort:async()=>{blocked++;}});
await callback({request:()=>({url:()=>origin+'/favicon.ico'}),continue:async()=>{allowed++;},abort:async()=>{blocked++;}});
assert.deepEqual([allowed,blocked],[1,2]);
const body={confirmation_key:uuid,effective_start:'2026-10-05',expected_revision:4,preview_digest:'a'.repeat(64)};
const token='synthetic-test-token';
const result=await adapter.request({origin,method:'POST',route:'/static-weekly/recurring-adaptation/confirm',
 body,authorization:token});
assert.deepEqual(JSON.parse(JSON.stringify(result)),{status:200,body:{ok:true,data:{state:'NOT_FOUND'}}});
assert.equal(observed.url,origin+'/static-weekly/recurring-adaptation/confirm');
assert.deepEqual({...observed.options.headers},{Authorization:'Bearer '+token,'Content-Type':'application/json'});
assert.equal(observed.options.body,JSON.stringify(body));
assert.deepEqual([observed.options.method,observed.options.cache,observed.options.redirect],['POST','no-store','error']);
await adapter.request({origin,method:'GET',route:`/static-weekly/recurring-adaptation/confirmations/${uuid}`,
 body:undefined,authorization:null});
assert.deepEqual({...observed.options.headers},{});
assert.equal(Object.hasOwn(observed.options,'body'),false);
const browserFailure=new Error('synthetic browser transport failed');
const evaluateBefore=page.evaluate;
page.evaluate=async()=>{throw browserFailure;};
await assert.rejects(()=>adapter.request({origin,method:'GET',route:'/healthz',authorization:null}),
 error=>error===browserFailure);
page.evaluate=evaluateBefore;
await assert.rejects(()=>adapter.request({origin:'http://127.0.0.1:48124',method:'GET',route:'/healthz'}));
await assert.rejects(()=>adapter.request({origin,method:'POST',route:'/favicon.ico',body:{},authorization:token}));
await assert.rejects(()=>adapter.request({origin,method:'GET',route:'/healthz',body:{},authorization:null}));
await adapter.close();await adapter.close();
assert.deepEqual([unrouted,pageClosed],[1,1]);
assert.equal(typeof runRecurringBrowserTransportSqlFixture,'function');
await assert.rejects(()=>createRecurringBrowserTransport({context:{...context,pages:()=>[page]},origin}));
await assert.rejects(()=>createRecurringBrowserTransport({context:{...context,browser:()=>({browserType:()=>({name:()=> 'firefox'})})},origin}));

let failedPageClosed=0;
const failedPage={...page,url:()=> 'about:blank',async goto(){return{status:()=>503};},async close(){failedPageClosed++;}};
await assert.rejects(()=>createRecurringBrowserTransport({context:{...context,newPage:async()=>failedPage},origin}));
assert.equal(failedPageClosed,1,'failed setup closes only its owned page');
const integration=readFileSync(new URL('./static-weekly-recurring-confirmation-http-integration.mjs',import.meta.url),'utf8');
assert.match(integration,/requestAdapterFactory=null/);
assert.match(integration,/requestAdapter=await requestAdapterFactory\(\{origin\}\)/);
assert.match(integration,/requestAdapter\.request\(\{origin,method,route,body,authorization\}\)/);
assert.match(integration,/response=await fetch\(origin\+route/,'existing Node request stays default');
assert.match(runRecurringBrowserTransportSqlFixture.toString(),/requestAdapterFactory:\(\{origin\}\)=>createRecurringBrowserTransport/);
console.log('PASS recurring browser transport pure route, request, runner export, and lifecycle contracts');
