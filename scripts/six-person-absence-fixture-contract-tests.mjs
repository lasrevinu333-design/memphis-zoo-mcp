import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadSixPersonAbsenceSource,validateSixPersonAbsenceFixtureBytes,SIX_PERSON_SOURCE_DIGEST} from './fixtures/six-person-absence-source.mjs';
let checks=0;
const fixturePath=new URL('./fixtures/six-person-absence-source.json',import.meta.url);
const fixtureBytes=fs.readFileSync(fixturePath), fixture=JSON.parse(fixtureBytes);
assert.equal(loadSixPersonAbsenceSource().sourceDigest,SIX_PERSON_SOURCE_DIGEST);checks++;
for(const mutate of [x=>{x.compilerInput.slots.pop();},x=>{x.compilerInput.version.assignments.pop();},
 x=>{x.compilerInput.proximity.reverse();},x=>{x.compilerInput.slots[0].incumbencies=[];},
 x=>{x.sourceCandidateOnly=false;},x=>{x.provenance.currentOwnerConfigSha256='0'.repeat(64);},
 x=>{x.sourceDigest='0'.repeat(64);},x=>{x.compilerInput.version.slotAvailability[0].shift.end='23:59';}]){
 const changed=structuredClone(fixture);mutate(changed);
 assert.throws(()=>validateSixPersonAbsenceFixtureBytes(Buffer.from(JSON.stringify(changed)+'\n')));checks++;
}
assert.throws(()=>validateSixPersonAbsenceFixtureBytes(Buffer.alloc(0)));checks++;
assert.throws(()=>loadSixPersonAbsenceSource({retainedPacketPath:new URL('./definitely-absent-source-packet.json',import.meta.url)}));checks++;
assert.equal(fixture.compilerInput.slots.filter(s=>!s.contractorCapacity).length,9);checks++;
assert.equal(fixture.compilerInput.proximity.length,2256);checks++;
console.log(JSON.stringify({status:'PASS',checks,scope:'exact portable input integrity and hostile missing/mutation rejection only; no solver/database/production success inferred'}));
