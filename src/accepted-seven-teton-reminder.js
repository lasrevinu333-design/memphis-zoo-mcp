// Exact owner-requested display reminder within existing Teton work only.
// No new location/member/tag, cleaning route, clock rule or staffing change.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {ACCEPTED_SEVEN_DATA_DIGEST,ACCEPTED_SEVEN_SHA256} from './accepted-seven-manual-week.js';
const decisionSha='285588608b81f91a2c162f29894a370acd7d8cb0fab29fa8c9faa2ddba750790';
export function acceptedSevenTetonReminderAuthority(){
 const file=new URL('../config/schedules/accepted-seven-20261115/teton-grizzly-reminder-decision.json',import.meta.url),st=lstatSync(file);
 assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.size<=16384);
 const bytes=readFileSync(file);assert.equal(createHash('sha256').update(bytes).digest('hex'),decisionSha,'Exact Teton reminder decision required');
 const decision=JSON.parse(bytes);
 return {schema:decision.schema,acceptedCandidateSha256:ACCEPTED_SEVEN_SHA256,manualDataDigest:ACCEPTED_SEVEN_DATA_DIGEST,
  ownerDecisionSha256:decisionSha,locationCode:decision.locationCode,primaryLocationId:decision.primaryLocationId,
  includedLocationIds:decision.includedLocationIds,reminder:decision.reminder,newLocation:false,newNfcTag:false,
  ownershipShiftLunchAndWorkloadUnchanged:true,historyRewritten:false};
}
export function withAcceptedSevenTetonReminder({week,version}){
 const {dataDigest,...body}=week;assert.equal(dataDigest,ACCEPTED_SEVEN_DATA_DIGEST);assert.equal(digest(body),dataDigest);
 const authority=acceptedSevenTetonReminderAuthority(),binding=week.referenceBindings.groups.find(g=>g.referenceCode===authority.locationCode);
 assert.equal(binding.primaryLocationId,authority.primaryLocationId);
 assert.deepEqual(binding.includedLocations.map(l=>l.locationId).sort(),[...authority.includedLocationIds].sort());
 assert.equal(version.assignments.length,323);
 const paired=version.assignments.filter(row=>row.locationCodeSnapshot===authority.locationCode);
 assert.deepEqual([...new Set(paired.map(row=>row.dayOfWeek))].sort(),[0,1,2,3,4,5,6]);
 for(const row of paired){
  assert.equal(row.locationId,binding.primaryLocationId);assert.equal(row.locationNameSnapshot,binding.approvedGroup);
  assert.equal(row.serviceMode,'scan_tracked');assert.deepEqual(row.includedLocations,binding.includedLocations);
 }
 const amended=structuredClone(version);
 for(const row of amended.assignments)if(row.locationCodeSnapshot===authority.locationCode)
  row.locationNameSnapshot+=` (${authority.reminder})`;
 amended.manualGroupRatingAuthority.acceptedSevenTetonReminder=authority;
 return amended;
}
