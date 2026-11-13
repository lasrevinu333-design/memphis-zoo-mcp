import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {authenticateDeviceCredentialRequest,makeDeviceCredentialMiddleware,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';
import {createEventsEmployeeRouter} from '../src/events-api.js';

// Actual HTTP/router/auth/resolver composition. Only DB records are synthetic;
// bigint strings match the observed PostgreSQL read representation on KIOSK_08.
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={DEVICE_CREDENTIAL_SECRET:'synthetic-events-bigint-auth-secret'};
const secret='synthetic-events-credential-secret-value';
function fixture(epoch='1'){
 const device={requested_device_id:'KIOSK_08',matched_by:'canonical',matched_alias:null,
  canonical_device_pk:id(1),canonical_device_id:'KIOSK_08',device_id:'KIOSK_08',device_active:true,
  assigned_employee_id:id(2),assignment_epoch:epoch,assigned_employee_name:'Synthetic employee',
  employee_code:'EMP007',role:'staff',employee_active:true};
 const credential={credential_id:id(3),device_id:id(1),token_hash:deviceCredentialInternals.tokenHash(secret,env),
  confirmed_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),revoked_at:null,
  metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)};
 const state={device,credential,reads:0,writes:0,afterSchools:()=>{}};
 const write=()=>{state.writes++;throw Error('Readonly authentication attempted a write');};
 const store={getPolicy:async()=>({mode:'enforce'}),findCredential:async()=>({...state.credential}),touchCredential:write,audit:write,insertAudit:write};
 const read=async sql=>{if(sql.includes('with requested as')){state.reads++;return[{...state.device}];}return[];};
 const options={env,store,runReadOnlySql:read,requireEnrolledCredential:true,readOnlyValidation:true};
 const app=express();app.use('/employee-events-api',createEventsEmployeeRouter({runReadOnlySql:read,appVersion:'test',releaseId:'test',
  requireDeviceAccess:makeDeviceCredentialMiddleware(options),
  readSchools:async()=>{state.afterSchools();return null;},
  revalidateDeviceAccess:req=>authenticateDeviceCredentialRequest(req,options)}));
 return{state,app,headers:{authorization:`Device ${id(3)}.${secret}`,'x-device-id':'KIOSK_08'}};
}
async function request(f){const server=await new Promise(resolve=>{const s=f.app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{const response=await fetch(`http://127.0.0.1:${server.address().port}/employee-events-api`,{headers:f.headers});return{status:response.status,body:await response.json()};}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(f.state.writes,0);}}

for(const epoch of ['1',1,'9007199254740991'])test(`actual employee Events admits exact safe epoch ${JSON.stringify(epoch)} without writes`,async()=>{
 const f=fixture(epoch),result=await request(f);assert.equal(result.status,200,JSON.stringify(result.body));
 assert.equal(result.body.meta.assignment_epoch,Number(epoch));assert.equal(result.body.meta.employee_id,id(2));assert.equal(f.state.reads,2);
 assert.equal(f.state.device.assignment_epoch,epoch,'original DB row not mutated');
});
for(const epoch of [null,undefined,'',0,'0',-1,'-1','01','1.0','1e0',' 1',true,{},[],1.5,'9007199254740992',9007199254740992])
 test(`invalid or unsafe assignment refused: ${JSON.stringify(epoch)}`,async()=>{const f=fixture();f.state.device.assignment_epoch=epoch;assert.equal((await request(f)).status,401);});
for(const [name,change,status] of [
 ['reassignment',f=>{f.state.device.assignment_epoch='2';},403],
 ['employee replacement',f=>{f.state.device.assigned_employee_id=id(4);},403],
 ['revocation',f=>{f.state.credential.revoked_at=new Date().toISOString();},401],
 ['expiration',f=>{f.state.credential.expires_at=new Date(0).toISOString();},401],
 ['unconfirmed',f=>{f.state.credential.confirmed_at=null;},401],
 ['missing secret generation',f=>{f.state.credential.metadata_json={};},401],
])test(`post-read ${name} still refuses the feed`,async()=>{const f=fixture();f.state.afterSchools=()=>change(f);assert.equal((await request(f)).status,status);});
