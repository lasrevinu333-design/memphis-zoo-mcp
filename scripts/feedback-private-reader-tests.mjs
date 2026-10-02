import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import {createOpsManagerSession,makeOpsAccessMiddleware} from '../src/auth/shared-access-auth.js';
import {makeFeedbackPrivateReader,feedbackManagerPageRedirect} from '../src/feedback-private-reader.js';
const id='91000000-0000-4000-8000-000000000001',managerId='91000000-0000-4000-8000-000000000002',credentialId='91000000-0000-4000-8000-000000000003';
const env={NODE_ENV:'production',OPS_MANAGER_AUTH_REQUIRED:'true',OPS_MANAGER_SESSION_SECRET:'synthetic-feedback-reader-test-only-secret'};
const manager={manager_id:managerId,display_name:'Different synthetic manager',roles:['CUSTODIAL_MANAGER'],active:true,revoked_at:null};
const trusted={credential_id:credentialId,device_id:'OPS_FEEDBACK_FIXTURE',device_label:'Feedback synthetic manager',
  token_hash:'synthetic-test-only-hash',created_at:new Date().toISOString(),manager_id:managerId,manager,
  max_access_level:'full_access',revoked_at:null,expires_at:new Date(Date.now()+86400000).toISOString()};
let reads=0;let mismatch=false;
const app=express();
app.get('/system-feedback.html',feedbackManagerPageRedirect);
app.get('/dashboard-api/system-feedback/:feedbackId',makeOpsAccessMiddleware({env,trustedDeviceStore:{find:async key=>key===credentialId?trusted:null}}),
  makeFeedbackPrivateReader({getItem:async key=>{reads++;return key===id?{id:mismatch?credentialId:key,status:'resolved',message:'Complete saved text',metadata_json:{image_attachment:{name:'historical.png'}}}:null;},attachDelivery:async rows=>rows}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const token=createOpsManagerSession({credentialId,deviceId:trusted.device_id,manager,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env}).token;
let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
try{
  let r=await fetch(`${origin}/dashboard-api/system-feedback/${id}`);eq(r.status,401);eq(reads,0);
  const headers={authorization:`Bearer ${token}`};
  r=await fetch(`${origin}/dashboard-api/system-feedback/not-a-uuid`,{headers});eq(r.status,422);eq(reads,0);
  r=await fetch(`${origin}/dashboard-api/system-feedback/${id}`,{headers});eq(r.status,200);eq(r.headers.get('cache-control'),'no-store');
  const body=await r.json();eq(body.data.id,id);eq(body.data.status,'resolved');eq(body.data.message,'Complete saved text');
  eq(body.data.metadata_json.image_attachment.name,'historical.png');
  mismatch=true;r=await fetch(`${origin}/dashboard-api/system-feedback/${id}`,{headers});eq(r.status,404);
  trusted.revoked_at=new Date().toISOString();const before=reads;r=await fetch(`${origin}/dashboard-api/system-feedback/${id}`,{headers});eq(r.status,401);eq(reads,before);
  r=await fetch(`${origin}/system-feedback.html?hub=employee&feedback=${id}&return=https://evil.invalid/&token=discard`,{redirect:'manual'});
  eq(r.status,302);eq(r.headers.get('location'),`https://lasrevinu333-design.github.io/Engine/system-feedback.html?hub=manager&feedback=${id}`);
  r=await fetch(`${origin}/system-feedback.html?feedback=evil`,{redirect:'manual'});eq(r.status,422);
  const index=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.match(index,/app\.get\("\/dashboard-api\/system-feedback\/:feedbackId", requireOpsManagerAuth,\s*makeFeedbackPrivateReader/);checks++;
  console.log(JSON.stringify({status:'FEEDBACK_PRIVATE_ITEM_HTTP_PASS',checks,actualAuth:true,fixtureRows:true,externalRequests:false}));
}finally{await new Promise(r=>server.close(r));}
