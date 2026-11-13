import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {createSameOriginalRecoveryManagerAuthenticator} from '../src/auth/same-original-recovery-manager-auth.js';
const env={NODE_ENV:'production',OPS_MANAGER_AUTH_REQUIRED:'true',
  OPS_MANAGER_SESSION_SECRET:'synthetic-new-recovery-manager-session-secret-01',
  DEVICE_CREDENTIAL_SECRET:'synthetic-new-recovery-security-cookie-secret-02'};
const m='95000000-0000-4000-8000-000000000001',c='95000000-0000-4000-8000-000000000002',s='95000000-0000-4000-8000-000000000003';
const hash=(purpose,value)=>createHmac('sha256',env.DEVICE_CREDENTIAL_SECRET).update(purpose+':'+value).digest('hex');
function fixture() {
  const now=Date.now(),secret='synthetic-cookie-secret-32-characters-long',csrf='synthetic-csrf-secret-32-characters-long';
  const manager={manager_id:m,display_name:'Synthetic Owner',system_key:'eric_custodial_manager',
    is_system_principal:false,roles:['CUSTODIAL_MANAGER','SECURITY_ADMIN'],active:true,revoked_at:null};
  const credential={credential_id:c,device_id:'manager-fixture',manager_id:m,manager,
    max_access_level:'full_access',created_at:new Date(now-1000).toISOString(),
    expires_at:new Date(now+86400000).toISOString(),revoked_at:null};
  const config={password_hash:'x'.repeat(64),password_version:1,sessions_revoked_at:null};
  const session={session_id:s,manager_id:m,credential_id:c,password_version:1,
    token_hash:hash('device-security-session',secret),csrf_hash:hash('device-security-csrf',csrf),
    created_at:new Date(now-1000).toISOString(),expires_at:new Date(now+900000).toISOString(),revoked_at:null};
  const signed=createOpsManagerSession({credentialId:c,deviceId:credential.device_id,manager,
    authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env});
  const req={method:'POST',originalUrl:'/admin-api/device-security/same-original-recovery/approvals',
    headers:{authorization:'Bearer '+signed.token,cookie:'memphis_device_security_session='+s+'.'+secret,'x-device-security-csrf':csrf}};
  const trustedDeviceStore={async find(){return structuredClone(credential);}};
  const securityStore={async getManager(){return structuredClone(manager);},
    async getDeviceSecurityConfig(){return structuredClone(config);},
    async findDeviceSecuritySession(){return structuredClone(session);}};
  return {req,manager,credential,config,session,trustedDeviceStore,securityStore,
    create(){return createSameOriginalRecoveryManagerAuthenticator({env,trustedDeviceStore,securityStore});}};
}
let cases=0;
async function test(name,fn){if(process.argv.includes('--session-row-only')&&!name.startsWith('exact session row'))return;if(process.argv.includes('--read-binding-only')&&!name.startsWith('read-only preview binding'))return;await fn();cases++;console.log('PASS '+name);}
const denied=fn=>assert.rejects(fn,{code:'same_original_recovery_manager_denied'});
await test('actual signed manager and actual password/CSRF verifiers compose; projection is not authority',async()=>{
  const f=fixture(),a=f.create(),issuer=await a.authenticateCurrentManager(f.req,{requireCsrf:true});
  assert.deepEqual(issuer,{manager_id:m,manager_credential_id:c,manager_device_id:'manager-fixture'});
  const binding=a.inspectAuthenticatedIssuer(issuer);assert.equal(binding.observation_only,true);assert.equal(binding.transaction_authority,false);
  assert.equal(binding.security_session_id,s);assert.ok(!JSON.stringify(binding).includes('synthetic-cookie'));
  assert.throws(()=>a.inspectAuthenticatedIssuer({...issuer}),{code:'same_original_recovery_manager_denied'});
});
await test('caller auth role and forged unsigned header cannot enter',async()=>{
  const f=fixture();delete f.req.headers.authorization;f.req.memphisAuth={manager_id:m,roles:['SECURITY_ADMIN'],permissions:{owner:true}};
  await denied(()=>f.create().authenticateCurrentManager(f.req,{requireCsrf:true}));
});
await test('current limited credential rejects old full-owner token',async()=>{
  const f=fixture();f.credential.max_access_level='read_only';
  await denied(()=>f.create().authenticateCurrentManager(f.req,{requireCsrf:true}));
});
await test('authoritative Security Admin must remain present',async()=>{
  const f=fixture();f.manager.roles=['CUSTODIAL_MANAGER'];
  await denied(()=>f.create().authenticateCurrentManager(f.req,{requireCsrf:true}));
});
await test('no role fallback if authoritative security store missing',async()=>{
  const f=fixture();delete f.securityStore.getManager;
  await denied(()=>f.create().authenticateCurrentManager(f.req,{requireCsrf:true}));
});
await test('password version and CSRF fail closed',async()=>{
  let f=fixture();f.config.password_version=2;
  await denied(()=>f.create().authenticateCurrentManager(f.req,{requireCsrf:true}));
  f=fixture();delete f.req.headers['x-device-security-csrf'];
  await denied(()=>f.create().authenticateCurrentManager(f.req,{requireCsrf:true}));
});
await test('revocation during security await cannot adopt initial auth',async()=>{
  const f=fixture();f.securityStore.findDeviceSecuritySession=async()=>{f.credential.revoked_at=new Date().toISOString();return structuredClone(f.session);};
  await denied(()=>f.create().authenticateCurrentManager(f.req,{requireCsrf:true}));
});
await test('changed caller headers during await refuse dispatch ownership',async()=>{
  const f=fixture();f.securityStore.findDeviceSecuritySession=async()=>{f.req.headers.authorization='Bearer successor';return structuredClone(f.session);};
  await denied(()=>f.create().authenticateCurrentManager(f.req,{requireCsrf:true}));
});
await test('exact session row rejects foreign returned session identity',async()=>{
  const f=fixture();f.session.session_id='95000000-0000-4000-8000-000000000004';
  await denied(()=>f.create().authenticateCurrentManager(f.req,{requireCsrf:true}));
});
await test('read-only preview binding retains comparison pin but never confirmation CSRF authority',async()=>{
  const f=fixture();f.req.method='GET';delete f.req.headers['x-device-security-csrf'];
  const a=f.create(),issuer=await a.authenticateCurrentManager(f.req,{requireCsrf:false});
  const value=a.inspectAuthenticatedIssuer(issuer);assert.equal(value.confirmation_csrf_verified,false);
  assert.equal(value.security_csrf_hash,f.session.csrf_hash);assert.equal(value.transaction_authority,false);
});
console.log(JSON.stringify({new_cases:cases,scope:'ACTUAL_SOURCE_AUTH_WITH_SYNTHETIC_STORE_AND_SIGNED_SESSION',SQL:false,real_manager:false,transaction_authority:false,effects:false}));
