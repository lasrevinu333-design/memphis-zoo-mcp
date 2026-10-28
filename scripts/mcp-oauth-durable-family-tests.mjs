import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import express from 'express';
import {createSelfContainedMcpOAuthService,verifyMcpOAuthAccessToken} from '../src/auth/mcp-self-contained-oauth.js';

// Recording atomic database model, explicitly NOT SQL qualification. It survives
// service reconstruction and is shared by independent service objects. Real SQL
// lock/ACL tests below remain a separately admitted local-database obligation.
export function createRecordingAtomicOAuthAuthority(){
  let state={artifacts:new Map(),families:new Map()},tail=Promise.resolve(),currentGeneration="0";
  const authority={failure:null,transactions:0,
    generation:async()=>currentGeneration,
    advanceGeneration(){currentGeneration=String(BigInt(currentGeneration)+1n);},
    restoreEarlier(snapshot){state=structuredClone(snapshot);},
    async transaction(operation){const prior=tail;let unlock;tail=new Promise(r=>unlock=r);await prior;
      try{const next=structuredClone(state);const result=operation(next);authority.transactions++;
        if(authority.failure==='rollback'){authority.failure=null;throw Error('Simulated transaction rollback');}
        state=next;
        if(authority.failure==='unknown-after-commit'){authority.failure=null;throw Error('Simulated lost commit acknowledgement');}
        return result;
      }finally{unlock();}},
    consumeDecision:({artifactDigest,expiresAt,authorityGeneration})=>authority.transaction(s=>{
      if(authorityGeneration!==currentGeneration||expiresAt<=Date.now()/1000||s.artifacts.has(artifactDigest))return false;
      s.artifacts.set(artifactDigest,expiresAt);return true;}),
    exchange:({codeDigest,codeExpiresAt,familyDigest,bindingDigest,refreshDigest,expiresAt,authorityGeneration})=>authority.transaction(s=>{
      if(authorityGeneration!==currentGeneration||codeExpiresAt<=Date.now()/1000||s.artifacts.has(codeDigest))return false;
      assert.ok(!s.families.has(familyDigest));s.artifacts.set(codeDigest,codeExpiresAt);
      s.families.set(familyDigest,{bindingDigest,authorityGeneration,current:refreshDigest,generation:0,expiresAt,revoked:false});return true;}),
    rotate:({familyDigest,bindingDigest,previousDigest,generation,nextDigest,expiresAt,authorityGeneration})=>authority.transaction(s=>{
      const f=s.families.get(familyDigest);
      if(authorityGeneration!==currentGeneration||!f||f.authorityGeneration!==currentGeneration||f.bindingDigest!==bindingDigest||f.revoked||f.expiresAt<=Date.now()/1000)return false;
      if(f.current!==previousDigest||f.generation!==generation){f.revoked=true;return false;}
      Object.assign(f,{current:nextDigest,generation:generation+1,expiresAt});return true;}),
    active:({familyDigest,bindingDigest,authorityGeneration})=>authority.transaction(s=>{const f=s.families.get(familyDigest);
      return Boolean(authorityGeneration===currentGeneration&&f&&f.authorityGeneration===currentGeneration&&f.bindingDigest===bindingDigest&&!f.revoked&&f.expiresAt>Date.now()/1000);}),
    snapshot:()=>structuredClone(state),
  };return authority;
}
export async function runDurableOAuthHttpModelTests(){
  const app=express();app.use(express.json());app.use(express.urlencoded({extended:false}));
  let currentA;app.use((req,res,next)=>currentA.router(req,res,next));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const env={NODE_ENV:'test',MCP_OAUTH_ENABLED:'true',MCP_PUBLIC_URL:base,
    MCP_CONNECTOR_TOKEN:'synthetic-durable-oauth-connector-secret-32bytes',MOXIE_WEB_PASSWORD:'synthetic-operator-password'};
  const authority=createRecordingAtomicOAuthAuthority();
  const create=()=>createSelfContainedMcpOAuthService({env,durableStore:authority});currentA=create();
  const serviceB=create(),appB=express();appB.use(express.json());appB.use(express.urlencoded({extended:false}));appB.use(serviceB.router);
  const serverB=appB.listen(0,'127.0.0.1');await new Promise(r=>serverB.once('listening',r));
  const other=`http://127.0.0.1:${serverB.address().port}`;
  let checks=0;
  const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
  const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
  const verifier='synthetic-pkce-verifier-abcdefghijklmnopqrstuvwxyz-0123456789';
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const hidden=(html,key)=>html.match(new RegExp(`name="${key}" value="([^"]+)"`))?.[1]||'';
  const form=(body,cookie)=>({method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',...(cookie?{cookie}:{})},body:new URLSearchParams(body)});
  const cookie=r=>String(r.headers.get('set-cookie')||'').split(';')[0];
  let clientId;
  async function newCode({deferDecision=false}={}){
    const u=new URL(base+'/oauth/authorize');for(const [k,v] of Object.entries({response_type:'code',client_id:clientId,redirect_uri:redirect,
      resource:base+'/mcp',scope:'mcp:read mcp:write',code_challenge:challenge,code_challenge_method:'S256',state:'synthetic-state'}))u.searchParams.set(k,v);
    const start=await fetch(u,{redirect:'manual'}),html=await start.text();check(start.status,200,'normal authorize');
    const login=await fetch(base+'/oauth/login',form({request:hidden(html,'request'),csrf:hidden(html,'csrf'),password:env.MOXIE_WEB_PASSWORD},cookie(start)));
    const consentHtml=await login.text();check(login.status,200,'normal password and consent');
    const consent={request:hidden(consentHtml,'request'),csrf:hidden(consentHtml,'csrf'),decision:'approve'};
    if(deferDecision)return {consent,cookie:cookie(login)};
    const decision=await fetch(base+'/oauth/decision',form(consent,cookie(login)));check(decision.status,303,'normal consent');
    const code=new URL(decision.headers.get('location')).searchParams.get('code');assert.ok(code);
    return {code,consent,cookie:cookie(login)};
  }
  async function exchange(code,host=base){const r=await fetch(host+'/oauth/token',form({grant_type:'authorization_code',client_id:clientId,code,
    redirect_uri:redirect,resource:base+'/mcp',code_verifier:verifier}));return {status:r.status,body:await r.json()};}
  async function refresh(token,host=base){const r=await fetch(host+'/oauth/token',form({grant_type:'refresh_token',client_id:clientId,
    refresh_token:token,resource:base+'/mcp'}));return {status:r.status,body:await r.json()};}
  try{
    const registration=await fetch(base+'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      client_name:'Synthetic durable-family HTTP test',redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],
      response_types:['code'],token_endpoint_auth_method:'none',scope:'mcp:read mcp:write'})});
    check(registration.status,201,'existing registration contract');clientId=(await registration.json()).client_id;
    const first=await newCode();
    const reusedDecision=await fetch(other+'/oauth/decision',form(first.consent,first.cookie));check(reusedDecision.status,403,'decision one-use across instances');
    const initial=await exchange(first.code);check(initial.status,200,'atomic initial exchange');
    await currentA.verifyAccessToken(initial.body.access_token);checks++;
    currentA=create(); // New process-local service state, same durable authority.
    check((await exchange(first.code)).status,400,'code replay refused after reconstruction');
    check((await exchange(first.code,other)).status,400,'code replay refused by independent instance');
    const concurrent=await Promise.all([refresh(initial.body.refresh_token),refresh(initial.body.refresh_token,other)]);
    check(concurrent.map(r=>r.status).sort(),[200,400],'exactly one concurrent refresh wins');
    const winner=concurrent.find(r=>r.status===200).body;
    await assert.rejects(()=>serviceB.verifyAccessToken(winner.access_token));checks++;
    await assert.rejects(()=>currentA.verifyAccessToken(initial.body.access_token));checks++;
    check((await refresh(winner.refresh_token)).status,400,'reuse revokes descendants across instances');
    currentA=create();await assert.rejects(()=>currentA.verifyAccessToken(winner.access_token));checks++;
    const clean=await exchange((await newCode()).code);check(clean.status,200,'separate family unaffected');
    await currentA.verifyAccessToken(clean.body.access_token);checks++;
    const rollbackCode=(await newCode()).code,pre=authority.snapshot();authority.failure='rollback';const failed=await exchange(rollbackCode);
    check(failed.status,503,'issuance failure returns no token');check('access_token' in failed.body,false,'no failed issuance disclosure');
    check(authority.snapshot().families.size,pre.families.size,'failed transaction creates no family');
    const unknownCode=(await newCode()).code;authority.failure='unknown-after-commit';const unknown=await exchange(unknownCode);
    check(unknown.status,503,'unknown commit withholds tokens');check('access_token' in unknown.body,false,'unknown contains no token');
    check((await exchange(unknownCode,other)).status,400,'lost acknowledgement does not permit remint');
    const staleCode=await newCode(),staleConsent=await newCode({deferDecision:true});
    const beforeRotation=authority.snapshot();
    const previouslyCurrent=await refresh(clean.body.refresh_token);check(previouslyCurrent.status,200,'pre-restore refresh');
    authority.restoreEarlier(beforeRotation);authority.advanceGeneration();
    check((await refresh(clean.body.refresh_token,other)).status,400,'backup rollback cannot resurrect old current refresh');
    await assert.rejects(()=>serviceB.verifyAccessToken(clean.body.access_token));checks++;
    await assert.rejects(()=>currentA.verifyAccessToken(previouslyCurrent.body.access_token));checks++;
    check((await exchange(staleCode.code)).status,400,'old unconsumed code cannot mint a new-generation family');
    const oldDecision=await fetch(other+'/oauth/decision',form(staleConsent.consent,staleConsent.cookie));
    check(oldDecision.status,403,'old unconsumed consent cannot authorize after restore');
    const afterRestore=await exchange((await newCode()).code);check(afterRestore.status,200,'normal new-generation authorization');
    await currentA.verifyAccessToken(afterRestore.body.access_token);checks++;
    const config=currentA.config;
    const legacySource=await readFile(new URL('../../before.mcp-self-contained-oauth.js',import.meta.url),'utf8');
    const legacy=await import('data:text/javascript;base64,'+Buffer.from(legacySource.replace('import express from "express";',
      `import express from ${JSON.stringify(import.meta.resolve('express'))};`)+'\nexport {issueTokenPair,issueAuthorizationCode};').toString('base64'));
    const legacyPair=legacy.issueTokenPair(config,{clientId,scope:'mcp:read'},Math.floor(Date.now()/1000));
    assert.throws(()=>verifyMcpOAuthAccessToken(config,legacyPair.access_token));checks++;
    check((await refresh(legacyPair.refresh_token)).status,400,'legacy refresh requires reauthorization');
    const oldCode=legacy.issueAuthorizationCode(config,{client_id:clientId,redirect_uri:redirect,resource:base+'/mcp',scope:'mcp:read',
      code_challenge:challenge},Math.floor(Date.now()/1000));check((await exchange(oldCode)).status,400,'legacy code cannot populate new ledger');
    const unavailable=createSelfContainedMcpOAuthService({env:{...env,SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''}});
    await assert.rejects(()=>unavailable.verifyAccessToken(afterRestore.body.access_token));checks++;
    const req=header=>({header:name=>name==='x-memphis-connector-token'?header:''});
    check((await unavailable.authenticateRequest(req(env.MCP_CONNECTOR_TOKEN))).auth.source,'connector_token','legacy connector remains independent of store');
    check((await unavailable.authenticateRequest(req(''))).auth.source,'anonymous','anonymous discovery remains unchanged');
    const badStore={...authority,active:async()=>false};const rejecting=createSelfContainedMcpOAuthService({env,durableStore:badStore});
    await assert.rejects(()=>rejecting.verifyAccessToken(afterRestore.body.access_token));checks++;
    console.log(JSON.stringify({scope:'Real HTTP OAuth flow; shared recording atomic authority only. SQL/ACL qualification pending.',checks,result:'PASS'}));
    return checks;
  }finally{server.closeAllConnections();serverB.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>serverB.close(r))]);}
}
export async function runDurableOAuthAdapterTests(){
  const {createMcpOAuthDurableStore}=await import('../src/auth/mcp-oauth-durable-store.js');
  const originalFetch=globalThis.fetch,calls=[];let mode='ok',checks=0;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://synthetic-oauth.invalid');
    assert.ok(init.signal instanceof AbortSignal);calls.push({path:url.pathname,args:JSON.parse(init.body)});
    if(mode==='error')return new Response(JSON.stringify({message:'synthetic RPC unavailable'}),{status:503,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify(mode==='array'?[true]:url.pathname.endsWith('authority_generation_v2')?'9223372036854775807':true),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    assert.equal(createMcpOAuthDurableStore({}),null);checks++;
    const store=createMcpOAuthDurableStore({SUPABASE_URL:'https://synthetic-oauth.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-only-key'});
    const digest='a'.repeat(64),next='b'.repeat(64),authorityGeneration='9223372036854775807';
    assert.equal(await store.generation(),authorityGeneration);checks++;calls.length=0;
    for(const run of [()=>store.consumeDecision({artifactDigest:digest,expiresAt:123,authorityGeneration}),
      ()=>store.exchange({codeDigest:digest,codeExpiresAt:123,familyDigest:digest,bindingDigest:digest,refreshDigest:null,expiresAt:456,authorityGeneration}),
      ()=>store.rotate({familyDigest:digest,bindingDigest:digest,previousDigest:digest,generation:0,nextDigest:next,expiresAt:456,authorityGeneration}),
      ()=>store.active({familyDigest:digest,bindingDigest:digest,authorityGeneration})]){assert.equal(await run(),true);checks++;}
    assert.deepEqual(calls.map(r=>r.path),['consume_decision','exchange_code','rotate_refresh','family_active'].map(name=>'/rest/v1/rpc/mcp_oauth_'+name+'_v2'));checks++;
    assert.deepEqual(calls[2].args,{p_family_digest:digest,p_binding_digest:digest,p_previous_digest:digest,p_generation:0,p_next_digest:next,p_expires_at:456,p_authority_generation:authorityGeneration});checks++;
    mode='array';await assert.rejects(()=>store.active({familyDigest:digest,bindingDigest:digest,authorityGeneration}));checks++;
    mode='error';await assert.rejects(()=>store.active({familyDigest:digest,bindingDigest:digest,authorityGeneration}));checks++;
    console.log(JSON.stringify({scope:'Actual Supabase client RPC adapter with intercepted synthetic fetch; network/SQL=0',checks,result:'PASS'}));
  }finally{globalThis.fetch=originalFetch;}
}
export async function runAsyncIssuanceFailureTests(){
  const app=express();app.use(express.json());app.use(express.urlencoded({extended:false}));let service;
  app.use((req,res,next)=>service.router(req,res,next));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`,authority=createRecordingAtomicOAuthAuthority();
  const env={NODE_ENV:'test',MCP_OAUTH_ENABLED:'true',MCP_PUBLIC_URL:base,MCP_CONNECTOR_TOKEN:'synthetic-async-oauth-service-root-secret',MOXIE_WEB_PASSWORD:'synthetic-password'};
  const create=()=>createSelfContainedMcpOAuthService({env,durableStore:authority});service=create();let checks=0;
  const redirect='https://chatgpt.com/connector_platform_oauth_redirect',verifier='synthetic-async-verifier-abcdefghijklmnopqrstuvwxyz-0123456789';
  const form=(body,cookie)=>({method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',...(cookie?{cookie}:{})},body:new URLSearchParams(body)});
  const hidden=(html,key)=>html.match(new RegExp(`name="${key}" value="([^"]+)"`))?.[1]||'';
  const cookie=r=>String(r.headers.get('set-cookie')||'').split(';')[0];
  const fail=()=>{throw new Error('Synthetic entropy failure');};
  try{
    const registration=await fetch(base+'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Synthetic failure only',redirect_uris:[redirect],scope:'mcp:read'})});
    assert.equal(registration.status,201);checks++;const clientId=(await registration.json()).client_id;
    const url=new URL(base+'/oauth/authorize');for(const [k,v]of Object.entries({response_type:'code',client_id:clientId,redirect_uri:redirect,resource:base+'/mcp',scope:'mcp:read',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))url.searchParams.set(k,v);
    service=createSelfContainedMcpOAuthService({env,durableStore:authority,random:fail});
    const before=authority.snapshot();const failedPrepare=await fetch(url,{redirect:'manual'});
    assert.equal(failedPrepare.status,503);checks++;assert.equal(failedPrepare.headers.get('location'),null);checks++;
    assert.equal(authority.snapshot().artifacts.size,before.artifacts.size);checks++;
    service=create();const start=await fetch(url,{redirect:'manual'}),html=await start.text();assert.equal(start.status,200);checks++;
    const login=await fetch(base+'/oauth/login',form({request:hidden(html,'request'),csrf:hidden(html,'csrf'),password:env.MOXIE_WEB_PASSWORD},cookie(start)));
    const consentHtml=await login.text();assert.equal(login.status,200);checks++;
    const decision={request:hidden(consentHtml,'request'),csrf:hidden(consentHtml,'csrf'),decision:'approve'},consentCookie=cookie(login);
    service=createSelfContainedMcpOAuthService({env,durableStore:authority,random:fail});
    const beforeCode=authority.snapshot();const failedCode=await fetch(base+'/oauth/decision',form(decision,consentCookie));
    assert.equal(failedCode.status,503);checks++;assert.equal(failedCode.headers.get('location'),null);checks++;
    assert.equal(authority.snapshot().families.size,beforeCode.families.size);checks++;
    assert.equal(authority.snapshot().artifacts.size,beforeCode.artifacts.size+1);checks++;
    service=create();const repeat=await fetch(base+'/oauth/decision',form(decision,consentCookie));assert.equal(repeat.status,403);checks++;
    console.log(JSON.stringify({scope:'Actual HTTP new asynchronous sealing failures; recording authority only, no SQL',checks,result:'PASS'}));
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  if(process.argv.includes('--async-failure-only'))await runAsyncIssuanceFailureTests();
  else if(process.argv.includes('--adapter-only'))await runDurableOAuthAdapterTests();
  else await runDurableOAuthHttpModelTests();
}
