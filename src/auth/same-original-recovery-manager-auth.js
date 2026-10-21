import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {makeOpsAccessMiddleware} from './shared-access-auth.js';
import {verifySameOriginalRecoverySecuritySession} from './device-credential-auth.js';

// Unmounted until the Main-owned original challenge and transactional ledger
// exist. Ingress authentication is a current observation, NOT a SQL fence or
// a native approval. Never serialize the private captured auth binding to UI.
function denied(status=403) {
  throw Object.assign(new Error('same_original_recovery_manager_denied'),
    {code:'same_original_recovery_manager_denied',status});
}
const digest=value=>createHash('sha256').update(String(value),'utf8').digest('hex');
export function createSameOriginalRecoveryManagerAuthenticator({env=process.env,trustedDeviceStore,securityStore}={}) {
  const captures=new WeakMap();
  const auth=makeOpsAccessMiddleware({env,trustedDeviceStore,requireWrite:true,
    requiredPermission:'write',requireTrustedDeviceStore:true,requireCurrentManagerAssociation:true});
  async function authenticateCurrentManager(req,{requireCsrf=false}={}) {
    if(typeof trustedDeviceStore?.find!=='function'||typeof securityStore?.getManager!=='function')denied(503);
    const originalHeaders=req.headers,headers=structuredClone(req.headers||{}),method=req.method,url=req.originalUrl;
    const request={headers,method,originalUrl:url,header(name){return headers[String(name).toLowerCase()]||'';}};
    let admitted=false,status=401;
    const response={status(value){status=value;return this;},json(){return this;}};
    await auth(request,response,()=>{admitted=true;});
    if(!admitted)denied(status);
    const first=structuredClone(request.memphisAuth);
    if(!first?.permissions?.owner||first.read_only!==false||first.trusted_device!==true
      ||!first.token||!first.manager_id||!first.credential_id||!first.device_id)denied();
    const security=await verifySameOriginalRecoverySecuritySession(request,{store:securityStore,env,requireCsrf});
    if(!security.ok)denied(security.status);
    const row=structuredClone(security.session);
    // Re-run the SAME signed headers after the password-session awaits; a
    // refreshed token/actor or a req.memphisAuth assignment cannot be adopted.
    admitted=false;await auth(request,response,()=>{admitted=true;});
    if(!admitted||!isDeepStrictEqual(first,request.memphisAuth))denied();
    const securityAgain=await verifySameOriginalRecoverySecuritySession(request,{store:securityStore,env,requireCsrf});
    const again=securityAgain.session;
    if(!securityAgain.ok||!row||!again||row.session_id!==again.session_id
      ||row.password_version!==again.password_version||row.token_hash!==again.token_hash
      ||row.csrf_hash!==again.csrf_hash||row.expires_at!==again.expires_at)denied();
    if(req.headers!==originalHeaders||!isDeepStrictEqual(headers,req.headers||{})
      ||method!==req.method||url!==req.originalUrl)denied();
    const issuer=Object.freeze({manager_id:first.manager_id,manager_credential_id:first.credential_id,
      manager_device_id:first.device_id});
    // These hashes and expiry pins are transactional comparison inputs only;
    // current rows must still be revalidated under the intended ledger lock.
    const bound=Object.freeze({issuer,signed_session_sha256:digest(first.token),
      signed_session_expires_at:first.expires_at,security_session_id:again.session_id,
      security_password_version:again.password_version,security_token_hash:again.token_hash,
      security_csrf_hash:again.csrf_hash,confirmation_csrf_verified:requireCsrf===true,
      security_session_expires_at:again.expires_at,
      observation_only:true,transaction_authority:false});
    captures.set(issuer,bound);
    return issuer;
  }
  function inspectAuthenticatedIssuer(issuer) {
    const captured=captures.get(issuer);if(!captured)denied();return captured;
  }
  return Object.freeze({authenticateCurrentManager,inspectAuthenticatedIssuer});
}
