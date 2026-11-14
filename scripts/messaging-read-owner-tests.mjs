import assert from 'node:assert/strict';
import {test} from 'node:test';
import express from 'express';
import {createHash,createHmac} from 'node:crypto';
import {createMessagingRouter} from '../src/messaging-api.js';
import {makeDeviceCredentialMiddleware,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';

// Only synthetic identities, an in-memory authority store and owned loopback.
// No real message, credential, database, reassignment or production request.
const id=n=>`ba000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// Exercise the real canonical-kiosk eligibility rule in this local fixture.
const deviceId='KIOSK_06',devicePk=id(1),employee=id(2),user=id(3),credentialId=id(4);
const otherEmployee=id(5),otherUser=id(6),thread=id(7);
async function scenario({path=`/thread/${thread}/messages`,at=null,change='assignment',requestedUser=false}={}){
  const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'synthetic-read-owner-secret-only'};
  const secret='synthetic-read-owner-credential-not-a-real-token';
  const now=new Date(),queries=[];let changed=false,authReads=0;
  let d={canonical_device_pk:devicePk,canonical_device_id:deviceId,device_id:deviceId,
    device_active:true,employee_active:true,assigned_employee_id:employee,assignment_epoch:'7',role:'employee',employee_code:'EMP9406'};
  let c={credential_id:credentialId,device_id:devicePk,
    token_hash:deviceCredentialInternals.tokenHash(secret,env),confirmed_at:now.toISOString(),revoked_at:null,
    expires_at:new Date(now.getTime()+86400000).toISOString(),metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)};
  let currentUser=user;
  const alter=stage=>{
    if(changed||at!==stage)return;changed=true;
    if(change==='assignment'){d={...d,assigned_employee_id:otherEmployee,assignment_epoch:'8'};currentUser=otherUser;}
    if(change==='epoch')d={...d,assignment_epoch:'8'};
    if(change==='credential')c={...c,revoked_at:now.toISOString()};
    if(change==='messenger')currentUser=otherUser;
    if(change==='missing')currentUser=null;
  };
  const store={async getPolicy(){return{mode:'enforced'};},async findCredential(){authReads++;return structuredClone(c);},
    async touchCredential(){},async audit(){}};
  const read=async sql=>{
    queries.push(sql);
    if(sql.includes('public.device_aliases'))return[structuredClone(d)];
    if(sql.includes('msg_get_user_by_device')){alter('identity');return currentUser?[{msg_user_id:currentUser,role:'employee'}]:[];}
    if(sql.includes('from public.devices d join public.employees')){
      alter('binding');
      if(!currentUser||!sql.includes(`e.id='${d.assigned_employee_id}'::uuid`)
        ||!sql.includes(`d.assignment_epoch='${d.assignment_epoch}'::bigint`))return[];
      return[{device_pk:devicePk,device_id:deviceId,employee_id:d.assigned_employee_id,
        assignment_epoch:d.assignment_epoch,user_id:currentUser}];
    }
    if(sql.includes('notification_state'))return[];
    if(sql.includes('msg_list_users')||sql.includes('from public.msg_threads')||sql.includes('from public.msg_messages')){
      assert.ok(sql.includes(user),'Only the admitted synthetic Messenger account may scope a data read');
      assert.ok(!sql.includes(otherUser),'A successor account must never scope this request');
      alter('payload');return[];
    }
    if(sql.includes('from public.msg_users')||sql.includes('join public.ops_manager_managers'))return[];
    throw Error('Unaccounted synthetic read boundary');
  };
  const normal=makeDeviceCredentialMiddleware({env,store,runReadOnlySql:read,requireEnrolledCredential:true});
  const app=express();app.use(express.json());
  app.use('/messaging-api',createMessagingRouter({runReadOnlySql:read,
    runRpc:async()=>{throw Error('No writer is allowed in this read fixture');},requireDeviceAccess:normal,
    buildHealthPayload:()=>({ok:true}),appVersion:'synthetic',releaseId:'synthetic',contractVersion:'messaging.v5'}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    const query=new URLSearchParams({device_id:deviceId,...(requestedUser?{user_id:user}:{}),
      ...(path.endsWith('/updates')?{after:'2026-01-01T00:00:00Z',after_id:id(0),wait_ms:'1'}:{})});
    const target=`/messaging-api${path}?${query}`,headers={'x-device-credential':credentialId+'.'+secret};
    if(path==='/me/by-device'){
      const version='custodial-native-request.v1',requestId=id(20),timestamp=new Date().toISOString();
      Object.assign(headers,{'x-memphis-native-attestation-version':version,'x-memphis-native-request-id':requestId,
        'x-memphis-native-request-timestamp':timestamp,'x-memphis-app-edition':'custodial',
        'x-memphis-native-request-attestation':createHmac('sha256',secret).update([version,credentialId,deviceId,
          'GET',target,createHash('sha256').update('').digest('hex'),requestId,timestamp,'custodial'].join('\n')).digest('hex')});
    }
    const response=await fetch(`http://127.0.0.1:${server.address().port}${target}`,{headers});
    return{status:response.status,body:await response.json(),queries,changed,authReads};
  }finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}

for(const path of ['/users','/threads',`/thread/${thread}/messages`,'/threads/updates',`/thread/${thread}/updates`]){
  test('unchanged admitted employee retains ordinary read access: '+path,async()=>{
    const r=await scenario({path});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.ok,true);assert.deepEqual(r.body.data,[]);
    assert.ok(r.authReads>=5,'Initial admission and both sides of binding/data reads are checked');
  });
  for(const at of ['identity','binding','payload'])test('changed assignment returns no data at '+at+': '+path,async()=>{
    const r=await scenario({path,at});assert.equal(r.changed,true);assert.notEqual(r.status,200);
    assert.equal(r.body.ok,false);assert.equal(r.body.data,undefined);
  });
}
for(const change of ['epoch','credential','messenger','missing']){
  test('late '+change+' withdrawal cannot return an ordinary message page',async()=>{
    const r=await scenario({at:'payload',change});assert.equal(r.changed,true);assert.notEqual(r.status,200);
    assert.equal(r.body.ok,false);assert.equal(r.body.data,undefined);
  });
}
test('a caller user ID never substitutes for a missing current Messenger account',async()=>{
  const r=await scenario({at:'identity',change:'missing',requestedUser:true});
  assert.notEqual(r.status,200);assert.equal(r.body.data,undefined);
  assert.equal(r.queries.some(sql=>sql.includes('from public.msg_messages')),false);
});

test('signed native startup identity retains the admitted employee',async()=>{
 const r=await scenario({path:'/me/by-device'});assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.data.msg_user_id,user);assert.equal(r.body.data.employee_id,employee);assert.equal(r.body.data.assignment_epoch,7);
});
for(const at of ['identity','binding'])test('startup identity refuses a changed assignment at '+at,async()=>{
 const r=await scenario({path:'/me/by-device',at});assert.equal(r.changed,true);assert.notEqual(r.status,200);assert.equal(r.body.data,undefined);
});

for(const path of ['/USERS/','/users/',`/THREAD/${thread}/MESSAGES/`]){
 test('Express alternate read spelling retains the same authority: '+path,async()=>{
  const r=await scenario({path});assert.equal(r.status,200,JSON.stringify(r.body));assert.ok(r.authReads>=5);
 });
 test('Express alternate read spelling refuses a late changed assignment: '+path,async()=>{
  const r=await scenario({path,at:'payload'});assert.equal(r.changed,true);assert.notEqual(r.status,200);assert.equal(r.body.data,undefined);
 });
}
