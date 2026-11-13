import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {canonicalJson} from '../src/static-weekly-schedule-model.js';
import {coverAllAccessTokenHash,coverAllCanonicalBinding,scopeCanonicalCoverAllDocument,renderCanonicalCoverAllLink} from '../src/static-weekly-coverall-access.js';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
const id=n=>`12000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const seal=x=>({...x,documentDigest:createHash('sha256').update(canonicalJson(x)).digest('hex')});
const doc=()=>seal({schema:'custodial.coverall-accepted-print.v1',serviceDate:'2026-10-26',authorityRevision:19,
 publicationId:id(1),projectionId:id(2),replayDigest:'a'.repeat(64),lunchDocumentIdentity:'b'.repeat(64),show0945:false,
 contractors:[1,2].map(n=>({slotId:id(n+2),name:`CAPACITY_${n}`,shift:{start:'07:00',end:'15:00'},lunch:null,periods:[],shiftEndHandoffs:[]})),
 contractorCompletionRecorder:'ERIC_OPERLE_PERSONAL_VERIFICATION',guidanceVersion:'custodial.coverall-guidance.v1',
 managerContact:{name:'Synthetic issuing manager',managerId:id(90),method:'IN_PERSON',authority:'AUTHENTICATED_NAMED_MANAGER'}});
let checks=0;const check=(name,run)=>{run();checks++;console.log('PASS',name);};
const original=doc(),binding=coverAllCanonicalBinding(original,id(3)),scoped=scopeCanonicalCoverAllDocument(original,binding);
check('explicit accepted capacity only; never employee-code mapping',()=>{assert.equal(scoped.contractors.length,1);assert.equal(scoped.contractors[0].slotId,id(3));});
check('foreign capacity denied',()=>assert.throws(()=>coverAllCanonicalBinding(original,id(99))));
check('legacy COVERALL_01 is not a capacity identity',()=>assert.throws(()=>coverAllCanonicalBinding(original,'COVERALL_01')));
for(const field of ['serviceDate','authorityRevision','publicationId','projectionId','replayDigest','lunchDocumentIdentity']){
 const {documentDigest,...base}=original;const changed=seal({...base,[field]:field==='authorityRevision'?20:field==='serviceDate'?'2026-10-27':field.endsWith('Digest')||field==='lunchDocumentIdentity'?'c'.repeat(64):id(99)});
 check('changed current '+field+' denied',()=>assert.throws(()=>scopeCanonicalCoverAllDocument(changed,binding)));
}
check('tampered current body denied',()=>assert.throws(()=>scopeCanonicalCoverAllDocument({...original,contractors:[]},binding)));
for(const lang of ['en','es','both'])check('canonical selected capacity renders '+lang,()=>{const html=renderCanonicalCoverAllLink(scoped,lang);assert.ok(html.includes('CAPACITY_1'));assert.ok(!html.includes('CAPACITY_2'));});
check('unsupported language denied',()=>assert.throws(()=>renderCanonicalCoverAllLink(scoped,'all')));
check('opaque token is hashed, never returned by binding',()=>{assert.equal(coverAllAccessTokenHash('A'.repeat(43)).length,64);assert.ok(!JSON.stringify(binding).includes('access_token'));});
for(const bad of ['', 'A'.repeat(42), 'A'.repeat(44), '../bad'])check('invalid opaque token denied',()=>assert.throws(()=>coverAllAccessTokenHash(bad)));
const env={NODE_ENV:'test',SUPABASE_URL:'https://unit.invalid',SUPABASE_SERVICE_ROLE_KEY:'unit-service-key',OPS_MANAGER_SESSION_SECRET:'unit-private-link-test-only-session-secret-0123456789'};
const manager={manager_id:id(90),display_name:'Synthetic issuing manager',system_key:'eric_custodial_manager',is_system_principal:false,roles:['OPS_MANAGER'],active:true};
const credentialId=id(91),deviceId='UNIT_DEVICE',session=createOpsManagerSession({credentialId,deviceId,manager,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env});
let mode='current',reads=0,issues=0,revokes=0,currentSession=true;
const cp={async runManagerOperation(ctx,run){return run();},async readCoverAllAssignmentLink(){reads++;if(mode==='revoked'||mode==='expired'||mode==='issuer_revoked'||mode==='stale')throw Error('UNIT denied');if(mode==='during_render'&&reads%2===0)return {...scoped,documentDigest:'c'.repeat(64)};return scoped;},
 async issueCoverAllAssignmentLink(input){issues++;assert.equal(input.capacityId,id(3));assert.equal(input.requestId,id(95));return{schema:'custodial.coverall-canonical-link.v1',link_id:input.requestId};},
 async revokeCoverAllAssignmentLink(input){revokes++;assert.equal(input.linkId,id(95));return{link_id:input.linkId,revoked:true};}};
const runtime=createStaticWeeklyControlPlaneRuntime({env,database:{},controlPlane:cp,datedTransitionController:null,
 trustedDeviceStore:{async find(){return currentSession?{credential_id:credentialId,device_id:deviceId,max_access_level:'full_access',created_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),manager_id:manager.manager_id,manager}:null;}},
 supabase:{async rpc(name){return {data:name==='custodial_begin_application_mutation_lease'?{mutations_paused:false,state:'READY',authority_generation:0,restore_id:null}:true,error:null};}}});
const server=createServer(runtime.app);await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});
try{
 const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/static-weekly/coverall-links/assignment?lang=both',publicHeaders={'X-CoverAll-Access-Token':'A'.repeat(43)};
 const boot=await fetch(url);assert.equal(boot.status,200);const bootstrap=await boot.text();assert.match(bootstrap,/location.hash/);assert.equal(reads,0);checks++;
 const csp=boot.headers.get('content-security-policy');assert.match(csp,/(?:^|;)\s*connect-src 'self'(?:;|$)/);assert.ok(!csp.includes('https:')&&!csp.includes('*'));checks++;
 const script=bootstrap.match(/<script>([\s\S]*?)<\/script>/)[1];assert.ok(csp.includes("'sha256-"+createHash('sha256').update(script).digest('base64')+"'"));checks++;
 for(const variant of ['valid','malformed','redirect']){
  const trace=[],location={hash:variant==='malformed'?'#access_token=bad':'#access_token='+ 'A'.repeat(43),pathname:'/static-weekly/coverall-links/assignment',search:'?lang=both'};
  const document={body:{textContent:''},open(){trace.push('open');},write(html){trace.push(['html',html]);},close(){trace.push('close');}};
  await vm.runInNewContext(script,{URLSearchParams,location,history:{replaceState(state,title,url){trace.push(['clear',url]);location.hash='';}},document,
   fetch:async(path,options)=>{trace.push(['fetch',path,options]);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.headers['X-CoverAll-Access-Token'],'A'.repeat(43));if(variant==='redirect')throw Error('redirect blocked');return {ok:true,async text(){return '<html>UNIT scoped canonical handout</html>';}};}});
  assert.equal(trace[0][0],'clear');assert.equal(location.hash,'');assert.ok(!trace[0][1].includes('access_token'));
  if(variant==='valid')assert.ok(trace.some(x=>Array.isArray(x)&&x[0]==='html'));
  else{assert.ok(!trace.some(x=>Array.isArray(x)&&x[0]==='html'));assert.ok(document.body.textContent.includes('unavailable'));}
  if(variant==='malformed')assert.ok(!trace.some(x=>Array.isArray(x)&&x[0]==='fetch'));
  checks++;
 }

 const rejectedQuery=await fetch(url+'&access_token='+ 'A'.repeat(43));assert.equal(rejectedQuery.status,403);assert.equal(reads,0);checks++;
 let r=await fetch(url,{headers:publicHeaders});assert.equal(r.status,200);assert.equal(reads,2);assert.match(r.headers.get('referrer-policy'),/no-referrer/);checks++;
 for(mode of ['revoked','expired','issuer_revoked','stale','during_render']){reads=0;r=await fetch(url,{headers:publicHeaders});assert.equal(r.status,403,mode);assert.ok(!(await r.text()).includes('CAPACITY_1'));checks++;}
 const body={week_start:'2026-10-26',service_date:'2026-10-26',expected_revision:19,projection_id:id(2),capacity_id:id(3),ttl_hours:24,request_id:id(95)};
 r=await fetch(origin+'/static-weekly/coverall-links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,401);assert.equal(issues,0);checks++;
 r=await fetch(origin+'/static-weekly/coverall-links',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:JSON.stringify(body)});assert.equal(r.status,200);assert.equal(issues,1);checks++;
 r=await fetch(origin+'/static-weekly/coverall-links/revoke',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:JSON.stringify({link_id:id(95)})});assert.equal(r.status,200);assert.equal(revokes,1);checks++;
 currentSession=false;r=await fetch(origin+'/static-weekly/coverall-links',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:JSON.stringify(body)});assert.equal(r.status,401);assert.equal(issues,1);checks++;
}finally{await new Promise((ok,no)=>server.close(e=>e?no(e):ok()));}
console.log(JSON.stringify({status:'PASS',checks,scope:'actual JS canonical scoping and loopback HTTP routes; current DB result mocked, SQL/production behavior NOT qualified'}));
