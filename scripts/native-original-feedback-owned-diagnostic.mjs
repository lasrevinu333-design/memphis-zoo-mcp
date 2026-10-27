import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const verbs=new Set(['status','claim','begin','receipt','defer','control','attachment_internal']);
const sha=value=>createHash('sha256').update(value).digest('hex');
const actions=new Set(['prepare_preflight','resume_preflight_verified','pause','prepare','complete','reject']);
const secretKeys=new Set(['claim_token','challenge_nonce','preflight_challenge_nonce','token','access_token','refresh_token','secret','authorization']);

// Qualification DATA only. The owning fixture keeps the secret set private;
// this collector never receives SDK authInfo or exports an authorization port.
export function rememberFeedbackDiagnosticSecrets(value,secrets,depth=0) {
 assert.ok(secrets instanceof Set);assert.ok(depth<=32);
 if(!value||typeof value!=='object')return;
 for(const [key,child] of Object.entries(value)) {
  if(secretKeys.has(key.toLowerCase())&&typeof child==='string'&&child.length>=8)secrets.add(child);
  else if(child&&typeof child==='object')rememberFeedbackDiagnosticSecrets(child,secrets,depth+1);
 }
}
export function projectFeedbackOwnedDiagnostic({verb,request={},result,error,secretValues}) {
 assert.ok(verbs.has(verb));assert.ok(secretValues instanceof Set);
 const redact=input=>{
  let text=String(input);
  // Longest first prevents a credential prefix from exposing its suffix.
  for(const secret of [...secretValues].sort((a,b)=>b.length-a.length))if(typeof secret==='string'&&secret.length>=8)text=text.split(secret).join('[REDACTED]');
  return text.replace(/\b(?:Bearer|Device)\s+[^\s"'<>]+/gi,'[AUTH_REDACTED]')
   .replace(/\b["']?(?:authorization|access_token|refresh_token|claim_token|challenge_nonce|token|secret)["']?\s*[=:]\s*["']?[^\s,"'}]+/gi,'[SECRET_FIELD_REDACTED]');
 };
 const id=typeof request.request_id==='string'&&/^[a-f0-9-]{36}$/i.test(request.request_id)?request.request_id:null;
 const out={schema:'custodial.owned-feedback-relay-diagnostic.v1',verb,request_id:id,action:actions.has(request.action)?request.action:null,scope:'SYNTHETIC_OWNED_LOCAL_DIAGNOSTIC_NOT_AUTHORITY'};
 if(result!==undefined) {
  assert.ok(result&&typeof result==='object'&&Array.isArray(result.content));
  const encoded=Buffer.from(JSON.stringify(result.content));assert.ok(encoded.length<=65536,'MCP diagnostic exceeds owned bound');
  out.is_error=result.isError===true;out.response_content_sha256=sha(encoded);out.response_content_bytes=encoded.length;
  if(out.is_error) {
   const content=result.content.map(block=>block?.type==='text'&&typeof block.text==='string'?{type:'text',text:redact(block.text)}:{type:'UNSUPPORTED_BLOCK_OMITTED'});
   const text=JSON.stringify(content);out.redacted_error_content=text.slice(0,8192);out.redacted_error_content_truncated=text.length>8192;
  }
  encoded.fill(0);
 }
 if(error!==undefined) {
  out.sql_state=typeof error?.code==='string'&&/^[A-Z0-9]{5}$/.test(error.code)?error.code:null;
  out.redacted_error_message=redact(error?.message||'OWNED_RELAY_RPC_REFUSED').slice(0,8192);
  out.catalog={};for(const key of ['schema','table','constraint','routine','severity'])if(typeof error?.[key]==='string'&&/^[A-Za-z0-9_.-]{1,192}$/.test(error[key]))out.catalog[key]=redact(error[key]);
  // Never export detail/hint/query/parameters/where/authInfo/SDK metadata.
 }
 return out;
}
