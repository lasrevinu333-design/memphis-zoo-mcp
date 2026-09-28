import assert from 'node:assert/strict';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
const manager={manager_id:'10000000-0000-4000-8000-000000000151',manager_display_name:'Synthetic manager',auth_mode:'trusted_device',trusted_device:true,read_only:false};
const key='30000000-0000-4000-8000-000000000151';
let checks=0;
function fixture(response,error=null){
 const calls=[];let connections=0,releases=0;
 const plane=createStaticWeeklyControlPlane({database:{connect:async()=>{
  connections++;return{query:async(sql,args)=>{
   calls.push({sql,args});if(sql.includes('static_weekly_v13_read_recurring_confirmation')||sql.includes('static_weekly_v25_read_current_recurring_delivery')){
    if(error)throw error;return{rows:[{result:response}]};
   }return{rows:[]};
  },release(){releases++;}};
 }},compiler:async()=>assert.fail('status must not compile'),initializeSolver:async()=>{},shutdownCompiler:async()=>{}});
 return{plane,calls,get connections(){return connections;},get releases(){return releases;}};
}
for(const response of [{state:'NOT_FOUND',confirmationKey:key},{state:'ACCEPTED',operationId:key,receipt:{immutable:'synthetic receipt is returned, never rehydrated'}}]){
 const f=fixture(response);
 assert.deepEqual(await f.plane.getRecurringConfirmationStatus({manager,confirmationKey:key}),response);checks++;
 assert.equal(f.connections,1);checks++;assert.equal(f.releases,1);checks++;
 assert.deepEqual(f.calls.filter(c=>c.sql.includes('static_weekly_v13_')),[{sql:'select public.static_weekly_v13_read_recurring_confirmation($1,$2) as result',args:[manager.manager_id,key]}]);checks++;
 assert.deepEqual(f.calls.map(c=>c.sql),['begin','set local role static_weekly_control_plane',"set local statement_timeout = '120000ms'",'select public.custodial_begin_application_mutation()','select public.static_weekly_v13_read_recurring_confirmation($1,$2) as result','commit']);checks++;
 await f.plane.close();
}
for(const error of [Object.assign(new Error('lock wait timeout'),{code:'55P03'}),Object.assign(new Error('connection terminated'),{code:'08006'})]){
 const f=fixture(null,error);
 await assert.rejects(()=>f.plane.getRecurringConfirmationStatus({manager,confirmationKey:key}));checks++;
 assert.ok(f.calls.some(c=>c.sql==='rollback'));checks++;
 assert.ok(!f.calls.some(c=>c.sql==='commit'));checks++;
 assert.equal(f.releases,1);checks++;
 await f.plane.close();
}
for(const args of [{manager:{...manager,read_only:true},confirmationKey:key},{manager,confirmationKey:'bad'},
 {manager:{...manager,auth_mode:'admin_api_key'},confirmationKey:key}]){
 const f=fixture(null);await assert.rejects(()=>f.plane.getRecurringConfirmationStatus(args));checks++;
 assert.equal(f.connections,0);checks++;await f.plane.close();
}
{
 const response={mode:'RECURRING_TERMINAL',affectedPhonesUpdated:false,targets:[{status:'PENDING'}]},f=fixture(response);
 assert.deepEqual(await f.plane.getCurrentRecurringDelivery({manager,serviceDate:'2026-10-05'}),response);checks++;
 assert.deepEqual(f.calls.find(c=>c.sql.includes('static_weekly_v25_')).args,['2026-10-05',manager.manager_id]);checks++;
 assert.equal(f.connections,1);checks++;assert.equal(f.releases,1);checks++;await f.plane.close();
}
for(const args of [{manager:{...manager,read_only:true},serviceDate:'2026-10-05'}, {manager,serviceDate:'infinity'},
 {manager,serviceDate:['2026-10-05']}, {manager:{...manager,auth_mode:'admin_api_key'},serviceDate:'2026-10-05'}]){
 const f=fixture(null);await assert.rejects(()=>f.plane.getCurrentRecurringDelivery(args));checks++;
 assert.equal(f.connections,0);checks++;await f.plane.close();
}
console.log(JSON.stringify({status:'PASS',checks,scope:'synthetic single-client exact-status and current-delivery adapters only',production:false}));
