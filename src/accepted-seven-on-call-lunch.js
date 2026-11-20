// Owner-approved temporary on-call eligibility only. This never changes a
// normal work row, personal restriction, NFC permission, or cleaning clock.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
const decisionSha='9bb0477082d46afeadb314eaed46e192729e2ab850c95e0a6294ceea96b462d5';
const artifact='22d067bd595e2450bb32cd36903df94628eb6df055a44f992b3aba9f242bbee7';
const manual='fe0257dbd8cb4dd2f63c4da1997342067945e87a6ce516aee0698debef5d9a58';
const helperSlot='36829381-70d7-521b-9f14-bad0af16ba87',helperPerson='77d50e9a-6338-43b1-aed5-9f47d7129466';
const location='7a6ef424-142e-4d0b-9202-8007c3283ae7';
const authority={schema:'custodial.accepted-seven-on-call-lunch.v1',acceptedCandidateSha256:artifact,
 manualDataDigest:manual,ownerDecisionSha256:decisionSha,helperSlotId:helperSlot,helperEmployeeId:helperPerson,
 locationCode:'HERPETARIUM',locationId:location,coverage:'ON_CALL_LUNCH_RELIEF_ONLY',
 normalAssignmentEligibilityChanged:false,newMandatoryCleaningRoute:false,phoneNFCPermissionChanged:false,
 windows:[{dayOfWeek:5,normalOwnerSlotId:'ae56a131-e2fd-5465-8ab8-6e5dbf543204',start:'10:00',end:'11:00'},
  {dayOfWeek:6,normalOwnerSlotId:'5d2d2a0e-230f-5b03-9867-2e4c2826871f',start:'12:30',end:'13:30'},
  {dayOfWeek:0,normalOwnerSlotId:'5d2d2a0e-230f-5b03-9867-2e4c2826871f',start:'12:30',end:'13:30'}]};
for(const w of authority.windows)Object.freeze(w);Object.freeze(authority.windows);Object.freeze(authority);
export function acceptedSevenOnCallLunchAuthority(){
 const url=new URL('../config/schedules/accepted-seven-20261115/on-call-herpetarium-lunch-decision.json',import.meta.url),st=lstatSync(url);
 assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.size<=16384);
 assert.equal(createHash('sha256').update(readFileSync(url)).digest('hex'),decisionSha,'Exact owner on-call decision required');
 return structuredClone(authority);
}
export function validateAcceptedSevenOnCallLunch(version){
 const supplied=version?.manualGroupRatingAuthority?.acceptedSevenOnCallLunch;
 if(supplied===undefined)return null;
 assert.deepEqual(supplied,authority,'Unknown on-call lunch exception refused');
 assert.equal(version.manualGroupRatingAuthority.manifestSha256,'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f');
 assert.equal(version.manualGroupRatingAuthority.acceptedCandidateSha256,artifact);
 assert.equal(version.manualGroupRatingAuthority.acceptedManualDataDigest,manual);
 return authority;
}
export function isAcceptedSevenOnCallLunch({authority:allowed,dayOfWeek,normalOwnerSlotId,
 window,covererSlotId,covererPersonId,sourceNamedCovererSlotId,entries}){
 if(allowed!==authority||covererSlotId!==helperSlot||covererPersonId!==helperPerson||sourceNamedCovererSlotId!==helperSlot)return false;
 if(!allowed.windows.some(w=>w.dayOfWeek===dayOfWeek&&w.normalOwnerSlotId===normalOwnerSlotId
  &&w.start===window.start&&w.end===window.end))return false;
 return entries.length>0&&entries.every(e=>e.work.locationCodeSnapshot==='HERPETARIUM'
  &&e.work.locationId===location&&e.work.includedLocations.length===1
  &&e.work.includedLocations[0].locationId===location);
}
