import assert from 'node:assert/strict';
import express from 'express';
import {createSupabaseTrustedDeviceStore, installSharedAuthRoutes} from '../src/auth/shared-access-auth.js';

const owner={manager_id:'00000000-0000-4000-8000-000000000001',display_name:'Fixture owner',
  roles:['OPS_MANAGER','CUSTODIAL_MANAGER','SECURITY_ADMIN'],active:true,revoked_at:null,
  system_key:'eric_custodial_manager',is_system_principal:false};
const device='CUSTODIAL-MAINTENANCE-00000000-0000-4000-8000-000000000002';
let registry=owner, rpcOk=true, mismatched=false, registryError=false, reads=0;
const db={
  async rpc(name,args){
    assert.equal(name,'ops_manager_consume_enrollment_code');
    if(!rpcOk)return {data:{ok:false,status:401,reason:'invalid'},error:null};
    // Exact legacy RPC shape: these authorization fields are absent in production.
    const {system_key,is_system_principal,...legacy}=owner;
    return {data:{ok:true,manager:{...legacy,manager_id:mismatched?'00000000-0000-4000-8000-000000000003':owner.manager_id},
      trusted_device:{credential_id:args.p_credential_id,device_id:args.p_device_id,
        manager_id:owner.manager_id,max_access_level:'full_access',expires_at:args.p_expires_at}},error:null};
  },
  from(table){
    assert.equal(table,'ops_manager_managers');
    return {select(fields){
      assert.ok(fields.split(',').includes('system_key'));
      assert.ok(fields.split(',').includes('is_system_principal'));
      return {eq(column,id){
        assert.equal(column,'manager_id');assert.equal(id,owner.manager_id);
        return {async maybeSingle(){reads++;return {data:registry,error:registryError?new Error('fixture registry unavailable'):null};}};
      }};
    }};
  }
};
const store={...createSupabaseTrustedDeviceStore(db),async audit(){},async getManagerCodeRateLimit(){return null;},
  async clearManagerCodeFailures(){},async recordManagerCodeFailure(){return {};}};
const env={NODE_ENV:'production',RENDER:'1',OPS_MANAGER_SESSION_SECRET:'synthetic-enrollment-registry-test-only'};
const app=express();app.use(express.json());installSharedAuthRoutes(app,{env,trustedDeviceStore:store,setCors(){}});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`;
async function consume(access='full_access'){
  const response=await fetch(base+'/auth-api/ops/manager-codes/consume',{method:'POST',
    headers:{Origin:'https://lasrevinu333-design.github.io','Content-Type':'application/json','X-Device-Id':device},
    body:JSON.stringify({manager_code:'12345678',device_id:device,device_label:'Synthetic maintenance fixture',access_level:access})});
  return {status:response.status,cookie:response.headers.get('set-cookie'),body:await response.json()};
}
let checks=0;
try{
  const full=await consume();assert.equal(full.status,200);assert.equal(full.body.data.session.access_level,'full_access');
  assert.equal(full.body.data.session.permissions.owner,true);assert.ok(full.body.data.session.roles.includes('CUSTODIAL_MANAGER'));
  assert.equal(full.body.data.session.trusted_device,true);assert.equal(full.body.data.session.device_id,device);
  assert.equal(full.body.data.session.manager_id,owner.manager_id);assert.equal(reads,1);checks++;
  if(process.env.MAINTENANCE_CLIENT_FIXTURE){
    const {validateSession}=await import(process.env.MAINTENANCE_CLIENT_FIXTURE);
    validateSession(full.body.data.session,device);checks++;
  }
  const ro=await consume('read_only');assert.equal(ro.body.data.session.access_level,'read_only');
  assert.equal(ro.body.data.session.permissions.owner,false);checks++;
  for(const changed of [{system_key:'ordinary_manager'},{active:false},{revoked_at:new Date().toISOString()},
    {is_system_principal:true},{system_key:undefined,is_system_principal:undefined}]){
    registry={...owner,...changed};const denied=await consume();assert.equal(denied.status,200);
    assert.equal(denied.body.data.session.access_level,'read_only');assert.equal(denied.body.data.session.permissions.owner,false);checks++;
  }
  registry=null;let denied=await consume();assert.equal(denied.status,500);assert.equal(denied.cookie,null);checks++;
  registry=owner;registryError=true;denied=await consume();assert.equal(denied.status,500);assert.equal(denied.cookie,null);checks++;
  registryError=false;mismatched=true;const before=reads;denied=await consume();assert.equal(denied.status,500);
  assert.equal(denied.cookie,null);assert.equal(reads,before);checks++;
  mismatched=false;rpcOk=false;denied=await consume();assert.equal(denied.status,401);assert.equal(reads,before);checks++;
  console.log(JSON.stringify({ok:true,checks,scope:'synthetic loopback enrollment with protected-registry fixture; no production calls'}));
}finally{await new Promise((r,j)=>server.close(e=>e?j(e):r()));}
