// DATA for the existing SQL validators. This never registers a source or
// changes the accepted week, the optimizer formula, or historical policies.
import assert from 'node:assert/strict';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {prepareApprovedManualAccessProposal} from './approved-manual-gps.js';
import {ACCEPTED_SEVEN_DATA_DIGEST,ACCEPTED_SEVEN_SHA256} from './accepted-seven-manual-week.js';
const dayFields=['day','weekday','sourcePath','employees','lunches','transfers','phases',
 'checkedWindow','prearrivalPolicy','policy0945','coveragePurpose'];
export function prepareAcceptedSevenSqlPolicy(week){
 const {dataDigest,...body}=week;
 assert.equal(dataDigest,ACCEPTED_SEVEN_DATA_DIGEST);
 assert.equal(digest(body),dataDigest,'The complete accepted week must remain exact');
 assert.equal(week.acceptedStaticPattern.artifactSha256,ACCEPTED_SEVEN_SHA256);
 const bindings=new Map(week.referenceBindings.groups.map(g=>[g.approvedGroup,g]));
 const groups=week.ratings.map(r=>({code:bindings.get(r.group).referenceCode,name:r.group,
  points:r.score,locationId:bindings.get(r.group).primaryLocationId})).sort((a,b)=>a.code.localeCompare(b.code));
 assert.equal(groups.length,23);assert.equal(groups.reduce((n,g)=>n+g.points,0),136);
 const days=week.days.map(day=>Object.fromEntries(dayFields.map(key=>{
  assert.ok(Object.hasOwn(day,key));return [key,structuredClone(day[key])];
 })));
 assert.equal(days.reduce((n,d)=>n+d.lunches.length,0),35);
 return {schema:'custodial.approved-manual-absence-policy-sql.v1',manifestSha256:week.manifestSha256,
  manualDataDigest:dataDigest,days,groups,access:prepareApprovedManualAccessProposal(week)};
}
