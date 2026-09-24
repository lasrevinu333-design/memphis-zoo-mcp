import assert from 'node:assert/strict';
import {normalizeAttendanceRecord,canonicalAttendanceTimestamp} from '../src/attendance-state.js';
import {visitorRuntimeFixture} from './fixtures/visitor-attendance-runtime-fixture.mjs';
const nowMs=Date.now(),base=Math.floor(nowMs/1000)*1000;
const iso=ms=>new Date(ms).toISOString();
const payload={attendance:0,last_year:100,planned:200,yesterday:150,yesterday_plan:175,source:'home-browser-auto-push',fetched_at:iso(base+123)};
let passed=0;const failures=[];
async function test(name,fn){try{await fn();passed++;}catch(error){failures.push({name,error:error.message});}}

await test('F1 exact fractional Date readback through persist/load/normalize succeeds',async()=>{
 const f=visitorRuntimeFixture({nowMs});const response=await f.collector(payload);
 assert.equal(response.code,200);assert.equal(Date.parse(response.body.data.fetched_at),base+123);
 assert.equal(typeof response.body.data.fetched_at,'string');
});
await test('F1 different Date in same second is not this observation',async()=>{
 const f=visitorRuntimeFixture({nowMs,read:()=>[{...payload,fetched_at:new Date(base+789)}],write:async()=>{}});
 assert.equal((await f.collector({...payload,fetched_at:iso(base)})).code,503);
});
await test('F1 normalizer retains Date milliseconds',()=>{
 const row=normalizeAttendanceRecord({...payload,fetched_at:new Date(base+123)},{nowMs});
 assert.equal(Date.parse(row.source_timestamp),base+123);assert.equal(Date.parse(row.fetched_at),base+123);
});
await test('F1 sub-millisecond string precision survives normalizer and exact readback',async()=>{
 const time=iso(base+123).replace('.123Z','.123456Z');
 const f=visitorRuntimeFixture({nowMs,read:()=>[{...payload,fetched_at:time}],write:async()=>{}});
 const response=await f.collector({...payload,fetched_at:time});assert.equal(response.code,200);
 assert.match(response.body.data.fetched_at,/\.123456Z$/);assert.match(f.writes[0].fetched_at,/\.123456Z$/);
});
await test('F1 different microsecond string is not an exact readback',async()=>{
 const submitted=iso(base+123).replace('.123Z','.123456Z'),saved=submitted.replace('456Z','789Z');
 const f=visitorRuntimeFixture({nowMs,read:()=>[{...payload,fetched_at:saved}],write:async()=>{}});
 assert.equal((await f.collector({...payload,fetched_at:submitted})).code,503);
});
for(const [input,expected] of [
 ['2026-09-23 14:20:30.123456-05','2026-09-23T19:20:30.123456Z'],
 ['2026-09-23T19:20:30.123000Z','2026-09-23T19:20:30.123Z'],
 ['2026-09-23T19:20:30.000001+00:00','2026-09-23T19:20:30.000001Z'],
 ['2026-02-30T19:20:30Z',null],['2026-09-23T25:00:00Z',null],
 ['2026-09-23T19:20:30.1234567Z',null],['2026-09-23',null],
 ['infinity',null],['invalid',null],[true,null],[0,null],
 ])await test('F1 canonical timestamp '+String(input),()=>assert.equal(canonicalAttendanceTimestamp(input),expected));
const page=(current='0',optional='Last Year: 100 Planned: 200 Yesterday: 150 Yesterday Plan: 175')=>`<div><h5 class="card-header">Attendance</h5><div class="card-body"><h1>${current}</h1><div>${optional}</div></div></div>`;
for(const bad of ['1,23','1.5','-1','1e3','2147483648','1 000','12,','NaN','Infinity']){
 await test('F2 public fallback rejects main '+bad,async()=>{const f=visitorRuntimeFixture({nowMs,html:page(bad)});assert.equal((await f.publicRead()).code,502);});
}
for(const label of ['Last Year','Planned','Yesterday','Yesterday Plan'])for(const bad of ['1,23','1.5','-1','1e3','2147483648','']){
 await test(`F2 public fallback rejects ${label} ${bad}`,async()=>{const f=visitorRuntimeFixture({nowMs,html:page('0',`${label}: ${bad}`)});assert.equal((await f.publicRead()).code,502);});
}
for(const [text,value] of [['0',0],['1,234',1234],['2147483647',2147483647]]){
 await test('F2 public fallback keeps full valid count '+text,async()=>{const f=visitorRuntimeFixture({nowMs,html:page(text)});const res=await f.publicRead();assert.equal(res.code,200);assert.equal(res.body.data.attendance,value);assert.equal(res.body.data.stale,false);});
}
await test('F2 missing optional metrics stay null, actual zero remains zero',async()=>{
 const res=await visitorRuntimeFixture({nowMs,html:page('0','Planned: 0')}).publicRead();
 assert.equal(res.code,200);assert.equal(res.body.data.planned,0);assert.equal(res.body.data.last_year,null);
});
await test('F2 failed refresh may retain cache only as stale',async()=>{
 let html=page('10');const f=visitorRuntimeFixture({nowMs,html:()=>html});await f.context.fetchCurrentAttendance();html=page('1,23');
 const value=await f.context.fetchCurrentAttendance({force:true});assert.equal(value.attendance,10);assert.equal(value.stale,true);
});
for(const label of ['Last Year','Planned','Yesterday','Yesterday Plan']){
 for(const duplicate of ['1.5','2147483648','NaN','','200','0'])await test(`R2-01 duplicate ${label} ${duplicate} fails the entire public observation`,async()=>{
  const f=visitorRuntimeFixture({nowMs,html:page('17',`${label}: 200 ${label}: ${duplicate}`)});
  assert.equal((await f.publicRead()).code,502);
 });
 await test(`R2-01 duplicate ${label} cannot replace cached data as fresh`,async()=>{
  let html=page('20');const f=visitorRuntimeFixture({nowMs,html:()=>html});await f.context.fetchCurrentAttendance();
  html=page('17',`${label}: 200 ${label.toLowerCase()}: 1.5`);
  const value=await f.context.fetchCurrentAttendance({force:true});assert.equal(value.attendance,20);assert.equal(value.stale,true);
 });
}
for(const label of ['Last Year','Planned','Yesterday','Yesterday Plan'])for(const second of ['0','1.5','2147483648']){
 await test(`R3-JS-01 complete nested card rejects duplicate ${label}: ${second}`,async()=>{
  const html=`<div class="card"><h5 class="card-header">Attendance</h5><div class="card-body"><h1>17</h1><div class="metric-wrapper"><div>${label}: 200</div></div><div>${label}: ${second}</div></div></div>`;
  assert.equal((await visitorRuntimeFixture({nowMs,html}).publicRead()).code,502);
 });
}
await test('R3-JS-02 failed refresh remains stale across cache hits until actual success',async()=>{
 let html=page('20');const f=visitorRuntimeFixture({nowMs,html:()=>html});
 assert.equal((await f.publicRead()).body.data.stale,false);
 html=page('bad');const failed=await f.context.fetchCurrentAttendance({force:true});
 assert.equal(failed.stale,true);assert.ok(failed.warning);
 for(let i=0;i<3;i++){const next=await f.publicRead();assert.equal(next.body.data.attendance,20);assert.equal(next.body.data.stale,true);assert.equal(next.body.data.warning,failed.warning);}
 html=page('0');const success=await f.context.fetchCurrentAttendance({force:true});
 assert.equal(success.attendance,0);assert.equal(success.stale,false);assert.equal(success.warning,undefined);
 assert.equal((await f.publicRead()).body.data.stale,false);
});
for(const [name,html] of [
 ['missing heading','<h1>42</h1>'],
 ['two attendance cards',page('1')+page('2')],
 ['two current counts',page('1</h1><h1>2')],
 ['unclosed card',page('1').slice(0,-6)],
 ['split-label duplicate',page('1','Plan<span>ned</span>: 0 Planned: 1')],
 ['entity duplicate',page('1','Planned: 0 Plann&#101;d: 1')],
 ['nested duplicate after old length limit',page('1','Planned: 0<div><div>'+ ' '.repeat(3000)+'</div></div>Planned: 1')],
 ])await test('R4 DOM fails closed: '+name,async()=>assert.equal((await visitorRuntimeFixture({nowMs,html}).publicRead()).code,502));
await test('R4 DOM scopes one complete card, decodes entities and ignores inert markup',async()=>{
 const html='<div class="card"><h5>Other data</h5><h1>88</h1>Planned: bad</div>'+page('1<span>,234</span>','<span>Plann&#101;d</span>: 0<!-- Planned: 3 --><script>Planned: 4</script><style>.x {content:"Planned: 5"}</style><template>Planned: 6</template>');
 const res=await visitorRuntimeFixture({nowMs,html}).publicRead();assert.equal(res.code,200);assert.equal(res.body.data.attendance,1234);assert.equal(res.body.data.planned,0);
});
for(const fetched_at of ['2099-01-01T00:00:00Z',iso(nowMs+60001),iso(nowMs-3600001),'not-a-date',null]){
 await test('F3 shared persistence rejects out-of-window '+fetched_at,async()=>{
  const f=visitorRuntimeFixture({nowMs});const res=await f.manager({...payload,fetched_at});
  assert.notEqual(res.code,200);assert.equal(f.writes.length,0);
 });
}
for(const offset of [-3599000,0,59000]){
 await test('F3 compatible current manager observation '+offset,async()=>{const f=visitorRuntimeFixture({nowMs});assert.equal((await f.manager({...payload,fetched_at:iso(nowMs+offset)})).code,200);});
}
await test('F3 future saved row is not fresh',()=>{assert.equal(normalizeAttendanceRecord({...payload,fetched_at:'2099-01-01T00:00:00Z'},{nowMs}).stale,true);});
await test('F3 future stored row does not suppress public refresh',async()=>{
 const f=visitorRuntimeFixture({nowMs,read:()=>[{...payload,fetched_at:'2099-01-01T00:00:00Z'}],html:page('23')});
 const res=await f.publicRead();assert.equal(res.body.meta.mode,'scrape_fallback');assert.equal(res.body.data.attendance,23);
});
console.log(JSON.stringify({passed,failed:failures.length,failures,scope:'actual visitor owning functions and routes with synthetic I/O',productionWritten:false},null,2));
if(failures.length)process.exitCode=1;
