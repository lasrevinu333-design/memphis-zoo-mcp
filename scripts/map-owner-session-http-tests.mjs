// Actual Express login/session/permission routes; provider and credential store are synthetic.
import assert from 'node:assert/strict';
import express from 'express';
import { installSharedAuthRoutes, makeOpsAccessMiddleware } from '../src/auth/shared-access-auth.js';
import { installOwnerAccessRoutes } from '../src/owner-access-api.js';

const env={NODE_ENV:'production',OPS_MANAGER_AUTH_REQUIRED:'true',OPS_MANAGER_SESSION_SECRET:'synthetic-map-http-session-secret-20261006',MEMPHIS_MAP_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'};
const people=[
 ['eoperle@memphiszoo.org','eric_custodial_manager'],
 ['jsheffield@memphiszoo.org','jennifer_sheffield_director_operations'],
 ['afeist@memphiszoo.org','annie_feist_operations_admin'],
 ['bgull@memphiszoo.org','brandy_gull_horticulture_manager'],
 ['hlejman@memphiszoo.org','haley_lejman_water_quality_manager'],
 ['emckenney@memphiszoo.org','eric_mckenney_facilities_maintenance_manager'],
].map(([email,key],i)=>({email,system_key:key,manager_id:`91000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,display_name:'Synthetic person '+i,roles:['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN'],active:true,is_system_principal:false,revoked_at:null}));
const credentials=new Map(),events=[],results=[],rpcCalls=[];
let selected=people[0],providerValid=true;
const store={
 async getManagerBySystemKey(key){return people.find(p=>p.system_key===key)||null;},
 async enroll(row){credentials.set(row.credential_id,structuredClone(row));return row;},
 async find(id){const row=credentials.get(id);return row?{...row,manager:people.find(p=>p.manager_id===row.manager_id)||null}:null;},
 async touch(){},async audit(event){events.push(event);},
 async revoke(id,reason){const row=credentials.get(id);if(row){row.revoked_at=new Date().toISOString();row.revoked_reason=reason;}return row;},
};
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(String(url)==='https://dwzdqekusvivjbxsapdu.supabase.co/auth/v1/user'){
  assert.equal(options.headers.apikey,env.MEMPHIS_MAP_SUPABASE_PUBLISHABLE_KEY);
  assert.equal(options.headers.authorization,'Bearer fixture-provider-token');
  assert.equal(options.redirect,'error');assert.ok(options.signal);
  return {ok:providerValid,json:async()=>providerValid?{id:selected.manager_id,email:selected.email,email_confirmed_at:'2026-01-01T00:00:00Z'}:{}};
 }
 if(!String(url).startsWith('http://127.0.0.1:'))throw new Error('Unexpected external test request');
 return realFetch(url,options);
};
const app=express();app.use(express.json());
installSharedAuthRoutes(app,{env,trustedDeviceStore:store,setCors(){}});
app.get('/test/owner-write',makeOpsAccessMiddleware({env,trustedDeviceStore:store,requireWrite:true}),(_req,res)=>res.json({ok:true}));
installOwnerAccessRoutes(app,{env,store,backendSecret:()=> 'fixture-proof',runRpc:async(name,args)=>{
 rpcCalls.push({name,args});return {fixture:true};
}});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`;
async function request(path,{method='GET',token='',cookie='',body}={}){
 const response=await fetch(base+path,{method,redirect:'manual',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json',origin:'https://lasrevinu333-design.github.io','X-Device-Id':'fixture-browser',...(token?{authorization:'Bearer '+token}:{}),...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const payload=await response.json();return {response,payload};
}
function pass(name){results.push({name,pass:true});}
try{
 const config=await request('/auth-api/map-config');assert.equal(config.response.status,200);assert.equal(config.payload.data.publishable_key,env.MEMPHIS_MAP_SUPABASE_PUBLISHABLE_KEY);pass('public Map configuration contains only a publishable key');
 for(const [index,person] of people.entries()){
  selected=person;
  const login=await request('/auth-api/map-session',{method:'POST',body:{access_token:'fixture-provider-token',access_level:'full_access',permissions:{owner:true}}});
  assert.equal(login.response.status,200,JSON.stringify(login.payload));
  const session=login.payload.data.session;const owner=index===0;
  assert.equal(session.permissions.owner,owner);assert.equal(session.read_only,!owner);assert.equal(session.manager_id,person.manager_id);pass(person.system_key+' correct Map authority');
  const cookies=login.response.headers.getSetCookie();assert.equal(cookies.length,1);assert.match(cookies[0],/HttpOnly/);assert.match(cookies[0],/Secure/);assert.match(cookies[0],/Max-Age=43200/);
  const cookie=cookies[0].split(';')[0];const row=credentials.get(session.credential_id);
  assert.ok(Date.parse(row.expires_at)-Date.parse(row.created_at)<=43200000);pass(person.system_key+' bounded HttpOnly credential');
  const restored=await request('/auth-api/session?access_level=full_access',{cookie});assert.equal(restored.response.status,200,JSON.stringify(restored.payload));assert.equal(restored.payload.data.session.permissions.owner,owner);assert.equal(restored.payload.data.session.read_only,!owner);pass(person.system_key+' next-page cookie sign-in');
  const write=await request('/test/owner-write',{token:session.token});assert.equal(write.response.status,owner?200:403);pass(person.system_key+' general write boundary');
  const capability=await request('/dashboard-api/ticket-capabilities?ids=92000000-0000-4000-8000-000000000001',{token:session.token});assert.equal(capability.response.status,200);assert.equal(rpcCalls.at(-1).name,'custodial_ticket_capabilities_v1');assert.equal(rpcCalls.at(-1).args.p_manager_id,person.manager_id);pass(person.system_key+' ticket eligibility binds current principal');
  const count=rpcCalls.length;
  const close=await request('/dashboard-api/close-ticket',{method:'POST',token:session.token,body:{ticket_id:'92000000-0000-4000-8000-000000000001',outcome:'mark_fixed'}});
  assert.equal(close.response.status,200);assert.equal(rpcCalls.length,count+1);assert.equal(rpcCalls.at(-1).name,'custodial_close_scan_ticket_outcome_v1');assert.equal(rpcCalls.at(-1).args.p_manager_id,person.manager_id);assert.equal(rpcCalls.at(-1).args.p_credential_id,session.credential_id);pass(person.system_key+' bounded ticket RPC receives actual actor');
  const forged=await request('/dashboard-api/close-ticket',{method:'POST',token:session.token,body:{ticket_id:'92000000-0000-4000-8000-000000000001',closed_by:'fake-owner'}});assert.equal(forged.response.status,422);assert.equal(rpcCalls.length,count+1);pass(person.system_key+' client closer denied');
  const coverage=await request('/admin-api/access/coverage',{method:'POST',token:session.token,body:{enabled:false,expected_revision:0}});assert.equal(coverage.response.status,owner?200:403);pass(person.system_key+' owner coverage-setting boundary');
  person.active=false;assert.equal((await request('/auth-api/session?access_level=full_access',{cookie})).response.status,403);person.active=true;pass(person.system_key+' current manager deactivation enforced');
  const logout=await request('/auth-api/ops/logout',{method:'POST',token:session.token,cookie,body:{}});assert.equal(logout.response.status,200);assert.ok(credentials.get(session.credential_id).revoked_at);pass(person.system_key+' logout revokes its credential');
  assert.equal((await request('/test/owner-write',{token:session.token})).response.status,401);pass(person.system_key+' revoked Map token denied');
 }
 providerValid=false;assert.equal((await request('/auth-api/map-session',{method:'POST',body:{access_token:'fixture-provider-token'}})).response.status,401);pass('invalid provider token denied');
 const anonymous=await request('/dashboard-api/close-ticket',{method:'POST',body:{ticket_id:'92000000-0000-4000-8000-000000000001',outcome:'mark_fixed'}});assert.equal(anonymous.response.status,401);pass('anonymous close denied');
 console.log(JSON.stringify({result:'MAP_OWNER_SESSION_HTTP_PASS',cases:results.length,results,scope:'Actual Express routes and existing cryptographic session/cookie implementation. Synthetic provider, credential store and RPC response; separate PostgreSQL test covers mutation policy; no production account/password/network.'},null,2));
}finally{globalThis.fetch=realFetch;server.closeAllConnections();await new Promise(r=>server.close(r));}
