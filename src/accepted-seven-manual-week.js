// Exact accepted static DATA. No optimizer, publication, roster write or RPC.
// The original eight-person packet remains the independent retained authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
export const ACCEPTED_SEVEN_SHA256='22d067bd595e2450bb32cd36903df94628eb6df055a44f992b3aba9f242bbee7';
export const ACCEPTED_SEVEN_DATA_DIGEST='fe0257dbd8cb4dd2f63c4da1997342067945e87a6ce516aee0698debef5d9a58';
const ACCEPTANCE_SHA256='6b32965603bc27c1e96bcbf9fdd5a4cdbd99014a73bde4a05d894a8fc25e8fc5';
const REFERENCE_WEEK='85ad93db39597cffc033992ec74d5eea98612ce9a8388a9e93f5566f4e38bc4c';
const sha=b=>createHash('sha256').update(b).digest('hex');
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
function read(url){const st=lstatSync(url);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.size<1024*1024);return readFileSync(url);}
export function deriveAcceptedSevenManualWeek({base,candidateBytes,acceptanceBytes}){
 const {dataDigest,...baseBody}=base;
 assert.equal(dataDigest,REFERENCE_WEEK);assert.equal(digest(baseBody),dataDigest);
 assert.equal(sha(candidateBytes),ACCEPTED_SEVEN_SHA256,'Exact accepted seven-person artifact required');
 assert.equal(sha(acceptanceBytes),ACCEPTANCE_SHA256,'Exact retained owner acceptance required');
 const c=JSON.parse(candidateBytes),acceptance=JSON.parse(acceptanceBytes);
 assert.equal(acceptance.schema,'custodial.accepted-static-week-retention.v1');
 assert.equal(acceptance.status,'OWNER_ACCEPTED_RETAINED_NOT_ACTIVATED');
 assert.equal(acceptance.candidateDataSha256,ACCEPTED_SEVEN_SHA256);
 assert.equal(acceptance.authorityMessageId,'Sentinel_67736ae6296c81918ce277aabb5e2d84');
 assert.equal(c.referenceWeekDigest,dataDigest);assert.equal(c.effectiveStart,null);
 assert.equal(c.published,false);assert.equal(c.liveScheduleChanged,false);
 assert.equal(c.schema,'custodial.seven-person-static-review.v1');
 const people=base.referenceBindings.people.filter(p=>p.approvedName!=='Kiltra Horton');
 assert.equal(people.length,7);
 assert.deepEqual(c.roster,people.map(p=>({name:p.approvedName,employeeId:p.employeeId,slotId:p.slotId})));
 assert.deepEqual(c.ratings,base.ratings);assert.equal(c.days.length,7);
 const names=new Set(people.map(p=>p.approvedName)),days=structuredClone(c.days);
 for(const day of days){
  assert.ok(day.employees.every(p=>names.has(p.name)));
  assert.equal(day.employees.length,day.lunches.length);
  // Derive only descriptive departure records from the accepted owner maps.
  // No new owner, phase boundary, normal area, shift or lunch is selected.
  const transfers=[];
  for(let i=1;i<day.phases.length;i++)for(const [group,to] of Object.entries(day.phases[i].owners)){
   const from=day.phases[i-1].owners[group];
   if(from!==to)transfers.push({time:day.phases[i].start,from,to,group,
    coverage:'INHERITED_ALERTS_AND_ISSUES_ONLY',createsMandatoryCleaningRoute:false});
  }
  if(day.transfers)assert.deepEqual(day.transfers.map(digest).sort(),transfers.map(digest).sort());
  else day.transfers=transfers;
  day.sourcePath='accepted-seven-20261115/seven-person-static-candidate-current-review.json#'+day.day;
  day.coveragePurpose='INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING';
  for(const phase of day.phases)phase.zooWideCoverage=new Set(Object.values(phase.owners)).size===1;
 }
 assert.equal(days.reduce((n,d)=>n+d.lunches.length,0),35);
 const {bindingDigest,...binding}=structuredClone(base.referenceBindings);
 binding.people=structuredClone(people);
 binding.acceptedSevenDerivation={artifactSha256:ACCEPTED_SEVEN_SHA256,retainedEightPersonBindingDigest:bindingDigest};
 const referenceBindings={...binding,bindingDigest:digest(binding)};
 const body={...structuredClone(baseBody),days,referenceBindings,
  acceptedStaticPattern:{schema:'custodial.accepted-static-pattern.v1',staffingCount:7,
   artifactSha256:ACCEPTED_SEVEN_SHA256,acceptanceSha256:sha(acceptanceBytes),
   acceptanceMessageId:acceptance.authorityMessageId,retainedEightPersonWeekDigest:dataDigest,
   prearrivalPolicy:'OWN_BASE_AREAS_FROM_ACTUAL_SHIFT_START_ONLY',
   fullSiteOwnershipBeforeLatestArrivalClaimed:false,
   effectiveDateChosen:false,registered:false,published:false}};
 const derived=digest(body);assert.equal(derived,ACCEPTED_SEVEN_DATA_DIGEST,'Exact accepted seven-person derivation required');
 return freeze({...body,dataDigest:derived});
}
export function readAcceptedSevenManualWeek(base){
 return deriveAcceptedSevenManualWeek({base,
  candidateBytes:read(new URL('../config/schedules/accepted-seven-20261115/seven-person-static-candidate-current-review.json',import.meta.url)),
  acceptanceBytes:read(new URL('../config/schedules/accepted-seven-20261115/OWNER_ACCEPTANCE.json',import.meta.url))});
}
