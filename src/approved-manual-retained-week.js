// Exact retained planning DATA for existing source identities. Reading it does
// not register, publish, backdate or replace the current corrected pattern.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';

export const RETAINED_MANUAL_DATA_DIGEST='eeff371f1510c6e4a079bde3ba17136dc10f64b100c7562d9b139fd14805a1c8';
const source=new URL('../config/schedules/manual-approved-20261030/retained-pre-correction-week.json',import.meta.url);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function readRetainedApprovedManualWeek(){
 const stat=lstatSync(source);
 assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1024*1024,'Bounded retained manual planning DATA required');
 const bytes=readFileSync(source);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'837fc6f43fc2b5a506a81264bedf449be82def63e3a243a13fbe86e28eeb868b','Retained manual planning bytes changed');
 const week=JSON.parse(bytes),{dataDigest,...body}=week;
 assert.equal(dataDigest,RETAINED_MANUAL_DATA_DIGEST);
 assert.equal(digest(body),RETAINED_MANUAL_DATA_DIGEST,'Retained manual planning identity changed');
 assert.equal(week.schema,'custodial.approved-manual-week-data.v1');
 assert.equal(week.receiptEligible,false);assert.equal(week.activation.published,false);
 return freeze(week);
}
