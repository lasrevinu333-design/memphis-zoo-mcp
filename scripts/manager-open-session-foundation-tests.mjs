import assert from 'node:assert/strict';
import {
  authenticateOpsAccessRequest,
  createPublicOpsManagerSession,
  installSharedAuthRoutes,
  makeOpsAccessMiddleware,
  normalizeOpsAccessLevel,
} from '../src/auth/shared-access-auth.js';

const env={NODE_ENV:'production',OPS_MANAGER_SESSION_SECRET:'manager-open-test-secret',GEMINI_ADMIN_PASSWORD:'memzoo',GEMINI_ADMIN_SESSION_SECRET:'gemini-test-secret'};
assert.equal(normalizeOpsAccessLevel('read-only'),'read_only');
assert.equal(normalizeOpsAccessLevel('anything-else'),'full_access');
const ro=createPublicOpsManagerSession({deviceId:'manager-ro',accessLevel:'read_only',env,now:new Date('2026-07-15T12:00:00Z')});
assert.equal(ro.read_only,true);assert.equal(ro.auth_mode,'public_read_only_link');

const routes=new Map();
const app={use(){},get(path,handler){routes.set(`GET ${path}`,handler);},post(path,handler){routes.set(`POST ${path}`,handler);}};
installSharedAuthRoutes(app,{env,setCors(){}});
const handler=routes.get('GET /auth-api/session');
assert.equal(typeof handler,'function');

function request({query={},headers={}}={}){
  const lower=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v]));
  return {query,body:{},header(name){return lower[String(name).toLowerCase()]||'';}};
}
async function invoke(req){
  let statusCode=200,payload=null;
  const res={status(code){statusCode=code;return this;},json(value){payload=value;return this;}};
  await handler(req,res);
  return {statusCode,payload};
}
let result=await invoke(request({query:{access_level:'full_access'},headers:{'X-Device-Id':'manager-full'}}));
assert.equal(result.statusCode,200);assert.equal(result.payload.data.session.read_only,false);
const full=result.payload.data.session;
result=await invoke(request({query:{access_level:'read_only'},headers:{'X-Device-Id':'manager-ro'}}));
assert.equal(result.statusCode,200);assert.equal(result.payload.data.session.read_only,true);

const fullAuth=authenticateOpsAccessRequest(request({headers:{Authorization:`Bearer ${full.token}`}}),{env,now:new Date()});
assert.equal(fullAuth.ok,true);assert.equal(fullAuth.session.access_level,'full_access');

let nextCalled=false;
const writeGuard=makeOpsAccessMiddleware({env,requireWrite:true});
let writeStatus=200;
writeGuard(request({headers:{Authorization:`Bearer ${result.payload.data.session.token}`}}),{status(code){writeStatus=code;return this;},json(){return this;}},()=>{nextCalled=true;});
assert.equal(nextCalled,false);assert.equal(writeStatus,403);
console.log('MANAGER_OPEN_SESSION_FOUNDATION_PASS');
