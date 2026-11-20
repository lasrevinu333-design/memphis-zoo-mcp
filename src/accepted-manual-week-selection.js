// Select the planning DATA that belongs to the source's exact pattern digest.
// Retained sources must never silently acquire the later shift correction.
import {readApprovedManualWeek} from './approved-manual-week.js';
import {readAcceptedSevenManualWeek,ACCEPTED_SEVEN_DATA_DIGEST} from './accepted-seven-manual-week.js';
import {readRetainedApprovedManualWeek,RETAINED_MANUAL_DATA_DIGEST} from './approved-manual-retained-week.js';
export function readApprovedManualWeekForSource(source){
 const base=readApprovedManualWeek();
 const sourceDigest=source?.version?.lunchCoveragePolicy?.sourceDigest;
 if(sourceDigest===RETAINED_MANUAL_DATA_DIGEST)return readRetainedApprovedManualWeek();
 return sourceDigest===ACCEPTED_SEVEN_DATA_DIGEST
  ?readAcceptedSevenManualWeek(base):base;
}
