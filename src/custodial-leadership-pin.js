// Unmounted/default-disabled Custodial cohort enrollment. Never an individual
// identity verifier, Map credential, employee credential, or owner elevation.
import express from 'express';
import {createHmac,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify,isDeepStrictEqual} from 'node:util';
const scrypt=promisify(scryptCallback);
export const CUSTODIAL_LEADERSHIP_PREFIX='/custodial-leadership-api';
export const CUSTODIAL_LEADERSHIP_APPROVED_ACCOUNTS=Object.freeze([
 {displayName:'Eric McKenney',systemKey:'eric_mckenney_facilities_maintenance_manager'},
 {displayName:'Haley',systemKey:'haley_lejman_water_quality_manager'},
 {displayName:'Brandy Gull',systemKey:'brandy_gull_horticulture_manager'},
 {displayName:'Jennifer',systemKey:'jennifer_sheffield_director_operations'},
 {displayName:'Annie',systemKey:'annie_feist_operations_admin'},
 {displayName:'Eric Operle',systemKey:'eric_custodial_manager'},
].map(Object.freeze));
export const CUSTODIAL_LEADERSHIP_COOKIE_NAMES=Object.freeze({browser:'__Host-custodial_leadership_browser',registration:'__Host-custodial_leadership_registration',challenge:'__Host-custodial_leadership_challenge'});
const PERMISSIONS=new Set(['custodial.read','custodial.edit','custodialManagementAdmin']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const HEX=/^[a-f0-9]{64}$/;
const exactly=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...keys].sort().join(',');
const problem=(code,status=403)=>Object.assign(new Error(code),{code,status});
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const validVerifier=v=>exactly(v,['algorithm','salt','digest'])&&v.algorithm==='scrypt-hmac-sha256-v1'&&HEX.test(v.salt)&&HEX.test(v.digest);
const validPepper=p=>typeof p==='string'&&Buffer.byteLength(p)>=32&&Buffer.byteLength(p)<=4096;
const hmac=(pepper,domain,value)=>createHmac('sha256',pepper).update(domain+'\0'+value).digest('hex');

// Call only inside a separately approved setup/rotation. No source constant or
// persisted plaintext PIN. Tests generate synthetic candidates only in RAM.
export async function createCustodialLeadershipPinVerifier(pin,pepper){
 if(typeof pin!=='string'||!/^\d{4}$/.test(pin)||!validPepper(pepper))throw problem('pin_verifier_input_invalid',422);
 const salt=randomBytes(32).toString('hex');
 const material=hmac(pepper,'custodial-leadership-pin-v1',pin);
 const derived=await scrypt(material,Buffer.from(salt,'hex'),32,{N:16384,r:8,p:1,maxmem:64*1024*1024});
 const verifier={algorithm:'scrypt-hmac-sha256-v1',salt,digest:derived.toString('hex')};derived.fill(0);return verifier;
}
async function verify(pin,verifier,pepper){
 if(typeof pin!=='string'||!/^\d{4}$/.test(pin)||!validVerifier(verifier))return false;
 const material=hmac(pepper,'custodial-leadership-pin-v1',pin);
 const derived=await scrypt(material,Buffer.from(verifier.salt,'hex'),32,{N:16384,r:8,p:1,maxmem:64*1024*1024});
 const matched=timingSafeEqual(derived,Buffer.from(verifier.digest,'hex'));derived.fill(0);return matched;
}

// The connection must be privately approved and authorized for the private
// function. No service-role credential lookup or in-memory production fallback.
export function createPgCustodialLeadershipPinStore({query,ownerQuery=null}){
 if(typeof query!=='function')throw problem('leadership_store_unavailable',503);
 const execute=async(action,data)=>{
  const ownerAction=['install_initial','prepare_rotation','confirm_private_delivery','arm_enrollment_share'].includes(action);
  if(ownerAction&&typeof ownerQuery!=='function')throw problem('owner_authorization_required',403);
  const run=ownerAction?ownerQuery:query;
  const sql=ownerAction?'select custodial_leadership_private.execute($1::text,$2::jsonb) as result':'select custodial_leadership_private.runtime($1::text,$2::jsonb) as result';
  const result=await run(sql,[action,JSON.stringify(data)]);
  if(result?.rows?.length!==1||!result.rows[0]?.result)throw problem('leadership_store_unavailable',503);
  const value=result.rows[0].result;
  if(value.ok!==true)throw problem(['rate_limited','enrollment_unavailable','challenge_unavailable','registration_unavailable','rotation_not_eligible','owner_authorization_required','policy_unavailable','browser_already_enrolled'].includes(value.error)?value.error:'leadership_store_unavailable',value.error==='rate_limited'?429:403);
  return value.data;
 };
 return Object.freeze({execute});
}

function sessionView(raw){
 if(!raw)return null;
 if(!UUID.test(raw.registrationId)||!UUID.test(raw.browserId)||!Number.isFinite(Date.parse(raw.credentialExpiresAt))||!UUID.test(raw.claimedAccount?.accountId)||!UUID.test(raw.cohort?.principalId)
  ||raw.cohort.principalId===raw.claimedAccount.accountId||!Number.isSafeInteger(raw.cohort.policyVersion)||raw.cohort.policyVersion<1
  ||!Array.isArray(raw.cohort.permissions)||raw.cohort.permissions.length<1||raw.cohort.permissions.some(p=>!PERMISSIONS.has(p))
  ||new Set(raw.cohort.permissions).size!==raw.cohort.permissions.length
  ||!CUSTODIAL_LEADERSHIP_APPROVED_ACCOUNTS.some(x=>x.displayName===raw.claimedAccount.displayName))throw problem('leadership_session_unavailable',403);
 const contact=raw.claimedAccount.contact;
 if(contact!==null&&(!exactly(contact,['email','verifiedAt'])||typeof contact.email!=='string'
  ||contact.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)||!Number.isFinite(Date.parse(contact.verifiedAt))))throw problem('leadership_session_unavailable',403);
 return {registrationId:raw.registrationId,browserId:raw.browserId,credentialExpiresAt:raw.credentialExpiresAt,identityAssurance:'SELF_ASSERTED_NAME',
  claimedAccount:{accountId:raw.claimedAccount.accountId,displayName:raw.claimedAccount.displayName,contact},
  cohort:{principalId:raw.cohort.principalId,policyVersion:raw.cohort.policyVersion,securityEpoch:raw.cohort.securityEpoch,permissions:[...raw.cohort.permissions]},
  audit:{actorKind:'CUSTODIAL_LEADERSHIP_COHORT',claimedNameSelfAsserted:true,individuallyAuthenticated:false}};
}

export function createCustodialLeadershipPinService({enabled=false,store,pepper,issueManagerSession,verifyManagerSessionToken=null,authorizedActionFlags={},authorizeOwnerAction=async()=>null}={}){
 if(typeof enabled!=='boolean')throw problem('leadership_disabled',503);
 if(enabled&&(!store||typeof store.execute!=='function'||!validPepper(pepper)||typeof issueManagerSession!=='function'))throw problem('leadership_configuration_unavailable',503);
 if(!authorizedActionFlags||typeof authorizedActionFlags!=='object'||Array.isArray(authorizedActionFlags)||Object.entries(authorizedActionFlags).some(([k,v])=>typeof v!=='boolean'||!/^(?:manage|send|regenerate)_[a-z_]+$/.test(k)||/(?:owner|cloud|secret|credential|security|enrollment|map|employee_roles)/.test(k)))throw problem('leadership_permission_configuration_invalid',503);
 let verifying=0;
 const enabledOnly=()=>{if(!enabled)throw problem('leadership_disabled',503);};
 const token=()=>randomBytes(32).toString('base64url');
 const hash=(domain,value)=>{if(!TOKEN.test(value??''))throw problem('browser_binding_required',403);return hmac(pepper,domain,value);};
 const binding=browserToken=>hash('leadership-browser-v1',browserToken);
 const csrfToken=browserToken=>{enabledOnly();return hmac(pepper,'leadership-csrf-v1',binding(browserToken));};
 const requireCsrf=(browserToken,csrf)=>{if(!TOKEN.test(browserToken??'')||!HEX.test(csrf??'')||!eq(csrfToken(browserToken),csrf))throw problem('csrf_required',403);};
 const context=(browserToken,sourceIdentity)=>{
  if(typeof sourceIdentity!=='string'||!sourceIdentity||sourceIdentity.length>512)throw problem('trusted_source_required',403);
  return {browser_hash:binding(browserToken),source_hash:hmac(pepper,'leadership-source-v1',sourceIdentity)};
 };
 const withManagerSession=async(raw)=>{
  const session=sessionView(raw);if(!session)return null;
  if(!session.cohort.permissions.includes('custodialManagementAdmin'))throw problem('custodial_cohort_permission_required',403);
  const permissions={schema:'custodial.manager-permissions.v1',read:true,owner:false,custodialManagementAdmin:true,policyVersion:session.cohort.policyVersion,...authorizedActionFlags};
  const expected={role:'ops_manager',access_level:'full_access',roles:['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN'],claimed_manager_id:session.claimedAccount.accountId,claimed_manager_display_name:session.claimedAccount.displayName,identity_assurance:'SELF_ASSERTED_NAME',individual_identity_verified:false,manager_id:session.cohort.principalId,credential_id:session.registrationId,device_id:session.browserId,
   manager_display_name:'Custodial leadership cohort',permissions,auth_mode:'custodial_leadership_pin',actor_kind:'CUSTODIAL_LEADERSHIP_COHORT',read_only:false,owner:false,custodial_management_admin:true};
  const issued=await issueManagerSession({expectedClaims:structuredClone(expected),credentialExpiresAt:session.credentialExpiresAt,
   identityAssurance:'SELF_ASSERTED_NAME',claimedAccount:structuredClone(session.claimedAccount)});
  if(typeof issued?.token!=='string'||issued.token.length<32||issued.token.length>8192||/[\s\u0000-\u001f]/u.test(issued.token)
   ||!Number.isFinite(Date.parse(issued.expires_at))||Date.parse(issued.expires_at)>Date.parse(session.credentialExpiresAt)
   ||Object.entries(expected).some(([key,value])=>!isDeepStrictEqual(issued[key],value)))throw problem('manager_session_issuer_unavailable',503);
  return {...session,managerSession:{...expected,token:issued.token,expires_at:issued.expires_at}};
 };
 const getSession=async({browserToken,registrationToken})=>{
  enabledOnly();if(!TOKEN.test(browserToken??'')||!TOKEN.test(registrationToken??''))return null;
  return withManagerSession(await store.execute('session',{browser_hash:binding(browserToken),token_hash:hash('leadership-registration-v1',registrationToken)}));
 };
 const owner=async(action,authorization,request={})=>{
  enabledOnly();const grant=await authorizeOwnerAction({action,authorization,request:structuredClone(request)});
  if(!grant||grant.verifiedIndependentOwner!==true||grant.identityAssurance==='SELF_ASSERTED_NAME'||grant.action!==action
   ||!UUID.test(grant.ownerAccountId)||!UUID.test(grant.approvalId))throw problem('owner_authorization_required',403);
  return {owner_account_id:grant.ownerAccountId,approval_id:grant.approvalId};
 };
 return Object.freeze({enabled,newBrowserToken:()=>{enabledOnly();return token();},csrfToken,requireCsrf,getSession,
  // Existing central auth verifies the REAL signed token via this injected
  // adapter, then rechecks its actual registration/policy. No client marker.
  async authenticateManagerSessionToken({token:rawToken,csrf=null,requireCsrf=false}){
   enabledOnly();if(typeof verifyManagerSessionToken!=='function'||typeof rawToken!=='string'||rawToken.length<32||rawToken.length>8192)throw problem('leadership_session_unavailable',403);
   const claims=await verifyManagerSessionToken(rawToken,{authMode:'custodial_leadership_pin',audience:'custodial-management'});
   if(claims?.auth_mode!=='custodial_leadership_pin'||claims.actor_kind!=='CUSTODIAL_LEADERSHIP_COHORT'
    ||claims.owner!==false||claims.read_only!==false||claims.access_level!=='full_access'||claims.role!=='ops_manager'
    ||claims.custodial_management_admin!==true||claims.individual_identity_verified!==false
    ||!Array.isArray(claims.roles)||claims.roles.length!==4||!isDeepStrictEqual([...claims.roles].sort(),['CUSTODIAL_MANAGER','DIRECTOR','OPS_MANAGER','SECURITY_ADMIN'])
    ||claims.permissions?.schema!=='custodial.manager-permissions.v1'||claims.permissions.owner!==false||claims.permissions.read!==true
    ||claims.permissions.custodialManagementAdmin!==true||!UUID.test(claims.manager_id??'')||!UUID.test(claims.credential_id??'')
    ||!UUID.test(claims.device_id??'')||claims.identity_assurance!=='SELF_ASSERTED_NAME')throw problem('leadership_session_unavailable',403);
   const stored=await store.execute('credential_readback',{registration_id:claims.credential_id,cohort_principal_id:claims.manager_id,browser_id:claims.device_id});
   if(requireCsrf&&(!HEX.test(stored?.csrfBinding??'')||!HEX.test(csrf??'')||!eq(hmac(pepper,'leadership-csrf-v1',stored.csrfBinding),csrf)))throw problem('csrf_required',403);
   const session=sessionView(stored);
   if(!session||session.cohort.principalId!==claims.manager_id||session.cohort.policyVersion!==claims.permissions.policyVersion
    ||session.claimedAccount.accountId!==claims.claimed_manager_id||!session.cohort.permissions.includes('custodialManagementAdmin'))throw problem('leadership_session_unavailable',403);
   return {session,actor:custodialLeadershipCohortActor(session),managerSession:claims};
  },
  async challenge({pin,browserToken,sourceIdentity}){
   enabledOnly();const ctx=context(browserToken,sourceIdentity);
   // Durable global + source + browser budgets are charged BEFORE KDF work.
   const slot=await store.execute('begin_challenge',ctx);
   if(verifying>=2)throw problem('rate_limited',429);
   verifying++;let matched=false;
   try{matched=await verify(pin,slot.verifier,pepper);}finally{verifying--;}
   if(!matched)throw problem('enrollment_unavailable',403);
   const challengeToken=token();
   const picked=await store.execute('finish_challenge',{...ctx,pin_version:slot.pinVersion,challenge_hash:hash('leadership-challenge-v1',challengeToken)});
   if(!Array.isArray(picked.approvedNames)||picked.approvedNames.length!==6||new Set(picked.approvedNames.map(x=>x.accountId)).size!==6
    ||picked.approvedNames.some((x,i)=>!exactly(x,['accountId','displayName'])||!UUID.test(x.accountId)||x.displayName!==CUSTODIAL_LEADERSHIP_APPROVED_ACCOUNTS[i].displayName))throw problem('policy_unavailable',503);
   return {challengeToken,challengeExpiresAt:picked.challengeExpiresAt,approvedNames:picked.approvedNames};
  },
  async enroll({accountId,browserToken,challengeToken,sourceIdentity}){
   enabledOnly();if(!UUID.test(accountId??''))throw problem('challenge_unavailable',403);
   const ctx=context(browserToken,sourceIdentity),registrationToken=token(),nextBrowserToken=token();
   const raw=await store.execute('enroll',{...ctx,challenge_hash:hash('leadership-challenge-v1',challengeToken),claimed_account_id:accountId,
    account_key:hmac(pepper,'leadership-account-v1',accountId),token_hash:hash('leadership-registration-v1',registrationToken),new_browser_hash:binding(nextBrowserToken)});
   return {registrationToken,browserToken:nextBrowserToken,session:await withManagerSession(raw)};
  },
  async geminiOperation({token:rawToken,csrf,action,input}){
   const verified=await this.authenticateManagerSessionToken({token:rawToken,csrf,requireCsrf:true});
   if(!['gemini_context','gemini_conversation','gemini_begin_turn','gemini_original_outcome'].includes(action))throw problem('leadership_session_unavailable',403);
   return store.execute(action,{input,registration_id:verified.session.registrationId,cohort_principal_id:verified.session.cohort.principalId,browser_id:verified.session.browserId});
  },
  async deviceSecurityScope({token:rawToken,action,scope,requireCsrf=false,csrf=null}){
   const verified=await this.authenticateManagerSessionToken({token:rawToken,csrf,requireCsrf});
   if(!['security_scope_issue','security_scope_readback','security_scope_revoke'].includes(action)||!scope||!UUID.test(scope.session_id??''))throw problem('leadership_session_unavailable',403);
   return store.execute(action,{...scope,registration_id:verified.session.registrationId,cohort_principal_id:verified.session.cohort.principalId,browser_id:verified.session.browserId});
  },
  async revokeDeviceSecurityScopes({token:rawToken,csrf}){
   const verified=await this.authenticateManagerSessionToken({token:rawToken,csrf,requireCsrf:true});
   return store.execute('security_epoch_bump',{registration_id:verified.session.registrationId,cohort_principal_id:verified.session.cohort.principalId,browser_id:verified.session.browserId});
  },
  async revoke({browserToken,registrationToken}){
   enabledOnly();await store.execute('revoke',{browser_hash:binding(browserToken),token_hash:hash('leadership-registration-v1',registrationToken)});return {revoked:true};
  },
  // Main must supply the SAME already-open control-plane transaction client.
  // No pool/autocommit impersonation: SQL context is keyed by backend+transaction.
  async bindSqlRequestContext({query,browserToken,registrationToken,requestId,permission='custodialManagementAdmin'}){
   enabledOnly();if(typeof query!=='function'||!UUID.test(requestId??'')||!PERMISSIONS.has(permission))throw problem('leadership_context_unavailable',403);
   const result=await query('select public.static_weekly_leadership_bind_request($1::text,$2::text,$3::uuid,$4::text) as actor',
    [binding(browserToken),hash('leadership-registration-v1',registrationToken),requestId,permission]);
   const actor=result?.rows?.length===1?result.rows[0].actor:null;
   if(actor?.actor_kind!=='CUSTODIAL_LEADERSHIP_COHORT'||actor.identity_assurance!=='SELF_ASSERTED_NAME'
    ||!UUID.test(actor.manager_id??'')||!UUID.test(actor.browser_id??'')||!UUID.test(actor.credential_id??'')||!UUID.test(actor.claimed_account_id??'')
    ||actor.manager_id===actor.claimed_account_id||actor.request_id!==requestId)throw problem('leadership_context_unavailable',403);
   return actor;
  },
  async installInitialPin({authorization,verifier}){
   if(!validVerifier(verifier))throw problem('pin_verifier_input_invalid',422);
   const grant=await owner('install-initial-pin',authorization,{verifier});return store.execute('install_initial',{...grant,verifier});
  },
  async prepareRotation({authorization}){
   const grant=await owner('prepare-rotation',authorization);return store.execute('prepare_rotation',grant);
  },
  async confirmPrivateDeliveryToEric({authorization,rotationId,verifier,deliveryReceiptId}){
   if(!UUID.test(rotationId??'')||!UUID.test(deliveryReceiptId??'')||!validVerifier(verifier))throw problem('rotation_not_eligible',403);
   const grant=await owner('confirm-private-delivery-to-eric',authorization,{rotationId,verifier,deliveryReceiptId,recipientSystemKey:'eric_custodial_manager'});
   return store.execute('confirm_private_delivery',{...grant,rotation_id:rotationId,delivery_receipt_id:deliveryReceiptId,verifier});
  },
  async armApprovedEnrollmentShare({authorization,pinVersion}){
   if(!UUID.test(pinVersion??''))throw problem('rotation_not_eligible',403);
   const grant=await owner('arm-approved-enrollment-share',authorization,{pinVersion});return store.execute('arm_enrollment_share',{...grant,pin_version:pinVersion});
  },
 });
}

function cookies(req){
 const result={};for(const part of String(req.headers?.cookie??'').split(';')){
  const at=part.indexOf('=');if(at<0)continue;const key=part.slice(0,at).trim(),value=part.slice(at+1).trim();
  if(Object.values(CUSTODIAL_LEADERSHIP_COOKIE_NAMES).includes(key)){if(Object.hasOwn(result,key))throw problem('browser_binding_required',403);result[key]=TOKEN.test(value)?value:null;}
 }return result;
}
function setCookie(res,key,value,maxAge){
 res.append('Set-Cookie',`${CUSTODIAL_LEADERSHIP_COOKIE_NAMES[key]}=${value}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=${maxAge}`);
}
export function createCustodialLeadershipPinRouter({service=createCustodialLeadershipPinService(),allowedOrigins=[],sourceIdentity}={}){
 const router=express.Router(),origins=new Set(allowedOrigins);
 if([...origins].some(x=>typeof x!=='string'||!/^https:\/\/[^/?#]+$/.test(x)))throw problem('leadership_origin_configuration_invalid',503);
 router.use((req,res,next)=>{
  res.set({'Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','Vary':'Origin'});
  if(!service.enabled)return res.status(503).json({ok:false,error:'leadership_disabled'});
  if(req.secure!==true||!origins.has(req.get('Origin')))return res.status(403).json({ok:false,error:'origin_or_transport_denied'});
  res.set({'Access-Control-Allow-Origin':req.get('Origin'),'Access-Control-Allow-Credentials':'true'});
  if(req.method==='OPTIONS'){
   if(!['GET','POST'].includes(req.get('Access-Control-Request-Method')))return res.sendStatus(403);
   const requested=(req.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
   if(requested.some(x=>!['content-type','x-csrf-token'].includes(x)))return res.sendStatus(403);
   return res.set({'Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Content-Type, X-CSRF-Token'}).sendStatus(204);
  }next();
 });
 router.use(express.json({limit:'2kb',strict:true,type:'application/json'}));
 const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(Number.isInteger(error?.status)?error.status:503).json({ok:false,error:typeof error?.code==='string'?error.code:'leadership_unavailable'});}};
 const mutation=(req,keys)=>{
  if(!req.is('application/json')||!exactly(req.body,keys))throw problem('invalid_request',422);
  const c=cookies(req);service.requireCsrf(c[CUSTODIAL_LEADERSHIP_COOKIE_NAMES.browser],req.get('X-CSRF-Token'));return c;
 };
 const trustedSource=req=>{if(typeof sourceIdentity!=='function')throw problem('trusted_source_required',503);return sourceIdentity(req);};
 router.get('/session',route(async(req,res)=>{
  const c=cookies(req);let browser=c[CUSTODIAL_LEADERSHIP_COOKIE_NAMES.browser];if(!browser){browser=service.newBrowserToken();setCookie(res,'browser',browser,31536000);}
  const session=await service.getSession({browserToken:browser,registrationToken:c[CUSTODIAL_LEADERSHIP_COOKIE_NAMES.registration]});
  res.json({ok:true,enrolled:session!==null,csrfToken:service.csrfToken(browser),...(session?{session}:{})});
 }));
 router.post('/challenge',route(async(req,res)=>{
  const c=mutation(req,['pin']),candidate=req.body.pin;delete req.body.pin;
  const result=await service.challenge({pin:candidate,browserToken:c[CUSTODIAL_LEADERSHIP_COOKIE_NAMES.browser],sourceIdentity:trustedSource(req)});
  setCookie(res,'challenge',result.challengeToken,300);res.json({ok:true,challengeExpiresAt:result.challengeExpiresAt,approvedNames:result.approvedNames});
 }));
 router.post('/enroll',route(async(req,res)=>{
  const c=mutation(req,['accountId']);const result=await service.enroll({accountId:req.body.accountId,browserToken:c[CUSTODIAL_LEADERSHIP_COOKIE_NAMES.browser],challengeToken:c[CUSTODIAL_LEADERSHIP_COOKIE_NAMES.challenge],sourceIdentity:trustedSource(req)});
  setCookie(res,'registration',result.registrationToken,31536000);setCookie(res,'browser',result.browserToken,31536000);setCookie(res,'challenge','',0);
  res.json({ok:true,enrolled:true,session:result.session,csrfToken:service.csrfToken(result.browserToken)});
 }));
 router.post('/revoke',route(async(req,res)=>{
  const c=mutation(req,[]);await service.revoke({browserToken:c[CUSTODIAL_LEADERSHIP_COOKIE_NAMES.browser],registrationToken:c[CUSTODIAL_LEADERSHIP_COOKIE_NAMES.registration]});
  setCookie(res,'registration','',0);setCookie(res,'challenge','',0);res.json({ok:true,revoked:true,enrolled:false});
 }));
 router.use((error,_req,res,_next)=>res.status(error?.type==='entity.too.large'?413:422).json({ok:false,error:'invalid_request'}));
 return router;
}

export function custodialLeadershipCohortActor(session){
 const v=sessionView(session);if(!v)throw problem('leadership_session_unavailable',403);
 return Object.freeze({kind:'CUSTODIAL_LEADERSHIP_COHORT',registrationId:v.registrationId,browserId:v.browserId,principalId:v.cohort.principalId,policyVersion:v.cohort.policyVersion,
  permissions:Object.freeze([...v.cohort.permissions]),custodialManagementAdmin:v.cohort.permissions.includes('custodialManagementAdmin'),claimedAccountId:v.claimedAccount.accountId,claimedDisplayName:v.claimedAccount.displayName,
  identityAssurance:'SELF_ASSERTED_NAME',individuallyAuthenticated:false});
}

// Main may invoke this as an explicit alternative on Custodial routes ONLY.
// Do not install it on Map/employee/owner/cloud/security configuration routes.
export async function custodialLeadershipRequestActor({service,req,allowedOrigins,permission='custodialManagementAdmin'}){
 if(!service?.enabled)return null;
 if(req.secure!==true||!Array.isArray(allowedOrigins)||!allowedOrigins.includes(req.get('Origin')))throw problem('origin_or_transport_denied',403);
 const c=cookies(req),browserToken=c[CUSTODIAL_LEADERSHIP_COOKIE_NAMES.browser],registrationToken=c[CUSTODIAL_LEADERSHIP_COOKIE_NAMES.registration];
 if(!browserToken||!registrationToken)return null;
 if(!['GET','HEAD','OPTIONS'].includes(req.method))service.requireCsrf(browserToken,req.get('X-CSRF-Token'));
 const session=await service.getSession({browserToken,registrationToken});
 if(!session||!session.cohort.permissions.includes(permission))throw problem('custodial_cohort_permission_required',403);
 return custodialLeadershipCohortActor(session);
}
export async function bindCustodialLeadershipHttpTransaction({service,query,req,requestId,allowedOrigins}){
 const actor=await custodialLeadershipRequestActor({service,req,allowedOrigins});
 if(!actor)throw problem('custodial_cohort_permission_required',403);
 const c=cookies(req);
 const sqlActor=await service.bindSqlRequestContext({query,browserToken:c[CUSTODIAL_LEADERSHIP_COOKIE_NAMES.browser],registrationToken:c[CUSTODIAL_LEADERSHIP_COOKIE_NAMES.registration],requestId,permission:'custodialManagementAdmin'});
 if(sqlActor.manager_id!==actor.principalId||sqlActor.credential_id!==actor.registrationId||sqlActor.browser_id!==actor.browserId||sqlActor.claimed_account_id!==actor.claimedAccountId)throw problem('leadership_context_unavailable',403);
 return sqlActor;
}
