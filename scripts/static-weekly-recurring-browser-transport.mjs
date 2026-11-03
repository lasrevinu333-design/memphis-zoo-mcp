import assert from 'node:assert/strict';

// This is a test-only Chromium transport for the existing authenticated
// HTTP-to-SQL fixture. The guarded caller owns the fresh browser context and
// its lease; this adapter owns only the one page and route it creates.
const CONFIRMATION_KEY=/^\/static-weekly\/recurring-adaptation\/confirmations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIXED_ROUTES=new Set(['/healthz','/static-weekly/recurring-adaptation/preview',
 '/static-weekly/recurring-adaptation/confirm']);

export function recurringBrowserLoopbackOrigin(value) {
 assert.equal(typeof value,'string','loopback origin must be a string');
 const parsed=new URL(value);
 assert.equal(parsed.protocol,'http:','browser SQL fixture requires HTTP loopback');
 assert.equal(parsed.hostname,'127.0.0.1','browser SQL fixture requires numeric loopback');
 assert.match(parsed.port,/^[1-9]\d{0,4}$/,'browser SQL fixture requires an explicit port');
 assert.ok(Number(parsed.port)<=65535,'browser SQL fixture port range');
 assert.equal(parsed.username+parsed.password+parsed.pathname+parsed.search+parsed.hash,'/',
  'browser SQL fixture accepts a bare loopback origin only');
 assert.equal(value,parsed.origin,'browser SQL fixture origin must be canonical');
 return parsed.origin;
}

export function recurringBrowserRouteAllowed(origin,route) {
 if(typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')||route.includes('\\')||route.includes('#'))return false;
 let parsed;
 try{parsed=new URL(route,origin);}catch{return false;}
 if(parsed.origin!==origin||parsed.pathname!==route.split('?')[0])return false;
 if(FIXED_ROUTES.has(parsed.pathname))return !parsed.search;
 if(CONFIRMATION_KEY.test(parsed.pathname))return !parsed.search;
 if(parsed.pathname==='/static-weekly/recurring-adaptation/delivery')
  return /^\?service_date=\d{4}-\d{2}-\d{2}$/.test(parsed.search);
 return false;
}

export async function createRecurringBrowserTransport({context,origin}) {
 const pinned=recurringBrowserLoopbackOrigin(origin);
 assert.equal(typeof context?.newPage,'function','guarded fresh Chromium context required');
 assert.equal(typeof context.pages,'function','guarded context page inventory required');
 assert.equal(context.browser?.()?.browserType?.().name?.(),'chromium',
  'browser SQL fixture requires actual guarded Chromium');
 assert.deepEqual(context.pages(),[],'browser SQL fixture requires a fresh empty context');
 let page=null,installed=false,closed=false;
 const routeHandler=async route=>{
  const requestUrl=route.request().url();
  let target;
  try{target=new URL(requestUrl);}catch{return route.abort('blockedbyclient');}
  const relative=target.href.slice(pinned.length);
  if(target.origin!==pinned||!recurringBrowserRouteAllowed(pinned,relative))return route.abort('blockedbyclient');
  return route.continue();
 };
 const close=async()=>{
  if(closed)return;
  closed=true;
  if(!page)return;
  try{if(installed)await page.unroute('**/*',routeHandler);}
  finally{await page.close();}
 };
 try{
  page=await context.newPage();
  assert.equal(page.url(),'about:blank','browser SQL fixture must create its own blank page');
  await page.route('**/*',routeHandler);installed=true;
  const readiness=await page.goto(`${pinned}/healthz`,{waitUntil:'domcontentloaded'});
  assert.equal(readiness?.status(),200,'browser SQL fixture loopback health');
  assert.equal(new URL(page.url()).origin,pinned,'browser SQL fixture page origin');
  return {request:async({origin:requestedOrigin,method,route,body,authorization})=>{
   assert.equal(requestedOrigin,pinned,'browser SQL request changed its pinned origin');
   assert.ok(recurringBrowserRouteAllowed(pinned,route),'browser SQL request changed its allowed route');
   assert.ok(method==='GET'||method==='POST','browser SQL request method');
   assert.ok(method!=='GET'||body===undefined,'browser SQL GET has no body');
   assert.ok(authorization===null||typeof authorization==='string','browser SQL synthetic bearer shape');
   assert.equal(new URL(page.url()).origin,pinned,'browser SQL request left pinned page origin');
   // This function is serialized into Chromium. It deliberately uses the
   // browser's fetch, not Node's Undici, and does not persist the test token.
   return page.evaluate(async input=>{
    const headers={...(input.authorization?{Authorization:`Bearer ${input.authorization}`}:{ }),
     ...(input.body===undefined?{}:{'Content-Type':'application/json'})};
    const response=await fetch(input.origin+input.route,{method:input.method,cache:'no-store',
     redirect:'error',headers,...(input.body===undefined?{}:{body:JSON.stringify(input.body)})});
    return {status:response.status,body:await response.json()};
   },{origin:pinned,method,route,body,authorization});
  },close};
 }catch(error){
  try{await close();}catch{}
  throw error;
 }
}

// Callable only inside a root-owned, lease-guarded SQL fixture invocation.
// This does not create a browser, a database, a container, or a second writer.
export async function runRecurringBrowserTransportSqlFixture({context,pool,week,originalManagerId,check}) {
 const {testRecurringConfirmationHttp}=await import('./static-weekly-recurring-confirmation-http-integration.mjs');
 return testRecurringConfirmationHttp({pool,week,originalManagerId,check,
  requestAdapterFactory:({origin})=>createRecurringBrowserTransport({context,origin})});
}
