// Main-owned central wiring. Disabled until explicit protected configuration;
// Main API has no enrollment DB grant: it proxies/reads the fixed control plane.
import express from 'express';
import {createHmac,createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {createCustodialLeadershipPinService,createCustodialLeadershipPinRouter,createPgCustodialLeadershipPinStore,CUSTODIAL_LEADERSHIP_COOKIE_NAMES} from '../custodial-leadership-pin.js';
import {createCustodialLeadershipOpsSession,verifyCustodialLeadershipOpsToken,assertOpsManagerSessionSecret} from './shared-access-auth.js';
import {isCustodialLeadershipManagementSession} from './manager-permissions.js';
const error=(code,status=403)=>Object.assign(new Error(code),{code,status});
const text=x=>typeof x==='string'?x.trim():'';
const enabled=env=>env?.CUSTODIAL_LEADERSHIP_PIN_ENABLED==='true';
const token=req=>text(req.get?.('Authorization')||req.headers?.authorization).replace(/^Bearer\s+/i,'');
const mutating=method=>!['GET','HEAD','OPTIONS'].includes(method);
const internal='/custodial-leadership-internal';
const SECURITY_COOKIE='__Host-custodial_leadership_security';
const hash=x=>createHash('sha256').update(x).digest('hex');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
export function custodialLeadershipOrigins(env={}) {
 return [...new Set(['https://lasrevinu333-design.github.io','https://memphis-zoo-mcp.onrender.com','https://localhost',
  ...text(env.CUSTODIAL_LEADERSHIP_ALLOWED_ORIGINS||env.STATIC_WEEKLY_CONTROL_PLANE_ALLOWED_ORIGINS||env.ALLOWED_CORS_ORIGINS).split(',').filter(Boolean).map(x=>x.trim())])]
  .filter(x=>/^https:\/\/[^/?#]+$/.test(x));
}
function requireOrigin(origin,env){if(!custodialLeadershipOrigins(env).includes(origin))throw error('custodial_origin_denied');}
function allowedPath(req){
 const p=String(req.originalUrl||req.url||'').split('?')[0];
 if((req.method==='GET'&&['/admin-api/health','/auth-api/gemini/session'].includes(p))
  ||(req.method==='POST'&&p==='/auth-api/gemini/login'))return true;
 if(/^\/analytics-api\/(cleaning-performance|inspection-coverage|inspections|session-facts|ticket-trends)(?:\/|$)/.test(p))return true;
 if(/^\/feedback-api\/(submit|original-receipt|image|acknowledge)(?:\/|$)/.test(p))return true;
 if(p==='/gemini-api'||p.startsWith('/gemini-api/'))return true;
 return ['/static-weekly','/custodial-admin-api','/admin-api/custodial','/admin-api/device-security','/admin-api/device-auth','/dashboard-api','/manager-notifications-api','/messaging-api','/schedule-api','/leadership-api/roster','/leadership-api/phone-assignments','/admin-api/places','/admin-api/access/coverage','/admin-api/close-ticket'].some(k=>p===k||p.startsWith(k+'/'));
}
function controlOrigin(env){
 const raw=text(env.STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL).replace(/\/$/,'');
 if(!raw)throw error('custodial_control_plane_unconfigured',503);const u=new URL(raw);
 if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||(u.protocol!=='https:'&&!(env.CUSTODIAL_LEADERSHIP_ALLOW_LOOPBACK_TEST==='true'&&u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname))))throw error('custodial_control_plane_origin_invalid',503);
 return u.origin;
}
async function boundedJson(response,max=65536){
 if(!response.body?.getReader)throw error('custodial_readback_unavailable',503);
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>max)throw error('custodial_readback_unavailable',503);chunks.push(Buffer.from(p.value));}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw error('custodial_readback_unavailable',503);}
}
async function fetchFixed(env,fetchImpl,path,init,signal,maxBytes=65536){
 const own=AbortSignal.timeout(5000);const response=await fetchImpl(controlOrigin(env)+path,{...init,redirect:'error',signal:signal?AbortSignal.any([signal,own]):own});
 return {response,body:await boundedJson(response,maxBytes)};
}
function sessionFromVerified(verified){
 const claims=verified.managerSession;
 return {...claims,custodial_security_epoch:verified.session.cohort.securityEpoch,
  claimed_manager_id:verified.session.claimedAccount.accountId,claimed_manager_display_name:verified.session.claimedAccount.displayName};
}
export function createCustodialLeadershipRemoteVerifier({env=process.env,fetchImpl=fetch}={}){
 return async({req,session,signal})=>{
  if(!enabled(env)||!allowedPath(req))return {ok:false,status:403,error:'Custodial management scope is unavailable.'};
  const origin=text(req.get?.('Origin')||req.headers?.origin);if(mutating(req.method)||origin)requireOrigin(origin,env);
  const {response,body}=await fetchFixed(env,fetchImpl,internal+'/verify',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},
   body:JSON.stringify({method:req.method,origin,csrfToken:text(req.get?.('X-CSRF-Token')||req.headers?.['x-csrf-token'])})},signal);
  if(!response.ok||body?.ok!==true||!isCustodialLeadershipManagementSession(body.session)
   ||body.session.manager_id!==session.manager_id||body.session.credential_id!==session.credential_id||body.session.device_id!==session.device_id)
   return {ok:false,status:403,error:'Custodial browser registration is no longer current.'};
  return {ok:true,session:{...body.session,token:session.token}};
 };
}

export function createCustodialLeadershipControlPlane({env=process.env,database,store=null}={}){
 if(!enabled(env))return {enabled:false,router:createCustodialLeadershipPinRouter(),verify:async()=>({ok:false,status:503,error:'Custodial leadership is disabled.'}),verifyTransaction:null};
 if(!store&&!database?.connect)throw error('custodial_private_database_unavailable',503);
 if(typeof env.CUSTODIAL_LEADERSHIP_PIN_PEPPER!=='string'||env.CUSTODIAL_LEADERSHIP_PIN_PEPPER===assertOpsManagerSessionSecret(env))throw error('custodial_independent_pepper_required',503);
 let outstanding=0;
 const query=async(sql,params)=>{
  if(outstanding>=4)throw error('custodial_enrollment_busy',503);outstanding++;let client;
  try{client=await database.connect();await client.query('begin');await client.query('set local role static_weekly_control_plane');
   await client.query("set local statement_timeout='5000ms'");await client.query("set local lock_timeout='5000ms'");
   const result=await client.query(sql,params);await client.query('commit');return result;
  }catch(e){if(client)await client.query('rollback').catch(()=>{});throw e;}finally{client?.release();outstanding--;}
 };
 const service=createCustodialLeadershipPinService({enabled:true,store:store||createPgCustodialLeadershipPinStore({query}),pepper:env.CUSTODIAL_LEADERSHIP_PIN_PEPPER,
  issueManagerSession:input=>createCustodialLeadershipOpsSession({...input,env}),verifyManagerSessionToken:raw=>verifyCustodialLeadershipOpsToken(raw,{env}),
  authorizedActionFlags:{manage_absences:true,manage_coverall:true,regenerate_routes:true}});
 const verify=async({req,session})=>{
  if(!allowedPath(req))return {ok:false,status:403,error:'Custodial management scope denied.'};
  const origin=text(req.get?.('Origin')||req.headers?.origin);if(mutating(req.method)||origin)requireOrigin(origin,env);
  const v=await service.authenticateManagerSessionToken({token:session.token,requireCsrf:mutating(req.method),csrf:text(req.get?.('X-CSRF-Token')||req.headers?.['x-csrf-token'])});
  return {ok:true,session:{...sessionFromVerified(v),token:session.token}};
 };
 const verifyTransaction=async(client,context)=>{
  const manager=context.manager,claims=verifyCustodialLeadershipOpsToken(manager.token,{env});
  if(claims.manager_id!==manager.manager_id||claims.credential_id!==manager.credential_id||claims.device_id!==manager.device_id
   ||claims.permissions.policyVersion!==manager.permissions?.policyVersion||claims.claimed_manager_id!==manager.claimed_manager_id)throw error('custodial_transaction_actor_denied');
  const r=await client.query('select public.static_weekly_leadership_bind_verified_request($1::uuid,$2::uuid,$3::uuid,$4::uuid) as actor',
   [manager.credential_id,manager.device_id,manager.manager_id,context.leadershipRequestId]);
  const actor=r.rows?.[0]?.actor;
  if(actor?.actor_kind!=='CUSTODIAL_LEADERSHIP_COHORT'||actor.owner!==false||actor.custodialManagementAdmin!==true
   ||actor.manager_id!==manager.manager_id||actor.credential_id!==manager.credential_id||actor.device_id!==manager.device_id)throw error('custodial_transaction_actor_denied');
  return actor;
 };
 const appRouter=express.Router();
 appRouter.use('/custodial-leadership-api',createCustodialLeadershipPinRouter({service,allowedOrigins:custodialLeadershipOrigins(env),sourceIdentity:req=>{
   const source=text(req.get('X-Custodial-Source')),stamp=text(req.get('X-Custodial-Source-Time')),mac=text(req.get('X-Custodial-Source-Mac'));
   if(source||stamp||mac){const expected=scopeMac(env,'custodial-proxy-source-v1',source+'\n'+stamp+'\n'+req.path);
    if(!source||source.length>512||!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>30000||mac.length!==expected.length||!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))throw error('trusted_source_required');
    return source;}return req.ip;
  }}));
 appRouter.post(internal+'/verify',express.json({limit:'2kb'}),async(req,res)=>{
  try{const b=req.body;if(!b||Object.keys(b).sort().join(',')!=='csrfToken,method,origin'||!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(b.method)||typeof b.origin!=='string'||typeof b.csrfToken!=='string')throw error('invalid_request',422);
   if(mutating(b.method)||b.origin)requireOrigin(b.origin,env);
   const v=await service.authenticateManagerSessionToken({token:token(req),requireCsrf:mutating(b.method),csrf:b.csrfToken});
   res.set('Cache-Control','no-store').json({ok:true,session:sessionFromVerified(v)});
  }catch{res.status(403).json({ok:false,error:'custodial_registration_unavailable'});}
 });
 appRouter.post(internal+'/gemini',express.json({limit:'256kb'}),async(req,res)=>{
  try{const b=req.body;if(!b||Object.keys(b).sort().join(',')!=='action,csrfToken,input,origin'
    ||!['gemini_context','gemini_conversation','gemini_begin_turn','gemini_original_outcome'].includes(b.action)
    ||!b.input||typeof b.input!=='object'||Array.isArray(b.input))throw error('invalid_request',422);
   requireOrigin(b.origin,env);const v=await service.authenticateManagerSessionToken({token:token(req),requireCsrf:true,csrf:b.csrfToken});
   const data=await service.geminiOperation({token:token(req),csrf:b.csrfToken,action:b.action,input:b.input});
   res.set('Cache-Control','no-store').json({ok:true,data});
  }catch{res.status(403).json({ok:false,error:'custodial_original_gemini_context_denied'});}
 });
 appRouter.post(internal+'/security-scope',express.json({limit:'8kb'}),async(req,res)=>{
  try{const b=req.body;if(!b||Object.keys(b).sort().join(',')!=='action,csrfToken,origin,securityCsrf,securityScope'
    ||!['security_scope_issue','security_scope_readback','security_scope_revoke'].includes(b.action))throw error('invalid_request',422);
   requireOrigin(b.origin,env);const changes=b.action!=='security_scope_readback';
   const v=await service.authenticateManagerSessionToken({token:token(req),requireCsrf:changes,csrf:b.csrfToken});
   const checked=verifySecurityScope(b.securityScope,v.managerSession,v.session.cohort.securityEpoch,b.securityCsrf,env,b.action==='security_scope_revoke');
   const result=await service.deviceSecurityScope({token:token(req),action:b.action,requireCsrf:changes,csrf:b.csrfToken,
    scope:{session_id:checked.session_id,policy_version:checked.scope.policy,security_epoch:checked.security_epoch,token_hash:checked.token_hash,csrf_hash:checked.csrf_hash,expires_at:checked.expires_at}});
   if(!result||result.session_id!==checked.session_id||result.security_epoch!==checked.security_epoch||result.token_hash!==checked.token_hash
    ||result.csrf_hash!==checked.csrf_hash||Date.parse(result.expires_at)!==Date.parse(checked.expires_at)
    ||(b.action==='security_scope_revoke'?result.revoked_at==null:result.revoked_at!=null))throw error('custodial_security_scope_denied');
   res.set('Cache-Control','no-store').json({ok:true,data:result});
  }catch{res.status(403).json({ok:false,error:'custodial_security_scope_denied'});}
 });
 appRouter.post(internal+'/security-revoke',express.json({limit:'2kb'}),async(req,res)=>{
  try{requireOrigin(req.body?.origin,env);const v=await service.authenticateManagerSessionToken({token:token(req),requireCsrf:true,csrf:req.body.csrfToken});
   const checked=verifySecurityScope(req.body.securityScope,v.managerSession,v.session.cohort.securityEpoch,req.body.securityCsrf,env,true);
   const stored=await service.deviceSecurityScope({token:token(req),action:'security_scope_readback',scope:{session_id:checked.session_id}});
   if(stored?.session_id!==checked.session_id||stored.token_hash!==checked.token_hash||stored.csrf_hash!==checked.csrf_hash||stored.security_epoch!==checked.security_epoch||stored.revoked_at!=null)throw error('custodial_security_scope_denied');
   const result=await service.revokeDeviceSecurityScopes({token:token(req),csrf:req.body.csrfToken});res.json({ok:true,data:result});
  }catch{res.status(403).json({ok:false,error:'custodial_security_scope_denied'});}
 });
 return {enabled:true,service,router:appRouter,verify,verifyTransaction};
}

export function createCustodialLeadershipApiProxy({env=process.env,fetchImpl=fetch}={}){
 const proxy=express.Router();
 proxy.use((req,res,next)=>{if(req.method!=='OPTIONS')return next();try{if(!enabled(env)||req.secure!==true)throw error('leadership_disabled',503);const origin=text(req.get('Origin'));requireOrigin(origin,env);
  if(!['GET','POST'].includes(req.get('Access-Control-Request-Method'))||(req.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').some(x=>x.trim()&&!['content-type','x-csrf-token'].includes(x.trim())))throw error('origin_or_transport_denied');
  res.set({'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Content-Type, X-CSRF-Token','Vary':'Origin'}).sendStatus(204);
 }catch(e){res.status(e.status||403).json({ok:false,error:'custodial_leadership_unavailable'});}});
 proxy.all('/:step',async(req,res)=>{
  if(!enabled(env))return res.status(503).json({ok:false,error:'leadership_disabled'});
  try{const step=req.params.step;if(!['session','challenge','enroll','revoke'].includes(step)||!((step==='session'&&req.method==='GET')||(step!=='session'&&req.method==='POST')))return res.sendStatus(404);
   if(req.secure!==true)throw error('origin_or_transport_denied');const origin=text(req.get('Origin'));requireOrigin(origin,env);
   const cookie=String(req.get('Cookie')||'').split(';').filter(x=>Object.values(CUSTODIAL_LEADERSHIP_COOKIE_NAMES).includes(x.trim().split('=')[0])).join(';');
   const body=req.method==='POST'?JSON.stringify(req.body):undefined;if(body&&Buffer.byteLength(body)>2048)throw error('invalid_request',413);
   const source=text(req.ip),sourceTime=String(Date.now()),sourceMac=scopeMac(env,'custodial-proxy-source-v1',source+'\n'+sourceTime+'\n/'+step);
   const {response,body:result}=await fetchFixed(env,fetchImpl,'/custodial-leadership-api/'+step,{method:req.method,
    headers:{Origin:origin,'X-Custodial-Source':source,'X-Custodial-Source-Time':sourceTime,'X-Custodial-Source-Mac':sourceMac,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),'X-CSRF-Token':text(req.get('X-CSRF-Token'))},body});
   if(req.body&&Object.hasOwn(req.body,'pin'))delete req.body.pin;
   for(const c of response.headers.getSetCookie()){
    if(!Object.values(CUSTODIAL_LEADERSHIP_COOKIE_NAMES).some(n=>c.startsWith(n+'='))||!c.includes('Secure')||!c.includes('HttpOnly')||/;\s*Domain=/i.test(c))throw error('custodial_cookie_transport_invalid',503);
    res.append('Set-Cookie',c);
   }
   res.set({'Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Vary':'Origin'}).status(response.status).json(result);
  }catch(e){if(req.body&&Object.hasOwn(req.body,'pin'))delete req.body.pin;res.status(e.status||503).json({ok:false,error:'custodial_leadership_unavailable'});}
 });
 return proxy;
}

// A real short server-signed Device Security capability, distinct from both
// normal Ops tokens and the old named-manager password cookie. Registration
// revocation and the DB-backed security epoch are rechecked on every use.
function scopeMac(env,domain,value){return createHmac('sha256',assertOpsManagerSessionSecret(env)).update(domain+'\0'+value).digest('base64url');}
function cookieValue(req){const found=String(req.get?.('Cookie')||req.headers?.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(SECURITY_COOKIE+'='));if(found.length!==1)return null;return found[0].slice(SECURITY_COOKIE.length+1);}
function verifySecurityScope(raw,session,epoch,csrf,env,requireCsrf){
 if(typeof raw!=='string'||raw.length>4096)throw error('custodial_security_scope_required');const [wire,mac,extra]=raw.split('.');
 const expected=scopeMac(env,'custodial-device-security-scope-v1',wire||'');
 if(extra!==undefined||typeof mac!=='string'||mac.length!==expected.length||!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))throw error('custodial_security_scope_required');
 let p;try{p=JSON.parse(Buffer.from(wire,'base64url').toString('utf8'));}catch{throw error('custodial_security_scope_required');}
 if(p.scope!=='custodial_device_management'||p.manager!==session.manager_id||p.registration!==session.credential_id||p.browser!==session.device_id
  ||p.policy!==session.permissions.policyVersion||p.epoch!==epoch||!Number.isSafeInteger(epoch)||p.expires<=Date.now()||p.expires>Date.now()+15*60*1000||!uuid(p.id))throw error('custodial_security_scope_required');
 const wanted=scopeMac(env,'custodial-device-security-csrf-v1',raw);
 if(requireCsrf&&(typeof csrf!=='string'||csrf.length!==wanted.length||!timingSafeEqual(Buffer.from(csrf),Buffer.from(wanted))))throw error('custodial_security_csrf_required');
 return {scope:p,csrf:wanted,session_id:p.id,manager_id:p.manager,credential_id:p.registration,expires_at:new Date(p.expires).toISOString(),scope_kind:p.scope,token_hash:hash(raw),csrf_hash:hash(wanted),security_epoch:p.epoch};
}
export function createCustodialLeadershipSecurityBridge({env=process.env,verify,fetchImpl=fetch}={}){
 const persisted=async(req,s,raw,checked,action)=>{
  const {response,body}=await fetchFixed(env,fetchImpl,internal+'/security-scope',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.token},
   body:JSON.stringify({action,origin:text(req.get?.('Origin')||req.headers?.origin),csrfToken:text(req.get?.('X-CSRF-Token')||req.headers?.['x-csrf-token']),securityScope:raw,securityCsrf:text(req.get?.('X-Device-Security-CSRF')||req.headers?.['x-device-security-csrf'])})});
  const row=body?.data;if(!response.ok||body?.ok!==true||row?.session_id!==checked.session_id||row.security_epoch!==checked.security_epoch
   ||row.token_hash!==checked.token_hash||row.csrf_hash!==checked.csrf_hash||Date.parse(row.expires_at)!==Date.parse(checked.expires_at)
   ||(action==='security_scope_revoke'?row.revoked_at==null:row.revoked_at!=null))throw error('custodial_security_scope_unconfirmed',response.status===403?403:503);
  return row;
 };
 const current=async req=>{if(!isCustodialLeadershipManagementSession(req.memphisAuth))throw error('custodial_security_scope_denied');const v=await verify({req,session:req.memphisAuth});if(!v?.ok)throw error('custodial_security_scope_denied');req.memphisAuth=v.session;return v.session;};
 return {
  applies:req=>enabled(env)&&req.memphisAuth?.auth_mode==='custodial_leadership_pin',
  async session(req,res){const s=await current(req);requireOrigin(text(req.get('Origin')),env);if(req.secure!==true)throw error('origin_or_transport_denied');
   const p={scope:'custodial_device_management',manager:s.manager_id,registration:s.credential_id,browser:s.device_id,policy:s.permissions.policyVersion,epoch:s.custodial_security_epoch,id:randomUUID(),expires:Math.min(Date.parse(s.expires_at),Date.now()+15*60*1000)};
   if(!Number.isSafeInteger(p.epoch)||p.expires<=Date.now())throw error('custodial_security_scope_denied');const wire=Buffer.from(JSON.stringify(p)).toString('base64url'),raw=wire+'.'+scopeMac(env,'custodial-device-security-scope-v1',wire);
   const checked=verifySecurityScope(raw,s,p.epoch,null,env,false);
   await persisted(req,s,raw,checked,'security_scope_issue');
   res.append('Set-Cookie',`${SECURITY_COOKIE}=${raw}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=${Math.max(1,Math.floor((p.expires-Date.now())/1000))}`);
   res.json({ok:true,data:{configured:true,unlocked:true,auth_mode:'custodial_leadership_pin',security_scope:'custodial_device_management',manager_id:s.manager_id,credential_id:s.credential_id,expires_at:checked.expires_at,csrf_token:checked.csrf}});
  },
  async verify(req,{requireCsrf=false}={}){try{const s=await current(req),raw=cookieValue(req);const checked=verifySecurityScope(raw,s,s.custodial_security_epoch,text(req.get?.('X-Device-Security-CSRF')||req.headers?.['x-device-security-csrf']),env,requireCsrf);await persisted(req,s,raw,checked,'security_scope_readback');return {ok:true,session:{...checked,auth_mode:'custodial_leadership_pin',password_used:false}};}catch{return {ok:false,status:403,error:'Current Custodial Device Security scope and CSRF are required.'};}},
  async lock(req,res){const s=await current(req),raw=cookieValue(req);const checked=verifySecurityScope(raw,s,s.custodial_security_epoch,text(req.get('X-Device-Security-CSRF')),env,true);await persisted(req,s,raw,checked,'security_scope_revoke');res.append('Set-Cookie',`${SECURITY_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=0`);res.json({ok:true,data:{locked:true}});},
  async revokeAll(req,res){const s=await current(req);const checked=await this.verify(req,{requireCsrf:true});if(!checked.ok)throw error('custodial_security_scope_required');
   const {response,body}=await fetchFixed(env,fetchImpl,internal+'/security-revoke',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.token},body:JSON.stringify({origin:text(req.get('Origin')),csrfToken:text(req.get('X-CSRF-Token')),securityScope:cookieValue(req),securityCsrf:text(req.get('X-Device-Security-CSRF'))})});
   if(!response.ok||body?.ok!==true)throw error('custodial_security_revoke_unconfirmed',503);res.json(body);
  },
 };
}

// Fixed private companion, no arbitrary SQL/RPC name or credential forwarding.
export function createCustodialLeadershipGeminiBridge({env=process.env,fetchImpl=fetch}={}){
 return async(req,action,input)=>{
  if(!enabled(env)||!isCustodialLeadershipManagementSession(req.memphisAuth))throw error('custodial_original_gemini_context_denied');
  const {response,body}=await fetchFixed(env,fetchImpl,internal+'/gemini',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+req.memphisAuth.token},
   body:JSON.stringify({action,input,origin:text(req.get('Origin')),csrfToken:text(req.get('X-CSRF-Token'))})},null,1048576);
  if(!response.ok||body?.ok!==true)throw error('custodial_original_gemini_context_denied');return body.data;
 };
}
