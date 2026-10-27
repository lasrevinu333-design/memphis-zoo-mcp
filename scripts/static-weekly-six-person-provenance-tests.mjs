#!/usr/bin/env node
// Run only against an extracted, frozen review packet. Absolute paths recorded
// by the source generator identify original files; this mapping binds them to
// the corresponding immutable payloads instead of trusting hash syntax.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root=process.env.STATIC_WEEKLY_PACKET_ROOT;
assert.ok(root&&path.isAbsolute(root),'an explicit extracted packet root is required');
const relative={
 ownerCorrectedSchedule:'backend/config/custodial-six-person-static-20260926.json',
 correctedSixPersonAreaMap:'backend/config/custodial-six-person-handout-20260926.json',
 eligibilityScope:'backend/src/static-weekly-owner-eligibility.js',
 generator:'backend/scripts/generate-owner-corrected-static-weekly-schedule.mjs',
 compiler:'backend/src/static-weekly-schedule-compiler.js',
 canonicalProgram:'backend/src/static-weekly-schedule-program.js',
 verifier:'backend/src/static-weekly-schedule-verifier.js',
 shiftEndCoverage:'backend/src/static-weekly-shift-end-coverage.js',
 shiftEndDerivation:'backend/src/static-weekly-shift-end-derivation.js',
 baseVerifiedSchedule:'evidence/base-verified-schedule.json',
 ownerDirectives:'evidence/owner/LATEST_USER_DIRECTIVES_2026-08-27.md',
 ownerCorrection:'evidence/owner/OWNER_CORRECTION_20260920.md',
 ownerClarificationsOC24:'evidence/owner/OWNER_CLARIFICATIONS_20260924_OC24.md',
};
const source=JSON.parse(fs.readFileSync(path.join(root,'evidence/verified-six-person-source.json'),'utf8'));
assert.equal(source.packetSchema,'memphis-zoo.static-weekly.verified-schedule-packet.v1');
assert.deepEqual(source.evidence.map(item=>item.kind).sort(),Object.keys(relative).sort(),
 'every and only known evidence dependency must be present');
const manifest=new Map(fs.readFileSync(path.join(root,'PACKET_MANIFEST.sha256'),'utf8').trimEnd()
 .split('\n').map(line=>{
  const match=/^([a-f0-9]{64})  ([^\n]+)$/.exec(line);
  assert.ok(match,`malformed manifest row: ${line}`);
  return [match[2],match[1]];
 }));
let checked=0;
for(const item of source.evidence){
 const name=relative[item.kind];
 assert.ok(name&&manifest.has(name),`missing packaged evidence dependency: ${item.kind}`);
 const actual=createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
 assert.equal(actual,manifest.get(name),`${item.kind} payload must match manifest`);
 assert.equal(actual,item.sha256,`${item.kind} source claim must match packaged bytes`);
 checked++;
}
console.log(JSON.stringify({status:'PASS',evidenceDependencies:checked,packetRoot:root,productionWritten:false}));
