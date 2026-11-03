import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {postgresJsonbContentDigest} from '../../src/static-weekly-schedule-compiler.js';
export const SIX_PERSON_ABSENCE_FIXTURE_SHA256='882e5895d60338313b08f28ec327f2087468261749cdbac5dc7d78ac22e20469';
export const SIX_PERSON_SOURCE_DIGEST='ac98f94d0c28a9cd493898bef2463059ef59a80bfcac1f8d0a455ddf6901571a';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateSixPersonAbsenceFixtureBytes(bytes){
 assert.equal(sha(bytes),SIX_PERSON_ABSENCE_FIXTURE_SHA256,'exact committed six-person fixture bytes');
 const fixture=JSON.parse(bytes);
 assert.equal(fixture.schema,'custodial.exact-six-person-absence-source-fixture.v1');
 assert.equal(fixture.sourceCandidateOnly,true);
 assert.equal(fixture.sourceDigest,SIX_PERSON_SOURCE_DIGEST);
 assert.equal(postgresJsonbContentDigest(fixture.compilerInput),SIX_PERSON_SOURCE_DIGEST);
 assert.equal(sha(JSON.stringify(fixture.compilerInput)),fixture.compilerInputCompactSha256);
 return fixture;
}
export function loadSixPersonAbsenceSource({retainedPacketPath=null}={}){
 const fixture=validateSixPersonAbsenceFixtureBytes(fs.readFileSync(new URL('./six-person-absence-source.json',import.meta.url)));
 if(retainedPacketPath){
  const bytes=fs.readFileSync(retainedPacketPath);
  assert.equal(sha(bytes),fixture.provenance.retainedPacketSha256,'explicit retained packet identity');
  const packet=JSON.parse(bytes);
  assert.deepEqual(packet.compilerInput,fixture.compilerInput,'portable fixture is lossless, not a synthetic replacement');
  assert.equal(packet.sourceDigest,fixture.sourceDigest);
 }
 return {compilerInput:fixture.compilerInput,sourceDigest:fixture.sourceDigest,sourceId:fixture.provenance.originalSourceId,
  provenance:fixture.provenance,fixtureSha256:SIX_PERSON_ABSENCE_FIXTURE_SHA256};
}
