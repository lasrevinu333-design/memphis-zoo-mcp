import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readRecurringNotificationPlan} from '../src/recurring-notification-plan.js';
import {readZooWideCoverage} from '../src/employee-zoo-wide-coverage.js';
const source=readFileSync(new URL('../src/schedule-api.js',import.meta.url),'utf8');
const start=source.indexOf('  router.get("/my-day-summary"'),end=source.indexOf('  router.get("/my-day-summary/delivery-receipt"',start);assert.ok(start>=0&&end>start);
const code=source.slice(start,end);
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',C='20000000-0000-4000-8000-000000000001';
function fixture(assigned={}){
 let handler,loads=0,registrations=0;const assignment={device_active:true,employee_active:true,assigned_employee_id:A,assignment_epoch:2,canonical_device_id:'KIOSK_08',...assigned};
 const context=vm.createContext({router:{get(path,_auth,fn){assert.equal(path,"/my-day-summary");assert.equal(registrations++,0,"exactly one summary registration");assert.equal(typeof fn,"function");handler=fn;}},requirePersonalScheduleAccess(){},getAssignedEmployeeForDevice:async()=>assignment,readRecurringNotificationPlan,readZooWideCoverage,runReadOnlySql:async()=>assert.fail("legacy identity fixture must not issue a zoo-wide coverage read"),runRpc:async()=>assert.fail("legacy identity fixture must not issue a recurring-plan RPC"),readScheduleDelivery:async()=>({mode:"LEGACY_REGISTERED"}),requireDate:x=>x,getServiceDate:async()=> '2026-10-06',optionalTimestampLiteral:()=>null,loadStaticWeeklyEmployeeDay:async()=>{loads++;return{service_date:'2026-10-06',employee_name:'Fixture',current_items:[]};},appVersion:'test',releaseId:'test',contractVersion:'schedule.v2',fail:(res,error)=>res.status(500).json({error:error.message})});vm.runInContext(code,context);assert.equal(registrations,1,"one exact current summary handler captured");assert.equal(typeof handler,"function");
 return{call:async overrides=>{let status,payload;const res={status:x=>{status=x;return res;},json:x=>{payload=x;return res;}};await handler({query:{device_id:'KIOSK_08'},memphisDevice:{canonical_device_id:'KIOSK_08',assigned_employee_id:A,assignment_epoch:2},memphisDeviceCredential:{credential_id:C},...overrides},res);return{status,payload,loads};}};
}
test('actual summary handler emits verified employee assignment and credential',async()=>{const r=await fixture().call();assert.equal(r.status,200);assert.equal(r.payload.meta.employee_id,A);assert.equal(r.payload.meta.assignment_epoch,2);assert.equal(r.payload.meta.credential_id,C);assert.equal(r.payload.meta.canonical_device_id,'KIOSK_08');assert.equal(r.payload.data.zoo_wide_coverage,null);});
test('assignment change denies before reading schedule data',async()=>{const r=await fixture({assigned_employee_id:B,assignment_epoch:3}).call();assert.equal(r.status,403);assert.equal(r.loads,0);});
test('assignment epoch change denies even when employee repeats',async()=>{const r=await fixture({assignment_epoch:3}).call();assert.equal(r.status,403);assert.equal(r.loads,0);});
test('inactive device cannot return cached identity',async()=>{const r=await fixture({device_active:false}).call();assert.equal(r.status,404);assert.equal(r.loads,0);});
test('client employee selector cannot replace assigned employee',async()=>{const r=await fixture().call({query:{device_id:'KIOSK_08',employee_id:B}});assert.equal(r.status,200);assert.equal(r.payload.meta.employee_id,A);});
