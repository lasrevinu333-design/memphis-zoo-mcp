import assert from 'node:assert/strict';
import {managerOnDuty,chicagoServiceDate} from '../src/manager-on-duty.js';
assert.equal(managerOnDuty('2026-11-11').name,'Eric McKenney');
assert.equal(managerOnDuty('2026-11-15').name,'Eric Operle');
assert.equal(managerOnDuty('2026-11-10').name,'Haley Lejman');
assert.equal(managerOnDuty('2026-11-12').name,'Jennifer Sheffield');
assert.equal(managerOnDuty('2026-11-03').state,'unavailable');
assert.equal(managerOnDuty('2026-11-15',{datedOverrides:{'2026-11-15':{manager_id:'synthetic-cover',name:'Synthetic Cover'}}}).name,'Synthetic Cover');
assert.equal(chicagoServiceDate(new Date('2026-11-11T05:59:59Z')),'2026-11-10');
assert.equal(chicagoServiceDate(new Date('2026-11-11T06:00:00Z')),'2026-11-11');
assert.throws(()=>managerOnDuty('2026-02-30'));
console.log('PASS date-specific MOD identity, Sunday rule, dated cover priority and Central midnight');

const rota=['Eric Operle','Brandy Gull','Haley Lejman','Eric McKenney','Jennifer Sheffield','Haley Lejman','Josh'];
for(let day=0;day<70;day++){
 const date=new Date(Date.UTC(2026,10,8+day)),serviceDate=date.toISOString().slice(0,10);
 assert.equal(managerOnDuty(serviceDate).name,rota[date.getUTCDay()]);
}
assert.equal(managerOnDuty('2026-11-13').name,'Haley Lejman');
assert.equal(managerOnDuty('2026-11-14').name,'Josh');
assert.equal(managerOnDuty('2026-11-15',{datedOverrides:{'2026-11-15':null}}).state,'unavailable');
for(const [instant,date] of [['2026-11-14T05:59:59Z','2026-11-13'],['2026-11-14T06:00:00Z','2026-11-14'],['2026-12-01T05:59:59Z','2026-11-30'],['2027-01-01T06:00:00Z','2027-01-01'],['2027-03-15T04:59:59Z','2027-03-14'],['2027-03-15T05:00:00Z','2027-03-15']])assert.equal(chicagoServiceDate(new Date(instant)),date);
console.log('PASS 70 recurring dates, explicit cover/cancellation, month/year and DST Central rollover');
