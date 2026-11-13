import assert from 'node:assert/strict';
import {once} from 'node:events';
import express from 'express';
import {installLeadershipHttpRoutes} from '../src/leadership-bootstrap.js';
const app=express(),safe={status:'ok',generated_at:'2026-10-31T01:00:00Z',operational_date:'2026-10-30',
 locations_total:23,locations_current:18,locations_overdue:2,locations_due_soon:2,locations_in_progress:1,cleanings_completed_today:77},
 db={rpc:async name=>{assert.equal(name,'public_viewer_dashboard_snapshot');return {data:[{...safe,upcoming_event_count_30d:99,
  employee_names:['PRIVATE_FIXTURE'],payroll:{hours:99},raw_reports:{private:true},credential:'PRIVATE_FIXTURE',new_future_private_column:'PRIVATE_FIXTURE'}]};}};
installLeadershipHttpRoutes(app,{supabase:db,env:{}});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
try{
 const origin='http://127.0.0.1:'+server.address().port;
 const response=await fetch(origin+'/viewer-api/dashboard');assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{ok:true,data:safe},'Anonymous snapshot must use the backend field allowlist');
 for(const method of ['POST','PUT','PATCH','DELETE']){
  const mutation=await fetch(origin+'/viewer-api/dashboard',{method,headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(mutation.status,404,'Viewer has no '+method+' mutation handler');
 }
 const privateRoute=await fetch(origin+'/leadership-api/roster');assert.equal(privateRoute.status,401,'Viewer cannot borrow management access');
 console.log(JSON.stringify({status:'PASS',scope:'Actual anonymous HTTP snapshot and route boundaries with synthetic overbroad database response',
  safeFields:Object.keys(safe).length,privateAndFutureFieldsExcluded:true,mutationMethodsRefused:4,managerAuthenticationStillRequired:true,productionWritten:false}));
}finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
