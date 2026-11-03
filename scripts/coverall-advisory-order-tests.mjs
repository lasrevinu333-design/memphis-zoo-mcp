import assert from 'node:assert/strict';
import {suggestCoverAllAreaOrder} from '../src/coverall-advisory-order.js';
const a=id=>({areaId:id,area:id,locations:[{id:id+'-east',name:id+' east'},{id:id+'-west',name:id+' west'}],purpose:'area_owner'});
const edges=[['start','A',9],['start','B',1],['start','C',8],['A','B',4],['A','C',2],['B','A',7],['B','C',1],['C','A',3],['C','B',2]]
 .map(([from,to,minutes])=>({from,to,minutes,verified:true,provenance:'synthetic accepted measurements'}));
const fixture=()=>({areas:[a('A'),a('B'),a('C')],proximity:structuredClone(edges),anchorLocationId:'start',anchorProvenance:'synthetic manager accepted anchor'});
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const original=fixture(),before=structuredClone(original),result=suggestCoverAllAreaOrder(original);
eq(original,before);eq(result.advisoryOrder.status,'ADVISORY_VERIFIED_PROXIMITY');eq(result.advisoryOrder.orderedAreaIds,['B','C','A']);
eq(result.areas.map(a=>a.areaId),['B','C','A']);eq(result.areas[0].locations,[{id:'B-east',name:'B east'},{id:'B-west',name:'B west'}]);
eq(result.advisoryOrder.mandatory,false);eq(result.advisoryOrder.anchorLocationId,'start');
const reversed=fixture();reversed.proximity.reverse();eq(suggestCoverAllAreaOrder(reversed),result);
const changed=fixture();changed.proximity.find(e=>e.from==='B'&&e.to==='A').minutes=1;changed.proximity.find(e=>e.from==='B'&&e.to==='C').minutes=7;
eq(suggestCoverAllAreaOrder(changed).advisoryOrder.orderedAreaIds,['B','A','C']);
assert.notEqual(suggestCoverAllAreaOrder(changed).advisoryOrder.sourceGraphDigest,result.advisoryOrder.sourceGraphDigest);checks++;
for(const mutate of [f=>delete f.anchorLocationId,f=>delete f.anchorProvenance,f=>delete f.proximity,f=>f.proximity.pop(),f=>f.proximity[0].verified=false,
 f=>f.proximity[0].provenance='',f=>f.proximity[0].minutes='9',f=>f.proximity[0].minutes=NaN,f=>f.proximity[0].minutes=0,
 f=>f.proximity.push({...f.proximity[0],minutes:2}),f=>f.areas[0].areaId='']){
 const f=fixture();mutate(f);const out=suggestCoverAllAreaOrder(f);eq(out.advisoryOrder.status,'ORDER_NOT_PROVEN');eq(out.areas,f.areas);
}
const empty=fixture();empty.areas=[];eq(suggestCoverAllAreaOrder(empty).advisoryOrder.status,'NO_ASSIGNED_AREAS');
const repeated=fixture();repeated.areas.push({...a('B'),purpose:'lunch_coverage'});eq(suggestCoverAllAreaOrder(repeated).advisoryOrder.orderedAreaIds,['B','C','A']);eq(suggestCoverAllAreaOrder(repeated).areas.length,4);
console.log(`PASS ${checks} CoverAll advisory-order source checks; no operational route or physical claim`);
