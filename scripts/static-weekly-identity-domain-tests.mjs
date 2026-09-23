import assert from 'node:assert/strict';
import {staticWeeklyIdentityDomainSlots,staticWeeklyIdentityDomainSize,identityTierWidth,
 STATIC_WEEKLY_SERVER_LIMITS} from '../src/static-weekly-schedule-program.js';
const slots=Array.from({length:17},(_,i)=>({id:`slot-${String(i).padStart(2,'0')}`}));
let fixtures=0,vectorsChecked=0;
const lex=(a,b)=>{for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]-b[i];}return 0;};
const enumerate=arrays=>arrays.reduce((rows,values)=>rows.flatMap(row=>values.map(value=>[...row,value])),[[]]);
for(let seed=0;seed<160;seed++){
 const work=Array.from({length:3},(_,i)=>({key:`work-${i}`}));
 const indexes=work.map((_,w)=>slots.map((_,i)=>i).filter(i=>(i*(seed%7+1)+seed+w*5)%11<((seed+w)%4)));
 const problem={slots,work,candidates:work.flatMap((item,i)=>indexes[i].map(index=>({item,slot:slots[index]})))};
 const domains=work.map(item=>staticWeeklyIdentityDomainSlots(problem,item.key));
 assert.deepEqual(domains.map(domain=>domain.map(s=>slots.indexOf(s))),indexes,'only impossible owner digits may disappear');
 assert.equal(staticWeeklyIdentityDomainSize(problem),Math.max(...indexes.map(row=>row.length)));
 const vectors=enumerate(indexes.map(row=>[...row.map(i=>i+1),slots.length+1]));
 const encoded=vector=>vector.map((value,i)=>value===slots.length+1?indexes[i].length+1:indexes[i].indexOf(value-1)+1);
 const oldOrder=vectors.slice().sort(lex);
 const newOrder=vectors.slice().sort((a,b)=>lex(encoded(a),encoded(b)));
 assert.deepEqual(newOrder,oldOrder,'rank compression must preserve exact owner/open vector ordering');
 const base=staticWeeklyIdentityDomainSize(problem)+2;
 const packed=v=>encoded(v).reduce((n,digit)=>n*BigInt(base)+BigInt(digit),0n);
 assert.deepEqual(vectors.slice().sort((a,b)=>packed(a)<packed(b)?-1:packed(a)>packed(b)?1:0),oldOrder,'packed digits preserve exact lexicographic order');
 assert.ok(BigInt(base)**BigInt(identityTierWidth(base-2))-1n<=32767n,'existing numerical stability bound remains intact');
 fixtures++;vectorsChecked+=vectors.length;
}
assert.equal(STATIC_WEEKLY_SERVER_LIMITS.maxStagedSolves,192);
assert.equal(STATIC_WEEKLY_SERVER_LIMITS.maxCompactReceiptBytes,6291456);
console.log(JSON.stringify({fixtures,vectorsChecked,allOwnerAndOpenChoicesPreserved:true,
 existingBoundsUnchanged:true,passed:true},null,2));
