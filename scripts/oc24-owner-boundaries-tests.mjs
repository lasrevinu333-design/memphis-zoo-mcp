import assert from 'node:assert/strict';
import express from 'express';
import {partitionCustodialAbsences} from '../src/custodial-coverage-policy.js';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {installOperationalAnalyticsRoutes} from '../src/operational-analytics-api.js';
let checks=0;const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;};
for(let n=0;n<=9;n++){
 const ids=Array.from({length:n},(_,i)=>'employee-'+i),p=partitionCustodialAbsences([...ids,...ids]);
 check('no automatic contractor at absence count '+n,p.triggered,false);
 check('no invented capacity '+n,p.coverAllEmployeeIds,[]);
 check('all absent work remains explicit '+n,p.internallyRedistributedEmployeeIds,ids);
}
const env={NODE_ENV:'production',OPS_MANAGER_AUTH_REQUIRED:'true',OPS_MANAGER_SESSION_SECRET:'synthetic-oc24-manager-auth-secret-not-production'};
const managerId='11111111-1111-4111-8111-111111111111',credentialId='22222222-2222-4222-8222-222222222222',deviceId='OC24_SYNTHETIC_MANAGER';
const manager={manager_id:managerId,display_name:'Synthetic Manager',roles:['CUSTODIAL_MANAGER'],active:true,revoked_at:null};
const device={credential_id:credentialId,device_id:deviceId,manager_id:managerId,max_access_level:'full_access',created_at:new Date().toISOString(),last_used_at:null,expires_at:new Date(Date.now()+86400000).toISOString(),revoked_at:null};
let writes=0;const tables=[];
const db={from(table){tables.push(table);const data=table==='ops_manager_trusted_devices'?device:table==='ops_manager_managers'?manager:[];
 return {select(){return this},eq(){return this},gte(){return this},lt(){return this},order(){return this},limit(){return this},maybeSingle:async()=>({data,error:null}),then(resolve){return Promise.resolve({data,error:null}).then(resolve)},insert(){writes++;throw Error('unexpected write')},update(){writes++;throw Error('unexpected write')}};}};
const app=express();app.use(express.json());installOperationalAnalyticsRoutes(app,{env,supabase:db});
const server=app.listen(0,'127.0.0.1');await new Promise((ok,no)=>{server.once('listening',ok);server.once('error',no)});
try{
 const url=`http://127.0.0.1:${server.address().port}/analytics-api`;
 for(const level of ['full_access','read_only']){
  const token=createOpsManagerSession({credentialId,deviceId,manager,authMode:'trusted_device',accessLevel:level,maximumAccessLevel:'full_access',env}).token;
  const res=await fetch(url+'/inspections',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({session_id:managerId,overall_score:90})});
  const body=await res.json();
  check(level+' cannot record inspection: '+JSON.stringify(body),res.status,level==='full_access'?410:403);
  if(level==='full_access')check('exact retirement code',body.code,'inspection_recording_retired');
  if(level==='full_access')for(const route of ['cleaning-performance','session-facts','ticket-trends','inspections']){
   const result=await fetch(url+'/'+route,{headers:{Authorization:`Bearer ${token}`}});
   check('retained read '+route,result.status,200);
  }
 }
 check('no application write',writes,0);
 check('historical read remains possible',tables.includes('cleaning_inspections'),true);
 const denied=await fetch(url+'/inspections',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 check('unauthenticated still denied',denied.status,401);
}finally{await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({checks,failed:0,scope:'actual HTTP/auth with synthetic database adapter; no production or engine claim'}));
