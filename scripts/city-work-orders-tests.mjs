import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCityWorkOrderReader,projectCityWorkOrders,CITY_ACTIVE_URL} from '../src/city-work-orders.js';
const at=Date.parse('2026-11-10T19:00:00Z');
const row={OBJECTID:1,WorkOrderID:'1234',Facility_Code:'15Z05',Facility_FullName:'15Z05 Birdhouse',
  RequestDescription:'Repair\nlight',RequestStatus:'In Progress',RequestDate:at-1000,CloseDate:at-2000,last_edited_date:at,
  ContactEmail:'private@example.invalid',Job_Notes:'PRIVATE'};
const payload=r=>({features:r.map(attributes=>({attributes}))});
test('City active source preserves open status, prior close date and missing description without private fields',()=>{
 const out=projectCityWorkOrders(payload([row,{...row,OBJECTID:2,WorkOrderID:null,RequestDescription:null}]),2,at);
 assert.equal(out.rows[0].status,'In Progress');assert.equal(out.rows[0].source_close_date,new Date(at-2000).toISOString());
 assert.equal(out.rows[0].description,'Repair light');assert.equal(out.rows[1].description,null);
 assert.doesNotMatch(JSON.stringify(out),/PRIVATE|ContactEmail|private@|Job_Notes/);
});
test('partial, duplicate, non-Zoo and closed records cannot claim complete current City feed',()=>{
 for(const [data,count] of [[payload([row]),2],[{...payload([row]),exceededTransferLimit:true},1],
  [payload([row,row]),2],[payload([{...row,Facility_Code:'21E02'}]),1],[payload([{...row,RequestStatus:'Closed - Complete'}]),1]])
   assert.throws(()=>projectCityWorkOrders(data,count,at));
});
test('City reader uses fixed public read-only query, counts every row, shares reads and expires cache',async()=>{
 let time=at,requests=[],fail=false;
 const read=makeCityWorkOrderReader({now:()=>time,fetchImpl:async(u,init)=>{
  assert.equal(u.origin+u.pathname,CITY_ACTIVE_URL);assert.equal(u.searchParams.get('where'),"Facility_Code LIKE '15Z%'");
  assert.equal(u.searchParams.get('returnGeometry'),'false');assert.equal(init.redirect,'error');assert.ok(init.signal);
  assert.equal(init.headers.Authorization,undefined);requests.push(u.toString());
  if(fail)throw Error('PRIVATE');
  return new Response(JSON.stringify(u.searchParams.has('returnCountOnly')?{count:1}:payload([row])));
 }});
 const [a,b]=await Promise.all([read(),read()]);assert.deepEqual(a,b);assert.equal(requests.length,2);
 await read();assert.equal(requests.length,2);time+=60001;fail=true;
 const bad=await read();assert.equal(bad.state,'unavailable');assert.deepEqual(bad.rows,[]);assert.doesNotMatch(JSON.stringify(bad),/PRIVATE/);
});

test('the actual City filter field governs location while a contradictory secondary name remains flagged',()=>{
 const r={...row,Facility_Code:'15Z86 - CAT HOUSE CAFE',Facility_FullName:'15T02 - BELLEVUE TENNIS'};
 const out=projectCityWorkOrders(payload([r]),1,at);assert.equal(out.rows[0].facility,r.Facility_Code);
 assert.equal(out.rows[0].facility_label_conflict,true);
 const same=projectCityWorkOrders(payload([{...r,Facility_FullName:r.Facility_Code}]),1,at);
 assert.equal(same.rows[0].facility_label_conflict,false);
});
