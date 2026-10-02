import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {postgresJsonbContentDigest} from '../../src/static-weekly-schedule-compiler.js';

// Mechanical extraction from the already retained LOCAL candidate, not a
// production dump. Never regenerates a schedule or manufactures solver output.
const [inputPath,outputPath]=process.argv.slice(2);
assert.ok(inputPath&&outputPath,'explicit retained packet and NEW fixture path required');
assert.equal(fs.existsSync(outputPath),false,'refuse fixture replacement');
const bytes=fs.readFileSync(inputPath),sha=b=>createHash('sha256').update(b).digest('hex');
const packetSha='c318fbe200e41eeffcf6b5a6bfc1f55014bed7d7e3d35ff2f6dd35859b3abcfd';
assert.equal(sha(bytes),packetSha,'retained candidate byte identity');
const packet=JSON.parse(bytes),input=packet.compilerInput;
assert.equal(postgresJsonbContentDigest(input),'ac98f94d0c28a9cd493898bef2463059ef59a80bfcac1f8d0a455ddf6901571a');
const fixture={schema:'custodial.exact-six-person-absence-source-fixture.v1',sourceCandidateOnly:true,
 provenance:{sourceHead:'3482379782bd0b74aa27417b10ade34c75d1daeb',retainedPacketSha256:packetSha,
  retainedPacket:'task-5/handoff/october-transition-0539282/evidence/october5-recurring.json',
  currentOwnerConfig:'config/custodial-six-person-static-20261005.json',
  currentOwnerConfigSha256:'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30',
  originalSourceId:packet.sourceId,classification:'LOCAL_UNPUBLISHED_CANONICAL_TEMPLATE_NOT_PRODUCTION_STATE',
  omitted:'packet solver output, routes/capacity duplicate indexes, execution evidence; canonical compiler input is lossless'},
 sourceDigest:packet.sourceDigest,compilerInputCompactSha256:sha(JSON.stringify(input)),compilerInput:input};
fs.writeFileSync(outputPath,JSON.stringify(fixture)+'\n',{flag:'wx'});
console.log(JSON.stringify({outputPath,bytes:fs.statSync(outputPath).size,fixtureSha256:sha(fs.readFileSync(outputPath)),
 canonicalInputDigest:fixture.sourceDigest,canonicalInputCompactSha256:fixture.compilerInputCompactSha256,
 allCanonicalInputValuesRetained:JSON.stringify(JSON.parse(fs.readFileSync(outputPath)).compilerInput)===JSON.stringify(input)}));
