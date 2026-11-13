import assert from 'node:assert/strict';
import {recurringIntegerLoadRange} from '../src/static-weekly-recurring-phase-authority.js';
let cases=0,integerAllocations=0;
for(let owners=1;owners<=5;owners++)for(let total=0;total<=18;total++){
 const extrema=Array.from({length:7},()=>({min:Infinity,max:-Infinity,count:0}));
 function visit(remaining,loads){if(loads.length===owners-1){const vector=[...loads,remaining],lo=Math.min(...vector),hi=Math.max(...vector);integerAllocations++;for(let spread=hi-lo;spread<=6;spread++){const e=extrema[spread];e.min=Math.min(e.min,lo);e.max=Math.max(e.max,hi);e.count++;}return;}for(let x=0;x<=remaining;x++)visit(remaining-x,[...loads,x]);}
 visit(total,[]);
 for(let spread=0;spread<=6;spread++){
  const range=recurringIntegerLoadRange({total,owners,spread}),actual=extrema[spread];
  if(actual.count){assert.deepEqual(range,{lower:actual.min,upper:actual.max});assert.ok(total%owners===0||spread>=1);}
  else assert.ok(range.lower>range.upper);
  cases++;
 }
}
for(const key of ['total','owners','spread'])for(const value of [undefined,null,'1',NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1]){assert.throws(()=>recurringIntegerLoadRange({...{total:3,owners:2,spread:1},[key]:value}));cases++;}
assert.throws(()=>recurringIntegerLoadRange({total:3,owners:0,spread:1}));cases++;
const max=Number.MAX_SAFE_INTEGER;assert.deepEqual(recurringIntegerLoadRange({total:max,owners:1,spread:max}),{lower:max,upper:max});assert.deepEqual(recurringIntegerLoadRange({total:max,owners:max,spread:max}),{lower:0,upper:max});cases+=2;
console.log(JSON.stringify({status:'PASS',cases,integerAllocations,proof:'complete enumeration of all nonnegative integer load vectors for totals0..18,owners1..5,spread0..6; exact min/max and infeasibility, unsafe input and BigInt edge controls',solver:false,policy_changed:false}));
