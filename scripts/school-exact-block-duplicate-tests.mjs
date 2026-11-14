import assert from 'node:assert/strict';
import {test} from 'node:test';
import {projectSchoolAttachment,SCHOOL_HEADERS} from '../src/operations-mail-contract.js';

const day='2026-11-17';
const source={mailbox:'eoperle@memphiszoo.org',sender:'aferguson@memphiszoo.org',
  message_id:'synthetic-school-original',content_sha256:'a'.repeat(64),source_at:'2026-11-11T15:54:45Z'};
const block=(id,name,students,teachers,time='09:30')=>[
  [id,name,4,'Field Trip PreK and Kindergarten',day,time,students],
  [null,null,null,'Field Trip Teacher',day,time,teachers],
];
const a=block(100,'Synthetic A',156,17,'09:00');
const b=block(200,'Synthetic B',95,9);
const c=block(300,'Synthetic C',52,5,'10:00');
const input=rows=>({headers:[...SCHOOL_HEADERS],rows,source,attachment:{id:'synthetic-attachment',sha256:'b'.repeat(64)}});
const subtotal=n=>[null,null,null,null,null,null,n];
const project=rows=>projectSchoolAttachment(input(rows));
const repeated=()=>[['TUES'],...structuredClone(a),...structuredClone(b),...structuredClone(c),...structuredClone(b),subtotal(438)];

test('identical complete booking blocks count once while the raw repeated subtotal remains verified',()=>{
  const rows=repeated(),original=structuredClone(rows),result=project(rows);
  assert.equal(result.length,3);assert.equal(result.reduce((sum,r)=>sum+r.total,0),334);
  const booking=result.find(r=>r.order_id==='200');assert.equal(booking.students,95);assert.equal(booking.teachers,9);
  assert.equal(booking.buses,4);assert.equal(booking.total,104);assert.equal(booking.departure_at,null);
  assert.deepEqual(rows,original);
});
test('deduplicated total cannot replace the source subtotal to bypass its check',()=>{
  const rows=repeated();rows[rows.length-1]=subtotal(334);
  assert.throws(()=>project(rows),/school_subtotal_mismatch/);
});
for(const [name,mutate] of [
  ['student quantity',r=>r[7][6]++],['teacher quantity',r=>r[8][6]++],
  ['school name',r=>r[7][1]='Different source school'],['bus count',r=>r[7][2]=5],
  ['arrival',r=>r[7][5]=r[8][5]='09:45'],
  ['product despite same classified total',r=>r[7][3]='Field Trip Elem Student 1-5'],
  ['missing continuation',r=>r.splice(8,1)],
])test('changed repeated block still refuses: '+name,()=>{
  const rows=repeated();mutate(rows);assert.throws(()=>project(rows),/duplicate_school_order_block/);
});
test('matching first rows do not conceal an extra product row',()=>{
  const rows=repeated();rows.splice(9,0,[null,null,null,'Field Trip Paid Chaperone',day,'09:30',1]);
  assert.throws(()=>project(rows),/duplicate_school_order_block/);
});
test('identical order/date in another source day section remains unresolved',()=>{
  assert.throws(()=>project([['TUES'],...b,subtotal(104),['WED'],...b,subtotal(104)]),/duplicate_school_order_block/);
});
test('blank separators within a section do not manufacture a second booking',()=>{
  const result=project([['TUES'],...b,[],...b,subtotal(208)]);assert.equal(result.length,1);assert.equal(result[0].total,104);
});
test('the same order on distinct actual dates remains two visits',()=>{
  const next=structuredClone(b);for(const row of next)row[4]='2026-11-18';
  const result=project([['TUES'],...b,subtotal(104),['WED'],...next,subtotal(104)]);
  assert.equal(result.length,2);assert.notEqual(result[0].id,result[1].id);
});
test('a final repeated block without a source subtotal is still compared completely',()=>{
  assert.equal(project([['TUES'],...b,...b]).length,1);
  const changed=structuredClone(b);changed[1][6]=10;
  assert.throws(()=>project([['TUES'],...b,...changed]),/duplicate_school_order_block/);
});
