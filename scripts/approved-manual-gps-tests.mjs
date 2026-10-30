import assert from 'node:assert/strict';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {readApprovedManualGpsReference,prepareApprovedManualGpsDistances,straightLineGpsMeters} from '../src/approved-manual-gps.js';

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
console.log(JSON.stringify({status:'PASS',scope:'23 exact ID-bound saved GPS references and straight-line distances; no weighted-policy, walking-time, publication or physical qualification',groups:23,pairs:253,maximumPairwiseMeters:matrix.maximumPairwiseMeters}));
