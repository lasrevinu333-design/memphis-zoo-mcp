// Real shared-access HMAC issuer/parser and real router handler, no sockets/DB.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createCustodialLeadershipOpsSession,verifyCustodialLeadershipOpsToken} from '../src/auth/shared-access-auth.js';
import {createCustodialLeadershipPinRouter,CUSTODIAL_LEADERSHIP_COOKIE_NAMES} from '../src/custodial-leadership-pin.js';
const env={NODE_ENV:'test',OPS_MANAGER_SESSION_SECRET:randomBytes(32).toString('hex')};
const expected={role:'ops_manager',access_level:'full_access',roles:['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN'],
 claimed_manager_id:randomUUID(),claimed_manager_display_name:'Eric Operle',identity_assurance:'SELF_ASSERTED_NAME',individual_identity_verified:false,
 manager_id:randomUUID(),credential_id:randomUUID(),device_id:randomUUID(),manager_display_name:'Custodial leadership cohort',
 permissions:{schema:'custodial.manager-permissions.v1',read:true,owner:false,custodialManagementAdmin:true,policyVersion:1},
 auth_mode:'custodial_leadership_pin',actor_kind:'CUSTODIAL_LEADERSHIP_COHORT',read_only:false,owner:false,custodial_management_admin:true};
const checks=[];const pass=s=>{checks.push(s);console.log('PASS '+s);};
for(const year of [2026,2056]){const now=new Date(year+'-01-01T00:00:00Z'),session=createCustodialLeadershipOpsSession({expectedClaims:expected,credentialExpiresAt:null,registrationLifetime:'UNTIL_REVOKED',env,now});
 assert.equal(Date.parse(session.expires_at)-now.getTime(),900000);assert.equal(verifyCustodialLeadershipOpsToken(session.token,{env,now}).credential_id,expected.credential_id);
 assert.throws(()=>verifyCustodialLeadershipOpsToken(session.token,{env,now:new Date(now.getTime()+900001)}));}
pass('explicit nonexpiring registration issues ordinary fifteen-minute signed tokens even decades later; expired JWT denied');
for(const input of [{credentialExpiresAt:null},{credentialExpiresAt:undefined},{credentialExpiresAt:'infinity'},{credentialExpiresAt:new Date(Date.now()+3600000).toISOString(),registrationLifetime:'UNTIL_REVOKED'},{credentialExpiresAt:null,registrationLifetime:'forever'}])assert.throws(()=>createCustodialLeadershipOpsSession({expectedClaims:expected,...input,env}));
pass('null/missing/infinite string expiry is never an implicit nonexpiring grant; exact marker required');
const browser=randomBytes(32).toString('base64url'),registration=randomBytes(32).toString('base64url');
let accepted=true,calls=0;const service={enabled:true,newBrowserToken:()=>randomBytes(32).toString('base64url'),csrfToken:()=> 'synthetic-csrf',getSession:async input=>{calls++;assert.equal(input.browserToken,browser);assert.equal(input.registrationToken,registration);return accepted?{registrationLifetime:'UNTIL_REVOKED',credentialExpiresAt:null}:null;}};
const router=createCustodialLeadershipPinRouter({service,allowedOrigins:['https://synthetic.invalid']}),handler=router.stack.find(x=>x.route?.path==='/session').route.stack.at(-1).handle;
const request={headers:{cookie:CUSTODIAL_LEADERSHIP_COOKIE_NAMES.browser+'='+browser+'; '+CUSTODIAL_LEADERSHIP_COOKIE_NAMES.registration+'='+registration},get(key){return this.headers[key.toLowerCase()]||'';}};
const response=()=>({cookies:[],append(key,value){assert.equal(key,'Set-Cookie');this.cookies.push(value);},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
let res=response();await handler(request,res);assert.equal(res.body.enrolled,true);assert.equal(res.cookies.length,2);
assert.ok(res.cookies.every(c=>c.includes('Secure; HttpOnly; SameSite=None')&&c.includes('Max-Age=')));
assert.ok(res.cookies.some(c=>c.startsWith(CUSTODIAL_LEADERSHIP_COOKIE_NAMES.browser+'='+browser+';')));
assert.ok(res.cookies.some(c=>c.startsWith(CUSTODIAL_LEADERSHIP_COOKIE_NAMES.registration+'='+registration+';')));
pass('successful real session handler refreshes both same opaque secure cookies without re-enrollment');
accepted=false;res=response();await handler(request,res);assert.equal(res.body.enrolled,false);assert.equal(res.cookies.length,0);assert.equal(calls,2);
pass('failed current readback does not refresh invalid registration cookies');
console.log(JSON.stringify({status:'PASS',checks:checks.length,scope:'nonexpiring registration DTO and short-lived signed session/cookie refresh; current SQL validation separate'}));
