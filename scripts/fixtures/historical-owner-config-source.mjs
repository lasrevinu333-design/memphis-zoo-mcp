// Historical October 5 fixture context only; never a production config selector.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function historicalOwnerConfigBytes(current, prior) {
 assert.equal(sha(current),'04a80dcc83eb11b24dfd5537b8ddda8391408fe1dd2e332479f4dc9cb6d1b964','exact current owner configuration required');
 assert.equal(sha(prior),'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30','complete authentic October 5 owner fixture required');
 return Buffer.from(prior);
}
export function readHistoricalOwnerConfig() {
 return historicalOwnerConfigBytes(
  readFileSync(new URL('../../config/custodial-six-person-static-20261005.json',import.meta.url)),
  readFileSync(new URL('./historical-owner-six-person-20261005.json',import.meta.url)));
}
const owner=JSON.parse(readFileSync(new URL('../../config/custodial-six-person-static-20261005.json',import.meta.url)));
assert.deepEqual(owner.slots.OPTION4.workDays,[0,1,2,5,6]);
assert.deepEqual(owner.slots.OPTION4.shift,['06:00','15:00']);
assert.deepEqual(owner.slots.OPTION4.lunch,['10:00','11:00']);
const prior=readHistoricalOwnerConfig();
const current=readFileSync(new URL('../../config/custodial-six-person-static-20261005.json',import.meta.url));
assert.throws(()=>historicalOwnerConfigBytes(Buffer.concat([current,Buffer.from(' ')]),prior));
assert.throws(()=>historicalOwnerConfigBytes(current,Buffer.concat([prior,Buffer.from(' ')])));
assert.throws(()=>historicalOwnerConfigBytes(prior,prior));
assert.throws(()=>historicalOwnerConfigBytes(current,current));
