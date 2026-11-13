import assert from 'node:assert/strict';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {readApprovedManualGpsReference,prepareApprovedManualGpsDistances,prepareApprovedManualAccessProposal,straightLineGpsMeters} from '../src/approved-manual-gps.js';

const week=readApprovedManualWeek(),reference=readApprovedManualGpsReference(week),matrix=prepareApprovedManualGpsDistances(week);
assert.equal(reference.groups.length,23);assert.equal(matrix.pairs.length,253);
assert.equal(new Set(matrix.pairs.map(p=>[p.from,p.to].sort().join(':'))).size,253);
assert.ok(matrix.maximumPairwiseMeters>500&&matrix.maximumPairwiseMeters<2500);
const origin={latitude:0,longitude:0};
assert.equal(straightLineGpsMeters(origin,origin),0);
assert.ok(Math.abs(straightLineGpsMeters(origin,{latitude:0,longitude:1})-111195.0802)<0.001);
for(const pair of matrix.pairs){
 const a=reference.groups.find(g=>g.locationCode===pair.from),b=reference.groups.find(g=>g.locationCode===pair.to);
 assert.ok(Number.isFinite(pair.meters)&&pair.meters>=0);
 assert.ok(Math.abs(straightLineGpsMeters(a,b)-straightLineGpsMeters(b,a))<1e-9);
}
assert.equal(reference.groups.filter(g=>g.memberLocationId).length,1);
assert.equal(reference.groups.find(g=>g.memberLocationId).locationCode,'CAT_COUNTRY');
assert.ok(!reference.groups.some(g=>g.locationCode==='ELEPHANT_TRUNK_RESTROOMS'));
assert.equal(matrix.normalizedFormula,null);assert.equal(matrix.formulaApproved,false);assert.equal(matrix.physicalAcceptance,false);
assert.throws(()=>straightLineGpsMeters({latitude:null,longitude:0},origin));
assert.throws(()=>straightLineGpsMeters({latitude:91,longitude:0},origin));
assert.throws(()=>readApprovedManualGpsReference({...week,manifestSha256:'0'.repeat(64)}));
const access=prepareApprovedManualAccessProposal(week),pair=(a,b)=>access.pairs.find(p=>(p.from===a&&p.to===b)||(p.from===b&&p.to===a));
assert.equal(access.fixedDenominatorMeters,807.6262463035904);assert.equal(access.formulaApproved,true);
assert.equal(pair('BONOBOS_RESTROOMS','CATHOUSE_CAFE_RESTROOMS').accessFactor,.8);
assert.equal(pair('TETON','EAST_END_RESTROOMS').accessFactor,.8);
assert.equal(pair('ZAMBEZI','BREEZEWAY_RESTROOMS').accessFactor,.9);
assert.equal(pair('HERPETARIUM','EVENT_CENTER').accessFactor,.9,'Overlapping memberships must not stack discounts');
assert.equal(pair('ZAMBEZI','CHINA').accessFactor,1,'Canyon does not merge separate neighborhoods transitively');
assert.equal(pair('ZAMBEZI','TROPICAL_BIRDS').accessFactor,1,'An accepted long route is not measured short distance');
assert.ok(!access.neighborhoods.flat().includes('ELEPHANT_TRUNK_RESTROOMS'));
assert.equal(access.walkingDistancesMeasured,false);assert.equal(access.productionWritten,false);
console.log(JSON.stringify({status:'PASS',scope:'23 exact saved GPS references and approved access penalties; no measured walking, publication or physical qualification',groups:23,pairs:253,maximumPairwiseMeters:matrix.maximumPairwiseMeters,ownerApprovedAccessPenalty:true}));
