import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';

const GPS_SHA256='651ee0aeba8266f4f2b591c13ccc0af86b6fd62b815516ad7f5f10a749ac1c42';
const GPS_FILE=new URL('../config/schedules/manual-approved-20261030/gps-reference-20261030.json',import.meta.url);
const MANIFEST='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f';
const coordinates=point=>{
 assert.ok(typeof point.latitude==='number'&&Number.isFinite(point.latitude)&&Math.abs(point.latitude)<=90);
 assert.ok(typeof point.longitude==='number'&&Number.isFinite(point.longitude)&&Math.abs(point.longitude)<=180);
};

// Spherical, straight-line metres only. These are not measured walking routes,
// travel minutes, physical scan acceptance, or an approved weighted objective.
export function straightLineGpsMeters(a,b){
 coordinates(a);coordinates(b);
 const radians=degrees=>degrees*Math.PI/180,lat1=radians(a.latitude),lat2=radians(b.latitude),
  dLat=lat2-lat1,dLon=radians(b.longitude-a.longitude),
  h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
 return 6371008.8*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}

export function readApprovedManualGpsReference(week){
 assert.equal(week.manifestSha256,MANIFEST);
 const bytes=readFileSync(GPS_FILE);assert.equal(createHash('sha256').update(bytes).digest('hex'),GPS_SHA256,'Saved GPS reference changed');
 const reference=JSON.parse(bytes);
 assert.equal(reference.schema,'custodial.approved-manual-gps-reference.v1');
 assert.equal(reference.manifestSha256,MANIFEST);assert.equal(reference.groups.length,23);
 const known=new Map(week.referenceBindings.groups.map(g=>[g.referenceCode,g]));
 assert.equal(new Set(reference.groups.map(g=>g.locationCode)).size,known.size);
 for(const group of reference.groups){
  coordinates(group);assert.equal(group.primaryLocationId,known.get(group.locationCode)?.primaryLocationId);
  assert.ok(group.coordinateSource&&group.coordinateConfidence&&group.groupId);
  if(group.coordinateScope==='EXACT_GROUP_MEMBER_COORDINATE'){
   assert.equal(group.locationCode,'CAT_COUNTRY');
   assert.equal(group.groupId,'6bab7a02-7053-4dc3-88b2-784b15e48d4a');
   assert.equal(group.memberLocationId,'e7b43219-6b61-4c08-aabf-9205dc16efdb');
   assert.equal(group.memberLocationCode,'CATX');
   assert.equal(group.coordinateSource,'openstreetmap:node:1240762017');
   assert.equal(group.coordinateConfidence,'mapped_attraction_centroid');
  }else{
   assert.equal(group.coordinateScope,'SAVED_GROUP_PIN');
   assert.equal(group.coordinateSource,'google_maps_user_pin');assert.equal(group.coordinateConfidence,'high');
   assert.equal(group.memberLocationId,null);assert.equal(group.memberLocationCode,null);
  }
 }
 for(const key of ['legacyGridUsed','walkingDistancesMeasured','physicalAcceptance','normalizedFormulaApproved','productionWritten'])assert.equal(reference[key],false);
 return {...reference,referenceSha256:GPS_SHA256};
}

// Separate raw geography from policy. No normalizer, weight, cluster bonus,
// transferred-area anchor or legacy route-grid value is chosen here.
export function prepareApprovedManualGpsDistances(week){
 const reference=readApprovedManualGpsReference(week),pairs=[];
 for(let i=0;i<reference.groups.length;i++)for(let j=i+1;j<reference.groups.length;j++){
  const a=reference.groups[i],b=reference.groups[j];
  pairs.push({from:a.locationCode,to:b.locationCode,meters:straightLineGpsMeters(a,b)});
 }
 const body={schema:'custodial.approved-manual-gps-distances.v1',manifestSha256:MANIFEST,
  referenceSha256:GPS_SHA256,metric:'SPHERICAL_STRAIGHT_LINE_METERS',earthRadiusMeters:6371008.8,
  groups:structuredClone(reference.groups),pairs,maximumPairwiseMeters:Math.max(...pairs.map(p=>p.meters)),
  normalizedFormula:null,formulaApproved:false,walkingTimeClaimed:false,physicalAcceptance:false,productionWritten:false};
 assert.equal(pairs.length,253);
 return {...body,distancesDigest:digest(body)};
}
